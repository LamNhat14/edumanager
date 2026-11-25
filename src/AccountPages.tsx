import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth, type User } from "./auth";
import { api } from "./lib/api";
import { backendConfig } from "./lib/config";
const roles = [
  ["admin", "Admin"],
  ["manager", "Quản lý"],
  ["accountant", "Kế toán"],
  ["academic", "Học vụ"],
  ["teacher", "Giáo viên"],
];
const passwordRules = {
  required: "Nhập mật khẩu.",
  minLength: { value: 12, message: "Ít nhất 12 ký tự." },
  validate: (v: string) =>
    new TextEncoder().encode(v).length <= 72 || "Tối đa 72 byte UTF-8.",
};
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="error-box">
      {message}
    </p>
  ) : null;
}
export function AccountPage() {
  const { user, login, logout, clear } = useAuth();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<{
    username: string;
    password: string;
    current_password: string;
    confirm: string;
  }>({ shouldUnregister: true });
  const submit = handleSubmit(async (values) => {
    setError("");
    setMessage("");
    try {
      if (!user) {
        await login(values.username, values.password);
      } else {
        if (values.password !== values.confirm)
          throw new Error("Mật khẩu xác nhận không khớp.");
        await api("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({
            current_password: values.current_password,
            password: values.password,
          }),
        });
        clear();
        setMessage(
          "Đã đổi mật khẩu và thu hồi các phiên. Vui lòng đăng nhập lại.",
        );
      }
      reset();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <>
      <div className="eyebrow">TÀI KHOẢN NỘI BỘ</div>
      <h1>{user ? "Tài khoản của bạn" : "Đăng nhập EduManager"}</h1>
      <p className="intro">
        {user
          ? `${user.display_name} · ${user.username}`
          : "Sử dụng tài khoản do quản trị viên trung tâm cấp."}
      </p>
      <section className="panel account-form">
        <ErrorBox message={error} />
        {message && <p role="status">{message}</p>}
        {!backendConfig && (
          <div className="notice">
            Chưa cấu hình Supabase. Đăng nhập sẽ khả dụng sau khi triển khai
            backend và cấu hình kết nối.
          </div>
        )}
        {user?.must_change_password && (
          <div className="notice">
            Bạn cần đổi mật khẩu tạm thời trước khi sử dụng hệ thống.
          </div>
        )}
        <form onSubmit={submit}>
          {!user ? (
            <label>
              Tên đăng nhập
              <input
                autoComplete="username"
                {...register("username", { required: "Nhập tên đăng nhập." })}
              />
              <small>{errors.username?.message}</small>
            </label>
          ) : (
            <label>
              Mật khẩu hiện tại
              <input
                type="password"
                autoComplete="current-password"
                {...register("current_password", { required: true })}
              />
            </label>
          )}
          <label>
            {user ? "Mật khẩu mới" : "Mật khẩu"}
            <input
              type="password"
              autoComplete={user ? "new-password" : "current-password"}
              {...register(
                "password",
                user ? passwordRules : { required: "Nhập mật khẩu." },
              )}
            />
            <small>{errors.password?.message}</small>
          </label>
          {user && (
            <label>
              Xác nhận mật khẩu mới
              <input
                type="password"
                autoComplete="new-password"
                {...register("confirm", { required: true })}
              />
            </label>
          )}
          <button className="button" disabled={!backendConfig || isSubmitting}>
            {isSubmitting ? "Đang xử lý…" : user ? "Đổi mật khẩu" : "Đăng nhập"}
          </button>
        </form>
        {user && (
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await logout();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Đăng xuất
          </button>
        )}
        <p>
          Phiên lưu trong bộ nhớ trình duyệt. Tải lại trang sẽ cần đăng nhập
          lại.
        </p>
        <Link to="/setup">Hướng dẫn kết nối</Link>
      </section>
    </>
  );
}
export function UsersPage() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const allowed =
    !!user?.permissions.includes("users.manage") && !user.must_change_password;
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<User | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<{
    username: string;
    display_name: string;
    password: string;
    roles: string[];
    status: string;
    reason: string;
  }>({ shouldUnregister: true });
  const users = useQuery({
    queryKey: ["users", q, offset],
    queryFn: () =>
      api<User[]>(`/admin/users?q=${encodeURIComponent(q)}&offset=${offset}`),
    enabled: allowed,
  });
  function open(action: string, target: User | null = null) {
    setAction(action);
    setEditing(target);
    setError("");
    setSuccess("");
    reset({
      username: target?.username || "",
      display_name: target?.display_name || "",
      roles: target?.roles || ["academic"],
      status: target?.status || "active",
      password: "",
      reason: "",
    });
  }
  const submit = handleSubmit(async (v) => {
    setError("");
    try {
      let path = "/admin/users",
        method = "POST",
        data: Record<string, unknown> = v;
      if (editing) {
        data = { ...v, id: editing.id, version: editing.version };
        path += `/${editing.id}`;
        if (action === "edit") method = "PATCH";
        else if (action === "roles") {
          path += "/roles";
          method = "PUT";
        } else path += `/${action}`;
      }
      await api(path, { method, body: JSON.stringify(data) });
      setAction("");
      reset();
      setSuccess(
        "Đã lưu thay đổi. Các phiên liên quan được thu hồi khi cập nhật tài khoản.",
      );
      await cache.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setError((e as Error).message);
    }
  });
  if (!allowed)
    return (
      <section className="panel">
        <h1>Không có quyền truy cập</h1>
        <p>
          {user?.must_change_password
            ? "Hãy đổi mật khẩu tạm thời."
            : "Cần tài khoản có quyền quản lý người dùng."}
        </p>
        <Link to="/access" className="button">
          Đến tài khoản
        </Link>
      </section>
    );
  return (
    <>
      <div className="eyebrow">QUẢN TRỊ</div>
      <h1>Tài khoản và phân quyền</h1>
      <p>
        Chỉ Admin có quyền tạo tài khoản và gán vai trò. Không có đăng ký công
        khai.
      </p>
      <div className="toolbar">
        <input
          aria-label="Tìm tài khoản"
          placeholder="Tìm theo tên hoặc tên đăng nhập"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <button className="button" onClick={() => open("create")}>
          Thêm tài khoản
        </button>
        <button
          className="button secondary"
          onClick={() => void users.refetch()}
        >
          Tải lại
        </button>
      </div>
      {success && <p role="status">{success}</p>}
      {users.isPending && <p>Đang tải tài khoản…</p>}
      {users.isError && <ErrorBox message={users.error.message} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Họ tên / đăng nhập</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.display_name}</strong>
                  <br />
                  {u.username}
                </td>
                <td>
                  {u.roles
                    .map((r) => roles.find((x) => x[0] === r)?.[1] || r)
                    .join(", ")}
                </td>
                <td>
                  {u.status === "active" ? "Hoạt động" : "Đã khóa"}
                  {u.must_change_password && <small> · Cần đổi mật khẩu</small>}
                </td>
                <td>
                  <div className="actions">
                    <button onClick={() => open("edit", u)}>Sửa / khóa</button>
                    <button onClick={() => open("roles", u)}>Vai trò</button>
                    <button onClick={() => open("reset-password", u)}>
                      Đặt lại mật khẩu
                    </button>
                    <button onClick={() => open("revoke-sessions", u)}>
                      Thu hồi phiên
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.data?.length === 0 && <p>Không có tài khoản phù hợp.</p>}
      <div className="toolbar">
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(offset - 50)}
        >
          Trang trước
        </button>
        <span>Trang {offset / 50 + 1}</span>
        <button
          className="button secondary"
          disabled={users.data?.length !== 50}
          onClick={() => setOffset(offset + 50)}
        >
          Trang sau
        </button>
      </div>
      {action && (
        <div className="modal-backdrop">
          <section
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-dialog-title"
          >
            <h2 id="user-dialog-title">
              {action === "create"
                ? "Thêm tài khoản"
                : `${editing?.username} · ${action === "edit" ? "Sửa tài khoản" : action === "roles" ? "Gán vai trò" : action === "reset-password" ? "Đặt lại mật khẩu" : "Thu hồi mọi phiên"}`}
            </h2>
            <form onSubmit={submit}>
              <ErrorBox message={error} />
              {action === "create" && (
                <label>
                  Tên đăng nhập
                  <input
                    autoComplete="off"
                    {...register("username", {
                      required: true,
                      pattern: /^[a-z0-9_.-]{3,64}$/,
                    })}
                  />
                  {errors.username && (
                    <small>
                      Dùng 3–64 chữ thường, số, dấu chấm, gạch ngang hoặc gạch
                      dưới.
                    </small>
                  )}
                </label>
              )}
              {["create", "edit"].includes(action) && (
                <label>
                  Họ tên
                  <input
                    {...register("display_name", {
                      required: true,
                      maxLength: 120,
                    })}
                  />
                </label>
              )}
              {action === "edit" && (
                <label>
                  Trạng thái
                  <select {...register("status")}>
                    <option value="active">Hoạt động</option>
                    <option value="locked">Khóa tài khoản</option>
                  </select>
                </label>
              )}
              {["create", "reset-password"].includes(action) && (
                <label>
                  Mật khẩu tạm thời
                  <input
                    type="password"
                    autoComplete="new-password"
                    {...register("password", passwordRules)}
                  />
                  <small>
                    {errors.password?.message ||
                      "Ít nhất 12 ký tự. Người dùng phải đổi mật khẩu khi đăng nhập."}
                  </small>
                </label>
              )}
              {["create", "roles"].includes(action) && (
                <fieldset>
                  <legend>Vai trò</legend>
                  {roles.map(([code, label]) => (
                    <label className="checkbox-label" key={code}>
                      <input
                        type="checkbox"
                        value={code}
                        {...register("roles", {
                          validate: (v) => v.length > 0,
                        })}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
              {editing && (
                <label>
                  Lý do
                  <textarea
                    {...register("reason", { required: true, maxLength: 500 })}
                  />
                </label>
              )}
              <div className="toolbar">
                <button className="button" disabled={isSubmitting}>
                  {isSubmitting ? "Đang lưu…" : "Xác nhận"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={isSubmitting}
                  onClick={() => {
                    setAction("");
                    reset();
                  }}
                >
                  Hủy
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
export function AuditPage() {
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const allowed =
    !!user?.permissions.includes("audit.view") && !user.must_change_password;
  const logs = useQuery({
    queryKey: ["audit", offset],
    queryFn: () => api<any[]>(`/audit-logs?offset=${offset}`),
    enabled: allowed,
  });
  if (!allowed)
    return (
      <section className="panel">
        <h1>Không có quyền xem nhật ký</h1>
        <Link to="/access">Đến tài khoản</Link>
      </section>
    );
  return (
    <>
      <h1>Nhật ký thao tác</h1>
      <p>Lịch sử thay đổi không thể sửa hoặc xóa qua ứng dụng.</p>
      {logs.isPending && <p>Đang tải…</p>}
      {logs.isError && <ErrorBox message={logs.error.message} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Thời điểm</th>
              <th>Thao tác</th>
              <th>Người thực hiện</th>
              <th>Lý do / chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.occurred_at).toLocaleString("vi-VN")}</td>
                <td>{l.action}</td>
                <td>{l.actor_name || l.actor_id}</td>
                <td>
                  {l.reason || "—"}
                  <details>
                    <summary>Xem thay đổi</summary>
                    <pre>
                      {JSON.stringify(
                        { before: l.before_data, after: l.after_data },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {logs.data?.length === 0 && <p>Chưa có nhật ký.</p>}
      <div className="toolbar">
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(offset - 50)}
        >
          Trang trước
        </button>
        <button
          className="button secondary"
          onClick={() => void logs.refetch()}
        >
          Tải lại
        </button>
        <button
          className="button secondary"
          disabled={logs.data?.length !== 50}
          onClick={() => setOffset(offset + 50)}
        >
          Trang sau
        </button>
      </div>
    </>
  );
}
