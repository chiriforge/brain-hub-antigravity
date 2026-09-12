# User Guide
## Brain Hub for Antigravity for VS Code & Antigravity IDE

<p align="center">
  <a href="./USER_GUIDE.md"><b>English</b></a> | <a href="./USER_GUIDE_VI.md"><b>Tiếng Việt</b></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity"><img src="https://img.shields.io/visual-studio-marketplace/v/chiriforge.brain-hub-antigravity?color=blue&label=VS%20Marketplace&logo=visual-studio-code" alt="Visual Studio Marketplace"></a>
  <a href="https://open-vsx.org/extension/chiriforge/brain-hub-antigravity"><img src="https://img.shields.io/open-vsx/v/chiriforge/brain-hub-antigravity?color=purple&label=Open%20VSX&logo=open-vsx" alt="Open VSX"></a>
  <a href="https://github.com/chiriforge/brain-hub-antigravity/releases"><img src="https://img.shields.io/github/v/release/chiriforge/brain-hub-antigravity?color=blue&logo=github" alt="GitHub Release"></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity">Visual Studio Marketplace</a> | 
  <a href="https://open-vsx.org/extension/chiriforge/brain-hub-antigravity">Open VSX Registry</a> | 
  <a href="./README.md">README</a>
</p>

---

