# Hướng Dẫn Sử Dụng
## Brain Hub for Antigravity dành cho VS Code & Antigravity IDE

<p align="center">
  <a href="./USER_GUIDE.md"><b>English</b></a> | <a href="./USER_GUIDE_VI.md"><b>Tiếng Việt</b></a>
</p>

---

## Mục Lục
1. [Tổng Quan](#1-tổng-quan)
2. [Cài Đặt](#2-cài-đặt)
3. [Giao Diện Người Dùng](#3-giao-diện-người-dùng)
   - [3.1. Bảng Điều Khiển Brain Hub Dashboard](#31-bảng-điều-khiển-brain-hub-dashboard)
   - [3.2. Cây Thư Mục Sidebar](#32-cây-thư-mục-sidebar)
   - [3.3. Trình Đọc Chat Webview](#33-trình-đọc-chat-webview)
   - [3.4. Xem Trước Markdown Hỗ Trợ Mermaid & KaTeX](#34-xem-trước-markdown-hỗ-trợ-mermaid--katex)
4. [Chi Tiết Tính Năng](#4-chi-tiết-tính-năng)
   - [4.1. Tìm Kiếm & Bộ Lọc](#41-tìm-kiếm--bộ-lọc)
   - [4.2. Bộ Chuẩn Hóa Cú Pháp Mermaid (Mermaid Sanitizer)](#42-bộ-chuẩn-hóa-cú-pháp-mermaid-mermaid-sanitizer)
   - [4.3. Sao Chép Prompt Tiếp Tục Hội Thoại](#43-sao-chép-prompt-tiếp-tục-hội-thoại)
   - [4.4. Lưu Trữ Tài Liệu Dự Án (.docs/)](#44-lưu-trữ-tài-liệu-dự-án-docs)
     - [4.4.1. Các Chế Độ Lưu Trữ](#441-các-chế-độ-lưu-trữ)
     - [4.4.2. Khử Trùng Thông Tin Nhạy Cảm](#442-khử-trùng-thông-tin-nhạy-cảm)
     - [4.4.3. Cấu Hình Tự Động Cho .gitignore](#443-cấu-hình-tự-động-cho-gitignore)
   - [4.5. Xuất Hàng Loạt Phiên Chat Workspace Ra Markdown](#45-xuất-hàng-loạt-phiên-chat-workspace-ra-markdown)
   - [4.6. Sao Lưu & Đồng Bộ Bằng Git](#46-sao-lưu--đồng-bộ-bằng-git)
   - [4.7. Quản Lý Phiên Chat Rỗng](#47-quản-lý-phiên-chat-rỗng)
   - [4.8. Giám Sát File & Tự Động Cập Nhật](#48-giám-sát-file--tự-động-cập-nhật)
5. [Phím Tắt & Danh Mục Lệnh](#5-phím-tắt--danh-mục-lệnh)
   - [5.1. Phím Tắt Mặc Định](#51-phím-tắt-mặc-định)
   - [5.2. Tùy Biến Hoặc Tắt Phím Tắt](#52-tùy-biến-hoặc-tắt-phím-tắt)
   - [5.3. Bảng Danh Mục Lệnh Đầy Đủ](#53-bảng-danh-mục-lệnh-đầy-đủ)
6. [Bảng Cấu Hình Chi Tiết (Settings Reference)](#6-bảng-cấu-hình-chi-tiết-settings-reference)
7. [Câu Hỏi Thường Gặp & Xử Lý Sự Cố (FAQ)](#7-câu-hỏi-thường-gặp--xử-lý-sự-cố-faq)

---

## 1. Tổng Quan

**Brain Hub for Antigravity** là tiện ích mở rộng cho **VS Code** và **Google DeepMind Antigravity IDE** dùng để đọc và quản lý dữ liệu hội thoại cục bộ trong thư mục `brain/`.

Chức năng chính:
- **Tìm kiếm & Kiểm tra phiên**: Tìm kiếm trên toàn bộ phiên chat theo tiêu đề, ID, nội dung câu lệnh hoặc đường dẫn workspace.
- **Chuẩn hóa cú pháp Mermaid**: Tiền xử lý và sửa lỗi cú pháp sơ đồ Mermaid (tự động bọc nhãn node vào dấu nháy kép, escape entities nhãn cạnh, bọc nháy kép tiêu đề subgraph) trước khi render để tránh lỗi parser của Mermaid.js.
- **Tạo prompt tiếp tục phiên**: Sao chép nội dung định dạng chứa session ID và đường dẫn tệp transcript để dán vào khung chat Antigravity mới.
- **Lưu trữ tài liệu dự án (`.docs/`)**: Sao chép plan, walkthrough, sơ đồ và log chat vào thư mục `.docs/` của workspace, tích hợp bộ lọc che giấu thông tin nhạy cảm qua regex và cập nhật `.gitignore`.
- **Xem trước Markdown**: Mở tab hiển thị tài liệu Markdown có công thức toán LaTeX qua KaTeX và sơ đồ Mermaid.
- **Đồng bộ qua Git**: Thực thi các lệnh Git trong thư mục `brain/` cục bộ để push và pull với kho lưu trữ remote được cấu hình.

---

## 2. Cài Đặt

### Lựa chọn 1: Cài từ file `.vsix`
1. Tải file `brain-hub-antigravity-0.5.1.vsix` từ mục [Releases trên GitHub](https://github.com/chiriforge/brain-hub-antigravity/releases).
2. Trong VS Code hoặc Antigravity IDE, nhấn `Ctrl + Shift + X` để mở Extensions.
3. Nhấp vào biểu tượng menu `...` ở góc trên bên phải khung Extensions và chọn **Install from VSIX...**.
4. Chọn file `.vsix` đã tải.

Hoặc cài qua terminal:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Lựa chọn 2: Chạy từ mã nguồn
```bash
git clone https://github.com/chiriforge/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Nhấn `F5` trong VS Code để khởi chạy cửa sổ Extension Development Host.

---

## 3. Giao Diện Người Dùng

### 3.1. Bảng Điều Khiển Brain Hub Dashboard
Mở qua Command Palette (`Brain Hub for Antigravity: Open Brain Hub Dashboard`) hoặc phím tắt:
- **Windows / Linux**: `Ctrl + K Ctrl + D`
- **macOS**: `Cmd + K Cmd + D`

```text
+-----------------------------------------------------------------------------------------+
| Brain Hub for Antigravity [152 Sessions]              [Refresh] [Cleanup] [Sync] [⚙️]    |
+--------------------------------------+--------------------------------------------------+
| [Tìm kiếm phiên chat, câu lệnh...  ] | Phiên đang chọn: Xây dựng xác thực người dùng    |
| [X] Lọc Workspace      [o] Ẩn chat 0 | Đường dẫn: .../brain/a1b2c3d4/                   |
|                                      |                                                  |
| > Hôm nay (3)                        | NGƯỜI DÙNG:                                      |
|   * Xử lý lỗi JWT validation         |   "Làm sao thêm xác thực JWT kèm refresh token?" |
|     14:30 | 12 tin nhắn | Plan       |                                                  |
|   * Tối ưu kết nối Database          | MÔ HÌNH:                                         |
|     11:15 | 8 tin nhắn               |   > Suy luận (8.2 giây) [Nhấp để mở rộng]        |
|                                      |   "Dưới đây là kiến trúc khuyến nghị..."         |
| > Hôm qua (2)                        |   ```typescript                                  |
|   * Khởi tạo migration schema        |   export interface TokenPayload { ... }          |
|     Hôm qua | 15 tin nhắn | Walkthrough|   ```                                          |
|                                      |   > Công cụ: run_command (npm test) [Kết quả]    |
| v Cũ hơn (12)                        |                                                  |
+--------------------------------------+--------------------------------------------------+
```

Thành phần của Dashboard:
- **Ô tìm kiếm**: Lọc danh sách theo tiêu đề, ID, nội dung câu lệnh hoặc đường dẫn workspace.
- **Nút lọc**: Chuyển đổi giữa việc hiển thị toàn bộ hoặc chỉ các phiên thuộc workspace đang mở, và bật/tắt hiển thị phiên 0 tin nhắn.
- **Nút thao tác**: Kích hoạt đồng bộ Git thủ công, quét lại thư mục từ đĩa hoặc xóa các phiên rỗng.

### 3.2. Cây Thư Mục Sidebar
Nằm tại thanh Activity Bar dưới biểu tượng Antigravity:
- **Thanh công cụ**:
  - `$(screen-full)` Mở Dashboard
  - `$(github)` Đồng bộ Git
  - `$(gear)` Mở Cài đặt
  - `$(refresh)` Quét lại thư mục từ đĩa
  - `$(search)` Tìm kiếm nhanh
  - `$(filter)` Lọc theo Workspace
  - `$(eye-closed)` Ẩn/Hiện phiên chat 0 tin nhắn
  - `$(book)` Lưu trữ tài liệu dự án (`.docs/`)
  - `$(files)` Xuất hàng loạt phiên chat Workspace
- **Huy hiệu thông tin**: Hiển thị số lượng tin nhắn, tên máy tính và nhãn tài liệu đi kèm (`Plan`, `Walkthrough`).

### 3.3. Trình Đọc Chat Webview
- **Phân tích Markdown & Toán học**: Sử dụng thư viện `marked` kết hợp `marked-katex-extension` để hiển thị Markdown và công thức LaTeX.
- **Tô màu mã nguồn & Sao chép**: Sử dụng class của `highlight.js` và gắn sự kiện nhấp chuột để copy nội dung khối mã vào clipboard.
- **Sơ đồ Mermaid**: Tải script `mermaid.min.js` khi có khối sơ đồ chưa được render, sau đó khởi tạo và vẽ đồ thị.
- **Khối Alert**: Nhận diện cú pháp `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` và bọc trong khung định dạng tương ứng.
- **Khối thu gọn**: Tạo thẻ `<details>` cho `Thinking`, `AI Steps` và `Tools`.
- **Tìm kiếm trong hội thoại**: Ô tìm kiếm phía trên duyệt DOM và bôi đậm văn bản trùng khớp.
- **Tự động tải lại**: Khi `autoReloadOnLiveChat` là true, watcher theo dõi file `transcript.jsonl` và render lại khi file có dữ liệu mới.

### 3.4. Xem Trước Markdown Hỗ Trợ Mermaid & KaTeX
Một webview riêng biệt dùng cho các file Markdown:
- Nhấp chuột phải vào file `.md` hoặc `.markdown` trong Explorer hoặc tab soạn thảo và chọn **Brain Hub: Open Rich Markdown Preview**.
- Sử dụng chung pipeline render với trình đọc chat để hiển thị công thức KaTeX và sơ đồ Mermaid.

---

## 4. Chi Tiết Tính Năng

### 4.1. Tìm Kiếm & Bộ Lọc

| Công cụ | Phím tắt | Phạm vi | Cơ chế kỹ thuật |
|---|---|---|---|
| **Quick Search** | `Ctrl + K Ctrl + H` (`Cmd + K Cmd + H`) | Toàn cục | Gọi `vscode.window.showQuickPick` trên danh sách phiên đã cache (tối đa `maxQuickSearchItems`) |
| **Tìm kiếm trên Dashboard** | Gõ vào ô tìm kiếm | Dashboard | Lọc phía client-side bằng JavaScript trên các phần tử DOM của phiên |
| **Lọc theo Workspace** | Bấm `$(filter)` hoặc chip trên Dashboard | Sidebar / Dashboard | So khớp trường `workspacePath` của phiên với các thư mục đang mở trong VS Code |
| **Tìm kiếm trong phiên chat** | Nhập vào ô search ở đầu trình đọc | Phiên đang mở | Duyệt cây DOM và highlight văn bản trùng khớp |

### 4.2. Bộ Chuẩn Hóa Cú Pháp Mermaid (Mermaid Sanitizer)
Tiện ích chạy hàm `MermaidSanitizer.sanitize()` để tiền xử lý các khối mã sơ đồ Mermaid trước khi chuyển sang engine `mermaid.render()` trên client. Việc này ngăn ngừa các lỗi crash parser thường gặp do nhãn chứa ký tự đặc biệt hoặc các entity HTML chưa được escape:

1. **Chuẩn hóa nhãn cạnh (Edge Labels)**:
   - Nhận diện các nhãn nằm giữa cặp dấu gạch đứng (`|...|`).
   - Thay thế dấu nháy kép `"` thành dấu nháy đơn `'`.
   - Chuyển đổi các ký tự và toán tử (`&` thành `&amp;`, `<` thành `&lt;`, `>` thành `&gt;`).
2. **Chuẩn hóa tiêu đề Subgraph**:
   - Nhận diện các khai báo `subgraph Title` mà trong `Title` có chứa ký tự điều khiển (`:`, `()`, `->`, `/`, `&`, v.v.) chưa được bao trong dấu nháy kép.
   - Viết lại thành `subgraph "Title"`.
3. **Tự động bọc nhãn Node (Auto-Quoting)**:
   - Duyệt qua các dạng hình khối sơ đồ và tự động bọc nhãn bên trong vào cặp dấu nháy kép nếu chưa có:
     - Lục giác: `id{{label}}` $\rightarrow$ `id{{"label"}}`
     - Hình trụ cơ sở dữ liệu: `id[(label)]` $\rightarrow$ `id[("label")]`
     - Hình tròn: `id((label))` $\rightarrow$ `id(("label"))`
     - Khối cờ bất đối xứng: `id>label]` $\rightarrow$ `id>"label"]`
     - Hình bình hành / hình thang: `id[/label/]` $\rightarrow$ `id[/"label"/]` và `id[\label\]` $\rightarrow$ `id[\"label"\]`
     - Hình thoi điều kiện: `id{label}` $\rightarrow$ `id{"label"}`
     - Hình chữ nhật: `id[label]` $\rightarrow$ `id["label"]`
     - Hình chữ nhật bo góc: `id(label)` $\rightarrow$ `id("label")`
4. **Bảo toàn các chỉ thị cú pháp**:
   - Bỏ qua các dòng khai báo kiểu đồ thị (`graph`, `flowchart`, `sequenceDiagram`, v.v.).
   - Giữ nguyên các định nghĩa style (`classDef`, `style`, `linkStyle`, `click`) và chú thích (`%%`).

### 4.3. Sao Chép Prompt Tiếp Tục Hội Thoại
Khi muốn tiếp tục công việc của một phiên chat cũ trong phiên làm việc mới:
1. Chọn **Copy Resume Prompt** từ thanh công cụ Dashboard hoặc menu chuột phải của phiên chat.
2. Tiện ích tạo một chuỗi văn bản bao gồm:
   - Đường dẫn thư mục chứa phiên chat
   - ID của phiên chat
   - Hướng dẫn AI đọc file `transcript.jsonl` cùng các tài liệu đi kèm (`implementation_plan.md`, `walkthrough.md`)
3. Dán chuỗi văn bản này vào khung chat Antigravity mới.

### 4.4. Lưu Trữ Tài Liệu Dự Án (`.docs/`)
Lệnh: `Brain Hub for Antigravity: Archive Project Docs & Logs (.docs/)`

Sao chép các file từ thư mục brain cục bộ vào thư mục dự án trong workspace:
```text
<thư-mục-gốc-workspace>/
└── .docs/
    ├── README.md                      # Mục lục các phiên và tài liệu đã lưu
    ├── plans/                         # Các file implementation_plan.md
    ├── walkthroughs/                  # Các file walkthrough.md
    ├── logs/                          # Log hội thoại đã lọc thông tin nhạy cảm
    └── scratch/                       # Các file tạm và script phụ trợ
```

#### 4.4.1. Các Chế Độ Lưu Trữ
Được điều khiển bởi `brainHub.archiver.defaultMode`:
1. `askEachTime` *(Mặc định)*: Hiển thị hộp thoại QuickPick để người dùng lựa chọn trước khi chạy.
2. `safeDocsOnly`: Chỉ sao chép plan, walkthrough và file scratch. Bỏ qua toàn bộ transcript.
3. `fullWithSanitization`: Sao chép plan, walkthrough, scratch và xử lý nội dung transcript qua bộ lọc khử trùng dữ liệu nhạy cảm trước khi ghi ra đĩa.

#### 4.4.2. Khử Trùng Thông Tin Nhạy Cảm
Khi `brainHub.archiver.sanitizeSecrets` là `true`, class `SecretSanitizer` áp dụng các biểu thức chính quy (Regex) lên văn bản transcript để thay thế chuỗi trùng khớp thành `[REDACTED_...]`:
- Cú pháp chuẩn của API keys (OpenAI `sk-...`, Google `AIza...`, AWS access keys, GitHub tokens `ghp_...`, Anthropic `sk-ant-...`)
- Khối private key (`-----BEGIN ... PRIVATE KEY-----`)
- Chuỗi Bearer token và các mẫu mật khẩu phổ biến
- Các mẫu Regex do người dùng cấu hình trong `brainHub.archiver.customSecretPatterns`

#### 4.4.3. Cấu Hình Tự Động Cho `.gitignore`
Khi `brainHub.archiver.autoGitignore` là `true`, tiện ích kiểm tra file `.gitignore` ở thư mục gốc workspace và tự động thêm:
```gitignore
# Brain Hub for Antigravity: prevent committing raw transcripts
.docs/logs/
.docs/scratch/
```

### 4.5. Xuất Hàng Loạt Phiên Chat Workspace Ra Markdown
Lệnh: `Brain Hub: Batch Export Workspace Sessions to Markdown...`
- Lọc các phiên chat đã lưu trong cache thuộc workspace hiện tại.
- Mở hộp thoại `vscode.window.showOpenDialog` để người dùng chọn thư mục lưu.
- Dùng `MarkdownExporter` tạo mỗi phiên thành một file `.md` chứa header metadata, nội dung câu hỏi/trả lời, tham số và kết quả gọi công cụ.

### 4.6. Sao Lưu & Đồng Bộ Bằng Git
Quản lý các thao tác Git bên trong thư mục `brain/` thông qua module `child_process.exec`:

#### Thiết lập:
1. Chạy lệnh `Brain Hub: Setup GitHub Backup Repository...` hoặc nhấn **Sync** trên Dashboard.
2. Nhập URL của Git remote (SSH hoặc HTTPS).
3. Nếu thư mục brain chưa có kho Git, extension chạy lệnh `git init`.
4. Thiết lập remote qua lệnh `git remote add origin <url>` (hoặc `set-url`), sau đó tạo commit đầu tiên và push lên remote branch.

#### Hoạt động đồng bộ:
- **Khi khởi động**: Nếu `autoSyncOnStartup` là `true`, extension chạy `git pull --rebase` và `git push` khi kích hoạt.
- **Định kỳ**: Nếu `autoSyncIntervalMinutes` > 0, thiết lập bộ đếm thời gian `setInterval` để thực hiện chu kỳ sync ngầm.
- **Nhãn máy tính**: Khi ghi hoặc cập nhật file phiên chat, thông tin metadata bao gồm trường `machineName` (mặc định là `os.hostname()`).
- **Nút thanh trạng thái**: `$(github) Brain Hub Sync` hiển thị trạng thái và cho phép bấm để kích hoạt đồng bộ thủ công.

### 4.7. Quản Lý Phiên Chat Rỗng
- **Ẩn phiên 0 tin nhắn**: Khi `brainHub.hideEmptySessions` là `true`, các phiên có `messageCount === 0` bị loại khỏi kết quả trả về của `ChatHistoryTreeProvider.getChildren` và danh sách trên dashboard.
- **Xóa phiên rỗng**: Chạy lệnh `Brain Hub: Clean Empty Chat Sessions (0 messages)`. Hệ thống duyệt qua tất cả thư mục phiên trong `brain/`, kiểm tra xem file `transcript.jsonl` có 0 tin nhắn hay không và xóa thư mục bằng `fs.rmSync`.

### 4.8. Giám Sát File & Tự Động Cập Nhật
- **Watcher thời gian thực**: Khi `enableRealtimeWatcher` là `true`, một watcher `fs.watch` không đệ quy được gắn vào thư mục `brain/` để nhận diện các thư mục phiên mới tạo hoặc bị xóa, có debounce 1.5 giây.
- **Làm mới khi focus cửa sổ**: Khi `autoRefreshOnWindowFocus` là `true`, sự kiện `vscode.window.onDidChangeWindowState` kích hoạt `scanner.scanSessions()` khi thuộc tính `window.focused` chuyển thành `true`.
- **Cập nhật nội dung chat trực tiếp**: Khi `autoReloadOnLiveChat` là `true`, `ChatWebviewPanel` giám sát file `transcript.jsonl` của phiên đang xem và tải lại nội dung khi file có byte mới được ghi.

---

## 5. Phím Tắt & Danh Mục Lệnh

### 5.1. Phím Tắt Mặc Định

| Phím tắt (Windows / Linux) | Phím tắt (macOS) | Command ID | Mục đích |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `brainHub.openDashboard` | Mở Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `brainHub.searchChat` | Mở Quick Search trên toàn bộ phiên |

### 5.2. Tùy Biến Hoặc Tắt Phím Tắt
1. Mở **Keyboard Shortcuts** (`Ctrl + K Ctrl + S` hoặc `Cmd + K Cmd + S`).
2. Tìm kiếm từ khóa `brainHub`.
3. Nhấp đúp chuột để đổi tổ hợp phím hoặc nhấp chuột phải chọn **Remove Keybinding** để xóa.

Trong file `keybindings.json`:
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

### 5.3. Bảng Danh Mục Lệnh Đầy Đủ

| Command ID | Tiêu đề lệnh | Vị trí hiển thị |
|---|---|---|
| `brainHub.openDashboard` | Open Dashboard | Activity Bar, Command Palette, Phím tắt |
| `brainHub.searchChat` | Search Chat History... | Toolbar Sidebar, Command Palette, Phím tắt |
| `brainHub.openSettings` | Open Settings | Toolbar Sidebar, Header Dashboard |
| `brainHub.syncNow` | Sync with GitHub (Pull & Push) | Toolbar Sidebar, Status Bar, Dashboard |
| `brainHub.setupGitSync` | Setup GitHub Backup Repository... | Menu Sidebar, Header Dashboard |
| `brainHub.checkGitStatus` | Check GitHub Sync Status | Menu Sidebar, Command Palette |
| `brainHub.refresh` | Scan and Refresh Sessions from Disk | Toolbar Sidebar, Header Dashboard |
| `brainHub.toggleWorkspaceFilter` | Filter Chat History by Current Workspace | Toolbar Sidebar, Chip Lọc Dashboard |
| `brainHub.toggleHideEmptySessions` | Toggle Hide Empty Chats (0-message sessions) | Toolbar Sidebar, Chip Lọc Dashboard |
| `brainHub.cleanEmptySessions` | Clean Empty Chat Sessions (0 messages) | Menu Sidebar, Header Dashboard |
| `brainHub.exportMarkdown` | Export to Markdown (.md) | Menu Chuột Phải Session, Khung Đọc Chat |
| `brainHub.exportAllWorkspaceSessions` | Batch Export Workspace Sessions to Markdown... | Menu Sidebar, Command Palette |
| `brainHub.exportProjectDocs` | Archive Project Docs & Logs (.docs/) | Menu Sidebar, Command Palette |
| `brainHub.openRichMarkdownPreview` | Open Rich Markdown Preview (Mermaid & KaTeX) | Menu Chuột Phải File .md, Tiêu Đề Editor |
| `brainHub.openIdeMarkdownPreview` | Open with IDE Built-in Markdown Preview | Command Palette |
| `brainHub.openChat` | Open Chat | Nhấp đúp Session, Menu Chuột Phải |
| `brainHub.copyResumePrompt` | Copy Resume Prompt | Menu Chuột Phải Session, Toolbar Dashboard |
| `brainHub.copySessionId` | Copy Session ID | Menu Chuột Phải Session, Toolbar Dashboard |
| `brainHub.openFolder` | Open Session Folder in Explorer | Menu Chuột Phải Session |
| `brainHub.deleteSession` | Delete Chat Session | Menu Chuột Phải Session |

---

## 6. Bảng Cấu Hình Chi Tiết (Settings Reference)

Có thể điều chỉnh cấu hình trong VS Code Settings (`Ctrl + ,` $\rightarrow$ tìm `brainHub`) hoặc chỉnh trực tiếp trong file `settings.json`:

```json
{
  // Đường dẫn chính tới thư mục brain của Antigravity (mặc định: ~/.gemini/antigravity-ide/brain)
  "brainHub.brainPath": "",

  // Các đường dẫn thư mục phụ cần quét kết hợp
  "brainHub.additionalBrainPaths": [],

  // Nhãn tên máy tính cho phiên tạo tại máy này (mặc định lấy hostname)
  "brainHub.machineName": "May-Lam-Viec",

  // Tiêu chí sắp xếp danh sách: "lastModified" (tin nhắn cuối) hoặc "createdAt" (thời điểm tạo)
  "brainHub.sessionSortBy": "lastModified",

  // Thứ tự tin nhắn trong trình đọc: "newestFirst" hoặc "oldestFirst"
  "brainHub.messageOrder": "newestFirst",

  // Chạy git pull và push khi khởi động VS Code
  "brainHub.autoSyncOnStartup": true,

  // Chu kỳ chạy ngầm đồng bộ Git tính bằng phút (đặt 0 để tắt)
  "brainHub.autoSyncIntervalMinutes": 30,

  // Chu kỳ quét ngầm tìm phiên chat mới tính bằng phút (đặt 0 để tắt)
  "brainHub.backgroundScanIntervalMinutes": 5,

  // Giám sát thư mục brain để phát hiện phiên mới tạo hoặc bị xóa
  "brainHub.enableRealtimeWatcher": true,

  // Quét lại dữ liệu khi người dùng chuyển lại cửa sổ IDE
  "brainHub.autoRefreshOnWindowFocus": true,

  // Mặc định lọc danh sách chat theo workspace đang mở khi khởi động
  "brainHub.filterWorkspaceByDefault": false,

  // Ẩn các phiên chat có 0 tin nhắn
  "brainHub.hideEmptySessions": true,

  // Tải lại trình đọc khi file transcript của phiên đang xem bị sửa đổi
  "brainHub.autoReloadOnLiveChat": true,

  // Trạng thái mặc định của chi tiết lệnh gọi tool: "collapsed" hoặc "expanded"
  "brainHub.defaultToolsState": "collapsed",

  // Trạng thái mặc định của nhóm bước AI: "collapsed" hoặc "expanded"
  "brainHub.defaultAiStepsState": "collapsed",

  // Cơ chế mở rộng nhóm thời gian: "smart", "allExpanded", hoặc "collapsed"
  "brainHub.defaultGroupExpansion": "smart",

  // Số lượng phiên chat tối đa được đánh chỉ mục cho Quick Search
  "brainHub.maxQuickSearchItems": 100,

  // Mở Dashboard khi nhấp vào icon Antigravity trên Activity Bar
  "brainHub.autoOpenDashboardOnSidebarFocus": true,

  // Chế độ lưu trữ tài liệu: "askEachTime", "safeDocsOnly", hoặc "fullWithSanitization"
  "brainHub.archiver.defaultMode": "askEachTime",

  // Thêm .docs/logs/ và .docs/scratch/ vào .gitignore khi lưu trữ tài liệu
  "brainHub.archiver.autoGitignore": true,

  // Ẩn API keys, tokens và mật khẩu khỏi log transcript xuất ra
  "brainHub.archiver.sanitizeSecrets": true,

  // Danh sách mẫu regex bổ sung dùng để phát hiện thông tin nhạy cảm
  "brainHub.archiver.customSecretPatterns": []
}
```

---

## 7. Câu Hỏi Thường Gặp & Xử Lý Sự Cố (FAQ)

### Q1: Không thấy phiên chat nào xuất hiện trong tiện ích?
1. Kiểm tra xem thư mục `brain/` cục bộ có tồn tại không:
   - **Windows**: `C:\Users\<Tên_Người_Dùng>\.gemini\antigravity-ide\brain`
   - **macOS / Linux**: `~/.gemini/antigravity-ide/brain`
2. Nếu thư mục nằm ở vị trí khác, cấu hình đường dẫn tại `brainHub.brainPath`.
3. Kiểm tra xem `brainHub.hideEmptySessions` có đang bật trong khi các phiên hiện tại đều có 0 tin nhắn hay không.

### Q2: Cấu hình xác thực Git khi đồng bộ GitHub như thế nào?
- **SSH**: Đảm bảo SSH key đã được thêm vào tài khoản GitHub (`ssh -T git@github.com`). Sử dụng URL định dạng SSH: `git@github.com:username/repo.git`.
- **HTTPS**: Sử dụng Personal Access Token theo định dạng: `https://<TOKEN>@github.com/username/repo.git`.

### Q3: Dữ liệu trò chuyện có bị gửi tới máy chủ phân tích nào không?
- **Không**. Tiện ích chạy cục bộ trên máy. Thao tác mạng chỉ diễn ra khi bạn cấu hình và chạy Git sync tới remote URL do chính bạn chỉ định.

### Q4: Làm thế nào để xem sơ đồ Mermaid trong file Markdown?
Nhấp chuột phải vào file `.md` trong khung Explorer và chọn **Brain Hub: Open Rich Markdown Preview**. Các khối code có gắn tag `mermaid` sẽ được phân tích và vẽ thành sơ đồ.

### Q5: Bộ chuẩn hóa Mermaid (Mermaid Sanitizer) hoạt động như thế nào để tránh lỗi render?
Khi các phiên chat chứa mã Mermaid do mô hình AI sinh ra, các ký tự đặc biệt (dấu hai chấm, dấu ngoặc, toán tử so sánh chưa escape) thường làm crash parser của Mermaid. `MermaidSanitizer` can thiệp vào định nghĩa đồ thị trước khi render, tự động bọc dấu nháy kép cho nhãn node, escape HTML entities cho nhãn cạnh và bọc nháy kép cho tiêu đề subgraph để sơ đồ hiển thị ổn định.
