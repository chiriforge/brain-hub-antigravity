# Brain Hub for Antigravity

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README_VI.md"><b>Tiếng Việt</b></a>
</p>

<p align="center">
  <a href="https://github.com/hungle-vn/brain-hub-antigravity/releases"><img src="https://img.shields.io/github/v/release/hungle-vn/brain-hub-antigravity?color=blue&logo=github" alt="GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/Platform-VS%20Code%20%7C%20Antigravity%20IDE-orange.svg" alt="Platform"></a>
</p>

Search, view, resume, and sync Antigravity Brain sessions across machines.

[User Guide (English)](./USER_GUIDE.md) | [User Guide (Tiếng Việt)](./USER_GUIDE_VI.md) | [Architecture & Developer Guide](./ARCHITECTURE.md)

---

## Features

### 1. Brain Hub Dashboard (`Ctrl + Alt + D`)
- **Two-Column Layout**: Session list on the left and full transcript reader on the right in a single editor tab.
- **Sidebar Toggle**: Collapse or expand the session list panel.
- **Search**: Filter sessions by title, session ID, prompt text, or workspace folder path.
- **Settings Modal**: Configure machine name, session sorting, message order, Git remote URL, and sync intervals directly inside the dashboard.
- **Header Actions**: Trigger Git sync, rescan sessions from disk, or clean empty sessions.

### 2. Chat Reader Webview
- **Markdown & Math Rendering**: Formatted Markdown and LaTeX equations via KaTeX.
- **Syntax Highlighting**: Code blocks with syntax coloring and a Copy button.
- **Alert Blocks**: GitHub-style callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- **Collapsible Sections**: Toggle visibility of model reasoning (`Thinking`) and tool execution details (`Tools`).
- **In-Chat Search**: Search for keywords inside the opened conversation.
- **Auto-Reload on Active Chat**: Automatically reloads the viewer when the currently opened transcript file is updated.

### 3. GitHub Backup & Sync
- Manages a Git repository inside the local `brain/` folder to push and pull chat histories to a remote repository.
- **Machine Tagging**: Tags sessions with `machineName` to distinguish logs created on different computers.
- **Background Sync**: Runs sync on startup and at configurable periodic intervals.
- **Status Bar Item**: Manual sync button `$(github) Brain Hub Sync` in the bottom status bar.

### 4. Resume Conversation Prompt
- Copies a prompt template containing the session directory path and session ID to clipboard, allowing you to paste it into a new Antigravity chat to continue the context.

### 5. Sidebar Tree View
- Groups sessions by time: Today, Yesterday, Previous 7 Days, and Older.
- **Workspace Filter**: Filter the tree view to only show sessions matching the currently opened workspace.
- **Badges**: Shows message count, artifacts indicators (`Plan`, `Walkthrough`), and machine name.

### 6. Clean Empty Chats
- Option to hide 0-message sessions.
- Command to scan and permanently delete 0-message session directories from disk.

### 7. Markdown Export
- Exports the active chat transcript into a standalone `.md` file.

---

## Installation

### From `.vsix` Package
1. Download the `.vsix` file from [GitHub Releases](https://github.com/hungle-vn/brain-hub-antigravity/releases).
2. In VS Code, open Extensions (`Ctrl + Shift + X`) $\rightarrow$ click `...` $\rightarrow$ select **Install from VSIX...**.

Or install via terminal:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Build from Source
```bash
git clone https://github.com/hungle-vn/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Press `F5` in VS Code to launch the Extension Development Host.

---

## Keybindings

| Shortcut (Windows/Linux) | Shortcut (macOS) | Command ID | Description |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `antigravityHistory.openDashboard` | Open Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `antigravityHistory.searchChat` | Open Quick Search across sessions |

*Note: All keybindings can be customized or disabled in VS Code Keyboard Shortcuts (`Ctrl + K Ctrl + S`).*

---

## Settings

Configure in VS Code Settings (`Ctrl + ,` $\rightarrow$ search `antigravityHistory`):

| Setting | Default | Description |
|---|---|---|
| `antigravityHistory.brainPath` | `""` | Primary path to `brain/` directory (defaults to `~/.gemini/antigravity-ide/brain`) |
| `antigravityHistory.additionalBrainPaths` | `[]` | Additional directories to scan alongside the primary brain folder |
| `antigravityHistory.machineName` | `""` | Machine name label for sessions created on this device (defaults to OS hostname) |
| `antigravityHistory.sessionSortBy` | `"lastModified"` | Sort criteria: `"lastModified"` (last message time) or `"createdAt"` (session creation time) |
| `antigravityHistory.messageOrder` | `"newestFirst"` | Message order in reader: `"newestFirst"` or `"oldestFirst"` |
| `antigravityHistory.autoSyncOnStartup` | `true` | Automatically sync with Git remote when VS Code launches |
| `antigravityHistory.autoSyncIntervalMinutes` | `30` | Periodic Git sync interval in minutes (`0` to disable) |
| `antigravityHistory.hideEmptySessions` | `true` | Hide empty sessions with 0 messages |
| `antigravityHistory.filterWorkspaceByDefault` | `false` | Default to filtering sidebar tree view by current workspace |
| `antigravityHistory.autoReloadOnLiveChat` | `true` | Reload active chat viewer when its transcript file is modified |
| `antigravityHistory.defaultToolsState` | `"collapsed"` | Default state of tool call details (`"collapsed"` or `"expanded"`) |
| `antigravityHistory.defaultAiStepsState` | `"collapsed"` | Default state of AI step groups (`"collapsed"` or `"expanded"`) |
| `antigravityHistory.autoOpenDashboardOnSidebarFocus` | `true` | Open Dashboard when clicking the Antigravity Activity Bar icon |

---

## Documentation
- [User Guide (English)](./USER_GUIDE.md)
- [User Guide (Tiếng Việt)](./USER_GUIDE_VI.md)
- [Architecture & Developer Guide](./ARCHITECTURE.md)
- [Issue Tracker](https://github.com/hungle-vn/brain-hub-antigravity/issues)

---

## Disclaimer

**Brain Hub for Antigravity** is an independent, unofficial open-source extension. It is not affiliated with, endorsed by, or sponsored by Google or Google DeepMind. "Antigravity", "Gemini", and related marks are trademarks of Google LLC or their respective owners, used here solely under Nominative Fair Use to describe compatibility and functionality.
