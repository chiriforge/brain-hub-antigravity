# User Guide
## Brain Hub for Antigravity for VS Code & Antigravity IDE

<p align="center">
  <a href="./USER_GUIDE.md"><b>English</b></a> | <a href="./USER_GUIDE_VI.md"><b>Tiếng Việt</b></a>
</p>

---

## Table of Contents
1. [Overview](#1-overview)
2. [Installation](#2-installation)
3. [User Interfaces](#3-user-interfaces)
   - [3.1. Brain Hub Dashboard](#31-brain-hub-dashboard)
   - [3.2. Sidebar Tree View](#32-sidebar-tree-view)
   - [3.3. Chat Reader Webview](#33-chat-reader-webview)
4. [Features in Detail](#4-features-in-detail)
   - [4.1. Search & Filtering](#41-search--filtering)
   - [4.2. Resume Conversation Prompt](#42-resume-conversation-prompt)
   - [4.3. GitHub Backup & Sync](#43-github-backup--sync)
   - [4.4. Managing Empty Sessions](#44-managing-empty-sessions)
   - [4.5. Exporting to Markdown](#45-exporting-to-markdown)
   - [4.6. Auto-Reload on Active Chat](#46-auto-reload-on-active-chat)
5. [Keybindings](#5-keybindings)
6. [Settings Reference](#6-settings-reference)
7. [FAQ & Troubleshooting](#7-faq--troubleshooting)

---

## 1. Overview

**Brain Hub for Antigravity** is an extension for **VS Code** and **Google DeepMind Antigravity IDE** designed to help developers browse, search, review, export, and synchronize their local AI conversation history stored in the `brain/` directory.

Key capabilities:
- Browse and search past conversations across sessions and workspaces.
- Copy structured resume prompts to continue workflows in new chat sessions.
- Backup and synchronize chat logs with a remote Git repository across multiple devices.
- Read conversation transcripts with Markdown formatting, LaTeX equations (KaTeX), syntax highlighting, and expandable thinking/tool execution logs.

---

## 2. Installation

### Option 1: Install from `.vsix` Package
1. Download `brain-hub-antigravity-x.x.x.vsix` from [GitHub Releases](https://github.com/hungle-vn/brain-hub-antigravity/releases).
2. In VS Code, open Extensions (`Ctrl + Shift + X`), click `...` in the top right corner, and select **Install from VSIX...**.
3. Choose the downloaded `.vsix` file.

Or run:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Option 2: Build from Source
```bash
git clone https://github.com/hungle-vn/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Press `F5` in VS Code to run the Extension Development Host.

---

## 3. User Interfaces

### 3.1. Brain Hub Dashboard
Open via command `Brain Hub for Antigravity: Open Brain Hub Dashboard` or shortcut `Ctrl + K Ctrl + D` (macOS: `Cmd + K Cmd + D`).

```text
+-------------------------------------------------------------------------------+
| Brain Hub for Antigravity [152 Sessions]         [Refresh] [Cleanup] [Sync] [Settings] |
+------------------------------------+------------------------------------------+
| [Search chats, or ID...          ] | Active Session Transcript                |
|                                    |                                          |
| [Session List]                     | USER:                                    |
|   Optimize search algorithm        |   "How do I optimize this search algo?"  |
|   14:30 | 12 msgs | Plan           |                                          |
|                                    | MODEL:                                   |
|   Fix Webview CSS Layout           |   > Thinking (12.4s) [Expand]            |
|   10:15 | 4 msgs                   |   "Here is the approach..."              |
|                                    |   ```typescript                          |
|   Write Auth Unit Tests            |   // Code block...                       |
|   Yesterday | 8 msgs | Walkthrough |   ```                                    |
|                                    |   Tool: run_command [Output]             |
+------------------------------------+------------------------------------------+
```

- **Top Bar Actions**:
  - **Toggle Sidebar**: Collapse or expand the left session navigation panel.
  - **Sync with GitHub**: Trigger Git synchronization with the configured remote.
  - **Settings (`⚙️`)**: Open visual modal to adjust configuration options.
  - **Refresh**: Rescan and reload sessions from disk.
  - **Cleanup**: Scan and delete empty session directories (0 messages).
- **Left Panel (Session List)**: Lists scanned sessions with an instant search filter input.
- **Right Panel (Transcript Reader)**: Displays the full conversation transcript for the selected session.

### 3.2. Sidebar Tree View
Located in the Activity Bar under the Antigravity icon:
- **Time Groups**: Today, Yesterday, Previous 7 Days, and Older.
- **Toolbar Actions**:
  - Open Dashboard (`$(screen-full)`)
  - Sync with GitHub (`$(cloud-upload)`)
  - Open Settings (`$(gear)`)
  - Refresh (`$(refresh)`)
  - Search Chat (`$(search)`)
  - Toggle Workspace Filter (`$(filter)`)
  - Toggle Hide Empty Sessions (`$(eye-closed)`)
- **Badges**: Indicates message count, artifacts (`Plan`, `Walkthrough`), and machine label.

### 3.3. Chat Reader Webview
- **Markdown & Math**: Parses standard Markdown and LaTeX math equations via KaTeX.
- **Code Blocks**: Formatted with syntax highlighting and a 1-click `Copy` button.
- **Alert Blocks**: Standard GitHub callout blocks (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- **Thinking Accordion**: Collapsible section containing model reasoning steps.
- **Tool Accordion**: Collapsible records of tool invocations, parameters, and terminal outputs.

---

## 4. Features in Detail

### 4.1. Search & Filtering
- **Quick Search (`Ctrl + Alt + H`)**: Opens a QuickPick input to search across all sessions by title, prompt text, or session ID.
- **Dashboard Search**: Filters the list of sessions on the Dashboard in real time as you type.
- **Sidebar Workspace Filter**: Filters sessions in the sidebar tree view to those matching the current active workspace folder.
- **In-Chat Search**: Dedicated search input at the top of the transcript viewer to find text within the active conversation.

### 4.2. Resume Conversation Prompt
When you want to continue a previous task in a new Antigravity chat:
1. Click **Resume Chat** in the Dashboard toolbar, or right-click a session in the Sidebar and select **Copy Resume Prompt**.
2. Paste into a new Antigravity chat window.
3. The prompt instructs the agent to inspect the session transcript and resume work.

### 4.3. GitHub Backup & Sync
Synchronizes chat history stored in `brain/` with a remote Git repository.

#### Setup:
1. Create a private Git repository on GitHub (e.g. `antigravity-brain-backup`).
2. Run command: `Brain Hub for Antigravity: Setup GitHub Backup Repository...`
3. Enter the Git remote URL (SSH or HTTPS).
4. The extension initializes Git in the brain folder, sets the remote, commits existing files, and pushes to GitHub.

#### Sync Behavior:
- **Startup Sync**: Pulls remote changes and pushes local sessions on extension startup.
- **Periodic Sync**: Automatically runs in the background at a configured interval (default: 30 minutes).
- **Manual Sync**: Click the status bar item `$(github) Brain Hub Sync` or the Sync button in the Dashboard.
- **Machine Identification**: Uses `machineName` to label sessions created on different devices.

### 4.4. Managing Empty Sessions
- **Hide Empty Sessions**: Automatically hides sessions that contain 0 messages. Toggle via settings or the sidebar button.
- **Clean Empty Sessions**: Run command `Brain Hub for Antigravity: Clean Up Empty Chats` to scan for and permanently delete empty session directories from disk.

### 4.5. Exporting to Markdown
- Right-click a session and select **Export to Markdown (.md)**, or click the Export button on the Dashboard.
- Saves a formatted `.md` document containing conversation metadata, prompts, model responses, and tool records.

### 4.6. Auto-Reload on Active Chat
- When viewing a session transcript in the reader, the extension watches the underlying `transcript.jsonl` file. If new messages are written to this file, the viewer reloads automatically.

---

## 5. Keybindings
 
| Shortcut (Windows/Linux) | Shortcut (macOS) | Command ID | Description |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `antigravityHistory.openDashboard` | Open Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `antigravityHistory.searchChat` | Open Quick Search across sessions |

### 5.1. Customizing or Disabling Shortcuts

Users can customize, rebind, or completely disable (clear) default shortcuts:

1. **Via VS Code UI (Recommended)**:
   - Open **Keyboard Shortcuts** (`Ctrl + K Ctrl + S` or `Cmd + K Cmd + S` on macOS).
   - Search for `antigravityHistory`.
   - **To change**: Double-click the command and press your preferred key combination.
   - **To remove/clear**: Right-click the command and select **Remove Keybinding** (or select and press `Delete`).

2. **Via `keybindings.json`**:
   - Open Command Palette (`Ctrl + Shift + P`) $\rightarrow$ `Preferences: Open Keyboard Shortcuts (JSON)`.
   - To completely disable a shortcut, prepend a hyphen `-` to the command:
     ```json
     [
       {
         "key": "ctrl+k ctrl+d",
         "command": "-antigravityHistory.openDashboard"
       },
       {
         "key": "ctrl+k ctrl+h",
         "command": "-antigravityHistory.searchChat"
       }
     ]
     ```

---

## 6. Settings Reference

Access in VS Code Settings (`Ctrl + ,` $\rightarrow$ search `antigravityHistory`):

```json
{
  // Path to Antigravity brain directory (defaults to ~/.gemini/antigravity-ide/brain)
  "antigravityHistory.brainPath": "",

  // Additional folder paths to scan alongside the primary brain folder
  "antigravityHistory.additionalBrainPaths": [],

  // Machine name label for sessions created on this device (defaults to system hostname)
  "antigravityHistory.machineName": "Work-PC",

  // Sort criteria: "lastModified" (last message time) or "createdAt" (creation time)
  "antigravityHistory.sessionSortBy": "lastModified",

  // Message order in transcript reader: "newestFirst" or "oldestFirst"
  "antigravityHistory.messageOrder": "newestFirst",

  // Automatically sync with Git remote on startup
  "antigravityHistory.autoSyncOnStartup": true,

  // Periodic Git sync interval in minutes (0 to disable)
  "antigravityHistory.autoSyncIntervalMinutes": 30,

  // Default filter state for sidebar tree view
  "antigravityHistory.filterWorkspaceByDefault": false,

  // Hide empty chat sessions with 0 messages
  "antigravityHistory.hideEmptySessions": true,

  // Reload active chat viewer when its transcript file changes
  "antigravityHistory.autoReloadOnLiveChat": true,

  // Default state for tool execution details ("collapsed" or "expanded")
  "antigravityHistory.defaultToolsState": "collapsed",

  // Default state for autonomous AI step groups ("collapsed" or "expanded")
  "antigravityHistory.defaultAiStepsState": "collapsed",

  // Automatically open Dashboard when clicking the Activity Bar icon
  "antigravityHistory.autoOpenDashboardOnSidebarFocus": true
}
```

---

## 7. FAQ & Troubleshooting

### Q1: No sessions appear in the extension?
- Verify that you have used Antigravity IDE to create conversations.
- Check if your brain directory exists:
  - Windows: `C:\Users\<Username>\.gemini\antigravity-ide\brain`
  - macOS / Linux: `~/.gemini/antigravity-ide/brain`
- If stored in a custom path, configure `antigravityHistory.brainPath`.

### Q2: How do I configure Git authentication for GitHub Sync?
- **SSH**: Ensure SSH authentication is configured with your GitHub account (`ssh -T git@github.com`), then use the SSH remote URL: `git@github.com:username/repo.git`.
- **HTTPS**: Use a Personal Access Token (PAT) format: `https://<TOKEN>@github.com/username/repo.git`.

### Q3: Is any conversation data sent to third-party analytics servers?
- No. The extension runs entirely offline on your local machine.
- Git sync operations only communicate directly with the Git remote repository you explicitly configure.
