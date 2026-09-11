import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatMessage, ChatSession, ToolCallInfo } from '../models/types';
import { SessionScanner } from '../services/SessionScanner';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { MarkdownExporter } from '../services/MarkdownExporter';
import { KATEX_CSS, getKaTeXCss } from '../services/KaTeXStyles';
import { HIGHLIGHT_CSS } from '../services/HighlightStyles';
import { DashboardWebviewPanel } from './DashboardWebviewPanel';
import { MarkdownPreviewWebviewPanel } from './MarkdownPreviewWebviewPanel';

export class ChatWebviewPanel {
  public static currentPanels: Map<string, ChatWebviewPanel> = new Map();
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private currentSession: ChatSession;
  private isShowingCombinedThread: boolean = false;
  private sessionWatcher?: fs.FSWatcher;
  private sessionPollingTimer?: NodeJS.Timeout;
  private reloadDebounceTimer?: NodeJS.Timeout;
  private lastContentSignature: string = '';
  private isHtmlInitialized: boolean = false;
  private lastWatchedFileSize: number = 0;
  private lastWatchedFileMtime: number = 0;
  private extensionVersion: string = '0.5.1';

  public static createOrShow(extensionUri: vscode.Uri, session: ChatSession): ChatWebviewPanel {
    const existing = ChatWebviewPanel.currentPanels.get(session.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      existing.updateContent();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'brainHubChatViewer',
      `Chat: ${session.title.substring(0, 30)}...`,
      vscode.ViewColumn.Active,
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

    const chatPanel = new ChatWebviewPanel(panel, extensionUri, session);
    ChatWebviewPanel.currentPanels.set(session.id, chatPanel);
    return chatPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, session: ChatSession) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.currentSession = session;

    try {
      const pkgPath = path.join(extensionUri.fsPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        this.extensionVersion = pkg.version || '0.5.1';
      }
    } catch {
      this.extensionVersion = '0.5.1';
    }

    this.updateContent();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'copyText':
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('Copied to clipboard!');
            break;

          case 'copyResumePrompt':
            const resumePrompt = this.generateResumePrompt(this.currentSession);
            await vscode.env.clipboard.writeText(resumePrompt);
            vscode.window.showInformationMessage('Resume prompt copied to clipboard! Paste it into a new Antigravity chat.');
            break;

          case 'copySessionId':
            await vscode.env.clipboard.writeText(this.currentSession.id);
            vscode.window.showInformationMessage(`Copied Session ID: ${this.currentSession.id}`);
            break;

          case 'exportMarkdown':
            await MarkdownExporter.exportSession(this.currentSession);
            break;

          case 'archiveProjectDocs':
            await vscode.commands.executeCommand('brainHub.exportProjectDocs');
            break;

          case 'openFolder':
            await vscode.env.openExternal(vscode.Uri.file(this.currentSession.path));
            break;

          case 'deleteSession':
            await vscode.commands.executeCommand('brainHub.deleteSession', this.currentSession);
            this.dispose();
            break;

          case 'openFile':
            await this.handleOpenFile(message.filePath, message.openMode);
            break;

          case 'openRichPreview':
            await this.handleOpenFile(message.filePath, 'rich');
            break;

          case 'openIdePreview':
            await this.handleOpenFile(message.filePath, 'ide');
            break;

          case 'openSessionById':
            const allSessions = await SessionScanner.getInstance().scanSessions();
            const target = allSessions.find((s) => s.id === message.sessionId);
            if (target) {
              ChatWebviewPanel.createOrShow(this.extensionUri, target);
            }
            break;

          case 'toggleCombinedThread':
            this.isShowingCombinedThread = !this.isShowingCombinedThread;
            await this.updateContent();
            break;

          case 'toggleMessageOrder':
            const currentOrder = vscode.workspace.getConfiguration('brainHub').get<string>('messageOrder', 'newestFirst');
            const newOrder = currentOrder === 'newestFirst' ? 'oldestFirst' : 'newestFirst';
            await vscode.workspace.getConfiguration('brainHub').update('messageOrder', newOrder, vscode.ConfigurationTarget.Global);
            await this.updateContent();
            break;

          case 'refresh':
            SessionScanner.getInstance().invalidateSessionCache(this.currentSession.id);
            await this.updateContent(false);
            vscode.window.showInformationMessage('Chat reloaded.');
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private setupSessionWatcher(): void {
    if (this.sessionWatcher) {
      return;
    }

    const autoReload = vscode.workspace.getConfiguration('brainHub').get<boolean>('autoReloadOnLiveChat', true);
    if (!autoReload || !this.currentSession || !this.currentSession.path) {
      return;
    }

    const logsDir = path.join(this.currentSession.path, '.system_generated', 'logs');
    const watchTarget = fs.existsSync(logsDir) ? logsDir : this.currentSession.path;

    try {
      if (fs.existsSync(watchTarget)) {
        this.sessionWatcher = fs.watch(watchTarget, { recursive: true }, (eventType, filename) => {
          if (filename && filename.startsWith('.') && !filename.includes('transcript')) {
            return;
          }
          if (!filename || filename.includes('transcript') || filename.endsWith('.jsonl')) {
            if (this.reloadDebounceTimer) {
              clearTimeout(this.reloadDebounceTimer);
            }
            this.reloadDebounceTimer = setTimeout(async () => {
              await this.updateContent(true);
            }, 300);
          }
        });
      }
    } catch (err) {
      console.warn('Could not setup session watcher in ChatWebviewPanel:', err);
    }

    // Polling fallback to guarantee updates on Windows even if fs.watch misses an event
    const transcriptFile = path.join(logsDir, 'transcript.jsonl');
    const fullTranscriptFile = path.join(logsDir, 'transcript_full.jsonl');
    try {
      const targetWatch = fs.existsSync(fullTranscriptFile) ? fullTranscriptFile : transcriptFile;
      if (fs.existsSync(targetWatch)) {
        const st = fs.statSync(targetWatch);
        this.lastWatchedFileSize = st.size;
        this.lastWatchedFileMtime = st.mtimeMs;
      }
    } catch {}

    this.sessionPollingTimer = setInterval(async () => {
      try {
        const targetFile = fs.existsSync(fullTranscriptFile) ? fullTranscriptFile : (fs.existsSync(transcriptFile) ? transcriptFile : null);
        if (targetFile && fs.existsSync(targetFile)) {
          const st = await fs.promises.stat(targetFile);
          if (st.size !== this.lastWatchedFileSize || st.mtimeMs !== this.lastWatchedFileMtime) {
            this.lastWatchedFileSize = st.size;
            this.lastWatchedFileMtime = st.mtimeMs;
            await this.updateContent(true);
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

  public async updateContent(isLiveUpdate: boolean = false): Promise<void> {
    const scanner = SessionScanner.getInstance();
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const messageOrder = cfg.get<'newestFirst' | 'oldestFirst'>('messageOrder', 'newestFirst');

    if (this.isShowingCombinedThread) {
      const threadData = await scanner.loadFullThread(this.currentSession.id);
      if (threadData) {
        this.setupSessionWatcher();
        const lastMsg = threadData.allMessages[threadData.allMessages.length - 1];
        const newSignature = `thread_${threadData.allMessages.length}_${lastMsg?.index ?? 0}`;
        if (isLiveUpdate && this.lastContentSignature === newSignature) {
          return;
        }
        this.lastContentSignature = newSignature;

        this.panel.title = `Thread: ${this.currentSession.threadTitle?.substring(0, 25) || this.currentSession.title.substring(0, 25)}...`;
        const fullHtml = this.generateHtml(this.currentSession, threadData.allMessages, threadData.threadSessions);
        if (isLiveUpdate) {
          await this.panel.webview.postMessage({
            command: 'updateChatContent',
            html: fullHtml,
            isLiveUpdate: true,
            messageOrder: messageOrder
          });
        } else {
          this.panel.webview.html = fullHtml;
        }
        return;
      }
    }

    const data = await scanner.loadFullSession(this.currentSession.id);
    if (data) {
      this.currentSession = data.session;
      this.setupSessionWatcher();

      // Check transcript stat to avoid false refresh
      let transcriptStat = '';
      if (this.currentSession.path) {
        const fullTranscriptFile = path.join(this.currentSession.path, '.system_generated', 'logs', 'transcript_full.jsonl');
        const transcriptFile = path.join(this.currentSession.path, '.system_generated', 'logs', 'transcript.jsonl');
        try {
          const targetStat = fs.existsSync(fullTranscriptFile) ? fullTranscriptFile : transcriptFile;
          if (fs.existsSync(targetStat)) {
            const st = fs.statSync(targetStat);
            transcriptStat = `${st.size}_${st.mtimeMs}`;
          }
        } catch {}
      }

      const lastMsg = data.messages[data.messages.length - 1];
      const newSignature = `${data.messages.length}_${lastMsg?.index ?? 0}_${transcriptStat}`;
      if (isLiveUpdate && this.lastContentSignature && this.lastContentSignature === newSignature) {
        return;
      }
      this.lastContentSignature = newSignature;

      const allSessions = await scanner.scanSessions();
      const targetInList = allSessions.find((s) => s.id === this.currentSession.id);
      if (targetInList) {
        data.session.rootId = targetInList.rootId || data.session.rootId || data.session.id;
        data.session.childIds = targetInList.childIds || data.session.childIds || [];
        data.session.parentId = data.session.parentId || targetInList.parentId;
        data.session.threadTitle = targetInList.threadTitle || data.session.threadTitle;
      }
      const rootId = targetInList?.rootId || data.session.rootId || data.session.id;
      const threadSessions = allSessions.filter((s) => (s.rootId || s.id) === rootId || s.id === rootId);
      threadSessions.sort((a, b) => (a.createdAt || a.lastModified).getTime() - (b.createdAt || b.lastModified).getTime());

      this.panel.title = `Chat: ${data.session.title.substring(0, 25)}...`;
      const fullHtml = this.generateHtml(data.session, data.messages, threadSessions);
      if (this.isHtmlInitialized) {
        await this.panel.webview.postMessage({
          command: 'updateChatContent',
          html: fullHtml,
          isLiveUpdate: isLiveUpdate,
          messageOrder: messageOrder,
          forceScrollEdge: !isLiveUpdate ? (messageOrder === 'newestFirst' ? 'top' : 'bottom') : undefined
        });
      } else {
        this.panel.webview.html = fullHtml;
        this.isHtmlInitialized = true;
      }
    } else {
      this.panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <body style="background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:sans-serif;padding:30px;text-align:center;">
          <h2>⚠️ Could not load session</h2>
          <p>Session path: ${this.currentSession.path}</p>
        </body>
        </html>
      `;
    }
  }

  private async handleOpenFile(rawPath?: string, openMode?: 'rich' | 'ide' | 'editor'): Promise<void> {
    if (!rawPath || typeof rawPath !== 'string') {
      return;
    }

    let filePath = rawPath.trim();
    let startLine = 0;
    let endLine = 0;

    try {
      filePath = decodeURIComponent(filePath);
    } catch {}

    // Check for hash line numbers: e.g. #L20-L40, #L20, #20
    const hashIdx = filePath.indexOf('#');
    if (hashIdx !== -1) {
      const hash = filePath.substring(hashIdx + 1);
      filePath = filePath.substring(0, hashIdx);
      const lineRangeMatch = hash.match(/^L?(\d+)(?:-L?(\d+))?$/i);
      if (lineRangeMatch) {
        startLine = Math.max(0, parseInt(lineRangeMatch[1], 10) - 1);
        endLine = lineRangeMatch[2] ? Math.max(0, parseInt(lineRangeMatch[2], 10) - 1) : startLine;
      }
    }

    // Strip leading '@' if passed from mention badge (e.g. @ui_prototype.html)
    filePath = filePath.replace(/^@/, '');

    // Strip file:/// or file:// protocol
    filePath = filePath.replace(/^file:\/{1,3}/i, '');

    // Normalize Windows drive letters: /d:/path -> d:/path
    if (process.platform === 'win32') {
      filePath = filePath.replace(/^[\/\\]([a-zA-Z]:)/, '$1');
      filePath = path.normalize(filePath);
    }
    const lineHashMatch = filePath.match(/#L(\d+)(?:-L?(\d+))?$/i);
    if (lineHashMatch) {
      startLine = Math.max(0, parseInt(lineHashMatch[1], 10) - 1);
      endLine = lineHashMatch[2] ? Math.max(0, parseInt(lineHashMatch[2], 10) - 1) : startLine;
      filePath = filePath.replace(/#L\d+(?:-L?\d+)?$/i, '');
    }

    let targetPath = filePath;
    const isExplicitlyAbsolute = path.isAbsolute(filePath) || /^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');

    if (!isExplicitlyAbsolute || !fs.existsSync(targetPath)) {
      if (this.currentSession && this.currentSession.workspacePath && fs.existsSync(this.currentSession.workspacePath)) {
        const candidate = path.resolve(this.currentSession.workspacePath, filePath);
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

      if (!fs.existsSync(targetPath) && this.currentSession && this.currentSession.path && fs.existsSync(this.currentSession.path)) {
        const candidate = path.resolve(this.currentSession.path, filePath);
        if (fs.existsSync(candidate)) {
          targetPath = candidate;
        }
      }

      if (!fs.existsSync(targetPath) && this.currentSession && this.currentSession.workspacePath && fs.existsSync(this.currentSession.workspacePath)) {
        const found = this.findFileInDirectory(this.currentSession.workspacePath, path.basename(filePath));
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

    if (openMode === 'rich' && isMarkdown) {
      // 1. Explicit request for Brain Hub Rich Preview (e.g. clicked 🔎 or Artifact button)
      try {
        MarkdownPreviewWebviewPanel.createOrShow(this.extensionUri, targetPath, vscode.ViewColumn.Active);
        return;
      } catch (err) {
        console.warn('Could not open rich markdown preview, falling back to IDE preview:', err);
        try {
          await vscode.commands.executeCommand('markdown.showPreview', fileUri);
          return;
        } catch {}
      }
    } else if (openMode === 'ide' && isMarkdown) {
      // 2. Explicit request for IDE Built-in Preview (e.g. clicked 📄)
      try {
        await vscode.commands.executeCommand('markdown.showPreview', fileUri);
        return;
      } catch (err) {
        console.warn('Could not open IDE markdown preview, falling back to editor:', err);
      }
    } else if (isMarkdown && startLine === 0 && endLine === 0) {
      // 3. Clicked markdown file name without line range -> Default to Brain Hub Rich Preview
      try {
        MarkdownPreviewWebviewPanel.createOrShow(this.extensionUri, targetPath, vscode.ViewColumn.Active);
        return;
      } catch (err) {
        console.warn('Could not open rich markdown preview, falling back to IDE preview:', err);
        try {
          await vscode.commands.executeCommand('markdown.showPreview', fileUri);
          return;
        } catch {}
      }
    }

    // Standard text document opening as a new tab (not split screen)
    if (startLine > 0 || endLine > 0) {
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const opts: vscode.TextDocumentShowOptions = {
          preview: false,
          viewColumn: vscode.ViewColumn.Active,
          selection: new vscode.Range(startLine, 0, endLine, 0)
        };
        await vscode.window.showTextDocument(doc, opts);
        return;
      } catch {}
    }

    try {
      await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
    } catch (err: any) {
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
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

  public dispose(): void {
    this.disposeSessionWatcher();
    ChatWebviewPanel.currentPanels.delete(this.currentSession.id);
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private generateResumePrompt(session: ChatSession): string {
    return `Please review the previous conversation context of the session in folder:\n\`${session.path}\`\n(Session ID: \`${session.id}\` - Title: "${session.title}")\nand continue assisting me.`;
  }

  private generateHtml(session: ChatSession, messages: ChatMessage[], threadSessions: ChatSession[] = []): string {
    MarkdownRenderer.setSessionPath(session.path);
    const cfg = vscode.workspace.getConfiguration('brainHub');
    const messageOrder = cfg.get<'newestFirst' | 'oldestFirst'>('messageOrder', 'newestFirst');
    const defaultToolsState = cfg.get<'collapsed' | 'expanded'>('defaultToolsState', 'collapsed');
    const defaultAiStepsState = cfg.get<'collapsed' | 'expanded'>('defaultAiStepsState', 'collapsed');
    const isNewestFirst = messageOrder === 'newestFirst';
    const isToolsExpanded = defaultToolsState === 'expanded';
    const isAiStepsExpanded = defaultAiStepsState === 'expanded';
    const displayMessages = isNewestFirst ? [...messages].reverse() : [...messages];
    const fullTimeStr = DashboardWebviewPanel.formatDateTimeRange(session.createdAt, session.lastModified, true);
    const maxStepIndex = messages.reduce((max, m) => Math.max(max, m.index || 0), 0) || messages.length;

    const isThread = Boolean((session.childIds && session.childIds.length > 0) || session.parentId);
    const threadBadge = isThread ? '<span class="meta-badge green" title="Connected Conversation Thread">🧵</span>' : '';
    const artifactBadge = session.hasArtifacts ? '<span class="meta-badge purple" title="Artifacts Available (Plan / Walkthrough)">🔖</span>' : '';
    const typeBadgeHtml = `${threadBadge}${artifactBadge}`;

    let threadBannerHtml = '';
    if (threadSessions.length > 1) {
      const partsHtml = threadSessions
        .map((s, idx) => {
          const isCurrent = s.id === session.id && !this.isShowingCombinedThread;
          const label = `Part ${idx + 1}: ${s.title.substring(0, 20)}...`;
          return `
            <button class="thread-part-btn ${isCurrent ? 'active' : ''}" onclick="openSessionById('${s.id}')" title="Session ${s.id} (${s.messageCount} msgs)">
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
              <span><b>Connected Conversation Thread:</b> ${threadSessions.length} linked sessions across machines</span>
            </div>
            <button class="action-btn ${this.isShowingCombinedThread ? 'primary' : ''}" onclick="toggleCombinedThread()">
              ${this.isShowingCombinedThread ? '📄 View Single Session' : '🔗 View Combined Continuous Thread'}
            </button>
          </div>
          <div class="thread-chain">
            ${partsHtml}
          </div>
        </div>
      `;
    }

    let artifactsHtml = '';
    if (session.hasArtifacts) {
      artifactsHtml = `
        <div class="artifacts-bar">
          <div class="artifacts-title">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.6-1.2-1.6 1.2a.25.25 0 0 1-.4-.2Z"></path></svg>
            <span>Session Artifacts:</span>
          </div>
          <div class="artifacts-links">
            ${
              session.planPath
                ? `<button class="artifact-btn" onclick="openRichPreview('${encodeURI(session.planPath)}')" title="Open implementation_plan.md in Antigravity Rich Preview">
                    <span class="artifact-icon">📋</span> Implementation Plan
                  </button>`
                : ''
            }
            ${
              session.walkthroughPath
                ? `<button class="artifact-btn" onclick="openRichPreview('${encodeURI(session.walkthroughPath)}')" title="Open walkthrough.md in Antigravity Rich Preview">
                    <span class="artifact-icon">✅</span> Walkthrough
                  </button>`
                : ''
            }
          </div>
        </div>
      `;
    }

    const mermaidUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mermaid.min.js')
    );
    const fontsUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'fonts')
    );

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Antigravity Chat Viewer</title>
        <style>
          html, body {
            background-color: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-editor-foreground, #cccccc);
          }
        </style>
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
            --shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.15);
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          }

          /* Light Theme Overrides */
          body.vscode-light {
            --user-bubble-bg: rgba(55, 148, 255, 0.1);
            --user-bubble-border: rgba(55, 148, 255, 0.35);
            --ai-bubble-bg: rgba(0, 0, 0, 0.03);
            --ai-bubble-border: rgba(0, 0, 0, 0.12);
            --code-bg: rgba(0, 0, 0, 0.05);
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            background: var(--bg-primary);
            color: var(--text-primary);
            font-family: var(--font-family);
            font-size: 14px;
            line-height: 1.6;
            overflow-x: hidden;
            overflow-anchor: none !important;
          }

          .header-container {
            position: sticky;
            top: 0;
            z-index: 100;
            background: var(--bg-primary);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 24px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
            overflow-anchor: none !important;
            transition: padding 0.15s ease, box-shadow 0.15s ease;
          }

          .header-container.scrolled {
            padding: 8px 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          }

          .header-main {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
          }

          .header-title-section {
            flex: 1;
            min-width: 250px;
          }

          .session-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
            transition: font-size 0.2s ease;
          }

          .header-container.scrolled .session-title {
            font-size: 13.5px;
          }

          .session-title-icon {
            color: var(--accent-blue);
            display: flex;
            align-items: center;
          }

          .header-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 6px;
            flex-wrap: wrap;
            font-size: 12px;
            color: var(--text-secondary);
            max-height: 80px;
            opacity: 1;
            overflow: visible;
            transform: translateY(0);
            transition: max-height 0.22s ease, opacity 0.18s ease, transform 0.18s ease, margin 0.18s ease;
          }

          .header-container.scrolled .header-meta {
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
            padding: 2px 8px;
            border-radius: 20px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-family: var(--font-mono);
          }

          .meta-badge.purple { color: var(--accent-purple); }
          .meta-badge.blue { color: var(--accent-blue); }
          .meta-badge.cyan { color: var(--accent-cyan); }
          .meta-badge.green { color: var(--accent-green); }

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

          .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
          }

          .action-btn {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: 1px solid var(--border-color);
            padding: 6px 12px;
            border-radius: var(--radius-md);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
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

          .thread-banner {
            background: rgba(188, 140, 255, 0.08);
            border: 1px solid rgba(188, 140, 255, 0.25);
            border-radius: var(--radius-md);
            margin: 16px 24px 0 24px;
            padding: 12px 18px;
          }

          .thread-header-line {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
          }

          .thread-title {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--accent-purple);
            font-size: 13px;
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
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            cursor: pointer;
          }

          .thread-part-btn.active {
            background: var(--accent-purple);
            color: #ffffff;
            font-weight: 600;
          }

          .thread-arrow {
            color: var(--text-muted);
            font-size: 11px;
          }

          .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--border-color);
          }

          .search-input-wrapper {
            position: relative;
            flex: 1;
            max-width: 400px;
          }

          .search-input {
            width: 100%;
            background: var(--input-bg);
            border: 1px solid var(--input-border, var(--border-color));
            color: var(--input-fg);
            padding: 6px 12px 6px 32px;
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
            pointer-events: none;
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

          .toolbar-options {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--text-secondary);
          }

          .artifacts-bar {
            background: rgba(55, 148, 255, 0.08);
            border: 1px solid rgba(55, 148, 255, 0.2);
            border-radius: var(--radius-md);
            margin: 16px 24px 0 24px;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
          }

          .artifacts-title {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--accent-blue);
            font-weight: 600;
            font-size: 13px;
          }

