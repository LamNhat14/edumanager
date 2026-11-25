# Quy trình vận hành EduManager 0.9

## Phân quyền

| Vai trò | Công việc |
|---|---|
| Admin | Tất cả nghiệp vụ, tài khoản, liên kết giáo viên, nhật ký, thông tin trung tâm |
| Quản lý | Học vụ, lịch, giá/combo, quyết định học phí giữa tháng, duyệt hoàn, chính sách/chốt lương, tài chính |
| Học vụ | Hồ sơ học viên/giáo viên/lớp/môn/phòng, đăng ký, lịch; không đọc tiền lương |
| Kế toán | Xem dữ liệu học vụ đã hạn chế thông tin riêng tư, lập hóa đơn, thu tiền, đề nghị hoàn, xem và chi lương, thu chi/báo cáo; không đổi giá, duyệt hoàn hoặc chốt lương |
| Giáo viên | Chỉ lịch và phiếu lương của hồ sơ đã liên kết; xác nhận buổi của mình; không duyệt buổi |

Admin tạo tài khoản trong Tài khoản và phân quyền, người dùng tự đổi mật khẩu ở lần đăng nhập đầu. Liên kết giáo viên trong Thông tin trung tâm. Khi đổi vai trò, khóa, reset mật khẩu hoặc đổi liên kết, phiên liên quan bị thu hồi. Trang reload yêu cầu đăng nhập lại. Phiên tối đa 8 giờ, hết hạn sau 30 phút không hoạt động; kiểm tra /me không kéo dài thời hạn.

## Khởi tạo dữ liệu

1. Lớp & danh mục: tạo môn, phòng và lớp, rồi tạo Môn của lớp.
2. Học vụ: tạo giáo viên và học viên. Điện thoại không phải mã duy nhất; anh chị em có thể dùng chung số phụ huynh.
3. Phân công & chính sách lương: chọn lớp–môn, giáo viên, ngày hiệu lực, các thành phần lương. Các khoản được cộng. Đặt ngày kết thúc phân công theo kỳ; khoảng hiệu lực không bao gồm ngày kết thúc.
4. Lịch sử học phí: nhập giá tháng cho từng lớp–môn và ngày hiệu lực, kèm căn cứ.
5. Đăng ký học: mỗi học viên có thể có nhiều đăng ký môn ở các lớp khác nhau. Không cho hai đăng ký cùng lớp–môn trùng thời gian. Vượt sĩ số là cảnh báo để người vận hành xem xét.

Không xóa vật lý hồ sơ đã dùng trong chứng từ. Dùng trạng thái nghỉ/ngừng/đóng. Trạng thái hồ sơ học viên và trạng thái đăng ký là độc lập: khi tạm nghỉ toàn bộ, cập nhật các đăng ký liên quan. Thay lớp dùng Chuyển lớp, hệ thống kết thúc đăng ký cũ và tạo đăng ký mới cùng giao dịch. Không sửa danh tính đăng ký hay đổi lớp/môn của một bản ghi lớp–môn đã tạo.

Giá cũ không sửa: thêm phiên bản hiệu lực mới. Đổi giáo viên/tỷ lệ: Kết thúc phân công cũ, thêm phân công mới bắt đầu tại ngày kết thúc. Nếu còn lịch tương lai hoặc hóa đơn sử dụng phân công sau ngày muốn kết thúc, cần xử lý lịch hoặc chọn ngày sau chứng từ đã phát hành. Snapshot trong hóa đơn/buổi dạy bảo toàn căn cứ lương.

## Lịch và duyệt buổi

Tạo lịch bằng phân công, phòng, giờ bắt đầu/kết thúc và số tuần (1–52). Cả chuỗi được lưu trong một giao dịch: nếu bất kỳ tuần nào trùng phòng, giáo viên hoặc lớp–môn, không lưu tuần nào. Mỗi buổi tối đa 12 giờ. Múi giờ nghiệp vụ Asia/Ho_Chi_Minh.

Sau khi kết thúc, giáo viên xác nhận đã dạy. Quản lý duyệt hoặc từ chối có lý do. Buổi bị từ chối có thể xác nhận lại. Buổi dự kiến/bị từ chối có thể hủy bởi học vụ hoặc quản lý. Dạy bù tạo buổi mới và chọn buổi gốc. Buổi đã duyệt không sửa; phát sinh điều chỉnh tiền qua Thưởng/khấu trừ có lý do. Không có điểm danh học viên trong MVP này.

## Học phí, thu tiền, số dư

Hóa đơn là một chứng từ mỗi học viên/tháng; mỗi đăng ký/tháng chỉ xuất hiện một lần. Nên hoàn tất đăng ký và quyết định giữa tháng trước khi lập hóa đơn. Hóa đơn phát hành bất biến; bản 0.9 chưa có hóa đơn bổ sung vào tháng đã phát hành, hủy hóa đơn hoặc miễn công nợ chưa thu. Không dùng sửa SQL trực tiếp để xử lý trường hợp này.

Giá lấy từ chính sách có hiệu lực tại đầu tháng hoặc ngày bắt đầu đăng ký nếu muộn hơn. Đăng ký vào/ra hoặc thay đổi trạng thái trong tháng cần Quản lý/Admin nhập số tiền quyết định cho đăng ký đó và lý do. Không tự chia học phí theo số ngày.

Combo chọn đúng ba môn khác nhau, có thời gian hiệu lực, mức giảm cố định hoặc phần trăm và giới hạn giảm. Học viên phải đủ ba môn trong tháng; ba môn có thể ở ba lớp khác nhau. Giảm phân bổ theo giá gốc các dòng đủ điều kiện, làm tròn bằng phần dư lớn nhất để tổng giảm chính xác, không vượt giá gốc.

