# Brain Hub for Antigravity

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README_VI.md"><b>Tiếng Việt</b></a>
</p>

<p align="center">
  <a href="https://github.com/hungle-vn/brain-hub-antigravity/releases"><img src="https://img.shields.io/github/v/release/hungle-vn/brain-hub-antigravity?color=blue&logo=github" alt="GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/Platform-VS%20Code%20%7C%20Antigravity%20IDE-orange.svg" alt="Platform"></a>
</p>

Tìm kiếm, xem, khôi phục và đồng bộ các phiên làm việc Antigravity Brain giữa các máy tính.

[Hướng Dẫn Sử Dụng (Tiếng Việt)](./USER_GUIDE_VI.md) | [User Guide (English)](./USER_GUIDE.md) | [Tài Liệu Kiến Trúc & Phát Triển](./ARCHITECTURE.md)

---

## Tính Năng

### 1. Bảng Điều Khiển Brain Hub Dashboard (`Ctrl + Alt + D`)
- **Bố cục 2 cột**: Danh sách phiên chat bên trái và khung đọc nội dung bên phải trong một tab editor.
- **Nút ẩn/hiện Sidebar**: Mở rộng hoặc thu gọn danh sách phiên chat để tối ưu không gian đọc.
- **Tìm kiếm**: Lọc phiên chat theo tiêu đề, session ID, nội dung câu hỏi hoặc đường dẫn thư mục workspace.
- **Bảng Cài Đặt (Settings Modal)**: Cấu hình tên máy, cách sắp xếp, thứ tự tin nhắn, Git Remote URL và chu kỳ đồng bộ trực tiếp trong dashboard.
- **Tác vụ thanh tiêu đề**: Kích hoạt đồng bộ GitHub, quét lại thư mục từ đĩa hoặc xóa các phiên chat rỗng.