          .artifacts-links {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .artifact-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 4px 10px;
            border-radius: var(--radius-md);
            font-size: 12px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }

          .chat-container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 24px 20px 80px 20px;
            display: flex;
            flex-direction: column;
            gap: 24px;
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

          .avatar-user {
            background: linear-gradient(135deg, var(--accent-blue), #1f6feb);
            color: #ffffff;
          }

          .avatar-ai {
            background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
            color: #ffffff;
          }

          .message-sender-name {
            font-weight: 600;
            color: var(--text-primary);
          }

          .message-time {
            color: var(--text-muted);
            font-size: 11px;
          }

          .session-badge {
            background: rgba(188, 140, 255, 0.15);
            color: var(--accent-purple);
            padding: 1px 6px;
            border-radius: 10px;
            font-size: 10px;
            font-family: var(--font-mono);
          }

          .message-bubble {
            width: 100%;
            background: var(--ai-bubble-bg);
            border: 1px solid var(--ai-bubble-border);
            border-radius: var(--radius-md);
            padding: 14px 18px;
            word-break: break-word;
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

          .markdown-link { color: var(--accent-blue); text-decoration: none; }
          .markdown-link:hover { text-decoration: underline; }
          .markdown-hr { border: none; border-top: 1px solid var(--border-color); margin: 14px 0; }

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
            justify-content: safe center;
            overflow-x: auto;
            background: rgba(0, 0, 0, 0.08);
          }

          .mermaid-body svg {
            max-width: 100%;
            height: auto;
          }

          /* Prevent SVG text clipping on descenders (y, g, p, q, j) */
          .mermaid-body svg .node foreignObject,
          .mermaid-body svg .edgeLabel foreignObject {
            overflow: visible !important;
          }

          .mermaid-body svg .node foreignObject > div,
          .mermaid-body svg .edgeLabel foreignObject > div {
            padding: 4px 8px !important;
            line-height: 1.4 !important;
            box-sizing: border-box;
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

          /* Suppress Mermaid unhandled parse error artifacts injected directly into body without breaking layout/measurement */
          body > div[id^="dmermaid-"],
          body > svg[id^="mermaid-"] {
            position: absolute !important;
            top: -9999px !important;
            left: -9999px !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }

          /* Full Official KaTeX Stylesheet with local fonts */
          ${getKaTeXCss(fontsUri.toString())}

          /* Full Syntax Highlighting & Code Block Stylesheet */
          ${HIGHLIGHT_CSS}

          .markdown-alert {
            border-left: 4px solid;
            border-radius: 0 var(--radius-md) var(--radius-md) 0;
            padding: 10px 14px;
            margin: 14px 0;
            background: rgba(128, 128, 128, 0.08);
          }

          .markdown-alert-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            font-size: 12px;
            margin-bottom: 4px;
            text-transform: uppercase;
          }

          .markdown-alert-note { border-color: var(--accent-blue); }
          .markdown-alert-tip { border-color: var(--accent-green); }
          .markdown-alert-important { border-color: var(--accent-purple); }
          .markdown-alert-warning { border-color: var(--accent-orange); }
          .markdown-alert-caution { border-color: var(--accent-red); }

          .table-container { overflow-x: auto; margin: 14px 0; }
          table { border-collapse: collapse; width: 100%; font-size: 13px; }
          th, td { border: 1px solid var(--border-color); padding: 8px 12px; text-align: left; }
          th { background: var(--bg-secondary); font-weight: 600; }

          details.chat-details {
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            margin: 10px 0;
            overflow: hidden;
            background: var(--bg-primary);
          }

          details.chat-details summary {
            background: var(--bg-secondary);
            padding: 8px 12px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
            transition: background 0.15s;
          }

          details.chat-details summary:hover {
            background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
          }

          .details-inner-content {
            padding: 12px 14px;
            font-size: 13px;
            border-top: 1px solid var(--border-color);
          }

          .tool-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 600;
          }

