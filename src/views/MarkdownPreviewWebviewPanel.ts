import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { HIGHLIGHT_CSS } from '../services/HighlightStyles';
import { getKaTeXCss } from '../services/KaTeXStyles';

export class MarkdownPreviewWebviewPanel {
  public static readonly viewType = 'antigravityMarkdownPreview';
  private static readonly panels: Map<string, MarkdownPreviewWebviewPanel> = new Map();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly filePath: string;
  private disposables: vscode.Disposable[] = [];
  private fsWatcher?: fs.FSWatcher;

  public static createOrShow(extensionUri: vscode.Uri, filePath: string, viewColumn?: vscode.ViewColumn): MarkdownPreviewWebviewPanel {
    const normalizedPath = path.normalize(filePath);
    const existing = MarkdownPreviewWebviewPanel.panels.get(normalizedPath);
    if (existing) {
      existing.panel.reveal(viewColumn || existing.panel.viewColumn || vscode.ViewColumn.Active);
      existing.update();
      return existing;
    }

    const fileName = path.basename(normalizedPath);
    const targetColumn = viewColumn || (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);

    const panel = vscode.window.createWebviewPanel(
      MarkdownPreviewWebviewPanel.viewType,
      `Preview: ${fileName}`,
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          vscode.Uri.file(path.dirname(normalizedPath)),
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || [])
        ]
      }
    );

    const previewPanel = new MarkdownPreviewWebviewPanel(panel, extensionUri, normalizedPath);
    MarkdownPreviewWebviewPanel.panels.set(normalizedPath, previewPanel);
    return previewPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, filePath: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.filePath = filePath;

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg')
    };

    this.update();

    // Listen to webview disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the Webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'openInEditor':
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.filePath));
              await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to open file: ${err?.message || err}`);
            }
            return;

          case 'openIdePreview':
            try {
              await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(this.filePath));
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to open IDE preview: ${err?.message || err}`);
            }
            return;

          case 'openFile':
            if (message.filePath) {
              try {
                let target = message.filePath;
                if (target.startsWith('file://')) {
                  target = decodeURIComponent(target.replace(/^file:\/\/\/?/i, ''));
                }
                const isMd = target.toLowerCase().endsWith('.md') || target.toLowerCase().endsWith('.markdown');
                if (isMd) {
                  MarkdownPreviewWebviewPanel.createOrShow(this.extensionUri, target);
                } else {
                  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
                  await vscode.window.showTextDocument(doc, { preview: false });
                }
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open target file: ${err?.message || err}`);
              }
            }
            return;

          case 'copyText':
            if (message.text) {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(message.toast || 'Copied to clipboard!');
            }
            return;

          case 'refresh':
            this.update();
            return;
        }
      },
      null,
      this.disposables
    );

    // Setup live document update listeners (hot-reload when editing in VS Code)
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (path.normalize(e.document.uri.fsPath) === this.filePath) {
          this.update();
        }
      },
      null,
      this.disposables
    );

    vscode.workspace.onDidSaveTextDocument(
      (doc) => {
        if (path.normalize(doc.uri.fsPath) === this.filePath) {
          this.update();
        }
      },
      null,
      this.disposables
    );

    // Backup fs.watchFile
    try {
      this.fsWatcher = fs.watch(this.filePath, (event) => {
        if (event === 'change') {
          this.update();
        }
      });
    } catch {}
  }

  public update(): void {
    if (!fs.existsSync(this.filePath)) {
      this.panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head><style>body{font-family:sans-serif;padding:24px;color:var(--vscode-errorForeground);}</style></head>
        <body>
          <h2>File Not Found</h2>
          <p>The file <code>${MarkdownRenderer.escapeHtml(this.filePath)}</code> does not exist on disk.</p>
        </body>
        </html>
      `;
      return;
    }

    try {
      // If the document is open and dirty in editor, read from VS Code text buffer, else read from disk
      let content = '';
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => path.normalize(d.uri.fsPath) === this.filePath
      );
      if (openDoc) {
        content = openDoc.getText();
      } else {
        content = fs.readFileSync(this.filePath, 'utf8');
      }

      const fileDir = path.dirname(this.filePath);
      const renderedHtml = MarkdownRenderer.render(content, fileDir);
      this.panel.webview.html = this.generateHtml(renderedHtml, content);
    } catch (err: any) {
      this.panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head><style>body{font-family:sans-serif;padding:24px;color:var(--vscode-errorForeground);}</style></head>
        <body>
          <h2>Error Loading Markdown</h2>
          <p>${MarkdownRenderer.escapeHtml(err?.message || String(err))}</p>
        </body>
        </html>
      `;
    }
  }

  private generateHtml(renderedHtml: string, rawMarkdown: string): string {
    const fileName = path.basename(this.filePath);
    const fileDir = path.dirname(this.filePath);
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
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Preview: ${MarkdownRenderer.escapeHtml(fileName)}</title>
        <link rel="stylesheet" href="${codiconUri}">
        <style>
          ${getKaTeXCss(fontsUri.toString())}
        </style>
        <script src="${mermaidUri}"></script>
        <script>
          if (typeof mermaid === 'undefined') {
            // Online CDN fallback if local resource was not loaded
            document.write('<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"><\\/script>');
          }
        </script>
        <style>
          ${HIGHLIGHT_CSS}
        </style>
        <style>
          :root {
            --bg-primary: var(--vscode-editor-background, #1e1e1e);
            --bg-secondary: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, #252526));
            --bg-tertiary: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-input-background, #2d2d2d));
            --border-color: var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.22)));
            --border-hover: var(--vscode-focusBorder, #007acc);
            --text-primary: var(--vscode-editor-foreground, #cccccc);
            --text-secondary: var(--vscode-descriptionForeground, #888888);
            --text-muted: var(--vscode-disabledForeground, #666666);
            --accent-blue: var(--vscode-textLink-foreground, #38bdf8);
            --accent-cyan: var(--vscode-charts-cyan, #29b8db);
            --accent-purple: var(--vscode-charts-purple, #b180d7);
            --accent-green: var(--vscode-charts-green, #388a34);
            --accent-orange: var(--vscode-charts-orange, #d18616);
            --accent-red: var(--vscode-errorForeground, #f14c4c);
            --code-bg: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.25));
            --btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
            --btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
            --btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
            --btn-primary-bg: var(--vscode-button-background, #0e639c);
            --btn-primary-fg: var(--vscode-button-foreground, #ffffff);
            --btn-primary-hover: var(--vscode-button-hoverBackground, #1177bb);
            --radius-sm: 4px;
            --radius-md: 6px;
            --radius-lg: 10px;
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
          }

          body.vscode-light {
            --code-bg: rgba(0, 0, 0, 0.05);
            --border-color: rgba(0, 0, 0, 0.12);
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: var(--font-family);
            font-size: 14px;
            line-height: 1.65;
            padding: 0;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            overflow-x: hidden;
          }

          /* Sticky Top Toolbar */
          .preview-toolbar {
            position: sticky;
            top: 0;
            z-index: 1000;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          }

          .toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            flex: 1 1 auto;
          }

          .file-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(56, 189, 248, 0.12);
            color: var(--accent-blue);
            border: 1px solid rgba(56, 189, 248, 0.3);
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            font-weight: 600;
            font-size: 12px;
            white-space: nowrap;
          }

          .file-breadcrumb {
            font-size: 12px;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: var(--font-mono);
          }

          .toolbar-right {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }

          /* Mode Switcher for Mermaid (Original vs Sanitized) */
          .mermaid-switcher {
            display: inline-flex;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 2px;
            gap: 2px;
            margin-right: 6px;
          }

          .mermaid-mode-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            padding: 3px 10px;
            border-radius: 16px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 4px;
          }

          .mermaid-mode-btn:hover {
            color: var(--text-primary);
          }

          .mermaid-mode-btn.active {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-fg);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
          }

          .action-btn {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: 1px solid var(--border-color);
            padding: 4px 10px;
            border-radius: var(--radius-md);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transition: all 0.15s;
            white-space: nowrap;
          }

          .action-btn:hover {
            background: var(--btn-hover);
            border-color: var(--border-hover);
          }

          .action-btn.icon-only {
            padding: 4px 7px;
          }

          .action-btn.primary {
            background: var(--btn-primary-bg);
            color: var(--btn-primary-fg);
            border-color: transparent;
          }

          .action-btn.primary:hover {
            background: var(--btn-primary-hover);
          }

          /* Main Article Content Container */
          .preview-container {
            max-width: 980px;
            width: 100%;
            margin: 0 auto;
            padding: 32px 36px 80px 36px;
            flex: 1;
          }

          .markdown-content {
            color: var(--text-primary);
            word-wrap: break-word;
            line-height: 1.7;
          }

          .markdown-content h1,
          .markdown-content h2,
          .markdown-content h3,
          .markdown-content h4,
          .markdown-content h5,
          .markdown-content h6 {
            color: var(--text-primary);
            font-weight: 700;
            margin-top: 28px;
            margin-bottom: 12px;
            line-height: 1.35;
          }

          .markdown-content h1 {
            font-size: 24px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 8px;
            margin-top: 8px;
          }

          .markdown-content h2 {
            font-size: 19px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 6px;
          }

          .markdown-content h3 { font-size: 16px; }
          .markdown-content h4 { font-size: 14.5px; }

          .markdown-content p {
            margin-bottom: 14px;
          }

          .markdown-content ul,
          .markdown-content ol {
            margin-bottom: 14px;
            padding-left: 24px;
          }

          .markdown-content li {
            margin-bottom: 4px;
          }

          .markdown-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 18px 0;
            font-size: 13px;
          }

          .markdown-content th,
          .markdown-content td {
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            text-align: left;
          }

          .markdown-content th {
            background: var(--bg-secondary);
            font-weight: 600;
          }

          .markdown-content tr:nth-child(even) td {
            background: rgba(128, 128, 128, 0.04);
          }

          .markdown-content hr {
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 24px 0;
          }

          .markdown-content blockquote {
            border-left: 3.5px solid var(--accent-blue);
            background: rgba(56, 189, 248, 0.06);
            padding: 10px 16px;
            margin: 14px 0;
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
          }

          /* Mermaid Diagram Cards */
          .mermaid-container {
            margin: 20px 0;
          }

          .mermaid-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            overflow: hidden;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
            transition: border-color 0.2s;
          }

          .mermaid-card:hover {
            border-color: rgba(56, 189, 248, 0.4);
          }

          .mermaid-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 14px;
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-color);
            font-size: 12px;
            font-weight: 600;
          }

          .mermaid-tag {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--accent-purple);
          }

          .mermaid-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .mermaid-btn {
            background: var(--btn-bg);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 3px 8px;
            border-radius: var(--radius-sm);
            font-size: 11px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s ease;
          }

          .mermaid-btn:hover {
            background: var(--btn-hover);
            border-color: var(--border-hover);
          }

          .mermaid-body {
            padding: 24px 16px;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow-x: auto;
            background: var(--bg-primary);
            position: relative;
            min-height: 120px;
          }

          .mermaid-body svg {
            max-width: 100%;
            height: auto;
            transition: transform 0.2s ease;
            transform-origin: center center;
          }

          .mermaid-source-view {
            display: none;
            padding: 12px;
            background: var(--code-bg);
            border-top: 1px solid var(--border-color);
            font-family: var(--font-mono);
            font-size: 12px;
            white-space: pre-wrap;
            color: var(--text-primary);
          }

          .mermaid-source-view.visible {
            display: block;
          }

          /* Mermaid Error Card */
          .mermaid-error-card {
            background: rgba(241, 76, 76, 0.08);
            border: 1px solid rgba(241, 76, 76, 0.4);
            border-radius: var(--radius-lg);
            overflow: hidden;
            margin: 16px 0;
          }

          .mermaid-error-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 14px;
            background: rgba(241, 76, 76, 0.15);
            border-bottom: 1px solid rgba(241, 76, 76, 0.3);
            color: var(--accent-red);
            font-weight: 600;
            font-size: 12.5px;
          }

          .mermaid-error-body {
            padding: 14px 16px;
            font-size: 12.5px;
          }

          .mermaid-error-desc {
            color: var(--text-primary);
            margin-bottom: 10px;
          }

          .mermaid-error-desc code {
            background: rgba(241, 76, 76, 0.15);
            color: var(--accent-red);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: var(--font-mono);
          }

          /* Suppress Mermaid unhandled parse error artifacts injected directly into body */
          body > div[id^="dmermaid-"],
          body > svg[id^="mermaid-"] {
            display: none !important;
          }

          /* Fullscreen Modal for Diagrams - Architectural Canvas with Pan & Zoom */
          .fullscreen-modal {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 9999;
            background-color: var(--bg-primary);
            background-image: radial-gradient(var(--border-color) 1.2px, transparent 1.2px);
            background-size: 20px 20px;
            flex-direction: column;
            user-select: none;
            overflow: hidden;
          }

          .fullscreen-modal.active {
            display: flex;
          }

          .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 20px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
            z-index: 10;
            gap: 12px;
          }

          .modal-title-group {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .modal-title {
            font-weight: 700;
            font-size: 13.5px;
            color: var(--text-primary);
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }

          .zoom-badge {
            background: rgba(56, 189, 248, 0.12);
            color: var(--accent-blue);
            border: 1px solid rgba(56, 189, 248, 0.3);
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            font-weight: 600;
            font-size: 11px;
            font-family: var(--font-mono);
          }

          .modal-controls {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }

          .modal-canvas-viewport {
            flex: 1;
            position: relative;
            overflow: hidden;
            cursor: grab;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .modal-canvas-viewport.is-dragging {
            cursor: grabbing;
          }

          .modal-canvas-content {
            position: absolute;
            transform-origin: 0 0;
            will-change: transform;
            display: inline-block;
          }

          .modal-canvas-content svg {
            display: block;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 24px;
          }

          .modal-hint-bar {
            position: absolute;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 5px 14px;
            border-radius: 20px;
            font-size: 11.5px;
            color: var(--text-secondary);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
            pointer-events: none;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .modal-hint-bar kbd {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            padding: 1px 4px;
            font-family: var(--font-mono);
            font-size: 10px;
          }
        </style>
      </head>
      <body data-workspace-path="${MarkdownRenderer.escapeHtml(fileDir)}">
        <!-- Top Sticky Toolbar -->
        <header class="preview-toolbar">
          <div class="toolbar-left">
            <span class="file-badge"><i class="codicon codicon-markdown"></i> Markdown</span>
            <span class="file-breadcrumb" title="${MarkdownRenderer.escapeHtml(this.filePath)}">${MarkdownRenderer.escapeHtml(fileName)}</span>
          </div>
          <div class="toolbar-right">
            <!-- Mermaid Mode Switcher: Sanitized vs Original -->
            <div class="mermaid-switcher" title="Toggle between auto-fixed Mermaid syntax and original source">
              <button class="mermaid-mode-btn active" id="modeSanitizedBtn" onclick="setMermaidMode('sanitized')">
                ✨ Sanitized (Auto-fix)
              </button>
              <button class="mermaid-mode-btn" id="modeOriginalBtn" onclick="setMermaidMode('original')">
                📄 Original
              </button>
            </div>

            <button class="action-btn" onclick="openInEditor()" title="Open markdown file in text editor for editing">
              <i class="codicon codicon-edit"></i> Edit
            </button>
            <button class="action-btn" onclick="openIdePreview()" title="Open in VS Code / IDE built-in preview">
              <i class="codicon codicon-preview"></i> IDE Preview
            </button>
            <button class="action-btn icon-only" onclick="copyFullMarkdown()" title="Copy entire raw Markdown content">
              <i class="codicon codicon-copy"></i>
            </button>
            <button class="action-btn icon-only" onclick="refreshContent()" title="Reload preview content">
              <i class="codicon codicon-refresh"></i>
            </button>
            <button class="action-btn icon-only" onclick="window.print()" title="Print / Export to PDF">
              <i class="codicon codicon-output"></i>
            </button>
          </div>
        </header>

        <!-- Main Preview Article -->
        <main class="preview-container">
          <article class="markdown-content" id="markdownContent">
            ${renderedHtml}
          </article>
        </main>

        <!-- Fullscreen Diagram Modal -->
        <div class="fullscreen-modal" id="diagramModal" tabindex="-1">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-title"><i class="codicon codicon-graph"></i> Diagram Fullscreen Canvas</span>
              <span class="zoom-badge" id="zoomBadge">100%</span>
            </div>
            <div class="modal-controls">
              <button class="action-btn" onclick="zoomModal(1.2)" title="Zoom In (+)"><i class="codicon codicon-zoom-in"></i> Zoom In</button>
              <button class="action-btn" onclick="zoomModal(0.833)" title="Zoom Out (-)"><i class="codicon codicon-zoom-out"></i> Zoom Out</button>
              <button class="action-btn" onclick="fitModalToScreen()" title="Fit to View (0)"><i class="codicon codicon-screen-full"></i> Fit View</button>
              <button class="action-btn" onclick="resetModalZoom()" title="Reset to 100% (1)"><i class="codicon codicon-screen-normal"></i> 100%</button>
              <button class="action-btn" onclick="copyModalSvg()" title="Copy SVG code"><i class="codicon codicon-copy"></i> Copy SVG</button>
              <button class="action-btn primary" onclick="closeModal()" title="Close Fullscreen (Esc)"><i class="codicon codicon-close"></i> Close</button>
            </div>
          </div>
          <div class="modal-canvas-viewport" id="modalViewport">
            <div class="modal-canvas-content" id="modalContent"></div>
          </div>
          <div class="modal-hint-bar">
            <span><i class="codicon codicon-info"></i> Drag to pan • Scroll to zoom • Double-click to fit • <kbd>Esc</kbd> to exit</span>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const rawDocContent = ${JSON.stringify(rawMarkdown)};
          let currentMermaidMode = 'sanitized'; // 'sanitized' | 'original'
          let modalScale = 1;

          // Retain scroll position across auto-updates
          window.addEventListener('load', () => {
            const savedScroll = sessionStorage.getItem('previewScrollPos_' + location.href);
            if (savedScroll) {
              window.scrollTo(0, parseInt(savedScroll, 10));
            }
            renderMermaidDiagrams();
          });

          window.addEventListener('scroll', () => {
            sessionStorage.setItem('previewScrollPos_' + location.href, window.scrollY);
          });

          function openInEditor() {
            vscode.postMessage({ command: 'openInEditor' });
          }

          function openIdePreview() {
            vscode.postMessage({ command: 'openIdePreview' });
          }

          function refreshContent() {
            vscode.postMessage({ command: 'refresh' });
          }

          function copyFullMarkdown() {
            vscode.postMessage({ command: 'copyText', text: rawDocContent, toast: 'Raw Markdown copied to clipboard!' });
          }

          // Mermaid Sanitizer: Auto-quotes unquoted labels with colons, arrows, parentheses, operators, and sanitizes edge labels
          function sanitizeMermaid(code) {
            if (!code) return '';
            const lines = code.split(/\\r?\\n/);
            const sanitizedLines = lines.map(line => {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('%%')) {
                return line;
              }

              // Skip chart headers
              if (/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|C4|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta)\\b/i.test(trimmed)) {
                return line;
              }

              // Skip styling and directives
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

              // 3. Hexagon node: id{{label}} -> id{{"label"}}
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\{\\{([^"\\r\\n\\{\\}]+)\\}\\}/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '{{\"' + clean + '\"}}';
              });

              // 4. Cylinder / Database node: id[(label)] -> id[("label")]
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[\\(([^"\\r\\n\\[\\]\\(\\)]+)\\)\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[(\"' + clean + '\")]';
              });

              // 5. Circle node: id((label)) -> id(("label"))
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

              // 8. Rhombus / Decision node: id{label} -> id{"label"}
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\{([^"\\r\\n\\{\\}]+)\\}/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '{\"' + clean + '\"}';
              });

              // 9. Rectangle node: id[label] -> id["label"]
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\[([^"\\r\\n\\[\\]]+)\\]/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '[\"' + clean + '\"]';
              });

              // 10. Round / Capsule node: id(label) -> id("label")
              processed = processed.replace(/([a-zA-Z0-9_\\-]+)\\(([^"\\r\\n\\(\\)]+)\\)/g, (match, id, label) => {
                const clean = label.replace(/"/g, "'").trim();
                return id + '(\"' + clean + '\")';
              });

              return processed;
            });

            return sanitizedLines.join('\\n');
          }

          function setMermaidMode(mode) {
            currentMermaidMode = mode;
            document.getElementById('modeSanitizedBtn').classList.toggle('active', mode === 'sanitized');
            document.getElementById('modeOriginalBtn').classList.toggle('active', mode === 'original');
            
            // Re-render all diagrams
            document.querySelectorAll('.mermaid-container').forEach(c => c.classList.remove('rendered'));
            renderMermaidDiagrams();
          }

          function isFullMermaidDiagram(code) {
            if (!code || !code.trim()) return false;
            const lines = code.trim().split(/\r?\n/);
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
              return /^\s*(graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|c4context|c4container|c4component|c4dynamic|c4deployment|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta|requirement|requirementDiagram|architecture-beta|packet-beta)\b/i.test(trimmed);
            }
            return false;
          }

          async function renderMermaidDiagrams() {
            if (typeof mermaid === 'undefined') return;

            try {
              const isDark = document.body.classList.contains('vscode-dark');
              mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                securityLevel: 'loose',
                fontFamily: 'var(--font-family)',
                flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' }
              });
            } catch (initErr) {
              console.warn('Mermaid initialize warning:', initErr);
            }

            const containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
            for (const el of containers) {
              el.classList.add('rendered');
              const rawCode = decodeURIComponent(el.getAttribute('data-mermaid') || '');
              if (!isFullMermaidDiagram(rawCode)) {
                continue;
              }
              const preSanitized = el.getAttribute('data-sanitized') ? decodeURIComponent(el.getAttribute('data-sanitized')) : '';
              const sanitizedCode = preSanitized || sanitizeMermaid(rawCode);
              const uniqueId = 'mermaid-pv-' + Math.random().toString(36).substring(2, 9);

              const codeToRender = (currentMermaidMode === 'sanitized') ? sanitizedCode : rawCode;

              try {
                const res = await mermaid.render(uniqueId, codeToRender);
                const renderedSvg = res.svg;
                const encodedRaw = encodeURIComponent(rawCode);

                el.innerHTML =
                  '<div class="mermaid-card">' +
                    '<div class="mermaid-header">' +
                      '<span class="mermaid-tag"><i class="codicon codicon-graph"></i> Mermaid Diagram (' + (currentMermaidMode === 'sanitized' ? '✨ Sanitized' : '📄 Original') + ')</span>' +
                      '<div class="mermaid-actions">' +
                        '<button class="mermaid-btn" onclick="toggleSourceView(this)" title="View Mermaid source code"><i class="codicon codicon-code"></i> Source</button>' +
                        '<button class="mermaid-btn" onclick="copyMermaidCode(\\'' + encodedRaw + '\\')" title="Copy raw Mermaid code"><i class="codicon codicon-copy"></i> Copy</button>' +
                        '<button class="mermaid-btn" onclick="openFullscreen(this)" title="View diagram in fullscreen"><i class="codicon codicon-screen-full"></i> Fullscreen</button>' +
                      '</div>' +
                    '</div>' +
                    '<div class="mermaid-body">' + renderedSvg + '</div>' +
                    '<div class="mermaid-source-view"><pre><code>' + escapeHtml(rawCode) + '</code></pre></div>' +
                  '</div>';
              } catch (renderErr) {
                const tempEl = document.getElementById('d' + uniqueId);
                if (tempEl) tempEl.remove();

                const errMsg = renderErr && renderErr.message ? renderErr.message : String(renderErr);
                const encodedRaw = encodeURIComponent(rawCode);

                el.innerHTML =
                  '<div class="mermaid-error-card">' +
                    '<div class="mermaid-error-header">' +
                      '<span><i class="codicon codicon-warning"></i> Mermaid Syntax Error (' + currentMermaidMode.toUpperCase() + ')</span>' +
                      '<div class="mermaid-actions">' +
                        (currentMermaidMode === 'original'
                          ? '<button class="mermaid-btn primary" onclick="setMermaidMode(\\'sanitized\\')" title="Switch to auto-sanitized mode to try auto-fixing syntax"><i class="codicon codicon-sparkle"></i> Try Auto-Fix</button>'
                          : '') +
                        '<button class="mermaid-btn" onclick="copyMermaidFixPrompt(\\'' + encodedRaw + '\\', \\'' + encodeURIComponent(errMsg) + '\\')" title="Copy AI prompt to fix this Mermaid syntax"><i class="codicon codicon-robot"></i> Fix with AI</button>' +
                        '<button class="mermaid-btn" onclick="copyMermaidCode(\\'' + encodedRaw + '\\')" title="Copy raw code"><i class="codicon codicon-copy"></i> Copy</button>' +
                      '</div>' +
                    '</div>' +
                    '<div class="mermaid-error-body">' +
                      '<div class="mermaid-error-desc">Error details: <code>' + escapeHtml(errMsg) + '</code></div>' +
                      '<div style="background:var(--code-bg); padding:10px; border-radius:var(--radius-sm); font-family:var(--font-mono); font-size:11.5px; white-space:pre-wrap;">' + escapeHtml(rawCode) + '</div>' +
                    '</div>' +
                  '</div>';
              } finally {
                const leftover = document.getElementById('d' + uniqueId);
                if (leftover) leftover.remove();
              }
            }
          }

          function toggleSourceView(btn) {
            const card = btn.closest('.mermaid-card');
            if (card) {
              const src = card.querySelector('.mermaid-source-view');
              if (src) {
                src.classList.toggle('visible');
                btn.classList.toggle('primary', src.classList.contains('visible'));
              }
            }
          }

          function copyMermaidCode(encodedCode) {
            const code = decodeURIComponent(encodedCode);
            vscode.postMessage({ command: 'copyText', text: code, toast: 'Mermaid code copied to clipboard!' });
          }

          function copyMermaidFixPrompt(encodedCode, encodedErr) {
            const code = decodeURIComponent(encodedCode);
            const err = decodeURIComponent(encodedErr);
            const fence = String.fromCharCode(96, 96, 96);
            const prompt = "Please fix this Mermaid diagram syntax error so that it renders properly in Mermaid.js (ensure node labels with special characters like ->, &, :, () are enclosed in quotes):\\n\\n" + fence + "mermaid\\n" + code + "\\n" + fence + "\\n\\nError: " + err;
            vscode.postMessage({ command: 'copyText', text: prompt, toast: 'Prompt copied! Paste it into Antigravity Chat to fix diagram.' });
          }

          let modalScale = 1;
          let modalPanX = 0;
          let modalPanY = 0;
          let isPanning = false;
          let startPointerX = 0;
          let startPointerY = 0;

          function updateModalTransform() {
            const content = document.getElementById('modalContent');
            const badge = document.getElementById('zoomBadge');
            if (content) {
              content.style.transform = 'translate(' + modalPanX + 'px, ' + modalPanY + 'px) scale(' + modalScale + ')';
            }
            if (badge) {
              badge.innerText = Math.round(modalScale * 100) + '%';
            }
          }

          function openFullscreen(btn) {
            const card = btn.closest('.mermaid-card');
            if (card) {
              const svg = card.querySelector('.mermaid-body svg');
              if (svg) {
                const modal = document.getElementById('diagramModal');
                const content = document.getElementById('modalContent');
                content.innerHTML = svg.outerHTML;
                modal.classList.add('active');
                modal.focus();
                setTimeout(fitModalToScreen, 25);
              }
            }
          }

          function closeModal() {
            document.getElementById('diagramModal').classList.remove('active');
          }

          function resetModalZoom() {
            modalScale = 1;
            centerModalContent();
            updateModalTransform();
          }

          function zoomModal(factor) {
            const viewport = document.getElementById('modalViewport');
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            zoomAtPoint(factor, centerX, centerY);
          }

          function zoomAtPoint(factor, clientX, clientY) {
            const oldScale = modalScale;
            let newScale = oldScale * factor;
            newScale = Math.max(0.1, Math.min(10, newScale));
            
            modalPanX = clientX - (clientX - modalPanX) * (newScale / oldScale);
            modalPanY = clientY - (clientY - modalPanY) * (newScale / oldScale);
            modalScale = newScale;
            
            updateModalTransform();
          }

          function centerModalContent() {
            const viewport = document.getElementById('modalViewport');
            const content = document.getElementById('modalContent');
            const svg = content ? content.querySelector('svg') : null;
            if (!viewport || !svg) return;
            
            const vRect = viewport.getBoundingClientRect();
            let svgW = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth;
            let svgH = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight;
            if (!svgW || svgW <= 0) svgW = 800;
            if (!svgH || svgH <= 0) svgH = 600;

            modalPanX = (vRect.width - svgW * modalScale) / 2;
            modalPanY = (vRect.height - svgH * modalScale) / 2;
          }

          function fitModalToScreen() {
            const viewport = document.getElementById('modalViewport');
            const content = document.getElementById('modalContent');
            const svg = content ? content.querySelector('svg') : null;
            if (!viewport || !svg) return;
            
            const vRect = viewport.getBoundingClientRect();
            let svgW = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth;
            let svgH = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight;
            if (!svgW || svgW <= 0) svgW = 800;
            if (!svgH || svgH <= 0) svgH = 600;

            const pad = 100;
            const scaleX = (vRect.width - pad) / svgW;
            const scaleY = (vRect.height - pad) / svgH;
            modalScale = Math.max(0.2, Math.min(1.4, Math.min(scaleX, scaleY)));
            
            modalPanX = (vRect.width - svgW * modalScale) / 2;
            modalPanY = (vRect.height - svgH * modalScale) / 2;
            updateModalTransform();
          }

          function copyModalSvg() {
            const content = document.getElementById('modalContent');
            const svg = content ? content.querySelector('svg') : null;
            if (svg) {
              vscode.postMessage({ command: 'copyText', text: svg.outerHTML, toast: 'SVG markup copied to clipboard!' });
            }
          }

          // Modal Event Listeners (drag to pan, mouse wheel zoom, keyboard shortcuts)
          window.addEventListener('DOMContentLoaded', () => {
            const viewport = document.getElementById('modalViewport');
            if (!viewport) return;

            viewport.addEventListener('mousedown', (e) => {
              if (e.button !== 0) return;
              isPanning = true;
              startPointerX = e.clientX - modalPanX;
              startPointerY = e.clientY - modalPanY;
              viewport.classList.add('is-dragging');
            });

            window.addEventListener('mousemove', (e) => {
              if (!isPanning) return;
              modalPanX = e.clientX - startPointerX;
              modalPanY = e.clientY - startPointerY;
              updateModalTransform();
            });

            window.addEventListener('mouseup', () => {
              if (isPanning) {
                isPanning = false;
                viewport.classList.remove('is-dragging');
              }
            });

            viewport.addEventListener('wheel', (e) => {
              e.preventDefault();
              const rect = viewport.getBoundingClientRect();
              const mouseX = e.clientX - rect.left;
              const mouseY = e.clientY - rect.top;
              const factor = e.deltaY < 0 ? 1.12 : 0.89;
              zoomAtPoint(factor, mouseX, mouseY);
            }, { passive: false });

            viewport.addEventListener('dblclick', (e) => {
              if (e.target.closest('.modal-controls')) return;
              fitModalToScreen();
            });
          });

          window.addEventListener('keydown', (e) => {
            const modal = document.getElementById('diagramModal');
            if (!modal || !modal.classList.contains('active')) return;

            if (e.key === 'Escape') {
              closeModal();
            } else if (e.key === '+' || e.key === '=') {
              zoomModal(1.2);
            } else if (e.key === '-' || e.key === '_') {
              zoomModal(0.833);
            } else if (e.key === '0') {
              fitModalToScreen();
            } else if (e.key === '1') {
              resetModalZoom();
            }
          });

          function escapeHtml(str) {
            return (str || '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
          }

          // Handle link clicks inside preview
          document.addEventListener('click', (e) => {
            const target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement ? e.target.parentElement : null);
            if (!target || typeof target.closest !== 'function') return;

            const fileLink = target.closest('a.file-link, a[data-filepath], a[data-file-url], a[href^="file://"]');
            if (fileLink) {
              e.preventDefault();
              let p = fileLink.getAttribute('data-filepath') || fileLink.getAttribute('data-file-url') || fileLink.getAttribute('href');
              if (p && p !== '#' && p !== 'javascript:void(0)') {
                vscode.postMessage({ command: 'openFile', filePath: p });
              }
              return;
            }

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

            const copyBtn = target.closest('.copy-code-btn');
            if (copyBtn) {
              const code = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
              vscode.postMessage({ command: 'copyText', text: code, toast: 'Code snippet copied!' });
              return;
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  public dispose(): void {
    const normalizedPath = path.normalize(this.filePath);
    MarkdownPreviewWebviewPanel.panels.delete(normalizedPath);

    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {}
    }

    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
