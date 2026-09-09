import * as vscode from 'vscode';
import * as path from 'path';
import { ChatHistoryTreeProvider, SessionTreeItem } from './providers/ChatHistoryTreeProvider';
import { ChatWebviewPanel } from './views/ChatWebviewPanel';
import { DashboardWebviewPanel } from './views/DashboardWebviewPanel';
import { SessionScanner } from './services/SessionScanner';
import { MarkdownExporter } from './services/MarkdownExporter';
import { ProjectDocsArchiver } from './services/ProjectDocsArchiver';
import { GitSyncService } from './services/GitSyncService';
import { ChatSession } from './models/types';
import { MarkdownPreviewWebviewPanel } from './views/MarkdownPreviewWebviewPanel';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('Brain Hub for Antigravity extension is activating in background...');
  DashboardWebviewPanel.setGlobalContext(context);

  // 1. Initialize Persistent Index Cache Storage
  const scanner = SessionScanner.getInstance();
  scanner.setStoragePath(context.globalStorageUri.fsPath);

  const treeProvider = new ChatHistoryTreeProvider();
  DashboardWebviewPanel.setTreeProvider(treeProvider);
  const treeView = vscode.window.createTreeView('antigravityHistory.treeView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);

  // Auto open full-page Dashboard whenever user clicks the Antigravity icon on Activity Bar
  treeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      const autoOpen = vscode.workspace
        .getConfiguration('antigravityHistory')
        .get<boolean>('autoOpenDashboardOnSidebarFocus', true);
      if (autoOpen) {
        vscode.commands.executeCommand('antigravityHistory.openDashboard');
      }
    }
  });

  const gitSync = GitSyncService.getInstance();

  // 2. Setup Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'antigravityHistory.syncNow';
  statusBarItem.text = '$(github) Brain Hub Sync';

  const updateStatusBar = () => {
    const info = gitSync.getLastSyncInfo();
    let tooltip = 'Brain Hub for Antigravity: Click to Sync with GitHub';
    if (info.lastSyncTimestamp > 0) {
      const timeStr = info.lastSyncTimeStr || new Date(info.lastSyncTimestamp).toLocaleString();
      tooltip += `\nLast successful sync: ${timeStr}`;
    } else {
      tooltip += '\nLast successful sync: Never';
    }
    statusBarItem.tooltip = tooltip;
  };

  const updateTreeViewHeader = () => {
    const wsFolders = vscode.workspace.workspaceFolders;
    const wsName = wsFolders && wsFolders.length > 0 ? wsFolders[0].name : '';
    const info = gitSync.getLastSyncInfo();
    const timeStr = info.lastSyncTimestamp > 0
      ? (info.lastSyncTimeStr || new Date(info.lastSyncTimestamp).toLocaleTimeString())
      : 'Never';

    const parts: string[] = [];
    if (wsName) {
      parts.push(`📁 ${wsName}`);
    }
    parts.push(`🔄 Sync: ${timeStr}`);
    treeView.description = parts.join(' | ');
  };

  updateStatusBar();
  updateTreeViewHeader();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateTreeViewHeader();
    })
  );

  const onSessionsDataChanged = () => {
    treeProvider.refresh();
    updateTreeViewHeader();
    if (DashboardWebviewPanel.currentPanel) {
      DashboardWebviewPanel.currentPanel.updateContent();
    }
  };

  // 3. Listen to Sync events
  gitSync.onDidSync(() => {
    updateStatusBar();
    updateTreeViewHeader();
    onSessionsDataChanged();
  });

  // 4. Background Startup Execution, Auto-Scan & Auto-Sync
  const autoSyncOnStartup = vscode.workspace
    .getConfiguration('antigravityHistory')
    .get<boolean>('autoSyncOnStartup', true);

  const autoSyncIntervalMinutes = vscode.workspace
    .getConfiguration('antigravityHistory')
    .get<number>('autoSyncIntervalMinutes', 30);

  const backgroundScanIntervalMinutes = vscode.workspace
    .getConfiguration('antigravityHistory')
    .get<number>('backgroundScanIntervalMinutes', 5);

  const enableRealtimeWatcher = vscode.workspace
    .getConfiguration('antigravityHistory')
    .get<boolean>('enableRealtimeWatcher', true);

  // Pre-scan in background to warm up memory cache
  setTimeout(async () => {
    await scanner.scanSessions();
    onSessionsDataChanged();

    if (autoSyncOnStartup) {
      statusBarItem.text = '$(sync~spin) Brain Hub Syncing...';
      const success = await gitSync.syncSilently(5);
      statusBarItem.text = '$(github) Brain Hub Sync';
      updateStatusBar();
    }
  }, 1000);

  // Start real-time shallow folder watcher for new chat sessions
  if (enableRealtimeWatcher) {
    scanner.startRealtimeWatcher(onSessionsDataChanged);
  }

  // Start periodic background scan timer (default 5 minutes)
  if (backgroundScanIntervalMinutes > 0) {
    scanner.startBackgroundScanTimer(backgroundScanIntervalMinutes, onSessionsDataChanged);
  }

  // Start periodic Git auto-sync timer (default 30 minutes)
  if (autoSyncIntervalMinutes > 0) {
    gitSync.startAutoSyncTimer(autoSyncIntervalMinutes);
  }

  // Auto refresh when window gains focus
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async (state) => {
      if (state.focused) {
        const autoRefreshOnFocus = vscode.workspace
          .getConfiguration('antigravityHistory')
          .get<boolean>('autoRefreshOnWindowFocus', true);
        if (autoRefreshOnFocus) {
          await scanner.scanSessions(false);
          onSessionsDataChanged();
        }
      }
    })
  );

  // Listen to settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('antigravityHistory.autoSyncIntervalMinutes')) {
        const newInterval = vscode.workspace
          .getConfiguration('antigravityHistory')
          .get<number>('autoSyncIntervalMinutes', 30);
        gitSync.startAutoSyncTimer(newInterval);
      }

      if (e.affectsConfiguration('antigravityHistory.backgroundScanIntervalMinutes')) {
        const newScanInterval = vscode.workspace
          .getConfiguration('antigravityHistory')
          .get<number>('backgroundScanIntervalMinutes', 5);
        scanner.startBackgroundScanTimer(newScanInterval, onSessionsDataChanged);
      }

      if (e.affectsConfiguration('antigravityHistory.enableRealtimeWatcher')) {
        const enabled = vscode.workspace
          .getConfiguration('antigravityHistory')
          .get<boolean>('enableRealtimeWatcher', true);
        if (enabled) {
          scanner.startRealtimeWatcher(onSessionsDataChanged);
        } else {
          scanner.stopRealtimeWatcher();
        }
      }
    })
  );

  // Command: Open Settings UI
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openSettings', async () => {
      if (DashboardWebviewPanel.currentPanel) {
        DashboardWebviewPanel.currentPanel.reveal();
        DashboardWebviewPanel.currentPanel.openSettingsModal();
      } else {
        DashboardWebviewPanel.createOrShow(context.extensionUri, undefined, true);
      }
    })
  );

  // Command: Open Brain Hub Dashboard (Ctrl+Alt+D)
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openDashboard', async (item?: SessionTreeItem | ChatSession | string) => {
      let sessionId: string | undefined;
      if (item instanceof SessionTreeItem) {
        sessionId = item.session.id;
      } else if (item && typeof item === 'object' && 'id' in item) {
        sessionId = (item as ChatSession).id;
      } else if (typeof item === 'string') {
        sessionId = item;
      }
      DashboardWebviewPanel.createOrShow(context.extensionUri, sessionId);
    })
  );

  // Command: Sync with GitHub (1-Click Pull & Push)
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.syncNow', async () => {
      statusBarItem.text = '$(sync~spin) Syncing...';
      try {
        await gitSync.syncWithRemote();
        treeProvider.refresh();
        if (DashboardWebviewPanel.currentPanel) {
          DashboardWebviewPanel.currentPanel.updateContent();
        }
      } finally {
        statusBarItem.text = '$(github) Brain Hub Sync';
        updateStatusBar();
      }
    })
  );

  // Command: Setup GitHub Backup Repository
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.setupGitSync', async () => {
      await gitSync.promptSetup();
      treeProvider.refresh();
      if (DashboardWebviewPanel.currentPanel) {
        DashboardWebviewPanel.currentPanel.updateContent();
      }
    })
  );

  // Command: Check GitHub Sync Status
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.checkGitStatus', async () => {
      const status = await gitSync.getStatus();
      if (!status.isRepo) {
        const opt = await vscode.window.showInformationMessage(
          'GitHub backup is not configured yet.',
          'Setup GitHub Sync',
          'Close'
        );
        if (opt === 'Setup GitHub Sync') {
          await gitSync.promptSetup();
        }
      } else {
        const info = gitSync.getLastSyncInfo();
        const lastSyncDisplay = info.lastSyncTimestamp > 0
          ? (info.lastSyncTimeStr || new Date(info.lastSyncTimestamp).toLocaleString())
          : 'Never';
        const msg = [
          `📦 Git Repository: Initialized`,
          `🌿 Current Branch: ${status.branch}`,
          `🌐 Remote URL: ${status.remoteUrl || 'None'}`,
          `📝 Uncommitted files: ${status.uncommittedFilesCount}`,
          `⏱️ Last successful sync: ${lastSyncDisplay}`
        ].join('\n');

        const opt = await vscode.window.showInformationMessage(msg, { modal: true }, 'Sync Now', 'Close');
        if (opt === 'Sync Now') {
          await gitSync.syncWithRemote();
        }
      }
    })
  );

  // Command: Refresh History
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.refresh', async () => {
      await scanner.scanSessions(true);
      treeProvider.refresh();
      if (DashboardWebviewPanel.currentPanel) {
        await DashboardWebviewPanel.currentPanel.updateContent();
      }
      vscode.window.showInformationMessage('Antigravity sessions refreshed.');
    })
  );

  // Command: Quick Search
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.searchChat', async () => {
      const panel = DashboardWebviewPanel.createOrShow(context.extensionUri, undefined, false, true);
      panel.focusSearchInput();
    })
  );

  // Command: Toggle Workspace Filter
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.toggleWorkspaceFilter', () => {
      const isFiltered = treeProvider.toggleWorkspaceFilter();
      if (DashboardWebviewPanel.currentPanel) {
        DashboardWebviewPanel.currentPanel.setFiltersState(isFiltered, undefined);
      }
      vscode.window.showInformationMessage(
        isFiltered
          ? 'Chat history filtered by current workspace.'
          : 'Showing all chat history across all workspaces.'
      );
    })
  );

  // Command: Toggle Hide Empty Sessions Filter
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.toggleHideEmptySessions', async () => {
      const isHidden = await treeProvider.toggleHideEmptyFilter();
      if (DashboardWebviewPanel.currentPanel) {
        DashboardWebviewPanel.currentPanel.setFiltersState(undefined, isHidden);
      }
      vscode.window.showInformationMessage(
        isHidden
          ? 'Empty chat sessions are now hidden (0 messages).'
          : 'Showing all chat sessions, including empty ones.'
      );
    })
  );

  // Command: Clean Up Empty Sessions
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.cleanEmptySessions', async () => {
      const emptyDirs = await scanner.findEmptySessionDirs();
      if (emptyDirs.length === 0) {
        vscode.window.showInformationMessage('No empty chat sessions found. Your chat history is already clean! ✨');
        return;
      }

      const answer = await vscode.window.showWarningMessage(
        `Found ${emptyDirs.length} empty chat session directory(s) (no messages or logs).\nDo you want to permanently delete them from disk?`,
        { modal: true },
        'Delete Empty Chats',
        'Cancel'
      );

      if (answer === 'Delete Empty Chats') {
        const result = await scanner.cleanEmptySessions();
        await scanner.scanSessions(true);
        treeProvider.refresh();
        if (DashboardWebviewPanel.currentPanel) {
          await DashboardWebviewPanel.currentPanel.updateContent(true);
        }
        vscode.window.showInformationMessage(`Successfully cleaned up ${result.deletedCount} empty chat session(s). 🧹`);
      }
    })
  );

  // Command: Delete Individual Chat Session
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.deleteSession', async (item?: SessionTreeItem | ChatSession | string) => {
      let session: ChatSession | undefined;
      let sessionId: string | undefined;

      if (item instanceof SessionTreeItem) {
        session = item.session;
        sessionId = item.session.id;
      } else if (item && typeof item === 'object' && 'id' in item) {
        session = item as ChatSession;
        sessionId = (item as ChatSession).id;
      } else if (typeof item === 'string') {
        sessionId = item;
        const sessions = await scanner.scanSessions(false, true);
        session = sessions.find((s) => s.id === sessionId);
      }

      if (!sessionId) {
        return;
      }

      const sessionTitle = session?.title || `Session ${sessionId.substring(0, 8)}`;
      const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to permanently delete chat session "${sessionTitle}" (${sessionId}) from disk?\n\nThis cannot be undone.`,
        { modal: true },
        'Delete Chat Session',
        'Cancel'
      );

      if (answer === 'Delete Chat Session') {
        const deleted = await scanner.deleteSession(sessionId);
        if (deleted) {
          await scanner.scanSessions(true);
          treeProvider.refresh();
          if (DashboardWebviewPanel.currentPanel) {
            await DashboardWebviewPanel.currentPanel.updateContent(true);
          }
          vscode.window.showInformationMessage(`Deleted chat session "${sessionTitle}". 🗑️`);
        } else {
          vscode.window.showWarningMessage(`Could not find or delete session ${sessionId}.`);
        }
      }
    })
  );

  // Command: Open Chat Viewer (Dedicated Chat Tab)
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openChat', async (item?: SessionTreeItem | ChatSession | string) => {
      let session: ChatSession | undefined;
      if (item instanceof SessionTreeItem) {
        session = item.session;
      } else if (item && typeof item === 'object' && 'id' in item) {
        session = item;
      } else if (typeof item === 'string') {
        const sData = await SessionScanner.getInstance().loadFullSession(item);
        if (sData) {
          session = sData.session;
        }
      }

      if (session) {
        DashboardWebviewPanel.createOrShow(context.extensionUri, session.id);
      }
    })
  );

  // Command: Copy Resume Prompt
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.copyResumePrompt', async (item?: SessionTreeItem | ChatSession) => {
      const session = item instanceof SessionTreeItem ? item.session : item;
      if (session) {
        const prompt = `Hãy đọc lại ngữ cảnh hội thoại trước đó của phiên làm việc tại thư mục:\n\`${session.path}\`\n(Session ID: \`${session.id}\` - Chủ đề: "${session.title}")\nvà tiếp tục hỗ trợ tôi.`;
        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('Resume prompt copied to clipboard! Paste it into a new Antigravity chat.');
      }
    })
  );

  // Command: Copy Session ID
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.copySessionId', async (item?: SessionTreeItem | ChatSession) => {
      const session = item instanceof SessionTreeItem ? item.session : item;
      if (session) {
        await vscode.env.clipboard.writeText(session.id);
        vscode.window.showInformationMessage(`Copied Session ID: ${session.id}`);
      }
    })
  );

  // Command: Export Markdown
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.exportMarkdown', async (item?: SessionTreeItem | ChatSession) => {
      const session = item instanceof SessionTreeItem ? item.session : item;
      if (session) {
        await MarkdownExporter.exportSession(session);
      }
    })
  );

  // Command: Open Folder in Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openFolder', async (item?: SessionTreeItem | ChatSession) => {
      const session = item instanceof SessionTreeItem ? item.session : item;
      if (session) {
        await vscode.env.openExternal(vscode.Uri.file(session.path));
      }
    })
  );

  // Command: Export Project Docs to .docs/
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.exportProjectDocs', async () => {
      const activeWs = ProjectDocsArchiver.getActiveWorkspacePath();
      if (!activeWs) {
        vscode.window.showWarningMessage('Please open a workspace folder first to archive project docs.');
        return;
      }

      const config = vscode.workspace.getConfiguration('antigravityHistory');
      let chosenMode = config.get<string>('archiver.defaultMode', 'askEachTime');

      if (chosenMode === 'askEachTime') {
        const selection = await vscode.window.showQuickPick(
          [
            {
              label: '$(shield) Safe Architecture Docs Only (Recommended)',
              description: 'Plans, walkthroughs, diagrams & research only',
              detail: '🛡️ Safe for Git: Excludes raw AI chat transcripts and scratch files to prevent credential leaks.',
              mode: 'safeDocsOnly' as const
            },
            {
              label: '$(lock) Full Archive with Secret Redaction',
              description: 'All artifacts + session logs with API keys & passwords masked',
              detail: '🔒 Automatically adds .docs/logs/ & .docs/scratch/ to .gitignore and masks all API keys & secrets.',
              mode: 'fullWithSanitization' as const
            },
            {
              label: '$(warning) Full Raw Archive (Caution)',
              description: 'Raw transcripts & logs without masking',
              detail: '⚠️ Caution: May contain exposed credentials if committed to Git.',
              mode: 'fullRaw' as const
            }
          ],
          {
            placeHolder: 'Select Project Documentation Archival Security Mode',
            title: 'Archive Antigravity Project Docs (.docs/)'
          }
        );

        if (!selection) {
          return;
        }
        chosenMode = selection.mode;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Archiving Antigravity project documentation to .docs/...',
          cancellable: false
        },
        async () => {
          const result = await ProjectDocsArchiver.archiveWorkspaceDocs(activeWs, {
            mode: chosenMode as any
          });
          if (result.success) {
            const gitMsg = result.gitignored ? ' (🔒 .gitignore updated)' : '';
            const opt = await vscode.window.showInformationMessage(
              `✅ ${result.message}${gitMsg}`,
              'Open .docs Folder',
              'View INDEX.md'
            );
            if (opt === 'Open .docs Folder') {
              vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(activeWs, '.docs')));
            } else if (opt === 'View INDEX.md') {
              const indexUri = vscode.Uri.file(path.join(activeWs, '.docs', 'INDEX.md'));
              const doc = await vscode.workspace.openTextDocument(indexUri);
              await vscode.window.showTextDocument(doc);
            }
          } else {
            vscode.window.showWarningMessage(`Antigravity Docs Archival: ${result.message}`);
          }
        }
      );
    })
  );

  // Command: Batch Export All Workspace Sessions to Markdown
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.exportAllWorkspaceSessions', async () => {
      const activeWs = ProjectDocsArchiver.getActiveWorkspacePath();
      const allSessions = await scanner.scanSessions();
      let targetSessions = allSessions;

      if (activeWs) {
        const wsLower = activeWs.toLowerCase().replace(/\\/g, '/');
        targetSessions = allSessions.filter((s) => {
          if (!s.workspacePath) return false;
          const sWsLower = s.workspacePath.toLowerCase().replace(/\\/g, '/');
          return sWsLower === wsLower || wsLower.startsWith(sWsLower) || sWsLower.startsWith(wsLower);
        });
      }

      if (targetSessions.length === 0) {
        vscode.window.showWarningMessage('No sessions found to export.');
        return;
      }

      await MarkdownExporter.exportBatchSessions(targetSessions);
    })
  );

  // Command: Brain Hub: Open Rich Markdown Preview (Mermaid & KaTeX)
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openRichMarkdownPreview', async (uri?: vscode.Uri) => {
      let targetPath: string | undefined;
      if (uri instanceof vscode.Uri) {
        targetPath = uri.fsPath;
      } else if (vscode.window.activeTextEditor) {
        targetPath = vscode.window.activeTextEditor.document.uri.fsPath;
      }

      if (targetPath) {
        MarkdownPreviewWebviewPanel.createOrShow(context.extensionUri, targetPath);
      } else {
        vscode.window.showWarningMessage('No active Markdown file selected to preview.');
      }
    })
  );

  // Command: Open with IDE Markdown Preview
  context.subscriptions.push(
    vscode.commands.registerCommand('antigravityHistory.openIdeMarkdownPreview', async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }

      if (targetUri) {
        await vscode.commands.executeCommand('markdown.showPreview', targetUri);
      }
    })
  );
}

export function deactivate() {
  GitSyncService.getInstance().stopAutoSyncTimer();
  SessionScanner.getInstance().stopRealtimeWatcher();
  SessionScanner.getInstance().stopBackgroundScanTimer();
}