### 2. Trình Đọc Chat Webview
- **Hiển thị Markdown & Toán học**: Hỗ trợ định dạng Markdown và công thức LaTeX qua KaTeX.
- **Tô màu cú pháp mã nguồn**: Hiển thị code với syntax highlighting kèm nút Copy.
- **Khối thông báo Alert**: Hiển thị các khối chú thích chuẩn GitHub (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- **Thu gọn / Mở rộng**: Tùy chọn ẩn/hiện phần suy luận của mô hình (`Thinking`) và chi tiết thực thi công cụ (`Tools`).
- **Tìm kiếm trong phiên chat**: Tìm từ khóa bên trong cuộc trò chuyện đang mở.
- **Tự động tải lại khi có thay đổi**: Tự động reload lại trình đọc khi file transcript của phiên chat đang mở có nội dung mới.

### 3. Sao Lưu & Đồng Bộ GitHub
- Khởi tạo và quản lý kho lưu trữ Git trong thư mục `brain/` cục bộ để push/pull lịch sử chat với remote repository.
- **Gắn nhãn thiết bị**: Tự động gắn nhãn `machineName` để phân biệt các phiên chat tạo trên các máy tính khác nhau.
- **Đồng bộ tự động**: Tự động sync khi khởi động VS Code và chạy định kỳ theo số phút được cấu hình.
- **Nút trên thanh trạng thái**: Nút `$(github) Brain Hub Sync` ở Status Bar để kích hoạt sync thủ công.

### 4. Sao Chép Prompt Tiếp Tục Hội Thoại (Resume)
- Sao chép mẫu prompt chứa đường dẫn thư mục và ID của phiên chat vào clipboard để người dùng dán vào khung chat Antigravity IDE mới tiếp tục tác vụ.

### 5. Cây Thư Mục Sidebar (Tree View)
- Phân nhóm phiên chat theo mốc thời gian: Hôm nay, Hôm qua, 7 ngày qua và Cũ hơn.
- **Lọc theo Workspace**: Nút lọc trên thanh công cụ để chỉ hiển thị các phiên chat thuộc workspace đang mở.
- **Huy hiệu thông tin**: Hiển thị số lượng tin nhắn, trạng thái artifact (`Plan`, `Walkthrough`) và tên máy tạo.

### 6. Quản Lý Phiên Chat Rỗng
- Tùy chọn ẩn các phiên chat 0 tin nhắn.
- Lệnh quét và xóa vĩnh viễn các thư mục phiên chat 0 tin nhắn khỏi đĩa.

### 7. Xuất Dữ Liệu Markdown
- Xuất toàn bộ nội dung của phiên chat đang xem thành file `.md` độc lập.

---

## Cài Đặt

### Cài từ file `.vsix`
1. Tải file `.vsix` từ mục [Releases trên GitHub](https://github.com/hungle-vn/brain-hub-antigravity/releases).
2. Trong VS Code, mở thẻ Extensions (`Ctrl + Shift + X`) $\rightarrow$ nhấn `...` $\rightarrow$ chọn **Install from VSIX...**.

Hoặc cài qua terminal:
```bash
code --install-extension brain-hub-antigravity-0.5.1.vsix
```

### Chạy từ mã nguồn
```bash
git clone https://github.com/hungle-vn/brain-hub-antigravity.git
cd brain-hub-antigravity
npm install
npm run build
```
Nhấn `F5` trong VS Code để mở Extension Development Host.

---

## Phím Tắt

| Phím tắt (Windows/Linux) | Phím tắt (macOS) | Command ID | Mô tả |
|---|---|---|---|
| `Ctrl + K Ctrl + D` | `Cmd + K Cmd + D` | `antigravityHistory.openDashboard` | Mở Brain Hub Dashboard |
| `Ctrl + K Ctrl + H` | `Cmd + K Cmd + H` | `antigravityHistory.searchChat` | Mở Quick Search tìm kiếm phiên chat |

*Ghi chú: Toàn bộ phím tắt có thể tùy chỉnh hoặc tắt hoàn toàn trong bảng Keyboard Shortcuts (`Ctrl + K Ctrl + S`).*

---

## Cấu Hình

Tùy chỉnh trong VS Code Settings (`Ctrl + ,` $\rightarrow$ tìm `antigravityHistory`):

| Tên cấu hình | Mặc định | Mô tả |
|---|---|---|
| `antigravityHistory.brainPath` | `""` | Đường dẫn chính tới thư mục `brain/` (mặc định: `~/.gemini/antigravity-ide/brain`) |
| `antigravityHistory.additionalBrainPaths` | `[]` | Các đường dẫn thư mục bổ sung cần quét cùng thư mục brain chính |
| `antigravityHistory.machineName` | `""` | Nhãn tên máy tính cho các phiên chat tạo trên thiết bị này (mặc định lấy hostname) |
| `antigravityHistory.sessionSortBy` | `"lastModified"` | Tiêu chí sắp xếp: `"lastModified"` (tin nhắn cuối) hoặc `"createdAt"` (thời gian tạo) |
| `antigravityHistory.messageOrder` | `"newestFirst"` | Thứ tự tin nhắn trong trình đọc: `"newestFirst"` hoặc `"oldestFirst"` |
| `antigravityHistory.autoSyncOnStartup` | `true` | Tự động sync với Git remote khi khởi động VS Code |
| `antigravityHistory.autoSyncIntervalMinutes` | `30` | Chu kỳ tự động sync định kỳ tính bằng phút (`0` để tắt) |
| `antigravityHistory.hideEmptySessions` | `true` | Ẩn các phiên chat có 0 tin nhắn |
| `antigravityHistory.filterWorkspaceByDefault` | `false` | Mặc định lọc cây thư mục sidebar theo workspace đang mở |
| `antigravityHistory.autoReloadOnLiveChat` | `true` | Tự động tải lại trình đọc khi file transcript của phiên đang xem bị sửa đổi |
| `antigravityHistory.defaultToolsState` | `"collapsed"` | Trạng thái mặc định của chi tiết tool call (`"collapsed"` hoặc `"expanded"`) |
| `antigravityHistory.defaultAiStepsState` | `"collapsed"` | Trạng thái mặc định của nhóm bước AI (`"collapsed"` hoặc `"expanded"`) |
| `antigravityHistory.autoOpenDashboardOnSidebarFocus` | `true` | Mở Dashboard khi nhấn vào biểu tượng Antigravity trên Activity Bar |

---

## Tài Liệu
- [Hướng Dẫn Sử Dụng (Tiếng Việt)](./USER_GUIDE_VI.md)
- [User Guide (English)](./USER_GUIDE.md)
- [Tài Liệu Kiến Trúc & Phát Triển](./ARCHITECTURE.md)
- [Báo Lỗi / Đóng Góp](https://github.com/hungle-vn/brain-hub-antigravity/issues)

---

## Tuyên bố miễn trừ trách nhiệm (Disclaimer)

**Brain Hub for Antigravity** là một tiện ích mở rộng mã nguồn mở độc lập, không chính thức. Tiện ích này không liên kết, không được tài trợ và không được xác nhận bởi Google hay Google DeepMind. "Antigravity", "Gemini" cùng các nhãn hiệu liên quan là tài sản của chủ sở hữu tương ứng, chỉ được sử dụng ở đây theo nguyên tắc Sử dụng hợp lý danh nghĩa (Nominative Fair Use) nhằm mô tả tính tương thích và công năng của công cụ.