## Table of Contents
1. [Overview](#1-overview)
2. [Installation](#2-installation)
   - [Option 1: Install from Marketplace](#option-1-install-from-marketplace-recommended)
   - [Option 2: Install from .vsix Package](#option-2-install-from-vsix-package)
   - [Option 3: Build and Run from Source](#option-3-build-and-run-from-source)
3. [User Interfaces](#3-user-interfaces)
   - [3.1. Brain Hub Dashboard](#31-brain-hub-dashboard)
   - [3.2. Sidebar Tree View](#32-sidebar-tree-view)
   - [3.3. Chat Reader Webview](#33-chat-reader-webview)
   - [3.4. Rich Markdown Preview (Mermaid & KaTeX)](#34-rich-markdown-preview-mermaid--katex)
4. [Features in Detail](#4-features-in-detail)
   - [4.1. Search & Filtering](#41-search--filtering)
   - [4.2. Mermaid Sanitizer](#42-mermaid-sanitizer)
   - [4.3. Resume Conversation Prompt](#43-resume-conversation-prompt)
   - [4.4. Project Documentation & Archiving (.docs/)](#44-project-documentation--archiving-docs)
     - [4.4.1. Archiving Modes](#441-archiving-modes)
     - [4.4.2. Secret & Credential Sanitization](#442-secret--credential-sanitization)
     - [4.4.3. .gitignore Configuration](#443-gitignore-configuration)
   - [4.5. Batch Exporting Workspace Sessions](#45-batch-exporting-workspace-sessions)
   - [4.6. Git Backup & Synchronization](#46-git-backup--synchronization)
   - [4.7. Managing Empty Sessions](#47-managing-empty-sessions)
   - [4.8. File Monitoring & Transcript Reloading](#48-file-monitoring--transcript-reloading)
5. [Keybindings & Commands Reference](#5-keybindings--commands-reference)
   - [5.1. Default Keybindings](#51-default-keybindings)
   - [5.2. Customizing or Disabling Shortcuts](#52-customizing-or-disabling-shortcuts)
   - [5.3. Contributed Commands](#53-contributed-commands)
6. [Settings Reference](#6-settings-reference)
7. [FAQ & Troubleshooting](#7-faq--troubleshooting)

---

## 1. Overview

**Brain Hub for Antigravity** is an extension for **VS Code** and **Google DeepMind Antigravity IDE** that reads local conversation data stored in the `brain/` directory.

Core capabilities:
- **Search & Inspection**: Search across stored conversations by title, ID, prompt content, or workspace path.
- **Mermaid Sanitizer**: Preprocesses raw Mermaid syntax (auto-quoting labels, escaping HTML entities in edges, quoting subgraph titles) before rendering to prevent Mermaid.js parser errors.
- **Resume Prompt Generator**: Copies formatted text containing the session ID and file path for continuing a session in a new Antigravity chat.
- **Project Documentation Archiving (`.docs/`)**: Copies plans, walkthroughs, diagrams, and transcripts into the workspace `.docs/` directory, with optional regex-based secret masking and `.gitignore` rules.
- **Markdown Preview**: Displays Markdown documents with KaTeX mathematical formulas and Mermaid diagrams rendered inside a webview.
- **Git Synchronization**: Runs Git commands in the local `brain/` directory to push and pull conversation files with a configured Git remote.

---

## 2. Installation

### Option 1: Install from Marketplace (Recommended)
Install directly from the extensions registry in VS Code or any Open VSX compatible editor (such as VSCodium or Gitpod):
- **Visual Studio Marketplace**: [Brain Hub for Antigravity](https://marketplace.visualstudio.com/items?itemName=chiriforge.brain-hub-antigravity)
- **Open VSX Registry**: [Brain Hub for Antigravity](https://open-vsx.org/extension/chiriforge/brain-hub-antigravity)

Install via terminal:
```bash
code --install-extension chiriforge.brain-hub-antigravity
```

### Option 2: Install from `.vsix` Package
1. Download `brain-hub-antigravity-0.5.1.vsix` from [GitHub Releases](https://github.com/chiriforge/brain-hub-antigravity/releases).
2. In VS Code or Antigravity IDE, press `Ctrl + Shift + X` to open Extensions.
3. Click the `...` menu icon in the top-right corner of the Extensions pane and choose **Install from VSIX...**.
4. Select the downloaded `.vsix` file.

Or install via terminal:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Option 3: Build and Run from Source
```bash
git clone https://github.com/chiriforge/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Press `F5` in VS Code to run the Extension Development Host.

---

## 3. User Interfaces

### 3.1. Brain Hub Dashboard
Open using the Command Palette (`Brain Hub for Antigravity: Open Brain Hub Dashboard`) or the default shortcut:
- **Windows / Linux**: `Ctrl + K Ctrl + D`
- **macOS**: `Cmd + K Cmd + D`

```text
+-----------------------------------------------------------------------------------------+
| Brain Hub for Antigravity [152 Sessions]              [Refresh] [Cleanup] [Sync] [⚙️]    |
+--------------------------------------+--------------------------------------------------+
| [Search chats, prompt, ID...       ] | Active Session: Add authentication flow          |
| [X] Current Workspace  [o] Hide Empty| Path: .../brain/a1b2c3d4/                        |
|                                      |                                                  |
| > Today (3)                          | USER:                                            |
|   * Fix JWT validation edge cases    |   "How do I add JWT validation with refresh?"    |
|     14:30 | 12 msgs | Plan           |                                                  |
|   * Refactor database connection     | MODEL:                                           |
|     11:15 | 8 msgs                   |   > Thinking (8.2s) [Click to expand]            |
|                                      |   "Here is the recommended architecture..."      |
| > Yesterday (2)                      |   ```typescript                                  |
|   * Initial schema migration         |   export interface TokenPayload { ... }          |
|     Yesterday | 15 msgs | Walkthrough|   ```                                            |
|                                      |   > Tool: run_command (npm test) [Output]        |
| v Older (12)                         |                                                  |
+--------------------------------------+--------------------------------------------------+
```

Dashboard components:
- **Search Input**: Filters the session list by title, ID, prompt text, or workspace path.
- **Filter Chips**: Toggles between all sessions and workspace-filtered sessions, and toggles visibility of 0-message sessions.
- **Action Buttons**: Trigger manual Git synchronization, rescan session folders from disk, or remove empty sessions.

### 3.2. Sidebar Tree View
Located in the Activity Bar under the Antigravity icon:
- **Toolbar Buttons**:
  - `$(screen-full)` Open Dashboard
  - `$(github)` Sync with GitHub
  - `$(gear)` Open Settings
  - `$(refresh)` Rescan sessions from disk
  - `$(search)` Open Quick Search
  - `$(filter)` Toggle Workspace Filter
  - `$(eye-closed)` Toggle Hide Empty Chats
  - `$(book)` Archive Project Docs & Logs (`.docs/`)
  - `$(files)` Batch Export Workspace Sessions
- **Item Badges**: Shows message count, machine origin, and artifact labels (`Plan`, `Walkthrough`).

### 3.3. Chat Reader Webview
- **Markdown & Math Parsing**: Uses `marked` with `marked-katex-extension` to render standard Markdown and LaTeX blocks.
- **Code Highlighting & Copy**: Applies `highlight.js` CSS classes and binds click listeners to write code block contents to clipboard.
- **Mermaid Diagrams**: Injects the `mermaid.min.js` script when unrendered diagram containers exist, then initializes and renders them.
- **Alert Blocks**: Matches `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, and `[!CAUTION]` syntax and wraps them in styled containers.
- **Collapsible Elements**: Renders `<details>` containers for `Thinking`, `AI Steps`, and `Tools`.
- **In-Chat Search**: Text input at the top of the reader that matches text inside DOM nodes.
- **Live Updates**: When `autoReloadOnLiveChat` is true, a file watcher on the active session's `transcript.jsonl` triggers a re-render when new bytes are written.

### 3.4. Rich Markdown Preview (Mermaid & KaTeX)
A separate webview panel for Markdown files:
- Right-click any `.md` or `.markdown` file in the Explorer or editor tab and select **Brain Hub: Open Rich Markdown Preview**.
- Uses the same parsing pipeline as the chat reader to render KaTeX formulas and Mermaid diagrams.

---

## 4. Features in Detail

### 4.1. Search & Filtering

| Tool | Shortcut | Scope | Implementation |
|---|---|---|---|
| **Quick Search** | `Ctrl + K Ctrl + H` (`Cmd + K Cmd + H`) | Global | `vscode.window.showQuickPick` over cached sessions (up to `maxQuickSearchItems`) |
| **Dashboard Search** | Text input in dashboard | Dashboard | Client-side JavaScript filtering on session elements |
| **Workspace Filter** | Click `$(filter)` or chip | Sidebar / Dashboard | Matches session `workspacePath` against active workspace folders |
| **In-Chat Search** | Input in reader header | Current session | DOM node traversal and text highlighting |

### 4.2. Mermaid Sanitizer
The extension runs `MermaidSanitizer.sanitize()` on raw Mermaid code blocks before passing them to the client-side `mermaid.render()` engine. This prevents diagram rendering errors caused by unquoted special characters or unescaped HTML tokens:

1. **Edge Labels**:
   - Matches text between pipes (`|...|`).
   - Replaces double quotes with single quotes.
   - Escapes unescaped ampersands (`&` to `&amp;`), less-than signs (`<` to `&lt;`), and greater-than signs (`>` to `&gt;`).
2. **Subgraph Titles**:
   - Detects `subgraph Title` declarations where `Title` contains control characters (`:`, `()`, `->`, `/`, `&`, etc.) without surrounding quotes.
   - Rewrites the line to `subgraph "Title"`.
3. **Node Label Auto-Quoting**:
   - Inspects node declarations across common Mermaid shapes and ensures their inner labels are enclosed in double quotes:
     - Hexagons: `id{{label}}` $\rightarrow$ `id{{"label"}}`
     - Database cylinders: `id[(label)]` $\rightarrow$ `id[("label")]`
     - Circles: `id((label))` $\rightarrow$ `id(("label"))`
     - Asymmetric shapes: `id>label]` $\rightarrow$ `id>"label"]`
     - Parallelograms & Trapezoids: `id[/label/]` $\rightarrow$ `id[/"label"/]` and `id[\label\]` $\rightarrow$ `id[\"label"\]`
     - Rhombuses / Decision nodes: `id{label}` $\rightarrow$ `id{"label"}`
     - Rectangles: `id[label]` $\rightarrow$ `id["label"]`
     - Rounded rectangles: `id(label)` $\rightarrow$ `id("label")`
4. **Preserved Directives**:
   - Skips chart type headers (`graph`, `flowchart`, `sequenceDiagram`, etc.).
   - Leaves styling directives (`classDef`, `style`, `linkStyle`, `click`) and comments (`%%`) unaltered.

### 4.3. Resume Conversation Prompt
When resuming work in a new Antigravity session:
1. Select **Copy Resume Prompt** from the Dashboard toolbar or session context menu.
2. The extension formats a string containing:
   - Session directory path
   - Session ID
   - Instructions to inspect `transcript.jsonl` and associated artifacts (`implementation_plan.md`, `walkthrough.md`)
3. Paste the string into a new Antigravity prompt.

### 4.4. Project Documentation & Archiving (`.docs/`)
Command: `Brain Hub for Antigravity: Archive Project Docs & Logs (.docs/)`

Copies files from the local brain folder into the workspace directory:
```text
<workspace-root>/
└── .docs/
    ├── README.md                      # Index listing archived sessions and artifacts
    ├── plans/                         # implementation_plan.md files
    ├── walkthroughs/                  # walkthrough.md files
    ├── logs/                          # Sanitized conversation logs
    └── scratch/                       # Scratch files and scripts
```

#### 4.4.1. Archiving Modes
Controlled by `brainHub.archiver.defaultMode`:
1. `askEachTime` *(Default)*: Shows a QuickPick prompt before running.
2. `safeDocsOnly`: Copies plans, walkthroughs, and scratch files only. Omits transcripts.
3. `fullWithSanitization`: Copies plans, walkthroughs, scratch files, and runs transcripts through the secret sanitizer before writing them.

#### 4.4.2. Secret & Credential Sanitization
When `brainHub.archiver.sanitizeSecrets` is `true`, `SecretSanitizer` runs regular expressions against transcript text to replace matches with `[REDACTED_...]`:
- Standard patterns for API keys (OpenAI `sk-...`, Google `AIza...`, AWS access keys, GitHub tokens `ghp_...`, Anthropic `sk-ant-...`)
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Bearer tokens and generic passwords
- User-specified patterns from `brainHub.archiver.customSecretPatterns`

#### 4.4.3. `.gitignore` Configuration
When `brainHub.archiver.autoGitignore` is `true`, the archiver checks `.gitignore` in the workspace root and appends:
```gitignore
# Brain Hub for Antigravity: prevent committing raw transcripts
.docs/logs/
.docs/scratch/
```

### 4.5. Batch Exporting Workspace Sessions
Command: `Brain Hub: Batch Export Workspace Sessions to Markdown...`
- Filters cached sessions matching the active workspace.
- Prompts for a target directory using `vscode.window.showOpenDialog`.
- Uses `MarkdownExporter` to write one `.md` file per session, containing metadata headers, message turns, tool call arguments, and outputs.

### 4.6. Git Backup & Synchronization
Manages Git operations in the `brain/` directory via `child_process.exec`:

#### Setup:
1. Run `Brain Hub: Setup GitHub Backup Repository...` or click **Sync** in the Dashboard.
2. Enter a Git remote URL (SSH or HTTPS).
3. If no Git repository exists in the brain folder, `git init` is executed.
4. The remote URL is configured with `git remote add origin <url>` (or `set-url`), followed by an initial commit and push.

#### Sync Behavior:
- **Startup**: If `autoSyncOnStartup` is `true`, runs `git pull --rebase` and `git push` on extension activation.
- **Periodic Sync**: If `autoSyncIntervalMinutes` > 0, sets a timer with `setInterval` to run the sync cycle.
- **Machine Tag**: When writing or updating session files, metadata includes `machineName` (defaults to `os.hostname()`).
- **Status Bar**: `$(github) Brain Hub Sync` shows current status and triggers manual sync when clicked.

### 4.7. Managing Empty Sessions
- **Hide 0-Message Sessions**: When `brainHub.hideEmptySessions` is `true`, sessions where `messageCount === 0` are excluded from `ChatHistoryTreeProvider.getChildren` and dashboard list generation.
- **Clean Empty Sessions**: Run `Brain Hub: Clean Empty Chat Sessions (0 messages)`. Iterates through all session folders in `brain/`, checks whether `transcript.jsonl` has 0 messages, and deletes the directory using `fs.rmSync`.

### 4.8. File Monitoring & Transcript Reloading
- **Real-Time Watcher**: When `enableRealtimeWatcher` is `true`, a non-recursive `fs.watch` is placed on the brain directory to catch created or deleted session subdirectories, debounced by 1.5 seconds.
- **Window Focus Refresh**: When `autoRefreshOnWindowFocus` is `true`, `vscode.window.onDidChangeWindowState` triggers `scanner.scanSessions()` when `window.focused` becomes `true`.
- **Live Transcript Updates**: When `autoReloadOnLiveChat` is `true`, `ChatWebviewPanel` watches the active `transcript.jsonl` and reloads message data when modified.

---

## 5. Keybindings & Commands Reference

### 5.1. Default Keybindings

| Keybinding (Windows / Linux) | Keybinding (macOS) | Command ID | Purpose |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `brainHub.openDashboard` | Open Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `brainHub.searchChat` | Open Quick Search |

### 5.2. Customizing or Disabling Shortcuts
1. Open **Keyboard Shortcuts** (`Ctrl + K Ctrl + S` or `Cmd + K Cmd + S`).
2. Search for `brainHub`.
3. Right-click to edit or remove the binding.

In `keybindings.json`:
```json
[
  {
    "key": "ctrl+k ctrl+d",
    "command": "-brainHub.openDashboard"
  },
  {
    "key": "ctrl+k ctrl+h",
    "command": "-brainHub.searchChat"
  }
]
```

### 5.3. Contributed Commands

| Command ID | Title | Where Accessible |
|---|---|---|
| `brainHub.openDashboard` | Open Dashboard | Activity Bar, Command Palette, Shortcut |
| `brainHub.searchChat` | Search Chat History... | Sidebar Toolbar, Command Palette, Shortcut |
| `brainHub.openSettings` | Open Settings | Sidebar Toolbar, Dashboard Header |
| `brainHub.syncNow` | Sync with GitHub (Pull & Push) | Sidebar Toolbar, Status Bar, Dashboard |
| `brainHub.setupGitSync` | Setup GitHub Backup Repository... | Sidebar View Menu, Dashboard Header |
| `brainHub.checkGitStatus` | Check GitHub Sync Status | Sidebar View Menu, Command Palette |
| `brainHub.refresh` | Scan and Refresh Sessions from Disk | Sidebar Toolbar, Dashboard Header |
| `brainHub.toggleWorkspaceFilter` | Filter Chat History by Current Workspace | Sidebar Toolbar, Dashboard Filter Chip |
| `brainHub.toggleHideEmptySessions` | Toggle Hide Empty Chats (0-message sessions) | Sidebar Toolbar, Dashboard Filter Chip |
| `brainHub.cleanEmptySessions` | Clean Empty Chat Sessions (0 messages) | Sidebar View Menu, Dashboard Header |
| `brainHub.exportMarkdown` | Export to Markdown (.md) | Session Context Menu, Dashboard Reader |
| `brainHub.exportAllWorkspaceSessions` | Batch Export Workspace Sessions to Markdown... | Sidebar View Menu, Command Palette |
| `brainHub.exportProjectDocs` | Archive Project Docs & Logs (.docs/) | Sidebar View Menu, Command Palette |
| `brainHub.openRichMarkdownPreview` | Open Rich Markdown Preview (Mermaid & KaTeX) | Editor Title Menu, File Context Menu |
| `brainHub.openIdeMarkdownPreview` | Open with IDE Built-in Markdown Preview | Command Palette |
| `brainHub.openChat` | Open Chat | Session Double-Click, Context Menu |
| `brainHub.copyResumePrompt` | Copy Resume Prompt | Session Context Menu, Dashboard Toolbar |
| `brainHub.copySessionId` | Copy Session ID | Session Context Menu, Dashboard Toolbar |
| `brainHub.openFolder` | Open Session Folder in Explorer | Session Context Menu |
| `brainHub.deleteSession` | Delete Chat Session | Session Context Menu |

---

## 6. Settings Reference

Settings can be modified in VS Code Settings (`Ctrl + ,` $\rightarrow$ search `brainHub`) or in `settings.json`:

```json
{
  // Primary directory containing Antigravity brain sessions (defaults to ~/.gemini/antigravity-ide/brain)
  "brainHub.brainPath": "",

  // Additional folder paths to scan alongside the primary brain folder
  "brainHub.additionalBrainPaths": [],

  // Machine name label for sessions created on this device (defaults to system hostname)
  "brainHub.machineName": "Dev-Workstation",

  // Sort criteria for the session list: "lastModified" (latest message) or "createdAt" (creation time)
  "brainHub.sessionSortBy": "lastModified",

  // Message order in transcript reader: "newestFirst" (newest on top) or "oldestFirst"
  "brainHub.messageOrder": "newestFirst",

  // Runs Git pull and push when VS Code launches
  "brainHub.autoSyncOnStartup": true,

  // Interval in minutes for background Git synchronization (0 to disable)
  "brainHub.autoSyncIntervalMinutes": 30,

  // Interval in minutes for background scanning of new chat sessions (0 to disable)
  "brainHub.backgroundScanIntervalMinutes": 5,

  // Watches the brain folder for newly created or deleted chat sessions
  "brainHub.enableRealtimeWatcher": true,

  // Runs a scan when switching focus back to this IDE window
  "brainHub.autoRefreshOnWindowFocus": true,

  // Filters the sidebar tree view by the current workspace by default
  "brainHub.filterWorkspaceByDefault": false,

  // Hides chat sessions containing 0 messages
  "brainHub.hideEmptySessions": true,

  // Reloads the reader when the active session's transcript file changes
  "brainHub.autoReloadOnLiveChat": true,

  // Default collapse state for tool execution details: "collapsed" or "expanded"
  "brainHub.defaultToolsState": "collapsed",

  // Default collapse state for AI execution steps: "collapsed" or "expanded"
  "brainHub.defaultAiStepsState": "collapsed",

  // Default expansion behavior for time groups: "smart", "allExpanded", or "collapsed"
  "brainHub.defaultGroupExpansion": "smart",

  // Maximum number of items indexed for Quick Search
  "brainHub.maxQuickSearchItems": 100,

  // Opens the Dashboard when clicking the Antigravity Activity Bar icon
  "brainHub.autoOpenDashboardOnSidebarFocus": true,

  // Mode when archiving workspace documentation: "askEachTime", "safeDocsOnly", or "fullWithSanitization"
  "brainHub.archiver.defaultMode": "askEachTime",

  // Appends .docs/logs/ and .docs/scratch/ to .gitignore when archiving
  "brainHub.archiver.autoGitignore": true,

  // Detects and masks API keys, tokens, and passwords during export or archive
  "brainHub.archiver.sanitizeSecrets": true,

  // Additional regex patterns used by the secret sanitizer
  "brainHub.archiver.customSecretPatterns": []
}
```

---

## 7. FAQ & Troubleshooting

### Q1: No sessions appear in the extension?
1. Check that your local brain folder exists:
   - **Windows**: `C:\Users\<Username>\.gemini\antigravity-ide\brain`
   - **macOS / Linux**: `~/.gemini/antigravity-ide/brain`
2. If stored in a non-default location, set `brainHub.brainPath`.
3. Check whether `brainHub.hideEmptySessions` is enabled and existing sessions have 0 recorded messages.

### Q2: How do I configure Git authentication for backup?
- **SSH**: Ensure SSH authentication is functional (`ssh -T git@github.com`). Use the SSH URL format: `git@github.com:username/repo.git`.
- **HTTPS**: Use a Personal Access Token: `https://<TOKEN>@github.com/username/repo.git`.

### Q3: Is session data sent to any third-party analytics servers?
- **No**. The extension runs locally. Git operations communicate exclusively with the remote URL you configure.

### Q4: How do I render Mermaid diagrams in a Markdown file?
Right-click the file in Explorer and select **Brain Hub: Open Rich Markdown Preview**. Code blocks tagged with `mermaid` are parsed and drawn.

### Q5: How does Mermaid auto-sanitization prevent rendering errors?
When chat transcripts contain Mermaid code generated by AI models, special characters (like colons, brackets, or unescaped comparison operators) often break Mermaid's syntax parser. `MermaidSanitizer` intercepts diagram definitions before rendering, wraps unquoted node labels in double quotes, escapes HTML entities in edge labels, and quotes subgraph titles so that diagrams render reliably.
