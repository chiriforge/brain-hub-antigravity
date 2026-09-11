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
`;

