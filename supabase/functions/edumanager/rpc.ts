import { AuthError } from "./auth.ts";
export const businessErrors: Record<string,string> = {
 REASON_REQUIRED:'Cần nhập lý do thao tác.',INVALID_FIELD:'Trường dữ liệu không được phép.',
 IMMUTABLE_ENROLLMENT:'Không sửa danh tính đăng ký. Hãy dùng chuyển lớp.',ENROLLMENT_OVERLAP:'Đăng ký trùng thời gian với môn đã học.',
 OUTSIDE_CLASS_DATES:'Ngày nằm ngoài thời gian lớp hoặc phân công.',IMPORT_LIMIT:'Mỗi lần nhập từ 1 đến 500 học viên.',DUPLICATE_STUDENT:'Trùng học viên theo họ tên, ngày sinh và khối. Toàn bộ lượt nhập đã hủy.',
 IMMUTABLE_LEDGER:'Chứng từ đã ghi sổ không được sửa hoặc xóa.',SCHEDULE_CONFLICT:'Trùng lịch giáo viên, phòng hoặc lớp–môn. Chưa lưu buổi nào.',
 TEACHER_NOT_LINKED:'Tài khoản chưa được Admin liên kết với hồ sơ giáo viên.',IDEMPOTENCY_REQUIRED:'Thiếu mã chống ghi trùng.',IDEMPOTENCY_CONFLICT:'Mã thao tác đã dùng cho dữ liệu khác. Hãy mở lại biểu mẫu.',
 ASSIGNMENT_OVERLAP:'Phân công trùng khoảng thời gian lớp–môn.',INVALID_STATE:'Trạng thái hiện tại không cho phép thao tác này.',INVALID_COMBO:'Combo cần đúng ba môn khác nhau, còn hiệu lực và đủ đăng ký.',
 OVERRIDE_APPROVAL_REQUIRED:'Chỉ Quản lý hoặc Admin được quyết định học phí khác giá niêm yết, kèm lý do.',POLICY_REQUIRED:'Thiếu học phí hoặc phân công giáo viên có hiệu lực.',
 MIDMONTH_DECISION_REQUIRED:'Đăng ký giữa tháng cần Quản lý quyết định số tiền và nhập lý do.',NO_ENROLLMENTS:'Không có đăng ký đủ điều kiện trong tháng.',
 REFUND_EXCEEDS_PAYMENT:'Tổng yêu cầu hoàn vượt số tiền phiếu thu.',PERIOD_NOT_ENDED:'Chỉ chốt kỳ lương đã kết thúc.',UNREVIEWED_SESSIONS:'Còn buổi dạy chưa duyệt hoặc hủy trong kỳ.',
 PERIOD_CLOSED:'Kỳ lương đã chốt. Chọn kỳ mở tiếp theo.',OVERPAYMENT:'Số chi vượt số lương còn phải trả.',
 ASSIGNMENT_IN_USE:'Còn lịch hoặc hóa đơn sau ngày kết thúc phân công. Hủy lịch tương lai hoặc chọn ngày sau chứng từ đã phát hành.',
};
export function restRpc(url: string, key: string) {
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Profile": "app_api",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok) {
      const message = String(body.message || "");
      if (businessErrors[message]) throw new AuthError(422,message,businessErrors[message]);
      if (['23502','23503','23514','22P02','22007','22008'].includes(body.code))
        throw new AuthError(422,'INVALID_INPUT','Dữ liệu thiếu, sai định dạng hoặc tham chiếu không hợp lệ. Kiểm tra các trường bắt buộc.');
      const code =
        [
          "UNAUTHENTICATED",
          "FORBIDDEN",
          "PASSWORD_CHANGE_REQUIRED",
          "NOT_FOUND",
          "CONFLICT",
          "LAST_ADMIN",
          "INVALID_INPUT",
          "INVALID_ROLE",
          "BOOTSTRAP_CLOSED",
        ].find((c) => message === c) ||
        (body.code === "23505" ? "DUPLICATE" : "BACKEND_ERROR");
      const messages: Record<string, string> = {
        UNAUTHENTICATED:
          "Phiên không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
        FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
        PASSWORD_CHANGE_REQUIRED: "Cần đổi mật khẩu trước khi tiếp tục.",
        LAST_ADMIN: "Không thể khóa hoặc gỡ vai trò Admin cuối cùng.",
        CONFLICT: "Dữ liệu đã thay đổi. Hãy tải lại.",
        DUPLICATE: "Bản ghi đã tồn tại (mã, kỳ hóa đơn hoặc kỳ lương bị trùng).",
        BOOTSTRAP_CLOSED: "Đã có tài khoản. Khởi tạo đã đóng.",
        INVALID_ROLE: "Vai trò không hợp lệ.",
        INVALID_INPUT: "Dữ liệu không hợp lệ.",
        NOT_FOUND: "Không tìm thấy bản ghi.",
        BACKEND_ERROR: "Không thể xử lý yêu cầu backend.",
      };
      throw new AuthError(
        code === "UNAUTHENTICATED"
          ? 401
          : ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(code)
            ? 403
            : [
                  "CONFLICT",
                  "LAST_ADMIN",
                  "DUPLICATE",
                  "BOOTSTRAP_CLOSED",
                ].includes(code)
              ? 409
              : code === "NOT_FOUND"
                ? 404
                : code.startsWith("INVALID")
                  ? 422
                  : 503,
        code,
        messages[code],
      );
    }
    return body;
  };
}
