# Student Wallet — Premium, đa tài khoản

Ứng dụng quản lý thu chi cá nhân cho sinh viên Việt Nam. Stack được giữ nguyên: Python 3.12, Flask, SQLite, HTML/CSS/JavaScript thuần và Docker Compose.

## Khởi chạy an toàn

1. Cài và mở Docker Desktop.
2. (Tùy chọn) Sao chép `.env.example` thành `.env` và thêm `OPENAI_API_KEY` nếu muốn bật AI trực tuyến. Không chia sẻ hoặc commit `.env`.
3. Chạy bằng Docker Compose; nếu `SECRET_KEY` chưa được cung cấp, ứng dụng tự tạo khóa ngẫu nhiên an toàn và lưu trong volume dữ liệu `/data/.secret_key`. Khóa được giữ qua các lần khởi động lại. Không xóa volume này nếu cần giữ phiên đăng nhập và dữ liệu.
4. Mở terminal tại thư mục chứa `docker-compose.yml`, chạy:

   ```bash
   docker compose up -d --build
   ```

5. Mở http://localhost:8080, chọn **Đăng ký** để tạo tài khoản đầu tiên.

Nếu muốn tự đặt khóa bí mật, có thể tạo bằng Python: `python -c "import secrets; print(secrets.token_urlsafe(48))"` rồi đặt `SECRET_KEY` trong `.env`. Không sử dụng chuỗi ví dụ trong `.env.example` làm khóa thật. Khi chạy ngoài Docker với `APP_ENV=production`, phải cấu hình `SECRET_KEY` rõ ràng.

> Nếu triển khai sau HTTPS/reverse proxy, đặt `COOKIE_SECURE=1`. Không mở ứng dụng trực tiếp ra Internet nếu chưa cấu hình HTTPS, backup và vận hành phù hợp.

## Các chức năng

- Tùy chỉnh màu giao diện: nhấn **Màu sắc** cạnh nút sáng/tối trên thanh đầu trang, chọn bảng màu; lựa chọn được ghi nhớ trên trình duyệt và có thể kết hợp với chế độ sáng/tối.

- Đăng ký/đăng nhập, hash mật khẩu bằng Werkzeug, session cookie HttpOnly/SameSite=Lax, CSRF token cho thao tác thay đổi dữ liệu, giới hạn thử đăng nhập.
- Phân tách dữ liệu theo tài khoản; truy vấn sửa/xóa không thuộc tài khoản trả 404.
- Giao dịch thu/chi, lọc, phân trang `limit`/`offset`, sắp xếp an toàn theo ngày/số tiền/danh mục, thao tác hàng loạt qua API.
- Ngân sách tháng và hạn mức từng danh mục, trạng thái sắp chạm/vượt, sao chép hạn mức tháng trước.
- Giao dịch định kỳ; tạo idempotent theo tháng, xử lý ngày 29–31, tạm bỏ qua một kỳ, thay đổi quy tắc không sửa giao dịch đã sinh.
- Phân tích 12 tháng, tổng hợp theo danh mục, trung bình chi mỗi ngày, ngày chi cao nhất và tỷ trọng chi cố định/linh hoạt.
- Trợ lý có thể hội thoại mở về học tập, nghề nghiệp/thực tập, công nghệ, viết nội dung và quản lý tài chính. Chỉ số liệu tổng hợp được gửi lên khi câu hỏi liên quan đến ví; câu hỏi khác không kèm số liệu ví của tháng đó và không gửi ghi chú giao dịch thô. Có giới hạn 40 lượt/người/ngày và chặn một số mẫu dữ liệu nhạy cảm.
- Xuất CSV có BOM và chống CSV formula injection; xuất JSON toàn bộ; xem trước nhập CSV/JSON trước khi xác nhận.
- Giao diện sáng/tối và 5 bảng màu (tím lavender, xanh đại dương, xanh bạc hà, hồng pastel, cam hoàng hôn); lưu lựa chọn trên thiết bị, responsive, hỗ trợ phím `N` mở giao dịch và `Esc` đóng modal.

