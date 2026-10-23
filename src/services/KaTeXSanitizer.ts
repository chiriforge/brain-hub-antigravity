import katex from 'katex';

/**
 * KaTeXSanitizer provides resilient pre-sanitization and graceful plain-text fallback
 * for AI-generated LaTeX expressions within Brain Hub.
 */
export class KaTeXSanitizer {
  /**
   * Safely escapes a target character if and only if it is preceded by an even number of backslashes.
   * If preceded by an odd number of backslashes (e.g. `\%`), it is already escaped and left untouched.
   * If preceded by an even number (e.g. `0`, or `\\` representing a newline), an extra backslash is inserted.
   */
  public static escapeWithParity(input: string, char: string): string {
    const escapedChar = char.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(\\\\*)(${escapedChar})`, 'g');
    return input.replace(regex, (match, backslashes, target) => {
      if (backslashes.length % 2 === 0) {
        return `${backslashes}\\${target}`;
      }
      return match;
    });
  }

  /**
   * Pre-sanitizes raw LaTeX strings by identifying and escaping common LLM oversights,
   * such as unescaped '&', '_', or '%' inside text blocks, using odd/even backslash parity.
   */
  public static sanitize(latex: string): string {
    if (!latex || typeof latex !== 'string') {
      return '';
    }

    let sanitized = latex;

    // 1. Sanitize text-like macro blocks: \text{...}, \textbf{...}, \textit{...}, \textsf{...}, \texttt{...}, \mathrm{...}
    // Deeply scans balanced braces and automatically escapes '&', '_', and '#' with parity awareness.
    const macroRegex = /\\(text(?:bf|it|sf|tt)?|mathrm)\{/g;
    let result = '';
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = macroRegex.exec(sanitized)) !== null) {
      result += sanitized.slice(lastIdx, match.index);
      const macroName = match[1];
      const startIdx = match.index + match[0].length;
      let depth = 1;
      let endIdx = startIdx;

      while (endIdx < sanitized.length && depth > 0) {
        const ch = sanitized[endIdx];
        let backslashCount = 0;
        let k = endIdx - 1;
        while (k >= 0 && sanitized[k] === '\\') {
          backslashCount++;
          k--;
        }
        const isEscaped = backslashCount % 2 === 1;

        if (!isEscaped) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth > 0) {
          endIdx++;
        }
      }

      if (depth === 0) {
        const innerContent = sanitized.slice(startIdx, endIdx);
        let cleanContent = innerContent;
        cleanContent = KaTeXSanitizer.escapeWithParity(cleanContent, '&');
        cleanContent = KaTeXSanitizer.escapeWithParity(cleanContent, '_');
        cleanContent = KaTeXSanitizer.escapeWithParity(cleanContent, '#');
        result += `\\${macroName}{${cleanContent}}`;
        lastIdx = endIdx + 1;
        macroRegex.lastIndex = lastIdx;
      } else {
        result += match[0];
        lastIdx = startIdx;
      }
    }

    result += sanitized.slice(lastIdx);
    sanitized = result;

    // 2. Sanitize unescaped '%' in math mode with backslash parity
    // In LaTeX, '%' is a comment character that causes the rest of the line to be discarded.
    // If preceded by an even number of backslashes (e.g. 0, or \\ representing a newline),
    // it must be safely escaped as \% or \\\% without corrupting \\.
    sanitized = KaTeXSanitizer.escapeWithParity(sanitized, '%');

    return sanitized;
  }

  /**
   * Intelligently strips LaTeX commands and transforms math/arrows into clean, legible plain text.
   * Used as a graceful degradation fallback when KaTeX cannot parse corrupted expressions.
   */
  public static stripToCleanText(latex: string): string {
    if (!latex || typeof latex !== 'string') {
      return '';
    }

    let text = latex;

    // Convert labeled arrows
    text = text.replace(/\\xrightarrow\[(.*?)\]\{(.*?)\}/g, ' ──[$2 ($1)]──> ');
    text = text.replace(/\\xrightarrow\{(.*?)\}/g, ' ──($1)──> ');
    text = text.replace(/\\xleftarrow\[(.*?)\]\{(.*?)\}/g, ' <──[$2 ($1)]── ');
    text = text.replace(/\\xleftarrow\{(.*?)\}/g, ' <──($1)── ');

    // Convert standard arrows
    text = text.replace(/\\(?:rightarrow|to|longrightarrow)/g, ' → ');
    text = text.replace(/\\(?:leftarrow|gets|longleftarrow)/g, ' ← ');
    text = text.replace(/\\(?:leftrightarrow|longleftrightarrow)/g, ' ↔ ');
    text = text.replace(/\\(?:Rightarrow|Longrightarrow)/g, ' ⇒ ');
    text = text.replace(/\\(?:Leftarrow|Longleftarrow)/g, ' ⇐ ');
    text = text.replace(/\\(?:Leftrightarrow|Longleftrightarrow)/g, ' ⇔ ');

    // Strip text wrapper macros
    text = text.replace(/\\(?:text(?:bf|it|sf|tt)?|mathrm|mathbf|mathit|mathcal|mathbb)\{(.*?)\}/g, '$1');

    // Strip common display or formatting commands
    text = text.replace(/\\(?:displaystyle|textstyle|quad|qquad|thickspace|thinspace|,|;|!)/g, ' ');

    // Unescape common escaped symbols for human reading
    text = text.replace(/\\([&_%#{}])/g, '$1');

    // Strip dangling LaTeX syntax markers
    text = text.replace(/\\/g, '');
    text = text.replace(/[{}]/g, '');

    // Normalize spacing
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Safely renders a LaTeX expression to HTML using KaTeX.
   * If parsing fails despite pre-sanitization, degrades gracefully to a clean inline text badge.
   */
  public static renderMathSafely(latex: string, displayMode: boolean = false): string {
    const sanitized = KaTeXSanitizer.sanitize(latex);
    try {
      return katex.renderToString(sanitized, {
        displayMode,
        throwOnError: true
      });
    } catch (err: any) {
      const cleanFallback = KaTeXSanitizer.stripToCleanText(latex) || sanitized;
      const escapedRaw = KaTeXSanitizer.escapeHtml(latex);
      const escapedText = KaTeXSanitizer.escapeHtml(cleanFallback);
      const errorMsg = KaTeXSanitizer.escapeHtml(err?.message || 'Parse error');

      const fallbackHtml = `<span class="katex-fallback" data-raw-latex="${escapedRaw}" title="Formula fallback (${errorMsg})">${escapedText}</span>`;

      if (displayMode) {
        return `<div class="katex-display">${fallbackHtml}</div>`;
      }
      return fallbackHtml;
    }
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
