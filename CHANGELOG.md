# Changelog

All notable changes to Brain Hub are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.5.1-build-0008] — 2026-09-15

### Added
- **Session Artifacts Gallery** — Quick Viewer modal anchored inside the Detail View region, displaying all artifacts generated in a chat session (images, documents, scratch files). ([feat-session-artifacts-gallery-20260915](conductor/tracks/feat-session-artifacts-gallery-20260915/index.md))
- Album-style thumbnail grid: 200×200 px fixed tiles, `auto-fill` columns responsive to container width, vertical scroll for hundreds of artifacts.
- Hover overlay action buttons (🔍 Zoom, 📋 Copy Path, 📂 Show in Explorer) rendered inside each thumbnail — no persistent action bar.
- Lightbox (media-modal) image preview with Escape key and backdrop click dismiss; `z-index` layered above the gallery overlay.
- Badge classification per artifact source: **AI Asset** (purple), **Upload** (blue), **Plan / Walkthrough** (green), **Scratch** (amber).
- Assets auto-export: `ProjectDocsArchiver.archiveProjectDocs()` copies artifacts to `.docs/assets/` and rewrites all local image links in exported Markdown to relative `../assets/` paths.
- Standardized **Thread** (green) vs **Single Chat** (blue) + **Artifacts** (purple) pill badges across Side Panel, Reader Header, and VS Code TreeView.
- `SessionScanner.scanSessionArtifacts()` with prompt-context binding: links each artifact to the user prompt that triggered its creation.

### Fixed
- Artifact thumbnail collapse bug: replaced `auto-fill minmax` grid with `min-height: 0` flex guard, `flex-shrink: 0` and `min-height: 200px` on preview to prevent CSS flex min-height default from squishing cards.
- Image preview (lightbox) `z-index` conflict — raised `.media-modal-overlay` above `.artifacts-modal-overlay` so it always renders on top.
- `Escape` key handler priority: lightbox close → gallery close → config/context menus.
- `.tempmediaStorage` reclassified from `ai_generated` to `user_uploaded` — files pasted/uploaded into chat were incorrectly badged as "AI Asset".
- `firstPrompt` optional safety guard in `ChatHistoryTreeProvider` to prevent undefined access on sessions with no messages.
- Client-side script syntax error in Detail View reader causing full webview render failure.

### Changed
- Artifacts modal overlay migrated from `position: fixed` (global viewport) to `position: absolute; inset: 0` scoped inside `.dashboard-reader-wrapper` — strictly bounded to the 19.5:9 detail view region.
- Modal container uses fixed dimensions (`width: calc(100% - 48px)`, `height: calc(100% - 48px)`) to eliminate layout jitter when artifact count changes.

---

## [0.5.1-build-0002] — 2026-09-13

### Added
- **Webview Text Selection and Right-Click Copy Support** — enabled text selection, context menu (Copy, Select All), and image lightbox across Chat, Dashboard, and Markdown Preview webviews. ([webview_selection_copy_20260913](conductor/tracks/webview_selection_copy_20260913/index.md))
- Image lightbox in Dashboard and Markdown Preview: click image → full-screen overlay with zoom, click outside or Escape to dismiss.

### Fixed
- Dashboard workspace filter state and `currentLoadedSessionId` lost on re-render.

---
