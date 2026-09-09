# Mermaid Diagram Syntax Standards

When generating Mermaid diagrams in responses, implementation plans, walkthroughs, or markdown artifacts, ALWAYS adhere to the following 4 strict formatting rules to prevent syntax errors in Mermaid.js:

## 1. Edge Labels with Parentheses & Special Characters
- **Rule**: ALWAYS wrap edge label text inside double quotes: `-->|"..."|` or `---| "..." |`.
- **Reason**: Parentheses `()` inside raw edge labels (e.g. `-->|tăng cả ATK lẫn max(STR,WIS)|`) conflict with Mermaid node shape declarations and crash the parser.
- **Example**:
  - ❌ Incorrect: `Patch -->|tăng cả ATK lẫn max(STR,WIS)| Formula`
  - ✅ Correct: `Patch -->|"tăng cả ATK lẫn max(STR,WIS)"| Formula`

## 2. Subgraph Declaration with ID and Quoted Display Name
- **Rule**: ALWAYS provide an explicit identifier for subgraphs, and enclose the display title in square brackets with double quotes: `subgraph Subgraph_ID ["Display Name & Details"]`.
- **Reason**: Special characters (`&`, spaces, dashes, slashes) in raw subgraph names trigger syntax parsing errors.
- **Example**:
  - ❌ Incorrect: `subgraph Items & Buffs`
  - ✅ Correct: `subgraph S_Items_Buffs ["Items & Buffs"]`

## 3. Node Labels with Control Characters
- **Rule**: ALWAYS wrap the label text inside node shapes with double quotes `["..."]` whenever it contains `:`, `&`, `->`, `/`, `+`, `%`, `*`, or mathematical notation.
- **Reason**: Arrow characters `->` và dấu hai chấm `:` are control tokens in Mermaid and corrupt graph topology if unquoted.
- **Example**:
  - ❌ Incorrect: `Inhaler[Inhaler T1-T5: +DEX -> +DEF & +Crit]`
  - ✅ Correct: `Inhaler["Inhaler T1-T5: +DEX -> +DEF & +Crit"]`

## 4. Indentation and Whitespace
- **Rule**: Use standard ASCII spaces (`\u0020`, 2 or 4 spaces) for indentation. NEVER use non-breaking spaces (`\u00A0`), tabs, or zero-width spaces.
