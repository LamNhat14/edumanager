# EduManager – Trung tâm Nhật Như

Bản 0.9.0 là bộ mã nguồn tích hợp các phân hệ giai đoạn 1–9 để nghiệm thu. Có chế độ chạy cục bộ lưu dữ liệu thật trên máy và bộ triển khai GitHub Pages + Supabase. Không dùng Supabase Auth, không có tài khoản hoặc dữ liệu demo trong bản phân phối.

**Đã kiểm thử cục bộ; chưa triển khai và nghiệm thu trên Supabase thật.** Đọc `BAT-DAU.txt` trước khi sử dụng.

## Chạy trên máy, không cần PowerShell

1. Cài Node.js 24 LTS từ https://nodejs.org/ nếu chưa có.
2. Giải nén vào một thư mục riêng; mở `START-LOCAL.cmd` bằng nhấp đúp.
3. Lần đầu chương trình tải thư viện qua npm, cần Internet. Đợi dòng `EduManager LOCAL`.
4. Mở http://127.0.0.1:5173/#/local-setup và tự tạo Admin đầu tiên.
5. Đăng nhập, tạo dữ liệu trung tâm. Không có mật khẩu mặc định.

Chế độ local dùng PostgreSQL PGlite tại `work/local-data`, chỉ lắng nghe 127.0.0.1. Không mở máy chủ này ra Internet/LAN. Đóng bằng Ctrl+C, đợi tiến trình dừng trước khi sao lưu. Giữ nguyên thư mục dữ liệu khi cập nhật mã nguồn. Không upload thư mục `work` lên GitHub.

## Deploy bằng trình duyệt

Làm theo `docs/DEPLOY-FINAL.md`. Tệp đã chuẩn bị sẵn để dán vào Supabase Dashboard:

- `docs/deploy/FRESH-PROJECT-ONLY.sql`: đủ 5 migration, chỉ chạy trên project mới hoàn toàn.
- `docs/deploy/edumanager.ts`: Edge Function chính.
- `docs/deploy/bootstrap-admin.ts`: công cụ operator tạm thời tạo Admin, xóa sau khi dùng.
- `.github/workflows/deploy.yml`: tự test/build/deploy khi upload lên nhánh main.

GitHub Pages chỉ chứa frontend. Chạy local không tự đồng bộ dữ liệu lên Supabase. Không đưa khóa service role, APP_SESSION_SECRET, `.env.local` hoặc bản sao lưu lên GitHub.

## Phạm vi chức năng

- Tài khoản nội bộ, bcrypt cost 12, phiên opaque lưu trong bộ nhớ trình duyệt, thu hồi phiên, đổi mật khẩu, 5 vai trò, audit bất biến.
- Học viên, giáo viên, lớp, môn, phòng, đăng ký nhiều môn; chuyển lớp nguyên tử; nhập Excel có xem trước/lỗi và xuất XLSX.
- Phân công giáo viên theo thời gian, chính sách lương riêng; lịch lặp tuần, kiểm tra trùng, xác nhận và duyệt buổi dạy, dạy bù/hủy.
- Lịch sử giá, combo đúng ba môn, quyết định tiền giữa tháng, hóa đơn tháng nhiều dòng, thanh toán từng phần, tiền đóng trước, phân bổ và hoàn tiền có duyệt.
- Lương % thực thu phân bổ, theo buổi/giờ được duyệt, cố định, kết hợp, thưởng/khấu trừ, chốt kỳ, chi lương từng phần.
- Thu chi khác, báo cáo dòng tiền và thực thu phân bổ, công nợ/số dư, lợi nhuận tạm tính, in/lưu PDF bằng hộp thoại trình duyệt.

`docs/OPERATIONS.md` mô tả quy trình và các quy ước nghiệp vụ. `docs/RELEASE-0.9.md` ghi bằng chứng kiểm thử và giới hạn nghiệm thu. `docs/BACKUP-RESTORE.md` hướng dẫn sao lưu/phục hồi.

## Dành cho phát triển

```sh
npm ci
npm run local
npm run check
node scripts/package-edge.mjs
npx deno check docs/deploy/edumanager.ts docs/deploy/bootstrap-admin.ts
```

Kết nối Supabase cho dev: sao chép `.env.example` thành `.env.local`, điền URL và khóa công khai, chạy `npm run dev`. Không bật local mode trên bản GitHub Pages. React/TypeScript/Vite/Tailwind, PostgreSQL, Edge Functions; các SQL RPC chạy giao dịch, kiểm tra phiên và quyền tại database.

Migrations phải chạy đúng thứ tự. Không chạy lại file tổng hợp trên database đã có bảng. Các tài liệu `STAGE-2.md`, `STAGE-3.md`, `STAGE-3-DEPLOY.md` là lịch sử; dùng hướng dẫn FINAL cho bản mới.