          .tool-badge.success { background: rgba(56, 138, 52, 0.2); color: var(--accent-green); }
          .tool-badge.error { background: rgba(241, 76, 76, 0.2); color: var(--accent-red); }

          .system-event-card {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 8px 16px;
            background: var(--bg-secondary);
            border: 1px dashed var(--border-color);
            border-radius: var(--radius-md);
            font-size: 12px;
            color: var(--text-secondary);
            margin: 6px 0;
          }

          /* Parent Group Details for Multiple Consecutive Autonomous AI Steps */
          details.autonomous-group-details {
            border: 1px solid var(--border-color);
            border-left: 3px solid var(--accent-purple);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            margin: 4px 0;
            overflow: hidden;
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

          .floating-controls {
            position: fixed;
            bottom: 24px;
            right: 24px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            z-index: 90;
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
            background: var(--btn-bg);
            border: 1px solid var(--border-color);
            color: var(--btn-fg);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--shadow-sm);
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
        </style>
      </head>
      <body data-workspace-path="${MarkdownRenderer.escapeHtml(session.workspacePath || '')}">
        <div id="chatTopSentinel" style="position: absolute; top: 0; left: 0; width: 100%; height: 35px; pointer-events: none; opacity: 0; z-index: -1;"></div>
        <header class="header-container">
          <div class="header-main">
            <div class="header-title-section" style="width: 100%;">
              <h1 class="session-title">
                <span class="session-title-icon">
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                    <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
                  </svg>
                </span>
                <span>${MarkdownRenderer.escapeHtml(this.isShowingCombinedThread ? `Thread: ${session.threadTitle || session.title}` : session.title)}</span>
              </h1>
              <div class="header-meta">
                ${cfg.get<boolean>('autoReloadOnLiveChat', true) ? '<span class="meta-badge green live-badge" title="Live Auto-Reload Active: Automatically syncs when new AI steps arrive"><span class="live-dot"></span>Live</span>' : ''}
                ${typeBadgeHtml}
                <span class="meta-badge blue" title="Timeline: Created ➔ Last Message">${fullTimeStr}</span>
                <span class="meta-badge cyan" title="User chat messages in this session">💬${messages.filter((m) => m.type === 'USER_INPUT').length || session.userPromptCount || session.messageCount || 0}</span>
                <span class="meta-badge purple" title="Total Execution Steps: ${maxStepIndex}">🤖${maxStepIndex}</span>
                ${
                  session.workspaceName
                    ? `<span class="meta-badge ws" title="Project Folder: ${session.workspacePath || session.workspaceName}">📁 ${MarkdownRenderer.escapeHtml(session.workspaceName)}</span>`
                    : ''
                }
                ${
                  session.machineName
                    ? `<span class="meta-badge pc" title="Computer: ${session.machineName}">💻 ${MarkdownRenderer.escapeHtml(session.machineName)}</span>`
                    : ''
                }
                <span class="meta-badge purple" title="Full Session ID: ${session.id}">🆔 ${session.id.length > 8 ? session.id.substring(0, 4) + '...' + session.id.substring(session.id.length - 4) : session.id}</span>
                <span class="meta-badge purple" style="font-family:var(--font-mono);font-size:10.5px;" title="Brain Hub for Antigravity Version">v${this.extensionVersion}</span>
              </div>
              <div class="header-combined-toolbar" style="display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:6px;">
                <button class="action-btn primary icon-only" onclick="copyResumePrompt()" title="Resume session (copy continuation prompt to clipboard)">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M4.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .757.429l8-4.5a.5.5 0 0 0 0-.858l-8-4.5A.5.5 0 0 0 4.5 3z"></path></svg>
                </button>
                <button class="action-btn icon-only" onclick="refreshChat()" title="Reload and re-parse current chat session">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 1 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>
                </button>
                <button class="action-btn icon-only" onclick="copySessionId()" title="Copy Session ID (${session.id}) to clipboard" id="copySessionIdBtn">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>
                </button>
                <button class="action-btn icon-only" onclick="exportMarkdown()" title="Export conversation to Markdown (.md) file">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z"></path><path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z"></path></svg>
                </button>
                <button class="action-btn icon-only" onclick="archiveProjectDocs()" title="Archive project documentation and session logs into .docs/ directory">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11 1h4.25a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.02a2.25 2.25 0 0 0-1.48.55l-.75.65a.75.75 0 0 1-1 0l-.75-.65a2.25 2.25 0 0 0-1.48-.55H.75a.75.75 0 0 1-.75-.75V1.75ZM1.5 2.5v9h3.503a3.75 3.75 0 0 1 2.247.749V3.468A2.25 2.25 0 0 0 5.003 2.5H1.5Zm7.25 9.749A3.75 3.75 0 0 1 11 11.5h3.5v-9h-3.5a2.25 2.25 0 0 0-2.25.968v8.781Z"></path></svg>
                </button>
                <button class="action-btn icon-only" onclick="openFolder()" title="Open session directory in OS File Explorer">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.06 1.26 5.55 1 5 1H1.75Z"></path></svg>
                </button>
                <button class="action-btn danger icon-only" onclick="deleteSession()" title="Permanently delete this chat session from disk">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM2.5 5.5h11v8.75A1.75 1.75 0 0 1 11.75 16h-7.5A1.75 1.75 0 0 1 2.5 14.25V5.5Zm3.5 2.25a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5Zm3.5 0a.75.75 0 0 0-1.5 0v5a.75.75 0 0 0 1.5 0v-5Z"></path></svg>
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

                <div class="search-input-wrapper" style="position:relative; flex:1 1 160px; min-width:160px; max-width:100%;">
                  <svg class="search-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"></path></svg>
                  <input type="text" id="searchInput" class="search-input" style="padding:4px 75px 4px 26px; font-size:12px;" placeholder="Search transcript or #<num>..." oninput="onSearchInputChanged('searchInput')" onfocus="this.select()" title="Filter messages in current chat transcript. Press Enter to cycle matches.">
                  <span id="searchInputCount" class="search-match-count"></span>
                  <button class="clear-search-btn" id="clearSearchInput" onclick="clearSearchInput('searchInput')" title="Clear search">✕</button>
                </div>
              </div>
            </div>
          </div>
        </header>

        ${threadBannerHtml}
        ${artifactsHtml}

        <main class="chat-container" id="chatContainer">
          ${this.groupMessages(displayMessages).map(item => this.renderMessageItem(item, isToolsExpanded, isAiStepsExpanded)).join('\n')}
        </main>

        <div class="floating-controls">
          <button class="float-btn" id="btnChatScrollTop" onclick="scrollToEdge('top')" title="Scroll to top of chat">▲</button>
          <button class="float-btn" id="btnChatScrollBottom" onclick="scrollToEdge('bottom')" title="Scroll to bottom of chat">▼</button>
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
            } else if (e.key === 'Enter') {
              const target = e.target;
              if (target && target.id === 'searchInput') {
                e.preventDefault();
                navigateHighlights(e.shiftKey ? -1 : 1);
              }
            }
          });

          function toggleOrder() { vscode.postMessage({ command: 'toggleMessageOrder' }); }
          let toolsExpanded = ${isToolsExpanded};
          function toggleAllTools() {
            toolsExpanded = !toolsExpanded;
            const detailsList = document.querySelectorAll('#chatContainer details.chat-details');
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
            const stepDetails = document.querySelectorAll('details.autonomous-group-details, details.internal-step-details');
            stepDetails.forEach(d => { d.open = aiStepsExpanded; });
            const btn = document.getElementById('internalToggleBtn');
            if (btn) {
              btn.title = 'Autonomous AI Execution Steps: ' + (aiStepsExpanded ? 'Expanded (Click to collapse)' : 'Collapsed (Click to expand)');
              btn.classList.toggle('active', aiStepsExpanded);
            }
          }
          function copyResumePrompt() { vscode.postMessage({ command: 'copyResumePrompt' }); }
          function copySessionId() { vscode.postMessage({ command: 'copySessionId' }); }
          function exportMarkdown() {
            vscode.postMessage({ command: 'exportMarkdown' });
          }

          function archiveProjectDocs() {
            vscode.postMessage({ command: 'archiveProjectDocs' });
          }

          function openFolder() { vscode.postMessage({ command: 'openFolder' }); }
          function deleteSession() { vscode.postMessage({ command: 'deleteSession' }); }
          function refreshChat() { vscode.postMessage({ command: 'refresh' }); }
          function openFile(encodedPath) { vscode.postMessage({ command: 'openFile', filePath: decodeURI(encodedPath) }); }
          function openRichPreview(encodedPath) { vscode.postMessage({ command: 'openRichPreview', filePath: decodeURI(encodedPath) }); }
          function openIdePreview(encodedPath) { vscode.postMessage({ command: 'openIdePreview', filePath: decodeURI(encodedPath) }); }
          function openSessionById(sessionId) { vscode.postMessage({ command: 'openSessionById', sessionId: sessionId }); }
          function toggleCombinedThread() { vscode.postMessage({ command: 'toggleCombinedThread' }); }

          window.openMediaModal = openMediaModal;
          window.closeMediaModal = closeMediaModal;
          window.toggleOrder = toggleOrder;
          window.toggleAllTools = toggleAllTools;
          window.toggleInternalSteps = toggleInternalSteps;
          window.copyResumePrompt = copyResumePrompt;
          window.copySessionId = copySessionId;
          window.exportMarkdown = exportMarkdown;
          window.archiveProjectDocs = archiveProjectDocs;
          window.openFolder = openFolder;
          window.deleteSession = deleteSession;
          window.refreshChat = refreshChat;
          window.openFile = openFile;
          window.openRichPreview = openRichPreview;
          window.openIdePreview = openIdePreview;
          window.openSessionById = openSessionById;
          window.toggleCombinedThread = toggleCombinedThread;

          let pendingLiveUpdateMessage = null;
          let scrollIdleTimer = null;

          function scrollToEdge(edge) {
            const orderLabel = document.getElementById('orderLabel');
            const isNewestFirst = (orderLabel && orderLabel.textContent && orderLabel.textContent.includes('Oldest')) ? false : true;

            if (edge === 'top') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              const btnTop = document.getElementById('btnChatScrollTop');
              if (btnTop) btnTop.classList.remove('has-new-messages');
              if (isNewestFirst && pendingLiveUpdateMessage) {
                const msgToApply = pendingLiveUpdateMessage;
                pendingLiveUpdateMessage = null;
                setTimeout(() => {
                  applyChatContentUpdate(msgToApply, isNewestFirst, 'top');
                  if (btnTop) btnTop.classList.remove('has-new-messages');
                }, 80);
              }
            } else {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
              const btnBottom = document.getElementById('btnChatScrollBottom');
              if (btnBottom) btnBottom.classList.remove('has-new-messages');
              if (!isNewestFirst && pendingLiveUpdateMessage) {
                const msgToApply = pendingLiveUpdateMessage;
                pendingLiveUpdateMessage = null;
                setTimeout(() => {
                  applyChatContentUpdate(msgToApply, isNewestFirst, 'bottom');
                  if (btnBottom) btnBottom.classList.remove('has-new-messages');
                }, 80);
              }
            }
          }

          function triggerLiveUpdateFX(isNewestFirst) {
            const container = document.getElementById('chatContainer') || document.body;

            // 1. Live badge FX in header
            const liveBadge = document.querySelector('.live-badge');
            if (liveBadge) {
              liveBadge.classList.add('live-badge-active');
              setTimeout(() => {
                liveBadge.classList.remove('live-badge-active');
              }, 2800);
            }

            // 2. Find target latest message element (top-level only) & apply subtle highlight
            const allElements = Array.from(container.querySelectorAll('.message-card, .autonomous-group-details, .internal-step-details, .checkpoint-banner, .subagent-banner, .system-event-banner'));
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
            const targetBtn = document.getElementById(isNewestFirst ? 'btnChatScrollTop' : 'btnChatScrollBottom');
            if (targetBtn) {
              targetBtn.classList.add('has-new-messages');
            }
          }

          function applyChatContentUpdate(message, isNewestFirst, forceScrollEdge) {
            const isLive = !!message.isLiveUpdate;

            const openSteps = new Set();
            document.querySelectorAll('details[open]').forEach(el => {
              const k = el.getAttribute('data-step') || el.getAttribute('data-group-range');
              if (k) openSteps.add(k);
            });

            try {
              const parser = new DOMParser();
              const newDoc = parser.parseFromString(message.html, 'text/html');
              const newMain = newDoc.getElementById('chatContainer');
              const oldMain = document.getElementById('chatContainer');
              if (newMain && oldMain) {
                oldMain.innerHTML = newMain.innerHTML;
              }

              const newHeaderMeta = newDoc.querySelector('.header-meta');
              const oldHeaderMeta = document.querySelector('.header-meta');
              if (newHeaderMeta && oldHeaderMeta) {
                oldHeaderMeta.innerHTML = newHeaderMeta.innerHTML;
              }

              if (openSteps.size > 0) {
                document.querySelectorAll('details').forEach(el => {
                  const k = el.getAttribute('data-step') || el.getAttribute('data-group-range');
                  if (k && openSteps.has(k)) {
                    el.open = true;
                  }
                });
              }

              setTimeout(renderMermaidDiagrams, 80);
              onSearchInputChanged('searchInput');

              const forceEdge = forceScrollEdge || message.forceScrollEdge;
              if (forceEdge === 'top') {
                window.scrollTo({ top: 0, behavior: 'auto' });
              } else if (forceEdge === 'bottom') {
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
              }

              if (isLive) {
                triggerLiveUpdateFX(isNewestFirst);
              } else {
                const header = document.querySelector('.header-container');
                if (header) header.classList.remove('scrolled');
                const btnTop = document.getElementById('btnChatScrollTop');
                const btnBottom = document.getElementById('btnChatScrollBottom');
                if (btnTop) btnTop.classList.remove('has-new-messages');
                if (btnBottom) btnBottom.classList.remove('has-new-messages');
              }
            } catch (err) {
              console.warn('Error during DOM update:', err);
            }
          }

          window.addEventListener('message', async (event) => {
            const message = event.data;
            if (message && message.command === 'updateChatContent' && message.html) {
              const isLive = !!message.isLiveUpdate;
              const scrollY = window.scrollY || document.documentElement.scrollTop;
              const orderLabel = document.getElementById('orderLabel');
              const isNewestFirst = (message.messageOrder || (orderLabel && orderLabel.textContent && orderLabel.textContent.includes('Oldest') ? 'oldestFirst' : 'newestFirst')) === 'newestFirst';

              if (isLive) {
                // If user is actively searching or reading, pause live reload and show floating button pulse!
                const searchInput = document.getElementById('searchInput');
                const isSearching = !!(searchInput && (searchInput.value.trim().length > 0 || document.activeElement === searchInput));

                const isStrictlyAtActiveEdge = !isSearching && (isNewestFirst
                  ? (scrollY <= 30)
                  : (window.innerHeight + scrollY >= document.documentElement.scrollHeight - 30));

                if (!isStrictlyAtActiveEdge) {
                  pendingLiveUpdateMessage = message;
                  const targetBtn = document.getElementById(isNewestFirst ? 'btnChatScrollTop' : 'btnChatScrollBottom');
                  if (targetBtn) {
                    targetBtn.classList.add('has-new-messages');
                  }
                  return;
                }
              }

              // Apply update immediately when strictly at active edge or during manual refresh
              pendingLiveUpdateMessage = null;
              applyChatContentUpdate(message, isNewestFirst, message.forceScrollEdge);
            }
          });

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
                  vscode.postMessage({
                    command: 'openFile',
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
            if (inputId === 'searchInput') {
              filterMessages();
            }
          }

          function clearSearchInput(inputId) {
            const input = document.getElementById(inputId);
            if (input) {
              input.value = '';
              input.focus();
            }
            onSearchInputChanged(inputId);
          }

          let currentHighlightIndex = -1;

          function clearSearchHighlights() {
            currentHighlightIndex = -1;
            const container = document.getElementById('chatContainer');
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
            const container = document.getElementById('chatContainer');
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

            const badge = document.getElementById('searchInputCount');
            if (badge) {
              badge.textContent = (currentHighlightIndex + 1) + '/' + marks.length;
            }
          }

          function filterMessages() {
            const input = document.getElementById('searchInput');
            const badge = document.getElementById('searchInputCount');
            if (!input) return;
            const rawQuery = input.value.trim();
            const lowerQuery = rawQuery.toLowerCase();
            const cards = document.querySelectorAll('.message-card, details.internal-step-details, details.autonomous-group-details, .checkpoint-banner, .subagent-banner, .system-event-banner');

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
            const numMatch = rawQuery.match(/^#\s*(\d+)$/);
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
                const firstUser = document.querySelector('#chatContainer .message-card.user:not(.hidden)');
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
                const firstStep = document.querySelector('#chatContainer .message-card:not(.hidden), #chatContainer details:not(.hidden)');
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
            document.querySelectorAll('#chatContainer mark.search-highlight').forEach(m => {
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

              // 1b. Normalize unsupported bidirectional arrows: NodeA <--> NodeB -> NodeA --> NodeB and NodeB --> NodeA
              if (/<[-=]+>/.test(processed)) {
                const biMatch = processed.match(/^(\\s*)([a-zA-Z0-9_\\-]+)\\s*<[-=]+>\\s*([a-zA-Z0-9_\\-]+)(.*)$/);
                if (biMatch) {
                  const indent = biMatch[1];
                  const leftNode = biMatch[2];
                  const rightNode = biMatch[3];
                  const rest = biMatch[4] || '';
                  return indent + leftNode + ' --> ' + rightNode + rest + '\\n' + indent + rightNode + ' --> ' + leftNode + rest;
                }
              }

              // 2. Subgraph titles: subgraph Sub_Title [My Title: With Colons] or subgraph "My Title: With Colons"
              if (/^\\s*subgraph\\b/i.test(processed)) {
                // 2a. Subgraph with ID and bracketed title: subgraph ID [Title] -> subgraph ID ["Title"]
                processed = processed.replace(/^(\\s*subgraph(?:\\s+[a-zA-Z0-9_\\-]+)?)\\s*\\[([^\\]\\r\\n]+)\\]/i, (match, prefix, title) => {
                  const trimmedTitle = title.trim();
                  if (trimmedTitle.startsWith('"') && trimmedTitle.endsWith('"')) {
                    return match;
                  }
                  const clean = trimmedTitle.replace(/"/g, "'");
                  return prefix + ' ["' + clean + '"]';
                });

                // 2b. Subgraph without brackets: subgraph Title with special chars -> subgraph "Title with special chars"
                processed = processed.replace(/^\\s*subgraph\\s+([^\\["\\r\\n]+)$/i, (m, title) => {
                  const t = title.trim();
                  if (/[ :()\\->&/<>\?\{\}\\[\\]]/.test(t) && !t.startsWith('"')) {
                    const clean = t.replace(/"/g, "'");
                    return 'subgraph "' + clean + '"';
                  }
                  return m;
                });

                // Subgraph declaration line never contains node shapes
                return processed;
              }

              // 3. Hexagon node: id{{label}} -> id{{"label"}}
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\{\\{([^"\\r\\n]+?)\\}\\}/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '{{\"' + clean + '\"}}';
              });

              // 4. Cylinder / Database node: id[(label)] -> id[("label")]
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\[\\(([^"\\r\\n]+?)\\)\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '[(\"' + clean + '\")]';
              });

              // 5. Circle node: id((label)) -> id(("label"))
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\(\\(([^"\\r\\n]+?)\\)\\)/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '((\"' + clean + '\"))';
              });

              // 6. Asymmetric node: id>label] -> id>"label"]
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*>([^"\\r\\n\\[\\]]+)\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '>\"' + clean + '\"]';
              });

              // 7. Parallelogram / Trapezoid: id[/label/] or id[\\label\\]
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\[\\/([^"\\r\\n]+?)\\/\\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '[/\"' + clean + '\"/]';
              });
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\[\\\\([^"\\r\\n]+?)\\\\\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '[\\\\\"' + clean + '\"\\\\]';
              });

              // 8. Rhombus / Decision node: id{label} -> id{"label"}
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\{([^"\\r\\n\{\}]+)\\}/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '{\"' + clean + '\"}';
              });

              // 9. Rectangle node: id[label] -> id["label"]
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\[([^"\\r\\n\\[\\]]+)\\]/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '[\"' + clean + '\"]';
              });

              // 10. Round / Capsule node: id(label) -> id("label")
              processed = processed.replace(/(^|[\\s;,&|>-])([a-zA-Z0-9_]+)\\s*\\(([^"\\r\\n\\(\\)]+)\\)/g, (match, prefix, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return prefix + id + '(\"' + clean + '\")';
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

          function isFullMermaidDiagram(code) {
            if (!code || !code.trim()) return false;
            const lines = code.trim().split(/\\r?\\n/);
            let inFrontmatter = false;
            for (let i = 0; i < lines.length; i++) {
              const trimmed = lines[i].trim();
              if (!trimmed) continue;
              if (trimmed === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
              }
              if (inFrontmatter) continue;
              if (trimmed.startsWith('%%')) continue;
              return /^\\s*(graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|c4context|c4container|c4component|c4dynamic|c4deployment|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta|requirement|requirementDiagram|architecture-beta|packet-beta)\\b/i.test(trimmed);
            }
            return false;
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
                theme: document.body.classList.contains('vscode-light') ? 'neutral' : 'dark',
                securityLevel: 'loose',
                flowchart: {
                  useMaxWidth: true,
                  htmlLabels: true,
                  curve: 'basis',
                  nodeSpacing: 35,
                  rankSpacing: 35,
                  padding: 16
                }
              });
            } catch (e) {}

            const containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
            for (let i = 0; i < containers.length; i++) {
              const el = containers[i];
              el.classList.add('rendered');
              const rawCode = decodeURIComponent(el.getAttribute('data-mermaid') || '');
              if (!isFullMermaidDiagram(rawCode)) {
                continue;
              }
              const preSanitized = el.getAttribute('data-sanitized') ? decodeURIComponent(el.getAttribute('data-sanitized')) : '';
              const sanitizedCode = preSanitized || sanitizeMermaid(rawCode);
              const uniqueId = 'mermaid-' + Math.random().toString(36).substring(2, 9);
              
              let renderedSvg = '';
              let renderErr = null;

              try {
                const res = await mermaid.render(uniqueId, sanitizedCode);
                renderedSvg = res.svg;
              } catch (err1) {
                const tempEl1 = document.getElementById('d' + uniqueId);
                if (tempEl1) tempEl1.remove();

                try {
                  const res2 = await mermaid.render(uniqueId + '-raw', rawCode);
                  renderedSvg = res2.svg;
                } catch (err2) {
                  const tempEl2 = document.getElementById('d' + uniqueId + '-raw');
                  if (tempEl2) tempEl2.remove();
                  renderErr = err1 || err2;
                }
              }

              const leftover1 = document.getElementById('d' + uniqueId);
              if (leftover1) leftover1.remove();
              const leftover2 = document.getElementById('d' + uniqueId + '-raw');
              if (leftover2) leftover2.remove();

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

          let chatObserver = null;
          function initChatScrollObserver() {
            if (chatObserver) {
              chatObserver.disconnect();
              chatObserver = null;
            }
            const sentinel = document.getElementById('chatTopSentinel');
            const header = document.querySelector('.header-container');
            if (!sentinel || !header) return;

            chatObserver = new IntersectionObserver((entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  header.classList.remove('scrolled');
                } else {
                  header.classList.add('scrolled');
                }
              }
            }, {
              root: null,
              rootMargin: '0px',
              threshold: 0
            });
            chatObserver.observe(sentinel);

            if (!window._chatScrollHandlerBound) {
              window._chatScrollHandlerBound = true;
              window.addEventListener('scroll', () => {
                const scrollY = window.scrollY || document.documentElement.scrollTop;
                const orderLabel = document.getElementById('orderLabel');
                const isNewestFirst = (orderLabel && orderLabel.textContent && orderLabel.textContent.includes('Oldest')) ? false : true;
                const isStrictlyAtActiveEdge = isNewestFirst
                  ? (scrollY <= 30)
                  : (window.innerHeight + scrollY >= document.documentElement.scrollHeight - 30);

                const btnTop = document.getElementById('btnChatScrollTop');
                const btnBottom = document.getElementById('btnChatScrollBottom');

                if (scrollY < 60 && !pendingLiveUpdateMessage) {
                  if (btnTop) btnTop.classList.remove('has-new-messages');
                }
                if (scrollY + window.innerHeight >= document.documentElement.scrollHeight - 60 && !pendingLiveUpdateMessage) {
                  if (btnBottom) btnBottom.classList.remove('has-new-messages');
                }

                if (scrollIdleTimer) {
                  clearTimeout(scrollIdleTimer);
                  scrollIdleTimer = null;
                }

                if (isStrictlyAtActiveEdge && pendingLiveUpdateMessage) {
                  scrollIdleTimer = setTimeout(() => {
                    const currentY = window.scrollY || document.documentElement.scrollTop;
                    const stillAtEdge = isNewestFirst
                      ? (currentY <= 30)
                      : (window.innerHeight + currentY >= document.documentElement.scrollHeight - 30);

                    if (stillAtEdge && pendingLiveUpdateMessage) {
                      const msgToApply = pendingLiveUpdateMessage;
                      pendingLiveUpdateMessage = null;
                      applyChatContentUpdate(msgToApply, isNewestFirst, isNewestFirst ? 'top' : 'bottom');
                      if (btnTop) btnTop.classList.remove('has-new-messages');
                      if (btnBottom) btnBottom.classList.remove('has-new-messages');
                    }
                  }, 150);
                }
              }, { passive: true });
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
            initChatScrollObserver();
          });
          setTimeout(() => {
            renderMermaidDiagrams();
            initChatScrollObserver();
          }, 200);
        </script>
      </body>
      </html>
    `;
  }

  private groupMessages(messages: ChatMessage[]): { type: 'single' | 'autonomous_group'; message?: ChatMessage; group?: ChatMessage[] }[] {
    const items: { type: 'single' | 'autonomous_group'; message?: ChatMessage; group?: ChatMessage[] }[] = [];
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

  private renderMessageItem(item: { type: 'single' | 'autonomous_group'; message?: ChatMessage; group?: ChatMessage[] }, isToolsExpanded: boolean = false, isAiStepsExpanded: boolean = false): string {
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
        <details class="chat-details thinking-details" ${isToolsExpanded ? 'open' : ''}>
          <summary title="Click to view AI reasoning and plan">
            <span>🧠</span>
            <span>Model Reasoning & Planning</span>
          </summary>
          <div class="details-inner-content">
            <div class="markdown-content">
              ${MarkdownRenderer.render(msg.thinking)}
            </div>
          </div>
        </details>
      `;
    }

    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      toolCallsHtml = msg.toolCalls
        .map((tc) => this.renderToolCall(tc, isToolsExpanded))
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
        <div class="internal-step-body" style="padding:10px 12px;">
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
      return this.renderUserMessage(msg);
    } else if (msg.type === 'PLANNER_RESPONSE' || msg.source === 'MODEL') {
      return this.renderAiMessage(msg, isToolsExpanded);
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

  private renderUserMessage(msg: ChatMessage): string {
    const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('en-US') : `Step #${msg.index}`;
    const rawUserMsg = msg.cleanContent || msg.content || '';
    const directiveProcessed = MarkdownRenderer.preprocessUserDirectives(rawUserMsg);
    const renderedContent = MarkdownRenderer.render(directiveProcessed);
    const sessionOriginBadge = msg.sessionOriginId && this.isShowingCombinedThread
      ? `<span class="session-badge">Session ${msg.sessionOriginId.substring(0, 8)}</span>`
      : '';
    const userLabel = msg.userIndex ? `User #${msg.userIndex}` : 'User';
    const rawUserMsgEncoded = encodeURIComponent(rawUserMsg);

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
          <span class="message-sender-name">${userLabel}</span>
          <span class="message-time">${timeStr}</span>
          ${sessionOriginBadge}
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
            ${renderedContent}
          </div>
        </div>
      </div>
    `;
  }

  private renderAiMessage(msg: ChatMessage, isToolsExpanded: boolean = false): string {
    const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('en-US') : `Step #${msg.index}`;
    const textToRender = (msg.cleanContent !== undefined ? msg.cleanContent : msg.content) || '';
    const renderedContent = textToRender ? MarkdownRenderer.render(textToRender) : '';
    const sessionOriginBadge = msg.sessionOriginId && this.isShowingCombinedThread
      ? `<span class="session-badge">Session ${msg.sessionOriginId.substring(0, 8)}</span>`
      : '';

    let thinkingHtml = '';
    if (msg.thinking) {
      thinkingHtml = `
        <details class="chat-details thinking-details" ${isToolsExpanded ? 'open' : ''}>
          <summary title="Click to view AI reasoning and plan">
            <span>🧠</span>
            <span>Model Reasoning & Planning</span>
          </summary>
          <div class="details-inner-content">
            <div class="markdown-content">
              ${MarkdownRenderer.render(msg.thinking)}
            </div>
          </div>
        </details>
      `;
    }

    let toolCallsHtml = '';
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      toolCallsHtml = msg.toolCalls
        .map((tc) => this.renderToolCall(tc, isToolsExpanded))
        .join('\n');
    }

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
          ${sessionOriginBadge}
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
          ${renderedContent ? `<div class="markdown-content">${renderedContent}</div>` : ''}
        </div>
      </div>
    `;
  }

  private renderToolCall(tool: ToolCallInfo, isOpen: boolean = false): string {
    const isSuccess = tool.exitCode === 0 || tool.status === 'DONE' || !tool.exitCode;
    const badgeClass = isSuccess ? 'success' : 'error';
    const badgeText = isSuccess ? 'Success' : `Exit ${tool.exitCode}`;

    let argsPreview = '';
    if (tool.args) {
      if (typeof tool.args === 'object') {
        const firstVal = Object.values(tool.args)[0];
        if (typeof firstVal === 'string') {
          argsPreview = firstVal.substring(0, 60);
        }
      } else if (typeof tool.args === 'string') {
        argsPreview = tool.args.substring(0, 60);
      }
    }

    let argsJson = '';
    if (tool.args) {
      argsJson = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
    }

    return `
      <details class="chat-details tool-details" ${isOpen ? 'open' : ''}>
        <summary>
          <span>⚙️</span>
          <span><b>Tool:</b> <code>${tool.name}</code></span>
          ${argsPreview ? `<span style="color:var(--text-muted);font-weight:normal;">(${MarkdownRenderer.escapeHtml(argsPreview)}...)</span>` : ''}
          <span class="tool-badge ${badgeClass}" style="margin-left:auto;">${badgeText}</span>
        </summary>
        <div class="details-inner-content">
          ${
            argsJson
              ? `
            <div style="margin-bottom:8px;">
              <span style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;">Arguments:</span>
              ${MarkdownRenderer.renderCodeBlock(argsJson, 'json')}
            </div>`
              : ''
          }
          ${
            tool.output
              ? `
            <div>
              <span style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;">Output:</span>
              ${MarkdownRenderer.renderCodeBlock(tool.output, 'shell')}
            </div>`
              : ''
          }
        </div>
      </details>
    `;
  }
}
