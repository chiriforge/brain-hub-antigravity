# Architecture & Developer Guide
## Brain Hub for Antigravity for VS Code & Antigravity IDE

This document details the software architecture, internal subsystems, data structures, and development guidelines for **Brain Hub for Antigravity**.

---

## Table of Contents
1. [High-Level Architecture](#1-high-level-architecture)
2. [Project Directory Layout](#2-project-directory-layout)
3. [Core Subsystems & Implementation Details](#3-core-subsystems--implementation-details)
   - [3.1. Storage Engine & Session Layout](#31-storage-engine--session-layout)
   - [3.2. SessionScanner & Persistent Index Caching Engine](#32-sessionscanner--persistent-index-caching-engine)
   - [3.3. GitSyncService & Multi-Device Synchronization](#33-gitsyncservice--multi-device-synchronization)
   - [3.4. MarkdownRenderer & Offline Formatting Engine](#34-markdownrenderer--offline-formatting-engine)
   - [3.5. MermaidSanitizer & Syntax Normalization](#35-mermaidsanitizer--syntax-normalization)
   - [3.6. SecretSanitizer & Credential Redaction Engine](#36-secretsanitizer--credential-redaction-engine)
   - [3.7. ProjectDocsArchiver & Documentation Exporter](#37-projectdocsarchiver--documentation-exporter)
   - [3.8. Webview Architecture & Real-Time Live Watchers](#38-webview-architecture--real-time-live-watchers)
   - [3.9. Sidebar TreeView Provider & Grouping Engine](#39-sidebar-treeview-provider--grouping-engine)
4. [Data Models & Type Definitions](#4-data-models--type-definitions)
5. [Contributed Commands, Keybindings & Settings](#5-contributed-commands-keybindings--settings)
6. [Development & Workflow Guidelines](#6-development--workflow-guidelines)
   - [6.1. Prerequisites & Environment Setup](#61-prerequisites--environment-setup)
   - [6.2. Build, Watch & Packaging Scripts](#62-build-watch--packaging-scripts)
   - [6.3. Debugging with Extension Host](#63-debugging-with-extension-host)
   - [6.4. Architectural Principles & Coding Standards](#64-architectural-principles--coding-standards)
7. [Extending the Extension (Step-by-Step Guide)](#7-extending-the-extension-step-by-step-guide)
8. [Future Roadmap & Extension Points](#8-future-roadmap--extension-points)

---

## 1. High-Level Architecture

The extension follows a modular, service-oriented architecture separating data persistence, file system discovery, background synchronization, sanitization, and presentation layers:

```mermaid
flowchart TD
    subgraph AntigravityStorage ["Antigravity Storage (Local Brain Directory)"]
        BrainDir["~/.gemini/antigravity-ide/brain/"]
        Transcripts["transcript.jsonl (Compact Logs)"]
        TranscriptsFull["transcript_full.jsonl (Untruncated Logs)"]
        Artifacts["implementation_plan.md / walkthrough.md"]
        ScratchDir["scratch/ (Temporary Code & Data)"]
        BrainDir --> Transcripts
        BrainDir --> TranscriptsFull
        BrainDir --> Artifacts
        BrainDir --> ScratchDir
    end

    subgraph BackendServices ["Backend Core Services (Node.js / Extension Host)"]
        Scanner["SessionScanner (Singleton)<br/>- Directory Scanning & Multi-Path<br/>- mtime Persistent Disk Cache<br/>- Multi-Process Scan Lock File<br/>- JSONL Parser & Thread Linking"]
        GitSync["GitSyncService (Singleton)<br/>- Git CLI Child Process Execution<br/>- Background Pull & Push Sync<br/>- Machine Identification Tagging"]
        Renderer["MarkdownRenderer<br/>- Marked.js Parsing Engine<br/>- KaTeX Math Parser<br/>- Highlight.js Syntax Highlighter<br/>- GitHub Alert Callout Containers"]
        MermaidSan["MermaidSanitizer<br/>- Syntax Normalization<br/>- Node Label Wrapping<br/>- Edge Label Escaping"]
        SecretSan["SecretSanitizer<br/>- Credential Detection Engine<br/>- Built-in RegEx Redaction Rules<br/>- User-Defined Patterns"]
        Archiver["ProjectDocsArchiver<br/>- Workspace .docs/ Exporter<br/>- Multi-Level Security Modes<br/>- Automated .gitignore Protection"]
        Exporter["MarkdownExporter<br/>- Markdown File Serialization<br/>- Batch Workspace Export Engine"]
    end

    subgraph PresentationUI ["Presentation & UI Layer (VS Code)"]
        TreeProvider["ChatHistoryTreeProvider<br/>- Activity Bar TreeView<br/>- Dynamic Time Bucketing<br/>- Smart Collapsible Groups<br/>- Session Metadata Badges"]
        Dashboard["DashboardWebviewPanel<br/>- Master-Detail Split View<br/>- In-Session Search & Filter<br/>- Webview Settings Modal<br/>- Live fs.watch Auto-Reload"]
        ChatReader["ChatWebviewPanel<br/>- Standalone Session Tab<br/>- Collapsible Thinking & Tool Blocks<br/>- Raw Payload Inspector"]
        MdPreview["MarkdownPreviewWebviewPanel<br/>- Standalone Markdown Preview<br/>- KaTeX & Mermaid Rendering<br/>- Live Disk Change Reload"]
        StatusBar["VS Code Status Bar Item<br/>- Git Sync State & Trigger"]
    end

    Transcripts --> Scanner
    Artifacts --> Scanner
    BrainDir --> GitSync
    GitSync --> BrainDir

    Scanner --> TreeProvider
    Scanner --> Dashboard
    Scanner --> ChatReader
    Scanner --> Archiver

    Renderer --> Dashboard
    Renderer --> ChatReader
    Renderer --> MdPreview

    MermaidSan --> Renderer
    SecretSan --> Exporter
    SecretSan --> Archiver

    Exporter --> Dashboard
    Exporter --> ChatReader
    Exporter --> Archiver

    GitSync -.->|"onDidSync Event"| TreeProvider
    GitSync -.->|"onDidSync Event"| Dashboard
    GitSync -.-> StatusBar
```

### Component Roles & Data Flow

1. **Storage Layer**: DeepMind Antigravity IDE writes execution trajectories and task artifacts locally to disk under the `.gemini/antigravity-ide/brain/` directory.
2. **Scanner Layer (`SessionScanner`)**: Discovers directories, enforces an inter-process scan lock, reads modified `transcript.jsonl` files incrementally, maintains an `mtime`-indexed JSON cache on disk, and builds conversation thread trees.
3. **Synchronization Layer (`GitSyncService`)**: Wraps the native Git CLI to commit, rebase-pull, and push session files between the local `brain/` directory and a remote backup repository.
4. **Sanitization Layer (`SecretSanitizer` & `MermaidSanitizer`)**: Strips secrets (API keys, private keys, database connection strings) from exported files and normalizes malformed Mermaid diagram syntax.
5. **Presentation Layer**: Renders UI via VS Code's `TreeDataProvider` (Activity Bar) and custom Webview panels (Dashboard, Session Reader, Markdown Preview).

---

## 2. Project Directory Layout

```text
brain-hub-antigravity/
├── .vscode/                               # VS Code workspace configurations
│   ├── launch.json                        # Debug launch targets (Run Extension)
│   ├── settings.json                      # Workspace-specific linting & format rules
│   └── tasks.json                         # Build & watch compilation tasks
├── media/                                 # Static webview assets & extension icons
│   ├── icon.svg                           # Vector icon for Activity Bar and tabs
│   └── icon.png                           # Bitmap icon for Marketplace packaging
├── scripts/                               # Maintenance & release automation
│   └── release.js                         # Git tag verification and packaging script
├── src/                                   # TypeScript source code
│   ├── extension.ts                       # Extension entry point, lifecycle & command registration
│   ├── models/
│   │   └── types.ts                       # Domain models, data contracts, and type definitions
│   ├── providers/
│   │   └── ChatHistoryTreeProvider.ts     # TreeDataProvider implementation for Sidebar view
│   ├── services/
│   │   ├── GitSyncService.ts              # Git CLI child process manager & background sync daemon
│   │   ├── HighlightStyles.ts             # Embedded Highlight.js CSS theme
│   │   ├── KaTeXBaseCss.ts                # Embedded base font declarations for KaTeX
│   │   ├── KaTeXStyles.ts                 # Embedded KaTeX layout stylesheet
│   │   ├── MarkdownExporter.ts            # Markdown serialization & batch workspace exporter
│   │   ├── MarkdownRenderer.ts            # Marked.js, KaTeX, highlight.js, and alert containers
│   │   ├── MermaidSanitizer.ts            # Regex parser for Mermaid syntax normalization
│   │   ├── ProjectDocsArchiver.ts         # Exporter for workspace .docs/ directory & TIMELINE.md
│   │   ├── SecretSanitizer.ts             # Regex-based credential detection & redaction engine
│   │   └── SessionScanner.ts              # Session discovery, mtime caching, scan locks, threads
│   └── views/
│       ├── ChatWebviewPanel.ts            # Standalone single-session transcript viewer
│       ├── DashboardWebviewPanel.ts       # Full-page Master-Detail dashboard & settings modal
│       └── MarkdownPreviewWebviewPanel.ts # Standalone Markdown preview with KaTeX & Mermaid
├── esbuild.js                             # Esbuild bundling configuration
├── package.json                           # Extension manifest, contributes, commands, configurations
├── sonar-project.properties               # SonarQube static code analysis configuration
├── tsconfig.json                          # TypeScript compiler options
├── README.md                              # Main documentation (English)
├── README_VI.md                           # Main documentation (Vietnamese)
├── USER_GUIDE.md                          # End-user guide (English)
├── USER_GUIDE_VI.md                       # End-user guide (Vietnamese)
└── ARCHITECTURE.md                        # Architecture & developer guide (This document)
```

---

## 3. Core Subsystems & Implementation Details

### 3.1. Storage Engine & Session Layout

DeepMind Antigravity stores conversation data locally on the host filesystem:
- **Windows**: `C:\Users\<User>\.gemini\antigravity-ide\brain\<sessionId>`
- **macOS / Linux**: `~/.gemini/antigravity-ide/brain/<sessionId>`

Additional paths can be configured through `brainHub.additionalBrainPaths` to aggregate sessions from secondary repositories or external sync directories.

#### Session Directory Layout:
```text
<brainDir>/<sessionId>/
├── .system_generated/
│   └── logs/
│       ├── transcript.jsonl          # Step-by-step compact JSONL transcript
│       └── transcript_full.jsonl     # Complete untruncated transcript log
├── implementation_plan.md            # [Optional] Planning artifact generated by agent
├── walkthrough.md                    # [Optional] Verification & walkthrough artifact
├── metadata.json                     # [Optional] Session metadata
├── scratch/                          # [Optional] Intermediate scripts & test payloads
└── tempmediaStorage/                 # [Optional] Generated or uploaded image files
```

#### Log Record Schema (`transcript.jsonl`):
Each line in `transcript.jsonl` is a single JSON object structured as:
```json
{
  "step_index": 0,
  "source": "USER_EXPLICIT",
  "type": "USER_INPUT",
  "content": "User prompt text here...",
  "tool_calls": []
}
```

Key fields:
- `step_index`: Sequential integer index of the action in the trajectory.
- `source`: Originator (`'USER_EXPLICIT'`, `'MODEL'`, `'SYSTEM'`).
- `type`: Step classification (`'USER_INPUT'`, `'PLANNER_RESPONSE'`, `'SUBAGENT_NOTIFICATION'`, `'CHECKPOINT'`, `'CONVERSATION_HISTORY'`, `'KNOWLEDGE_ARTIFACTS'`, `'RUN_COMMAND'`, `'CODE_ACTION'`).
- `content`: Raw text content or system instruction payload.
- `tool_calls`: Array of executed tools with arguments, status, exit codes, and output payloads.

#### Runtime Classification:
`SessionScanner` inspects session environment parameters and paths to classify sessions into:
- `IDE`: Launched from the Antigravity IDE extension host.
- `CLI`: Launched from the `agy` command-line interface.
- `Desktop`: Launched from the standalone desktop application wrapper.
- `Custom`: User-defined or unrecognized runtime environment.

---

### 3.2. SessionScanner & Persistent Index Caching Engine

Located in [`src/services/SessionScanner.ts`](./src/services/SessionScanner.ts).

#### Design Pattern:
Singleton accessed via `SessionScanner.getInstance()`.

#### Scanning Lifecycle & Cache Invalidation:
```mermaid
sequenceDiagram
    autonumber
    participant Watcher as "FSWatcher / Timer / User"
    participant Scanner as "SessionScanner"
    participant Lock as "Lock File (sessions_scan.lock)"
    participant Disk as "Disk Storage (.gemini/.../brain)"
    participant Cache as "Disk Cache (sessions_index_cache.json)"
    participant UI as "UI (TreeView & Dashboard)"

    Watcher->>Scanner: "scanSessions(forceRescan)"
    Scanner->>Lock: "acquireScanLock(ttlMs=15000)"
    alt "Lock active by another process"
        Lock-->>Scanner: "Lock denied"
        Scanner->>Cache: "loadCacheFromDisk()"
        Cache-->>Scanner: "Return cached metadata"
        Scanner-->>UI: "Render cached sessions"
    else "Lock acquired"
        Lock-->>Scanner: "Lock granted"
        Scanner->>Disk: "Read directories & check mtime"
        loop "For each session folder"
            alt "Folder mtime and file size match cache"
                Scanner->>Cache: "Reuse cached ChatSession"
            else "mtime changed or new session"
                Scanner->>Disk: "Read transcript.jsonl stream"
                Scanner->>Scanner: "Parse metadata & link threads"
                Scanner->>Cache: "Update cache entry"
            end
        end
        Scanner->>Cache: "saveCacheToDiskDebounced(800ms)"
        Scanner->>Lock: "releaseScanLock()"
        Scanner-->>UI: "Emit onSessionsDataChanged"
    end
```

#### Key Implementation Details:
1. **Persistent Disk Cache (`sessions_index_cache.json`)**:
   - Stored in `context.globalStorageUri` to isolate extension cache from user repositories.
   - Cache keys map directory paths to `{ session: ChatSession, mtime: number, fileMtime: number, fileSize: number, targetFilePath: string }`.
   - On scans, files whose `mtime` and `fileSize` match existing cache entries are returned directly without reading or parsing JSONL streams.
   - Cache writes are debounced with an 800ms window (`saveCacheToDiskDebounced`) to consolidate rapid modifications.
2. **Scan Lock (`sessions_scan.lock`)**:
   - Multi-window IDE environments can trigger concurrent scans.
   - `acquireScanLock(ttlMs = 15000)` creates a JSON lock file containing `{ pid: process.pid, timestamp, expiresAt }`.
   - If a valid lock from another process exists, the scanner skips disk directory reads and serves data from the shared disk cache.
3. **Thread Linking**:
   - Identifies subagent sessions by evaluating `sessionOriginId` and `parentId` in logs.
   - Assembles tree relationships (`ConversationThread`), populating `childIds` and `rootId` on the parent session.
4. **Empty Session Detection & Pruning**:
   - `findEmptySessionDirs()` finds session directories where `transcript.jsonl` does not exist or contains 0 user prompts.
   - `cleanEmptySessions()` deletes detected empty directories from disk.
   - `deleteSession(sessionId)` removes an individual session directory and purges its memory and disk cache entries.
5. **Real-Time Directory Monitoring**:
   - `startRealtimeWatcher()` attaches non-recursive `fs.watch` listeners on primary and configured secondary brain folders.
   - Change events trigger a debounced rescan (`scanSessions(false)`), updating UI components automatically.

---

### 3.3. GitSyncService & Multi-Device Synchronization

Located in [`src/services/GitSyncService.ts`](./src/services/GitSyncService.ts).

#### Design Pattern:
Singleton accessed via `GitSyncService.getInstance()`.

#### Execution Mechanism:
- Interacts with Git through `child_process.execFile` calls inside the configured brain root directory.
- Commit messages follow the convention: `Auto-sync: <machineName> at <ISO Timestamp>`.
- Remote reconciliation uses `git pull --rebase` followed by `git push` to maintain linear commit history across devices.

#### Concurrency & Safety Controls:
- **Mutex Guard (`isSyncing`)**: Prevents concurrent execution of background sync timers and user-initiated sync commands.
- **Status Reporting (`getStatus()`)**: Verifies repository existence, active branch name, remote URL, and uncommitted file count.
- **Event Bus (`onDidSync`)**: Fires after successful synchronization cycles to notify `ChatHistoryTreeProvider`, `DashboardWebviewPanel`, and the status bar item.

---

### 3.4. MarkdownRenderer & Offline Formatting Engine

Located in [`src/services/MarkdownRenderer.ts`](./src/services/MarkdownRenderer.ts).

#### Key Components:
- **Offline Delivery**: Operates without external CDN dependencies. All scripts and stylesheets are bundled into the extension bundle.
- **Marked.js Engine**: Configured with GitHub Flavored Markdown (GFM), table parsing, and syntax wrapping.
- **Mathematical Typesetting (KaTeX)**:
  - Parses inline math (`$...$`) and block equations (`$$...$$`).
  - KaTeX CSS and font declarations are embedded locally via [`KaTeXStyles.ts`](./src/services/KaTeXStyles.ts) and [`KaTeXBaseCss.ts`](./src/services/KaTeXBaseCss.ts).
- **Syntax Highlighting (Highlight.js)**:
  - Code blocks are tokenized using Highlight.js.
  - Theme styling is supplied via [`HighlightStyles.ts`](./src/services/HighlightStyles.ts).
- **GitHub Alert Callouts**:
  - Replaces `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, and `[!CAUTION]` markers with structured callout containers containing VS Code Codicon SVGs.
- **Interactive Code Blocks**:
  - Injects copy-to-clipboard buttons and language badges directly into rendered `<pre><code>` structures.

---

### 3.5. MermaidSanitizer & Syntax Normalization

Located in [`src/services/MermaidSanitizer.ts`](./src/services/MermaidSanitizer.ts).

#### Problem Addressed:
Mermaid.js throws unhandled parse exceptions when diagram node labels or edge labels contain unescaped characters (colons, arrows, parentheses, comparison operators, ampersands, or slashes) without explicit double quotes.

#### Normalization Pipeline:
1. **Header Protection**: Bypasses diagram type declarations (`graph`, `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, etc.) and styling lines (`classDef`, `style`, `linkStyle`).
2. **Edge Label Sanitization**: Normalizes labels inside `|...|`, converting unescaped HTML entities:
   - `<` $\rightarrow$ `&lt;`
   - `>` $\rightarrow$ `&gt;`
   - `&` $\rightarrow$ `&amp;`
3. **Subgraph Title Normalization**: Wraps titles containing special characters in double quotes: `subgraph "Clean Title"`.
4. **Node Label Enclosure**: Automatically encloses unquoted labels across diagram node shapes:
   - Square brackets: `id[label]` $\rightarrow$ `id["label"]`
   - Rounded parentheses: `id(label)` $\rightarrow$ `id("label")`
   - Circles: `id((label))` $\rightarrow$ `id(("label"))`
   - Databases: `id[(label)]` $\rightarrow$ `id[("label")]`
   - Hexagons: `id{{label}}` $\rightarrow$ `id{{"label"}}`
   - Rhombuses: `id{label}` $\rightarrow$ `id{"label"}`
   - Asymmetric shapes: `id>label]` $\rightarrow$ `id>"label"]`

---

### 3.6. SecretSanitizer & Credential Redaction Engine

Located in [`src/services/SecretSanitizer.ts`](./src/services/SecretSanitizer.ts).

#### Purpose:
Inspects prompts, AI responses, terminal logs, and tool execution payloads to redact sensitive credentials before exporting or archiving to public or shared locations.

#### Built-in Detection Rules:
| Category | Pattern Target | Replacement Token |
|---|---|---|
| **Private Keys** | `-----BEGIN * PRIVATE KEY-----` blocks | `[REDACTED_PRIVATE_KEY_BLOCK]` |
| **Google API Keys** | `AIza[0-9A-Za-z-_]{30,45}` | `[REDACTED_GOOGLE_API_KEY]` |
| **OpenAI API Keys** | `sk-[a-zA-Z0-9]{20,}` and `sk-proj-[a-zA-Z0-9-_]{20,}` | `[REDACTED_OPENAI_API_KEY]` |
| **Anthropic API Keys** | `sk-ant-[a-zA-Z0-9-_]{20,}` | `[REDACTED_ANTHROPIC_API_KEY]` |
| **AWS Access Keys** | `(AKIA\|ABIA\|ACCA\|ASIA)[0-9A-Z]{16}` | `[REDACTED_AWS_ACCESS_KEY_ID]` |
| **GitHub Tokens** | `ghp_`, `github_pat_`, `gho_`, `ghs_` | `[REDACTED_GITHUB_TOKEN]` |
| **GitLab Tokens** | `glpat-[a-zA-Z0-9_-]{20,}` | `[REDACTED_GITLAB_TOKEN]` |
| **Slack Tokens** | `xox[baprs]-[0-9a-zA-Z]{10,}-...` | `[REDACTED_SLACK_TOKEN]` |
| **Stripe Keys** | `(?:sk\|rk)_(?:live\|test)_[0-9a-zA-Z]{24,}` | `[REDACTED_STRIPE_KEY]` |
| **JSON Web Tokens** | `eyJ[a-zA-Z0-9_-]{10,}\.eyJ...` | `[REDACTED_JWT_TOKEN]` |
| **Auth Headers** | `Authorization: Bearer <token>` | `Authorization: Bearer [REDACTED_AUTH_TOKEN]` |
| **Database URIs** | `protocol://user:password@host:port/db` | `protocol://[USER]:[REDACTED_PASSWORD]@host` |
| **CLI Parameters** | `--password <val>`, `-p <val>`, `apikey=<val>` | `--password [REDACTED_SECRET]` |

User-defined regular expressions can be added via the configuration setting `brainHub.archiver.customSecretPatterns`.

---

### 3.7. ProjectDocsArchiver & Documentation Exporter

Located in [`src/services/ProjectDocsArchiver.ts`](./src/services/ProjectDocsArchiver.ts).

#### Archival Pipeline:
```mermaid
flowchart TD
    Start["Trigger: brainHub.exportProjectDocs"] --> ModeSelect{"Select Archiver Mode"}
    ModeSelect -->|"safeDocsOnly"| SafeConfig["Mode: Safe Architecture Docs Only<br/>- Skip raw transcripts<br/>- Skip scratch directory"]
    ModeSelect -->|"fullWithSanitization"| SanConfig["Mode: Full Archive with Sanitization<br/>- Sanitize API keys & passwords<br/>- Add .docs/logs/ & scratch to .gitignore"]
    ModeSelect -->|"fullRaw"| RawConfig["Mode: Full Raw Archive<br/>- Export raw transcripts<br/>- Add .docs/logs/ & scratch to .gitignore"]

    SafeConfig --> ScannerCall["SessionScanner: Query sessions for active workspace"]
    SanConfig --> ScannerCall
    RawConfig --> ScannerCall

    ScannerCall --> CopyArtifacts["Copy artifacts to .docs/<br/>- Plans -> .docs/plans/<br/>- Walkthroughs -> .docs/walkthroughs/<br/>- Diagrams -> .docs/diagrams/<br/>- Media -> .docs/media/"]

    CopyArtifacts --> CheckMode{"Mode includes logs?"}
    CheckMode -->|"No (safeDocsOnly)"| GenTimelineSafe["Generate TIMELINE.md & INDEX.md"]
    CheckMode -->|"Yes"| SanitizeLogs["Process transcripts via SecretSanitizer & MarkdownExporter"]
    SanitizeLogs --> WriteLogs["Write session logs to .docs/logs/"]
    WriteLogs --> CopyScratch["Copy .docs/scratch/ files"]
    CopyScratch --> GitIgnore["Update .gitignore with .docs/logs/ and .docs/scratch/"]
    GitIgnore --> GenTimelineFull["Generate TIMELINE.md & INDEX.md with log links"]

    GenTimelineSafe --> Done["Complete: Prompt user to open folder or view INDEX.md"]
    GenTimelineFull --> Done
```

#### Security Modes:
1. `safeDocsOnly`: Copies plans (`.docs/plans/`), walkthroughs (`.docs/walkthroughs/`), diagrams (`.docs/diagrams/`), research files (`.docs/research/`), and media (`.docs/media/`). Completely ignores `transcript.jsonl` and `scratch/` files to eliminate credential exposure risks in shared Git repositories.
2. `fullWithSanitization`: Copies all artifacts and processes session logs through `SecretSanitizer`. Automatically adds `.docs/logs/` and `.docs/scratch/` to the workspace `.gitignore`.
3. `fullRaw`: Copies all files including unmodified transcripts and scratch directories, with `.gitignore` protection.

#### Documentation Catalogs:
- **`INDEX.md`**: Categorized navigation table organizing plans, walkthroughs, diagrams, and logs with dates and goals.
- **`TIMELINE.md`**: Chronological table indexing all sessions with timestamp, session ID, objective, message count, prompt count, and tool execution metrics.

---

### 3.8. Webview Architecture & Real-Time Live Watchers

The extension provides three distinct webview panels, each optimized for a specific workflow:

#### 1. `DashboardWebviewPanel` ([`src/views/DashboardWebviewPanel.ts`](./src/views/DashboardWebviewPanel.ts)):
- **Master-Detail Layout**: Left panel renders the categorized session list; right panel renders the selected conversation transcript.
- **Filtering & Search**: Client-side full-text search across session IDs, titles, prompt text, and message content. Quick-toggle filters for current workspace and hiding empty sessions.
- **Settings Modal**: In-webview configuration modal for modifying sort order, tool default state, auto-sync intervals, and archiver defaults without navigating to VS Code settings.
- **Live FSWatcher**: Attaches an `fs.watch` instance to the active session's `transcript.jsonl`. When new assistant steps or user prompts are written by Antigravity, the webview reloads incrementally with a debounce delay.

#### 2. `ChatWebviewPanel` ([`src/views/ChatWebviewPanel.ts`](./src/views/ChatWebviewPanel.ts)):
- Standalone reader tab for a single conversation trajectory.
- Collapsible accordions for thinking tokens (`Thinking`), autonomous execution loops (`AI Steps`), and tool calls (`Tools`).
- Raw payload viewer for inspecting API responses and tool arguments.

#### 3. `MarkdownPreviewWebviewPanel` ([`src/views/MarkdownPreviewWebviewPanel.ts`](./src/views/MarkdownPreviewWebviewPanel.ts)):
- Standalone rich Markdown preview panel triggered by `brainHub.openRichMarkdownPreview`.
- Renders Markdown documents containing KaTeX math equations, syntax-highlighted code blocks, and sanitized Mermaid diagrams.
- Monitors the displayed file with an `fs.watch` listener to re-render upon external file modifications.

#### Webview Communication Protocol:
- **Webview to Host**: Sends structured messages via `vscode.postMessage({ command: '...', ... })`.
- **Host to Webview**: Receives messages via `panel.webview.onDidReceiveMessage`, performs background I/O, and posts responses back through `panel.webview.postMessage({ command: '...', ... })`.

---

### 3.9. Sidebar TreeView Provider & Grouping Engine

Located in [`src/providers/ChatHistoryTreeProvider.ts`](./src/providers/ChatHistoryTreeProvider.ts).

#### Grouping Logic:
Implements `vscode.TreeDataProvider<SessionTreeItem | TimeGroupTreeItem>`. Categorizes sessions into chronological buckets based on last modified date or creation date:
- `today`: From midnight today to current time.
- `yesterday`: From midnight yesterday to midnight today.
- `week`: From 7 days ago to yesterday.
- `older`: Older than 7 days.

#### Smart Expansion Strategy (`brainHub.defaultGroupExpansion`):
- `smart` (default): Expands `Today` and `Yesterday`. If both buckets are empty, it automatically expands the most recent populated bucket (`Previous 7 Days` or `Older`).
- `allExpanded`: Forces all populated time group nodes to expand.
- `collapsed`: Collapses all time group nodes.

#### Visual Indicators & Badges:
- Tree items display message count badges and machine identification tags.
- Context icons highlight artifacts (`ThemeIcon('book')` for implementation plans, `ThemeIcon('check')` for walkthroughs).
- Tree view header description updates dynamically with active workspace and sync time: `📁 <workspaceName> | 🔄 Sync: <time>`.

---

## 4. Data Models & Type Definitions

Located in [`src/models/types.ts`](./src/models/types.ts):

```typescript
export interface ToolCallInfo {
  name: string;
  args?: Record<string, any> | string;
  status?: string;
  exitCode?: number;
  output?: string;
  description?: string;
}

export interface ChatMessage {
  index: number;
  userIndex?: number;
  source: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM' | string;
  type:
    | 'USER_INPUT'
    | 'PLANNER_RESPONSE'
    | 'SUBAGENT_NOTIFICATION'
    | 'CHECKPOINT'
    | 'CONVERSATION_HISTORY'
    | 'KNOWLEDGE_ARTIFACTS'
    | 'RUN_COMMAND'
    | 'CODE_ACTION'
    | string;
  status?: string;
  content: string;
  cleanContent: string;
  systemPayloads?: string[];
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  mediaAttachments?: string[];
  createdAt?: string;
  timestamp?: Date;
  truncatedFields?: string[];
  sessionOriginId?: string;
}

export interface ChatSession {
  id: string;
  path: string;
  title: string;
  firstPrompt: string;
  allPrompts?: string[];
  searchKeywords?: string;
  lastModified: Date;
  createdAt?: Date;
  messageCount: number;
  userPromptCount: number;
  workspaceName?: string;
  workspacePath?: string;
  machineName?: string;
  hasArtifacts: boolean;
  planPath?: string;
  walkthroughPath?: string;
  parentId?: string;
  rootId?: string;
  childIds?: string[];
  threadTitle?: string;
  isEmpty?: boolean;
  runtime?: 'IDE' | 'CLI' | 'Desktop' | 'Custom';
}

export interface ConversationThread {
  id: string;
  title: string;
  sessions: ChatSession[];
  lastModified: Date;
  totalMessages: number;
}

export type TimeGroupKey = 'today' | 'yesterday' | 'week' | 'older';

export interface TimeGroup {
  key: TimeGroupKey;
  label: string;
  icon: string;
  sessions: ChatSession[];
}

export interface SearchResultItem {
  session: ChatSession;
  matchSnippet: string;
  matchedField: 'title' | 'prompt' | 'content' | 'id';
}

export type ArchiverMode = 'safeDocsOnly' | 'fullWithSanitization' | 'fullRaw';

export interface ArchiverOptions {
  mode?: ArchiverMode;
  autoGitignore?: boolean;
  sanitizeSecrets?: boolean;
  customSecretPatterns?: string[];
}
```

---

## 5. Contributed Commands, Keybindings & Settings

### Contributed Commands:

| Command ID | Title | Default Location |
|---|---|---|
| `brainHub.openDashboard` | Open Dashboard | Activity Bar title, Command Palette |
| `brainHub.searchChat` | Search Chat History... | View title, Command Palette |
| `brainHub.openSettings` | Open Settings | View title, Command Palette |
| `brainHub.syncNow` | Sync with GitHub (Pull & Push) | View title, Status Bar, Command Palette |
| `brainHub.setupGitSync` | Setup GitHub Backup Repository... | View title menu, Command Palette |
| `brainHub.checkGitStatus` | Check GitHub Sync Status | View title menu, Command Palette |
| `brainHub.refresh` | Scan and Refresh Sessions from Disk | View title, Command Palette |
| `brainHub.toggleWorkspaceFilter` | Filter Chat History by Current Workspace | View title, Command Palette |
| `brainHub.toggleHideEmptySessions` | Toggle Hide Empty Chats (0-message sessions) | View title, Command Palette |
| `brainHub.cleanEmptySessions` | Clean Empty Chat Sessions (0 messages) | View title menu, Command Palette |
| `brainHub.exportProjectDocs` | Archive Project Docs & Logs (.docs/) | View title menu, Command Palette |
| `brainHub.exportAllWorkspaceSessions` | Batch Export Workspace Sessions to Markdown... | View title menu, Command Palette |
| `brainHub.openChat` | Open Chat | Session item inline, Context menu |
| `brainHub.copyResumePrompt` | Copy Resume Prompt | Session context menu |
| `brainHub.copySessionId` | Copy Session ID | Session context menu |
| `brainHub.exportMarkdown` | Export to Markdown (.md) | Session context menu |
| `brainHub.openFolder` | Open Session Folder in Explorer | Session context menu |
| `brainHub.deleteSession` | Delete Chat Session | Session context menu |
| `brainHub.openRichMarkdownPreview` | Open Rich Markdown Preview (Mermaid & KaTeX) | Explorer context menu, Editor title |
| `brainHub.openIdeMarkdownPreview` | Open with IDE Built-in Markdown Preview | Command Palette |

### Default Keybindings:

| Shortcut (Windows / Linux) | Shortcut (macOS) | Command ID | Action |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `brainHub.openDashboard` | Opens the Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `brainHub.searchChat` | Focuses the Quick Search input |

### Configuration Properties (`brainHub.*`):

| Property | Type | Default | Description |
|---|---|---|---|
| `brainHub.brainPath` | `string` | `""` | Primary path to Antigravity brain directory (defaults to `~/.gemini/antigravity-ide/brain`). |
| `brainHub.additionalBrainPaths` | `string[]` | `[]` | Additional folders to scan and merge alongside the primary directory. |
| `brainHub.machineName` | `string` | `""` | Machine name label for sessions created on this host (defaults to hostname). |
| `brainHub.sessionSortBy` | `enum` | `"lastModified"` | Sorting criterion: `"lastModified"` (latest activity) or `"createdAt"` (session creation time). |
| `brainHub.messageOrder` | `enum` | `"newestFirst"` | Message ordering in viewer: `"newestFirst"` or `"oldestFirst"`. |
| `brainHub.autoSyncOnStartup` | `boolean` | `true` | Runs Git synchronization on startup. |
| `brainHub.autoSyncIntervalMinutes` | `number` | `30` | Interval in minutes for background Git sync (set to `0` to disable). |
| `brainHub.backgroundScanIntervalMinutes` | `number` | `5` | Interval in minutes for background folder scan (set to `0` to disable). |
| `brainHub.enableRealtimeWatcher` | `boolean` | `true` | Attaches a file system watcher on the brain folder to detect added/deleted sessions. |
| `brainHub.autoRefreshOnWindowFocus` | `boolean` | `true` | Refreshes session index when IDE window regains focus. |
| `brainHub.filterWorkspaceByDefault` | `boolean` | `false` | Filters sessions by the active workspace upon startup. |
| `brainHub.hideEmptySessions` | `boolean` | `true` | Hides sessions containing 0 messages. |
| `brainHub.autoReloadOnLiveChat` | `boolean` | `true` | Streams updates when the active session's transcript file changes. |
| `brainHub.defaultToolsState` | `enum` | `"collapsed"` | Default expand/collapse state for tool execution output: `"collapsed"` or `"expanded"`. |
| `brainHub.defaultAiStepsState` | `enum` | `"collapsed"` | Default state for autonomous agent loops: `"collapsed"` or `"expanded"`. |
| `brainHub.defaultGroupExpansion` | `enum` | `"smart"` | Default time group expansion behavior: `"smart"`, `"allExpanded"`, or `"collapsed"`. |
| `brainHub.maxQuickSearchItems` | `number` | `100` | Maximum items indexed for search suggestions. |
| `brainHub.autoOpenDashboardOnSidebarFocus` | `boolean` | `true` | Automatically opens Dashboard when clicking the Activity Bar icon. |
| `brainHub.archiver.defaultMode` | `enum` | `"askEachTime"` | Archival mode: `"askEachTime"`, `"safeDocsOnly"`, or `"fullWithSanitization"`. |
| `brainHub.archiver.autoGitignore` | `boolean` | `true` | Adds `.docs/logs/` and `.docs/scratch/` to `.gitignore`. |
| `brainHub.archiver.sanitizeSecrets` | `boolean` | `true` | Redacts sensitive API keys and tokens during export. |
| `brainHub.archiver.customSecretPatterns` | `string[]` | `[]` | User-defined regex patterns for credential masking. |

---

## 6. Development & Workflow Guidelines

### 6.1. Prerequisites & Environment Setup
- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher
- **VS Code**: `v1.80.0` or higher (or Antigravity IDE)

```bash
# Clone the repository
git clone https://github.com/chiriforge/brain-hub-antigravity.git
cd brain-hub-antigravity

# Install dependencies
npm install
```

---

### 6.2. Build, Watch & Packaging Scripts

| Command | Action |
|---|---|
| `npm run compile` | Runs the TypeScript compiler (`tsc -p ./`) to validate types without bundling. |
| `npm run watch` | Watches TypeScript files and recompiles on file changes. |
| `npm run build` | Bundles and minifies code into `./dist/extension.js` via `esbuild`. |
| `npm run package` | Builds the production bundle and packages into a `.vsix` archive via `@vscode/vsce`. |
| `npm run release` | Runs `./scripts/release.js` to verify Git tag consistency and build release assets. |

#### Esbuild Configuration ([`esbuild.js`](./esbuild.js)):
```javascript
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'], // VS Code runtime API is provided by Extension Host
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: process.argv.includes('--minify')
}).catch(() => process.exit(1));
```

---

### 6.3. Debugging with Extension Host
1. Open the repository root in VS Code.
2. Open the **Run and Debug** panel (`Ctrl + Shift + D`).
3. Select **"Run Extension"** and press `F5`.
4. A new *Extension Development Host* window launches with the development extension active. Breakpoints placed in TypeScript source files under `src/` will resolve upon execution.
5. Use `Ctrl + R` within the Development Host window to reload changes after rebuilding.

---

### 6.4. Architectural Principles & Coding Standards

1. **Offline Operation & Zero Remote CDNs**:
   - All styles, font definitions, and client scripts must be bundled inside the extension package.
   - Do not load assets over HTTP/HTTPS from external CDNs.
2. **Non-Blocking Asynchronous Operations**:
   - File I/O, Git subprocesses, and JSON parsing must use asynchronous APIs or debounced timers to avoid locking the Extension Host event loop.
3. **Strict Type Safety**:
   - Explicit TypeScript types must be maintained. Avoid `any` except when handling untyped JSON parameters from dynamic tool call payloads.
4. **Webview Security & Content Security Policy (CSP)**:
   - Webview HTML must declare strict CSP metadata:
     `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'unsafe-inline';`
5. **Cross-Platform Path Compatibility**:
   - Path operations must utilize `path.join()`, `path.normalize()`, and handle both Windows backslash and POSIX forward-slash conventions.

---

## 7. Extending the Extension (Step-by-Step Guide)

### Example A: Registering a New Command
1. Declare the command in [`package.json`](./package.json) under `contributes.commands`:
   ```json
   {
     "command": "brainHub.inspectSessionMetrics",
     "category": "Brain Hub",
     "title": "Inspect Session Metrics",
     "icon": "$(graph)"
   }
   ```
2. Register the command handler in [`src/extension.ts`](./src/extension.ts):
   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand('brainHub.inspectSessionMetrics', async (item?: SessionTreeItem) => {
       const sessionId = item ? item.session.id : undefined;
       if (!sessionId) {
         return;
       }
       const sessionData = await SessionScanner.getInstance().loadFullSession(sessionId);
       if (sessionData) {
         vscode.window.showInformationMessage(
           `Session ${sessionId}: ${sessionData.messages.length} messages, ${sessionData.session.userPromptCount} prompts.`
         );
       }
     })
   );
   ```

### Example B: Handling Messages in `DashboardWebviewPanel`
1. Add an action button in the HTML rendering method inside [`src/views/DashboardWebviewPanel.ts`](./src/views/DashboardWebviewPanel.ts):
   ```html
   <button class="action-btn" onclick="requestSessionArchive('${session.id}')">
     Archive Session
   </button>
   ```
2. Add a client-side JavaScript trigger in the webview script block:
   ```javascript
   function requestSessionArchive(sessionId) {
     vscode.postMessage({ command: 'archiveSingleSession', sessionId: sessionId });
   }
   ```
3. Add a message branch in the webview message listener:
   ```typescript
   case 'archiveSingleSession':
     await this.handleSingleSessionArchive(message.sessionId);
     break;
   ```

### Example C: Adding a Custom Rule to `SecretSanitizer`
1. Define the rule in `SecretSanitizer.BUILT_IN_RULES` inside [`src/services/SecretSanitizer.ts`](./src/services/SecretSanitizer.ts):
   ```typescript
   {
     name: 'Custom Service Token',
     regex: /\bcst_[a-zA-Z0-9]{32}\b/g,
     replace: '[REDACTED_CUSTOM_SERVICE_TOKEN]'
   }
   ```

---

## 8. Future Roadmap & Extension Points

- [ ] **Local Semantic Search**: Local vector embeddings using lightweight on-device models for concept and code similarity search across sessions.
- [ ] **Custom Tagging System**: Support for user-defined tags and labels (e.g., `#architecture`, `#refactor`, `#bugfix`).
- [ ] **Trajectory Branching**: Ability to fork an existing session from a selected turn into a new trajectory.
- [ ] **PDF & Standalone HTML Export**: Standalone document export with inline styles and embedded SVG diagrams.
- [ ] **Workspace Shared Profiles**: Team configuration sharing for exclusion rules and sync repositories.

---

## Contributing

Contributions, bug reports, and pull requests are welcome on [GitHub Issues](https://github.com/chiriforge/brain-hub-antigravity/issues). Ensure all changes compile cleanly using `npm run compile` and `npm run build` prior to submitting pull requests.
