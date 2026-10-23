# Agent Guidelines & Rules

## 1. Documentation Standards

- **No Marketing / Hyperbolic Language**:
  - Strictly avoid exaggerated, empty, or promotional buzzwords such as: "professional", "perfect", "amazing", "smooth", "superior", "cutting-edge", "state-of-the-art", "game-changing", "blazing fast", "seamless", "zero-latency", "extremely powerful"...
- **Focus on Essence & Technical Reality**:
  - Precisely describe operating mechanisms, data processing flows, input/output parameters, configurations, and actual system limitations.
  - Present information directly, concisely, using an objective, technical engineering tone.
  - Examples:
    - ❌ Do not write: *"Professional Master-Detail interface, loading instantly with blazing fast speed and zero lag."*
    - ✅ Write: *"Two-column interface: session list on the left and chat content on the right; pre-rendered from local cache with asynchronous detailed loading."*

## 2. Git Operations Policy
- Only execute `git push` when the user explicitly requests it in writing in the prompt.
- Automatically create clear, atomic local commits upon completing features or bug fixes.

## 3. Mermaid Diagram Syntax Standards
- Always enclose edge labels containing special characters or parentheses in double quotes: `-->|"label"|`.
- Always enclose Subgraph display names in brackets with double quotes: `subgraph ID ["Title"]`.
- Always enclose Node labels containing control characters (`:`, `&`, `->`, `/`, etc.) in double quotes: `Node["Content"]`.
- Use standard ASCII whitespace; do not use tabs or non-standard whitespace characters.

## 4. Workflow & Math Formatting Standards
- **Strictly No LaTeX for Software Workflows**: Forbidden to use LaTeX math blocks (`$` or `$$`) to represent software pipelines, command flows, state transitions, or tool sequences.
- **Mandatory Inline Code or Mermaid**:
  - For linear single-line workflows, always use inline code with arrows: `` `A` ──(auto)──> `B` `` or `` `A` → `B` ``.
  - For complex branching workflows, always use Mermaid diagrams (`flowchart LR` / `flowchart TD`) with double-quoted node and edge labels.
- **Strict Escaping in Mathematical LaTeX**: LaTeX math blocks are reserved strictly for genuine mathematical formulas and quantitative equations. All reserved characters (`&`, `_`, `%`, `#`, `{`, `}`) used inside LaTeX must be properly escaped (e.g. `\&`, `\_`, `\%`).

