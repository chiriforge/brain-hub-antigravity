import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import { MermaidSanitizer } from './MermaidSanitizer';
import { KaTeXSanitizer } from './KaTeXSanitizer';

export class MarkdownRenderer {
  private static isInitialized: boolean = false;
  public static currentSessionPath: string | undefined;

  public static setSessionPath(sessionPath: string | undefined): void {
    MarkdownRenderer.currentSessionPath = sessionPath;
  }

  public static resolveLocalImagePath(rawPath: string, sessionPath?: string): string | null {
    let clean = (rawPath || '').trim();
    if (!clean) {
      return null;
    }
    try {
      clean = decodeURIComponent(clean);
    } catch {}
    // Remove enclosing quotes or angled brackets
    clean = clean.replace(/^["'<]+|["'>]+$/g, '');
    if (/^file:\/\/\/?/i.test(clean)) {
      clean = clean.replace(/^file:\/\/\/?/i, '');
    }

    const targetSessionPath = sessionPath || MarkdownRenderer.currentSessionPath;

    const candidates: string[] = [
      clean,
      path.normalize(clean)
    ];

    if (targetSessionPath) {
      candidates.push(
        path.resolve(targetSessionPath, clean),
        path.resolve(targetSessionPath, path.basename(clean)),
        path.resolve(targetSessionPath, 'artifacts', path.basename(clean)),
        path.resolve(targetSessionPath, '.tempmediaStorage', path.basename(clean)),
        path.resolve(targetSessionPath, '.user_uploaded', path.basename(clean)),
        path.resolve(targetSessionPath, 'scratch', path.basename(clean))
      );
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          if (fs.statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {}
      }
    }

    // Directory fallback & prefix matching
    const dir = path.dirname(clean);
    const baseNoExt = path.basename(clean, path.extname(clean));
    const searchDirs: string[] = [dir];
    if (targetSessionPath) {
      searchDirs.push(
        targetSessionPath,
        path.join(targetSessionPath, 'artifacts'),
        path.join(targetSessionPath, '.tempmediaStorage'),
        path.join(targetSessionPath, '.user_uploaded'),
        path.join(targetSessionPath, 'scratch')
      );
    }

    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'];

    for (const d of searchDirs) {
      if (!d || !fs.existsSync(d)) {
        continue;
      }
      for (const ext of extensions) {
        const altFile = path.join(d, baseNoExt + ext);
        if (fs.existsSync(altFile)) {
          try {
            if (fs.statSync(altFile).isFile()) {
              return altFile;
            }
          } catch {}
        }
      }
      try {
        const files = fs.readdirSync(d);
        const match = files.find(f => f.startsWith(baseNoExt) && /\.(png|jpg|jpeg|webp|gif|svg|bmp)$/i.test(f));
        if (match) {
          const fullMatch = path.join(d, match);
          if (fs.statSync(fullMatch).isFile()) {
            return fullMatch;
          }
        }
      } catch {}
    }

    return null;
  }

  public static fileToDataUri(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 20 * 1024 * 1024) {
        return null;
      }
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
      let mime = ext;
      if (ext === 'jpg') {
        mime = 'jpeg';
      } else if (ext === 'svg') {
        mime = 'svg+xml';
      }
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      console.error('Failed to convert file to data URI:', filePath, e);
      return null;
    }
  }

  public static renderImage(href: string, title?: string | null, text?: string, sessionPath?: string): string {
    const cleanHref = (href || '').trim();
    if (!cleanHref) {
      return '';
    }

    const captionHtml = text ? `<div class="chat-image-caption">${MarkdownRenderer.escapeHtml(text)}</div>` : '';

    if (cleanHref.startsWith('data:image/') || /^https?:\/\//i.test(cleanHref)) {
      const titleAttr = title ? ` title="${MarkdownRenderer.escapeHtml(title)}"` : '';
      const dataSrcAttr = ` data-image-src="${cleanHref.startsWith('data:image/') ? 'data:image' : MarkdownRenderer.escapeHtml(cleanHref)}"`;
      return `<div class="chat-image-container"><img src="${cleanHref}" alt="${MarkdownRenderer.escapeHtml(text || '')}" class="chat-rendered-img" onclick="openMediaModal(this.src)" loading="lazy"${dataSrcAttr}${titleAttr} />${captionHtml}</div>`;
    }

    const resolved = MarkdownRenderer.resolveLocalImagePath(cleanHref, sessionPath);
    if (resolved) {
      const dataUri = MarkdownRenderer.fileToDataUri(resolved);
      if (dataUri) {
        const hoverTitle = title || text || path.basename(resolved);
        const titleAttr = ` title="${MarkdownRenderer.escapeHtml(hoverTitle)}"`;
        const dataSrcAttr = ` data-image-src="${encodeURIComponent(cleanHref)}" data-original-path="${encodeURIComponent(resolved)}"`;
        return `<div class="chat-image-container"><img src="${dataUri}" alt="${MarkdownRenderer.escapeHtml(text || '')}" class="chat-rendered-img" onclick="openMediaModal(this.src)" loading="lazy"${dataSrcAttr}${titleAttr} />${captionHtml}</div>`;
      }
    }

    const filename = path.basename(cleanHref) || cleanHref;
    return `<div class="chat-image-missing" title="Image not found: ${MarkdownRenderer.escapeHtml(cleanHref)}"><span class="missing-icon">🖼️</span><span class="missing-text">${MarkdownRenderer.escapeHtml(text || filename)}</span><span class="missing-tag">(Not found)</span></div>`;
  }


