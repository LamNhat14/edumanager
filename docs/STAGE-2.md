# Báo cáo Giai đoạn 2

Ngày 24/11/2026. Phạm vi: hoàn thiện nền tảng chạy cục bộ theo xác nhận của người dùng; chưa có project Supabase.

## Đã thực hiện

- Khởi tạo Git repository nhánh main; chưa thêm remote/commit/push.
- React, TypeScript strict, Vite, Tailwind; HashRouter, TanStack Query và Supabase client không dùng Auth.
- Layout tiếng Việt, sidebar, header, menu mobile; ba route hoạt động và trang 404. Chưa đăng nhập nên không mở menu nghiệp vụ.
- Trang hướng dẫn cấu hình và nút gọi health thực khi có môi trường; không báo có kết nối nếu chưa kiểm tra.
- API wrapper có timeout, lỗi có mã, session trong memory và xóa token khi 401.
- Edge router, CORS allowlist, response no-store và request ID; chỉ health công khai, các endpoint nghiệp vụ đóng hoàn toàn.
- Hai migration nền identity/academic, RLS, grants, audit helper và operator RPC kiểm tra phiên bản schema.
- File môi trường mẫu frontend/backend, README, CI test/build và lockfile.

## File chính

| Nhóm | Tệp |
|---|---|
| Giao diện | src/App.tsx, src/styles.css, src/main.tsx |
| Kết nối | src/lib/config.ts, src/lib/api.ts |
| Build | package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html |
| Môi trường | .env.example, .gitignore, supabase/config.toml, supabase/functions/.env.example |
| Backend | supabase/functions/edumanager/index.ts, handler.ts, deno.json |
| Database | supabase/migrations/202611240001_security_identity.sql, 202611240002_academic_foundation.sql |
| Kiểm thử | tests/config.test.ts, tests/edge.test.ts, tests/database.test.ts |
| Vận hành | README.md, scripts/serve-edge.ts, .github/workflows/ci.yml |

## Kết quả đã kiểm tra

- `npm run test`: **20/20 đạt**, 3 test files.
- `npm run build`: TypeScript và production build đạt. Đã tách chunk Supabase/Zod; không còn cảnh báo chunk vượt 500 kB.
- `npx deno check supabase/functions/edumanager/index.ts`: đạt.
- Smoke test HTTP trên Deno local thực: health trả 200 với database chưa kiểm tra, request nghiệp vụ không có session trả 401, origin ngoài allowlist trả 403.
- npm audit sau cập nhật Vitest 5.1.1: **0 vulnerabilities** được báo cáo ở thời điểm cài đặt.
- Hai migration chạy trên PGlite trong bộ nhớ, tạo database từ đầu thành công; kiểm tra grants/RLS, chặn anon/authenticated, service role không đọc trực tiếp bảng, audit context, audit bất biến, unique và grade constraints.
- HTTP frontend local trả 200. Đã xem giao diện desktop 1366×900, mobile 390×844; mở menu, đi từ tổng quan đến cấu hình và truy cập. Sửa skip link để không xung đột HashRouter và ẩn sidebar khỏi focus khi đóng trên mobile.
- Không tìm thấy tên biến service role/session secret trong src và bundle kiểm tra. Không có `.env` thật, password hay tài khoản demo trong production source/migrations.

## Migration đã áp dụng ở đâu

Chỉ trên database kiểm thử PGlite tạm thời. **Chưa áp dụng trên Supabase local Docker hoặc Supabase hosted.** PGlite không xác minh cấu hình PostgREST, gateway, extension riêng của Supabase, hoặc behavior Deno Edge hosted.

## Giới hạn và lỗi còn lại

- Build có hai cảnh báo annotation từ Zod dependency; Rollup loại comment, build vẫn thành công. Không có lỗi build/test còn mở.
- Chưa có Docker/Supabase project để kiểm tra toàn bộ stack. Người dùng xác nhận tiếp tục local.
- Chưa có đăng nhập, bootstrap Admin, permission mapping hoặc session validation thật (GĐ3). Không đưa bản này vào production để dùng dữ liệu nghiệp vụ.
- Schema học vụ mới là nền: chưa có historical terms/assignment/overlap constraints và RPC CRUD (GĐ4). Không cấp quyền ghi trước khi hoàn tất các phần đó.
- Chưa có Storage buckets/chứng từ, financial migrations, import/export hoặc báo cáo nghiệp vụ. Chưa kiểm thử tải, backup/restore và CI trên GitHub.
- Các bảng users/roles có cấu trúc nhưng audit và quyền thao tác tài khoản sẽ được hoàn thiện trong transaction RPC của GĐ3. Không dùng SQL Editor để tạo user thật bằng mật khẩu thô.

## Thông tin cần bổ sung sau này

Khi có project dev: URL, khóa công khai và cấu hình backend trực tiếp trong Supabase Secrets; không gửi service role/password vào chat. Chưa cần thông tin này để mở frontend local.

Bước tiếp theo: Giai đoạn 3 – tài khoản nội bộ, bootstrap Admin an toàn, hash mật khẩu, session lifecycle, RBAC và audit thao tác tài khoản. Không coi Giai đoạn 2 là hệ thống quản lý đã hoàn thành.
