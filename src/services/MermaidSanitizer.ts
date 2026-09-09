/**
 * MermaidSanitizer
 * Provides intelligent auto-sanitization for Mermaid diagram code
 * to prevent common syntax errors (unquoted special characters in labels,
 * colons, arrows, parentheses, comparison operators, ampersands, etc.).
 */
export class MermaidSanitizer {
  public static readonly DIAGRAM_HEADER_REGEX =
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|classDiagram-v2|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|c4context|c4container|c4component|c4dynamic|c4deployment|mindmap|timeline|quadrantChart|sankey-beta|kanban|block-beta|xychart-beta|requirement|requirementDiagram|architecture-beta|packet-beta)\b/i;

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

      // 1. Sanitize Edge Labels: |label| -> replace < with &lt;, > with &gt;, & with &amp;
      processed = processed.replace(/\|([^\|\r\n]+)\|/g, (_match, label) => {
        const clean = label
          .replace(/"/g, "'")
          .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return '|' + clean + '|';
      });

      // 1b. Normalize unsupported bidirectional arrows: NodeA <--> NodeB -> NodeA --> NodeB and NodeB --> NodeA
      if (/<[-=]+>/.test(processed)) {
        const biMatch = processed.match(/^(\s*)([a-zA-Z0-9_\-]+)\s*<[-=]+>\s*([a-zA-Z0-9_\-]+)(.*)$/);
        if (biMatch) {
          const [, indent, leftNode, rightNode, rest] = biMatch;
          return `${indent}${leftNode} --> ${rightNode}${rest}\n${indent}${rightNode} --> ${leftNode}${rest}`;
        }
      }

      // 2. Subgraph titles: subgraph Sub_Title [My Title: With Colons] or subgraph "My Title: With Colons"
      if (/^\s*subgraph\s+/i.test(processed)) {
        processed = processed.replace(/^\s*subgraph\s+([^\["\r\n]+)$/i, (m, title) => {
          const t = title.trim();
          if (/[ :()\->&/<>\?\{\}\[\]]/.test(t) && !t.startsWith('"')) {
            const clean = t.replace(/"/g, "'");
            return `subgraph "${clean}"`;
          }
          return m;
        });
      }

      // 3. Hexagon node: id{{label}} -> id{{"label"}}
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\{\{([^"\r\n\{\}]+)\}\}/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}{{"${clean}"}}`;
        }
      );

      // 4. Cylinder / Database node: id[(label)] -> id[("label")]
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\[\(([^"\r\n\[\]\(\)]+)\)\]/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}[("${clean}")]`;
        }
      );

      // 5. Circle node: id((label)) -> id(("label"))
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\(\(([^"\r\n\(\)]+)\)\)/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}(("${clean}"))`;
        }
      );

      // 6. Asymmetric node: id>label] -> id>"label"]
      processed = processed.replace(
        /(^|[\s\r\n;])([a-zA-Z0-9_]+)>([^"\r\n\[\]]+)\]/g,
        (_match, prefix, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${prefix}${id}>"${clean}"]`;
        }
      );

      // 7. Parallelogram / Trapezoid: id[/label/] or id[\label\]
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\[\/([^"\r\n\[\]\/]+)\/\]/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}[/"${clean}"/]`;
        }
      );
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\[\\([^"\r\n\[\]\\]+)\\\]/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}[\\"${clean}"\\]`;
        }
      );

      // 8. Rhombus / Decision node: id{label} -> id{"label"}
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\{([^"\r\n\{\}]+)\}/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}{"${clean}"}`;
        }
      );

      // 9. Rectangle node: id[label] -> id["label"]
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\[([^"\r\n\[\]]+)\]/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}["${clean}"]`;
        }
      );

      // 10. Round / Capsule node: id(label) -> id("label")
      processed = processed.replace(
        /([a-zA-Z0-9_\-]+)\(([^"\r\n\(\)]+)\)/g,
        (_match, id, label) => {
          const clean = label.replace(/"/g, "'").trim();
          return `${id}("${clean}")`;
        }
      );

      return processed;
    });

    return sanitizedLines.join('\n');
  }
}
