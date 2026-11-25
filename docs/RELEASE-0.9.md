# Báo cáo nghiệm thu cục bộ – 0.9.0

Ngày kiểm tra: 24/11/2026. Trạng thái: bản tích hợp để nghiệm thu, chưa xác nhận production trên Supabase thật.

## Bằng chứng

- 66 kiểm thử tự động / 7 tệp đều đạt trên PGlite (PostgreSQL WASM), Vitest; có bcrypt thật, session và SQL RPC thật.
- TypeScript frontend và Vite production build đạt. Excel tải động chỉ khi nhập/xuất; chunk Excel khoảng 937 KB chưa gzip có cảnh báo kích thước, không chặn build.
- Hai bundle Dashboard Edge Functions qua Deno check.
- npm audit sau cập nhật phụ thuộc UUID: 0 cảnh báo trong cây phụ thuộc cài đặt. Đây không thay thế kiểm toán bảo mật toàn diện; bundle browser của ExcelJS do nhà phát hành cung cấp và được kiểm thử chức năng đọc/ghi.
- Chạy local có database trên đĩa: khởi tạo Admin, login, học vụ, hóa đơn, thu một phần, báo cáo qua HTTP đạt.
- Kiểm tra giao diện qua trình duyệt: login, lưu học viên từ form, xem công nợ 200.000 VND trên hóa đơn 600.000 VND đã thu 400.000 VND; xem chi tiết hóa đơn; báo cáo lương 30% = 120.000 VND; tải tệp Excel báo cáo thực tế.
- Khung nhìn 390 × 844: menu mở/đóng, điều hướng được; không tràn ngang toàn trang tại màn hình đã kiểm tra. Bảng rộng cuộn trong khung.
- Dữ liệu thử, tài khoản thử và database thử nằm ngoài gói ZIP; production không có seed học viên hoặc mật khẩu mặc định.

## Các trường hợp đã kiểm thử tự động

Quyền schema/RLS, khóa anonymous và service-role direct table access; audit không được sửa/xóa/truncate; khóa Admin cuối cùng; đăng nhập sai/rate limit; token không lưu thô; hết hạn/thu hồi phiên; forced password change; đổi vai trò; CORS/bootstrap mặc định tắt.

Trùng đăng ký, kiểm soát phiên bản sửa, import nguyên tử, trùng lịch và rollback chuỗi, thứ tự xác nhận/duyệt, chốt lương khi còn buổi chưa duyệt, không chốt trùng, combo phân bổ bảo toàn tổng, snapshot giá/lương, thanh toán nhiều lần/idempotency, dư tiền và tự dùng kỳ sau, hoàn tiền qua duyệt/đảo phân bổ/lương, giữ công nợ đúng, bất biến ledger, tách dòng tiền và phân bổ, giới hạn giáo viên theo dữ liệu của mình, quyết định giữa tháng, VND không thập phân, kết thúc phân công, lương kết hợp và buổi duyệt muộn. Excel: Unicode, số điện thoại có 0 đầu, ngày sai, khối sai, trùng dòng và từ chối công thức.

## Nghiệm thu còn cần trên môi trường thật

1. Người sở hữu tạo Supabase, áp dụng migration còn thiếu, deploy Functions, cấu hình secrets và public variables GitHub.
2. Upload nguồn, workflow GitHub Pages chạy thành công; kiểm tra đúng bản 0.9 trên URL công khai.
3. Login bằng tài khoản tự tạo; thử đủ 5 vai trò trên các trình duyệt/thiết bị sử dụng thực tế.
4. Chạy quy trình học vụ → lịch → hóa đơn → thanh toán → hoàn → lương → chi lương → báo cáo bằng dữ liệu nghiệm thu trong project thử.
5. Kiểm tra gateway verify_jwt=false nhưng API nghiệp vụ vẫn từ chối thiếu/sai session; kiểm tra anon không truy vấn được private tables/RPC.
6. Diễn tập backup/restore Supabase, đo tải thực tế và đối soát số liệu với người quản lý trước khi nhập dữ liệu vận hành.

Không thể đánh dấu tiêu chí lưu/đọc trên Supabase thật và triển khai online là đã đạt khi chưa có project/credentials phù hợp. GitHub Pages hiện có của người dùng không bị thay đổi bởi việc tạo ZIP này.

## Giới hạn cần biết trước nghiệm thu

Quy ước và hạn chế chi tiết nằm trong OPERATIONS.md: mỗi học viên một hóa đơn/tháng chưa có hóa đơn bổ sung/hủy; hoàn giảm nghĩa vụ học phí, không phải đảo phiếu thu giữ nguyên khoản phải thu; một giáo viên chính cho mỗi lớp–môn tại một thời điểm; cố định theo hiệu lực đầu tháng; số lương âm không tự chuyển kỳ; lọc nghiệp vụ tài chính trong trang hiện tại; tối đa 10.000 dòng cho xuất/danh mục; PDF qua hộp thoại in; chưa có attachments Storage, sao lưu tự động trong app, đồng bộ local–Supabase. Chưa kiểm thử tải lớn hoặc mọi tổ hợp dữ liệu lịch sử. Do đó không gọi bản này là production đã nghiệm thu đầy đủ chỉ dựa trên test cục bộ.

Tài liệu GĐ1 là thiết kế đầy đủ; bộ 0.9 triển khai các luồng chính và ghi rõ phần chưa đạt. Không xóa hoặc chỉnh SQL trực tiếp chứng từ để vượt qua quy tắc nghiệp vụ.
