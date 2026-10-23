import type { RenderOptions } from 'beautiful-mermaid';
import * as path from 'path';

let cachedRenderMermaidSVG: ((text: string, options?: RenderOptions) => string) | null = null;
function getRenderMermaidSVG(): (text: string, options?: RenderOptions) => string {
  if (!cachedRenderMermaidSVG) {
    try {
      // Static require bundled by esbuild into dist/extension.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('beautiful-mermaid');
      cachedRenderMermaidSVG = mod.renderMermaidSVG;
    } catch {
      // Fallback for unbundled tsc CommonJS execution (out/) where beautiful-mermaid exports only defines "import"
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.resolve(__dirname, '../../node_modules/beautiful-mermaid/dist/index.js'));
      cachedRenderMermaidSVG = mod.renderMermaidSVG;
    }
  }
  return cachedRenderMermaidSVG!;
}

/**
 * MermaidSanitizer
 * Provides intelligent auto-sanitization for Mermaid diagram code
 * to prevent common syntax errors (unquoted special characters in labels,
 * colons, arrows, parentheses, comparison operators, ampersands, etc.)
 * and integrates Google Antigravity's `zyc` preprocessor + `beautiful-mermaid` SVG engine.
 */
export class MermaidSanitizer {
  public static readonly DIAGRAM_HEADER_REGEX =
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|c4context|c4container|c4component|c4dynamic|c4deployment|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta|requirement|requirementDiagram|architecture-beta|packet-beta)\b/i;

  public static readonly BEAUTIFUL_MERMAID_HEADER_REGEX =
    /^\s*(?:graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|xychart|xychart-beta|pie)\b/i;

  private static readonly FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  private static readonly DIRECTIVE_REGEX = /%%\{[\s\S]*?\}%%/g;
  private static readonly TRAILING_ATTR_REGEX = /([\])}])@\{((?:[^}"']|"[^"]*"|'[^']*')*)\}/g;
  private static readonly STANDALONE_ATTR_LINE_REGEX = /^([ \t]*)([A-Za-z_][\w-]*)@\{((?:[^}"']|"[^"]*"|'[^']*')*)\}[ \t]*(\r?\n|$)/gm;
  private static readonly INLINE_ATTR_REGEX = /\b([A-Za-z_][\w-]*)@\{((?:[^}"']|"[^"]*"|'[^']*')*)\}/g;
  private static readonly BACKTICK_LABEL_REGEX = /"`([^"]*?)`"/g;
  private static readonly NUMERIC_DEC_ENTITY_REGEX = /&#(\d+);/g;
  private static readonly NUMERIC_HEX_ENTITY_REGEX = /&#x([0-9a-fA-F]+);/g;
  private static readonly ATTR_KV_REGEX = /([A-Za-z_][\w-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\n\r}]+))/g;

  private static readonly NAMED_ENTITIES: Record<string, string> = {
    '&rarr;': '\u2192',
    '&larr;': '\u2190',
    '&harr;': '\u2194',
    '&rArr;': '\u21d2',
    '&lArr;': '\u21d0',
    '&le;': '\u2264',
    '&ge;': '\u2265',
    '&ne;': '\u2260',
    '&bull;': '\u2022',
    '&ndash;': '\u2013',
    '&mdash;': '\u2014',
    '&nbsp;': ' '
  };

  private static readonly NAMED_ENTITY_REGEX = new RegExp(Object.keys(MermaidSanitizer.NAMED_ENTITIES).join('|'), 'g');

  private static readonly V10_SHAPE_MAP: Record<string, [string, string]> = {
    cyl: ['[(', ')]'],
    cylinder: ['[(', ')]'],
    database: ['[(', ')]'],
    db: ['[(', ')]'],
    hex: ['{{', '}}'],
    hexagon: ['{{', '}}'],
    prepare: ['{{', '}}'],
    stadium: ['([', '])'],
    pill: ['([', '])'],
    terminal: ['([', '])'],
    subproc: ['[[', ']]'],
    subroutine: ['[[', ']]'],
    'fr-rect': ['[[', ']]'],
    'framed-rectangle': ['[[', ']]'],
    diamond: ['{', '}'],
    decision: ['{', '}'],
    rhombus: ['{', '}'],
    circle: ['((', '))'],
    circ: ['((', '))'],
    'dbl-circ': ['(((', ')))'],
    doublecircle: ['(((', ')))'],
    asym: ['>', ']'],
    odd: ['>', ']'],
    flag: ['>', ']'],
    'trap-b': ['[/', '\\]'],
    trapezoid: ['[/', '\\]'],
    'trap-t': ['[\\', '/]'],
    'inv-trapezoid': ['[\\', '/]'],
    rounded: ['(', ')'],
    event: ['(', ')']
  };

  private static extractAttrProp(attrBody: string, key: string): string | null {
    for (const match of attrBody.matchAll(MermaidSanitizer.ATTR_KV_REGEX)) {
      if (match[1].toLowerCase() === key) {
        return (match[2] ?? match[3] ?? match[4] ?? '').trim();
      }
    }
    return null;
  }

  /**
   * Google Antigravity's `zyc` preprocessor:
   * Strips YAML frontmatter and `%%{...}%%` directives, converts Mermaid v10 `@{shape, label}`
   * syntax into classic shape brackets, removes inner backticks, and decodes HTML entities.
   */
  public static preprocessAntigravitySyntax(code: string): string {
    if (!code) {
      return '';
    }
    let text = code.trimStart();
    text = text.replace(MermaidSanitizer.FRONTMATTER_REGEX, '');
    text = text.replace(MermaidSanitizer.DIRECTIVE_REGEX, '');
    text = text.replace(MermaidSanitizer.TRAILING_ATTR_REGEX, '$1');
    text = text.replace(
      MermaidSanitizer.STANDALONE_ATTR_LINE_REGEX,
      (fullMatch, indent, nodeId, attrBody, eol, offset, fullStr) => {
        if (
          MermaidSanitizer.extractAttrProp(attrBody, 'shape') === null &&
          MermaidSanitizer.extractAttrProp(attrBody, 'label') === null
        ) {
          const restOfDoc = fullStr.slice(0, offset) + fullStr.slice(offset + fullMatch.length);
          return new RegExp(`(?<![\\w-])${nodeId}(?![\\w-])`).test(restOfDoc) ? '' : `${indent}${nodeId}${eol}`;
        }
        return fullMatch;
      }
    );
    text = text.replace(MermaidSanitizer.INLINE_ATTR_REGEX, (_fullMatch, nodeId, attrBody) => {
      const rawShape = MermaidSanitizer.extractAttrProp(attrBody, 'shape');
      const rawLabel = MermaidSanitizer.extractAttrProp(attrBody, 'label');
      if (rawShape === null && rawLabel === null) {
        return nodeId;
      }
      const shapeKey = (rawShape ?? 'rect').toLowerCase();
      const cleanLabel = (rawLabel ?? nodeId).replace(/"/g, "'");
      const [openDelim, closeDelim] = MermaidSanitizer.V10_SHAPE_MAP[shapeKey] ?? ['[', ']'];
      return `${nodeId}${openDelim}"${cleanLabel}"${closeDelim}`;
    });
    text = text.replace(MermaidSanitizer.BACKTICK_LABEL_REGEX, '"$1"');
    text = text.replace(MermaidSanitizer.NAMED_ENTITY_REGEX, (entity) => MermaidSanitizer.NAMED_ENTITIES[entity] ?? entity);
    text = text.replace(MermaidSanitizer.NUMERIC_DEC_ENTITY_REGEX, (full, dec) => {
      const codePoint = Number(dec);
      return codePoint > 127 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : full;
    });
    text = text.replace(MermaidSanitizer.NUMERIC_HEX_ENTITY_REGEX, (full, hex) => {
      const codePoint = Number(`0x${hex}`);
      return codePoint > 127 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : full;
    });
    return text.trim();
  }

  /**
   * Wraps a single-line label into multiple lines separated by `<br/>` if it exceeds `maxChars`.
   * Respects existing `<br/>` or `\n` breaks if already present.
   */
  public static wrapLabelText(label: string, maxChars: number): string {
    if (!label || label.length <= maxChars || /<br\s*\/?>|\\n|\n/i.test(label)) {
      return label;
    }
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxChars) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines.join('<br/>');
  }

  /**
   * Applies smart multi-line word wrapping to long node labels and edge labels
   * so wide flowcharts maintain a balanced aspect ratio in full-overview mode.
   */
  public static applySmartWordWrap(code: string, maxNodeChars: number = 32, maxEdgeChars: number = 26): string {
    if (!code) {
      return '';
    }
    const firstCodeLine = code
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('%%') && l !== '---') ?? '';
    if (!/^\s*(?:graph|flowchart)\b/i.test(firstCodeLine)) {
      return code;
    }
    return code
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('%%') || MermaidSanitizer.DIAGRAM_HEADER_REGEX.test(trimmed) || /^\s*subgraph\b/i.test(trimmed)) {
          return line;
        }
        // Wrap quoted edge labels: |"..."|
        let out = line.replace(/\|"([^"\r\n]+)"\|/g, (_m, inner) => {
          return `|"${MermaidSanitizer.wrapLabelText(inner, maxEdgeChars)}"|`;
        });
        // Wrap unquoted edge labels: |...|
        out = out.replace(/\|([^"|][^|\r\n]*)\|/g, (_m, inner) => {
          return `|${MermaidSanitizer.wrapLabelText(inner.trim(), maxEdgeChars)}|`;
        });
        // Wrap quoted node labels: ["..."], ("..."), {"..."}, (["..."]), [("...")], (("...")), {{ "..." }}
        out = out.replace(/([\[\(\{>])"([^"\r\n]+)"([\]\)\}])/g, (_m, open, inner, close) => {
          return `${open}"${MermaidSanitizer.wrapLabelText(inner, maxNodeChars)}"${close}`;
        });
        return out;
      })
      .join('\n');
  }

  /**
   * Renders a Mermaid diagram synchronously to an orthogonal SVG string using `beautiful-mermaid`.
   * Returns `null` if the diagram type is unsupported or if parsing fails, allowing seamless fallback to `mermaid.min.js`.
   */
  public static renderBeautifulMermaid(rawCode: string): string | null {
    if (!rawCode || !MermaidSanitizer.isDiagram(rawCode)) {
      return null;
    }
    try {
      const zycCleaned = MermaidSanitizer.preprocessAntigravitySyntax(rawCode);
      const firstCodeLine = zycCleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('%%')) ?? '';

      if (!MermaidSanitizer.BEAUTIFUL_MERMAID_HEADER_REGEX.test(firstCodeLine)) {
        return null;
      }

      // Normalize legacy classDiagram-v2 header to classDiagram for beautiful-mermaid
      const normalizedHeaderCode = zycCleaned.replace(/^\s*classDiagram-v2\b/i, 'classDiagram');
      const sanitized = MermaidSanitizer.sanitize(normalizedHeaderCode)
        .replace(/#quot;/g, "'")
        .replace(/\\\\/g, '\\');
      const wrappedCode = MermaidSanitizer.applySmartWordWrap(sanitized, 32, 26);

      const renderFn = getRenderMermaidSVG();
      let svg = renderFn(wrappedCode, {
        bg: 'var(--mermaid-bg, #18181B)',
        fg: 'var(--mermaid-fg, #F4F4F5)',
        line: 'var(--mermaid-line, #71717A)',
        accent: 'var(--mermaid-accent, #71717A)',
        muted: 'var(--mermaid-muted, #A1A1AA)',
        surface: 'var(--mermaid-surface, #27272A)',
        border: 'var(--mermaid-border, #3F3F46)',
        font: 'Inter',
        transparent: true
      });

      // Strip external Google Fonts @import rules to strictly comply with offline Webview CSP
      svg = svg.replace(/@import\s+url\([^)]+fonts\.googleapis\.com[^)]+\);\s*/gi, '');
      return svg;
    } catch {
      return null;
    }
  }

  /**
   * Determines whether the given code is a complete Mermaid diagram definition
   * or merely an illustrative syntax snippet/excerpt.
   * A full diagram must declare its diagram type header (optionally preceded by comments or frontmatter).
   */
  public static isDiagram(code: string): boolean {
    if (!code || !code.trim()) {
      return false;
    }

    const lines = code.trim().split(/\r?\n/);
    let inFrontmatter = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        continue;
      }

      // Handle YAML frontmatter (--- ... ---)
      if (trimmed === '---') {
        inFrontmatter = !inFrontmatter;
        continue;
      }
      if (inFrontmatter) {
        continue;
      }

      // Skip comments or directives (%% ...)
      if (trimmed.startsWith('%%')) {
        continue;
      }

      // First substantive code line must match a supported diagram header
      return MermaidSanitizer.DIAGRAM_HEADER_REGEX.test(trimmed);
    }

    return false;
  }

  /**
   * Sanitizes raw Mermaid code to ensure compatibility with Mermaid.js parser.
   */
  public static sanitize(code: string): string {
    if (!code) {
      return '';
    }

    const lines = code.split(/\r?\n/);

    const sanitizedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('%%')) {
        return line;
      }

      // Skip chart declaration headers
      if (MermaidSanitizer.DIAGRAM_HEADER_REGEX.test(trimmed)) {
        return line;
      }

      // Skip styling, link, and configuration directives
      if (/^(classDef|style|linkStyle|click|accTitle|accDescr|class|interpolate)\b/i.test(trimmed)) {
        return line;
      }

      let processed = line;
      const tokens: string[] = [];
      const mask = (str: string): string => {
        const idx = tokens.length;
        tokens.push(str);
        return `___MERMAID_TOKEN_${idx}___`;
      };

      // Node ID pattern: allows alphanumerics, underscores, and hyphens not at the end
      const nodeIdPat = '[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*';
      // String literal pattern supporting escaped characters e.g. \"
      const strLitPat = '"((?:[^"\\r\\n\\\\]|\\\\.)*)"';
      const cleanInner = (inner: string) => inner.replace(/\\"/g, '#quot;').replace(/"/g, '#quot;');

      // Step 0a: Mask already-quoted edge labels |"..."|
      processed = processed.replace(new RegExp('\\|\\s*' + strLitPat + '\\s*\\|', 'g'), (_m, c) => mask('|"' + cleanInner(c) + '"|'));

      // Step 0b: Mask already-quoted nodes: id["..."], id(["..."]), id("..."), etc.
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\(\\(' + strLitPat + '\\)\\)\\)', 'g'), (_m, p, id, c) => p + mask(`${id}((("${cleanInner(c)}")))`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\[' + strLitPat + '\\]\\)', 'g'), (_m, p, id, c) => p + mask(`${id}(["${cleanInner(c)}"])`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\[' + strLitPat + '\\]\\]', 'g'), (_m, p, id, c) => p + mask(`${id}[["${cleanInner(c)}"]]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\(' + strLitPat + '\\)\\]', 'g'), (_m, p, id, c) => p + mask(`${id}[("${cleanInner(c)}")]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\{\\{' + strLitPat + '\\}\\}', 'g'), (_m, p, id, c) => p + mask(`${id}{{"${cleanInner(c)}"}}`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\(' + strLitPat + '\\)\\)', 'g'), (_m, p, id, c) => p + mask(`${id}(("${cleanInner(c)}"))`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\/' + strLitPat + '\\/\\]', 'g'), (_m, p, id, c) => p + mask(`${id}[/"${cleanInner(c)}"/]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\\\' + strLitPat + '\\\\\\]', 'g'), (_m, p, id, c) => p + mask(`${id}[\\"${cleanInner(c)}"\\]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*>' + strLitPat + '\\]', 'g'), (_m, p, id, c) => p + mask(`${id}>"${cleanInner(c)}"]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\{' + strLitPat + '\\}', 'g'), (_m, p, id, c) => p + mask(`${id}{"${cleanInner(c)}"}`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[' + strLitPat + '\\]', 'g'), (_m, p, id, c) => p + mask(`${id}["${cleanInner(c)}"]`));
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(' + strLitPat + '\\)', 'g'), (_m, p, id, c) => p + mask(`${id}("${cleanInner(c)}")`));

      // Step 1: Sanitize unquoted edge labels
      processed = processed.replace(/\|([^\|\r\n]+)\|/g, (_m, label) => {
        let innerText = label.trim()
          .replace(/"/g, "'")
          .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return mask('|' + innerText + '|');
      });

      // Step 1b: Normalize unsupported bidirectional arrows: NodeA <--> NodeB -> NodeA --> NodeB and NodeB --> NodeA
      if (/<[-=]+>/.test(processed)) {
        const biMatch = processed.match(/^(\s*)([a-zA-Z0-9_\-]+)\s*<[-=]+>\s*([a-zA-Z0-9_\-]+)(.*)$/);
        if (biMatch) {
          const [, indent, leftNode, rightNode, rest] = biMatch;
          processed = `${indent}${leftNode} --> ${rightNode}${rest}\n${indent}${rightNode} --> ${leftNode}${rest}`;
        }
      }

      // Step 2: Subgraph titles
      if (/^\s*subgraph\b/i.test(processed)) {
        processed = processed.replace(
          /^(\s*subgraph(?:\s+[a-zA-Z0-9_\-]+)?)\s*\[([^\]\r\n]+)\]/i,
          (match, prefix, title) => {
            const trimmedTitle = title.trim();
            if (trimmedTitle.startsWith('"') && trimmedTitle.endsWith('"')) {
              return match;
            }
            const clean = trimmedTitle.replace(/"/g, "'");
            return `${prefix} ["${clean}"]`;
          }
        );

        processed = processed.replace(/^\s*subgraph\s+([^\["\r\n]+)$/i, (m, title) => {
          const t = title.trim();
          if (/[ :()\->&/<>?{}\[\]]/.test(t) && !t.startsWith('"')) {
            const clean = t.replace(/"/g, "'");
            return `subgraph "${clean}"`;
          }
          return m;
        });

        for (let k = tokens.length - 1; k >= 0; k--) {
          processed = processed.replace(`___MERMAID_TOKEN_${k}___`, tokens[k]);
        }
        return processed;
      }

      // Step 3+: Unquoted node shapes (compound delimiters before simple delimiters)
      // Double circle (((...)))
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\(\\(([^"\\r\\n]+?)\\)\\)\\)', 'g'), (m, p, id, l) => p + mask(`${id}((("${l.replace(/"/g, "'").trim()}")))`) );
      // Stadium ([...])
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\[([^"\\r\\n]+?)\\]\\)', 'g'), (m, p, id, l) => p + mask(`${id}(["${l.replace(/"/g, "'").trim()}"])`) );
      // Subroutine [[...]]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\[([^"\\r\\n]+?)\\]\\]', 'g'), (m, p, id, l) => p + mask(`${id}[["${l.replace(/"/g, "'").trim()}"]]`) );
      // Cylinder [(...)]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\(([^"\\r\\n]+?)\\)\\]', 'g'), (m, p, id, l) => p + mask(`${id}[("${l.replace(/"/g, "'").trim()}")]`) );
      // Hexagon {{...}}
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\{\\{([^"\\r\\n]+?)\\}\\}', 'g'), (m, p, id, l) => p + mask(`${id}{{"${l.replace(/"/g, "'").trim()}"}}`) );
      // Circle ((...))
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(\\(([^"\\r\\n]+?)\\)\\)', 'g'), (m, p, id, l) => p + mask(`${id}(("${l.replace(/"/g, "'").trim()}"))`) );
      // Parallelogram [/ ... /]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\/([^"\\r\\n]+?)\\/\]', 'g'), (m, p, id, l) => p + mask(`${id}[/"${l.replace(/"/g, "'").trim()}"/]`) );
      // Parallelogram alt [\ ... \]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[\\\\([^"\\r\\n]+?)\\\\\\]', 'g'), (m, p, id, l) => p + mask(`${id}[\\"${l.replace(/"/g, "'").trim()}"\\]`) );
      // Asymmetric > ... ]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*>([^"\\[\\]\\r\\n]+)\\]', 'g'), (m, p, id, l) => p + mask(`${id}>"${l.replace(/"/g, "'").trim()}"]`) );
      // Rhombus { ... }
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\{([^"\\{\\}\\r\\n]+)\\}', 'g'), (m, p, id, l) => p + mask(`${id}{"${l.replace(/"/g, "'").trim()}"}`) );
      // Rectangle [ ... ]
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\[([^"\\[\\]\\r\\n]+)\\]', 'g'), (m, p, id, l) => p + mask(`${id}["${l.replace(/"/g, "'").trim()}"]`) );
      // Round ( ... )
      processed = processed.replace(new RegExp('(^|[\\s;,&|>-])(' + nodeIdPat + ')\\s*\\(([^"\\(\\)\\r\\n]+)\\)', 'g'), (m, p, id, l) => p + mask(`${id}("${l.replace(/"/g, "'").trim()}")`) );

      // Restore all tokens in reverse order
      for (let k = tokens.length - 1; k >= 0; k--) {
        processed = processed.replace(`___MERMAID_TOKEN_${k}___`, tokens[k]);
      }

      return processed;
    });

    return sanitizedLines.join('\n');
  }
}
