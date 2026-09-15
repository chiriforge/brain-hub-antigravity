# Brain Hub for Antigravity

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README_VI.md"><b>Tiếng Việt</b></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity"><img src="https://badgen.net/vs-marketplace/v/chiriforge.brain-hub-antigravity?color=blue&label=VS%20Marketplace&icon=visualstudio" alt="Visual Studio Marketplace"></a>
  <a href="https://open-vsx.org/extension/chiriforge/brain-hub-antigravity"><img src="https://img.shields.io/open-vsx/v/chiriforge/brain-hub-antigravity?color=purple&label=Open%20VSX&logo=open-vsx" alt="Open VSX"></a>
  <a href="https://github.com/chiriforge/brain-hub-antigravity/releases"><img src="https://img.shields.io/github/v/release/chiriforge/brain-hub-antigravity?color=blue&logo=github" alt="GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License"></a>
  <a href="https://code.visualstudio.com/Download"><img src="https://badgen.net/badge/VS%20Code/^1.80.0/007ACC?icon=visualstudio" alt="VS Code"></a>
  <a href="https://antigravity.google"><img src="https://badgen.net/badge/Antigravity%20IDE/Compatible/EA4335?icon=google" alt="Antigravity IDE"></a>
</p>

An extension for VS Code and Google DeepMind Antigravity IDE to browse, search, resume, archive, and sync local Antigravity brain sessions.