## Migration và dữ liệu cũ

Schema được quản lý bằng `PRAGMA user_version` (hiện tại là phiên bản 5). Ứng dụng chạy migration cộng dồn khi khởi động; các migration không chủ động xóa giao dịch. Nếu database cũ có dữ liệu chưa gắn tài khoản, tài khoản đầu tiên được đăng ký sẽ nhận các bản ghi cũ chưa có `user_id`; các tài khoản sau không được xem dữ liệu đó. Đây là lựa chọn tương thích đơn giản; hãy sao lưu trước khi nâng cấp.

Kiểm tra phiên bản schema trong container:

```bash
docker compose exec chi-tieu-sinh-vien python -c "import sqlite3; c=sqlite3.connect('/data/expenses.db'); print(c.execute('PRAGMA user_version').fetchone()[0])"
```

## Sao lưu và khôi phục volume

Sao lưu trước khi cập nhật schema hoặc triển khai:

```bash
scripts/backup.sh ./backups
```

Trên Windows có thể dùng Docker command tương đương hoặc Git Bash. Tên volume mặc định phụ thuộc tên thư mục Compose; nếu khác, đặt `EXPENSE_VOLUME=<ten_volume>`.

Khôi phục yêu cầu xác nhận rõ ràng vì thao tác sẽ ghi đè nội dung volume:

```bash
scripts/restore.sh ./backups/expense-data-YYYY-MM-DD_HH-MM-SS.tgz
```

**Không chạy `docker compose down -v` khi muốn giữ dữ liệu.** `docker compose down` không có `-v` giữ volume.

## AI tùy chọn

Trong `.env`, cấu hình `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, rồi chạy lại `docker compose up -d --build` để bật hội thoại mở với mô hình ngôn ngữ. Khi API lỗi hoặc chưa có key, app dùng chế độ cục bộ: phân tích ví và đưa hướng dẫn cơ bản cho một số chủ đề sinh viên, nhưng không thể tự trả lời chính xác mọi câu hỏi mở. Câu hỏi tài chính mới gửi số liệu tổng hợp tháng; câu hỏi chủ đề khác không đính kèm số liệu ví. Không nhập mật khẩu ngân hàng, OTP hoặc số thẻ vào chat.

## Kiểm thử và CI

Cài môi trường dev rồi chạy:

```bash
python -m pip install -r requirements-dev.txt
DATABASE_PATH=./test-expenses.db python -m pytest -q
ruff check app.py tests
```

GitHub Actions chạy pytest, Ruff và Docker build trên push/pull request. Không dùng dữ liệu production trong test; test dùng SQLite tạm.

## Cấu hình vận hành

- `GUNICORN_WORKERS` mặc định 2; phù hợp ứng dụng SQLite tải nhẹ. SQLite bật WAL và timeout; không tăng worker quá mức nếu không đo tải.
- `LOG_LEVEL` điều chỉnh log Gunicorn. Log access không ghi query string hoặc nội dung giao dịch.
- `MAX_CONTENT_LENGTH` mặc định 128 KiB; endpoint nhập/sao lưu có giới hạn riêng 2 MiB và tối đa 10.000 dòng CSV.
- `.dockerignore` loại `.env`, database, Git, môi trường ảo và tests khỏi image.

## Ghi chú còn lại

Ứng dụng chưa thay thế tư vấn tài chính chuyên nghiệp. Hạn mức nhập JSON/CSV và kiểm tra định dạng bảo vệ khỏi lỗi phổ biến nhưng không nên xem là cơ chế chống mọi tệp độc hại. Nếu triển khai công khai, cần thêm HTTPS/reverse proxy, giám sát, chính sách lưu trữ/khôi phục đã diễn tập và đánh giá bảo mật độc lập. Một số thao tác nâng cao hiện có API nhưng chưa có giao diện đầy đủ; xem danh sách kiểm tra trong báo cáo bàn giao.
