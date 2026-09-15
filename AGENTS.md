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
