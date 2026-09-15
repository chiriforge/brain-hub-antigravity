export const HIGHLIGHT_CSS = `
/* Modern Code Container & Highlight.js Theme */
.code-container {
  background: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin: 12px 0;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

body.vscode-light .code-container {
  background: var(--vscode-editor-background, #ffffff);
  border-color: rgba(0, 0, 0, 0.15);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.code-header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  user-select: none;
}

body.vscode-light .code-header {
  background: rgba(0, 0, 0, 0.03);
}

.code-lang-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: var(--font-mono);
}

.code-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.code-action-btn,
.copy-code-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
  user-select: none;
}

.code-action-btn:hover,
.copy-code-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.08);
}

body.vscode-light .code-action-btn:hover,
body.vscode-light .copy-code-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.code-action-btn.active {
  color: var(--accent-blue, #3794ff);
  background: rgba(55, 148, 255, 0.12);
}

.code-container pre {
  margin: 0 !important;
  padding: 10px 0 12px 0 !important;
  overflow-x: auto !important;
  font-family: var(--font-mono) !important;
  font-size: 13px !important;
  line-height: 1.6 !important;
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
}

/* Reset any default background behind code/tokens to prevent ugly patchy highlight boxes */
.code-container pre code,
.code-container pre code.hljs,
pre code,
pre code span[class*="hljs-"],
pre code .line-content * {
  background: transparent !important;
  background-color: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  text-shadow: none !important;
}

.code-container pre code.hljs {
  display: block !important;
  font-family: inherit !important;
  font-size: inherit !important;
  line-height: inherit !important;
  color: #abb2bf;
  width: 100%;
}

/* Default: Auto Wrap Enabled */
.code-container:not(.no-wrap) pre code.hljs .line-content {
  white-space: pre-wrap !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
}

.code-container.no-wrap pre code.hljs .line-content {
  white-space: pre !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
}

.code-line {
  display: flex !important;
  align-items: flex-start !important;
  min-height: 1.6em !important;
  padding: 0 12px !important;
  transition: background 0.1s ease;
}

.code-line:hover {
  background: rgba(255, 255, 255, 0.04);
}

body.vscode-light .code-line:hover {
  background: rgba(0, 0, 0, 0.03);
}

.line-num {
  user-select: none !important;
  -webkit-user-select: none !important;
  min-width: 3.2em !important;
  text-align: right !important;
  padding-right: 12px !important;
  margin-right: 12px !important;
  color: var(--text-muted, #888888) !important;
  opacity: 0.6 !important;
  flex-shrink: 0 !important;
  font-size: 11.5px !important;
  line-height: 1.6 !important;
  border-right: 1px solid var(--border-color, rgba(128, 128, 128, 0.25)) !important;
}

.line-content {
  flex: 1;
  min-width: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

body.vscode-light .code-container pre code.hljs {
  color: #24292f;
}

/* Syntax Highlighting Colors - One Dark & VS Code Hybrid */
.hljs-keyword,
.hljs-operator,
.hljs-meta .hljs-keyword,
.hljs-doctag {
  color: #e06c75;
  font-weight: 600;
}
body.vscode-light .hljs-keyword,
body.vscode-light .hljs-operator,
body.vscode-light .hljs-meta .hljs-keyword,
body.vscode-light .hljs-doctag {
  color: #cf222e;
  font-weight: 600;
}

.hljs-function,
.hljs-title.function_,
.hljs-title.class_,
.hljs-title.class_.inherited__ {
  color: #61afef;
}
body.vscode-light .hljs-function,
body.vscode-light .hljs-title.function_,
body.vscode-light .hljs-title.class_,
body.vscode-light .hljs-title.class_.inherited__ {
  color: #8250df;
}

.hljs-string,
.hljs-meta .hljs-string,
.hljs-regexp {
  color: #98c379;
}
body.vscode-light .hljs-string,
body.vscode-light .hljs-meta .hljs-string,
body.vscode-light .hljs-regexp {
  color: #0a3069;
}

.hljs-number,
.hljs-literal,
.hljs-variable.constant_ {
  color: #d19a66;
}
body.vscode-light .hljs-number,
body.vscode-light .hljs-literal,
body.vscode-light .hljs-variable.constant_ {
  color: #0550ae;
}

.hljs-type,
.hljs-built_in,
.hljs-class {
  color: #e5c07b;
}
body.vscode-light .hljs-type,
body.vscode-light .hljs-built_in,
body.vscode-light .hljs-class {
  color: #953800;
}

.hljs-comment,
.hljs-quote {
  color: #7f848e;
  font-style: italic;
}
body.vscode-light .hljs-comment,
body.vscode-light .hljs-quote {
  color: #6e7781;
  font-style: italic;
}

.hljs-attr,
.hljs-attribute,
.hljs-property,
.hljs-variable {
  color: #e06c75;
}
body.vscode-light .hljs-attr,
body.vscode-light .hljs-attribute,
body.vscode-light .hljs-property,
body.vscode-light .hljs-variable {
  color: #116329;
}

.hljs-tag,
.hljs-name {
  color: #e06c75;
}
body.vscode-light .hljs-tag,
body.vscode-light .hljs-name {
  color: #116329;
}

.hljs-symbol,
.hljs-bullet {
  color: #56b6c2;
}
body.vscode-light .hljs-symbol,
body.vscode-light .hljs-bullet {
  color: #0550ae;
}

.hljs-subst {
  color: #abb2bf;
}
body.vscode-light .hljs-subst {
  color: #24292f;
}

.hljs-section {
  color: #61afef;
  font-weight: bold;
}

.hljs-addition {
  color: #98c379;
  background-color: rgba(46, 160, 67, 0.15) !important;
}

.hljs-deletion {
  color: #e06c75;
  background-color: rgba(248, 81, 73, 0.15) !important;
}

/* Inline Code (:not inside pre) */
.inline-code,
:not(pre) > code {
  background: var(--code-bg);
  color: var(--accent-orange, #e5a00d);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  border: 1px solid var(--border-color);
}

/* Color Preview Badge / Swatch */
.color-chip-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  background: var(--bg-tertiary, rgba(128, 128, 128, 0.12));
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
  border-radius: 4px;
  padding: 1px 7px 1px 5px;
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  user-select: all;
  margin: 0 3px;
  transition: all 0.15s ease;
  line-height: 1.5;
}

.color-chip-badge:hover {
  border-color: var(--border-hover, #007acc);
  background: rgba(128, 128, 128, 0.2);
  transform: translateY(-1px);
}

.color-chip-badge.copied {
  border-color: var(--accent-green, #388a34) !important;
}

.color-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.15);
}

.color-hex {
  font-weight: 600;
  color: var(--text-primary);
}

/* User Directives & Mentions */
.user-directive-pill {
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
  padding: 2px 9px !important;
  border-radius: 12px !important;
  font-family: var(--font-mono) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  margin: 2px 3px !important;
  vertical-align: middle !important;
  text-decoration: none !important;
  transition: all 0.15s ease !important;
  cursor: default !important;
  line-height: 1.4 !important;
  white-space: nowrap !important;
}

.user-directive-pill:hover {
  transform: translateY(-1px);
  filter: brightness(1.15);
}

.user-directive-pill.slash-cmd {
  background: rgba(177, 128, 215, 0.22) !important;
  color: #d2a8ff !important;
  border: 1px solid rgba(177, 128, 215, 0.5) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
}

body.vscode-light .user-directive-pill.slash-cmd {
  background: rgba(130, 80, 223, 0.14) !important;
  color: #8250df !important;
  border-color: rgba(130, 80, 223, 0.4) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.user-directive-pill.mention-file {
  background: rgba(56, 189, 248, 0.16) !important;
  color: #38bdf8 !important;
  border: 1px solid rgba(56, 189, 248, 0.45) !important;
  cursor: pointer !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
}

.user-directive-pill.mention-file:hover {
  background: rgba(56, 189, 248, 0.25) !important;
  border-color: #38bdf8 !important;
  text-decoration: underline !important;
}

body.vscode-light .user-directive-pill.mention-file {
  background: rgba(9, 105, 218, 0.12) !important;
  color: #0969da !important;
  border-color: rgba(9, 105, 218, 0.35) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

body.vscode-light .user-directive-pill.mention-file:hover {
  background: rgba(9, 105, 218, 0.18) !important;
  border-color: #0969da !important;
}

.user-directive-pill.mention-chat {
  background: rgba(242, 169, 69, 0.18) !important;
  color: #f2a945 !important;
  border: 1px solid rgba(242, 169, 69, 0.45) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
}

body.vscode-light .user-directive-pill.mention-chat {
  background: rgba(179, 90, 0, 0.12) !important;
  color: #b35a00 !important;
  border-color: rgba(179, 90, 0, 0.35) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
}

.user-directive-pill .pill-icon {
  font-size: 11px !important;
  display: inline-flex !important;
  align-items: center !important;
}

/* File Links in Markdown */
.markdown-link.file-link {
  display: inline-flex !important;
  align-items: center !important;
  gap: 3px !important;
  cursor: pointer !important;
  color: #38bdf8 !important;
  text-decoration: underline !important;
  text-underline-offset: 3px !important;
  font-weight: 500 !important;
  transition: color 0.15s ease, filter 0.15s ease !important;
}

body.vscode-light .markdown-link.file-link {
  color: #0969da !important;
}

.markdown-link.file-link:hover {
  color: #7dd3fc !important;
  filter: brightness(1.15) !important;
}

body.vscode-light .markdown-link.file-link:hover {
  color: #0550ae !important;
}

.markdown-link.file-link::after {
  content: '↗';
  font-size: 10px;
  opacity: 0.8;
  margin-left: 2px;
}

.markdown-link.file-link.md-file-link::after {
  display: none !important;
}

/* Markdown Link Wrapper & Dual Action Icons */
.md-link-wrapper {
  display: inline-flex !important;
  align-items: center !important;
  vertical-align: baseline !important;
  white-space: nowrap !important;
  gap: 3px !important;
}

.md-link-actions {
  display: inline-flex !important;
  align-items: center !important;
  gap: 2px !important;
  margin-left: 2px !important;
}

.md-action-btn {
  background: rgba(128, 128, 128, 0.15) !important;
  border: 1px solid rgba(128, 128, 128, 0.28) !important;
  color: var(--text-primary, #cccccc) !important;
  border-radius: 4px !important;
  padding: 1px 4px !important;
  font-size: 10px !important;
  line-height: 1 !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: all 0.15s ease !important;
  vertical-align: middle !important;
  user-select: none !important;
}

.md-action-btn:hover {
  background: var(--btn-hover, rgba(128, 128, 128, 0.35)) !important;
  border-color: var(--border-hover, #007acc) !important;
  transform: scale(1.18) !important;
}

.md-action-btn.rich-preview-btn:hover {
  background: rgba(56, 189, 248, 0.28) !important;
  border-color: #38bdf8 !important;
}

.md-action-btn.ide-preview-btn:hover {
  background: rgba(188, 140, 255, 0.28) !important;
  border-color: #b180d7 !important;
}

/* High-contrast Text Selection Styling mapped to VS Code Editor Selection */
::selection {
  background-color: var(--vscode-editor-selectionBackground, rgba(0, 122, 204, 0.45)) !important;
  color: inherit !important;
}

::-moz-selection {
  background-color: var(--vscode-editor-selectionBackground, rgba(0, 122, 204, 0.45)) !important;
  color: inherit !important;
}

/* Prevent native element drag ghost from interfering with text selection */
a, img, .chat-rendered-img, .user-media-thumb, .user-media-item, .markdown-link, .file-link {
  -webkit-user-drag: none !important;
  user-drag: none !important;
}

/* Reusable Toast Notification Component */
.webview-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--vscode-editorWidget-background, #252526);
  color: var(--vscode-editorWidget-foreground, #cccccc);
  border: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.35));
  padding: 8px 16px;
  border-radius: var(--radius-md, 6px);
  font-size: 12.5px;
  font-weight: 500;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
  z-index: 2000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  align-items: center;
  gap: 8px;
}

.webview-toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}

.webview-toast-icon {
  color: var(--accent-green, #388a34);
  font-weight: bold;
}

/* Artifacts Modal Styles */
.artifacts-modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 24px;
}

.artifacts-modal-overlay.active {
  display: flex;
}

.artifacts-modal-container {
  background: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.15));
  border-radius: 8px;
  width: calc(100% - 48px);
  max-width: 1080px;
  height: calc(100% - 48px);
  min-height: 480px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  animation: artifactsModalZoomIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes artifactsModalZoomIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.artifacts-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--vscode-editorWidget-background, #252526);
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
}

.artifacts-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground, #ccc);
}

.artifacts-modal-count {
  font-size: 11px;
  font-weight: 700;
  background: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  padding: 2px 7px;
  border-radius: 10px;
}

.artifacts-modal-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.artifacts-header-btn {
  background: transparent;
  border: 1px solid var(--vscode-button-secondaryBorder, rgba(255, 255, 255, 0.2));
  color: var(--vscode-foreground, #ccc);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s ease;
}

.artifacts-header-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
  color: #fff;
}

.artifacts-close-btn {
  background: transparent;
  border: none;
  color: var(--vscode-foreground, #ccc);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.artifacts-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.artifacts-modal-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 18px;
  background: var(--vscode-editorGroupHeader-tabsBackground, #1f1f1f);
  border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
}

.artifacts-tab {
  background: transparent;
  border: none;
  color: var(--vscode-descriptionForeground, #888);
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.artifacts-tab:hover {
  color: var(--vscode-foreground, #ccc);
  background: rgba(255, 255, 255, 0.06);
}

.artifacts-tab.active {
  color: #fff;
  background: var(--vscode-button-background, #0e639c);
  font-weight: 600;
}

.artifacts-tab .tab-badge {
  font-size: 10px;
  background: rgba(255, 255, 255, 0.2);
  padding: 1px 5px;
  border-radius: 8px;
}

.artifacts-modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  grid-auto-rows: max-content;
  gap: 16px;
  align-content: start;
}

.artifacts-empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 48px 16px;
  color: var(--vscode-descriptionForeground, #888);
  font-size: 13px;
}

/* Artifact Card Styling */
.artifact-card {
  background: transparent;
  border: none;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  cursor: pointer;
}

.artifact-card-preview {
  height: 200px;
  min-height: 200px;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.artifact-card:hover .artifact-card-preview {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.artifact-card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s ease;
}

.artifact-card-preview:hover .artifact-card-img {
  transform: scale(1.04);
}

.artifact-card-icon-preview {
  font-size: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.artifact-card-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  backdrop-filter: blur(2px);
  text-transform: uppercase;
  z-index: 5;
}

.artifact-card-badge.ai {
  background: rgba(147, 51, 234, 0.85);
}

.artifact-card-badge.user {
  background: rgba(14, 165, 233, 0.85);
}

.artifact-card-badge.plan {
  background: rgba(16, 185, 129, 0.85);
}

.artifact-card-badge.scratch {
  background: rgba(245, 158, 11, 0.85);
}

.artifact-card-info {
  padding: 8px 4px 4px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 42px;
  box-sizing: border-box;
}

.artifact-card-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground, #ccc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.artifact-card-meta {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #888);
  display: flex;
  align-items: center;
  justify-content: space-between;
  line-height: 1.2;
}

.artifact-card-prompt {
  display: none;
}

/* Hover action overlay on thumbnail */
.artifact-card-hover-actions {
  position: absolute;
  inset: 0;
  background: linear-gradient(transparent 45%, rgba(0, 0, 0, 0.78) 100%);
  opacity: 0;
  transition: opacity 0.18s ease;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 4px;
  padding: 8px;
  z-index: 6;
}

.artifact-card-preview:hover .artifact-card-hover-actions {
  opacity: 1;
}

.artifact-btn-overlay {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transition: background 0.12s ease;
  white-space: nowrap;
}

.artifact-btn-overlay:hover {
  background: rgba(255, 255, 255, 0.28);
}

/* Primary all-artifacts button on header */
.primary-artifact-btn {
  background: var(--vscode-button-secondaryBackground, #3a3d41) !important;
  color: var(--vscode-button-secondaryForeground, #ffffff) !important;
  border: 1px solid var(--vscode-button-secondaryBorder, rgba(255, 255, 255, 0.2)) !important;
  font-weight: 600 !important;
}

.primary-artifact-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground, #45494e) !important;
  border-color: var(--vscode-focusBorder, #007acc) !important;
}
`;

