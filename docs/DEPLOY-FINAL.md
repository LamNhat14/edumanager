# Triển khai EduManager 0.9 bằng trình duyệt

Bản này tích hợp tài khoản, học vụ, lịch dạy, học phí, lương, thu chi và báo cáo. Bạn không cần PowerShell. Website GitHub hiện tại chưa tự có các chức năng này cho đến khi bạn upload bản mới và cấu hình Supabase.

## 1. Tạo project Supabase

Mở https://supabase.com/dashboard và tạo project dành riêng cho EduManager. Giữ database password trong trình quản lý mật khẩu; không gửi vào chat. Chờ project sẵn sàng. Không dùng chung project đã có ứng dụng khác vì migrations điều chỉnh quyền truy cập schema.

## 2. Tạo database trong SQL Editor

Với project mới hoàn toàn: mở file `docs/deploy/FRESH-PROJECT-ONLY.sql`, sao chép toàn bộ vào Supabase **SQL Editor → New query**, bấm Run một lần. File chứa đủ năm migration theo thứ tự và không tạo học viên hoặc tài khoản mẫu.

Nếu đã có database từ Giai đoạn 2 hoặc 3: chạy `select app_api.schema_status();` để xem phiên bản đã áp dụng, rồi chỉ chạy các migration còn thiếu theo thứ tự 003 → 004 → 005 trong `supabase/migrations`. Nếu đã có đủ 001–003, chỉ chạy 004 và 005. Không chạy file tổng hợp lên database đã có bảng. Nếu báo bảng đã tồn tại, dừng và kiểm tra migration đã chạy; không xóa bảng để thử lại.

Kiểm tra bằng SQL:

```sql
select app_api.schema_status();
```

Kết quả cần có `202611240001`, `202611240002`, `202611240003`, `202611240004`, `202611240005`.

Vào phần cài đặt **Data API / API → Exposed schemas**, thêm `app_api`. Không expose `app_private`; giữ quyền anon/authenticated như migration. Dữ liệu ứng dụng không cho trình duyệt đọc trực tiếp.

## 3. Cấu hình secrets trên Supabase

Trong **Edge Functions → Secrets**, thêm:

| Tên | Giá trị |
|---|---|
| APP_SESSION_SECRET | Chuỗi ngẫu nhiên ít nhất 32 ký tự, khuyến nghị 64 ký tự từ trình quản lý mật khẩu |
| ALLOWED_ORIGINS | `https://lamnhat14.github.io` |
| BOOTSTRAP_ENABLED | `false` ban đầu |

Supabase cung cấp `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` cho Edge Functions. Không đưa service role hoặc session secret vào GitHub Variables, vào file nguồn hoặc vào các biến VITE_. Thay APP_SESSION_SECRET sau này sẽ làm các token cũ không còn hợp lệ.

## 4. Deploy hàm chính

Trong **Edge Functions → Deploy a new function → Via Editor**:

1. Đặt tên hàm chính xác `edumanager`.
2. Thay nội dung `index.ts` bằng toàn bộ file `docs/deploy/edumanager.ts`.
3. Deploy.
4. Trong cấu hình function, tắt **Verify JWT** của Supabase gateway. Ứng dụng dùng token phiên nội bộ, không dùng JWT Supabase. Handler tự xác thực và kiểm tra quyền.

File trong `docs/deploy` đã gộp các module nội bộ; chỉ còn import `npm:bcryptjs@3.0.3` được Deno hỗ trợ. Không dán riêng file entrypoint nhỏ từ `supabase/functions` vì nó cần những file import đi kèm.

Mở URL `https://PROJECT_REF.supabase.co/functions/v1/edumanager/v1/health`. Khi đủ secrets, health có `authentication: configured`. Đây chỉ là tín hiệu có cấu hình; chưa xác minh đăng nhập/database.

## 5. Tạo Admin đầu tiên bằng công cụ operator

Để không cần terminal, bản này cung cấp hàm khởi tạo tạm thời chỉ nhận **service role** từ quản trị viên project. Đây là thay đổi triển khai so với script CLI dự kiến ở GĐ1; ứng dụng công khai không có nút hoặc API đăng ký Admin. Hàm mặc định tắt và database chỉ cho khởi tạo khi chưa có bất kỳ user nào.

1. Tạo function thứ hai tên `bootstrap-admin`, dán toàn bộ `docs/deploy/bootstrap-admin.ts` vào editor, rồi Deploy.
2. Tắt Verify JWT của function này để handler tự kiểm tra đúng service role; các khóa công khai và session user đều bị từ chối.
3. Trong Secrets, đổi `BOOTSTRAP_ENABLED` thành `true` chỉ trong lúc khởi tạo.
4. Mở **Test / Invoke** của `bootstrap-admin`, method POST. Chọn authorization service role nếu Dashboard có tùy chọn; nếu không, đặt header `Authorization: Bearer <SERVICE_ROLE_KEY>` bằng khóa service_role lấy ngay trong Dashboard của chính project. Chỉ nhập ở Supabase Dashboard, không nhập ở website EduManager, GitHub hoặc chat.
5. Body JSON gồm ba trường dưới đây. Thay các giá trị hướng dẫn bằng thông tin thật và mật khẩu riêng trước khi gửi:

```json
{
  "username": "TEN_DANG_NHAP_CHU_THUONG",
  "display_name": "TEN_QUAN_TRI_VIEN",
  "password": "MAT_KHAU_RIENG_CUA_BAN"
}
```

