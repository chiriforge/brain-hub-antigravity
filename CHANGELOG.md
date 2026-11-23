# Changelog

All notable changes to Brain Hub are documented here.

---

## [0.5.4] — 2026-11-23

### Added
- **Token Usage Monitor, Cost Telemetry & Compact Header**: Added near real-time token usage monitoring in the Status Bar HUD and 3-tier webview charts, DESC step usage table with sticky headers, cached/cost telemetry (`brainHub.modelPricing`, `brainHub.defaultModelPricing`), per-model context warning/critical thresholds (`warningThreshold`, `criticalThreshold`), and a compact 13px header with collapse mode, collapsed strip chat count, and scroll auto-collapse.
- **3-Layer Multi-Executor Live Progress Viewer (`Orchestrator` / `/boost` / `/teamwork` / `/swarm` / `invoke_subagent`)**: Added `ExecutorLayoutHelper.ts`, multi-level `resolveExecutorLinks()` tree linking, dual-source `.system_generated/swarm/` ingestion (`view.json`, `plan.json`, `members.json`, `board.jsonl`), `SYSTEM_MESSAGE` lookahead non-swallowing, double-JSON `send_message` unquoting & `.system_generated/messages/*.json` enrichment, clickable `conversation://<uuid>` links, collapsible Sidebar/Nav sub-trees, Executor Switcher, Execution Progress Matrix, Swarm Board, and `treeTokenUsage` rollup with zero double-count/under-count.
- **Cross-Machine Session Attribution (`.brainhub_meta.json`)**: Persists originating `machineName`, `osUser`, and `platform` atomically per session before Git commits (`GitSyncService.stampPendingSessionsBeforeSync()`), enforces cross-window pull-suppression anti-poisoning (`isPullSuppressionActive()`), extends `extractMachineFromContent()` / `extractMachineFromWorkspacePath()` for Windows & POSIX paths with cross-OS same-username disambiguation, excludes `.brainhub_meta.json` from artifacts/empty checks while preserving `.user_uploaded`/`.tempmediaStorage`, and bumps `CACHE_SCHEMA_VERSION` to `6` with `auxSignature` invalidation ([`26112313_fix_cross_machine_attribution_and_git_sync`](conductor/tracks/26112313_fix_cross_machine_attribution_and_git_sync/index.md)).
- **Workspace-Aware Latest Session Auto-Load & 4-Layer Session Resolution Pipeline**: Automatically selects the latest conversation belonging to the currently opened IDE workspace when opening `DashboardWebviewPanel` (`Layer 0: Explicit ID` → `Empty Window Guard` → `Layer 1: Current Workspace Latest [Tier 1A Path Boundary / Tier 1B Name] & Layer 2: context.workspaceState('brainHub.lastSessionId')` → `Layer 3: Global Latest`), prioritizes the current workspace on the `⚡ Latest` button, auto-expands collapsed time groups to scroll `.session-nav-item.selected` into view, and shortens webview tab and sidebar container titles to `Brain Hub` ([`26110814_feat_workspace_latest_session_autoload`](conductor/tracks/26110814_feat_workspace_latest_session_autoload/index.md)).

### Fixed
- **Git-Aware Brain Directory & Dynamic Branch Sync**: Prioritizes `.git`-bearing or modern `~/.gemini/antigravity/brain` in `GitSyncService.getBrainDir()`, prevents `saveCacheToDisk()` from creating empty legacy `~/.gemini/antigravity-ide/brain` folders, dynamically resolves `main`/`master`/custom branches (including `git ls-remote --symref origin HEAD` for unborn repos), recovers `MERGE_HEAD`, uses `execFile` in `GitSyncService`, and rescans sessions in `gitSync.onDidSync()` and `onDidChangeConfiguration`.
- **Subagent Tree Linking & Receipt Leak Guards**: Rejected `run_command` subagent receipt leaks and foreign-parent references in `resolveExecutorLinks()`, and fixed dashboard sync and progress matrix updates.
- **Markdown Tables, Checkpoints & Export Sanitization**: Fixed Markdown table column crushing, word-break, and inline code wrapping; rendered checkpoint summary content and preserved AI steps expand state; sanitized exported text artifacts, respected `fullRaw` mode, and fixed `TIMELINE` links, tool status badges, `newestFirst` step search, and template literal regex escaping.
- **Cold-Cache Webview Handshake & Boundary-Safe Path Matching**: Resolved the `2500ms` cold-cache `dashboardReady` delay, eliminated sibling folder prefix collisions (`brain-hub` vs `brain-hub-antigravity`) across both Extension Host and Webview JS filters, and added multi-line `<user_information>` `Active Workspaces:` bullet-list extraction.
- **Multi-Directory Split-Session Merging**: Merged transcript steps (`step_index` deduplication and ordering) and artifacts across multiple brain directories (`~/.gemini/antigravity-ide/brain` and `~/.gemini/antigravity/brain`) when continuing historical conversations.
- **Live Reader Updates & Scroll Preservation**: Applied live DOM updates immediately in `DashboardWebviewPanel` while preserving relative scroll offset unless search or text selection is active, added webview disposal guards (`isDisposed`), and forced disk refresh on `brainHub.refresh`.
- **Recursive File Watching on Windows NTFS**: Enabled `{ recursive: true }` file watching with `.sessions_index_cache.json` and `.tmp` noise filtering in `SessionScanner.startRealtimeWatcher`.
- **Tool-Call Workspace Detection & Cache Self-Healing**: Added `args.Path` / `args.path` tool-call workspace extraction, restricted content workspace regex to `USER_INPUT` and explicit metadata blocks, rejected bogus paths (`/checkout/...`, `/my-workspace`), and hardened index cache schema versioning.

### Changed
- **Dependencies**: Updated dev/build dependencies (`esbuild` to `^0.28.1`, `@vscode/vsce` to `^4.0.0`, `undici` to `7.30.1`, `brace-expansion`, and `linkify-it`).

---

## [0.5.3] — 2026-10-23

### Improved
- **Mermaid Diagram Rendering**: Integrated `beautiful-mermaid` orthogonal SVG layout, smart multi-line word wrapping, and interactive fullscreen pan/zoom canvas.

### Fixed
- **LaTeX / KaTeX Rendering**: Fixed inline math vs. currency/shell-variable disambiguation, syntax pre-sanitization, and fallback badges.
- **Multi-IDE Concurrency, Crash Recovery & Git Auto-Sync**: Fixed webview handshake freezes, orphaned lock cleanup, atomic cache writes, and multi-machine Git sync conflicts.

---

## [0.5.2] — 2026-09-15

### Added
- **Session Artifacts Gallery**: Album grid viewer with lightbox and asset export.

### Fixed
- **Mermaid Rendering**: Fixed dark theme contrast and label alignment.
- **Webview Selection**: Enabled text selection and right-click copy.

---
