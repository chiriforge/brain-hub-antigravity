# Mermaid Diagram Syntax Standards

When generating Mermaid diagrams in responses, implementation plans, walkthroughs, or markdown artifacts, ALWAYS adhere to the following 4 strict formatting rules to prevent syntax errors in Mermaid.js:

## 1. Edge Labels with Parentheses & Special Characters
- **Rule**: ALWAYS wrap edge label text inside double quotes: `-->|"..."|` or `---| "..." |`.
- **Reason**: Parentheses `()` inside raw edge labels (e.g., `-->|retry(count, delay)|`) conflict with Mermaid node shape declarations and crash the parser.
- **Example**:
  - ❌ Incorrect: `Client -->|retry(count, delay)| Service`
  - ✅ Correct: `Client -->|"retry(count, delay)"| Service`

## 2. Subgraph Declaration with ID and Quoted Display Name
- **Rule**: ALWAYS provide an explicit identifier for subgraphs, and enclose the display title in square brackets with double quotes: `subgraph Subgraph_ID ["Display Name & Details"]`.
- **Reason**: Special characters (`&`, spaces, dashes, slashes) in raw subgraph names trigger syntax parsing errors.
- **Example**:
  - ❌ Incorrect: `subgraph Core & Services`
  - ✅ Correct: `subgraph Core_Services ["Core & Services"]`

## 3. Node Labels with Control Characters
- **Rule**: ALWAYS wrap the label text inside node shapes with double quotes `["..."]` whenever it contains `:`, `&`, `->`, `/`, `+`, `%`, `*`, or mathematical notation.
- **Reason**: Arrow characters `->` and colons `:` are control tokens in Mermaid and corrupt graph topology if unquoted.
- **Example**:
  - ❌ Incorrect: `Worker[Worker: Queue -> Process & Emit]`
  - ✅ Correct: `Worker["Worker: Queue -> Process & Emit"]`

## 4. Indentation and Whitespace
- **Rule**: Use standard ASCII spaces (`\u0020`, 2 or 4 spaces) for indentation. NEVER use non-breaking spaces (`\u00A0`), tabs, or zero-width spaces.