  public static highlightCode(text: string, lang?: string): string {
    const language = (lang || '').trim().toLowerCase();
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } catch {
        return MarkdownRenderer.escapeHtml(text);
      }
    }
    try {
      return hljs.highlightAuto(text).value;
    } catch {
      return MarkdownRenderer.escapeHtml(text);
    }
  }

  public static formatCodeLines(highlightedHtml: string): string {
    const rawLines = highlightedHtml.split(/\r?\n/);
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }

    const openTags: string[] = [];
    const formattedLines: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const lineNum = i + 1;
      const line = rawLines[i];
      const prefix = openTags.join('');

      const tagRegex = /<(\/)?([a-zA-Z0-9]+)([^>]*)>/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(line)) !== null) {
        const isClosing = match[1] === '/';
        const fullTag = match[0];
        if (isClosing) {
          openTags.pop();
        } else if (!fullTag.endsWith('/>')) {
          openTags.push(fullTag);
        }
      }

      const suffix = openTags
        .slice()
        .reverse()
        .map((tag) => {
          const tagName = tag.match(/<([a-zA-Z0-9]+)/)?.[1] || 'span';
          return `</${tagName}>`;
        })
        .join('');

      const content = prefix + line + suffix;
      const safeContent = content === '' ? '&nbsp;' : content;

      formattedLines.push(
        `<div class="code-line"><span class="line-num" aria-hidden="true">${lineNum}</span><span class="line-content">${safeContent}</span></div>`
      );
    }

    return formattedLines.join('');
  }

  public static renderCodeBlock(text: string, lang?: string): string {
    const language = (lang || 'plaintext').trim().toLowerCase();
    const displayLang = language || 'text';
    const rawCodeEncoded = encodeURIComponent(text);
    const highlightedCode = MarkdownRenderer.highlightCode(text, language);
    const formattedLines = MarkdownRenderer.formatCodeLines(highlightedCode);

    return `
      <div class="code-container" data-language="${displayLang}">
        <div class="code-header">
          <span class="code-lang-badge">${displayLang}</span>
          <div class="code-header-actions">
            <button class="code-action-btn toggle-wrap-btn" title="Toggle word wrap">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M1 3.5a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 3.5Zm0 4a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.5Zm0 4a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 11.5Z"></path>
              </svg>
              <span>Wrap</span>
            </button>
            <button class="copy-code-btn" data-code="${rawCodeEncoded}" title="Copy code to clipboard">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>
        </div>
        <pre><code class="hljs language-${displayLang}">${formattedLines}</code></pre>
      </div>
    `;
  }

  private static initialize(): void {
    if (MarkdownRenderer.isInitialized) {
      return;
    }

    marked.use(
      markedKatex({
        throwOnError: false,
        nonStandard: true
      }),
      {
        gfm: true,
        breaks: true,
        renderer: {
          heading(this: any, { tokens, depth, text }: { tokens?: any[]; depth: number; text: string }) {
            let plainText = text;
            let prevText: string;
            do {
              prevText = plainText;
              plainText = plainText.replace(/<[^>]*>/g, '');
            } while (plainText !== prevText);
            plainText = plainText.trim();
            const slug = plainText.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
            const idAttr = slug ? ` id="${slug}"` : '';
            const content = tokens && this?.parser?.parseInline ? this.parser.parseInline(tokens) : text;
            return `<h${depth}${idAttr}>${content}</h${depth}>\n`;
          },
          code({ text, lang }: { text: string; lang?: string }) {
            const language = (lang || 'plaintext').trim().toLowerCase();
            const displayLang = language || 'text';
            const rawCodeEncoded = encodeURIComponent(text);

            if (language === 'mermaid' && MermaidSanitizer.isDiagram(text)) {
              const escapedCode = MarkdownRenderer.escapeHtml(text);
              const sanitizedCode = MermaidSanitizer.applySmartWordWrap(
                MermaidSanitizer.sanitize(MermaidSanitizer.preprocessAntigravitySyntax(text)),
                32,
                26
              );
              const sanitizedCodeEncoded = encodeURIComponent(sanitizedCode);
              const beautifulSvg = MermaidSanitizer.renderBeautifulMermaid(text);
              const beautifulSvgAttr = beautifulSvg ? ` data-beautiful-svg="${encodeURIComponent(beautifulSvg)}"` : '';
              return `
                <div class="mermaid-container" data-mermaid="${rawCodeEncoded}" data-sanitized="${sanitizedCodeEncoded}"${beautifulSvgAttr}>
                  <div class="code-container" data-language="mermaid">
                    <div class="code-header">
                      <span class="code-lang-badge">MERMAID</span>
                      <button class="copy-code-btn" data-code="${rawCodeEncoded}" title="Copy Mermaid source">
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
                          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
                        </svg>
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre><code class="language-mermaid">${escapedCode}</code></pre>
                  </div>
                </div>
              `;
            }

            const highlightedCode = MarkdownRenderer.highlightCode(text, language);
            const formattedLines = MarkdownRenderer.formatCodeLines(highlightedCode);

            return `
              <div class="code-container" data-language="${displayLang}">
                <div class="code-header">
                  <span class="code-lang-badge">${displayLang}</span>
                  <div class="code-header-actions">
                    <button class="code-action-btn toggle-wrap-btn" title="Toggle word wrap">
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                        <path d="M1 3.5a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 3.5Zm0 4a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.5Zm0 4a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 11.5Z"></path>
                      </svg>
                      <span>Wrap</span>
                    </button>
                    <button class="copy-code-btn" data-code="${rawCodeEncoded}" title="Copy code to clipboard">
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                        <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
                        <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
                      </svg>
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
                <pre><code class="hljs language-${displayLang}">${formattedLines}</code></pre>
              </div>
            `;
          },
          codespan({ text }: { text: string }) {
            const trimmed = text.trim();
            if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
              return `<span class="color-chip-badge" data-color="${trimmed}" title="Color: ${trimmed} (Click to copy)"><span class="color-swatch" style="background-color: ${trimmed};"></span><span class="color-hex">${trimmed}</span></span>`;
            }
            return `<code class="inline-code">${MarkdownRenderer.escapeHtml(text)}</code>`;
          },
          image({ href, title, text }: { href: string; title?: string | null; text: string }) {
            return MarkdownRenderer.renderImage(href, title, text);
          },
          link({ href, title, text }: { href: string; title?: string | null; text: string }) {
            const cleanHref = (href || '').trim();
            const isFile =
              cleanHref.length > 0 &&
              cleanHref !== '#' &&
              !cleanHref.startsWith('#') &&
              !/^https?:\/\//i.test(cleanHref) &&
              !/^mailto:/i.test(cleanHref) &&
              cleanHref !== 'javascript:void(0)';

            if (isFile) {
              let displayPath = cleanHref;
              try {
                displayPath = decodeURIComponent(displayPath);
              } catch {}
              if (/^file:\/\/\/?/i.test(displayPath)) {
                displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
              }
              const hoverTitle = displayPath;
              const titleAttr = ` title="${MarkdownRenderer.escapeHtml(hoverTitle)}"`;
              const encodedPath = encodeURIComponent(cleanHref);
              const decodedPathAttr = ` data-decoded-path="${MarkdownRenderer.escapeHtml(displayPath)}"`;
              const fileDataAttr = ` data-file-url="${encodedPath}" data-filepath="${encodedPath}"${decodedPathAttr}`;
              const isMd = MarkdownRenderer.isMarkdownPath(displayPath);

              if (isMd) {
                return `<span class="md-link-wrapper"><a href="javascript:void(0)"${titleAttr}${fileDataAttr} data-is-md="true" class="markdown-link file-link md-file-link">${text}</a><span class="md-link-actions"><button class="md-action-btn rich-preview-btn" data-filepath="${encodedPath}" title="Open with Antigravity Rich Preview (Mermaid & KaTeX)">🔎</button><button class="md-action-btn ide-preview-btn" data-filepath="${encodedPath}" title="Open with IDE Built-in Markdown Preview">📄</button></span></span>`;
              }

              return `<a href="javascript:void(0)"${titleAttr}${fileDataAttr} class="markdown-link file-link">${text}</a>`;
            } else {
              const hoverTitle = title || cleanHref;
              const titleAttr = hoverTitle ? ` title="${MarkdownRenderer.escapeHtml(hoverTitle)}"` : '';
              const decodedPathAttr = ` data-decoded-path="${MarkdownRenderer.escapeHtml(cleanHref)}"`;
              return `<a href="${cleanHref}"${titleAttr}${decodedPathAttr} target="_blank" rel="noopener noreferrer" class="markdown-link">${text}</a>`;
            }
          }
        }
      }
    );

    MarkdownRenderer.isInitialized = true;
  }

  public static isMarkdownPath(filePath: string): boolean {
    if (!filePath) return false;
    const clean = filePath.split('?')[0].split('#')[0].toLowerCase();
    return clean.endsWith('.md') || clean.endsWith('.markdown');
  }

  private static readonly SHELL_VAR_REGEX = /\$(?:\{[A-Za-z_]\w*\}|[A-Z_][A-Z0-9_]+(?!\w))/y;
  private static readonly CONTAINER_PREFIX_REGEX = /^\s*(?:>\s*|(?:[-+*]|\d+[.)])\s+)*/;
  private static readonly LIST_MARKER_LINE_REGEX = /^\s*(?:(?:[-+*]|\d+[.)])\s+)+/;

  private static matchShellVarLength(text: string, pos: number): number {
    MarkdownRenderer.SHELL_VAR_REGEX.lastIndex = pos;
    return MarkdownRenderer.SHELL_VAR_REGEX.exec(text)?.[0].length ?? 0;
  }

  private static countBlockquoteDepth(prefix: string): number {
    let depth = 0;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] === '>') depth++;
    }
    return depth;
  }

  private static getFencePrefixInfo(prefix: string): { blockquoteDepth: number; indent: number } {
    const blockquoteDepth = MarkdownRenderer.countBlockquoteDepth(prefix);
    const lastGt = prefix.lastIndexOf('>');
    if (lastGt === -1) {
      return { blockquoteDepth: 0, indent: prefix.length };
    }
    const after = prefix.slice(lastGt + 1);
    const indent = after.startsWith(' ') || after.startsWith('\t') ? after.length - 1 : after.length;
    return { blockquoteDepth, indent };
  }

  private static splitContainerPrefix(line: string, maxQuoteDepth: number | null = null): {
    containerPrefix: string;
    continuationPrefix: string;
    rest: string;
  } {
    const regex = maxQuoteDepth === null
      ? MarkdownRenderer.CONTAINER_PREFIX_REGEX
      : new RegExp(`^\\s*(?:>\\s*){0,${maxQuoteDepth}}`);
    const containerPrefix = line.match(regex)?.[0] ?? '';
    const continuationPrefix = containerPrefix.replace(/[-+*]|\d+[.)]/g, (m) => ' '.repeat(m.length));
    return {
      containerPrefix,
      continuationPrefix,
      rest: line.slice(containerPrefix.length)
    };
  }

  private static countDisplayMathDelimitersOnLine(line: string): number {
    let count = 0;
    const segments = line.split(/(`[^`]*`)/);
    for (let i = 0; i < segments.length; i += 2) {
      const cleaned = segments[i]
        .replace(/(?<!\\)\\\$/g, '__')
        .replace(/(?<!\\)\\[[\]]/g, () => '$$');
      count += [...cleaned.matchAll(/\$\$+/g)].length;
    }
    return count;
  }

  private static hasClosingDisplayMathAhead(lines: string[], startIndex: number): boolean {
    let count = 0;
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (
        /^\s*$/.test(line) ||
        /^\s*(?:```|#{1,6}\s|>)/.test(line) ||
        MarkdownRenderer.LIST_MARKER_LINE_REGEX.test(line)
      ) {
        break;
      }
      if (MarkdownRenderer.countDisplayMathDelimitersOnLine(line) === 1) {
        count++;
      }
    }
    return count % 2 === 1;
  }

  private static ensureMinimumIndent(line: string, minIndent: string): string {
    const leadingWhitespace = line.match(/^\s*/)?.[0] ?? '';
    if (!/\S/.test(line) || leadingWhitespace.length >= minIndent.length) {
      return line;
    }
    return minIndent + line.slice(leadingWhitespace.length);
  }

  private static normalizeDisplayMathLine(
    line: string,
    mathBlockquoteDepth: number | null,
    allowInlineSplit: boolean = false
  ): { lines: string[]; mathBlockquoteDepth: number | null } {
    if (!line.includes('$$')) {
      return { lines: [line], mathBlockquoteDepth };
    }
    const { containerPrefix, continuationPrefix, rest } = MarkdownRenderer.splitContainerPrefix(line, mathBlockquoteDepth);
    const segments = rest.split(/(`[^`]*`)/);

    let matchSegIdx = -1;
    let singleMatch: RegExpExecArray | null = null;
    for (let i = 0; i < segments.length; i += 2) {
      const matches = [...segments[i].replace(/(?<!\\)\\\$/g, '__').matchAll(/\$\$+/g)];
      if (matches.length > 1 || (matches.length === 1 && singleMatch !== null)) {
        return { lines: [line], mathBlockquoteDepth };
      }
      if (matches.length === 1) {
        matchSegIdx = i;
        singleMatch = matches[0];
      }
    }

    if (!singleMatch || singleMatch.index === undefined) {
      return { lines: [line], mathBlockquoteDepth };
    }

    const seg = segments[matchSegIdx];
    const beforeText = segments.slice(0, matchSegIdx).join('') + seg.slice(0, singleMatch.index);
    const delimToken = singleMatch[0];
    const afterText = seg.slice(singleMatch.index + delimToken.length) + segments.slice(matchSegIdx + 1).join('');
    const hasBefore = /\S/.test(beforeText);
    const hasAfter = /\S/.test(afterText);

    if (mathBlockquoteDepth === null) {
      const nextDepth = MarkdownRenderer.countBlockquoteDepth(containerPrefix);
      if (hasBefore) {
        if (!allowInlineSplit) {
          return { lines: [line], mathBlockquoteDepth: null };
        }
        const outLines = [containerPrefix + beforeText.trimEnd(), continuationPrefix + delimToken];
        if (hasAfter) {
          outLines.push(continuationPrefix + afterText.trimStart());
        }
        return { lines: outLines, mathBlockquoteDepth: nextDepth };
      }
      if (hasAfter) {
        return {
          lines: [containerPrefix + delimToken, continuationPrefix + afterText.trimStart()],
          mathBlockquoteDepth: nextDepth
        };
      }
      return { lines: [line], mathBlockquoteDepth: nextDepth };
    }

    if (!hasBefore && !hasAfter) {
      return { lines: [line], mathBlockquoteDepth: null };
    }
    const parts: string[] = [];
    if (hasBefore) parts.push(beforeText.trimEnd());
    parts.push(delimToken);
    if (hasAfter) parts.push(afterText.trimStart());
    return {
      lines: parts.map((part, idx) => (idx === 0 ? containerPrefix : continuationPrefix) + part),
      mathBlockquoteDepth: null
    };
  }

  private static normalizeBracketAndDisplayMathLine(
    line: string,
    mathBlockquoteDepth: number | null,
    allowInlineSplit: boolean
  ): { lines: string[]; mathBlockquoteDepth: number | null } {
    if (!line.includes('\\[') && !line.includes('\\]')) {
      return MarkdownRenderer.normalizeDisplayMathLine(line, mathBlockquoteDepth, allowInlineSplit);
    }
    const { containerPrefix, continuationPrefix, rest } = MarkdownRenderer.splitContainerPrefix(line, mathBlockquoteDepth);
    const segments = rest.split(/(`[^`]*`)/);
    interface BracketToken {
      segIdx: number;
      start: number;
      isOpener: boolean;
      balanced: boolean;
    }
    const tokens: BracketToken[] = [];
    const stack: BracketToken[] = [];
    for (let i = 0; i < segments.length; i += 2) {
      for (const m of segments[i].matchAll(/(?<!\\)\\\[|\\\]/g)) {
        const isOpener = m[0] === '\\[';
        const tok: BracketToken = { segIdx: i, start: m.index!, isOpener, balanced: false };
        if (isOpener) {
          stack.push(tok);
        } else if (stack.length > 0) {
          stack.pop()!.balanced = true;
          tok.balanced = true;
        }
        tokens.push(tok);
      }
    }
    if (tokens.length === 0) {
      return MarkdownRenderer.normalizeDisplayMathLine(line, mathBlockquoteDepth, allowInlineSplit);
    }
    if (!tokens.some((t) => !t.balanced)) {
      const converted = segments
        .map((seg, idx) => (idx % 2 === 1 ? seg : seg.replace(/(?<!\\)\\\[|\\\]/g, '$$$$')))
        .join('');
      return MarkdownRenderer.normalizeDisplayMathLine(containerPrefix + converted, mathBlockquoteDepth, allowInlineSplit);
    }
    const outParts: string[] = [];
    let buffer = '';
    let nextDepth = mathBlockquoteDepth;
    for (let i = 0; i < segments.length; i++) {
      if (i % 2 === 1) {
        buffer += segments[i];
        continue;
      }
      const seg = segments[i];
      let cursor = 0;
      for (const tok of tokens) {
        if (tok.segIdx === i) {
          buffer += seg.slice(cursor, tok.start);
          if (tok.balanced) {
            buffer += '$$';
          } else {
            if (/\S/.test(buffer)) {
              outParts.push(buffer.trim());
            }
            buffer = '';
            outParts.push('$$');
            nextDepth = tok.isOpener ? MarkdownRenderer.countBlockquoteDepth(containerPrefix) : null;
          }
          cursor = tok.start + 2;
        }
      }
      buffer += seg.slice(cursor);
    }
    if (/\S/.test(buffer)) {
      outParts.push(buffer.trimStart());
    }
    return {
      lines: outParts.map((part, idx) => (idx === 0 ? containerPrefix : continuationPrefix) + part),
      mathBlockquoteDepth: nextDepth
    };
  }

  /**
   * Pre-processes LaTeX math expressions within markdown, escaping reserved characters
   * (e.g. unescaped '&', '_', '%') via KaTeXSanitizer to prevent KaTeX parse errors.
   */
  public static preprocessMath(markdown: string): string {
    if (!markdown) {
      return '';
    }

    const rawLines = markdown.split(/\r?\n/);
    let fenceState: { char: string; length: number; blockquoteDepth: number; indent: number } | null = null;
    let mathBlockquoteDepth: number | null = null;
    let listContinuationIndent: string | null = null;
    let inListMathContinuation = false;
    const disambiguatedLines: string[] = [];

    for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
      const rawLine = rawLines[lineIdx];
      const fenceMatch = /^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(rawLine);

      if (fenceState === null) {
        if (fenceMatch) {
          const [, prefix, fenceTicks, infoString] = fenceMatch;
          const { blockquoteDepth, indent } = MarkdownRenderer.getFencePrefixInfo(prefix);
          if (fenceTicks[0] !== '`' || !infoString.includes('`')) {
            fenceState = { char: fenceTicks[0], length: fenceTicks.length, blockquoteDepth, indent };
            disambiguatedLines.push(rawLine);
            continue;
          }
        }
      } else {
        if (fenceMatch) {
          const [, prefix, fenceTicks, infoString] = fenceMatch;
          const { blockquoteDepth, indent } = MarkdownRenderer.getFencePrefixInfo(prefix);
          if (
            blockquoteDepth === fenceState.blockquoteDepth &&
            indent <= fenceState.indent + 3 &&
            fenceTicks[0] === fenceState.char &&
            fenceTicks.length >= fenceState.length &&
            infoString.trim() === ''
          ) {
            fenceState = null;
          }
        }
        disambiguatedLines.push(rawLine);
        continue;
      }

      const wasInMathBlock = mathBlockquoteDepth !== null;
      const listMatch = wasInMathBlock ? undefined : rawLine.match(MarkdownRenderer.LIST_MARKER_LINE_REGEX)?.[0];
      if (!wasInMathBlock) {
        if (/^\s*$/.test(rawLine) || /^\s*(?:#{1,6}\s|>)/.test(rawLine)) {
          listContinuationIndent = null;
          inListMathContinuation = false;
        } else if (listMatch) {
          listContinuationIndent = ' '.repeat(listMatch.length);
          inListMathContinuation = false;
        }
      }

      const allowInlineSplit =
        !wasInMathBlock &&
        MarkdownRenderer.countDisplayMathDelimitersOnLine(rawLine) === 1 &&
        MarkdownRenderer.hasClosingDisplayMathAhead(rawLines, lineIdx + 1);

      const normalized = MarkdownRenderer.normalizeBracketAndDisplayMathLine(
        rawLine,
        mathBlockquoteDepth,
        allowInlineSplit
      );
      mathBlockquoteDepth = normalized.mathBlockquoteDepth;
      const isMathContinuation = wasInMathBlock || mathBlockquoteDepth !== null;
      const effectiveIndent = isMathContinuation || inListMathContinuation ? listContinuationIndent : null;
      if (listContinuationIndent !== null && isMathContinuation) {
        inListMathContinuation = true;
      }

      for (const [subIdx, subLine] of normalized.lines.entries()) {
        const indentedLine =
          effectiveIndent === null || (subIdx === 0 && listMatch)
            ? subLine
            : MarkdownRenderer.ensureMinimumIndent(subLine, effectiveIndent);

        const processedSubLine = indentedLine
          .split(/(`[^`]*`)/)
          .map((segment, segIdx) => {
            if (segIdx % 2 === 1) {
              return segment;
            }
            let text = segment
              .replace(/(?<!\\)\\\$/g, '\uE0D0')
              .replace(/(?<!\\)\\[()]/g, '\uE0D1');

            const singleDollarPositions: number[] = [];
            for (let pos = 0; pos < text.length; pos++) {
              if (text[pos] !== '$') continue;
              let endPos = pos;
              while (endPos < text.length && text[endPos] === '$') {
                endPos++;
              }
              if (endPos - pos === 1) {
                singleDollarPositions.push(pos);
              }
              pos = endPos - 1;
            }

            const literalIndices = new Set<number>();
            let w = -1;

            for (const x of singleDollarPositions) {
              if (w === -1) {
                w = x;
                continue;
              }
              const v = text.slice(w + 1, x);
              const y = text[x + 1] ?? '';
              const B = /^[0-9]/.test(v) && !/[\\^_{}=+]/.test(v);
              const C = MarkdownRenderer.matchShellVarLength(text, w);
              const D = x - w === C;
              const E = !/[A-Za-z0-9)\]}]/.test(text[x - 1]);

              if (/[0-9]/.test(y) && B) {
                literalIndices.add(w);
                w = x;
              } else if (
                (MarkdownRenderer.matchShellVarLength(text, x) > 0 && (D || E)) ||
                (C > 0 && !D && E && y !== '' && !/[\s.,;:!?)\]}'"*_~\u2014/]/.test(y))
              ) {
                literalIndices.add(w);
                w = x;
              } else if (v.includes('\uE0D1') || v.includes('$$')) {
                literalIndices.add(w);
                w = x;
              } else if (B && /\s/.test(v) && /[a-zA-Z]/.test(v)) {
                literalIndices.add(w);
                if (y === '' || /[\s)\]},.:;!?"'/\-_~*\u2014]/.test(y)) {
                  literalIndices.add(x);
                  w = -1;
                } else {
                  w = x;
                }
              } else {
                w = -1;
              }
            }

            if (w !== -1) {
              literalIndices.add(w);
            }

            if (literalIndices.size !== 0) {
              let rebuilt = '';
              for (let i = 0; i < text.length; i++) {
                rebuilt += literalIndices.has(i) ? '\uE0D0' : text[i];
              }
              text = rebuilt;
            }

            return text.replace(/\uE0D1/g, '$');
          })
          .join('');

        disambiguatedLines.push(processedSubLine);
      }
    }

    const lines = disambiguatedLines;
    const result: string[] = [];
    let inCodeBlock = false;
    let inDisplayMath = false;
    let displayMathPrefix = '';
    let displayMathBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip fenced code blocks
      if (/^([ \t>]*)(`{3,}|~{3,})/.test(line)) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        continue;
      }

      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      const quoteTrimmed = trimmed.replace(/^(?:>\s*)+/, '').trim();
      const quotePrefixMatch = line.match(/^(\s*(?:>\s*)+)/);
      const currentQuotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : '';

      // Check multi-line display math opening
      if (!inDisplayMath && quoteTrimmed === '$$') {
        inDisplayMath = true;
        displayMathPrefix = currentQuotePrefix;
        displayMathBuffer = [];
        continue;
      }

      // Check multi-line display math closing
      if (inDisplayMath && quoteTrimmed === '$$') {
        inDisplayMath = false;
        const sanitizedBlock = KaTeXSanitizer.sanitize(displayMathBuffer.join('\n'));
        const sanitizedLines = sanitizedBlock
          .split('\n')
          .map((l) => (displayMathPrefix ? displayMathPrefix + l : l))
          .join('\n');
        const prevLine = result.length > 0 ? result[result.length - 1] : '';
        if (prevLine.trim() !== '' && prevLine.replace(/^(?:>\s*)+/, '').trim() !== '') {
          result.push(displayMathPrefix.trimEnd());
        }
        result.push(`${displayMathPrefix}$$\n${sanitizedLines}\n${displayMathPrefix}$$`);
        displayMathPrefix = '';
        continue;
      }

      if (inDisplayMath) {
        const cleanMathLine = displayMathPrefix && line.startsWith(displayMathPrefix)
          ? line.slice(displayMathPrefix.length)
          : line.replace(/^\s*(?:>\s*)+/, '');
        displayMathBuffer.push(cleanMathLine);
        continue;
      }

      // Extract and mask inline code blocks to protect them from math regexes
      const codeTokens: string[] = [];
      let processedLine = line.replace(/`[^`\r\n]+`/g, (code) => {
        const idx = codeTokens.length;
        codeTokens.push(code);
        return `___CODE_INLINE_TOKEN_${idx}___`;
      });

      // Process single-line display math: $$ ... $$
      processedLine = processedLine.replace(/\$\$([\s\S]*?)\$\$/g, (match, expr) => {
        return '$$' + KaTeXSanitizer.sanitize(expr) + '$$';
      });

      // Process inline math: $ ... $ (all remaining single $ pairs are guaranteed valid by xGb)
      processedLine = processedLine.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g, (match, expr) => {
        return '$' + KaTeXSanitizer.sanitize(expr) + '$';
      });

      // Restore inline code blocks
      for (let k = codeTokens.length - 1; k >= 0; k--) {
        processedLine = processedLine.replace(`___CODE_INLINE_TOKEN_${k}___`, codeTokens[k]);
      }

      result.push(processedLine);
    }

    if (inDisplayMath) {
      result.push(displayMathPrefix + '$$\n' + KaTeXSanitizer.sanitize(displayMathBuffer.join('\n')));
    }

    return result.join('\n');
  }

  /**
   * Pre-processes chat markdown text to fix common list boundary issues.
   * In casual chat inputs (e.g. Shift+Enter), users often write non-list lines
   * immediately following a list item without an extra blank line.
   * Standard CommonMark treats unindented lines following list items as "lazy continuations" of the <li>.
   * This pre-processor inserts a blank line before any non-indented, non-list line that immediately follows a list,
   * cleanly closing the list and keeping the text line at root paragraph level.
   */
  private static preprocessMarkdownLists(markdown: string): string {
    if (!markdown) {
      return '';
    }

    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let inCodeBlock = false;
    let inList = false;

    const listMarkerRegex = /^(\s*)(?:[-*+]|\d+[\.\)])\s+/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check fenced code block (``` or ~~~)
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        inList = false;
        continue;
      }

      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      if (trimmed === '') {
        inList = false;
        result.push(line);
        continue;
      }

      const isListMarker = listMarkerRegex.test(line);
      const isIndented = /^(\s{2,}|\t)/.test(line);

      if (isListMarker) {
        inList = true;
        result.push(line);
      } else if (inList) {
        if (isIndented) {
          // Indented continuation line inside the list item
          result.push(line);
        } else {
          // Non-indented non-list line immediately following a list item!
          // Insert empty line to break out of the list
          result.push('');
          result.push(line);
          inList = false;
        }
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private static preprocessFileUrls(markdown: string): string {
    if (!markdown) {
      return '';
    }

    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        continue;
      }

      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      // Mask existing markdown links and inline code blocks so bare autolinker never corrupts them
      const urlProtectedTokens: string[] = [];
      const maskUrlToken = (str: string): string => {
        const idx = urlProtectedTokens.length;
        urlProtectedTokens.push(str);
        return `___FILE_URL_MASK_${idx}___`;
      };

      // 1. Mask markdown links: [text](href)
      let processed = line.replace(/\[[^\]\r\n]*\]\([^\)\r\n]*\)/g, (m) => maskUrlToken(m));
      // 2. Mask inline code: `code`
      processed = processed.replace(/`[^`\r\n]+`/g, (m) => maskUrlToken(m));

      // Autolink bare file:/// URLs that are not already enclosed in markdown links or quotes
      processed = processed.replace(
        /(^|[\s\(\[<])((?:file:\/\/\/)[^\s\)\]>"']+)/g,
        (match, prefix, fileUrl) => {
          if (prefix === '(' || prefix === '[') {
            return match;
          }
          const encodedUrl = encodeURIComponent(fileUrl);
          let displayPath = fileUrl;
          try {
            displayPath = decodeURIComponent(displayPath);
          } catch {}
          if (/^file:\/\/\/?/i.test(displayPath)) {
            displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
          }
          const isMd = MarkdownRenderer.isMarkdownPath(displayPath);
          if (isMd) {
            return `${prefix}<span class="md-link-wrapper"><a href="javascript:void(0)" class="markdown-link file-link md-file-link" data-file-url="${encodedUrl}" data-filepath="${encodedUrl}" data-is-md="true" title="${MarkdownRenderer.escapeHtml(displayPath)}">${fileUrl}</a><span class="md-link-actions"><button class="md-action-btn rich-preview-btn" data-filepath="${encodedUrl}" title="Open with Antigravity Rich Preview (Mermaid & KaTeX)">🔎</button><button class="md-action-btn ide-preview-btn" data-filepath="${encodedUrl}" title="Open with IDE Built-in Markdown Preview">📄</button></span></span>`;
          }
          return `${prefix}<a href="javascript:void(0)" class="markdown-link file-link" data-file-url="${encodedUrl}" data-filepath="${encodedUrl}" title="${MarkdownRenderer.escapeHtml(displayPath)}">${fileUrl}</a>`;
        }
      );

      // Restore protected tokens in reverse order
      for (let k = urlProtectedTokens.length - 1; k >= 0; k--) {
        processed = processed.replace(`___FILE_URL_MASK_${k}___`, urlProtectedTokens[k]);
      }

      result.push(processed);
    }

    return result.join('\n');
  }

  public static render(markdown: string, sessionPath?: string): string {
    if (!markdown) {
      return '';
    }

    if (sessionPath) {
      MarkdownRenderer.setSessionPath(sessionPath);
    }

    MarkdownRenderer.initialize();

    try {
      // Pre-process list boundaries so unindented chat lines don't get stuck inside <li>
      const listProcessed = MarkdownRenderer.preprocessMarkdownLists(markdown);

      // Pre-process math expressions so LaTeX control characters are safely escaped
      const mathProcessed = MarkdownRenderer.preprocessMath(listProcessed);

      // Pre-process bare file:/// URLs so they become clickable links
      const fileUrlProcessed = MarkdownRenderer.preprocessFileUrls(mathProcessed);

      // Pre-process GitHub Alerts (> [!NOTE], > [!TIP], etc.)
      const alertProcessed = fileUrlProcessed.replace(
        /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\r?\n((?:>.*\r?\n?)*)/gim,
        (match, type, body) => {
          const alertType = type.toUpperCase();
          const cleanBody = body
            .split(/\r?\n/)
            .map((line: string) => line.replace(/^>\s?/, ''))
            .join('\n')
            .trim();
          return `\n<div class="markdown-alert markdown-alert-${alertType.toLowerCase()}"><div class="markdown-alert-title">${MarkdownRenderer.getAlertIcon(alertType)}<span>${alertType}</span></div><div class="markdown-alert-content">\n\n${cleanBody}\n\n</div></div>\n`;
        }
      );

      let html = marked.parse(alertProcessed) as string;

      // Restore Antigravity PUA sentinel (\uE0D0) back to literal '$' after Marked + KaTeX parsing
      html = html.replace(/\uE0D0/g, '$');

      // Intercept and transform any KaTeX parse errors into clean fallback badges
      html = html.replace(/<span class="katex-error"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi, (match, errorTitle, rawLatex) => {
        const cleanText = KaTeXSanitizer.stripToCleanText(rawLatex) || rawLatex;
        const escapedRaw = MarkdownRenderer.escapeHtml(rawLatex);
        const escapedClean = MarkdownRenderer.escapeHtml(cleanText);
        const safeTitle = MarkdownRenderer.escapeHtml(errorTitle || 'Formula rendering fallback');
        return `<span class="katex-fallback" data-raw-latex="${escapedRaw}" title="${safeTitle}">${escapedClean}</span>`;
      });

      // Post-process any raw <img> tags that might not have gone through marked's image renderer
      html = html.replace(/<img\b([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, src, after) => {
        if (match.includes('chat-rendered-img')) {
          return match;
        }
        if (src.startsWith('data:image/') || /^https?:\/\//i.test(src)) {
          const dataSrcAttr = ` data-image-src="${src.startsWith('data:image/') ? 'data:image' : MarkdownRenderer.escapeHtml(src)}"`;
          return `<div class="chat-image-container"><img ${before}src="${src}" class="chat-rendered-img" onclick="openMediaModal(this.src)" loading="lazy"${dataSrcAttr}${after}></div>`;
        }
        const resolved = MarkdownRenderer.resolveLocalImagePath(src, sessionPath || MarkdownRenderer.currentSessionPath);
        if (resolved) {
          const dataUri = MarkdownRenderer.fileToDataUri(resolved);
          if (dataUri) {
            const dataSrcAttr = ` data-image-src="${encodeURIComponent(src)}" data-original-path="${encodeURIComponent(resolved)}"`;
            return `<div class="chat-image-container"><img ${before}src="${dataUri}" class="chat-rendered-img" onclick="openMediaModal(this.src)" loading="lazy"${dataSrcAttr}${after}></div>`;
          }
        }
        const filename = path.basename(src) || src;
        return `<div class="chat-image-missing" title="Image not found: ${MarkdownRenderer.escapeHtml(src)}"><span class="missing-icon">🖼️</span><span class="missing-text">${MarkdownRenderer.escapeHtml(filename)}</span><span class="missing-tag">(Not found)</span></div>`;
      });

      return MarkdownRenderer.renderColorChipsInText(html);
    } catch (err) {
      console.error('Marked rendering error:', err);
      return MarkdownRenderer.escapeHtml(markdown).replace(/\n/g, '<br />');
    }
  }

  public static renderColorChipsInText(html: string): string {
    if (!html) return '';

    return html.replace(
      /(<pre[\s\S]*?<\/pre>)|(<code[\s\S]*?<\/code>)|(<[^>]+>)|(\(#[0-9a-fA-F]{3,8}\))|((?:^|[^\w#])(#[0-9a-fA-F]{6})\b)/g,
      (match, preBlock, codeBlock, htmlTag, parenHex, plainMatch, plainHex) => {
        if (preBlock || codeBlock || htmlTag) {
          return match;
        }

        if (parenHex) {
          const rawHex = parenHex.slice(1, -1);
          return `(<span class="color-chip-badge" data-color="${rawHex}" title="Color: ${rawHex} (Click to copy)"><span class="color-swatch" style="background-color: ${rawHex};"></span><span class="color-hex">${rawHex}</span></span>)`;
        }

        if (plainHex) {
          const prefix = plainMatch.substring(0, plainMatch.indexOf(plainHex));
          return `${prefix}<span class="color-chip-badge" data-color="${plainHex}" title="Color: ${plainHex} (Click to copy)"><span class="color-swatch" style="background-color: ${plainHex};"></span><span class="color-hex">${plainHex}</span></span>`;
        }

        return match;
      }
    );
  }

  public static preprocessUserDirectives(markdown: string): string {
    if (!markdown) return '';

    const lines = markdown.split(/\r?\n/);
    const result: string[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        continue;
      }

      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      let processedLine = line;

      // 1. Mentions in @[...] syntax:
      // @[conversation:"..."] or @[conversation:...]
      processedLine = processedLine.replace(
        /@\[conversation:\s*"?([^"\]]+)"?\]/gi,
        '<span class="user-directive-pill mention-chat"><span class="pill-icon">💬</span>$1</span>'
      );

      // @[specs/51-ink-stylized-ui-design-system-and-style-guide.md] or @[file:specs/...]
      processedLine = processedLine.replace(
        /@\[(?:file:)?([^\]]+)\]/gi,
        (match, filePath) => {
          const cleanPath = filePath.trim();
          let displayPath = cleanPath;
          try { displayPath = decodeURIComponent(displayPath); } catch {}
          if (/^file:\/\/\/?/i.test(displayPath)) {
            displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
          }
          const encodedPath = encodeURIComponent(cleanPath);
          const isMd = MarkdownRenderer.isMarkdownPath(displayPath);
          if (isMd) {
            return `<span class="md-link-wrapper"><span class="user-directive-pill mention-file md-file-link" data-filepath="${encodedPath}" data-is-md="true" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">📄</span>${cleanPath}</span><span class="md-link-actions"><button class="md-action-btn rich-preview-btn" data-filepath="${encodedPath}" title="Open with Antigravity Rich Preview (Mermaid & KaTeX)">🔎</button><button class="md-action-btn ide-preview-btn" data-filepath="${encodedPath}" title="Open with IDE Built-in Markdown Preview">📄</button></span></span>`;
          }
          return `<span class="user-directive-pill mention-file" data-filepath="${encodedPath}" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">📄</span>${cleanPath}</span>`;
        }
      );

      // 2. Mentions in @<...> syntax (e.g. @<file/folder name>)
      processedLine = processedLine.replace(
        /@<([^>]+)>/g,
        (match, target) => {
          const cleanTarget = target.trim();
          let displayPath = cleanTarget;
          try { displayPath = decodeURIComponent(displayPath); } catch {}
          if (/^file:\/\/\/?/i.test(displayPath)) {
            displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
          }
          const encodedTarget = encodeURIComponent(cleanTarget);
          const isMd = MarkdownRenderer.isMarkdownPath(displayPath);
          const icon = cleanTarget.includes('.') ? '📄' : '📁';
          if (isMd) {
            return `<span class="md-link-wrapper"><span class="user-directive-pill mention-file md-file-link" data-filepath="${encodedTarget}" data-is-md="true" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">${icon}</span>&lt;${cleanTarget}&gt;</span><span class="md-link-actions"><button class="md-action-btn rich-preview-btn" data-filepath="${encodedTarget}" title="Open with Antigravity Rich Preview (Mermaid & KaTeX)">🔎</button><button class="md-action-btn ide-preview-btn" data-filepath="${encodedTarget}" title="Open with IDE Built-in Markdown Preview">📄</button></span></span>`;
          }
          return `<span class="user-directive-pill mention-file" data-filepath="${encodedTarget}" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">${icon}</span>&lt;${cleanTarget}&gt;</span>`;
        }
      );

      // 3. Slash commands anywhere with boundary check (e.g. /discuss, /goal, /schedule, etc.)
      const rSlash = /(^|[\s\(\[\{\"'`])\/([a-zA-Z][a-zA-Z0-9_\-]*)(?=[\s\)\,\.\;\:\!\?\"\'\`\]\}]|$)/g;
      processedLine = processedLine.replace(
        rSlash,
        '$1<span class="user-directive-pill slash-cmd"><span class="pill-icon">⚡</span>/$2</span>'
      );

      // 4. File mentions like @ui_prototype.html or @specs/51-ink.md or @public/style.css
      const rFile = /(^|[\s\(\[\{\"'`])@((?:[\w\.\-]+[\\\/])*[\w\.\-]+\.[a-zA-Z0-9]+)(?=[\s\)\,\.\;\:\!\?\"\'\`\]\}]|$)/g;
      processedLine = processedLine.replace(
        rFile,
        (match, prefix, filePath) => {
          const cleanPath = filePath.trim();
          let displayPath = cleanPath;
          try { displayPath = decodeURIComponent(displayPath); } catch {}
          if (/^file:\/\/\/?/i.test(displayPath)) {
            displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
          }
          const encodedPath = encodeURIComponent(cleanPath);
          const isMd = MarkdownRenderer.isMarkdownPath(displayPath);
          if (isMd) {
            return `${prefix}<span class="md-link-wrapper"><span class="user-directive-pill mention-file md-file-link" data-filepath="${encodedPath}" data-is-md="true" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">📄</span>@${cleanPath}</span><span class="md-link-actions"><button class="md-action-btn rich-preview-btn" data-filepath="${encodedPath}" title="Open with Antigravity Rich Preview (Mermaid & KaTeX)">🔎</button><button class="md-action-btn ide-preview-btn" data-filepath="${encodedPath}" title="Open with IDE Built-in Markdown Preview">📄</button></span></span>`;
          }
          return `${prefix}<span class="user-directive-pill mention-file" data-filepath="${encodedPath}" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">📄</span>@${cleanPath}</span>`;
        }
      );

      // 5. Folder mentions like @specs/ or @public/assets/
      const rFolder = /(^|[\s\(\[\{\"'`])@((?:[\w\.\-]+[\\\/])+)(?=[\s\)\,\.\;\:\!\?\"\'\`\]\}]|$)/g;
      processedLine = processedLine.replace(
        rFolder,
        (match, prefix, folderPath) => {
          const cleanPath = folderPath.trim();
          let displayPath = cleanPath;
          try { displayPath = decodeURIComponent(displayPath); } catch {}
          if (/^file:\/\/\/?/i.test(displayPath)) {
            displayPath = displayPath.replace(/^file:\/\/\/?/i, '');
          }
          return `${prefix}<span class="user-directive-pill mention-file" data-filepath="${encodeURIComponent(cleanPath)}" title="${MarkdownRenderer.escapeHtml(displayPath)}"><span class="pill-icon">📁</span>@${cleanPath}</span>`;
        }
      );

      result.push(processedLine);
    }

    return result.join('\n');
  }

  public static escapeHtml(str: string): string {
    if (!str) {
      return '';
    }
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private static getAlertIcon(type: string): string {
    switch (type) {
      case 'NOTE':
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`;
      case 'TIP':
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.67-.798-1.596-1.9-1.596-3.279C2.5 2.502 4.964 0 8 0c3.036 0 5.5 2.502 5.5 5.25 0 1.379-.925 2.48-1.597 3.28-.178.211-.36.438-.541.68-.208.3-.33.565-.371.847a.75.75 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM6 12a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1Z"></path></svg>`;
      case 'IMPORTANT':
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h3a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h5.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm6.25 2.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 .75-.75Zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`;
      case 'WARNING':
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>`;
      case 'CAUTION':
        return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.047A1.75 1.75 0 0 1 5.708 0h4.584c.464 0 .909.184 1.237.513l4.958 4.958c.329.328.513.773.513 1.237v4.584c0 .464-.184.909-.513 1.237l-4.958 4.958a1.75 1.75 0 0 1-1.237.513H5.708a1.75 1.75 0 0 1-1.237-.513L.513 12.54A1.75 1.75 0 0 1 0 11.303V6.719c0-.464.184-.909.513-1.237Zm.863 1.272a.25.25 0 0 0-.177.073L1.318 5.23a.25.25 0 0 0-.073.177v4.584c0 .066.026.13.073.177l3.838 3.838c.047.047.111.073.177.073h4.584c.066 0 .13-.026.177-.073l3.838-3.838c.047-.047.073-.111.073-.177V5.407a.25.25 0 0 0-.073-.177L9.953 1.392a.25.25 0 0 0-.177-.073ZM8 3.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 3.75Zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`;
      default:
        return '';
    }
  }
}
