import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MarkdownRenderer } from '../services/MarkdownRenderer';
import { HIGHLIGHT_CSS } from '../services/HighlightStyles';
import { getKaTeXCss } from '../services/KaTeXStyles';

const execFileAsync = promisify(execFile);

export class MarkdownPreviewWebviewPanel {
  public static readonly viewType = 'antigravityMarkdownPreview';
  private static readonly panels: Map<string, MarkdownPreviewWebviewPanel> = new Map();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private filePath: string;
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
            if (message.filePath) {
              await this.handleOpenFile(message.filePath, 'ide');
            } else {
              try {
                await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(this.filePath));
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open IDE preview: ${err?.message || err}`);
              }
            }
            return;

          case 'openRichPreview':
            if (message.filePath) {
              await this.handleOpenFile(message.filePath, 'rich');
            }
            return;

          case 'openFile':
            if (message.filePath) {
              await this.handleOpenFile(message.filePath);
            }
            return;

          case 'openExternal':
            if (message.url) {
              try {
                await vscode.env.openExternal(vscode.Uri.parse(message.url));
              } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open external link: ${err?.message || err}`);
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

          case 'exportPdf':
            await this.handleExportPdf(message.htmlContent);
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

  private async handleOpenFile(rawPath?: string, openMode?: 'rich' | 'ide'): Promise<void> {
    if (!rawPath || typeof rawPath !== 'string') {
      return;
    }

    try {
      let target = rawPath.trim();
      try {
        target = decodeURIComponent(target);
      } catch {}
      target = target.replace(/^file:\/{1,3}/i, '');
      try {
        target = decodeURIComponent(target);
      } catch {}

      let startLine = 0;
      let endLine = 0;
      const lineHashMatch = target.match(/#L(\d+)(?:-L?(\d+))?$/i);
      if (lineHashMatch) {
        startLine = Math.max(0, parseInt(lineHashMatch[1], 10) - 1);
        endLine = lineHashMatch[2] ? Math.max(0, parseInt(lineHashMatch[2], 10) - 1) : startLine;
        target = target.replace(/#L\d+(?:-L?\d+)?$/i, '');
      }

      // Extract and strip section anchor (#heading-name) if present
      let sectionAnchor = '';
      const hashIndex = target.indexOf('#');
      if (hashIndex !== -1) {
        sectionAnchor = target.substring(hashIndex + 1);
        target = target.substring(0, hashIndex);
      }

      let cleanTarget = target.split('?')[0].trim();
      if (process.platform === 'win32') {
        cleanTarget = cleanTarget.replace(/^[\/\\]([a-zA-Z]:)/, '$1');
        cleanTarget = path.normalize(cleanTarget);
      }

      // If relative path, resolve against current preview directory, or workspace
      if (!path.isAbsolute(cleanTarget) && !/^[a-zA-Z]:[\\\/]/.test(cleanTarget)) {
        const currentDir = path.dirname(this.filePath);
        const candidate = path.resolve(currentDir, cleanTarget);
        if (fs.existsSync(candidate)) {
          cleanTarget = candidate;
        } else if (vscode.workspace.workspaceFolders) {
          for (const wf of vscode.workspace.workspaceFolders) {
            const wfCandidate = path.resolve(wf.uri.fsPath, cleanTarget);
            if (fs.existsSync(wfCandidate)) {
              cleanTarget = wfCandidate;
              break;
            }
          }
        }
      }

      if (!fs.existsSync(cleanTarget)) {
        // Fallback: Check if an absolute path from an old or foreign directory matches a file in current workspace
        const segments = cleanTarget.split(/[\\\/]/).filter(Boolean);
        let foundCandidate = '';
        const searchRoots = [
          path.dirname(this.filePath),
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [])
        ];

        for (const root of searchRoots) {
          for (let i = 0; i < segments.length; i++) {
            const subpath = segments.slice(i).join(path.sep);
            const candidate = path.resolve(root, subpath);
            if (fs.existsSync(candidate)) {
              try {
                if (fs.statSync(candidate).isFile()) {
                  foundCandidate = candidate;
                  break;
                }
              } catch {}
            }
          }
          if (foundCandidate) break;
        }

        if (foundCandidate) {
          cleanTarget = foundCandidate;
        }
      }

      if (!fs.existsSync(cleanTarget)) {
        vscode.window.showWarningMessage(`File not found: ${cleanTarget}`);
        return;
      }

      const fileUri = vscode.Uri.file(cleanTarget);
      const isMd = cleanTarget.toLowerCase().endsWith('.md') || cleanTarget.toLowerCase().endsWith('.markdown');
      const targetColumn = this.panel.viewColumn || vscode.ViewColumn.Active;

      if (openMode === 'rich' && isMd) {
        // 1. Explicit request for Brain Hub Rich Preview (clicked 🔎)
        const preview = MarkdownPreviewWebviewPanel.createOrShow(this.extensionUri, cleanTarget, targetColumn);
        if (sectionAnchor && preview) {
          setTimeout(() => {
            try {
              preview.panel.webview.postMessage({ command: 'scrollToAnchor', anchor: sectionAnchor });
            } catch {}
          }, 300);
        }
        return;
      } else if (openMode === 'ide' && isMd) {
        // 2. Explicit request for IDE Built-in Preview (clicked 📄)
        try {
          await vscode.commands.executeCommand('markdown.showPreview', fileUri);
          return;
        } catch (err) {
          console.warn('Could not open IDE markdown preview:', err);
        }
      } else if (isMd && startLine === 0 && endLine === 0) {
        // 3. Clicked markdown file name without line range -> Navigate current preview or reveal
        if (path.normalize(cleanTarget) === path.normalize(this.filePath)) {
          if (sectionAnchor) {
            this.panel.webview.postMessage({ command: 'scrollToAnchor', anchor: sectionAnchor });
          } else {
            this.panel.webview.postMessage({ command: 'scrollToTop' });
          }
          return;
        }

        this.navigateToFile(cleanTarget);
        if (sectionAnchor) {
          setTimeout(() => {
            try {
              this.panel.webview.postMessage({ command: 'scrollToAnchor', anchor: sectionAnchor });
            } catch {}
          }, 300);
        }
        return;
      }

      // 4. Open in text editor with line selection if line hash present
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

      // 5. Open any other file (binary images, png, svg, code, etc.) via default VS Code editor/viewer
      try {
        await vscode.commands.executeCommand('vscode.open', fileUri, { preview: false });
      } catch (openErr) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open target file: ${err?.message || err}`);
    }
  }

  public navigateToFile(newFilePath: string): void {
    const normalizedNew = path.normalize(newFilePath);
    const normalizedOld = path.normalize(this.filePath);
    if (normalizedNew === normalizedOld) {
      this.update();
      return;
    }

    const existing = MarkdownPreviewWebviewPanel.panels.get(normalizedNew);
    if (existing && existing !== this) {
      existing.panel.reveal(this.panel.viewColumn || vscode.ViewColumn.Active);
      existing.update();
      return;
    }

    MarkdownPreviewWebviewPanel.panels.delete(normalizedOld);
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {}
      this.fsWatcher = undefined;
    }

    this.filePath = normalizedNew;
    MarkdownPreviewWebviewPanel.panels.set(normalizedNew, this);
    this.panel.title = `Preview: ${path.basename(normalizedNew)}`;

    try {
      this.fsWatcher = fs.watch(normalizedNew, (event) => {
        if (event === 'change') {
          this.update();
        }
      });
    } catch {}

    this.update();
  }

  public static getBrowserExecutablePath(): string | null {
    const candidates: string[] = [];

    if (process.platform === 'win32') {
      const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env['LOCALAPPDATA'] || '';

      candidates.push(
        path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      );
    } else {
      candidates.push(
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      );
    }

    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  public generatePrintHtml(clientHtml?: string): string {
    const fileName = path.basename(this.filePath);
    const fileDir = path.dirname(this.filePath);

    let bodyContent = clientHtml;
    if (!bodyContent || typeof bodyContent !== 'string' || !bodyContent.trim()) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        bodyContent = MarkdownRenderer.render(raw, fileDir);
      } catch {
        bodyContent = '<p>Error loading document content</p>';
      }
    }

    // Clean up interactive UI buttons from rendered content
    bodyContent = bodyContent
      .replace(/<span class="md-link-actions">[\s\S]*?<\/span>/gi, '')
      .replace(/<div class="code-header-actions">[\s\S]*?<\/div>/gi, '')
      .replace(/<div class="mermaid-actions">[\s\S]*?<\/div>/gi, '');

    const fontsDir = path.join(this.extensionUri.fsPath, 'media', 'fonts').replace(/\\/g, '/');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${MarkdownRenderer.escapeHtml(fileName)}</title>
  <style>
    ${getKaTeXCss(fontsDir)}
  </style>
  <style>
    ${HIGHLIGHT_CSS}
  </style>
  <style>
    :root {
      --bg-primary: #ffffff;
      --text-primary: #24292e;
      --text-secondary: #57606a;
      --border-color: #d0d7de;
      --code-bg: #f6f8fa;
      --accent-blue: #0969da;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: #ffffff;
      color: #24292e;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Segoe UI Emoji", "Noto Sans", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13.5px;
      line-height: 1.65;
      padding: 24px 32px;
      max-width: 900px;
      margin: 0 auto;
      word-wrap: break-word;
    }

    h1, h2, h3, h4, h5, h6 {
      color: #1f2328;
      font-weight: 700;
      margin-top: 24px;
      margin-bottom: 12px;
      line-height: 1.35;
      page-break-after: avoid;
    }

    h1 { font-size: 26px; border-bottom: 1px solid #d0d7de; padding-bottom: 8px; }
    h2 { font-size: 20px; border-bottom: 1px solid #d0d7de; padding-bottom: 6px; }
    h3 { font-size: 16px; }
    h4 { font-size: 14px; }

    p, ul, ol, blockquote, table, pre {
      margin-bottom: 14px;
    }

    ul, ol {
      padding-left: 24px;
    }

    li {
      margin-bottom: 4px;
    }

    hr {
      border: none;
      border-top: 1px solid #d0d7de;
      margin: 20px 0;
    }

    blockquote {
      border-left: 4px solid #d0d7de;
      padding: 6px 14px;
      color: #57606a;
      background: #f6f8fa;
      border-radius: 0 4px 4px 0;
    }

    a {
      color: #0969da;
      text-decoration: underline;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
      page-break-inside: avoid;
    }

    th, td {
      border: 1px solid #d0d7de;
      padding: 8px 12px;
      font-size: 12.5px;
      text-align: left;
    }

    th {
      background: #f6f8fa;
      font-weight: 600;
    }

    tr:nth-child(even) {
      background: #fcfcfc;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 85%;
      background: rgba(175, 184, 193, 0.2);
      padding: 2px 5px;
      border-radius: 4px;
    }

    pre code {
      background: transparent;
      padding: 0;
      font-size: 12px;
    }

    .code-container {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      margin: 14px 0;
      page-break-inside: avoid;
      overflow: hidden;
    }

    .code-header {
      background: #eaeef2;
      border-bottom: 1px solid #d0d7de;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      color: #57606a;
      display: flex;
      justify-content: space-between;
    }

    .code-container pre {
      margin: 0;
      padding: 10px 12px;
      overflow-x: auto;
      background: transparent;
    }

    .code-line {
      display: flex;
      line-height: 1.5;
    }

    .code-line .line-num {
      width: 32px;
      min-width: 32px;
      user-select: none;
      color: #8c959f;
      text-align: right;
      padding-right: 12px;
      font-size: 11px;
    }

    .code-line .line-content {
      flex: 1;
    }

    /* Mermaid Diagrams in Print */
    .mermaid-container {
      margin: 20px 0;
      page-break-inside: avoid;
      text-align: center;
    }

    .mermaid-card {
      border: 1px solid #d0d7de;
      border-radius: 6px;
      overflow: hidden;
      background: #ffffff;
    }

    .mermaid-header {
      background: #f6f8fa;
      border-bottom: 1px solid #d0d7de;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #57606a;
      text-align: left;
    }

    .mermaid-body {
      padding: 16px;
      display: flex;
      justify-content: center;
      overflow: hidden;
    }

    .mermaid-body svg {
      max-width: 100% !important;
      height: auto !important;
    }

    .mermaid-source-view {
      display: none !important;
    }

    img {
      max-width: 100%;
      height: auto;
      page-break-inside: avoid;
    }

    .md-link-actions,
    .rich-preview-btn,
    .ide-preview-btn,
    .code-header-actions,
    .copy-code-btn,
    .toggle-wrap-btn,
    .mermaid-actions,
    .preview-toolbar,
    .fullscreen-modal {
      display: none !important;
    }

    @page {
      margin: 15mm 15mm 15mm 15mm;
      size: auto;
    }

    @media print {
      body {
        padding: 0;
        max-width: none;
      }
      .code-container, table, .mermaid-container, blockquote {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  }

  public async handleExportPdf(clientHtml?: string): Promise<void> {
    const defaultPdfName = path.basename(this.filePath, path.extname(this.filePath)) + '.pdf';
    const defaultPdfUri = vscode.Uri.file(path.join(path.dirname(this.filePath), defaultPdfName));

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri: defaultPdfUri,
      filters: { 'PDF Document (*.pdf)': ['pdf'] },
      saveLabel: 'Export PDF',
      title: 'Export Markdown Document to PDF'
    });

    if (!targetUri) {
      return;
    }

    const destPath = targetUri.fsPath;
    const browserPath = MarkdownPreviewWebviewPanel.getBrowserExecutablePath();
    const printHtml = this.generatePrintHtml(clientHtml);

    if (browserPath) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Exporting PDF: ${path.basename(destPath)}...`,
          cancellable: false
        },
        async () => {
          const tempHtmlPath = path.join(os.tmpdir(), `bh_print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`);
          try {
            fs.writeFileSync(tempHtmlPath, printHtml, 'utf8');

            await execFileAsync(
              browserPath,
              [
                '--headless',
                '--disable-gpu',
                '--no-pdf-header-footer',
                `--print-to-pdf=${destPath}`,
                tempHtmlPath
              ],
              { timeout: 45000 }
            );

            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
              const action = await vscode.window.showInformationMessage(
                `PDF exported successfully: ${path.basename(destPath)}`,
                'Open PDF',
                'Reveal in Folder'
              );
              if (action === 'Open PDF') {
                await vscode.commands.executeCommand('vscode.open', targetUri);
              } else if (action === 'Reveal in Folder') {
                await vscode.commands.executeCommand('revealFileInOS', targetUri);
              }
            } else {
              throw new Error('Output PDF file was not created or is empty.');
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to export PDF: ${err?.message || err}`);
          } finally {
            try {
              if (fs.existsSync(tempHtmlPath)) {
                fs.unlinkSync(tempHtmlPath);
              }
            } catch {}
          }
        }
      );
    } else {
      // Fallback: Open printable HTML in default browser where user can print/save to PDF
      const tempHtmlPath = path.join(os.tmpdir(), `bh_print_${Date.now()}_${path.basename(this.filePath)}.html`);
      const fallbackHtml = printHtml.replace(
        '</body>',
        '<script>window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.print(), 600));</script></body>'
      );
      fs.writeFileSync(tempHtmlPath, fallbackHtml, 'utf8');
      await vscode.env.openExternal(vscode.Uri.file(tempHtmlPath));
      vscode.window.showInformationMessage(
        'No headless Chromium browser found. Opened printable preview in default browser. Please select "Save as PDF" to complete export.',
        'OK'
      );
    }
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
        <!-- Mermaid script is loaded dynamically on-demand only when diagrams exist -->
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

          .markdown-content a {
            color: var(--accent-blue, #38bdf8);
            text-decoration: underline;
            text-underline-offset: 3px;
            cursor: pointer;
            transition: color 0.15s ease, filter 0.15s ease;
          }

          .markdown-content a:hover {
            color: var(--accent-blue-hover, #7dd3fc);
            filter: brightness(1.15);
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
            justify-content: safe center;
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

          /* Mode allowing natural 100% width with horizontal scroll for wide diagrams */
          .mermaid-card.scroll-mode .mermaid-body {
            justify-content: flex-start;
          }

          .mermaid-card.scroll-mode .mermaid-body svg {
            max-width: none !important;
            width: auto !important;
            min-width: max-content;
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

          /* Suppress Mermaid unhandled parse error artifacts injected directly into body without breaking layout/measurement */
          body > div[id^="dmermaid-"],
          body > svg[id^="mermaid-"] {
            position: absolute !important;
            top: -9999px !important;
            left: -9999px !important;
            opacity: 0 !important;
            pointer-events: none !important;
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
          }

          .modal-canvas-viewport.is-dragging {
            cursor: grabbing;
          }

          .modal-canvas-content {
            position: absolute;
            left: 0;
            top: 0;
            transform-origin: 0 0;
            will-change: transform;
          }

          .modal-canvas-content svg {
            display: block;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
            border-radius: var(--radius-md);
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 24px;
            box-sizing: content-box;
            max-width: none !important;
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
            <button class="action-btn icon-only" onclick="exportPdf()" title="Print / Export to PDF">
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
          const mermaidScriptUri = '${mermaidUri}';
          let currentMermaidMode = 'sanitized'; // 'sanitized' | 'original'

          // Retain scroll position across auto-updates for this specific file
          const currentDocKey = 'previewScrollPos_' + encodeURIComponent('${MarkdownRenderer.escapeHtml(this.filePath)}');
          window.addEventListener('load', () => {
            const savedScroll = sessionStorage.getItem(currentDocKey);
            if (savedScroll) {
              window.scrollTo(0, parseInt(savedScroll, 10));
            }
          });

          // Trigger diagram rendering as soon as DOM is ready without waiting for full page load
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => renderMermaidDiagrams());
          } else {
            renderMermaidDiagrams();
          }

          window.addEventListener('scroll', () => {
            sessionStorage.setItem(currentDocKey, window.scrollY);
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

          function exportPdf() {
            const content = document.getElementById('markdownContent');
            const html = content ? content.innerHTML : '';
            vscode.postMessage({ command: 'exportPdf', htmlContent: html });
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

          let mermaidLoadingPromise = null;
          function loadMermaidScript() {
            if (typeof mermaid !== 'undefined') return Promise.resolve(true);
            if (mermaidLoadingPromise) return mermaidLoadingPromise;
            mermaidLoadingPromise = new Promise((resolve) => {
              const s = document.createElement('script');
              s.src = mermaidScriptUri;
              s.onload = () => resolve(true);
              s.onerror = () => {
                console.warn('Failed to load local mermaid script:', mermaidScriptUri);
                resolve(false);
              };
              document.head.appendChild(s);
            });
            return mermaidLoadingPromise;
          }

          async function renderMermaidDiagrams() {
            const containers = document.querySelectorAll('.mermaid-container:not(.rendered)');
            if (containers.length === 0) return;

            if (typeof mermaid === 'undefined') {
              const ok = await loadMermaidScript();
              if (!ok || typeof mermaid === 'undefined') {
                console.warn('Mermaid script could not be loaded');
                return;
              }
            }

            try {
              const isLight = document.body.classList.contains('vscode-light');
              mermaid.initialize({
                startOnLoad: false,
                theme: isLight ? 'neutral' : 'dark',
                securityLevel: 'loose',
                fontFamily: 'var(--font-family)',
                flowchart: {
                  useMaxWidth: true,
                  htmlLabels: true,
                  curve: 'basis',
                  nodeSpacing: 35,
                  rankSpacing: 35,
                  padding: 16
                }
              });
            } catch (initErr) {
              console.warn('Mermaid initialize warning:', initErr);
            }

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
                        '<button class="mermaid-btn" onclick="toggleDiagramFit(this)" title="Toggle 100% scrollable size or fit to width"><i class="codicon codicon-arrow-both"></i> <span class="fit-label">Scroll</span></button>' +
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

          function toggleDiagramFit(btn) {
            const card = btn.closest('.mermaid-card');
            if (!card) return;
            card.classList.toggle('scroll-mode');
            const isScroll = card.classList.contains('scroll-mode');
            const label = btn.querySelector('.fit-label');
            if (label) label.innerText = isScroll ? 'Fit' : 'Scroll';
            btn.classList.toggle('primary', isScroll);
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

          function getSvgNaturalDimensions(svg) {
            let svgW = 0;
            let svgH = 0;
            if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
              svgW = svg.viewBox.baseVal.width;
              svgH = svg.viewBox.baseVal.height;
            } else if (svg.getAttribute('viewBox')) {
              const parts = svg.getAttribute('viewBox').trim().split(/[\s,]+/);
              if (parts.length === 4) {
                svgW = parseFloat(parts[2]);
                svgH = parseFloat(parts[3]);
              }
            }
            if (!svgW || svgW <= 0) {
              svgW = svg.scrollWidth || svg.clientWidth || 800;
            }
            if (!svgH || svgH <= 0) {
              svgH = svg.scrollHeight || svg.clientHeight || 600;
            }
            return { width: svgW, height: svgH };
          }

          function applySvgNaturalDimensions(svg, content) {
            if (!svg) return { width: 800, height: 600, totalW: 848, totalH: 648 };
            const dims = getSvgNaturalDimensions(svg);
            const padOffset = 48; // 24px padding on each side
            const totalW = dims.width + padOffset;
            const totalH = dims.height + padOffset;

            svg.style.width = dims.width + 'px';
            svg.style.height = dims.height + 'px';
            svg.style.maxWidth = 'none';
            svg.style.minWidth = dims.width + 'px';
            svg.style.minHeight = dims.height + 'px';

            if (content) {
              content.style.width = totalW + 'px';
              content.style.height = totalH + 'px';
            }

            return { width: dims.width, height: dims.height, totalW: totalW, totalH: totalH };
          }

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

                const clonedSvg = content.querySelector('svg');
                if (clonedSvg) {
                  applySvgNaturalDimensions(clonedSvg, content);
                }

                modal.classList.add('active');
                modal.focus();
                fitModalToScreen();
                requestAnimationFrame(fitModalToScreen);
              }
            }
          }

          function closeModal() {
            const modal = document.getElementById('diagramModal');
            if (modal) {
              modal.classList.remove('active');
            }
            const content = document.getElementById('modalContent');
            if (content) {
              content.innerHTML = '';
            }
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
            newScale = Math.max(0.05, Math.min(10, newScale));
            
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
            
            const dims = applySvgNaturalDimensions(svg, content);
            const vRect = viewport.getBoundingClientRect();

            modalPanX = (vRect.width - dims.totalW * modalScale) / 2;
            modalPanY = (vRect.height - dims.totalH * modalScale) / 2;
          }

          function fitModalToScreen() {
            const viewport = document.getElementById('modalViewport');
            const content = document.getElementById('modalContent');
            const svg = content ? content.querySelector('svg') : null;
            if (!viewport || !svg) return;
            
            const dims = applySvgNaturalDimensions(svg, content);
            const vRect = viewport.getBoundingClientRect();
            if (vRect.width <= 0 || vRect.height <= 0) return;

            const pad = 80;
            const availableW = Math.max(50, vRect.width - pad);
            const availableH = Math.max(50, vRect.height - pad);

            const scaleX = availableW / dims.totalW;
            const scaleY = availableH / dims.totalH;
            modalScale = Math.max(0.05, Math.min(1.5, Math.min(scaleX, scaleY)));
            
            modalPanX = (vRect.width - dims.totalW * modalScale) / 2;
            modalPanY = (vRect.height - dims.totalH * modalScale) / 2;
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

          window.addEventListener('resize', () => {
            const modal = document.getElementById('diagramModal');
            if (modal && modal.classList.contains('active')) {
              fitModalToScreen();
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

          // Host message listener (scroll to anchor / top)
          window.addEventListener('message', (event) => {
            const message = event.data;
            if (!message) return;
            if (message.command === 'scrollToAnchor' && message.anchor) {
              try {
                const id = message.anchor;
                const decodedId = decodeURIComponent(id);
                const safeId = window.CSS && CSS.escape ? CSS.escape(id) : id;
                const safeDecodedId = window.CSS && CSS.escape ? CSS.escape(decodedId) : decodedId;
                const el = document.getElementById(id) ||
                           document.getElementById(decodedId) ||
                           document.querySelector('[name="' + safeId + '"]') ||
                           document.querySelector('[name="' + safeDecodedId + '"]');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              } catch (err) {}
            } else if (message.command === 'scrollToTop') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          });

          // Handle link clicks inside preview
          document.addEventListener('click', (e) => {
            const target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement ? e.target.parentElement : null);
            if (!target || typeof target.closest !== 'function') return;

            // 1. Action buttons on Markdown links (🔎 and 📄)
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

            // 2. Intercept ANY anchor <a> click (Markdown links, raw HTML links, external URLs, file links, hash anchors)
            const anchor = target.closest('a');
            if (anchor) {
              let p = anchor.getAttribute('data-filepath') || anchor.getAttribute('data-file-url');
              const rawHref = anchor.getAttribute('href') || '';

              if (!p && rawHref) {
                p = rawHref;
              }

              if (!p || p === '#' || p.startsWith('javascript:')) {
                return;
              }

              // In-page hash anchor link (e.g. #installation or #cài-đặt)
              if (p.startsWith('#')) {
                e.preventDefault();
                const targetId = p.slice(1);
                if (targetId) {
                  try {
                    const decodedId = decodeURIComponent(targetId);
                    const safeTargetId = window.CSS && CSS.escape ? CSS.escape(targetId) : targetId;
                    const safeDecodedId = window.CSS && CSS.escape ? CSS.escape(decodedId) : decodedId;
                    const el = document.getElementById(targetId) ||
                               document.getElementById(decodedId) ||
                               document.querySelector('[name="' + safeTargetId + '"]') ||
                               document.querySelector('[name="' + safeDecodedId + '"]');
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth' });
                    }
                  } catch (err) {}
                }
                return;
              }

              // External URL (http://, https://, mailto:)
              const isExternal = p.startsWith('http://') || p.startsWith('https://') || p.startsWith('mailto:');
              if (isExternal) {
                e.preventDefault();
                vscode.postMessage({ command: 'openExternal', url: p });
                return;
              }

              // Local file link (relative path, absolute path, file:// URI)
              e.preventDefault();
              try { p = decodeURIComponent(p); } catch (err) {}
              vscode.postMessage({ command: 'openFile', filePath: p });
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