Phiếu thu ghi ngày thực thu, số tiền nguyên VND, tiền mặt/chuyển khoản, tham chiếu. Tự phân bổ công nợ cũ theo tháng rồi mã dòng ổn định; tiền còn dư là số dư học viên. Lập hóa đơn tiếp theo tự sử dụng số dư này. Không tính lương phần trăm trên phần tiền chưa phân bổ. Không nhập ngày thu/chi tương lai.

Mỗi thao tác tài chính có mã chống ghi trùng. Khi lỗi mạng, bấm lại trong cùng biểu mẫu với cùng dữ liệu để nhận lại kết quả, không tạo hai phiếu. Nếu đã thay nội dung sau lỗi không rõ kết quả, tải danh sách đối chiếu trước khi mở biểu mẫu mới.

Trong Chi tiết hóa đơn/Phiếu thu/Phiếu lương, chọn In/lưu PDF rồi chọn máy in “Save as PDF” hoặc “Microsoft Print to PDF”. Đây là phiếu quản lý nội bộ, không phải hóa đơn điện tử thuế. Xuất Excel tải tệp XLSX.

## Hoàn tiền

Kế toán tạo yêu cầu gắn phiếu thu gốc và lý do. Quản lý duyệt hoặc từ chối; sau khi thực sự chi tiền, chọn Thực hiện hoàn. Tổng yêu cầu đang chờ/đã duyệt/đã hoàn không vượt phiếu thu.

Hệ thống hoàn từ phần dư của phiếu thu trước. Nếu cần hoàn phần đã phân bổ, tạo bút toán âm liên kết bút toán gốc, giảm nghĩa vụ học phí tương ứng; không mở lại công nợ đã hoàn. Đây là hoàn/hủy phần học phí đã thu, không phải thao tác sửa nhầm một phiếu thu trong khi vẫn giữ nghĩa vụ thu. Tiền lương phần trăm giảm theo bút toán đảo. Kỳ đã chốt giữ nguyên; phần giảm chuyển kỳ mở hiện tại hoặc kỳ mở tiếp theo. Phiếu thu gốc không bị xóa.

## Lương

Các thành phần của mỗi phân công:

- % × thực thu đã phân bổ ròng, dùng chính sách snapshot của dòng hóa đơn.
- Tiền/buổi × số buổi được duyệt.
- Tiền/giờ × số giờ được duyệt (thời lượng thực tế của buổi).
- Cố định tháng: toàn bộ mức cố định nếu phân công có hiệu lực tại ngày đầu tháng; không tự chia ngày.
- Thưởng/khấu trừ nhập riêng theo giáo viên/kỳ, số âm là khấu trừ, phải có lý do.

Tiền theo buổi và giờ có thể cùng bật, tức được cộng cả hai. Nếu chỉ dùng một loại, để loại kia bằng 0. Doanh thu phần trăm được cộng theo giáo viên rồi làm tròn VND, tránh cộng sai số làm tròn từng bút toán. Một lớp–môn chỉ có một phân công trong cùng khoảng thời gian; đồng giảng chia tỷ lệ chưa có trong bản này.

Kỳ ghi nhận phân bổ không sớm hơn ngày thu, tháng hóa đơn và tháng thực hiện phân bổ. Nếu kỳ đó đã chốt thì chuyển sang kỳ mở tiếp theo. Chỉ chốt tháng đã kết thúc và không còn buổi chưa duyệt/hủy. Phiếu lương lưu các ID bút toán, buổi, chính sách và điều chỉnh để đối soát. Buổi duyệt muộn vào tháng đã chốt được tính ở kỳ mở tiếp theo. Chi lương chỉ dựa phiếu đã chốt, có thể chi nhiều lần nhưng không vượt số còn phải trả. Nếu tổng lương âm, xử lý bằng khoản điều chỉnh kỳ sau theo quyết định Quản lý; không tự chuyển số âm giữa các kỳ.

## Thu chi và báo cáo

Thu chi khác không nhập lại học phí, hoàn tiền hoặc chi lương. Báo cáo dùng ngày thu/chi cho dòng tiền và kỳ ghi nhận cho thực thu phân bổ. Lợi nhuận tạm tính = phân bổ ròng + thu khác − chi phí khác − lương phát sinh; đây là báo cáo vận hành, không phải sổ kế toán thuế. Công nợ và tiền đóng trước trên báo cáo là số hiện tại, không phải ảnh chụp số dư cuối tháng.

Bảng nghiệp vụ phân trang 100 dòng. Tìm kiếm học vụ chạy tại backend; bộ lọc các bảng nghiệp vụ tài chính hiện áp dụng trong trang đang xem (giao diện ghi rõ). Xuất Excel lấy toàn bộ danh mục tối đa 10.000 dòng, không chỉ trang đang xem. Chọn tháng để xem báo cáo/lương. Bộ chọn liên quan tải danh mục tối đa 10.000 bản ghi; cần tối ưu truy vấn tìm kiếm khi trung tâm vượt quy mô này.

## Nhập Excel

Trong Học viên, tải Mẫu Excel, điền tab HocVien; không đổi tên cột. Ngày YYYY-MM-DD; số điện thoại định dạng Text. Tệp .xlsx tối đa 2 MB/500 dòng, không nhận công thức. Chọn tệp, đọc bảng xem trước/lỗi và xác nhận. Backend tiếp tục kiểm tra; trùng họ tên chuẩn hóa + ngày sinh + khối hủy toàn bộ lượt nhập. Nhập Excel chỉ tạo học viên, không tự tạo đăng ký hay chứng từ tài chính.