Tên đăng nhập phải là chữ thường/số/dấu chấm/gạch dưới/gạch ngang, 3–64 ký tự. Mật khẩu ít nhất 12 ký tự, tối đa 72 byte UTF-8; không dùng các chuỗi minh họa phía trên làm mật khẩu thật. Dữ liệu gửi qua HTTPS; mật khẩu được bcrypt cost 12 ngay trong function, database chỉ lưu hash. Code không log body hoặc secret.

6. Kết quả thành công là HTTP 201, trả hồ sơ Admin không có password/hash. Gửi lại sẽ báo `BOOTSTRAP_CLOSED`.
7. Ngay sau thành công, đổi `BOOTSTRAP_ENABLED=false` và xóa function `bootstrap-admin` khỏi project. Xóa body chứa mật khẩu khỏi khung Test nếu còn hiển thị. Không xóa function `edumanager`.

Admin đầu tiên dùng mật khẩu tự chọn nên không bắt buộc đổi ngay. Tài khoản nhân viên do Admin tạo hoặc reset đều phải đổi mật khẩu tạm thời trước khi dùng chức năng khác.

## 6. Cấu hình GitHub

Trong repository `lamnhat14/edumanager`, mở **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Tên | Giá trị |
|---|---|
| VITE_SUPABASE_URL | URL project `https://PROJECT_REF.supabase.co` |
| VITE_SUPABASE_ANON_KEY | Khóa công khai anon hoặc publishable của project |

Không cần `.env` trên GitHub. Hai giá trị này được build vào frontend nên tuyệt đối không thay bằng service role/secret key.

## 7. Upload mã nguồn Giai đoạn 3

Giải nén gói source mới, vào **Code → Add file → Upload files**, kéo các file/thư mục bên trong vào repository để cập nhật. Giữ `package.json` tại gốc. Đảm bảo cập nhật cả `package-lock.json` và `.github/workflows/deploy.yml`; workflow mới đã đọc hai repository variables phía trên.

Nếu trình duyệt không upload được thư mục `.github`, mở file `.github/workflows/deploy.yml` trên GitHub, nhấn Edit và thay bằng nội dung file mới. Commit vào main. Giữ Settings → Pages → Source = GitHub Actions.

Chờ **Actions → Deploy EduManager** chạy xanh. Nếu chỉ đổi Variables mà không commit, dùng **Run workflow** để build lại; trình duyệt không tự nhận giá trị build mới từ GitHub Variables.

## 8. Kiểm tra sau deploy

Mở https://lamnhat14.github.io/edumanager/#/access và đăng nhập Admin vừa tạo:

- Tên Admin xuất hiện ở header, menu Tài khoản và phân quyền/Nhật ký xuất hiện.
- Tạo một tài khoản thật khi đã sẵn sàng cấp cho nhân viên, chọn đúng vai trò; trao mật khẩu tạm thời ngoài hệ thống qua kênh riêng.
- Nhân viên đăng nhập lần đầu phải đổi mật khẩu; đổi xong tất cả phiên bị thu hồi, cần đăng nhập lại.
- Chỉ Admin có quyền quản trị tài khoản và xem audit trong GĐ3. Các quyền học vụ/tài chính sẽ được cấp khi module tương ứng triển khai; không cấp quyền chưa có API.
- Khi khóa, đổi vai trò hoặc reset một user, phiên của user đó bị thu hồi. Không thể khóa hoặc bỏ vai trò Admin cuối cùng.
- Phiên hết hạn tuyệt đối sau 8 giờ, idle sau 30 phút. Tải lại trang mất token memory và cần đăng nhập lại. Poll /me không kéo dài idle timeout.

## Xử lý lỗi

- “Chưa cấu hình Supabase”: thiếu GitHub Variables hoặc chưa chạy lại workflow.
- “Không thể kết nối máy chủ”: kiểm tra URL, tên function và `ALLOWED_ORIGINS` phải đúng `https://lamnhat14.github.io`, không kèm `/edumanager/`.
- HTTP 401 từ gateway khi login: kiểm tra Verify JWT đã tắt cho custom-auth function.
- `AUTH_NOT_READY`: chưa cấu hình APP_SESSION_SECRET đủ dài hoặc thiếu môi trường backend.
- `BACKEND_ERROR`: kiểm tra migration 003 và exposed schema app_api; không giải quyết bằng cách mở quyền anon.
- `RATE_LIMIT`: chờ 15 phút. Có hạn mức 10 lần/tài khoản và 60 lần toàn hệ thống trong 15 phút; không dựa vào forwarded IP do client có thể giả mạo. Các lần thành công cũng tính vào hạn mức để chặn gọi hash liên tục.
- `CONFLICT`: tải lại danh sách rồi thực hiện trên phiên bản mới.
- `LAST_ADMIN`: cần một Admin hoạt động khác trước khi thu hẹp quyền tài khoản này.

Tài liệu chính thức: https://supabase.com/docs/guides/functions/quickstart-dashboard và https://supabase.com/docs/guides/functions/secrets

## Nghiệm thu bản tích hợp

Sau khi login: tạo môn/phòng/giáo viên/lớp/môn của lớp, phân công và học phí. Tạo học viên và đăng ký từ đầu tháng. Lập hóa đơn, thu một phần, kiểm tra công nợ; thu dư, kiểm tra số dư. Tạo và duyệt buổi học đã kết thúc, đối chiếu lương. Chạy checklist trong RELEASE-0.9.md. Không coi kiểm tra health là nghiệm thu dữ liệu.

Không upload START-LOCAL.cmd hay scripts/local-server.ts để làm backend GitHub Pages: Pages không chạy Node server. Các file này chỉ phục vụ chạy trên máy. Upload chúng trong repository được, nhưng workflow chỉ build frontend; hosted backend phải triển khai ở Supabase.
