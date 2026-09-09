# Hướng Dẫn Sử Dụng
## Brain Hub for Antigravity for VS Code & Antigravity IDE

<p align="center">
  <a href="./USER_GUIDE.md"><b>English</b></a> | <a href="./USER_GUIDE_VI.md"><b>Tiếng Việt</b></a>
</p>

---

## Mục Lục
1. [Tổng Quan](#1-tổng-quan)
2. [Cài Đặt](#2-cài-đặt)
3. [Giao Diện](#3-giao-diện)
   - [3.1. Bảng Điều Khiển Brain Hub Dashboard](#31-bảng-điều-khiển-brain-hub-dashboard)
   - [3.2. Cây Thư Mục Sidebar Tree View](#32-cây-thư-mục-sidebar-tree-view)
   - [3.3. Trình Đọc Chat Webview](#33-trình-đọc-chat-webview)
4. [Chi Tiết Tính Năng](#4-chi-tiết-tính-năng)
   - [4.1. Tìm Kiếm & Lọc Phiên Chat](#41-tìm-kiếm--lọc-phiên-chat)
   - [4.2. Sao Chép Prompt Tiếp Tục Hội Thoại](#42-sao-chép-prompt-tiếp-tục-hội-thoại)
   - [4.3. Sao Lưu & Đồng Bộ GitHub](#43-sao-lưu--đồng-bộ-github)
   - [4.4. Quản Lý Phiên Chat Rỗng](#44-quản-lý-phiên-chat-rỗng)
   - [4.5. Xuất Dữ Liệu Markdown](#45-xuất-dữ-liệu-markdown)
   - [4.6. Tự Động Tải Lại Khi Phiên Chat Có Cập Nhật](#46-tự-động-tải-lại-khi-phiên-chat-có-cập-nhật)
5. [Phím Tắt](#5-phím-tắt)
6. [Bảng Cấu Hình](#6-bảng-cấu-hình)
7. [Câu Hỏi Thường Gặp & Xử Lý Sự Cố](#7-câu-hỏi-thường-gặp--xử-lý-sự-cố)

---

## 1. Tổng Quan

**Brain Hub for Antigravity** là extension dành cho **VS Code** và **Google DeepMind Antigravity IDE** giúp lập trình viên duyệt, tìm kiếm, đọc lại, xuất khẩu và đồng bộ lịch sử hội thoại AI được lưu trong thư mục `brain/` cục bộ.

Các tính năng chính:
- Duyệt và tìm kiếm lịch sử trò chuyện theo phiên làm việc và workspace.
- Sao chép prompt mẫu để tiếp tục tác vụ trong phiên chat mới.
- Đồng bộ và sao lưu log chat với kho lưu trữ Git từ xa giữa nhiều máy tính.
- Đọc nội dung trò chuyện với hỗ trợ Markdown, công thức toán học LaTeX (KaTeX), code highlighting và khối suy luận/công cụ thu gọn.

---

## 2. Cài Đặt

### Cách 1: Cài từ file `.vsix`
1. Tải file `brain-hub-antigravity-x.x.x.vsix` từ mục [Releases trên GitHub](https://github.com/hungle-vn/brain-hub-antigravity/releases).
2. Trong VS Code, mở thẻ Extensions (`Ctrl + Shift + X`), nhấn `...` ở góc trên bên phải và chọn **Install from VSIX...**.
3. Chọn file `.vsix` vừa tải.

Hoặc chạy lệnh:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Cách 2: Chạy từ mã nguồn
```bash
git clone https://github.com/hungle-vn/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Nhấn `F5` trong VS Code để khởi chạy Extension Development Host.

---

## 3. Giao Diện

### 3.1. Bảng Điều Khiển Brain Hub Dashboard
Mở qua lệnh `Brain Hub for Antigravity: Open Brain Hub Dashboard` hoặc phím tắt `Ctrl + K Ctrl + D` (macOS: `Cmd + K Cmd + D`).

```text
+-------------------------------------------------------------------------------+
| Brain Hub for Antigravity [152 Sessions]         [Refresh] [Cleanup] [Sync] [Settings] |
+------------------------------------+------------------------------------------+
| [Search chats, or ID...          ] | Active Session Transcript                |
|                                    |                                          |
| [Danh sách phiên chat]             | USER:                                    |
|   Tối ưu thuật toán tìm kiếm       |   "Hãy tối ưu thuật toán tìm kiếm..."     |
|   14:30 | 12 msgs | Plan           |                                          |
|                                    | MODEL:                                   |
|   Fix lỗi CSS Webview              |   > Thinking (12.4s) [Expand]            |
|   10:15 | 4 msgs                   |   "Dưới đây là giải pháp..."             |
|                                    |   ```typescript                          |
|   Viết Unit Test cho Auth          |   // Code snippet...                     |
|   Hôm qua | 8 msgs | Walkthrough   |   ```                                    |
|                                    |   Tool: run_command [Output]             |
+------------------------------------+------------------------------------------+
```

- **Thanh tác vụ trên cùng**:
  - **Nút ẩn/hiện Sidebar**: Mở rộng hoặc thu gọn danh sách phiên chat bên trái.
  - **Sync with GitHub**: Thực hiện đồng bộ Git với remote repository đã cấu hình.
  - **Settings (`⚙️`)**: Mở bảng Modal để chỉnh sửa cấu hình extension.
  - **Refresh**: Quét và tải lại danh sách phiên chat từ đĩa.
  - **Cleanup**: Quét và xóa các thư mục phiên chat rỗng 0 tin nhắn.
- **Cột trái (Session List)**: Danh sách phiên chat kèm ô tìm kiếm lọc thời gian thực.
- **Cột phải (Transcript Reader)**: Hiển thị nội dung chi tiết của phiên chat đang chọn.

### 3.2. Cây Thư Mục Sidebar Tree View
Nằm trên thanh Activity Bar bên trái dưới biểu tượng Antigravity:
- **Phân nhóm thời gian**: Hôm nay (Today), Hôm qua (Yesterday), 7 ngày qua (Previous 7 Days) và Cũ hơn (Older).
- **Thanh công cụ**:
  - Mở Dashboard (`$(screen-full)`)
  - Đồng bộ GitHub (`$(cloud-upload)`)
  - Mở Cài đặt (`$(gear)`)
  - Quét lại (`$(refresh)`)
  - Tìm kiếm (`$(search)`)
  - Lọc theo Workspace (`$(filter)`)
  - Ẩn/hiện chat rỗng (`$(eye-closed)`)
- **Huy hiệu thông tin**: Số lượng tin nhắn, trạng thái artifact (`Plan`, `Walkthrough`) và tên máy tạo.

### 3.3. Trình Đọc Chat Webview
- **Markdown & Toán học**: Hiển thị Markdown chuẩn và công thức LaTeX qua KaTeX.
- **Khối mã nguồn**: Tô màu cú pháp kèm nút `Copy` 1-chạm.
- **Khối thông báo Alert**: Hiển thị các khối chú thích chuẩn GitHub (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- **Thu gọn Thinking**: Khối thu gọn hiển thị các bước suy luận của mô hình.
- **Thu gọn Tools**: Khối thu gọn hiển thị các lệnh gọi tool, tham số và kết quả terminal.

---

## 4. Chi Tiết Tính Năng

### 4.1. Tìm Kiếm & Lọc Phiên Chat
- **Quick Search (`Ctrl + Alt + H`)**: Mở thanh QuickPick tìm kiếm trên toàn bộ phiên chat theo tiêu đề, prompt hoặc ID.
- **Tìm kiếm trên Dashboard**: Ô tìm kiếm lọc danh sách phiên chat trực tiếp khi gõ phím.
- **Lọc Workspace trong Sidebar**: Lọc danh sách phiên chat theo thư mục workspace đang mở trong VS Code.
- **Tìm kiếm trong phiên chat**: Ô tìm kiếm trên đầu khung đọc để tìm từ khóa bên trong cuộc trò chuyện hiện tại.

### 4.2. Sao Chép Prompt Tiếp Tục Hội Thoại
Khi cần tiếp tục công việc của một phiên chat cũ:
1. Nhấn nút **Resume Chat** trên Dashboard, hoặc chuột phải vào phiên chat ở Sidebar $\rightarrow$ chọn **Copy Resume Prompt**.
2. Dán vào khung chat mới trong Antigravity IDE.
3. Prompt mẫu sẽ yêu cầu AI đọc log của phiên chat đó để tiếp tục ngữ cảnh làm việc.

### 4.3. Sao Lưu & Đồng Bộ GitHub
Đồng bộ lịch sử chat trong thư mục `brain/` với một kho lưu trữ Git từ xa.

#### Cấu hình ban đầu:
1. Tạo một repository riêng tư (Private) trên GitHub (ví dụ: `antigravity-brain-backup`).
2. Chạy lệnh: `Brain Hub for Antigravity: Setup GitHub Backup Repository...`
3. Nhập URL của Git remote (SSH hoặc HTTPS).
4. Extension sẽ tự động khởi tạo Git trong thư mục brain, gắn remote, commit và push lên GitHub.

#### Cơ chế đồng bộ:
- **Đồng bộ khi khởi động**: Tự động pull thay đổi và push log mới khi mở VS Code.
- **Đồng bộ định kỳ**: Tự động chạy ngầm theo khoảng thời gian cấu hình (mặc định: 30 phút).
- **Đồng bộ thủ công**: Nhấn vào nút `$(github) Brain Hub Sync` ở thanh Status Bar hoặc nút Sync trên Dashboard.
- **Nhận diện thiết bị**: Sử dụng `machineName` để phân biệt các phiên chat tạo trên các máy tính khác nhau.

### 4.4. Quản Lý Phiên Chat Rỗng
- **Ẩn chat rỗng**: Tự động ẩn các phiên chat 0 tin nhắn. Có thể bật/tắt trong cài đặt hoặc trên thanh công cụ sidebar.
- **Dọn dẹp chat rỗng**: Chạy lệnh `Brain Hub for Antigravity: Clean Up Empty Chats` để quét và xóa vĩnh viễn các thư mục session rỗng khỏi đĩa.

### 4.5. Xuất Dữ Liệu Markdown
- Chuột phải vào phiên chat $\rightarrow$ chọn **Export to Markdown (.md)**, hoặc bấm nút Export trên Dashboard.
- Lưu file `.md` chứa toàn bộ metadata, câu hỏi, câu trả lời và code snippet của phiên chat.

### 4.6. Tự Động Tải Lại Khi Phiên Chat Có Cập Nhật
- Khi đang mở xem một phiên chat, extension tự động theo dõi file `transcript.jsonl`. Nếu file có tin nhắn mới, trình đọc sẽ tự động reload lại nội dung.

---

## 5. Phím Tắt
 
| Phím tắt (Windows/Linux) | Phím tắt (macOS) | Command ID | Mô tả |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `antigravityHistory.openDashboard` | Mở Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `antigravityHistory.searchChat` | Mở Quick Search tìm kiếm phiên chat |

### 5.1. Tùy Chỉnh Hoặc Xóa Bỏ / Tắt Phím Tắt

Người dùng có thể tự do gán lại phím tắt khác hoặc gỡ bỏ hoàn toàn (không dùng hotkey):

1. **Qua giao diện trực quan (Khuyên dùng)**:
   - Mở **Keyboard Shortcuts** bằng `Ctrl + K Ctrl + S` (macOS: `Cmd + K Cmd + S`).
   - Tìm kiếm từ khóa `antigravityHistory`.
   - **Đổi phím mới**: Nhấp đúp vào lệnh cần đổi và nhấn tổ hợp phím mới $\rightarrow$ `Enter`.
   - **Xóa / Tắt phím tắt**: Chuột phải vào lệnh $\rightarrow$ chọn **Remove Keybinding** (hoặc chọn và nhấn phím `Delete`).

2. **Qua file `keybindings.json`**:
   - Mở Command Palette (`Ctrl + Shift + P`) $\rightarrow$ `Preferences: Open Keyboard Shortcuts (JSON)`.
   - Để tắt hoàn toàn phím tắt mặc định, thêm dấu trừ `-` trước command:
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

## 6. Bảng Cấu Hình

Tùy chỉnh trong VS Code Settings (`Ctrl + ,` $\rightarrow$ tìm `antigravityHistory`):

```json
{
  // Đường dẫn chính tới thư mục brain của Antigravity (mặc định: ~/.gemini/antigravity-ide/brain)
  "antigravityHistory.brainPath": "",

  // Các đường dẫn thư mục bổ sung cần quét cùng thư mục brain chính
  "antigravityHistory.additionalBrainPaths": [],

  // Tên máy tính gắn nhãn cho các phiên chat tạo trên thiết bị này (mặc định lấy hostname)
  "antigravityHistory.machineName": "Work-PC",

  // Tiêu chí sắp xếp: "lastModified" (tin nhắn cuối) hoặc "createdAt" (thời gian tạo)
  "antigravityHistory.sessionSortBy": "lastModified",

  // Thứ tự tin nhắn trong trình đọc: "newestFirst" hoặc "oldestFirst"
  "antigravityHistory.messageOrder": "newestFirst",

  // Tự động sync với Git remote khi khởi động VS Code
  "antigravityHistory.autoSyncOnStartup": true,

  // Chu kỳ tự động sync định kỳ tính bằng phút (0 để tắt)
  "antigravityHistory.autoSyncIntervalMinutes": 30,

  // Mặc định lọc cây thư mục sidebar theo workspace đang mở
  "antigravityHistory.filterWorkspaceByDefault": false,

  // Ẩn các phiên chat có 0 tin nhắn
  "antigravityHistory.hideEmptySessions": true,

  // Tự động tải lại trình đọc khi file transcript của phiên đang xem bị sửa đổi
  "antigravityHistory.autoReloadOnLiveChat": true,

  // Trạng thái mặc định của chi tiết tool call ("collapsed" hoặc "expanded")
  "antigravityHistory.defaultToolsState": "collapsed",

  // Trạng thái mặc định của nhóm bước AI ("collapsed" hoặc "expanded")
  "antigravityHistory.defaultAiStepsState": "collapsed",

  // Tự động mở Dashboard khi click biểu tượng trên Activity Bar
  "antigravityHistory.autoOpenDashboardOnSidebarFocus": true
}
```

---

## 7. Câu Hỏi Thường Gặp & Xử Lý Sự Cố

### Q1: Không thấy phiên chat nào xuất hiện trong extension?
- Đảm bảo bạn đã từng thực hiện các cuộc trò chuyện AI trong Antigravity IDE.
- Kiểm tra đường dẫn thư mục `brain` trên máy:
  - Windows: `C:\Users\<Tên_User>\.gemini\antigravity-ide\brain`
  - macOS / Linux: `~/.gemini/antigravity-ide/brain`
- Nếu lưu ở vị trí khác, hãy cấu hình đường dẫn tuyệt đối trong `antigravityHistory.brainPath`.

### Q2: Cấu hình xác thực Git khi dùng GitHub Sync như thế nào?
- **SSH**: Đảm bảo SSH key đã được thêm vào tài khoản GitHub (`ssh -T git@github.com`), sau đó dùng URL dạng: `git@github.com:username/repo.git`.
- **HTTPS**: Sử dụng Personal Access Token (PAT) theo định dạng: `https://<TOKEN>@github.com/username/repo.git`.

### Q3: Dữ liệu cuộc trò chuyện có bị gửi đến máy chủ bên thứ ba không?
- Không. Extension chạy hoàn toàn cục bộ trên máy của bạn.
- Quá trình Git sync chỉ truyền dữ liệu trực tiếp giữa máy bạn và Git repository do bạn chỉ định.
