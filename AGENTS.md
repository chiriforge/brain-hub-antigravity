# Agent Guidelines & Rules

## 1. Documentation Standards (Nguyên Tắc Viết Tài Liệu)

- **Không dùng ngôn ngữ marketing hoặc nói quá (No Marketing / Hyperbolic Language)**:
  - Tuyệt đối không dùng các từ ngữ phóng đại, sáo rỗng hoặc quảng cáo như: "chuyên nghiệp", "hoàn hảo", "tuyệt vời", "mượt mà", "vượt trội", "đỉnh cao", "state-of-the-art", "game-changing", "blazing fast", "seamless", "zero-latency", "cực kỳ mạnh mẽ"...
- **Tập trung vào bản chất và sự thật (Focus on Essence & Technical Reality)**:
  - Diễn đạt chính xác cơ chế hoạt động, luồng xử lý dữ liệu, tham số đầu vào/đầu ra, cấu hình và giới hạn thực tế của hệ thống.
  - Trình bày trực diện, súc tích, văn phong kỹ thuật (engineering tone), khách quan và trung thực.
  - Ví dụ:
    - ❌ Không viết: *"Giao diện Master-Detail chuyên nghiệp, tải tức thì với tốc độ cực đỉnh không giật lag."*
    - ✅ Viết: *"Giao diện chia 2 cột: danh sách phiên bên trái và nội dung chat bên phải; hiển thị trước từ cache cục bộ và nạp chi tiết bất đồng bộ."*

## 2. Git Operations Policy
- Chỉ thực hiện `git push` khi người dùng yêu cầu rõ ràng bằng văn bản trong câu lệnh.
- Tự động tạo commit cục bộ rõ ràng, nguyên tử (`atomic commit`) khi hoàn thành tính năng hoặc sửa lỗi.

## 3. Mermaid Diagram Syntax Standards
- Luôn đặt nhãn cạnh có chứa ký tự đặc biệt hoặc dấu ngoặc trong dấu nháy kép: `-->|"nhãn"|`.
- Luôn đặt tên hiển thị của Subgraph trong dấu ngoặc vuông kèm nháy kép: `subgraph ID ["Tên"]`.
- Luôn đặt nhãn Node có ký tự điều khiển (`:`, `&`, `->`, `/`, v.v.) trong dấu nháy kép: `Node["Nội dung"]`.
- Sử dụng khoảng trắng chuẩn ASCII, không dùng tab hay ký tự khoảng trắng đặc biệt.
