# Báo cáo Giai đoạn 3

Ngày 24/11/2026. Đã triển khai mã nguồn và kiểm tra cục bộ. Chưa deploy lên Supabase thật hoặc cập nhật repository GitHub của người dùng.

## Chức năng

- Đăng nhập nội bộ bằng username/password, bcryptjs 3.0.3 cost 12 server-side; không dùng Supabase Auth.
- Token ngẫu nhiên 256 bit, database chỉ lưu HMAC-SHA256; token chỉ ở memory trình duyệt.
- Phiên tối đa 8 giờ, idle 30 phút, logout và thu hồi phiên; đổi mật khẩu/khóa user/đổi vai trò/reset đều thu hồi phiên liên quan.
- Bắt buộc đổi mật khẩu tạm thời; người dùng chưa đổi chỉ được xem tài khoản, đổi mật khẩu hoặc logout.
- Admin tạo tài khoản, sửa tên/trạng thái, gán nhiều vai trò cố định, reset password, thu hồi mọi phiên; danh sách tìm kiếm và phân trang.
- Backend kiểm tra session, trạng thái user và permission hiện hành ở cả Edge và SQL RPC. Menu chỉ là lớp trải nghiệm, không phải bảo mật.
- Chống gỡ/khóa Admin hoạt động cuối cùng trong transaction có khóa chung; version ngăn ghi đè dữ liệu cũ.
- Audit bất biến cho bootstrap/login/logout/create/update/role/reset/revoke/change password; log không có password/token hash.
- Giới hạn đăng nhập dùng dữ liệu PostgreSQL chung: 10 lần/tài khoản và 60 lần toàn hệ thống mỗi 15 phút. Giới hạn tổng được chọn thay cho IP chưa xác minh độ tin cậy ở gateway; cần theo dõi để điều chỉnh khi có quy mô thực.
- Hàm bootstrap operator riêng: mặc định tắt, yêu cầu service role, chỉ tạo được một lần khi database chưa có user. Không có public signup. Sau dùng phải tắt và xóa hàm theo hướng dẫn.

## Migration

Tạo `202611240003_internal_auth.sql`: quyền users.manage/audit.view cho Admin; user DTO không có hash; bootstrap, login_begin/login_finish, auth_command; thu hồi EXECUTE của anon/authenticated. Không chỉnh sửa hai migration đã giao ở GĐ2.

Đã áp dụng cả ba migration trên PostgreSQL nhúng PGlite tạm thời phục vụ tests. Chưa áp dụng lên project Supabase thật. Permission của các module học vụ/tài chính chưa cấp vì chưa triển khai module; không cho teacher xem user list hoặc audit.

## Kiểm thử

- 43 tests qua 5 file: config, Edge envelope/CORS, grants/RLS/audit database, tích hợp auth/bcrypt/session/RBAC, operator bootstrap gate.
- Bao gồm: mật khẩu sai, token giả, idle/absolute expiry, logout, reset, unlock, role update, revoke, forced change, stale version, last Admin guard, teacher forbidden, rate limit, anon RPC denied, bootstrap đóng và secret không xuất trong DTO/audit.
- TypeScript strict và production build thành công; hai cảnh báo annotation của Zod vẫn không chặn build.
- Deno check mã Edge; gói gộp cho Dashboard được kiểm tra riêng trước bàn giao.
- Benchmark cục bộ Node: bcrypt cost 12 hash khoảng 287 ms, compare khoảng 266 ms. Đây không phải benchmark trên Supabase Edge hosted; cần kiểm tra độ trễ/giới hạn CPU khi deploy thật.
- Browser QA với database trong bộ nhớ và tài khoản fixture cô lập: login Admin, menu theo quyền, danh sách tài khoản, mở/hủy form, audit login/bootstrap, logout. Không tạo hoặc thay đổi tài khoản thật. Các thao tác mật khẩu được kiểm tra qua integration tests.

## File thêm và sửa

- `src/auth.tsx`, `src/AccountPages.tsx`: session UI, login, đổi mật khẩu, tài khoản, role, audit.
- `src/App.tsx`, `src/main.tsx`, `src/lib/api.ts`, `src/styles.css`: tích hợp auth, menu/header, xử lý 401 và form/table/modal.
- `supabase/functions/edumanager/{auth,rpc,handler,index}.ts`: backend auth, REST RPC, validation, lỗi an toàn.
- `supabase/functions/bootstrap-admin/{handler,index}.ts`: khởi tạo operator.
- `supabase/config.toml`, `supabase/functions/.env.example`: cấu hình function và bootstrap mặc định tắt.
- `tests/auth.test.ts`, `tests/bootstrap.test.ts` và cập nhật tests nền.
- `scripts/package-edge.mjs`, `docs/deploy/*`: bundle một file/function và SQL cho project mới.
- `.github/workflows/deploy.yml`: build/deploy Pages với URL/khóa công khai từ GitHub Variables.
- `package.json`, `package-lock.json`: v0.3.0 và bcryptjs; `.gitignore` bỏ qua work QA.
- `README.md`, `docs/STAGE-3-DEPLOY.md`, báo cáo này.

## Giới hạn cần nghiệm thu trên môi trường thật

Chưa kiểm tra Supabase gateway, PostgREST schema/grants thực tế, function Secrets và runtime hosted. Cần làm các bước trong STAGE-3-DEPLOY.md rồi đăng nhập thật để nghiệm thu end-to-end. Chưa có dữ liệu hoặc tài khoản production; website GitHub hiện tại không tự được cập nhật.

Chưa triển khai CRUD học vụ và tài chính; không xem đây là hệ thống vận hành hoàn chỉnh. Chưa kiểm thử tải đa kết nối, khôi phục backup hoặc quy trình sự cố. Khoá advisory chung ưu tiên tính đúng cho giai đoạn đầu, cần đo tải trước khi mở rộng.

Tài khoản bootstrap chỉ được tạo bằng operator tool dành cho người sở hữu Supabase project. Đây là điều chỉnh từ script CLI trong thiết kế GĐ1 để đáp ứng yêu cầu không dùng PowerShell. Secret không được đưa vào frontend hoặc GitHub.
