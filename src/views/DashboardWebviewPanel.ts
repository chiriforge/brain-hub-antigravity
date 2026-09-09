import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatMessage, ChatSession, ToolCallInfo } from '../models/types';
import { SessionScanner } from '../services/SessionScanner';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { MarkdownExporter } from '../services/MarkdownExporter';
import { GitSyncService } from '../services/GitSyncService';
import { KATEX_CSS, getKaTeXCss } from '../services/KaTeXStyles';
import { HIGHLIGHT_CSS } from '../services/HighlightStyles';
import { MarkdownPreviewWebviewPanel } from './MarkdownPreviewWebviewPanel';

interface AppConfigState {
  machineName: string;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  filterWorkspaceByDefault: boolean;
  hideEmptySessions: boolean;
  autoReloadOnLiveChat: boolean;
  brainPath: string;
  gitRemoteUrl?: string;
  defaultBrainDir: string;
  messageOrder: 'newestFirst' | 'oldestFirst';
  sessionSortBy: 'lastModified' | 'createdAt';
  defaultToolsState: 'collapsed' | 'expanded';
  defaultAiStepsState: 'collapsed' | 'expanded';
}

interface MessageRenderItem {
  type: 'single' | 'autonomous_group';
  message?: ChatMessage;
  group?: ChatMessage[];
}

export class DashboardWebviewPanel {
  public static currentPanel: DashboardWebviewPanel | undefined;
  public static globalContext?: vscode.ExtensionContext;
  public static treeProvider?: any;

  public static setGlobalContext(ctx: vscode.ExtensionContext): void {
    DashboardWebviewPanel.globalContext = ctx;
  }

  public static setTreeProvider(provider: any): void {
    DashboardWebviewPanel.treeProvider = provider;
  }

  private static cachedCodiconCss: string = '';
  private static cachedVersion: string = '';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private selectedSessionId?: string;
  private isShowingCombinedThread: boolean = false;
  private sessionWatcher?: fs.FSWatcher;
  private sessionPollingTimer?: NodeJS.Timeout;
  private reloadDebounceTimer?: NodeJS.Timeout;
  private isHtmlInitialized: boolean = false;
  private lastActiveSessionModTime: number = 0;
  private lastActiveSessionMsgCount: number = 0;
  private lastWatchedFileSize: number = 0;
  private lastWatchedFileMtime: number = 0;

