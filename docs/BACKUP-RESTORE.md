# Sao lưu và phục hồi

## Bản chạy cục bộ

Database nằm trong `work/local-data`, bao gồm học vụ, chứng từ, người dùng, hash mật khẩu và audit. Excel xuất danh sách không thay thế bản sao lưu database.

Sao lưu bằng File Explorer, không cần PowerShell:

1. Đóng ứng dụng bằng Ctrl+C trong cửa sổ START-LOCAL, đợi máy chủ dừng.
2. Sao chép toàn bộ thư mục `work/local-data` sang ổ/thiết bị sao lưu có kiểm soát truy cập. Không chỉ sao chép một file bên trong.
3. Ghi ngày giờ, phiên bản EduManager và phiên bản Node/PGlite cùng bản sao.
4. Có thể nén thư mục sau khi sao chép. Bản sao chứa dữ liệu nhạy cảm: không upload lên repository GitHub.
5. Mở lại START-LOCAL.cmd. Nên sao lưu cuối ngày và trước khi cập nhật.

Phục hồi thử trước khi thay dữ liệu đang dùng:

1. Giải nén mã nguồn cùng phiên bản sang một thư mục thử riêng.
2. Giữ máy chủ hiện tại tắt để không chiếm cổng 5173.
3. Tạo thư mục work và đặt bản sao vào work/local-data của thư mục thử.
4. Mở START-LOCAL.cmd của bản thử; đăng nhập và đối chiếu số học viên, tổng thu, công nợ, kỳ lương và một số chứng từ/audit.
5. Chỉ khi đối chiếu đạt mới quyết định dùng bản phục hồi. Giữ một bản nguyên trạng của dữ liệu hiện tại; không chép đè khi máy chủ đang chạy.

Đã kiểm thử sao chép database thử sau khi dừng và mở lại bằng một PGlite mới. Đây là kiểm tra phục hồi local, không chứng minh khả năng restore trên Supabase.

## Supabase thật

Dùng Database → Backups trong Dashboard khi gói dịch vụ hỗ trợ; chính sách lưu giữ phụ thuộc gói. Với dự án không có backup phù hợp, cần operator xuất database bằng công cụ Supabase CLI/pg_dump theo tài liệu chính thức. Đừng coi tải mã nguồn từ GitHub là sao lưu dữ liệu. [Tài liệu Supabase Backups](https://supabase.com/docs/guides/platform/backups).

Database backup không chứa file vật lý trong Storage; nếu sau này bổ sung tệp đính kèm, phải sao lưu chúng riêng. Restore có thời gian gián đoạn và thay dữ liệu theo mốc đã chọn. [Phạm vi và quy trình backup](https://supabase.com/docs/guides/platform/backups).

Bản này chưa triển khai tệp đính kèm Storage, chưa có nút backup/restore toàn bộ trên web và chưa diễn tập restore Supabase thật. Không dùng bảng xuất Excel để khôi phục quan hệ, phân bổ hoặc audit.

Checklist operator khi diễn tập trên project riêng: đủ schema app_private/app_api và 5 phiên bản migration; RLS và grants; users/roles; đối chiếu tổng payments/refunds/allocations/invoices/payroll; audit; redeploy Functions và cấu hình secrets/origins. Thay APP_SESSION_SECRET để thu hồi phiên cũ nếu cần. Không lưu secrets trong GitHub hoặc trong tài liệu công khai. Bản local PGlite không phải tệp có thể upload trực tiếp để restore Supabase; chuyển dữ liệu giữa hai môi trường cần quy trình di chuyển riêng, chưa có đồng bộ tự động.
