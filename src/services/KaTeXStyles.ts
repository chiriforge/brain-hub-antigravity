import { KATEX_BASE_CSS } from './KaTeXBaseCss';

export const KATEX_CSS = KATEX_BASE_CSS;

export function getKaTeXCss(fontsUri?: string): string {
  let css = KATEX_BASE_CSS;
  if (fontsUri) {
    let cleanUri = fontsUri;
    while (cleanUri.endsWith('/')) {
      cleanUri = cleanUri.slice(0, -1);
    }
    // Replace both relative "fonts/..." and full CDN font URLs with properly quoted local Webview URIs
    css = css.replace(
      /url\(\s*["']?(?:fonts\/|https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^/]+\/dist\/fonts\/)([^)"']+)["']?\s*\)/g,
      (match, fontFile) => `url("${cleanUri}/${fontFile}")`
    );
  }

  return (
    css +
    `
    /* Enhanced KaTeX Typography & Formula Presentation */
    .katex {
      font-size: 1.06em;
      text-rendering: geometricPrecision;
      color: var(--text-primary, #cccccc);
      line-height: 1.2;
    }

    .katex .mathnormal,
    .katex .mathit {
      font-family: KaTeX_Math, KaTeX_Main, serif;
      font-style: italic;
      text-rendering: geometricPrecision;
    }

    .katex .mathrm {
      font-family: KaTeX_Main, serif;
      font-style: normal;
      text-rendering: geometricPrecision;
    }

    .katex .mathbf {
      font-family: KaTeX_Main, serif;
      font-weight: 700;
      text-rendering: geometricPrecision;
    }

    /* Math fraction line & spacing */
    .katex .mfrac {
      vertical-align: 0em;
    }

    .katex .mfrac .frac-line {
      border-bottom-width: 1.3px !important;
      border-bottom-color: currentColor !important;
    }

    .katex .mfrac .vlist > span > span {
      padding: 1.5px 0;
    }

    /* Display (Block) Math Container */
    .katex-display {
      margin: 18px 0 !important;
      padding: 14px 20px !important;
      background: var(--code-bg, rgba(128, 128, 128, 0.06));
      border: 1px solid var(--border-color, rgba(128, 128, 128, 0.22));
      border-radius: var(--radius-md, 6px);
      overflow-x: auto;
      overflow-y: hidden;
      display: block;
      text-align: center;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
    }

    .katex-display > .katex {
      display: inline-block;
      text-align: center;
      max-width: 100%;
    }

    /* Inline math styling for seamless legibility with body text */
    .markdown-content p .katex,
    .markdown-content li .katex,
    .markdown-content td .katex,
    .message-bubble p .katex,
    .message-bubble li .katex {
      padding: 1px 4px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.07);
      border: 1px solid rgba(56, 189, 248, 0.18);
      vertical-align: -0.08em;
      display: inline-block;
      margin: 0 1px;
    }

    body.vscode-light .markdown-content p .katex,
    body.vscode-light .markdown-content li .katex,
    body.vscode-light .markdown-content td .katex,
    body.vscode-light .message-bubble p .katex,
    body.vscode-light .message-bubble li .katex {
      color: #1e1e1e;
      background: rgba(14, 99, 156, 0.06);
      border-color: rgba(14, 99, 156, 0.18);
    }

    /* Operators & Relations spacing */
    .katex .mrel,
    .katex .mbin {
      padding: 0 0.15em;
    }

    /* Resilient KaTeX Fallback & Error Suppression */
    .katex-fallback {
      display: inline-block;
      padding: 2px 8px;
      margin: 2px 0;
      font-family: var(--vscode-editor-font-family, var(--font-mono, Consolas, "Courier New", monospace));
      font-size: 0.9em;
      line-height: 1.4;
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-badge-background, rgba(127, 127, 127, 0.12));
      border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
      border-radius: 4px;
      white-space: normal;
      word-break: break-word;
      user-select: text;
      cursor: text;
    }

    .katex-display .katex-fallback {
      display: inline-block;
      padding: 8px 16px;
      font-size: 0.95em;
      text-align: center;
      margin: 0 auto;
    }

    .katex-error {
      color: inherit !important;
      background: rgba(239, 68, 68, 0.08) !important;
      border: 1px solid rgba(239, 68, 68, 0.25) !important;
      border-radius: 4px !important;
      padding: 1px 6px !important;
      font-family: var(--vscode-editor-font-family, monospace) !important;
      font-size: 0.88em !important;
      white-space: normal !important;
      word-break: break-word !important;
    }

    body.vscode-light .katex-fallback {
      color: #1e1e1e;
      background: rgba(0, 0, 0, 0.05);
      border-color: rgba(0, 0, 0, 0.15);
    }
  `
  );
}