  public static createOrShow(
    extensionUri: vscode.Uri,
    initialSessionId?: string,
    autoOpenSettings: boolean = false,
    autoFocusSearch: boolean = false
  ): DashboardWebviewPanel {
    if (DashboardWebviewPanel.currentPanel) {
      DashboardWebviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      if (initialSessionId) {
        DashboardWebviewPanel.currentPanel.selectSession(initialSessionId);
      }
      if (autoOpenSettings) {
        DashboardWebviewPanel.currentPanel.openSettingsModal();
      }
      if (autoFocusSearch) {
        DashboardWebviewPanel.currentPanel.focusSearchInput();
      }
      return DashboardWebviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'brainHubDashboard',
      'Brain Hub for Antigravity',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionUri.fsPath, 'media')),
          vscode.Uri.file(path.join(extensionUri.fsPath, 'dist'))
        ]
      }
    );

    panel.iconPath = {
      light: vscode.Uri.file(path.join(extensionUri.fsPath, 'media', 'icon.svg')),
      dark: vscode.Uri.file(path.join(extensionUri.fsPath, 'media', 'icon.svg'))
    };

    const dashboard = new DashboardWebviewPanel(
      panel,
      extensionUri,
      initialSessionId,
      autoOpenSettings,
      autoFocusSearch
    );
    DashboardWebviewPanel.currentPanel = dashboard;
    return dashboard;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialSessionId?: string,
    private autoOpenSettingsOnInit: boolean = false,
    private autoFocusSearchOnInit: boolean = false
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.selectedSessionId = initialSessionId;

    const scanner = SessionScanner.getInstance();
    if (scanner.hasValidCache()) {
      const cachedSessions = scanner.getCachedSessions();
      if (!this.selectedSessionId && cachedSessions.length > 0) {
        this.selectedSessionId = cachedSessions[0].id;
      }
      const activeSession = this.selectedSessionId
        ? cachedSessions.find((s) => s.id === this.selectedSessionId) || cachedSessions[0]
        : cachedSessions[0];
      const rootId = activeSession ? (activeSession.rootId || activeSession.id) : undefined;
      const threadSessions = rootId
        ? cachedSessions.filter((s) => (s.rootId || s.id) === rootId || s.id === rootId)
        : (activeSession ? [activeSession] : []);

      const configState = this.getAppConfigState();
      this.panel.webview.html = this.generateDashboardHtml(
        cachedSessions,
        activeSession,
        [],
        threadSessions,
        configState,
        true
      );
      this.isHtmlInitialized = true;
    } else {
      this.panel.webview.html = this.generateSkeletonHtml();
    }

    let isReadyHandled = false;
    const readyFallbackTimer = setTimeout(() => {
      if (!isReadyHandled) {
        isReadyHandled = true;
        this.updateContent();
      }
    }, 400);

    this.panel.onDidDispose(() => {
      clearTimeout(readyFallbackTimer);
      this.dispose();
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'dashboardReady':
            if (!isReadyHandled) {
              isReadyHandled = true;
              clearTimeout(readyFallbackTimer);
              if (this.selectedSessionId) {
                await this.updateReaderOnly(this.selectedSessionId);
              }
            }
            break;

          case 'selectSession':
            this.selectedSessionId = message.sessionId;
            this.isShowingCombinedThread = false;
            await this.updateReaderOnly(message.sessionId);
            break;

          case 'selectLatestSession':
            const allLatestSessions = await SessionScanner.getInstance().scanSessions();
            if (allLatestSessions.length > 0) {
              const cfgSort = vscode.workspace.getConfiguration('brainHub').get<string>('sessionSortBy', 'lastModified');
              const sorted = [...allLatestSessions].sort((a, b) => {
                if (cfgSort === 'createdAt') {
                  return (b.createdAt || b.lastModified).getTime() - (a.createdAt || a.lastModified).getTime();
                }
                return b.lastModified.getTime() - a.lastModified.getTime();
              });
              const latestId = sorted[0].id;
              this.selectedSessionId = latestId;
              this.isShowingCombinedThread = false;
              const cfgOrder = vscode.workspace.getConfiguration('brainHub').get<string>('messageOrder', 'newestFirst');
              await this.updateReaderOnly(latestId, false, cfgOrder === 'newestFirst' ? 'top' : 'bottom');
            }
            break;

          case 'setSidebarCollapsed':
            DashboardWebviewPanel.globalContext?.globalState.update('dashboardSidebarCollapsed', !!message.collapsed);
            break;

          case 'toggleThreadMode':
            this.isShowingCombinedThread = !this.isShowingCombinedThread;
            if (this.selectedSessionId) {
              await this.updateReaderOnly(this.selectedSessionId);
            } else {
              await this.updateContent();
            }
            break;

          case 'toggleMessageOrder':
            const currentOrder = vscode.workspace.getConfiguration('brainHub').get<string>('messageOrder', 'newestFirst');
            const newOrder = currentOrder === 'newestFirst' ? 'oldestFirst' : 'newestFirst';
            await vscode.workspace.getConfiguration('brainHub').update('messageOrder', newOrder, vscode.ConfigurationTarget.Global);
            await this.updateContent();
            break;

          case 'copyText':
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('Copied to clipboard!');
            break;

          case 'copyResumePrompt':
            if (this.selectedSessionId) {
              const sessions = await SessionScanner.getInstance().scanSessions();
              const s = sessions.find((x) => x.id === this.selectedSessionId);
              if (s) {
                const prompt = `Please review the previous conversation context of the session in folder:\n\`${s.path}\`\n(Session ID: \`${s.id}\` - Title: "${s.title}")\nand continue assisting me.`;
                await vscode.env.clipboard.writeText(prompt);
                vscode.window.showInformationMessage('Resume prompt copied to clipboard!');
              }
            }
            break;

          case 'copySessionId':
            if (this.selectedSessionId) {
              await vscode.env.clipboard.writeText(this.selectedSessionId);
              vscode.window.showInformationMessage(`Copied Session ID: ${this.selectedSessionId}`);
            }
            break;

          case 'exportMarkdown':
            if (this.selectedSessionId) {
              const sessions = await SessionScanner.getInstance().scanSessions();
              const s = sessions.find((x) => x.id === this.selectedSessionId);
              if (s) {
                await MarkdownExporter.exportSession(s);
              }
            }
            break;

          case 'syncGit':
            await GitSyncService.getInstance().syncWithRemote();
            await this.updateContent();
            break;

          case 'openFolder':
            if (this.selectedSessionId) {
              const sessions = await SessionScanner.getInstance().scanSessions();
              const s = sessions.find((x) => x.id === this.selectedSessionId);
              if (s) {
                await vscode.env.openExternal(vscode.Uri.file(s.path));
              }
            }
            break;

          case 'openFile':
            if (message.filePath) {
              await this.handleOpenFile(message.filePath, message.openMode);
            }
            break;

          case 'openRichPreview':
            if (message.filePath) {
              await this.handleOpenFile(message.filePath, 'rich');
            }
            break;

          case 'openIdePreview':
            if (message.filePath) {
              await this.handleOpenFile(message.filePath, 'ide');
            }
            break;

          case 'reloadChat':
            if (this.selectedSessionId) {
              await this.reloadCurrentActiveSession();
              vscode.window.showInformationMessage('Chat session reloaded.');
            }
            break;

          case 'refresh':
            await this.updateContent(true);
            vscode.window.showInformationMessage('Chat sessions refreshed.');
            break;

          case 'cleanEmptySessions':
            await vscode.commands.executeCommand('brainHub.cleanEmptySessions');
            break;

          case 'archiveProjectDocs':
            await vscode.commands.executeCommand('brainHub.exportProjectDocs');
            break;

          case 'deleteSession':
            if (this.selectedSessionId) {
              await vscode.commands.executeCommand('brainHub.deleteSession', this.selectedSessionId);
            }
            break;

          case 'deepSearchSessions': {
            const deepQuery = (message.query || '').trim();
            const matchedIds = await SessionScanner.getInstance().searchSessionsContent(deepQuery);
            this.panel.webview.postMessage({
              command: 'deepSearchResults',
              query: deepQuery,
              matchedIds: matchedIds
            });
            break;
          }

          case 'toggleWorkspaceFilter':
            await vscode.commands.executeCommand('brainHub.toggleWorkspaceFilter');
            break;

          case 'toggleHideEmptySessions':
          case 'toggleHideEmpty':
            await vscode.commands.executeCommand('brainHub.toggleHideEmptySessions');
            break;

          case 'openVsCodeSettings':
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:hungle-vn.brain-hub-antigravity');
            break;

          case 'browseBrainFolder':
            const uri = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: 'Select Antigravity Brain Directory'
            });
            if (uri && uri[0]) {
              this.panel.webview.postMessage({ command: 'setBrainPath', path: uri[0].fsPath });
            }
            break;

          case 'saveSettings':
            const cfg = vscode.workspace.getConfiguration('brainHub');
            if (message.settings) {
              if (message.settings.machineName !== undefined) {
                await cfg.update('machineName', message.settings.machineName.trim() || undefined, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.sessionSortBy !== undefined) {
                await cfg.update('sessionSortBy', message.settings.sessionSortBy, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.messageOrder !== undefined) {
                await cfg.update('messageOrder', message.settings.messageOrder, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.defaultToolsState !== undefined) {
                await cfg.update('defaultToolsState', message.settings.defaultToolsState, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.defaultAiStepsState !== undefined) {
                await cfg.update('defaultAiStepsState', message.settings.defaultAiStepsState, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.autoSyncOnStartup !== undefined) {
                await cfg.update('autoSyncOnStartup', !!message.settings.autoSyncOnStartup, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.autoSyncIntervalMinutes !== undefined) {
                await cfg.update('autoSyncIntervalMinutes', Number(message.settings.autoSyncIntervalMinutes) || 0, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.filterWorkspaceByDefault !== undefined) {
                await cfg.update('filterWorkspaceByDefault', !!message.settings.filterWorkspaceByDefault, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.hideEmptySessions !== undefined) {
                await cfg.update('hideEmptySessions', !!message.settings.hideEmptySessions, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.autoReloadOnLiveChat !== undefined) {
                await cfg.update('autoReloadOnLiveChat', !!message.settings.autoReloadOnLiveChat, vscode.ConfigurationTarget.Global);
              }
              if (message.settings.brainPath !== undefined) {
                await cfg.update('brainPath', message.settings.brainPath.trim() || undefined, vscode.ConfigurationTarget.Global);
              }

              if (message.settings.gitRemoteUrl) {
                await GitSyncService.getInstance().setupGitRepo(message.settings.gitRemoteUrl.trim());
              }

              vscode.window.showInformationMessage('Brain Hub settings saved successfully!');
              this.isHtmlInitialized = false;
              await this.updateContent(true);
            }
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public reveal(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
    this.panel.reveal(viewColumn);
  }

  public openSettingsModal(): void {
    this.panel.webview.postMessage({ command: 'openSettingsModal' });
  }

  public focusSearchInput(): void {
    this.panel.webview.postMessage({ command: 'focusSearchInput' });
  }

  public setFiltersState(isWorkspaceFiltered?: boolean, hideEmptySessions?: boolean): void {
    this.panel.webview.postMessage({
      command: 'setFiltersState',
      isWorkspaceFiltered,
      hideEmptySessions
    });
  }

  private async handleOpenFile(rawPath?: string, openMode?: 'rich' | 'ide' | 'editor'): Promise<void> {
    if (!rawPath || typeof rawPath !== 'string') {
      return;
    }

    let filePath = rawPath.trim();
    if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/\/?/i, '');
      try {
        filePath = decodeURIComponent(filePath);
      } catch {}
    }

    let startLine = 0;
    let endLine = 0;
    const lineHashMatch = filePath.match(/#L(\d+)(?:-L?(\d+))?$/i);
    if (lineHashMatch) {
      startLine = Math.max(0, parseInt(lineHashMatch[1], 10) - 1);
      endLine = lineHashMatch[2] ? Math.max(0, parseInt(lineHashMatch[2], 10) - 1) : startLine;
      filePath = filePath.replace(/#L\d+(?:-L?\d+)?$/i, '');
    }

    if (process.platform === 'win32') {
      filePath = filePath.replace(/^[\/\\]([a-zA-Z]:)/, '$1');
      filePath = path.normalize(filePath);
    }

    let targetPath = filePath;
    const isExplicitlyAbsolute = path.isAbsolute(filePath) || /^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');

    if (!isExplicitlyAbsolute || !fs.existsSync(targetPath)) {
      let activeSessionWs: string | undefined;
      let activeSessionPath: string | undefined;

      if (this.selectedSessionId) {
        const sessions = await SessionScanner.getInstance().scanSessions();
        const s = sessions.find((x) => x.id === this.selectedSessionId);
        if (s) {
          activeSessionWs = s.workspacePath;
          activeSessionPath = s.path;
        }
      }

      if (activeSessionWs && fs.existsSync(activeSessionWs)) {
        const candidate = path.resolve(activeSessionWs, filePath);
        if (fs.existsSync(candidate)) {
          targetPath = candidate;
        }
      }

      if (!fs.existsSync(targetPath) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        for (const wf of vscode.workspace.workspaceFolders) {
          const candidate = path.resolve(wf.uri.fsPath, filePath);
          if (fs.existsSync(candidate)) {
            targetPath = candidate;
            break;
          }
        }
      }

      if (!fs.existsSync(targetPath) && activeSessionPath && fs.existsSync(activeSessionPath)) {
        const candidate = path.resolve(activeSessionPath, filePath);
        if (fs.existsSync(candidate)) {
          targetPath = candidate;
        }
      }

      if (!fs.existsSync(targetPath) && activeSessionWs && fs.existsSync(activeSessionWs)) {
        const found = this.findFileInDirectory(activeSessionWs, path.basename(filePath));
        if (found) {
          targetPath = found;
        }
      }
    }

    if (!fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage(`File not found: ${rawPath}`);
      return;
    }

    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        try {
          await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(targetPath));
        } catch {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath));
        }
        return;
      }
    } catch {}

    const fileUri = vscode.Uri.file(targetPath);
    const isMarkdown = targetPath.toLowerCase().endsWith('.md') || targetPath.toLowerCase().endsWith('.markdown');

    if (isMarkdown && startLine === 0 && endLine === 0) {
      if (openMode === 'ide') {
        try {
          await vscode.commands.executeCommand('markdown.showPreview', fileUri);
          return;
        } catch (err) {
          console.warn('Could not open IDE markdown preview, falling back to editor:', err);
        }
      } else {
        // Default: Open with Antigravity Rich Markdown & Mermaid Preview
        try {
          MarkdownPreviewWebviewPanel.createOrShow(this.extensionUri, targetPath);
          return;
        } catch (err) {
          console.warn('Could not open rich markdown preview, falling back to IDE preview:', err);
          try {
            await vscode.commands.executeCommand('markdown.showPreview', fileUri);
            return;
          } catch {}
        }
      }
    }

    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const opts: vscode.TextDocumentShowOptions = {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
      };
      if (startLine > 0 || endLine > 0) {
        opts.selection = new vscode.Range(startLine, 0, endLine, 0);
      }
      await vscode.window.showTextDocument(doc, opts);
    } catch (err: any) {
      try {
        await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
      } catch (fallbackErr: any) {
        vscode.window.showErrorMessage(`Failed to open file: ${err?.message || err}`);
      }
    }
  }

  private findFileInDirectory(dir: string, filename: string, maxDepth = 4): string | null {
    if (maxDepth <= 0 || !fs.existsSync(dir)) {
      return null;
    }
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.system_generated' || entry.name === '.gemini') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
          return full;
        }
        if (entry.isDirectory()) {
          const sub = this.findFileInDirectory(full, filename, maxDepth - 1);
          if (sub) return sub;
        }
      }
    } catch {}
    return null;
  }

  private setupSessionWatcher(sessionId: string, sessionPath: string): void {
    this.disposeSessionWatcher();

    const autoReload = vscode.workspace.getConfiguration('brainHub').get<boolean>('autoReloadOnLiveChat', true);
    if (!autoReload) {
      return;
    }

    const logsDir = path.join(sessionPath, '.system_generated', 'logs');
    const watchTarget = fs.existsSync(logsDir) ? logsDir : sessionPath;

    try {
      if (fs.existsSync(watchTarget)) {
        this.sessionWatcher = fs.watch(watchTarget, { recursive: true }, (eventType, filename) => {
          if (!filename || filename.includes('transcript') || filename.endsWith('.jsonl') || filename.endsWith('.md')) {
            if (this.reloadDebounceTimer) {
              clearTimeout(this.reloadDebounceTimer);
            }
            this.reloadDebounceTimer = setTimeout(async () => {
              if (this.selectedSessionId === sessionId) {
                await this.updateReaderOnly(sessionId, true);
              }
            }, 300);
          }
        });
      }
    } catch (err) {
      console.warn(`Could not setup session watcher for ${sessionId}:`, err);
    }

    // Active polling fallback for Windows file watcher reliability
    const transcriptFile = path.join(logsDir, 'transcript.jsonl');
    const fullTranscriptFile = path.join(logsDir, 'transcript_full.jsonl');
    try {
      const targetInit = fs.existsSync(fullTranscriptFile) ? fullTranscriptFile : transcriptFile;
      if (fs.existsSync(targetInit)) {
        const st = fs.statSync(targetInit);
        this.lastWatchedFileSize = st.size;
        this.lastWatchedFileMtime = st.mtimeMs;
      }
    } catch {}

    this.sessionPollingTimer = setInterval(async () => {
      if (this.selectedSessionId !== sessionId) {
        return;
      }
      try {
        const targetFile = fs.existsSync(fullTranscriptFile) ? fullTranscriptFile : (fs.existsSync(transcriptFile) ? transcriptFile : null);
        if (targetFile && fs.existsSync(targetFile)) {
          const st = await fs.promises.stat(targetFile);
          if (st.size !== this.lastWatchedFileSize || st.mtimeMs !== this.lastWatchedFileMtime) {
            this.lastWatchedFileSize = st.size;
            this.lastWatchedFileMtime = st.mtimeMs;
            await this.updateReaderOnly(sessionId, true);
          }
        }
      } catch {}
    }, 2000);
  }

  private disposeSessionWatcher(): void {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = undefined;
    }
    if (this.sessionPollingTimer) {
      clearInterval(this.sessionPollingTimer);
      this.sessionPollingTimer = undefined;
    }
    if (this.sessionWatcher) {
      try {
        this.sessionWatcher.close();
      } catch {
        // ignore
      }
      this.sessionWatcher = undefined;
    }
  }

  private getAppConfigState(gitRemoteUrl: string = ''): AppConfigState {
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const scanner = SessionScanner.getInstance();
    return {
      machineName: cfg.get<string>('machineName', ''),
      autoSyncOnStartup: cfg.get<boolean>('autoSyncOnStartup', true),
      autoSyncIntervalMinutes: cfg.get<number>('autoSyncIntervalMinutes', 30),
      filterWorkspaceByDefault: cfg.get<boolean>('filterWorkspaceByDefault', false),
      hideEmptySessions: cfg.get<boolean>('hideEmptySessions', true),
      autoReloadOnLiveChat: cfg.get<boolean>('autoReloadOnLiveChat', true),
      brainPath: cfg.get<string>('brainPath', ''),
      gitRemoteUrl,
      defaultBrainDir: scanner.getDefaultBrainDirectory(),
      messageOrder: cfg.get<'newestFirst' | 'oldestFirst'>('messageOrder', 'newestFirst'),
      sessionSortBy: cfg.get<'lastModified' | 'createdAt'>('sessionSortBy', 'lastModified'),
      defaultToolsState: cfg.get<'collapsed' | 'expanded'>('defaultToolsState', 'collapsed'),
      defaultAiStepsState: cfg.get<'collapsed' | 'expanded'>('defaultAiStepsState', 'collapsed')
    };
  }

  public async selectSession(sessionId: string): Promise<void> {
    this.selectedSessionId = sessionId;
    this.isShowingCombinedThread = false;
    const scanner = SessionScanner.getInstance();
    const sessions = scanner.hasValidCache() ? scanner.getCachedSessions() : await scanner.scanSessions(false);
    const exists = sessions.some((s) => s.id === sessionId);
    if (!exists) {
      await this.updateContent(true);
    } else {
      await this.updateReaderOnly(sessionId);
    }
  }

  public async updateReaderOnly(
    sessionId: string,
    isLiveUpdate: boolean = false,
    forceScrollEdge?: 'top' | 'bottom' | boolean
  ): Promise<void> {
    try {
      const scanner = SessionScanner.getInstance();
      const sessions = scanner.hasValidCache() ? scanner.getCachedSessions() : await scanner.scanSessions(false);
      
      let activeSession: ChatSession | undefined = undefined;
      let activeMessages: ChatMessage[] = [];
      let threadSessions: ChatSession[] = [];

      if (this.isShowingCombinedThread) {
        const threadData = await scanner.loadFullThread(sessionId);
        if (threadData) {
          activeSession = sessions.find((s) => s.id === sessionId);
          activeMessages = threadData.allMessages;
          threadSessions = threadData.threadSessions;
        }
      } else {
        const sessionData = await scanner.loadFullSession(sessionId);
        if (sessionData) {
          activeSession = sessionData.session;
          activeMessages = sessionData.messages;
          const targetInList = sessions.find((s) => s.id === sessionId);
          if (targetInList) {
            targetInList.messageCount = sessionData.session.userPromptCount || sessionData.messages.filter(m => m.type === 'USER_INPUT').length;
          }
          const rootId = sessionData.session.rootId || sessionData.session.id;
          threadSessions = sessions.filter((s) => (s.rootId || s.id) === rootId || s.id === rootId);
          threadSessions.sort((a, b) => (a.createdAt || a.lastModified).getTime() - (b.createdAt || b.lastModified).getTime());
        }
      }

      if (!activeSession) {
        await this.updateContent(false);
        return;
      }

      this.lastActiveSessionModTime = (activeSession.lastModified || activeSession.createdAt).getTime();
      this.lastActiveSessionMsgCount = activeSession.messageCount || 0;

      this.setupSessionWatcher(activeSession.id, activeSession.path);

      const cfg = vscode.workspace.getConfiguration('brainHub');
      const messageOrder = cfg.get<'newestFirst' | 'oldestFirst'>('messageOrder', 'newestFirst');

      const configState = this.getAppConfigState();

      const chatHtml = this.generateReaderHtml(activeSession, activeMessages, threadSessions, configState, false);

      const resolvedScrollEdge =
        typeof forceScrollEdge === 'boolean'
          ? (forceScrollEdge ? (messageOrder === 'newestFirst' ? 'top' : 'bottom') : undefined)
          : forceScrollEdge;

      await this.panel.webview.postMessage({
        command: 'updateReader',
        sessionId: sessionId,
        chatHtml: chatHtml,
        isLiveUpdate: isLiveUpdate,
        messageOrder: messageOrder,
        forceScrollEdge: resolvedScrollEdge
      });
    } catch (err) {
      console.error('Error in updateReaderOnly, falling back to full update:', err);
      await this.updateContent(false);
    }
  }

  public async reloadCurrentActiveSession(): Promise<void> {
    if (!this.selectedSessionId) {
      return;
    }
    const sessionId = this.selectedSessionId;
    SessionScanner.getInstance().invalidateSessionCache(sessionId);
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const order = cfg.get<'newestFirst' | 'oldestFirst'>('messageOrder', 'newestFirst');
    await this.updateReaderOnly(sessionId, false, order === 'newestFirst' ? 'top' : 'bottom');

    const sessions = await SessionScanner.getInstance().scanSessions(false);
    if (this.isHtmlInitialized) {
      const sessionListHtml = this.generateSessionListHtml(sessions, this.selectedSessionId);
      await this.panel.webview.postMessage({
        command: 'updateSessionList',
        sessionListHtml,
        totalSessions: sessions.length
      });
    }
  }

  public async updateContent(forceRefresh: boolean = false): Promise<void> {
    try {
      const scanner = SessionScanner.getInstance();

      // Fast initial render from cache: do NOT block initial paint on full disk scan
      let sessions: ChatSession[];
      if (!forceRefresh && scanner.hasValidCache()) {
        sessions = scanner.getCachedSessions();
      } else {
        sessions = await scanner.scanSessions(forceRefresh);
      }

      if (!this.selectedSessionId && sessions.length > 0) {
        this.selectedSessionId = sessions[0].id;
      }

      // If the dashboard DOM is already initialized, update dynamically without destroying webview DOM!
      if (this.isHtmlInitialized) {
        // Trigger background git status check lazily so it never competes with initial paint
        setTimeout(() => {
          const gitSync = GitSyncService.getInstance();
          gitSync.getStatus().then((gitStatus) => {
            if (gitStatus.remoteUrl && this.panel) {
              this.panel.webview.postMessage({
                command: 'updateGitRemoteUrl',
                remoteUrl: gitStatus.remoteUrl
              });
            }
          }).catch(() => {});
        }, 3000);

        if (this.selectedSessionId) {
          const currentSession = sessions.find((s) => s.id === this.selectedSessionId);
          if (currentSession) {
            const currentMod = (currentSession.lastModified || currentSession.createdAt).getTime();
            const currentCount = currentSession.messageCount || 0;

            if (forceRefresh || currentMod !== this.lastActiveSessionModTime || currentCount !== this.lastActiveSessionMsgCount) {
              await this.updateReaderOnly(this.selectedSessionId, !forceRefresh);
            }
          }
        }
        return;
      }

      let activeSession: ChatSession | undefined = undefined;
      let activeMessages: ChatMessage[] = [];
      let threadSessions: ChatSession[] = [];

      if (this.selectedSessionId) {
        if (this.isShowingCombinedThread) {
          const threadData = await scanner.loadFullThread(this.selectedSessionId);
          if (threadData) {
            activeSession = sessions.find((s) => s.id === this.selectedSessionId);
            activeMessages = threadData.allMessages;
            threadSessions = threadData.threadSessions;
          }
        } else {
          const sessionData = await scanner.loadFullSession(this.selectedSessionId);
          if (sessionData) {
            activeSession = sessionData.session;
            activeMessages = sessionData.messages;
            const targetInList = sessions.find((s) => s.id === this.selectedSessionId);
            if (targetInList) {
              targetInList.messageCount = sessionData.session.userPromptCount || sessionData.messages.filter(m => m.type === 'USER_INPUT').length;
            }
            const rootId = sessionData.session.rootId || sessionData.session.id;
            threadSessions = sessions.filter((s) => (s.rootId || s.id) === rootId || s.id === rootId);
            threadSessions.sort((a, b) => (a.createdAt || a.lastModified).getTime() - (b.createdAt || b.lastModified).getTime());
          }
        }
      }

      if (activeSession) {
        this.setupSessionWatcher(activeSession.id, activeSession.path);
        this.lastActiveSessionModTime = (activeSession.lastModified || activeSession.createdAt).getTime();
        this.lastActiveSessionMsgCount = activeSession.messageCount || 0;
      }

      const gitSync = GitSyncService.getInstance();
      gitSync.getStatus().then((gitStatus) => {
        if (gitStatus.remoteUrl && this.panel) {
          this.panel.webview.postMessage({
            command: 'updateGitRemoteUrl',
            remoteUrl: gitStatus.remoteUrl
          });
        }
      }).catch(() => {});

      const configState = this.getAppConfigState();

      this.panel.webview.html = this.generateDashboardHtml(sessions, activeSession, activeMessages, threadSessions, configState, false);
      this.isHtmlInitialized = true;
    } catch (err) {
      console.error('Error in DashboardWebviewPanel.updateContent:', err);
    }
  }

  public dispose(): void {
    this.disposeSessionWatcher();
    DashboardWebviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  public static formatDateTimeRange(created?: Date, last?: Date, includeWeekday: boolean = false): string {
    if (!created && !last) return '';
    const c = created || last!;
    const l = last || created!;

    const isSameDay =
      c.getFullYear() === l.getFullYear() &&
      c.getMonth() === l.getMonth() &&
      c.getDate() === l.getDate();

    if (includeWeekday) {
      const weekday = c.toLocaleDateString('en-US', { weekday: 'short' });
      const dateStr = c.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const cTimeStr = c.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const lTimeStr = l.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (c.getTime() === l.getTime()) {
        return `📅 ${weekday}, ${dateStr} ${cTimeStr}`;
      }
      if (isSameDay) {
        return `📅 ${weekday}, ${dateStr} ${cTimeStr} ➔ ${lTimeStr}`;
      }
      const lWeekday = l.toLocaleDateString('en-US', { weekday: 'short' });
      const lDateStr = l.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `📅 ${weekday}, ${dateStr} ${cTimeStr} ➔ ${lWeekday}, ${lDateStr} ${lTimeStr}`;
    } else {
      const cDateStr = c.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const cTimeStr = c.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const lTimeStr = l.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      if (c.getTime() === l.getTime() || (isSameDay && cTimeStr === lTimeStr)) {
        return `📅 ${cDateStr}, ${cTimeStr}`;
      }
      if (isSameDay) {
        return `📅 ${cDateStr}, ${cTimeStr} ➔ ${lTimeStr}`;
      }
      const lDateStr = l.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `📅 ${cDateStr}, ${cTimeStr} ➔ ${lDateStr}, ${lTimeStr}`;
    }
  }

  private groupMessages(messages: ChatMessage[]): MessageRenderItem[] {
    const items: MessageRenderItem[] = [];
    let currentAutoGroup: ChatMessage[] = [];

    const flushAutoGroup = () => {
      if (currentAutoGroup.length >= 1) {
        items.push({ type: 'autonomous_group', group: [...currentAutoGroup] });
        currentAutoGroup = [];
      }
    };

    for (const msg of messages) {
      const isSystemEvent = msg.type === 'SYSTEM_MESSAGE' || msg.source === 'SYSTEM';

      const textContent = (msg.cleanContent !== undefined ? msg.cleanContent : msg.content) || '';
      const isShortTransient =
        textContent.length < 350 &&
        !textContent.includes('\n#') &&
        !textContent.includes('```') &&
        /^(tôi đang|mình đang|chúng tôi đang|em đang|đang|vui lòng chờ|chờ|đợi|sẽ tiếp tục|tiến hành|bắt đầu|i have launched|the .* has been launched|i am waiting|i will wait|i'll wait|i am running|i am verifying|i am checking|i am testing|i am inspecting|i am reviewing|i am gathering|i am collecting|i'll pause|i will pause|waiting for|waiting on|waiting to|waiting|running|building|checking|inspecting|executing|gathering|collecting|analyzing|verifying|testing|measuring|please wait|let me check|let me run|proceeding)/i.test(
          textContent.trim()
        );
      const hasMeaningfulContent = textContent.trim().length > 0 && !isShortTransient;

      const isAutonomous =
        (msg.type === 'PLANNER_RESPONSE' || msg.source === 'MODEL') &&
        (isShortTransient ||
          (!hasMeaningfulContent &&
            ((msg.toolCalls && msg.toolCalls.length > 0) || !!msg.thinking || (msg.systemPayloads && msg.systemPayloads.length > 0))));

      // Group autonomous steps and system events together into a single unified collapse group
      if (isAutonomous || isSystemEvent) {
        currentAutoGroup.push(msg);
      } else {
        flushAutoGroup();
        items.push({ type: 'single', message: msg });
      }
    }

    flushAutoGroup();
    return items;
  }

  private renderSessionNavItemHtml(s: ChatSession, isSelected: boolean): string {
    const timeTagStr = DashboardWebviewPanel.formatDateTimeRange(s.createdAt, s.lastModified, false);

    const isThread = Boolean((s.childIds && s.childIds.length > 0) || s.parentId);
    const threadTag = isThread ? '<span class="info-tag type-thread" title="Connected Conversation Thread">🧵</span>' : '';
    const artifactTag = s.hasArtifacts ? '<span class="info-tag type-artifact" title="Has Implementation Plan or Walkthrough Artifacts">🔖</span>' : '';
    const typeBadge = `${threadTag}${artifactTag}`;

    const wsTag = s.workspaceName ? `<span class="info-tag ws" title="Project Folder: ${s.workspacePath || s.workspaceName}">📁 ${MarkdownRenderer.escapeHtml(s.workspaceName)}</span>` : '';
    const pcTag = s.machineName ? `<span class="info-tag pc" title="Computer: ${s.machineName}">💻 ${MarkdownRenderer.escapeHtml(s.machineName)}</span>` : '';

    const promptText = (s.allPrompts && s.allPrompts.length > 0) ? s.allPrompts.join(' ') : s.firstPrompt;
    const searchKeywords = s.searchKeywords || '';
    const rawSearchText = `${s.id} ${s.title} ${promptText} ${searchKeywords} ${s.workspaceName || ''} ${s.machineName || ''}`.toLowerCase();

    const isEmptySession = s.isEmpty || (s.messageCount === 0 && !s.hasArtifacts);
    const wsNameLower = (s.workspaceName || '').toLowerCase();
    const wsPathLower = (s.workspacePath || '').toLowerCase();

    return `
      <div class="session-nav-item ${isSelected ? 'selected' : ''}"
           onclick="selectSession('${s.id}')"
           data-id="${s.id}"
           data-text="${MarkdownRenderer.escapeHtml(rawSearchText)}"
           data-ws-name="${MarkdownRenderer.escapeHtml(wsNameLower)}"
           data-ws-path="${MarkdownRenderer.escapeHtml(wsPathLower)}"
           data-empty="${isEmptySession ? 'true' : 'false'}"
           title="Click to view conversation details">
        <div class="session-nav-title">${MarkdownRenderer.escapeHtml(s.title)}</div>
        <div class="session-nav-info-line">
          ${typeBadge}
          <span class="info-tag time" title="Created Time ➔ Last Message Time">${timeTagStr}</span>
          <span class="info-tag count" title="User Chat Messages Count">💬${s.messageCount}</span>
          ${wsTag}
          ${pcTag}
        </div>
      </div>
    `;
  }

  private generateSessionListHtml(allSessions: ChatSession[], selectedSessionId?: string): string {
    if (!allSessions || allSessions.length === 0) {
      return '<div class="empty-sessions-notice" style="padding: 24px 16px; text-align: center; color: var(--text-secondary); font-size: 13px;">No chat sessions found.</div>';
    }

    const targetSelectedId = selectedSessionId || this.selectedSessionId;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

    const groups: {
      key: 'today' | 'yesterday' | 'week' | 'older';
      title: string;
      sessions: ChatSession[];
    }[] = [
      { key: 'today', title: 'Today', sessions: [] },
      { key: 'yesterday', title: 'Yesterday', sessions: [] },
      { key: 'week', title: 'Previous 7 Days', sessions: [] },
      { key: 'older', title: 'Older', sessions: [] }
    ];

    const cfg = vscode.workspace.getConfiguration('brainHub');
    const sortBy = cfg.get<string>('sessionSortBy', 'lastModified');
    const expansionMode = cfg.get<string>('defaultGroupExpansion', 'smart');

    for (const session of allSessions) {
      const time = (sortBy === 'createdAt'
        ? (session.createdAt || session.lastModified)
        : (session.lastModified || session.createdAt || new Date(0))).getTime();

      if (time >= startOfToday) {
        groups[0].sessions.push(session);
      } else if (time >= startOfYesterday) {
        groups[1].sessions.push(session);
      } else if (time >= startOfWeek) {
        groups[2].sessions.push(session);
      } else {
        groups[3].sessions.push(session);
      }
    }

    const activeGroups = groups.filter((g) => g.sessions.length > 0);
    const hasToday = groups[0].sessions.length > 0;
    const hasYesterday = groups[1].sessions.length > 0;
    const hasWeek = groups[2].sessions.length > 0;
    const hasOlder = groups[3].sessions.length > 0;

    return activeGroups
      .map((g) => {
        const containsSelected = targetSelectedId ? g.sessions.some((s) => s.id === targetSelectedId) : false;
        let isOpen = false;
        if (containsSelected) {
          isOpen = true;
        } else if (expansionMode === 'allExpanded') {
          isOpen = true;
        } else if (expansionMode === 'collapsed') {
          isOpen = false;
        } else {
          // 'smart' mode:
          if (hasToday || hasYesterday) {
            isOpen = g.key === 'today' || g.key === 'yesterday';
          } else if (hasWeek) {
            isOpen = g.key === 'week';
          } else if (hasOlder) {
            isOpen = g.key === 'older';
          }
        }

        const itemsHtml = g.sessions
          .map((s) => this.renderSessionNavItemHtml(s, s.id === targetSelectedId))
          .join('\n');

        return `
          <details class="session-time-group" ${isOpen ? 'open' : ''} data-group="${g.key}">
            <summary class="session-group-header">
              <i class="session-group-chevron codicon codicon-chevron-right"></i>
              <i class="session-group-icon codicon codicon-calendar"></i>
              <span class="session-group-title">${g.title}</span>
              <span class="session-group-count">${g.sessions.length}</span>
            </summary>
            <div class="session-group-items">
              ${itemsHtml}
            </div>
          </details>
        `;
      })
      .join('\n');
  }

  private generateSkeletonHtml(): string {
    return `<!DOCTYPE html>
<html lang="en" style="background-color: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #cccccc);">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brain Hub for Antigravity</title>
  <style>
    html, body {
      background-color: var(--vscode-editor-background, #1e1e1e) !important;
      color: var(--vscode-editor-foreground, #cccccc) !important;
      margin: 0;
      padding: 0;
    }
    :root {
      --bg-primary: var(--vscode-editor-background, #1e1e1e);
      --bg-secondary: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, #252526));
      --bg-tertiary: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-input-background, #2d2d2d));
      --border-color: var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
      --text-muted: var(--vscode-descriptionForeground, #888888);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --shimmer-bg: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.12));
      --shimmer-highlight: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.22));
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-muted);
      font-family: var(--font-family);
      font-size: 14px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .skeleton-bone {
      background: linear-gradient(90deg, var(--shimmer-bg) 25%, var(--shimmer-highlight) 50%, var(--shimmer-bg) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.8s infinite ease-in-out;
      border-radius: 4px;
    }
    .skeleton-header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 8px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-box {
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }
    .title-box {
      width: 180px;
      height: 18px;
      border-radius: 4px;
    }
    .header-center {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      max-width: 440px;
    }
    .search-box {
      width: 100%;
      height: 28px;
      border-radius: 6px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-box {
      width: 28px;
      height: 28px;
      border-radius: 6px;
    }
    .skeleton-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .skeleton-sidebar {
      width: 320px;
      min-width: 280px;
      max-width: 380px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex-shrink: 0;
    }
    .sidebar-filter {
      height: 30px;
      border-radius: 6px;
      width: 100%;
    }
    .group-header-skeleton {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 4px;
      margin-top: 6px;
    }
    .group-title-bone {
      height: 14px;
      width: 90px;
    }
    .group-count-bone {
      height: 14px;
      width: 24px;
      margin-left: auto;
      border-radius: 8px;
    }
    .item-skeleton {
      padding: 8px 10px;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: var(--shimmer-bg);
      opacity: 0.7;
    }
    .item-title-bone {
      height: 14px;
      width: 80%;
    }
    .item-sub-bone {
      height: 10px;
      width: 55%;
    }
    .skeleton-reader {
      flex: 1;
      background: var(--bg-primary);
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: hidden;
    }
    .reader-header-skeleton {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .reader-title-bone {
      height: 24px;
      width: 60%;
    }
    .reader-meta-bone {
      height: 12px;
      width: 35%;
    }
    .message-card-skeleton {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--bg-secondary);
    }
    .msg-header-bone {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .avatar-bone {
      width: 26px;
      height: 26px;
      border-radius: 50%;
    }
    .name-bone {
      height: 14px;
      width: 120px;
    }
    .msg-line-bone {
      height: 12px;
      width: 95%;
    }
    .msg-line-short {
      height: 12px;
      width: 70%;
    }
    .loading-notice {
      margin-top: auto;
      text-align: center;
      padding: 12px;
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="skeleton-header">
    <div class="header-left">
      <div class="skeleton-bone logo-box"></div>
      <div class="skeleton-bone title-box"></div>
    </div>
    <div class="header-center">
      <div class="skeleton-bone search-box"></div>
    </div>
    <div class="header-right">
      <div class="skeleton-bone btn-box"></div>
      <div class="skeleton-bone btn-box"></div>
      <div class="skeleton-bone btn-box"></div>
    </div>
  </div>
  <div class="skeleton-body">
    <div class="skeleton-sidebar">
      <div class="skeleton-bone sidebar-filter"></div>
      <div class="group-header-skeleton">
        <div class="skeleton-bone group-title-bone"></div>
        <div class="skeleton-bone group-count-bone"></div>
      </div>
      <div class="item-skeleton">
        <div class="skeleton-bone item-title-bone"></div>
        <div class="skeleton-bone item-sub-bone"></div>
      </div>
      <div class="item-skeleton">
        <div class="skeleton-bone item-title-bone" style="width: 65%;"></div>
        <div class="skeleton-bone item-sub-bone" style="width: 45%;"></div>
      </div>
      <div class="group-header-skeleton" style="margin-top: 12px;">
        <div class="skeleton-bone group-title-bone" style="width: 70px;"></div>
        <div class="skeleton-bone group-count-bone"></div>
      </div>
      <div class="item-skeleton">
        <div class="skeleton-bone item-title-bone" style="width: 85%;"></div>
        <div class="skeleton-bone item-sub-bone" style="width: 50%;"></div>
      </div>
      <div class="item-skeleton">
        <div class="skeleton-bone item-title-bone" style="width: 75%;"></div>
        <div class="skeleton-bone item-sub-bone" style="width: 40%;"></div>
      </div>
    </div>
    <div class="skeleton-reader">
      <div class="reader-header-skeleton">
        <div class="skeleton-bone reader-title-bone"></div>
        <div class="skeleton-bone reader-meta-bone"></div>
      </div>
      <div class="message-card-skeleton">
        <div class="msg-header-bone">
          <div class="skeleton-bone avatar-bone"></div>
          <div class="skeleton-bone name-bone"></div>
        </div>
        <div class="skeleton-bone msg-line-bone"></div>
        <div class="skeleton-bone msg-line-short"></div>
      </div>
      <div class="message-card-skeleton">
        <div class="msg-header-bone">
          <div class="skeleton-bone avatar-bone"></div>
          <div class="skeleton-bone name-bone" style="width: 140px;"></div>
        </div>
        <div class="skeleton-bone msg-line-bone"></div>
        <div class="skeleton-bone msg-line-bone" style="width: 90%;"></div>
        <div class="skeleton-bone msg-line-short"></div>
      </div>
      <div class="loading-notice">
        <span>⚡ Loading conversations from Brain repository...</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  private generateDashboardHtml(
    allSessions: ChatSession[],
    activeSession?: ChatSession,
    messages: ChatMessage[] = [],
    threadSessions: ChatSession[] = [],
    configState?: AppConfigState,
    isLoadingPlaceholder: boolean = false
  ): string {
    const sessionListHtml = this.generateSessionListHtml(allSessions, this.selectedSessionId);

    const chatViewHtml = this.generateReaderHtml(activeSession, messages, threadSessions, configState, isLoadingPlaceholder);

    const cfg = configState || {
      machineName: '',
      autoSyncOnStartup: true,
      autoSyncIntervalMinutes: 30,
      filterWorkspaceByDefault: false,
      hideEmptySessions: true,
      autoReloadOnLiveChat: true,
      brainPath: '',
      gitRemoteUrl: '',
      defaultBrainDir: '',
      messageOrder: 'newestFirst',
      sessionSortBy: 'lastModified',
      defaultToolsState: 'collapsed',
      defaultAiStepsState: 'collapsed'
    };

    const isToolsExpanded = cfg.defaultToolsState === 'expanded';
    const isAiStepsExpanded = cfg.defaultAiStepsState === 'expanded';
    const isSidebarCollapsed = DashboardWebviewPanel.globalContext?.globalState.get<boolean>('dashboardSidebarCollapsed', false) || false;

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const currentWorkspacePaths = workspaceFolders.map((f) => f.uri.fsPath.toLowerCase());
    const currentWorkspaceNames = workspaceFolders.map((f) => f.name.toLowerCase());
    const activeWsDisplayName = workspaceFolders.length > 0 ? workspaceFolders.map((f) => f.name).join(', ') : '';

    const isWsFiltered = DashboardWebviewPanel.treeProvider
      ? DashboardWebviewPanel.treeProvider.getWorkspaceFilterState()
      : cfg.filterWorkspaceByDefault;
    const isHideEmpty = cfg.hideEmptySessions;
    const wsFilterTooltip = activeWsDisplayName
      ? `Filter chat history by current workspace (${activeWsDisplayName})`
      : 'Filter chat history by current workspace';

    if (!DashboardWebviewPanel.cachedVersion) {
      try {
        const pkgPath = path.join(this.extensionUri.fsPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          DashboardWebviewPanel.cachedVersion = pkg.version || '0.5.1';
        }
      } catch {
        DashboardWebviewPanel.cachedVersion = '0.5.1';
      }
    }
    const extensionVersion = DashboardWebviewPanel.cachedVersion || '0.5.1';

    const syncInfo = GitSyncService.getInstance().getLastSyncInfo();
    const lastSyncTimeStr = syncInfo.lastSyncTimestamp > 0 && syncInfo.lastSyncTimeStr
      ? syncInfo.lastSyncTimeStr
      : (syncInfo.lastSyncTimestamp > 0 ? new Date(syncInfo.lastSyncTimestamp).toLocaleString() : 'Never');
    const syncBtnTitle = lastSyncTimeStr !== 'Never'
      ? `Sync Brain Hub with GitHub (Last sync: ${lastSyncTimeStr})`
      : 'Sync Brain Hub with GitHub (Pull & Push)';

    const searchPlaceholder = allSessions.length > 0
      ? `Search ${allSessions.length} chats, or ID...`
      : 'Search chats, or ID...';

    const codiconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'codicon.css')
    );
    const mermaidUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mermaid.min.js')
    );
    const fontsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'fonts')
    );

    return `
      <!DOCTYPE html>
      <html lang="en" style="background-color: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #cccccc);">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Brain Hub for Antigravity</title>
        <style>
          html, body {
            background-color: var(--vscode-editor-background, #1e1e1e) !important;
            color: var(--vscode-editor-foreground, #cccccc) !important;
            margin: 0;
            padding: 0;
          }
        </style>
        <link rel="stylesheet" href="${codiconUri}">
        <style>
          ${HIGHLIGHT_CSS}
        </style>
        <style>
          :root {
            --bg-primary: var(--vscode-editor-background, #1e1e1e);
            --bg-secondary: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, #252526));
            --bg-tertiary: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-input-background, #2d2d2d));
            --bg-glass: var(--vscode-editor-background, #1e1e1e);
            --border-color: var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.25)));
            --border-hover: var(--vscode-focusBorder, #007acc);
            --text-primary: var(--vscode-editor-foreground, #cccccc);
            --text-secondary: var(--vscode-descriptionForeground, #888888);
            --text-muted: var(--vscode-disabledForeground, #666666);
            --accent-blue: var(--vscode-textLink-foreground, #3794ff);
            --accent-cyan: var(--vscode-charts-cyan, #29b8db);
            --accent-purple: var(--vscode-charts-purple, #b180d7);
            --accent-green: var(--vscode-charts-green, #388a34);
            --accent-orange: var(--vscode-charts-orange, #d18616);
            --accent-red: var(--vscode-errorForeground, #f14c4c);
            --user-bubble-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(55, 148, 255, 0.12));
            --user-bubble-border: var(--vscode-editor-selectionHighlightBorder, rgba(55, 148, 255, 0.3));
            --ai-bubble-bg: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.08)));
            --ai-bubble-border: var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.2));
            --code-bg: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.25));
            --input-bg: var(--vscode-input-background, #3c3c3c);
            --input-fg: var(--vscode-input-foreground, #cccccc);
            --input-border: var(--vscode-input-border, transparent);
            --btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
            --btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
            --btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
            --btn-primary-bg: var(--vscode-button-background, #0e639c);
            --btn-primary-fg: var(--vscode-button-foreground, #ffffff);
            --btn-primary-hover: var(--vscode-button-hoverBackground, #1177bb);
            --radius-md: 6px;
            --radius-lg: 10px;
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
            --shimmer-bg: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.12));
            --shimmer-highlight: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.22));
          }

          body.vscode-light {
            --user-bubble-bg: rgba(55, 148, 255, 0.1);
            --user-bubble-border: rgba(55, 148, 255, 0.35);
            --ai-bubble-bg: rgba(0, 0, 0, 0.03);
            --ai-bubble-border: rgba(0, 0, 0, 0.12);
            --code-bg: rgba(0, 0, 0, 0.05);
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: var(--bg-primary);
            color: var(--text-primary);
            font-family: var(--font-family);
            font-size: 14px;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
          }

          @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
          .skeleton-bone {
            background: linear-gradient(90deg, var(--shimmer-bg) 25%, var(--shimmer-highlight) 50%, var(--shimmer-bg) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.8s infinite ease-in-out;
            border-radius: 4px;
          }
          .reader-loading-skeleton {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 24px;
            width: 100%;
            max-width: 900px;
            margin: 0 auto;
          }
          .reader-skeleton-card {
            display: flex;
            gap: 14px;
            padding: 18px 20px;
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-color);
          }
          .reader-skeleton-card.user-card {
            background: var(--user-bubble-bg);
            border-color: var(--user-bubble-border);
          }
          .reader-skeleton-card.ai-card {
            background: var(--ai-bubble-bg);
            border-color: var(--ai-bubble-border);
          }
          .sk-avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .sk-card-content {
            display: flex;
            flex-direction: column;
            gap: 10px;
            flex: 1;
          }
          .sk-line-header {
            height: 14px;
            width: 130px;
          }
          .sk-line-body {
            height: 12px;
            width: 92%;
          }
          .sk-line-body.sk-short {
            width: 50%;
          }

          .dashboard-header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px 16px;
            flex-shrink: 0;
            z-index: 50;
            flex-wrap: wrap;
          }

          .header-left-section {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
          }

          .latest-chat-btn {
            color: var(--accent-cyan, #38bdf8) !important;
          }

          .latest-chat-btn:hover {
            filter: brightness(1.25);
            transform: translateY(-1px);
          }

          .latest-chat-btn.flash {
            background: rgba(56, 189, 248, 0.25) !important;
            color: #38bdf8 !important;
            border-color: #38bdf8 !important;
            animation: pulseLatestBtn 0.8s ease-in-out;
          }

          @keyframes pulseLatestBtn {
            0% { transform: scale(1); }
            50% { transform: scale(1.15); box-shadow: 0 0 10px rgba(56, 189, 248, 0.6); }
            100% { transform: scale(1); }
          }

          .app-branding {
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
            flex-shrink: 0;
          }

          .app-title-text {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            font-size: 14px;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.2px;
            white-space: nowrap;
          }

          .app-title-icon {
            width: 17px;
            height: 17px;
            color: var(--accent-blue, #3794ff);
            flex-shrink: 0;
            vertical-align: middle;
          }

          .app-version-text {
            font-size: 10px;
            font-family: var(--font-mono, monospace);
            font-weight: 400;
            color: var(--text-muted, #8b949e);
            opacity: 0.8;
            user-select: none;
            letter-spacing: 0.1px;
            white-space: nowrap;
          }

          body.vscode-light .app-version-text {
            color: #6e7781;
          }

          .branding-badge {
            background: var(--accent-purple);
            color: #ffffff;
            font-size: 11px;
            padding: 2px 7px;
            border-radius: 12px;
            font-weight: 600;
            white-space: nowrap;
            letter-spacing: 0.2px;
          }

          .latest-chat-btn .lightning-icon {
            font-size: 13px;
            line-height: 1;
            display: inline-block;
            transform: translateY(-0.5px);
          }

          .dashboard-top-actions {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
          }

          .dashboard-body {
            display: flex;
            flex: 1;
            min-height: 0;
            position: relative;
            overflow: hidden;
          }

          .dashboard-sidebar {
            width: 380px;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            overflow: hidden;
            transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
          }

          .dashboard-body.sidebar-collapsed .dashboard-sidebar {
            width: 0 !important;
            min-width: 0 !important;
            max-width: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border-right: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
            display: none !important;
          }

          .sidebar-filter-box {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border-color);
            background: var(--bg-secondary);
          }

          .sidebar-filter-row {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .sidebar-filter-row .search-input-wrapper {
            flex: 1 1 auto;
            min-width: 0;
            position: relative;
          }

          .sidebar-filter-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
          }

          .sidebar-action-btn {
            height: 33px;
            width: 33px;
            min-width: 33px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-color);
            background: var(--card-bg, rgba(255, 255, 255, 0.04));
            color: var(--text-muted);
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .sidebar-action-btn:hover {
            color: var(--text-primary);
            border-color: var(--border-hover);
            background: rgba(255, 255, 255, 0.08);
          }

          .sidebar-action-btn.active {
            background: var(--accent-primary, #3b82f6) !important;
            color: #ffffff !important;
            border-color: transparent !important;
            box-shadow: 0 0 8px rgba(59, 130, 246, 0.35);
          }

          .search-input-wrapper {
            position: relative;
          }

          .search-input {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--input-border, var(--border-color));
            color: var(--input-fg);
            padding: 8px 75px 8px 34px;
            border-radius: var(--radius-md);
            font-size: 13px;
            outline: none;
          }

          .search-input:focus {
            border-color: var(--border-hover);
          }

          .search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
          }

          .search-icon.codicon {
            font-size: 13px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }

          .clear-search-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            transition: color 0.15s, background 0.15s;
          }

          .clear-search-btn:hover {
            color: var(--text-primary);
            background: rgba(128, 128, 128, 0.2);
          }

          .clear-search-btn.visible {
            display: flex;
          }

          .search-match-count {
            position: absolute;
            right: 28px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 10.5px;
            line-height: 1;
            padding: 2px 6px;
            border-radius: 10px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
            pointer-events: none;
            white-space: nowrap;
            user-select: none;
            display: none;
            font-family: var(--font-mono, monospace);
            font-weight: 500;
            transition: all 0.15s ease;
          }

          .search-match-count.visible {
            display: inline-flex;
            align-items: center;
          }

          .search-match-count.has-matches {
            background: rgba(33, 150, 243, 0.15);
            color: var(--accent-blue, #58a6ff);
            border-color: rgba(33, 150, 243, 0.35);
          }

          .search-match-count.no-matches {
            background: rgba(241, 76, 76, 0.15);
            color: var(--accent-red, #f85149);
            border-color: rgba(241, 76, 76, 0.35);
          }

          mark.search-highlight {
            background: rgba(255, 213, 79, 0.4);
            color: inherit;
            border-radius: 2px;
            padding: 0 1px;
            box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.55);
            font-weight: 600;
          }

          mark.search-highlight.current-highlight {
            background: #ff9800;
            color: #000;
            box-shadow: 0 0 0 2px #ff5722, 0 0 8px rgba(255, 152, 0, 0.6);
          }

          .session-nav-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .session-time-group {
            display: flex;
            flex-direction: column;
            margin-bottom: 6px;
          }

          .session-time-group.hidden {
            display: none !important;
          }

          .session-group-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 8px;
            cursor: pointer;
            user-select: none;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-secondary);
            border-radius: var(--radius-sm);
            transition: background 0.15s, color 0.15s;
            list-style: none;
            outline: none;
          }

          .session-group-header::-webkit-details-marker {
            display: none;
          }

          .session-group-header:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
          }

          .session-group-chevron {
            font-size: 10px;
            transition: transform 0.15s ease;
            display: inline-block;
            opacity: 0.7;
          }

          .session-time-group[open] > .session-group-header .session-group-chevron {
            transform: rotate(90deg);
          }

          .session-group-icon {
            font-size: 11px;
            opacity: 0.8;
          }

          .session-group-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            letter-spacing: 0.3px;
          }

          .session-group-count {
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 10px;
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-weight: 600;
            border: 1px solid var(--border-color);
          }

          .session-group-items {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding-top: 4px;
          }

          .session-nav-item {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 10px 14px;
            cursor: pointer;
            transition: all 0.15s;
          }

          .session-nav-item:hover {
            border-color: var(--border-hover);
            transform: translateX(2px);
          }

          .session-nav-item.selected {
            background: var(--user-bubble-bg);
            border-color: var(--accent-blue);
          }

          .session-nav-item.hidden {
            display: none !important;
          }

          .session-nav-item.deep-match {
            border-left: 3px solid var(--accent-cyan, #38bdf8);
          }

          .session-nav-item.deep-match .session-nav-title::after {
            content: ' 🔍';
            font-size: 11px;
            opacity: 0.85;
          }

          .session-nav-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .session-nav-info-line {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 6px;
            flex-wrap: wrap;
            font-size: 10px;
            line-height: 1.4;
          }

          .info-tag {
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 4px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border: 1px solid var(--border-color);
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
          }

          .info-tag.type-artifact {
            color: var(--accent-purple);
            background: rgba(188, 140, 255, 0.12);
            border-color: rgba(188, 140, 255, 0.3);
            font-weight: 600;
          }

          .info-tag.type-thread {
            color: var(--accent-green);
            background: rgba(56, 138, 52, 0.12);
            border-color: rgba(56, 138, 52, 0.3);
            font-weight: 600;
          }

          .info-tag.type-chat {
            color: var(--accent-blue);
            background: rgba(55, 148, 255, 0.08);
            border-color: rgba(55, 148, 255, 0.2);
          }

          .info-tag.ws {
            color: var(--accent-blue);
            background: var(--user-bubble-bg);
            border-color: var(--user-bubble-border);
          }

          .info-tag.pc {
            color: var(--accent-purple);
            background: rgba(188, 140, 255, 0.08);
            border-color: rgba(188, 140, 255, 0.2);
          }

          .dashboard-reader {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
            background: var(--bg-primary);
            overflow-y: auto;
            position: relative;
            overflow-anchor: none !important;
          }

          .reader-header {
            background: var(--bg-primary);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 24px;
            position: sticky;
            top: 0;
            z-index: 50;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
            overflow-anchor: none !important;
            transition: padding 0.15s ease, box-shadow 0.15s ease;
          }

          .reader-header.scrolled {
            padding: 8px 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          }

          .reader-header-column {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
          }

          .reader-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-primary);
            letter-spacing: -0.3px;
            line-height: 1.35;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            overflow-wrap: anywhere;
            word-break: break-word;
            transition: font-size 0.2s ease;
          }

          .reader-header.scrolled .reader-title {
            font-size: 13.5px;
            -webkit-line-clamp: 1;
            margin-bottom: 0;
          }

          /* Single Unified Toolbar with Autowrap */
          .reader-combined-toolbar {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 2px;
          }

          .transcript-search-wrapper {
            position: relative;
            flex: 1 1 160px;
            min-width: 160px;
            max-width: 100%;
          }

          .transcript-search-input {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--input-fg);
            padding: 4px 75px 4px 26px;
            border-radius: var(--radius-md);
            font-size: 12px;
            outline: none;
          }

          .transcript-search-input:focus {
            border-color: var(--border-hover);
          }

          .action-btn {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: 1px solid var(--border-color);
            padding: 4px 9px;
            border-radius: var(--radius-md);
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transition: all 0.15s;
            white-space: nowrap;
          }

          .action-btn.icon-only {
            padding: 4px 7px;
          }

          .action-btn .codicon {
            font-size: 13.5px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
          }

          .sidebar-action-btn .codicon {
            font-size: 13px;
          }

          .action-btn:hover {
            background: var(--btn-hover);
            border-color: var(--border-hover);
          }

          .action-btn.primary {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-fg);
            border-color: transparent;
            font-weight: 600;
          }

          .action-btn.primary:hover {
            background: var(--btn-primary-hover);
          }

          .action-btn.danger {
            color: var(--accent-red);
            border-color: rgba(241, 76, 76, 0.35);
          }

          .action-btn.danger:hover {
            background: rgba(241, 76, 76, 0.15);
            border-color: var(--accent-red);
          }

          .header-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            font-size: 11.5px;
            max-height: 80px;
            opacity: 1;
            overflow: visible;
            transform: translateY(0);
            transition: max-height 0.22s ease, opacity 0.18s ease, transform 0.18s ease, margin 0.18s ease;
          }

          .reader-header.scrolled .header-meta {
            max-height: 0;
            opacity: 0;
            margin: 0;
            padding: 0;
            pointer-events: none;
            overflow: hidden;
            transform: translateY(-4px);
          }

          .meta-badge {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            padding: 2px 7px;
            border-radius: 20px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-family: var(--font-mono);
            font-size: 11px;
          }

          .meta-badge.purple { color: var(--accent-purple); }
          .meta-badge.blue { color: var(--accent-blue); }
          .meta-badge.cyan { color: var(--accent-cyan); }
          .meta-badge.green { color: var(--accent-green); }
          .meta-badge.ws { color: var(--accent-blue); }
          .meta-badge.pc { color: var(--accent-purple); }

          .live-badge {
            color: var(--accent-green) !important;
            background: rgba(56, 138, 52, 0.12) !important;
            border-color: rgba(56, 138, 52, 0.45) !important;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transform-origin: left center;
          }

          .live-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent-green);
            display: inline-block;
            animation: pulse-dot 1.8s infinite ease-in-out;
            flex-shrink: 0;
          }

          @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.35; transform: scale(0.75); }
          }

          .live-badge.live-badge-active {
            background: rgba(0, 210, 255, 0.22) !important;
            border-color: var(--accent-cyan, #00d2ff) !important;
            color: var(--accent-cyan, #00d2ff) !important;
            box-shadow: 0 0 14px rgba(0, 210, 255, 0.65) !important;
            animation: liveBadgePing 0.7s ease-in-out 3;
            transform-origin: left center;
          }

          @keyframes liveBadgePing {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.06); box-shadow: 0 0 16px rgba(0, 210, 255, 0.9); }
          }

          .live-updated-highlight {
            position: relative;
            animation: liveUpdateCardGlow 2.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
            border-color: var(--accent-cyan, #00d2ff) !important;
          }

          @keyframes liveUpdateCardGlow {
            0% {
              box-shadow: 0 0 0 2px var(--accent-cyan, #00d2ff), 0 0 28px rgba(0, 210, 255, 0.65), inset 0 0 16px rgba(0, 210, 255, 0.2);
              border-color: var(--accent-cyan, #00d2ff);
            }
            30% {
              box-shadow: 0 0 0 2px var(--accent-cyan, #00d2ff), 0 0 36px rgba(0, 210, 255, 0.8), inset 0 0 22px rgba(0, 210, 255, 0.25);
              border-color: var(--accent-cyan, #00d2ff);
            }
            70% {
              box-shadow: 0 0 0 1.5px rgba(0, 210, 255, 0.45), 0 0 18px rgba(0, 210, 255, 0.35);
              border-color: rgba(0, 210, 255, 0.45);
            }
            100% {
              box-shadow: none;
            }
          }

          .live-update-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: linear-gradient(135deg, #00d2ff 0%, #0078d4 100%);
            color: #ffffff;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 2px 7px;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 210, 255, 0.6);
            animation: liveTagAnim 2.8s ease-out forwards;
            vertical-align: middle;
            margin-left: 8px;
            pointer-events: none;
          }

          @keyframes liveTagAnim {
            0% { opacity: 0; transform: scale(0.7); }
            15% { opacity: 1; transform: scale(1.05); }
            25% { transform: scale(1); }
            75% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(0.85); }
          }

          .thread-banner {
            background: rgba(188, 140, 255, 0.08);
            border: 1px solid rgba(188, 140, 255, 0.25);
            border-radius: var(--radius-md);
            margin: 12px 24px 0 24px;
            padding: 10px 16px;
          }

          .thread-header-line {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 6px;
          }

          .thread-chain {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
          }

          .thread-part-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 3px 8px;
            border-radius: 20px;
            font-size: 11px;
            cursor: pointer;
          }

          .thread-part-btn.active {
            background: var(--accent-purple);
            color: #ffffff;
            font-weight: 600;
          }

          .artifacts-bar {
            background: rgba(55, 148, 255, 0.08);
            border: 1px solid rgba(55, 148, 255, 0.2);
            border-radius: var(--radius-md);
            margin: 12px 24px 0 24px;
            padding: 8px 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .artifact-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 3px 8px;
            border-radius: var(--radius-md);
            font-size: 11px;
            cursor: pointer;
          }

          .chat-timeline {
            padding: 18px 24px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            max-width: 100%;
          }

          /* Optimized Full-Width Message Card with 1-Line Header */
          .message-card {
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
          }

          .message-card.hidden {
            display: none !important;
          }

          .message-header-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            line-height: 1;
          }

          .message-avatar {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            flex-shrink: 0;
          }

          .avatar-user { background: linear-gradient(135deg, var(--accent-blue), #1f6feb); color: #ffffff; }
          .avatar-ai { background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue)); color: #ffffff; }

          .message-sender-name { font-weight: 600; color: var(--text-primary); }
          .message-time { color: var(--text-muted); font-size: 11px; }

          .message-bubble {
            width: 100%;
            position: relative;
            background: var(--ai-bubble-bg);
            border: 1px solid var(--ai-bubble-border);
            border-radius: var(--radius-md);
            padding: 14px 18px;
            word-break: break-word;
            overflow-wrap: break-word;
            contain: layout style paint;
            line-height: 1.6;
            font-size: 13.5px;
          }

          .message-card.user .message-bubble {
            background: var(--user-bubble-bg);
            border-color: var(--user-bubble-border);
          }

          .user-media-gallery {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 12px;
          }

          .user-media-item {
            border-radius: var(--radius-md);
            overflow: hidden;
            border: 1px solid var(--border-color);
            background: var(--bg-tertiary);
            max-width: 380px;
            max-height: 240px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
          }

          .user-media-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
            border-color: var(--accent-blue);
          }

          .user-media-thumb {
            display: block;
            max-width: 100%;
            max-height: 240px;
            object-fit: contain;
          }

          /* AI Response & Markdown Rendered Images */
          .chat-image-container {
            display: inline-flex;
            flex-direction: column;
            margin: 10px 0 14px 0;
            max-width: 100%;
            vertical-align: middle;
          }

          .chat-rendered-img {
            display: block;
            max-width: 100%;
            max-height: 520px;
            height: auto;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-color);
            background: var(--bg-tertiary);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
            cursor: zoom-in;
            object-fit: contain;
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
          }

          .chat-rendered-img:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
            border-color: var(--accent-blue);
          }

          .chat-image-caption {
            font-size: 11.5px;
            color: var(--text-muted);
            margin-top: 6px;
            text-align: center;
            font-style: italic;
          }

          .chat-image-missing {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            margin: 6px 0;
            background: rgba(239, 68, 68, 0.08);
            border: 1px dashed rgba(239, 68, 68, 0.35);
            border-radius: var(--radius-sm);
            color: var(--text-muted);
            font-size: 12px;
            font-family: var(--font-mono);
          }

          .chat-image-missing .missing-icon {
            font-size: 14px;
          }

          .chat-image-missing .missing-text {
            color: var(--text-secondary);
            word-break: break-all;
          }

          .chat-image-missing .missing-tag {
            color: #ef4444;
            font-size: 10.5px;
            font-weight: 600;
          }

          /* Fullscreen Image Lightbox Modal */
          .media-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(6px);
            z-index: 1000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
            cursor: zoom-out;
          }

          .media-modal-overlay.visible {
            display: flex;
          }

          .media-modal-content {
            position: relative;
            max-width: 95vw;
            max-height: 95vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .media-modal-img {
            max-width: 92vw;
            max-height: 90vh;
            object-fit: contain;
            border-radius: var(--radius-md);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.2);
            cursor: default;
          }

          .media-modal-close-btn {
            position: absolute;
            top: -14px;
            right: -14px;
            background: var(--bg-secondary, #252526);
            color: var(--text-primary, #ffffff);
            border: 1px solid var(--border-color);
            border-radius: 50%;
            width: 32px;
            height: 32px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            transition: background 0.15s, transform 0.15s;
          }

          .media-modal-close-btn:hover {
            background: var(--accent-red, #e51400);
            color: #ffffff;
            transform: scale(1.1);
          }

          .copy-msg-btn {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 2px 7px;
            border-radius: var(--radius-sm, 4px);
            font-size: 10.5px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            opacity: 0.6;
            transition: all 0.15s;
          }

          .message-card:hover .copy-msg-btn {
            opacity: 1;
          }

          .copy-msg-btn:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
            border-color: var(--border-hover, var(--text-muted));
          }

          .copy-msg-btn.copied {
            color: var(--accent-green) !important;
            border-color: var(--accent-green) !important;
            background: rgba(56, 138, 52, 0.15) !important;
          }

          .message-bubble p {
            margin: 0 0 10px 0;
            line-height: 1.6;
          }

          .message-bubble p:last-child {
            margin-bottom: 0;
          }

          .message-bubble h1,
          .message-bubble h2,
          .message-bubble h3,
          .message-bubble h4,
          .message-bubble h5,
          .message-bubble h6 {
            color: var(--text-primary);
            font-weight: 600;
            line-height: 1.35;
          }

          .message-bubble h1 { font-size: 18px; margin: 18px 0 10px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; }
          .message-bubble h2 { font-size: 16px; margin: 16px 0 8px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
          .message-bubble h3 { font-size: 14.5px; margin: 14px 0 6px 0; }
          .message-bubble h4 { font-size: 13.5px; margin: 12px 0 4px 0; }
          .message-bubble h5, .message-bubble h6 { font-size: 12.5px; margin: 10px 0 4px 0; }

          .message-bubble ul,
          .message-bubble ol {
            margin: 6px 0 10px 0;
            padding-left: 24px;
          }

          .message-bubble ul ul,
          .message-bubble ol ol,
          .message-bubble ul ol,
          .message-bubble ol ul {
            margin: 3px 0 3px 0;
            padding-left: 20px;
          }

          .message-bubble li {
            margin-bottom: 4px;
            line-height: 1.55;
          }

          .message-bubble li:last-child {
            margin-bottom: 0;
          }

          .message-bubble hr {
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 14px 0;
          }

          .message-bubble a.markdown-link {
            color: var(--accent-blue);
            text-decoration: none;
          }

          .message-bubble a.markdown-link:hover {
            text-decoration: underline;
          }

          .message-bubble blockquote {
            border-left: 4px solid var(--accent-blue);
            padding: 6px 14px;
            margin: 10px 0;
            background: rgba(128, 128, 128, 0.05);
            border-radius: 0 var(--radius-md) var(--radius-md) 0;
            color: var(--text-secondary);
          }

          .table-container {
            width: 100%;
            overflow-x: auto;
            margin: 12px 0;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-color);
          }

          .message-bubble table,
          .markdown-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            line-height: 2.1;
            margin: 14px 0;
          }

          .message-bubble th,
          .message-bubble td,
          .markdown-table th,
          .markdown-table td {
            border: 1px solid var(--border-color);
            padding: 12px 16px;
            text-align: left;
            vertical-align: middle;
          }

          .message-bubble th,
          .markdown-table th {
            background: var(--bg-secondary);
            font-weight: 600;
            color: var(--text-primary);
          }

          .message-bubble tr:nth-child(even) td,
          .markdown-table tr:nth-child(even) td {
            background: rgba(128, 128, 128, 0.04);
          }

          /* KaTeX Breathing Spacing & Vertical Rhythm */
          .katex {
            font-size: 1.12em;
            line-height: 1.6;
            text-indent: 0;
            text-rendering: auto;
            display: inline-block;
            vertical-align: middle;
            margin: 3px 2px;
          }

          .katex-display {
            display: block;
            margin: 14px 0;
            text-align: center;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 6px 0;
          }

          .katex .mfrac {
            margin: 2px 2px;
            vertical-align: -0.55em;
          }

          .katex .mrel {
            margin: 0 0.35em;
          }

          .katex .mbin {
            margin: 0 0.28em;
          }

          .message-bubble td .katex {
            margin: 6px 2px;
          }

          /* Mermaid Diagram Styling */
          .mermaid-container {
            margin: 14px 0;
            width: 100%;
          }

          .mermaid-card {
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            overflow: hidden;
          }

          .mermaid-header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px;
          }

          .mermaid-tag {
            font-size: 11px;
            font-weight: 700;
            color: var(--accent-cyan);
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .mermaid-body {
            padding: 16px;
            display: flex;
            justify-content: center;
            overflow-x: auto;
            background: rgba(0, 0, 0, 0.08);
          }

          .mermaid-body svg {
            max-width: 100%;
            height: auto;
          }

          .mermaid-error-card {
            background: rgba(241, 76, 76, 0.08);
            border: 1px solid rgba(241, 76, 76, 0.35);
            border-radius: var(--radius-md);
            margin: 12px 0;
            padding: 12px 16px;
          }

          .mermaid-error-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
            flex-wrap: wrap;
          }

          .mermaid-error-title {
            font-weight: 700;
            font-size: 13px;
            color: var(--accent-red);
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .fix-ai-btn {
            background: var(--accent-purple);
            color: #ffffff;
            border: none;
            padding: 5px 12px;
            border-radius: var(--radius-md);
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
          }

          .fix-ai-btn:hover {
            filter: brightness(1.15);
            transform: translateY(-1px);
          }

          .fix-ai-btn.copied {
            background: var(--accent-green) !important;
          }

          .mermaid-error-desc {
            font-size: 12px;
            color: var(--text-secondary);
            margin-bottom: 10px;
          }

          /* Full Official KaTeX Stylesheet with local fonts */
          ${getKaTeXCss(fontsUri.toString())}

          /* Parent Group Details for Multiple Consecutive Autonomous AI Steps */
          details.autonomous-group-details {
            border: 1px solid var(--border-color);
            border-left: 3px solid var(--accent-purple);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            margin: 4px 0;
            overflow: hidden;
            width: 100%;
          }

          details.autonomous-group-details summary {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
            background: var(--bg-tertiary);
            user-select: none;
          }

          details.autonomous-group-details[open] summary {
            border-bottom: 1px solid var(--border-color);
          }

          .autonomous-group-body {
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: var(--bg-primary);
          }

          .group-count {
            font-size: 11px;
            color: var(--text-secondary);
            font-weight: 500;
          }

          .group-tools {
            font-size: 11px;
            color: var(--accent-purple);
            font-family: var(--font-mono);
            margin-left: auto;
          }

          /* Single Collapsible Autonomous AI Step */
          details.internal-step-details {
            border: 1px dashed var(--border-color);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            margin: 3px 0;
            overflow: hidden;
            width: 100%;
          }

          details.internal-step-details summary {
            padding: 6px 10px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-secondary);
            background: var(--bg-tertiary);
          }

          details.internal-step-details[open] summary {
            border-bottom: 1px solid var(--border-color);
          }

          .internal-step-body {
            padding: 10px 12px;
          }

          /* Full Syntax Highlighting & Code Block Stylesheet */
          ${HIGHLIGHT_CSS}

          .markdown-alert { border-left: 4px solid; border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: 8px 12px; margin: 10px 0; background: rgba(128, 128, 128, 0.08); }
          .markdown-alert-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 11.5px; margin-bottom: 3px; text-transform: uppercase; }
          .markdown-alert-note { border-color: var(--accent-blue); }
          .markdown-alert-tip { border-color: var(--accent-green); }
          .markdown-alert-important { border-color: var(--accent-purple); }
          .markdown-alert-warning { border-color: var(--accent-orange); }
          .markdown-alert-caution { border-color: var(--accent-red); }

          details.chat-details {
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            margin: 8px 0;
            background: var(--bg-primary);
            width: 100%;
            overflow: hidden;
          }
          details.chat-details summary {
            background: var(--bg-secondary);
            padding: 6px 10px;
            cursor: pointer;
            font-size: 11.5px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            user-select: none;
            transition: background 0.15s;
          }
          details.chat-details summary:hover {
            background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
          }
          .details-inner-content {
            padding: 10px 12px;
            font-size: 12.5px;
            border-top: 1px solid var(--border-color);
          }
          .tool-badge { font-size: 9.5px; padding: 1px 5px; border-radius: 10px; font-weight: 600; }
          .tool-badge.success { background: rgba(56, 138, 52, 0.2); color: var(--accent-green); }
          .tool-badge.error { background: rgba(241, 76, 76, 0.2); color: var(--accent-red); }

          .empty-reader { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); }

          /* Floating Controls */
          .floating-controls {
            position: fixed;
            bottom: 24px;
            right: 28px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            z-index: 100;
          }

          @keyframes floatBtnPulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 210, 255, 0.7), 0 4px 12px rgba(0, 0, 0, 0.35); }
            50% { box-shadow: 0 0 0 10px rgba(0, 210, 255, 0), 0 4px 16px rgba(0, 210, 255, 0.6); }
            100% { box-shadow: 0 0 0 0 rgba(0, 210, 255, 0), 0 4px 12px rgba(0, 0, 0, 0.35); }
          }

          @keyframes pulseBadge {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.3); opacity: 0.75; }
          }

          .float-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            transition: all 0.2s;
          }

          .float-btn:hover {
            background: var(--btn-hover);
            border-color: var(--border-hover);
            transform: translateY(-2px);
          }

          .float-btn.has-new-messages {
            border-color: var(--accent-cyan, #00d2ff) !important;
            color: var(--accent-cyan, #00d2ff) !important;
            animation: floatBtnPulse 1.8s infinite ease-in-out !important;
            position: relative;
          }

          .float-btn.has-new-messages::after {
            content: '';
            position: absolute;
            top: -2px;
            right: -2px;
            width: 10px;
            height: 10px;
            background: #00d2ff;
            border-radius: 50%;
            border: 2px solid var(--bg-secondary, #252526);
            box-shadow: 0 0 8px #00d2ff;
            animation: pulseBadge 1.5s infinite;
          }

          /* Modal Styling */
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 1000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }

          .modal-overlay.active {
            display: flex;
          }

          .modal-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            width: 100%;
            max-width: 600px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            max-height: 90vh;
          }

          .modal-header {
            padding: 16px 22px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .modal-header h3 {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .modal-close-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 18px;
            cursor: pointer;
          }

          .modal-close-btn:hover {
            color: var(--text-primary);
          }

          .modal-body {
            padding: 20px 22px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 18px;
          }

          .config-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .config-group label {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .config-group .hint {
            font-size: 11px;
            color: var(--text-secondary);
          }

          .config-input {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--input-fg);
            padding: 8px 12px;
            border-radius: var(--radius-md);
            font-size: 13px;
            outline: none;
          }

          .config-input:focus {
            border-color: var(--border-hover);
          }

          .input-with-btn {
            display: flex;
            gap: 8px;
          }

          .config-checkbox-row {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
          }

          .config-checkbox-row input {
            cursor: pointer;
            width: 16px;
            height: 16px;
          }

          .modal-footer {
            padding: 14px 22px;
            border-top: 1px solid var(--border-color);
            background: var(--bg-tertiary);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
        </style>
      </head>
      <body data-workspace-path="${MarkdownRenderer.escapeHtml(activeSession?.workspacePath || '')}">
        <header class="dashboard-header">
          <div class="header-left-section">
            <button class="action-btn icon-only ${isSidebarCollapsed ? 'active' : ''}" onclick="toggleSidebar()" id="sidebarToggleBtn" title="Toggle Sidebar (Collapse / Expand Left Panel)">
              <i class="codicon codicon-layout-sidebar-left"></i>
            </button>
            <button class="action-btn icon-only latest-chat-btn" onclick="loadLatestChat()" id="btnLoadLatestChat" title="Jump to Latest Chat (Chuyển nhanh đến phiên chat mới nhất)">
              <span class="lightning-icon">⚡</span>
            </button>
            <div class="app-branding">
              <span class="app-title-text">
                <svg class="app-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="10" r="1.5" fill="currentColor"/>
                  <circle cx="8" cy="10" r="1.5" fill="currentColor"/>
                  <circle cx="16" cy="10" r="1.5" fill="currentColor"/>
                  <path d="M12 3v3" stroke-dasharray="1 1"/>
                </svg>
                Brain Hub for Antigravity
              </span>
              <span class="app-version-text" title="Installed Extension Version">v${extensionVersion}</span>
              <span class="branding-badge" title="Total conversation sessions loaded: ${allSessions.length}">💬 ${allSessions.length}</span>
            </div>
          </div>
          <div class="dashboard-top-actions">
            <button class="action-btn primary icon-only" id="topSyncGitBtn" onclick="syncGit()" title="${syncBtnTitle}">
              <i class="codicon codicon-github"></i>
            </button>
            <button class="action-btn icon-only" onclick="openConfigModal()" title="Open Brain Hub Settings">
              <i class="codicon codicon-gear"></i>
            </button>
            <button class="action-btn icon-only" onclick="refreshDashboard()" title="Scan and refresh all chat sessions from disk">
              <i class="codicon codicon-refresh"></i>
            </button>
            <button class="action-btn icon-only" onclick="archiveProjectDocs()" title="Archive project plans, walkthroughs, artifacts, and session logs into .docs/ directory">
              <i class="codicon codicon-book"></i>
            </button>
            <button class="action-btn icon-only" onclick="cleanEmptyChats()" title="Scan and clean up all empty chat session directories (0 messages)">
              <span style="font-size:13px;line-height:1;">🧹</span>
            </button>
          </div>
        </header>

        <div class="dashboard-body ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}">
          <div class="dashboard-sidebar">
            <div class="sidebar-filter-box">
              <div class="sidebar-filter-row">
                <div class="search-input-wrapper">
                  <i class="codicon codicon-search search-icon"></i>
                  <input type="text" id="dashboardSearch" class="search-input" placeholder="${searchPlaceholder}" oninput="onSearchInputChanged('dashboardSearch')" onfocus="this.select()" title="Search chat sessions by title, ID, prompt, folder or machine">
                  <span id="dashboardSearchCount" class="search-match-count"></span>
                  <button class="clear-search-btn" id="clearDashboardSearch" onclick="clearSearchInput('dashboardSearch')" title="Clear search">✕</button>
                </div>
                <div class="sidebar-filter-actions">
                  <button class="action-btn icon-only sidebar-action-btn ${isWsFiltered ? 'active' : ''}" id="btnSidebarWsFilter" onclick="toggleSidebarWorkspaceFilter()" title="${wsFilterTooltip}">
                    <i class="codicon codicon-filter"></i>
                  </button>
                  <button class="action-btn icon-only sidebar-action-btn ${isHideEmpty ? 'active' : ''}" id="btnSidebarHideEmpty" onclick="toggleSidebarHideEmpty()" title="Toggle Hide Empty Chats (Hide 0-message sessions)">
                    <i class="codicon codicon-eye-closed"></i>
                  </button>
                </div>
              </div>
            </div>
            <div class="session-nav-list" id="sessionList">
              ${sessionListHtml}
            </div>
          </div>

          <div class="dashboard-reader" id="dashboardReader">
            ${chatViewHtml}
          </div>
        </div>

        <!-- Visual Settings Modal -->
        <div class="modal-overlay" id="configModal" onclick="if(event.target === this) closeConfigModal()">
          <div class="modal-card">
            <div class="modal-header">
              <h3>⚙️ Brain Hub Settings</h3>
              <button class="modal-close-btn" onclick="closeConfigModal()" title="Close Settings">✖</button>
            </div>
            <div class="modal-body">
              <div class="config-group">
                <label>💻 Computer Label (Machine Name)</label>
                <input type="text" id="cfgMachineName" class="config-input" value="${MarkdownRenderer.escapeHtml(cfg.machineName)}" placeholder="e.g. Home-Desktop, Work-Laptop (Defaults to system hostname)">
                <span class="hint">Display label assigned to chat sessions generated on this machine.</span>
              </div>

              <div class="config-group">
                <label>🗂️ Sort Sessions List (Sort Sessions By)</label>
                <select id="cfgSessionSortBy" class="config-input">
                  <option value="lastModified" ${cfg.sessionSortBy === 'lastModified' ? 'selected' : ''}>By Last Message Time (Default)</option>
                  <option value="createdAt" ${cfg.sessionSortBy === 'createdAt' ? 'selected' : ''}>By Session Creation Time</option>
                </select>
                <span class="hint">Ordering criteria for chat sessions in the left navigation sidebar.</span>
              </div>

              <div class="config-group">
                <label>↕️ Message Sort Order (messageOrder)</label>
                <select id="cfgMessageOrder" class="config-input">
                  <option value="newestFirst" ${cfg.messageOrder === 'newestFirst' ? 'selected' : ''}>💬 Newest First (Recommended)</option>
                  <option value="oldestFirst" ${cfg.messageOrder === 'oldestFirst' ? 'selected' : ''}>💬 Oldest First</option>
                </select>
                <span class="hint">Display order of messages in the transcript reader.</span>
              </div>

              <div class="config-group">
                <label>🛠️ Default Tools State (defaultToolsState)</label>
                <select id="cfgDefaultToolsState" class="config-input">
                  <option value="collapsed" ${cfg.defaultToolsState === 'collapsed' ? 'selected' : ''}>🛠️ Collapsed (Recommended)</option>
                  <option value="expanded" ${cfg.defaultToolsState === 'expanded' ? 'selected' : ''}>🛠️ Expanded</option>
                </select>
                <span class="hint">Default expand/collapse state for tool call parameters and outputs.</span>
              </div>

              <div class="config-group">
                <label>⚡ Default AI Steps State (defaultAiStepsState)</label>
                <select id="cfgDefaultAiStepsState" class="config-input">
                  <option value="collapsed" ${cfg.defaultAiStepsState === 'collapsed' ? 'selected' : ''}>⚡ Collapsed (Recommended)</option>
                  <option value="expanded" ${cfg.defaultAiStepsState === 'expanded' ? 'selected' : ''}>⚡ Expanded</option>
                </select>
                <span class="hint">Default expand/collapse state for autonomous AI step groups.</span>
              </div>

              <div class="config-group">
                <label>☁️ GitHub Remote URL (Backup & Sync)</label>
                <input type="text" id="cfgGitRemote" class="config-input" value="${MarkdownRenderer.escapeHtml(cfg.gitRemoteUrl || '')}" placeholder="https://github.com/username/antigravity-brain-backup.git">
                <span class="hint">Private GitHub repository URL for backing up and synchronizing chat history across machines.</span>
              </div>

              <div class="config-group">
                <label>⏱️ Auto-Sync Interval (autoSyncIntervalMinutes)</label>
                <select id="cfgSyncInterval" class="config-input">
                  <option value="15" ${cfg.autoSyncIntervalMinutes === 15 ? 'selected' : ''}>Every 15 minutes</option>
                  <option value="30" ${cfg.autoSyncIntervalMinutes === 30 ? 'selected' : ''}>Every 30 minutes (Recommended)</option>
                  <option value="60" ${cfg.autoSyncIntervalMinutes === 60 ? 'selected' : ''}>Every 1 hour</option>
                  <option value="120" ${cfg.autoSyncIntervalMinutes === 120 ? 'selected' : ''}>Every 2 hours</option>
                  <option value="0" ${cfg.autoSyncIntervalMinutes === 0 ? 'selected' : ''}>Disable automatic periodic sync</option>
                </select>
                <span class="hint">Background interval for automatic Git commit, pull & push.</span>
              </div>

              <div class="config-group">
                <label class="config-checkbox-row">
                  <input type="checkbox" id="cfgAutoSyncStartup" ${cfg.autoSyncOnStartup ? 'checked' : ''}>
                  <span>🚀 Automatically sync from GitHub when VS Code starts up</span>
                </label>
              </div>

              <div class="config-group">
                <label class="config-checkbox-row">
                  <input type="checkbox" id="cfgFilterWorkspace" ${cfg.filterWorkspaceByDefault ? 'checked' : ''}>
                  <span>📁 Filter chat history by active workspace folder by default</span>
                </label>
              </div>

              <div class="config-group">
                <label class="config-checkbox-row">
                  <input type="checkbox" id="cfgHideEmptySessions" ${cfg.hideEmptySessions ? 'checked' : ''}>
                  <span>🧹 Automatically hide empty chat sessions (0 messages & no artifacts)</span>
                </label>
              </div>

              <div class="config-group">
                <label class="config-checkbox-row">
                  <input type="checkbox" id="cfgAutoReloadLive" ${cfg.autoReloadOnLiveChat ? 'checked' : ''}>
                  <span>🟢 Automatically reload and stream updates when active chat has new messages</span>
                </label>
              </div>

              <div class="config-group">
                <label>📂 Custom Brain Directory Path (brainPath)</label>
                <div class="input-with-btn">
                  <input type="text" id="cfgBrainPath" class="config-input" value="${MarkdownRenderer.escapeHtml(cfg.brainPath)}" placeholder="${MarkdownRenderer.escapeHtml(cfg.defaultBrainDir)}">
                  <button class="action-btn" onclick="browseBrainFolder()" title="Browse folder from file system">Browse...</button>
                </div>
                <span class="hint">Default location: <code>${MarkdownRenderer.escapeHtml(cfg.defaultBrainDir)}</code></span>
              </div>
            </div>
            <div class="modal-footer">
              <button class="action-btn" onclick="openVsCodeNativeSettings()" title="Open extension settings in VS Code native editor">Open Advanced Settings</button>
              <div style="display:flex; gap:8px;">
                <button class="action-btn" onclick="closeConfigModal()">Cancel</button>
                <button class="action-btn primary" onclick="saveConfiguration()">💾 Save Settings</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Fullscreen Media Lightbox Modal -->
        <div class="media-modal-overlay" id="mediaModal" onclick="if(event.target === this) closeMediaModal()">
          <div class="media-modal-content">
            <button class="media-modal-close-btn" onclick="closeMediaModal()" title="Close full view">✕</button>
            <img id="mediaModalImg" class="media-modal-img" src="" alt="Enlarged Image / Attachment">
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          let isWorkspaceFilterActive = ${isWsFiltered ? 'true' : 'false'};
          let isHideEmptyActive = ${isHideEmpty ? 'true' : 'false'};
          const currentWorkspacePaths = ${JSON.stringify(currentWorkspacePaths)};
          const currentWorkspaceNames = ${JSON.stringify(currentWorkspaceNames)};
          let currentLoadedSessionId = '${MarkdownRenderer.escapeHtml(activeSession?.id || '')}';

          function matchesWorkspaceFilter(item) {
            if (!isWorkspaceFilterActive || currentWorkspacePaths.length === 0) return true;
            const itemWsPath = item.getAttribute('data-ws-path') || '';
            const itemWsName = item.getAttribute('data-ws-name') || '';
            for (let i = 0; i < currentWorkspacePaths.length; i++) {
              const cPath = currentWorkspacePaths[i];
              if (itemWsPath && (itemWsPath.includes(cPath) || cPath.includes(itemWsPath))) return true;
            }
            for (let i = 0; i < currentWorkspaceNames.length; i++) {
              const cName = currentWorkspaceNames[i];
              if (itemWsName && itemWsName === cName) return true;
            }
            return false;
          }

          function matchesHideEmptyFilter(item) {
            if (!isHideEmptyActive) return true;
            return item.getAttribute('data-empty') !== 'true';
          }

          function toggleSidebarWorkspaceFilter() {
            isWorkspaceFilterActive = !isWorkspaceFilterActive;
            const btn = document.getElementById('btnSidebarWsFilter');
            if (btn) btn.classList.toggle('active', isWorkspaceFilterActive);
            filterSessions();
            vscode.postMessage({ command: 'toggleWorkspaceFilter' });
          }

          function toggleSidebarHideEmpty() {
            isHideEmptyActive = !isHideEmptyActive;
            const btn = document.getElementById('btnSidebarHideEmpty');
            if (btn) btn.classList.toggle('active', isHideEmptyActive);
            filterSessions();
            vscode.postMessage({ command: 'toggleHideEmptySessions' });
          }

          window.toggleSidebarWorkspaceFilter = toggleSidebarWorkspaceFilter;
          window.toggleSidebarHideEmpty = toggleSidebarHideEmpty;

          function openMediaModal(src) {
            const modal = document.getElementById('mediaModal');
            const img = document.getElementById('mediaModalImg');
            if (modal && img) {
              img.src = src;
              modal.classList.add('visible');
            }
          }

          function closeMediaModal() {
            const modal = document.getElementById('mediaModal');
            if (modal) {
              modal.classList.remove('visible');
            }
          }

          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.keyCode === 27) {
              closeMediaModal();
              closeConfigModal();
            } else if (e.key === 'Enter') {
              const target = e.target;
              if (target && target.id === 'transcriptSearch') {
                e.preventDefault();
                navigateHighlights(e.shiftKey ? -1 : 1);
              } else if (target && target.id === 'dashboardSearch') {
                e.preventDefault();
                const q = target.value.toLowerCase().trim();
                if (q.length >= 2) {
                  if (deepSearchDebounceTimer) {
                    clearTimeout(deepSearchDebounceTimer);
                    deepSearchDebounceTimer = null;
                  }
                  triggerDeepSearch(q);
                }
              }
            }
          });

          function loadLatestChat() {
            const btn = document.getElementById('btnLoadLatestChat');
            if (btn) {
              btn.classList.add('flash');
              setTimeout(() => btn.classList.remove('flash'), 800);
            }
            vscode.postMessage({ command: 'selectLatestSession' });
          }

          function selectSession(id) {
            document.querySelectorAll('.session-nav-item').forEach(el => {
              if (el.getAttribute('data-id') === id) {
                el.classList.add('selected');
                const parentGroup = el.closest('details.session-time-group');
                if (parentGroup && !parentGroup.open) {
                  parentGroup.open = true;
                }
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              } else {
                el.classList.remove('selected');
              }
            });
            vscode.postMessage({ command: 'selectSession', sessionId: id });
          }

          function toggleThreadMode() { vscode.postMessage({ command: 'toggleThreadMode' }); }
          function copyResumePrompt() { vscode.postMessage({ command: 'copyResumePrompt' }); }
          function copySessionId() { vscode.postMessage({ command: 'copySessionId' }); }
          function exportMarkdown() { vscode.postMessage({ command: 'exportMarkdown' }); }
          function openFolder() { vscode.postMessage({ command: 'openFolder' }); }
          function cleanEmptyChats() { vscode.postMessage({ command: 'cleanEmptySessions' }); }
          function archiveProjectDocs() { vscode.postMessage({ command: 'archiveProjectDocs' }); }
          function deleteCurrentSession() { vscode.postMessage({ command: 'deleteSession' }); }
          function syncGit() { vscode.postMessage({ command: 'syncGit' }); }
          function refreshDashboard() { vscode.postMessage({ command: 'refresh' }); }
          function reloadCurrentChat() { vscode.postMessage({ command: 'reloadChat' }); }
          function openFile(encodedPath) { vscode.postMessage({ command: 'openFile', filePath: decodeURI(encodedPath) }); }

          function toggleOrder() {
            vscode.postMessage({ command: 'toggleMessageOrder' });
          }

          let toolsExpanded = ${isToolsExpanded};
          function toggleAllTools() {
            toolsExpanded = !toolsExpanded;
            const detailsList = document.querySelectorAll('#chatTimeline details.chat-details');
            detailsList.forEach(d => { d.open = toolsExpanded; });
            const btn = document.getElementById('toolsToggleBtn');
            if (btn) {
              btn.title = 'Tool Call Details: ' + (toolsExpanded ? 'Expanded (Click to collapse)' : 'Collapsed (Click to expand)');
              btn.classList.toggle('active', toolsExpanded);
            }
          }

          let aiStepsExpanded = ${isAiStepsExpanded};
          function toggleInternalSteps() {
            aiStepsExpanded = !aiStepsExpanded;
            const groups = document.querySelectorAll('details.autonomous-group-details, details.internal-step-details');
            groups.forEach(d => { d.open = aiStepsExpanded; });
            const btn = document.getElementById('internalToggleBtn');
            if (btn) {
              btn.title = 'Autonomous AI Execution Steps: ' + (aiStepsExpanded ? 'Expanded (Click to collapse)' : 'Collapsed (Click to expand)');
              btn.classList.toggle('active', aiStepsExpanded);
            }
          }

          function openConfigModal() {
            document.getElementById('configModal').classList.add('active');
          }

          function closeConfigModal() {
            document.getElementById('configModal').classList.remove('active');
          }

          function browseBrainFolder() {
            vscode.postMessage({ command: 'browseBrainFolder' });
          }

          function openVsCodeNativeSettings() {
            closeConfigModal();
            vscode.postMessage({ command: 'openVsCodeSettings' });
          }

          function saveConfiguration() {
            const machineName = document.getElementById('cfgMachineName').value;
            const sessionSortBy = document.getElementById('cfgSessionSortBy').value;
            const messageOrder = document.getElementById('cfgMessageOrder').value;
            const defaultToolsState = document.getElementById('cfgDefaultToolsState').value;
            const defaultAiStepsState = document.getElementById('cfgDefaultAiStepsState').value;
            const gitRemoteUrl = document.getElementById('cfgGitRemote').value;
            const autoSyncIntervalMinutes = document.getElementById('cfgSyncInterval').value;
            const autoSyncOnStartup = document.getElementById('cfgAutoSyncStartup').checked;
            const filterWorkspaceByDefault = document.getElementById('cfgFilterWorkspace').checked;
            const hideEmptySessions = document.getElementById('cfgHideEmptySessions').checked;
            const autoReloadOnLiveChat = document.getElementById('cfgAutoReloadLive').checked;
            const brainPath = document.getElementById('cfgBrainPath').value;

            vscode.postMessage({
              command: 'saveSettings',
              settings: {
                machineName,
                sessionSortBy,
                messageOrder,
                defaultToolsState,
                defaultAiStepsState,
                gitRemoteUrl,
                autoSyncIntervalMinutes,
                autoSyncOnStartup,
                filterWorkspaceByDefault,
                hideEmptySessions,
                autoReloadOnLiveChat,
                brainPath
              }
            });

            closeConfigModal();
          }

          window.openMediaModal = openMediaModal;
          window.closeMediaModal = closeMediaModal;
          window.loadLatestChat = loadLatestChat;
          window.selectSession = selectSession;
          window.toggleThreadMode = toggleThreadMode;
          window.copyResumePrompt = copyResumePrompt;
          window.copySessionId = copySessionId;
          window.exportMarkdown = exportMarkdown;
          window.openFolder = openFolder;
          window.cleanEmptyChats = cleanEmptyChats;
          window.archiveProjectDocs = archiveProjectDocs;
          window.deleteCurrentSession = deleteCurrentSession;
          window.syncGit = syncGit;
          window.refreshDashboard = refreshDashboard;
          window.reloadCurrentChat = reloadCurrentChat;
          window.openFile = openFile;
          window.toggleOrder = toggleOrder;
          window.toggleAllTools = toggleAllTools;
          window.toggleInternalSteps = toggleInternalSteps;
          window.openConfigModal = openConfigModal;
          window.closeConfigModal = closeConfigModal;
          window.browseBrainFolder = browseBrainFolder;
          window.openVsCodeNativeSettings = openVsCodeNativeSettings;
          window.saveConfiguration = saveConfiguration;

          let pendingDashboardLiveUpdate = null;
          let scrollReaderIdleTimer = null;

          function scrollToEdge(edge) {
            const reader = document.getElementById('dashboardReader');
            if (!reader) return;
            const isNewestFirst = (document.getElementById('cfgMessageOrder') ? document.getElementById('cfgMessageOrder').value : 'newestFirst') === 'newestFirst';

            if (edge === 'top') {
              reader.scrollTo({ top: 0, behavior: 'smooth' });
              const btnTop = document.getElementById('btnScrollTop');
              if (btnTop) btnTop.classList.remove('has-new-messages');
              if (isNewestFirst && pendingDashboardLiveUpdate) {
                const msgToApply = pendingDashboardLiveUpdate;
                pendingDashboardLiveUpdate = null;
                setTimeout(() => {
                  applyDashboardReaderUpdate(msgToApply, isNewestFirst, 'top');
                  if (btnTop) btnTop.classList.remove('has-new-messages');
                }, 80);
              }
            } else {
              reader.scrollTo({ top: reader.scrollHeight, behavior: 'smooth' });
              const btnBottom = document.getElementById('btnScrollBottom');
              if (btnBottom) btnBottom.classList.remove('has-new-messages');
              if (!isNewestFirst && pendingDashboardLiveUpdate) {
                const msgToApply = pendingDashboardLiveUpdate;
                pendingDashboardLiveUpdate = null;
                setTimeout(() => {
                  applyDashboardReaderUpdate(msgToApply, isNewestFirst, 'bottom');
                  if (btnBottom) btnBottom.classList.remove('has-new-messages');
                }, 80);
              }
            }
          }

          function triggerLiveUpdateFX(isNewestFirst) {
            const reader = document.getElementById('dashboardReader');
            if (!reader) return;

            // 1. Header Live Badge pulse
            const liveBadge = reader.querySelector('.live-badge');
            if (liveBadge) {
              liveBadge.classList.add('live-badge-active');
              setTimeout(() => {
                liveBadge.classList.remove('live-badge-active');
              }, 2800);
            }

            // 2. Find target latest message element (top-level only) & apply subtle highlight
            const allElements = Array.from(reader.querySelectorAll('.message-card, .autonomous-group-details, .internal-step-details, .checkpoint-banner, .subagent-banner, .system-event-banner'));
            const topLevelElements = allElements.filter(el => !el.closest('.autonomous-group-body'));

            if (topLevelElements.length > 0) {
              const targetEl = isNewestFirst ? topLevelElements[0] : topLevelElements[topLevelElements.length - 1];
              if (targetEl) {
                targetEl.classList.add('live-updated-highlight');

                setTimeout(() => {
                  targetEl.classList.remove('live-updated-highlight');
                }, 3200);
              }
            }

            // 3. Highlight relevant floating scroll button with pulse indicator
            const targetBtn = document.getElementById(isNewestFirst ? 'btnScrollTop' : 'btnScrollBottom');
            if (targetBtn) {
              targetBtn.classList.add('has-new-messages');
            }
          }

          function applyDashboardReaderUpdate(message, isNewestFirst, forceScrollEdge) {
            const reader = document.getElementById('dashboardReader');
            if (!reader || !message.chatHtml) return;
            const isLive = !!message.isLiveUpdate;

            const isDifferentSession = (currentLoadedSessionId && message.sessionId && currentLoadedSessionId !== message.sessionId);
            currentLoadedSessionId = message.sessionId || currentLoadedSessionId;

            const prevScrollTop = reader.scrollTop;
            const prevScrollHeight = reader.scrollHeight;

            const openSteps = new Set();
            reader.querySelectorAll('details[open]').forEach(el => {
              const k = el.getAttribute('data-step') || el.getAttribute('data-group-range');
              if (k) openSteps.add(k);
            });

            const prevSearchInput = document.getElementById('transcriptSearch');
            const prevSearchQuery = prevSearchInput ? prevSearchInput.value : '';

            reader.innerHTML = message.chatHtml;

            const newSearchInput = document.getElementById('transcriptSearch');
            if (newSearchInput && prevSearchQuery) {
              newSearchInput.value = prevSearchQuery;
            }

            if (openSteps.size > 0) {
              reader.querySelectorAll('details').forEach(el => {
                const k = el.getAttribute('data-step') || el.getAttribute('data-group-range');
                if (k && openSteps.has(k)) {
                  el.open = true;
                }
              });
            }

            document.querySelectorAll('.session-nav-item').forEach(el => {
              if (el.getAttribute('data-id') === message.sessionId) {
                el.classList.add('selected');
                const parentGroup = el.closest('details.session-time-group');
                if (parentGroup && !parentGroup.open) {
                  parentGroup.open = true;
                }
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              } else {
                el.classList.remove('selected');
              }
            });

            setTimeout(renderMermaidDiagrams, 80);
            setTimeout(initReaderScrollObserver, 100);
            onSearchInputChanged('transcriptSearch');

            const forceEdge = forceScrollEdge || message.forceScrollEdge;
            if (isDifferentSession || forceEdge === 'top') {
              reader.scrollTop = 0;
              const header = document.getElementById('readerHeader');
              if (header) header.classList.remove('scrolled');
              const btnTop = document.getElementById('btnScrollTop');
              const btnBottom = document.getElementById('btnScrollBottom');
              if (btnTop) btnTop.classList.remove('has-new-messages');
              if (btnBottom) btnBottom.classList.remove('has-new-messages');
            } else if (forceEdge === 'bottom') {
              reader.scrollTop = reader.scrollHeight;
              const btnTop = document.getElementById('btnScrollTop');
              const btnBottom = document.getElementById('btnScrollBottom');
              if (btnTop) btnTop.classList.remove('has-new-messages');
              if (btnBottom) btnBottom.classList.remove('has-new-messages');
            } else {
              // Same session: PRESERVE EXACT SCROLL POSITION!
              if (isNewestFirst) {
                if (prevScrollTop <= 30) {
                  reader.scrollTop = 0;
                } else {
                  const heightDelta = reader.scrollHeight - prevScrollHeight;
                  reader.scrollTop = prevScrollTop + (heightDelta > 0 ? heightDelta : 0);
                }
              } else {
                const wasAtBottom = (prevScrollTop + reader.clientHeight >= prevScrollHeight - 35);
                if (wasAtBottom) {
                  reader.scrollTop = reader.scrollHeight;
                } else {
                  reader.scrollTop = prevScrollTop;
                }
              }

              if (isLive) {
                triggerLiveUpdateFX(isNewestFirst);
              }
            }
          }

          window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'openSettingsModal') {
              openConfigModal();
            } else if (message.command === 'focusSearchInput') {
              const bodyEl = document.querySelector('.dashboard-body');
              if (bodyEl && bodyEl.classList.contains('sidebar-collapsed')) {
                toggleSidebar();
              }
              const el = document.getElementById('dashboardSearch');
              if (el) {
                el.focus();
                el.select();
              }
            } else if (message.command === 'setFiltersState') {
              if (typeof message.isWorkspaceFiltered === 'boolean') {
                isWorkspaceFilterActive = message.isWorkspaceFiltered;
                const btn = document.getElementById('btnSidebarWsFilter');
                if (btn) btn.classList.toggle('active', isWorkspaceFilterActive);
              }
              if (typeof message.hideEmptySessions === 'boolean') {
                isHideEmptyActive = message.hideEmptySessions;
                const btn = document.getElementById('btnSidebarHideEmpty');
                if (btn) btn.classList.toggle('active', isHideEmptyActive);
              }
              filterSessions();
            } else if (message.command === 'updateGitRemoteUrl') {
              const el = document.getElementById('cfgGitRemoteUrl');
              if (el && message.remoteUrl) {
                el.value = message.remoteUrl;
              }
            } else if (message.command === 'setBrainPath') {
              const el = document.getElementById('cfgBrainPath');
              if (el && message.path) {
                el.value = message.path;
              }
            } else if (message.command === 'updateSessionList') {
              const listEl = document.getElementById('sessionList');
              if (listEl && message.sessionListHtml) {
                const prevScroll = listEl.scrollTop;
                // Preserve manually opened/closed state of time groups
                const openGroups = new Set();
                listEl.querySelectorAll('details.session-time-group[open]').forEach(g => {
                  const k = g.getAttribute('data-group');
                  if (k) openGroups.add(k);
                });
                const closedGroups = new Set();
                listEl.querySelectorAll('details.session-time-group:not([open])').forEach(g => {
                  const k = g.getAttribute('data-group');
                  if (k) closedGroups.add(k);
                });

                listEl.innerHTML = message.sessionListHtml;

                if (openGroups.size > 0 || closedGroups.size > 0) {
                  listEl.querySelectorAll('details.session-time-group').forEach(g => {
                    const k = g.getAttribute('data-group');
                    if (k) {
                      if (openGroups.has(k)) g.open = true;
                      else if (closedGroups.has(k)) g.open = false;
                    }
                  });
                }
                const selectedItem = listEl.querySelector('.session-nav-item.selected');
                if (selectedItem) {
                  const parentGroup = selectedItem.closest('details.session-time-group');
                  if (parentGroup) parentGroup.open = true;
                }

                listEl.scrollTop = prevScroll;
                updateSearchPlaceholder();
                filterSessions();
              }
              const brandingBadge = document.querySelector('.branding-badge');
              if (brandingBadge && message.totalSessions !== undefined) {
                brandingBadge.textContent = '💬 ' + message.totalSessions;
                brandingBadge.title = 'Total conversation sessions loaded: ' + message.totalSessions;
              }
            } else if (message.command === 'updateReader') {
              const reader = document.getElementById('dashboardReader');
              if (reader && message.chatHtml) {
                const isLive = !!message.isLiveUpdate;
                const isNewestFirst = (message.messageOrder || (document.getElementById('cfgMessageOrder') ? document.getElementById('cfgMessageOrder').value : '') || 'newestFirst') === 'newestFirst';

                if (isLive) {
                  const searchInput = document.getElementById('transcriptSearch');
                  const isSearching = !!(searchInput && (searchInput.value.trim().length > 0 || document.activeElement === searchInput));

                  const isStrictlyAtActiveEdge = !isSearching && (isNewestFirst
                    ? (reader.scrollTop <= 30)
                    : (reader.scrollTop + reader.clientHeight >= reader.scrollHeight - 30));

                  if (!isStrictlyAtActiveEdge) {
                    pendingDashboardLiveUpdate = message;
                    const targetBtn = document.getElementById(isNewestFirst ? 'btnScrollTop' : 'btnScrollBottom');
                    if (targetBtn) {
                      targetBtn.classList.add('has-new-messages');
                    }
                    return;
                  }
                }

                pendingDashboardLiveUpdate = null;
                applyDashboardReaderUpdate(message, isNewestFirst, message.forceScrollEdge);
              }
            } else if (message.command === 'deepSearchResults') {
              applyDeepSearchResults(message.query, message.matchedIds || []);
            }
          });

          function toggleSidebar() {
            const bodyEl = document.querySelector('.dashboard-body');
            const btn = document.getElementById('sidebarToggleBtn');
            if (!bodyEl) return;
            const isCollapsed = bodyEl.classList.toggle('sidebar-collapsed');
            if (btn) {
              btn.classList.toggle('active', isCollapsed);
            }
            vscode.postMessage({ command: 'setSidebarCollapsed', collapsed: isCollapsed });
          }
          window.toggleSidebar = toggleSidebar;

          let currentHighlightIndex = -1;

          function clearSearchHighlights() {
            currentHighlightIndex = -1;
            const container = document.getElementById('chatTimeline');
            if (!container) return;
            const marks = container.querySelectorAll('mark.search-highlight');
            marks.forEach(mark => {
              const parent = mark.parentNode;
              if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
              }
            });
          }

          function highlightTextInElement(element, query) {
            if (!query || !element) return 0;
            const lowerQuery = query.toLowerCase();
            const escaped = query.replace(/[.*+?^\\u0024{}()|[\\]\\\\]/g, '\\\\$&');
            let regex;
            try {
              regex = new RegExp(escaped, 'gi');
            } catch (e) {
              return 0;
            }

            const textNodes = [];
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
              acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const tag = parent.tagName.toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path' || tag === 'mark' || tag === 'button') {
                  return NodeFilter.FILTER_REJECT;
                }
                if (node.nodeValue.toLowerCase().includes(lowerQuery)) {
                  return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
              }
            });

            while (walker.nextNode()) {
              textNodes.push(walker.currentNode);
            }

            let matchCount = 0;
            textNodes.forEach(node => {
              const parent = node.parentNode;
              if (!parent) return;

              const text = node.nodeValue;
              const fragment = document.createDocumentFragment();
              let lastIdx = 0;
              let match;

              regex.lastIndex = 0;
              while ((match = regex.exec(text)) !== null) {
                matchCount++;
                if (match.index > lastIdx) {
                  fragment.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));
                }
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.textContent = match[0];
                fragment.appendChild(mark);
                lastIdx = regex.lastIndex;
              }

              if (lastIdx < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
              }

              parent.replaceChild(fragment, node);
            });

            return matchCount;
          }

          function navigateHighlights(direction = 1) {
            const container = document.getElementById('chatTimeline');
            if (!container) return;
            const marks = container.querySelectorAll('mark.search-highlight');
            if (marks.length === 0) return;

            marks.forEach(m => m.classList.remove('current-highlight'));

            currentHighlightIndex += direction;
            if (currentHighlightIndex >= marks.length) currentHighlightIndex = 0;
            if (currentHighlightIndex < 0) currentHighlightIndex = marks.length - 1;

            const current = marks[currentHighlightIndex];
            current.classList.add('current-highlight');
            current.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const badge = document.getElementById('transcriptSearchCount');
            if (badge) {
              badge.textContent = (currentHighlightIndex + 1) + '/' + marks.length;
            }
          }

          function onSearchInputChanged(inputId) {
            const input = document.getElementById(inputId);
            const clearBtnId = 'clear' + inputId.charAt(0).toUpperCase() + inputId.slice(1);
            const clearBtn = document.getElementById(clearBtnId);
            if (clearBtn) {
              if (input && input.value.trim().length > 0) {
                clearBtn.classList.add('visible');
              } else {
                clearBtn.classList.remove('visible');
              }
            }
            if (inputId === 'dashboardSearch') {
              filterSessions();
            } else if (inputId === 'transcriptSearch') {
              filterTranscriptMessages();
            }
          }

          let deepSearchDebounceTimer = null;
          let currentDeepSearchQuery = '';
          let currentDeepMatchedIds = new Set();

          function triggerDeepSearch(query) {
            if (!query || query.length < 2) return;
            currentDeepSearchQuery = query;
            vscode.postMessage({ command: 'deepSearchSessions', query: query });
          }

          function applyDeepSearchResults(query, matchedIds) {
            const input = document.getElementById('dashboardSearch');
            const currentQuery = (input ? input.value : '').toLowerCase().trim();
            if (!currentQuery || query.toLowerCase().trim() !== currentQuery) {
              return;
            }

            currentDeepMatchedIds = new Set(matchedIds);
            const items = document.querySelectorAll('.session-nav-item');
            let visibleCount = 0;
            const totalCount = items.length;

            items.forEach(item => {
              const text = item.getAttribute('data-text') || '';
              const sid = (item.getAttribute('data-id') || '').toLowerCase();
              const rawId = item.getAttribute('data-id') || '';
              const isLocalMatch = text.includes(currentQuery) || sid.includes(currentQuery);
              const isDeepMatch = currentDeepMatchedIds.has(rawId);
              const matchesSearch = isLocalMatch || isDeepMatch;

              const matchesWs = matchesWorkspaceFilter(item);
              const matchesEmpty = matchesHideEmptyFilter(item);

              if (matchesSearch && matchesWs && matchesEmpty) {
                item.classList.remove('hidden');
                visibleCount++;
                if (isDeepMatch && !isLocalMatch) {
                  item.classList.add('deep-match');
                } else {
                  item.classList.remove('deep-match');
                }
              } else {
                item.classList.add('hidden');
                item.classList.remove('deep-match');
              }
            });

            const badge = document.getElementById('dashboardSearchCount');
            if (badge && (currentQuery || isWorkspaceFilterActive || isHideEmptyActive)) {
              badge.textContent = visibleCount + '/' + totalCount;
              badge.classList.add('visible');
              badge.classList.toggle('has-matches', visibleCount > 0);
              badge.classList.toggle('no-matches', visibleCount === 0);
            }
          }

          function clearSearchInput(inputId) {
            const input = document.getElementById(inputId);
            if (input) {
              input.value = '';
              input.focus();
            }
            if (inputId === 'dashboardSearch') {
              if (deepSearchDebounceTimer) {
                clearTimeout(deepSearchDebounceTimer);
                deepSearchDebounceTimer = null;
              }
              currentDeepSearchQuery = '';
              currentDeepMatchedIds.clear();
            }
            onSearchInputChanged(inputId);
          }

          function filterSessions() {
            const input = document.getElementById('dashboardSearch');
            const badge = document.getElementById('dashboardSearchCount');
            if (!input) return;
            const query = input.value.toLowerCase().trim();
            const items = document.querySelectorAll('.session-nav-item');
            let visibleCount = 0;
            const totalCount = items.length;

            if (query !== currentDeepSearchQuery) {
              currentDeepMatchedIds.clear();
            }

            items.forEach(item => {
              const text = item.getAttribute('data-text') || '';
              const sid = (item.getAttribute('data-id') || '').toLowerCase();
              const rawId = item.getAttribute('data-id') || '';
              const isLocalMatch = !query || text.includes(query) || sid.includes(query);
              const isDeepMatch = currentDeepMatchedIds.has(rawId);
              const matchesSearch = isLocalMatch || isDeepMatch;

              const matchesWs = matchesWorkspaceFilter(item);
              const matchesEmpty = matchesHideEmptyFilter(item);

              if (matchesSearch && matchesWs && matchesEmpty) {
                item.classList.remove('hidden');
                visibleCount++;
                if (isDeepMatch && !isLocalMatch) {
                  item.classList.add('deep-match');
                } else {
                  item.classList.remove('deep-match');
                }
              } else {
                item.classList.add('hidden');
                item.classList.remove('deep-match');
              }
            });

            // Update time groups visibility & badges
            const groups = document.querySelectorAll('.session-time-group');
            groups.forEach(group => {
              const visibleInGroup = group.querySelectorAll('.session-nav-item:not(.hidden)').length;
              const totalInGroup = group.querySelectorAll('.session-nav-item').length;
              const countBadge = group.querySelector('.session-group-count');

              if (visibleInGroup === 0) {
                group.classList.add('hidden');
              } else {
                group.classList.remove('hidden');
                if (query) {
                  group.open = true;
                }
                if (query || isWorkspaceFilterActive || isHideEmptyActive) {
                  if (countBadge) {
                    countBadge.textContent = visibleInGroup + '/' + totalInGroup;
                  }
                } else {
                  if (countBadge) {
                    countBadge.textContent = String(totalInGroup);
                  }
                }
              }
            });

            if (badge) {
              if (query || isWorkspaceFilterActive || isHideEmptyActive) {
                badge.textContent = visibleCount + '/' + totalCount;
                badge.classList.add('visible');
                badge.classList.toggle('has-matches', visibleCount > 0);
                badge.classList.toggle('no-matches', visibleCount === 0);
              } else {
                badge.classList.remove('visible', 'has-matches', 'no-matches');
                badge.textContent = '';
              }
            }

            if (deepSearchDebounceTimer) {
              clearTimeout(deepSearchDebounceTimer);
              deepSearchDebounceTimer = null;
            }
            if (query.length >= 2) {
              deepSearchDebounceTimer = setTimeout(() => {
                triggerDeepSearch(query);
              }, 300);
            }
          }

          function filterTranscriptMessages() {
            const input = document.getElementById('transcriptSearch');
            const badge = document.getElementById('transcriptSearchCount');
            if (!input) return;
            const rawQuery = input.value.trim();
            const lowerQuery = rawQuery.toLowerCase();
            const cards = document.querySelectorAll('#chatTimeline .message-card, #chatTimeline details.internal-step-details, #chatTimeline details.autonomous-group-details, .checkpoint-banner, .subagent-banner, .system-event-banner');

            clearSearchHighlights();

            if (!rawQuery) {
              cards.forEach(card => card.classList.remove('hidden'));
              if (badge) {
                badge.classList.remove('visible', 'has-matches', 'no-matches');
                badge.textContent = '';
              }
              return;
            }

            // Priority 1 & 2: Check for #<number> syntax
            const numMatch = rawQuery.match(/^#\\s*(\\d+)$/);
            if (numMatch) {
              const targetNum = parseInt(numMatch[1], 10);

              // Priority 1: User Msg #targetNum
              let userMatchCount = 0;
              cards.forEach(card => {
                if (card.classList.contains('user') && card.getAttribute('data-user-step') === String(targetNum)) {
                  card.classList.remove('hidden');
                  userMatchCount++;
                } else {
                  card.classList.add('hidden');
                }
              });

              if (userMatchCount > 0) {
                if (badge) {
                  badge.textContent = '1 msg';
                  badge.classList.add('visible', 'has-matches');
                  badge.classList.remove('no-matches');
                }
                const firstUser = document.querySelector('#chatTimeline .message-card.user:not(.hidden)');
                if (firstUser) firstUser.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
              }

              // Priority 2: Action / Step #targetNum
              let stepMatchCount = 0;
              cards.forEach(card => {
                const stepAttr = card.getAttribute('data-step') || '';
                let isMatched = (stepAttr === String(targetNum));
                if (!isMatched && stepAttr.includes('-')) {
                  const [start, end] = stepAttr.split('-').map(Number);
                  if (!isNaN(start) && !isNaN(end) && targetNum >= start && targetNum <= end) {
                    isMatched = true;
                  }
                }
                if (isMatched) {
                  card.classList.remove('hidden');
                  if (card.tagName.toLowerCase() === 'details') {
                    card.open = true;
                  }
                  stepMatchCount++;
                } else {
                  card.classList.add('hidden');
                }
              });

              if (stepMatchCount > 0) {
                if (badge) {
                  badge.textContent = stepMatchCount === 1 ? '1 step' : (stepMatchCount + ' steps');
                  badge.classList.add('visible', 'has-matches');
                  badge.classList.remove('no-matches');
                }
                const firstStep = document.querySelector('#chatTimeline .message-card:not(.hidden), #chatTimeline details:not(.hidden)');
                if (firstStep) firstStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
              }

              if (badge) {
                badge.textContent = '0 found';
                badge.classList.add('visible', 'no-matches');
                badge.classList.remove('has-matches');
              }
              return;
            }

            // Priority 3: General Text Search
            let totalMatches = 0;
            let matchedCards = 0;
            cards.forEach(card => {
              if (card.innerText.toLowerCase().includes(lowerQuery)) {
                card.classList.remove('hidden');
                if (card.tagName.toLowerCase() === 'details') {
                  card.open = true;
                }
                const count = highlightTextInElement(card, rawQuery);
                totalMatches += count;
                matchedCards++;
              } else {
                card.classList.add('hidden');
              }
            });

            // Ensure details are opened if highlight is inside
            document.querySelectorAll('#chatTimeline mark.search-highlight').forEach(m => {
              const det = m.closest('details');
              if (det) det.open = true;
            });

            if (badge) {
              badge.classList.add('visible');
              if (totalMatches > 0) {
                badge.textContent = totalMatches === 1 ? '1 match' : (totalMatches + ' matches');
                badge.classList.add('has-matches');
                badge.classList.remove('no-matches');
              } else {
                badge.textContent = '0 matches';
                badge.classList.add('no-matches');
                badge.classList.remove('has-matches');
              }
            }
          }

          // Hover on links to ensure full decoded path is shown in native tooltip
          document.addEventListener('mouseover', (e) => {
            try {
              const target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement ? e.target.parentElement : null);
              if (!target || typeof target.closest !== 'function') return;
              const link = target.closest('a.file-link, .mention-file, [data-filepath], [data-file-url], a.markdown-link');
              if (link) {
                let p = link.getAttribute('data-filepath') || link.getAttribute('data-file-url') || link.getAttribute('href');
                if (p && p !== '#' && p !== 'javascript:void(0)') {
                  try { p = decodeURIComponent(p); } catch (err) {}
                  p = p.replace(new RegExp('^file:[\\\\/]+', 'i'), '');
                  const ws = document.body.dataset.workspacePath || '';
                  const bs = String.fromCharCode(92);
                  const isAbs = p.includes(':') || p.startsWith('/') || p.startsWith(bs) || p.startsWith('http');
                  if (ws && !isAbs) {
                    const cleanWs = ws.replace(new RegExp('[\\\\/]+$'), '');
                    const cleanP = p.replace(new RegExp('^[\\\\/]+'), '');
                    const combined = (cleanWs + '/' + cleanP).split(bs).join('/');
                    link.title = combined;
                  } else if (!link.title || link.title.startsWith('Click to open') || link.title.startsWith('Mention:')) {
                    link.title = p;
                  }
                }
              }
            } catch (mouseErr) {
              console.error('Error in mouseover handler:', mouseErr);
            }
          });

          document.addEventListener('click', (e) => {
            try {
              const target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement ? e.target.parentElement : null);
              if (!target || typeof target.closest !== 'function') return;

              // Action buttons on Markdown links
              const richBtn = target.closest('.rich-preview-btn');
              if (richBtn) {
                e.preventDefault();
                e.stopPropagation();
                let p = richBtn.getAttribute('data-filepath');
                if (p) {
                  try { p = decodeURIComponent(p); } catch (err) {}
                  vscode.postMessage({ command: 'openRichPreview', filePath: p });
                }
                return;
              }

              const ideBtn = target.closest('.ide-preview-btn');
              if (ideBtn) {
                e.preventDefault();
                e.stopPropagation();
                let p = ideBtn.getAttribute('data-filepath');
                if (p) {
                  try { p = decodeURIComponent(p); } catch (err) {}
                  vscode.postMessage({ command: 'openIdePreview', filePath: p });
                }
                return;
              }

              // 1. File link or File Mention click -> open file in VS Code / Rich Preview for .md
              const fileLink = target.closest('a.file-link, .mention-file, [data-file-url], [data-filepath], a[href^="file://"]');
              if (fileLink) {
                e.preventDefault();
                e.stopPropagation();
                let filePath = fileLink.getAttribute('data-filepath') || fileLink.getAttribute('data-file-url');
                if (filePath) {
                  try {
                    filePath = decodeURIComponent(filePath);
                  } catch (err) {}
                } else {
                  filePath = fileLink.getAttribute('href');
                }
                if (filePath && filePath !== 'javascript:void(0)' && filePath !== '#') {
                  const isMd = fileLink.getAttribute('data-is-md') === 'true' || filePath.toLowerCase().endsWith('.md') || filePath.toLowerCase().endsWith('.markdown');
                  vscode.postMessage({
                    command: isMd ? 'openRichPreview' : 'openFile',
                    filePath: filePath
                  });
                }
                return;
              }

              // 2. Wrap toggle button
              const wrapBtn = target.closest('.toggle-wrap-btn');
              if (wrapBtn) {
                const codeContainer = wrapBtn.closest('.code-container');
                if (codeContainer) {
                  codeContainer.classList.toggle('no-wrap');
                  const isNoWrap = codeContainer.classList.contains('no-wrap');
                  wrapBtn.classList.toggle('active', !isNoWrap);
                  const span = wrapBtn.querySelector('span');
                  if (span) {
                    span.innerText = isNoWrap ? 'Unwrapped' : 'Wrap';
                  }
                }
                return;
              }

              // 3. Color chip click -> copy color code
              const colorChip = target.closest('.color-chip-badge');
              if (colorChip) {
                const color = colorChip.getAttribute('data-color') || colorChip.querySelector('.color-hex')?.textContent || '';
                if (color) {
                  navigator.clipboard.writeText(color).then(() => {
                    colorChip.classList.add('copied');
                    const origTitle = colorChip.getAttribute('title') || '';
                    colorChip.setAttribute('title', 'Copied ' + color + ' to clipboard!');
                    setTimeout(() => {
                      colorChip.classList.remove('copied');
                      colorChip.setAttribute('title', origTitle);
                    }, 1500);
                  });
                }
                return;
              }

              // 4. Copy user message prompt
              const copyMsgBtn = target.closest('.copy-msg-btn');
              if (copyMsgBtn) {
                const rawText = decodeURIComponent(copyMsgBtn.getAttribute('data-raw-msg') || '');
                navigator.clipboard.writeText(rawText).then(() => {
                  const span = copyMsgBtn.querySelector('span');
                  const origText = span ? span.innerText : '';
                  if (span) span.innerText = 'Copied!';
                  copyMsgBtn.classList.add('copied');
                  setTimeout(() => {
                    if (span) span.innerText = origText;
                    copyMsgBtn.classList.remove('copied');
                  }, 2000);
                });
                return;
              }

              // 5. Copy code block content
              const copyBtn = target.closest('.copy-code-btn');
              if (copyBtn) {
                const code = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
                navigator.clipboard.writeText(code).then(() => {
                  const span = copyBtn.querySelector('span');
                  const origText = span ? span.innerText : '';
                  if (span) span.innerText = 'Copied!';
                  copyBtn.style.color = 'var(--accent-green)';
                  setTimeout(() => {
                    if (span) span.innerText = origText;
                    copyBtn.style.color = '';
                  }, 2000);
                });
              }
            } catch (clickErr) {
              console.error('Error handling click event:', clickErr);
            }
          });

          function sanitizeMermaid(code) {
            if (!code) return '';
            const lines = code.split(/\\r?\\n/);
            const sanitizedLines = lines.map(line => {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('%%')) {
                return line;
              }

              if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|C4|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta)\\b/i.test(trimmed)) {
                return line;
              }

              if (/^(classDef|style|linkStyle|click|accTitle|accDescr|class|interpolate)\\b/i.test(trimmed)) {
                return line;
              }

              let processed = line;

              // 1. Sanitize Edge Labels: |label| -> replace < with &lt;, > with &gt;, & with &amp;
              processed = processed.replace(/\\|([^\\|\\r\\n]+)\\|/g, (match, label) => {
                const clean = label
                  .replace(/"/g, "'")
                  .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
                return '|' + clean + '|';
              });

              // 2. Subgraph titles
              if (/^\\s*subgraph\\s+/i.test(processed)) {
                processed = processed.replace(/^\\s*subgraph\\s+([^\\["\\r\\n]+)$/i, (m, title) => {
                  const t = title.trim();
                  if (/[ :()\\->&/<>\?\{\}\\[\\]]/.test(t) && !t.startsWith('"')) {
                    const clean = t.replace(/"/g, "'");
                    return 'subgraph "' + clean + '"';
                  }
                  return m;
                });
              }

              // 3. Hexagon node: id{{label}}
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\{\\{([^"\\r\\n\\{\\}]+)\\}\\}/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '{{\"' + clean + '\"}}';
              });

              // 4. Cylinder / Database node: id[(label)]
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[\\(([^"\\r\\n\\[\\]\\(\\)]+)\\)\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[(\"' + clean + '\")]';
              });

              // 5. Circle node: id((label))
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\(\\(([^"\\r\\n\\(\\)]+)\\)\\)/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '((\"' + clean + '\"))';
              });

              // 6. Asymmetric node: id>label] -> id>"label"]
              processed = processed.replace(/([^a-zA-Z0-9_\-]|^)([a-zA-Z0-9_]+)>([^"\\r\\n\\[\\]]+)\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '>\"' + clean + '\"]';
              });

              // 7. Parallelogram / Trapezoid: id[/label/] or id[\\label\\]
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[\\/([^"\\r\\n\\[\\]\\/]+)\\/\\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[/\"' + clean + '\"/]';
              });
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[\\\\([^"\\r\\n\\[\\]\\\\]+)\\\\\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[\\\\\"' + clean + '\"\\\\]';
              });

              // 8. Rhombus / Decision node: id{label}
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\{([^"\\r\\n\\{\\}]+)\\}/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '{\"' + clean + '\"}';
              });

              // 9. Rectangle node: id[label]
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[([^"\\r\\n\\[\\]]+)\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[\"' + clean + '\"]';
              });

              // 10. Round / Capsule node: id(label)
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\(([^"\\r\\n\\(\\)]+)\\)/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '(\"' + clean + '\")';
              });

              return processed;
            });

            return sanitizedLines.join('\\n');
          }

          let mermaidLoadingPromise = null;
          function loadMermaidScript() {
            if (typeof mermaid !== 'undefined') return Promise.resolve(true);
            if (mermaidLoadingPromise) return mermaidLoadingPromise;
            mermaidLoadingPromise = new Promise((resolve) => {
              const s = document.createElement('script');
              s.src = '${mermaidUri}';
              s.onload = () => resolve(true);
              s.onerror = () => resolve(false);
              document.head.appendChild(s);
            });
            return mermaidLoadingPromise;
          }

          async function renderMermaidDiagrams() {
            const pending = document.querySelectorAll('.mermaid-container:not(.rendered)');
            if (pending.length === 0) return;

            if (typeof mermaid === 'undefined') {
              const ok = await loadMermaidScript();
              if (!ok || typeof mermaid === 'undefined') return;
            }

            try {
              mermaid.initialize({
                startOnLoad: false,
                theme: document.body.classList.contains('vscode-light') ? 'default' : 'dark',
                securityLevel: 'loose',
                flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' }
              });
            } catch (e) {}

            const containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
            for (let i = 0; i < containers.length; i++) {
              const el = containers[i];
              el.classList.add('rendered');
              const rawCode = decodeURIComponent(el.getAttribute('data-mermaid') || '');
              const preSanitized = el.getAttribute('data-sanitized') ? decodeURIComponent(el.getAttribute('data-sanitized')) : '';
              const sanitizedCode = preSanitized || sanitizeMermaid(rawCode);
              const uniqueId = 'mermaid-' + Math.random().toString(36).substring(2, 9);
              
              let renderedSvg = '';
              let renderErr = null;

              try {
                const res = await mermaid.render(uniqueId, sanitizedCode);
                renderedSvg = res.svg;
              } catch (err1) {
                try {
                  const res2 = await mermaid.render(uniqueId + '-raw', rawCode);
                  renderedSvg = res2.svg;
                } catch (err2) {
                  renderErr = err1 || err2;
                }
              }

              if (renderedSvg) {
                el.innerHTML =
                  '<div class="mermaid-card">' +
                    '<div class="mermaid-header">' +
                      '<span class="mermaid-tag">📊 Mermaid Diagram</span>' +
                      '<button class="copy-code-btn" data-code="' + encodeURIComponent(rawCode) + '" title="Copy raw Mermaid code">' +
                        '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">' +
                          '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>' +
                          '<path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>' +
                        '</svg>' +
                        '<span>Copy Code</span>' +
                      '</button>' +
                    '</div>' +
                    '<div class="mermaid-body">' + renderedSvg + '</div>' +
                  '</div>';
              } else {
                const errMsg = renderErr && renderErr.message ? renderErr.message : String(renderErr || 'Syntax error in diagram definition');
                const fence = String.fromCharCode(96, 96, 96);
                const fixPrompt = [
                  'Please fix this Mermaid diagram syntax error so that it renders properly in Mermaid.js (ensure node labels with special characters like ->, &, : are enclosed in quotes):',
                  fence + 'mermaid',
                  rawCode,
                  fence,
                  'Error: ' + errMsg
                ].join(String.fromCharCode(10));
                
                el.innerHTML =
                  '<div class="mermaid-error-card">' +
                    '<div class="mermaid-error-header">' +
                      '<span class="mermaid-error-title">⚠️ Mermaid Syntax Error Detected</span>' +
                      '<button class="fix-ai-btn" data-fix-prompt="' + encodeURIComponent(fixPrompt) + '" onclick="copyFixPrompt(this)" title="Copy prompt to ask Antigravity AI in chat to fix this diagram">' +
                        '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM4.5 7.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm5.5 1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM8 12.5a3.5 3.5 0 0 1-3.26-2.22.75.75 0 0 1 1.38-.59 2 2 0 0 0 3.76 0 .75.75 0 0 1 1.38.59A3.5 3.5 0 0 1 8 12.5Z"></path></svg>' +
                        '<span>🤖 Copy AI Fix Request</span>' +
                      '</button>' +
                    '</div>' +
                    '<div class="mermaid-error-desc">Mermaid chart syntax error: <code>' + errMsg + '</code></div>' +
                    '<div class="code-container" data-language="mermaid">' +
                      '<div class="code-header">' +
                        '<span class="code-lang-badge">MERMAID SOURCE</span>' +
                        '<button class="copy-code-btn" data-code="' + encodeURIComponent(rawCode) + '"><span>Copy</span></button>' +
                      '</div>' +
                      '<pre><code class="language-mermaid">' + rawCode + '</code></pre>' +
                    '</div>' +
                  '</div>';
              }
            }
          }

          function copyFixPrompt(btn) {
            const prompt = decodeURIComponent(btn.getAttribute('data-fix-prompt') || '');
            navigator.clipboard.writeText(prompt).then(() => {
              const span = btn.querySelector('span');
              const orig = span ? span.innerText : '';
              if (span) span.innerText = 'Copied! Paste into chat';
              btn.classList.add('copied');
              setTimeout(() => {
                if (span) span.innerText = orig;
                btn.classList.remove('copied');
              }, 2500);
            });
          }

          let readerObserver = null;
          function initReaderScrollObserver() {
            if (readerObserver) {
              readerObserver.disconnect();
              readerObserver = null;
            }
            const sentinel = document.getElementById('readerTopSentinel');
            const reader = document.getElementById('dashboardReader');
            const header = document.getElementById('readerHeader');
            if (!sentinel || !reader || !header) return;

            readerObserver = new IntersectionObserver((entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  header.classList.remove('scrolled');
                } else {
                  header.classList.add('scrolled');
                }
              }
            }, {
              root: reader,
              rootMargin: '0px',
              threshold: 0
            });
            readerObserver.observe(sentinel);

            if (!reader._scrollHandlerBound) {
              reader._scrollHandlerBound = true;
              reader.addEventListener('scroll', () => {
                const isNewestFirst = (document.getElementById('cfgMessageOrder') ? document.getElementById('cfgMessageOrder').value : 'newestFirst') === 'newestFirst';
                const isStrictlyAtActiveEdge = isNewestFirst
                  ? (reader.scrollTop <= 30)
                  : (reader.scrollTop + reader.clientHeight >= reader.scrollHeight - 30);

                const btnTop = document.getElementById('btnScrollTop');
                const btnBottom = document.getElementById('btnScrollBottom');

                if (reader.scrollTop < 60 && !pendingDashboardLiveUpdate) {
                  if (btnTop) btnTop.classList.remove('has-new-messages');
                }
                if (reader.scrollTop + reader.clientHeight >= reader.scrollHeight - 60 && !pendingDashboardLiveUpdate) {
                  if (btnBottom) btnBottom.classList.remove('has-new-messages');
                }

                if (scrollReaderIdleTimer) {
                  clearTimeout(scrollReaderIdleTimer);
                  scrollReaderIdleTimer = null;
                }

                if (isStrictlyAtActiveEdge && pendingDashboardLiveUpdate) {
                  scrollReaderIdleTimer = setTimeout(() => {
                    const currentTop = reader.scrollTop;
                    const stillAtEdge = isNewestFirst
                      ? (currentTop <= 30)
                      : (currentTop + reader.clientHeight >= reader.scrollHeight - 30);

                    if (stillAtEdge && pendingDashboardLiveUpdate) {
                      const msgToApply = pendingDashboardLiveUpdate;
                      pendingDashboardLiveUpdate = null;
                      applyDashboardReaderUpdate(msgToApply, isNewestFirst, isNewestFirst ? 'top' : 'bottom');
                      if (btnTop) btnTop.classList.remove('has-new-messages');
                      if (btnBottom) btnBottom.classList.remove('has-new-messages');
                    }
                  }, 150);
                }
              }, { passive: true });
            }
          }

          function updateSearchPlaceholder() {
            const searchInput = document.getElementById('dashboardSearch');
            if (searchInput && !searchInput.value) {
              const total = document.querySelectorAll('.session-nav-item').length;
              if (total > 0) {
                searchInput.placeholder = 'Search ' + total + ' chats, or ID...';
              }
            }
          }

          function openRichPreview(encodedPath) {
            let p = decodeURIComponent(encodedPath || '');
            if (p) {
              vscode.postMessage({ command: 'openRichPreview', filePath: p });
            }
          }

          function openIdePreview(encodedPath) {
            let p = decodeURIComponent(encodedPath || '');
            if (p) {
              vscode.postMessage({ command: 'openIdePreview', filePath: p });
            }
          }

          document.addEventListener('DOMContentLoaded', () => {
            renderMermaidDiagrams();
            initReaderScrollObserver();
            updateSearchPlaceholder();
            if (isWorkspaceFilterActive || isHideEmptyActive) {
              filterSessions();
            }
            const sidebarBtn = document.getElementById('sidebarToggleBtn');
            if (sidebarBtn) {
              sidebarBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
              };
            }
          });
          setTimeout(() => {
            renderMermaidDiagrams();
            initReaderScrollObserver();
            updateSearchPlaceholder();
            if (isWorkspaceFilterActive || isHideEmptyActive) {
              filterSessions();
            }
            if (${this.autoOpenSettingsOnInit ? 'true' : 'false'}) {
              openConfigModal();
            }
            if (${this.autoFocusSearchOnInit ? 'true' : 'false'}) {
              const el = document.getElementById('dashboardSearch');
              if (el) { el.focus(); el.select(); }
            }
            const sidebarBtn = document.getElementById('sidebarToggleBtn');
            if (sidebarBtn) {
              sidebarBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar();
              };
            }
          }, 200);

          try {
            vscode.postMessage({ command: 'dashboardReady' });
          } catch (e) {}
        </script>
      </body>
      </html>
    `;
  }

  private generateReaderHtml(
    activeSession: ChatSession | undefined,
    messages: ChatMessage[],
    threadSessions: ChatSession[],
    configState?: AppConfigState,
    isLoadingPlaceholder: boolean = false
  ): string {
    if (!activeSession) {
      return `
        <div class="empty-reader">
          <h3>👈 Select a session from the left panel to inspect</h3>
        </div>
      `;
    }

    MarkdownRenderer.setSessionPath(activeSession.path);

    const isNewestFirst = (configState?.messageOrder || 'newestFirst') === 'newestFirst';
    const isToolsExpanded = configState?.defaultToolsState === 'expanded';
    const isAiStepsExpanded = configState?.defaultAiStepsState === 'expanded';

    const fullTimeStr = DashboardWebviewPanel.formatDateTimeRange(activeSession.createdAt, activeSession.lastModified, true);
    const userPromptTotal = messages.filter((m) => m.type === 'USER_INPUT').length || activeSession.userPromptCount || activeSession.messageCount || 0;

    const isThread = Boolean((activeSession.childIds && activeSession.childIds.length > 0) || activeSession.parentId);
    const threadBadge = isThread ? '<span class="meta-badge green" title="Connected Conversation Thread">🧵</span>' : '';
    const artifactBadge = activeSession.hasArtifacts ? '<span class="meta-badge purple" title="Artifacts Available (Plan / Walkthrough)">🔖</span>' : '';
    const typeBadgeDetail = `${threadBadge}${artifactBadge}`;

    const formattedId = activeSession.id.length > 8
      ? `${activeSession.id.substring(0, 4)}...${activeSession.id.substring(activeSession.id.length - 4)}`
      : activeSession.id;

    const maxStepIndex = messages.reduce((max, m) => Math.max(max, m.index || 0), 0) || messages.length;

    let threadBannerHtml = '';
    if (threadSessions.length > 1) {
      const partsHtml = threadSessions
        .map((s, idx) => {
          const isCurrent = s.id === activeSession.id && !this.isShowingCombinedThread;
          const label = `Part ${idx + 1}: ${s.title.substring(0, 18)}...`;
          return `
            <button class="thread-part-btn ${isCurrent ? 'active' : ''}" onclick="selectSession('${s.id}')" title="Session ${s.id} (${s.messageCount} user msgs)">
              ${isCurrent ? '📍 ' : ''}${label}
            </button>
          `;
        })
        .join('<span class="thread-arrow">➔</span>');

      threadBannerHtml = `
        <div class="thread-banner">
          <div class="thread-header-line">
            <div class="thread-title">
              <span class="thread-icon">🧵</span>
              <span><b>Connected Thread:</b> ${threadSessions.length} sessions across machines</span>
            </div>
            <button class="action-btn ${this.isShowingCombinedThread ? 'primary' : ''}" onclick="toggleThreadMode()" title="Toggle between single session and combined multi-session thread">
              ${this.isShowingCombinedThread ? '📄 View Single Session' : '🔗 View Combined Continuous Thread'}
            </button>
          </div>
          <div class="thread-chain">${partsHtml}</div>
        </div>
      `;
    }

    let artifactsHtml = '';
    if (activeSession.hasArtifacts) {
      artifactsHtml = `
        <div class="artifacts-bar">
          <div class="artifacts-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.6-1.2-1.6 1.2a.25.25 0 0 1-.4-.2Z"></path></svg>
            <span>Session Artifacts:</span>
          </div>
          <div class="artifacts-links">
            ${
              activeSession.planPath
                ? `<button class="artifact-btn" onclick="openRichPreview('${encodeURI(activeSession.planPath)}')" title="Open implementation_plan.md in Antigravity Rich Preview">
                    <span class="artifact-icon">📋</span> Implementation Plan
                  </button>`
                : ''
            }
            ${
              activeSession.walkthroughPath
                ? `<button class="artifact-btn" onclick="openRichPreview('${encodeURI(activeSession.walkthroughPath)}')" title="Open walkthrough.md in Antigravity Rich Preview">
                    <span class="artifact-icon">✅</span> Walkthrough
                  </button>`
                : ''
            }
          </div>
        </div>
      `;
    }

    let renderedMessages = '';
    if (isLoadingPlaceholder) {
      renderedMessages = `
        <div class="reader-loading-skeleton">
          <div class="reader-skeleton-card user-card">
            <div class="skeleton-bone sk-avatar"></div>
            <div class="sk-card-content">
              <div class="skeleton-bone sk-line-header"></div>
              <div class="skeleton-bone sk-line-body"></div>
              <div class="skeleton-bone sk-line-body sk-short"></div>
            </div>
          </div>
          <div class="reader-skeleton-card ai-card">
            <div class="skeleton-bone sk-avatar"></div>
            <div class="sk-card-content">
              <div class="skeleton-bone sk-line-header"></div>
              <div class="skeleton-bone sk-line-body"></div>
              <div class="skeleton-bone sk-line-body"></div>
              <div class="skeleton-bone sk-line-body sk-short"></div>
            </div>
          </div>
          <div class="reader-skeleton-card user-card">
            <div class="skeleton-bone sk-avatar"></div>
            <div class="sk-card-content">
              <div class="skeleton-bone sk-line-header"></div>
              <div class="skeleton-bone sk-line-body"></div>
            </div>
          </div>
        </div>
      `;
    } else if (messages.length > 0) {
      const displayMessages = isNewestFirst ? [...messages].reverse() : [...messages];
      const groupedItems = this.groupMessages(displayMessages);
      renderedMessages = groupedItems.map((item) => this.renderMessageItem(item, isToolsExpanded, isAiStepsExpanded)).join('\n');
    } else {
      renderedMessages = `
        <div class="empty-reader" style="padding: 48px 16px; text-align: center; color: var(--text-secondary);">
          <p>No messages recorded in this conversation session.</p>
        </div>
      `;
    }

    return `
      <div id="readerTopSentinel" style="position: absolute; top: 0; left: 0; width: 100%; height: 35px; pointer-events: none; opacity: 0; z-index: -1;"></div>
      <div class="reader-header" id="readerHeader">
        <div class="reader-header-column">
          <h2 class="reader-title">${MarkdownRenderer.escapeHtml(this.isShowingCombinedThread ? `Thread: ${activeSession.threadTitle || activeSession.title}` : activeSession.title)}</h2>
          <div class="header-meta" id="headerMeta">
            ${configState?.autoReloadOnLiveChat ? '<span class="meta-badge green live-badge" title="Live Auto-Reload Active: Automatically syncs when new AI steps arrive"><span class="live-dot"></span>Live</span>' : ''}
            ${typeBadgeDetail}
            <span class="meta-badge blue" title="Timeline: Created ➔ Last Message">${fullTimeStr}</span>
            <span class="meta-badge cyan" title="User chat messages in this session">💬${userPromptTotal}</span>
            <span class="meta-badge purple" title="Total Execution Steps: ${maxStepIndex}">🤖${maxStepIndex}</span>
            ${activeSession.workspaceName ? `<span class="meta-badge ws" title="Project Folder: ${activeSession.workspacePath || activeSession.workspaceName}">📁 ${MarkdownRenderer.escapeHtml(activeSession.workspaceName)}</span>` : ''}
            ${activeSession.machineName ? `<span class="meta-badge pc" title="Computer: ${activeSession.machineName}">💻 ${MarkdownRenderer.escapeHtml(activeSession.machineName)}</span>` : ''}
            <span class="meta-badge purple" title="Full Session ID: ${activeSession.id}">🆔 ${formattedId}</span>
          </div>
          
          <!-- Single Compact Unified Toolbar with Autowrap -->
          <div class="reader-combined-toolbar">
            <button class="action-btn icon-only" onclick="reloadCurrentChat()" title="Reload and re-parse current chat session">
              <i class="codicon codicon-refresh"></i>
            </button>
            <button class="action-btn primary icon-only" onclick="copyResumePrompt()" title="Resume session (copy continuation prompt to clipboard)">
              <i class="codicon codicon-play"></i>
            </button>
            <button class="action-btn icon-only" onclick="copySessionId()" title="Copy Session ID (${activeSession.id}) to clipboard" id="copySessionIdBtn">
              <i class="codicon codicon-copy"></i>
            </button>
            <button class="action-btn icon-only" onclick="exportMarkdown()" title="Export conversation to Markdown (.md) file">
              <i class="codicon codicon-export"></i>
            </button>
            <button class="action-btn icon-only" onclick="archiveProjectDocs()" title="Archive project documentation and session logs into .docs/ directory">
              <i class="codicon codicon-book"></i>
            </button>
            <button class="action-btn icon-only" onclick="openFolder()" title="Open session directory in OS File Explorer">
              <i class="codicon codicon-folder-opened"></i>
            </button>
            <button class="action-btn danger icon-only" onclick="deleteCurrentSession()" title="Permanently delete this chat session from disk">
              <i class="codicon codicon-trash"></i>
            </button>

            <button class="action-btn icon-only ${isNewestFirst ? 'active' : ''}" onclick="toggleOrder()" id="orderBtn" title="Message Order: ${isNewestFirst ? 'Newest First (Click to switch to Oldest First)' : 'Oldest First (Click to switch to Newest First)'}">
              <span id="orderLabel" style="font-size:13px;line-height:1;">${isNewestFirst ? '⬇️' : '⬆️'}</span>
            </button>
            <button class="action-btn icon-only ${isToolsExpanded ? 'active' : ''}" onclick="toggleAllTools()" id="toolsToggleBtn" title="Tool Call Details: ${isToolsExpanded ? 'Expanded (Click to collapse)' : 'Collapsed (Click to expand)'}">
              <span id="toolsToggleLabel" style="font-size:13px;line-height:1;">🛠️</span>
            </button>
            <button class="action-btn icon-only ${isAiStepsExpanded ? 'active' : ''}" onclick="toggleInternalSteps()" id="internalToggleBtn" title="Autonomous AI Execution Steps: ${isAiStepsExpanded ? 'Expanded (Click to collapse)' : 'Collapsed (Click to expand)'}">
              <span id="internalToggleLabel" style="font-size:13px;line-height:1;">🤖</span>
            </button>

            <div class="transcript-search-wrapper">
              <i class="codicon codicon-search search-icon"></i>
              <input type="text" id="transcriptSearch" class="transcript-search-input" placeholder="Search transcript or #<num>..." oninput="onSearchInputChanged('transcriptSearch')" onfocus="this.select()" title="Type text or #<num> (e.g. #3 for User Msg #3, #15 for Step #15). Press Enter to cycle matches.">
              <span id="transcriptSearchCount" class="search-match-count"></span>
              <button class="clear-search-btn" id="clearTranscriptSearch" onclick="clearSearchInput('transcriptSearch')" title="Clear search">✕</button>
            </div>
          </div>
        </div>
      </div>

      ${threadBannerHtml}
      ${artifactsHtml}
      <div class="chat-timeline" id="chatTimeline">
        ${renderedMessages}
      </div>

      <div class="floating-controls">
        <button class="float-btn" id="btnScrollTop" onclick="scrollToEdge('top')" title="Scroll to top of chat">▲</button>
        <button class="float-btn" id="btnScrollBottom" onclick="scrollToEdge('bottom')" title="Scroll to bottom of chat">▼</button>
      </div>
    `;
  }

  private renderMessageItem(item: MessageRenderItem, isToolsExpanded: boolean = false, isAiStepsExpanded: boolean = false): string {
    if (item.type === 'autonomous_group' && item.group) {
      const group = item.group;
      const firstIndex = group[0].index;
      const lastIndex = group[group.length - 1].index;

      const toolNamesSet = new Set<string>();
      let autoCount = 0;
      let sysCount = 0;

      group.forEach(g => {
        if (g.source === 'SYSTEM' || g.type === 'SYSTEM_MESSAGE') {
          sysCount++;
        } else {
          autoCount++;
        }
        g.toolCalls?.forEach(tc => toolNamesSet.add(tc.name));
      });
      const toolNames = toolNamesSet.size > 0 ? Array.from(toolNamesSet).join(', ') : (autoCount > 0 ? 'Reasoning' : 'System Signals');

      const innerCardsHtml = group.map(g => {
        if (g.source === 'SYSTEM' || g.type === 'SYSTEM_MESSAGE') {
          return this.renderMessage(g, isToolsExpanded);
        }
        return this.renderSingleAutonomousStep(g, isToolsExpanded);
      }).join('\n');

      let actionTitle = 'Autonomous Action';
      if (group.length > 1) {
        actionTitle = 'Autonomous Actions & Events';
      }
      if (autoCount === 0 && sysCount > 0) {
        actionTitle = sysCount === 1 ? 'System Event' : 'System Events';
      } else if (sysCount === 0 && autoCount > 0) {
        actionTitle = autoCount === 1 ? 'Autonomous Action' : 'Autonomous Actions';
      }

      let countBadge = group.length === 1 ? `(#${firstIndex})` : `(${group.length} steps: #${firstIndex} - #${lastIndex})`;
      if (autoCount > 0 && sysCount > 0) {
        countBadge = `(${group.length} steps: #${firstIndex} - #${lastIndex} • ${autoCount} actions, ${sysCount} events)`;
      }

      return `
        <details class="autonomous-group-details is-internal-step" ${isAiStepsExpanded ? 'open' : ''} data-step="${firstIndex}-${lastIndex}">
          <summary class="autonomous-group-summary" title="Click to expand/collapse internal execution step and system event list">
            <span>⚡</span>
            <span><b>${actionTitle}</b></span>
            <span class="group-count">${countBadge}</span>
            <span class="group-tools">[${MarkdownRenderer.escapeHtml(toolNames)}]</span>
          </summary>
          <div class="autonomous-group-body">
            ${innerCardsHtml}
          </div>
        </details>
      `;
    }

    if (item.message) {
      return this.renderMessage(item.message, isToolsExpanded);
    }

    return '';
  }

  private renderSingleAutonomousStep(msg: ChatMessage, isToolsExpanded: boolean = false): string {
    let thinkingHtml = '';
    if (msg.thinking) {
      thinkingHtml = `
        <details class="chat-details" ${isToolsExpanded ? 'open' : ''}>
          <summary title="Click to view AI reasoning and plan"><span>🧠</span><span>Model Reasoning & Planning</span></summary>
          <div class="details-inner-content">
            ${MarkdownRenderer.render(msg.thinking)}
          </div>
        </details>
      `;
    }

    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      toolCallsHtml = msg.toolCalls
        .map((tc) => {
          const isSuccess = tc.exitCode === 0 || tc.status === 'DONE' || !tc.exitCode;
          let argsJson = tc.args ? (typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args, null, 2)) : '';
          return `
            <details class="chat-details" ${isToolsExpanded ? 'open' : ''}>
              <summary title="Click to inspect tool arguments and output">
                <span>⚙️</span>
                <span><b>Tool:</b> <code>${tc.name}</code></span>
                <span class="tool-badge ${isSuccess ? 'success' : 'error'}" style="margin-left:auto;">${isSuccess ? 'Success' : 'Error'}</span>
              </summary>
              <div class="details-inner-content">
                ${argsJson ? MarkdownRenderer.renderCodeBlock(argsJson, 'json') : ''}
                ${tc.output ? MarkdownRenderer.renderCodeBlock(tc.output, 'shell') : ''}
              </div>
            </details>
          `;
        })
        .join('\n');
    }

    let systemPayloadsHtml = '';
    if (msg.systemPayloads && msg.systemPayloads.length > 0) {
      const innerHtml = msg.systemPayloads
        .map(p => MarkdownRenderer.render(p))
        .join('\n<hr style="border:none;border-top:1px dashed var(--border-color);margin:8px 0;" />\n');
      systemPayloadsHtml = `
        <details class="chat-details" ${isToolsExpanded ? 'open' : ''}>
          <summary title="Click to view background system events and task logs"><span>⚙️</span><span>System / Task Logs</span></summary>
          <div class="details-inner-content">
            ${innerHtml}
          </div>
        </details>
      `;
    }

    let transientTextHtml = '';
    const textContent = (msg.cleanContent !== undefined ? msg.cleanContent : msg.content) || '';
    if (textContent.trim()) {
      transientTextHtml = `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-bottom:6px;">${MarkdownRenderer.escapeHtml(textContent.trim())}</div>`;
    }

    const toolNames = msg.toolCalls && msg.toolCalls.length > 0 ? msg.toolCalls.map(t => t.name).join(', ') : 'Reasoning';

    return `
      <details class="internal-step-details" ${isToolsExpanded ? 'open' : ''} data-step="${msg.index}">
        <summary title="Click to expand/collapse action details">
          <span>⚡</span>
          <span>Action #${msg.index}</span>
          <span style="font-size:11px;color:var(--accent-purple);margin-left:auto;font-family:var(--font-mono);">[${MarkdownRenderer.escapeHtml(toolNames)}]</span>
        </summary>
        <div class="internal-step-body">
          ${transientTextHtml}
          ${thinkingHtml}
          ${toolCallsHtml}
          ${systemPayloadsHtml}
        </div>
      </details>
    `;
  }

  private renderMessage(msg: ChatMessage, isToolsExpanded: boolean = false): string {
    if (msg.type === 'USER_INPUT') {
      const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('en-US') : `Step #${msg.index}`;
      const userIndexLabel = msg.userIndex ? `User #${msg.userIndex}` : 'User';
      const rawUserMsgEncoded = encodeURIComponent(msg.cleanContent || msg.content || '');

      let mediaHtml = '';
      if (msg.mediaAttachments && msg.mediaAttachments.length > 0) {
        const items = msg.mediaAttachments.map((imgUri, idx) => `
          <div class="user-media-item" onclick="openMediaModal('${imgUri}')" title="Click to enlarge image #${idx + 1}">
            <img src="${imgUri}" class="user-media-thumb" alt="User Image Attachment #${idx + 1}" loading="lazy">
          </div>
        `).join('');
        mediaHtml = `<div class="user-media-gallery">${items}</div>`;
      }

      return `
        <div class="message-card user" data-step="${msg.index}" data-user-step="${msg.userIndex || ''}">
          <div class="message-header-row">
            <div class="message-avatar avatar-user" title="User Message">👤</div>
            <span class="message-sender-name">${userIndexLabel}</span>
            <span class="message-time">${timeStr}</span>
            <div class="message-header-actions" style="margin-left:auto;display:flex;align-items:center;gap:8px;">
              <span class="meta-step-tag" style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);" title="Execution Timeline Step #${msg.index}">Step #${msg.index}</span>
              <button class="copy-msg-btn" data-raw-msg="${rawUserMsgEncoded}" title="Copy original prompt content">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
                </svg>
                <span>Copy</span>
              </button>
            </div>
          </div>
          <div class="message-bubble">
            ${mediaHtml}
            <div class="markdown-content">
              ${MarkdownRenderer.render(MarkdownRenderer.preprocessUserDirectives(msg.cleanContent || msg.content))}
            </div>
          </div>
        </div>
      `;
    } else if (msg.type === 'PLANNER_RESPONSE' || msg.source === 'MODEL') {
      const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('en-US') : `Step #${msg.index}`;
      let thinkingHtml = '';
      if (msg.thinking) {
        thinkingHtml = `
          <details class="chat-details" ${isToolsExpanded ? 'open' : ''}>
            <summary title="Click to view AI reasoning and plan"><span>🧠</span><span>Model Reasoning & Planning</span></summary>
            <div class="details-inner-content">
              ${MarkdownRenderer.render(msg.thinking)}
            </div>
          </details>
        `;
      }

      let toolCallsHtml = '';
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        toolCallsHtml = msg.toolCalls
          .map((tc) => {
            const isSuccess = tc.exitCode === 0 || tc.status === 'DONE' || !tc.exitCode;
            let argsJson = tc.args ? (typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args, null, 2)) : '';
            return `
              <details class="chat-details" ${isToolsExpanded ? 'open' : ''}>
                <summary title="Click to inspect tool arguments and output">
                  <span>⚙️</span>
                  <span><b>Tool:</b> <code>${tc.name}</code></span>
                  <span class="tool-badge ${isSuccess ? 'success' : 'error'}" style="margin-left:auto;">${isSuccess ? 'Success' : 'Error'}</span>
                </summary>
                <div class="details-inner-content">
                  ${argsJson ? MarkdownRenderer.renderCodeBlock(argsJson, 'json') : ''}
                  ${tc.output ? MarkdownRenderer.renderCodeBlock(tc.output, 'shell') : ''}
                </div>
              </details>
            `;
          })
          .join('\n');
      }

      const textToRender = (msg.cleanContent !== undefined ? msg.cleanContent : msg.content) || '';
      const isShortTransient = textToRender.length < 150 && /^(waiting for|the .* has been launched|running |building |đang |vui lòng chờ)/i.test(textToRender.trim());
      const isInternalExecutionStep = !textToRender.trim() || (isShortTransient && (msg.toolCalls?.length || msg.thinking || msg.systemPayloads?.length));

      if (isInternalExecutionStep && (msg.toolCalls?.length || msg.thinking || msg.systemPayloads?.length)) {
        return this.renderSingleAutonomousStep(msg, isToolsExpanded);
      }

      let systemPayloadsHtml = '';
      if (msg.systemPayloads && msg.systemPayloads.length > 0) {
        const innerHtml = msg.systemPayloads
          .map(p => MarkdownRenderer.render(p))
          .join('\n<hr style="border:none;border-top:1px dashed var(--border-color);margin:8px 0;" />\n');
        systemPayloadsHtml = `
          <details class="chat-details system-payload-details" ${isToolsExpanded ? 'open' : ''} style="margin-bottom:10px;border-left:2px solid var(--accent-cyan, #00d2ff);">
            <summary title="Click to view background system events and task completion logs">
              <span>⚙️</span>
              <span><b>System & Background Task Logs</b></span>
              <span style="font-size:10.5px;color:var(--text-muted);margin-left:auto;font-family:var(--font-mono);">(Click to expand)</span>
            </summary>
            <div class="details-inner-content" style="font-size:12px;opacity:0.92;">
              ${innerHtml}
            </div>
          </details>
        `;
      }

      const rawAiMsgEncoded = encodeURIComponent(msg.cleanContent || msg.content || '');

      return `
        <div class="message-card ai" data-step="${msg.index}">
          <div class="message-header-row">
            <div class="message-avatar avatar-ai" title="Antigravity AI Response">✨</div>
            <span class="message-sender-name">Antigravity AI</span>
            <span class="message-time">${timeStr}</span>
            <div class="message-header-actions" style="margin-left:auto;display:flex;align-items:center;gap:8px;">
              <span class="meta-step-tag" style="font-size:10.5px;color:var(--text-muted);font-family:var(--font-mono);" title="Execution Timeline Step #${msg.index}">Step #${msg.index}</span>
              <button class="copy-msg-btn" data-raw-msg="${rawAiMsgEncoded}" title="Copy original raw markdown response">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
                </svg>
                <span>Copy</span>
              </button>
            </div>
          </div>
          <div class="message-bubble">
            ${thinkingHtml}
            ${toolCallsHtml}
            ${systemPayloadsHtml}
            ${textToRender ? `<div>${MarkdownRenderer.render(textToRender)}</div>` : ''}
          </div>
        </div>
      `;
    } else if (msg.type === 'SYSTEM_MESSAGE' || msg.source === 'SYSTEM') {
      const renderedContent = msg.content ? MarkdownRenderer.render(msg.content) : '<em>No system event content.</em>';
      return `
        <details class="system-event-banner is-internal-step" data-step="${msg.index}" style="margin:8px 0;border:1px dashed var(--border-color);border-radius:var(--radius-md);background:var(--bg-secondary);overflow:hidden;">
          <summary style="display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-secondary);user-select:none;" title="Click to view system event details">
            <span>⚙️</span>
            <span><b>System Event #${msg.index}</b></span>
            <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Click to view</span>
          </summary>
          <div class="system-event-body" style="padding:12px 18px;border-top:1px dashed var(--border-color);background:var(--bg-primary);font-size:13px;line-height:1.6;">
            <div class="markdown-content">
              ${renderedContent}
            </div>
          </div>
        </details>
      `;
    } else if (msg.type === 'CHECKPOINT') {
      const renderedContent = msg.content ? MarkdownRenderer.render(msg.content) : '<em>No checkpoint summary content available.</em>';
      return `
        <details class="checkpoint-banner is-internal-step" data-step="${msg.index}" style="margin:8px 0;border:1px dashed var(--accent-purple);border-radius:var(--radius-md);background:var(--bg-secondary);overflow:hidden;">
          <summary style="display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-primary);user-select:none;" title="Click to expand/collapse auto-summarized context checkpoint">
            <span>📌</span>
            <span><b>Checkpoint #${msg.index}</b></span>
            <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(Context auto-summarized by Antigravity engine)</span>
            <span style="margin-left:auto;font-size:11px;color:var(--accent-purple);">Click to view</span>
          </summary>
          <div class="checkpoint-body" style="padding:12px 18px;border-top:1px dashed var(--border-color);background:var(--bg-primary);font-size:13px;line-height:1.6;">
            <div class="markdown-content">
              ${renderedContent}
            </div>
          </div>
        </details>
      `;
    } else if (msg.type === 'SUBAGENT_NOTIFICATION') {
      const renderedContent = msg.content ? MarkdownRenderer.render(msg.content) : '';
      return `
        <details class="subagent-banner is-internal-step" data-step="${msg.index}" style="margin:8px 0;border:1px dashed var(--accent-cyan, #00bcd4);border-radius:var(--radius-md);background:var(--bg-secondary);overflow:hidden;">
          <summary style="display:flex;align-items:center;gap:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-primary);user-select:none;" title="Click to expand/collapse Subagent Notification details">
            <span>📡</span>
            <span><b>Subagent Notification #${msg.index}</b></span>
            <span style="margin-left:auto;font-size:11px;color:var(--accent-cyan, #00bcd4);">Click to view</span>
          </summary>
          <div class="subagent-body" style="padding:12px 18px;border-top:1px dashed var(--border-color);background:var(--bg-primary);font-size:13px;line-height:1.6;">
            <div class="markdown-content">
              ${renderedContent}
            </div>
          </div>
        </details>
      `;
    }

    return '';
  }
}