[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity) | [Open VSX Registry](https://open-vsx.org/extension/chiriforge/brain-hub-antigravity) | [User Guide (English)](./USER_GUIDE.md) | [User Guide (Tiếng Việt)](./USER_GUIDE_VI.md) | [Architecture & Developer Guide](./ARCHITECTURE.md)

<p align="center">
  <img src="./media/showcase-chat-reader.png" alt="Brain Hub Chat Reader Webview Showcase" width="100%">
  <br>
  <em>Figure 1: Native Antigravity IDE Chat panel (left) versus Brain Hub Chat Reader Webview (right).</em>
</p>

| Capability | Native IDE Chat Panel (Left) | Brain Hub Chat Reader (Right) |
|---|---|---|
| **LaTeX Mathematics** | Raw unrendered text (`$$...$$`) | KaTeX rendered formulas with multi-line equation alignment |
| **System Diagrams** | Raw Mermaid code block | Rendered interactive Mermaid SVG diagrams |
| **Model Reasoning** | Expanded text output | Collapsible `Thinking` and `AI Steps` sections |
| **Session Metadata** | Basic message stream | Live status, execution step count, user message count, timeline, and workspace info |
| **Session Operations** | None | Toolbar with Git sync, `.docs/` export, branch/fork, and raw transcript access |

---

## What's New in v0.5.2
- **Session Artifacts Gallery**: Album grid viewer with lightbox and asset export.
- **Mermaid Rendering**: Fixed dark theme contrast and label alignment.
- **Webview Selection**: Enabled text selection and right-click copy.

---

## Features

### 1. Brain Hub Dashboard (`Ctrl + K Ctrl + D`)
- **Search & Filter**: Filter sessions by title, session ID, user prompt text, or workspace folder path.
- **Header Actions**: Trigger Git sync, rescan disk folders, or delete empty sessions.

### 2. Chat Reader Webview
- **Markdown & Math**: Renders GitHub Flavored Markdown and LaTeX formulas via KaTeX.
- **Syntax Highlighting**: Code blocks formatted with highlight.js and an inline Copy button.
- **Mermaid Diagrams**: Loads Mermaid script on-demand when diagram containers are detected in the active conversation.
- **Alert Blocks**: Parses standard GitHub callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- **Collapsible Blocks**: Toggle model reasoning (`Thinking`), autonomous execution steps (`AI Steps`), and tool calls (`Tools`).
- **In-Chat Search**: Find text matches within the currently opened conversation.
- **Auto-Reload**: Watches the open session's `transcript.jsonl` file and re-renders when changes are written.

### 3. Sidebar Tree View
- **Workspace Filter**: Limits visible sessions to those associated with the open workspace.
- **Badges**: Shows message count, machine name tag, and artifact indicators (`Plan`, `Walkthrough`).

### 4. Mermaid Sanitizer
- **Syntax Sanitization**: Automatically preprocesses raw Mermaid diagram code before passing to Mermaid.js:
  - Wraps unquoted node labels in double quotes across node shapes (rectangles `["..."]`, circles `(("..."))`, databases `[("...")]`, hexagons `{{"..."}}`, rhombuses `{"..."}`).
  - Escapes special characters (`<`, `>`, `&`) in edge labels `|...|`.
  - Normalizes subgraph declarations containing special characters into quoted titles (`subgraph "..."`).

### 5. Project Documentation & Archiving (`.docs/`)
- **Export to Workspace**: Copies plans, walkthroughs, diagrams, and conversation logs into a `.docs/` directory in the workspace root.
- **Secret Sanitization**: When enabled, detects and masks API keys, bearer tokens, passwords, and private keys from exported transcripts.
- **Git Protection**: Adds `.docs/logs/` and `.docs/scratch/` to the workspace `.gitignore` to prevent committing raw chat logs.
- **Batch Export**: Exports all sessions associated with the current workspace to individual Markdown files.

### 6. Markdown Preview with Mermaid & KaTeX
- Contributes the command `brainHub.openRichMarkdownPreview` on `.md` files in the Explorer and editor tab to render documents containing Mermaid diagrams and LaTeX equations.

### 7. Git Synchronization
- Initializes and manages a Git repository inside the local `brain/` directory to push and pull session files with a remote repository.
- **Machine Identification**: Associates sessions with `machineName` to distinguish files created across multiple computers.
- **Sync Options**: Supports manual sync, startup sync, and background sync at periodic intervals.
- **Status Bar Item**: Displays `$(github) Brain Hub Sync` in the bottom bar with current sync state.

### 8. Resume Conversation Prompt
- Copies a prompt template containing the session ID and transcript file path to the clipboard for pasting into a new Antigravity chat session.

### 9. Empty Session Management
- **Hide 0-Message Sessions**: Toggles visibility of sessions containing no messages.
- **Clean Empty Sessions**: Scans and deletes empty session directories from disk.

### 10. File System Monitoring
- **Real-Time Watcher**: Uses a shallow file system watcher on the `brain/` directory to detect added and removed sessions.
- **Window Focus Refresh**: Runs a background scan when switching focus back to the IDE window.

---

## Installation

### From Marketplace (Recommended)
Install directly from your editor's extension marketplace or via CLI:
- **Visual Studio Marketplace**: [Install Brain Hub for Antigravity](https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity)
- **Open VSX Registry**: [Install from Open VSX](https://open-vsx.org/extension/chiriforge/brain-hub-antigravity)

Install via terminal:
```bash
code --install-extension chiriforge.brain-hub-antigravity
```

### From `.vsix` Package
1. Download the `.vsix` file from [GitHub Releases](https://github.com/chiriforge/brain-hub-antigravity/releases).
2. In VS Code, open Extensions (`Ctrl + Shift + X`) $\rightarrow$ click `...` $\rightarrow$ select **Install from VSIX...**.

Or install via terminal:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Build from Source
```bash
git clone https://github.com/chiriforge/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Press `F5` in VS Code to launch the Extension Development Host.

---

## Keybindings

| Shortcut (Windows/Linux) | Shortcut (macOS) | Command ID | Description |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `brainHub.openDashboard` | Open Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `brainHub.searchChat` | Open Quick Search across sessions |

*Note: All keybindings can be changed or unbound in VS Code Keyboard Shortcuts (`Ctrl + K Ctrl + S`).*

---

## Commands Reference

The extension contributes the following commands:

| Command | Title | Description |
|---|---|---|
| `brainHub.openDashboard` | Open Dashboard | Opens the two-column dashboard webview |
| `brainHub.searchChat` | Search Chat History... | QuickPick search across sessions |
| `brainHub.openSettings` | Open Settings | Opens extension configuration in VS Code |
| `brainHub.syncNow` | Sync with GitHub (Pull & Push) | Runs `git pull` and `git push` on the brain repository |
| `brainHub.setupGitSync` | Setup GitHub Backup Repository... | Configures remote URL for the brain directory |
| `brainHub.checkGitStatus` | Check GitHub Sync Status | Shows current Git branch and uncommitted status |
| `brainHub.refresh` | Scan and Refresh Sessions from Disk | Rescans the brain directory and rebuilds cache |
| `brainHub.toggleWorkspaceFilter` | Filter Chat History by Current Workspace | Toggles workspace session filtering |
| `brainHub.toggleHideEmptySessions` | Toggle Hide Empty Chats (0-message sessions) | Toggles visibility of 0-message sessions |
| `brainHub.cleanEmptySessions` | Clean Empty Chat Sessions (0 messages) | Deletes 0-message session folders from disk |
| `brainHub.exportMarkdown` | Export to Markdown (.md) | Saves active session transcript to a `.md` file |
| `brainHub.exportAllWorkspaceSessions` | Batch Export Workspace Sessions to Markdown... | Exports all workspace sessions to a selected folder |
| `brainHub.exportProjectDocs` | Archive Project Docs & Logs (.docs/) | Copies plans, walkthroughs, and logs to `.docs/` |
| `brainHub.openRichMarkdownPreview` | Open Rich Markdown Preview (Mermaid & KaTeX) | Opens custom preview with Mermaid & KaTeX support |
| `brainHub.openIdeMarkdownPreview` | Open with IDE Built-in Markdown Preview | Opens default VS Code markdown preview |
| `brainHub.openChat` | Open Chat | Opens session transcript in reader |
| `brainHub.copyResumePrompt` | Copy Resume Prompt | Copies session resume prompt to clipboard |
| `brainHub.copySessionId` | Copy Session ID | Copies session ID string to clipboard |
| `brainHub.openFolder` | Open Session Folder in Explorer | Opens session folder in OS file manager |
| `brainHub.deleteSession` | Delete Chat Session | Prompts to delete selected session folder |

---

## Settings Reference

Configure in VS Code Settings (`Ctrl + ,` $\rightarrow$ search `brainHub`):

| Setting | Default | Description |
|---|---|---|
| `brainHub.brainPath` | `""` | Primary path to `brain/` directory (defaults to `~/.gemini/antigravity-ide/brain`) |
| `brainHub.additionalBrainPaths` | `[]` | Additional directories to scan alongside the primary brain folder |
| `brainHub.machineName` | `""` | Machine label for sessions created on this device (defaults to system hostname) |
| `brainHub.sessionSortBy` | `"lastModified"` | Sort criteria: `"lastModified"` (last activity) or `"createdAt"` (creation time) |
| `brainHub.messageOrder` | `"newestFirst"` | Message ordering: `"newestFirst"` or `"oldestFirst"` |
| `brainHub.autoSyncOnStartup` | `true` | Runs Git sync when VS Code launches |
| `brainHub.autoSyncIntervalMinutes` | `30` | Interval in minutes for background Git sync (`0` to disable) |
| `brainHub.backgroundScanIntervalMinutes` | `5` | Interval in minutes for background folder scan (`0` to disable) |
| `brainHub.enableRealtimeWatcher` | `true` | Watches brain folder for newly created or deleted session folders |
| `brainHub.autoRefreshOnWindowFocus` | `true` | Triggers background scan when refocusing the IDE window |
| `brainHub.filterWorkspaceByDefault` | `false` | Filters sidebar tree view by open workspace on load |
| `brainHub.hideEmptySessions` | `true` | Filters out sessions with 0 messages |
| `brainHub.autoReloadOnLiveChat` | `true` | Reloads viewer when the active session's transcript file changes |
| `brainHub.defaultToolsState` | `"collapsed"` | Default collapse state for tool call details (`"collapsed"` or `"expanded"`) |
| `brainHub.defaultAiStepsState` | `"collapsed"` | Default collapse state for AI step groups (`"collapsed"` or `"expanded"`) |
| `brainHub.defaultGroupExpansion` | `"smart"` | Default expansion for time groups: `"smart"`, `"allExpanded"`, or `"collapsed"` |
| `brainHub.maxQuickSearchItems` | `100` | Maximum number of sessions indexed for Quick Search |
| `brainHub.autoOpenDashboardOnSidebarFocus` | `true` | Opens Dashboard when clicking the Antigravity Activity Bar icon |
| `brainHub.archiver.defaultMode` | `"askEachTime"` | Archive mode: `"askEachTime"`, `"safeDocsOnly"`, or `"fullWithSanitization"` |
| `brainHub.archiver.autoGitignore` | `true` | Appends `.docs/logs/` and `.docs/scratch/` to workspace `.gitignore` |
| `brainHub.archiver.sanitizeSecrets` | `true` | Redacts API keys, tokens, and credentials from archived transcripts |
| `brainHub.archiver.customSecretPatterns` | `[]` | Additional regex patterns used by the secret sanitizer |

---

## Documentation & Marketplace Links
- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity)
- [Open VSX Registry](https://open-vsx.org/extension/chiriforge/brain-hub-antigravity)
- [User Guide (English)](./USER_GUIDE.md)
- [User Guide (Tiếng Việt)](./USER_GUIDE_VI.md)
- [Architecture & Developer Guide](./ARCHITECTURE.md)
- [Issue Tracker](https://github.com/chiriforge/brain-hub-antigravity/issues)

---

## Disclaimer

**Brain Hub for Antigravity** is an independent, unofficial open-source extension. It is not affiliated with, endorsed by, or sponsored by Google or Google DeepMind. "Antigravity", "Gemini", and related marks are trademarks of Google LLC or their respective owners, used here solely under Nominative Fair Use to describe compatibility and functionality.
