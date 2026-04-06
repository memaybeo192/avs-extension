# AVS Cleaner

AVS Cleaner là một tiện ích mở rộng (browser extension) được thiết kế nhằm tối ưu hóa trải nghiệm người dùng trên hệ thống AnimeVietSub. Tiện ích cung cấp các công cụ loại bỏ quảng cáo, vô hiệu hóa script chống gỡ lỗi (anti-debugging), và hỗ trợ tải xuống luồng video được mã hóa.

## Tính năng chính

* **Chặn quảng cáo (Ad-blocker):** Tự động vô hiệu hóa các thành phần quảng cáo (banner, popup, quảng cáo đính kèm khi tạm dừng video như Catfish, Adv).
* **Vượt qua AVS-Shield:** Ngăn chặn các tập lệnh phát hiện DevTools của trang. Cho phép sử dụng các công cụ dành cho nhà phát triển (F12, chuột phải) mà không kích hoạt vòng lặp tải lại trang (reload loop).
* **Trích xuất & Tải Video (HLS/M3U8 Decryption):**
    * Tự động thu thập khóa giải mã (AES-GCM key) thông qua việc can thiệp trực tiếp vào `window.crypto.subtle`.
    * Vượt qua giới hạn tốc độ (rate-limiting) của Cloudflare bằng cơ chế tải phân đoạn theo cụm (burst download) kết hợp độ trễ ngẫu nhiên (jitter/cooldown).
    * Tự động hợp nhất các phân đoạn và xuất ra định dạng tệp `.ts`.
* **Cải thiện UI/UX:**
    * Vô hiệu hóa thao tác vuốt để tua thời gian của ArtPlayer trên thiết bị di động, hạn chế tình trạng chạm nhầm.
    * Khắc phục lỗi phản hồi chậm của nút chuyển tập ("Xem Ngay") bằng cách giao tiếp trực tiếp với API nội bộ của trang web.
## Hướng dẫn cài đặt

Tiện ích cần được cài đặt thủ công ở chế độ dành cho nhà phát triển:

1. Tải về mã nguồn và giải nén vào một thư mục độc lập.
2. Truy cập vào phần quản lý tiện ích mở rộng của trình duyệt thông qua địa chỉ `chrome://extensions/` (hỗ trợ Chrome, Edge, Brave, v.v.).
3. Bật **Chế độ dành cho nhà phát triển** (Developer mode) ở góc phải màn hình.
4. Chọn **Tải tiện ích đã giải nén** (Load unpacked) và trỏ đến thư mục chứa mã nguồn vừa giải nén ở bước 1.
5. Tải lại trang web mục tiêu để tiện ích bắt đầu hoạt động.

## Kiến trúc kỹ thuật

* **Cơ chế giải mã video:** Do nội dung được bảo vệ bởi AES-GCM với khóa động, tiện ích thực hiện ghi đè (override) các phương thức `importKey`, `sign`, và `decrypt` thuộc API `window.crypto.subtle` bên trong iframe của player. Việc này cho phép trích xuất chính xác `keyBytes` và bản rõ (plaintext) cần thiết để tự động giải mã các phân đoạn video ngay trên client.
* **Điều chỉnh CORS:** Sử dụng `declarativeNetRequest` (trong `rules.json`) để thiết lập lại các header bảo mật (`Access-Control-Allow-Origin: *`) đối với các domain lưu trữ của Google, giải quyết triệt để lỗi Cross-Origin Resource Sharing khi khởi tạo các luồng tải phân đoạn.

## Tuyên bố miễn trừ trách nhiệm

Dự án này được tạo ra dành riêng cho mục đích nghiên cứu giáo dục liên quan đến Web Crypto API, cấu trúc tiện ích mở rộng (Manifest V3), và phân tích các cơ chế anti-debugging trên trình duyệt. Người dùng tự chịu mọi trách nhiệm liên quan đến việc sử dụng mã nguồn này trong thực tế.
