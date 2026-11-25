import { AccountPage, UsersPage, AuditPage } from "./AccountPages";
import { BusinessPage } from './BusinessPages';
import { LocalSetup } from './LocalSetup';
import { useAuth } from "./auth";
import { useState } from "react";
import { NavLink, Route, Routes, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Database,
  Server,
  Check,
  ChevronRight,
  Menu,
  X,
  BookOpen,
  Users,
  CalendarDays,
  Wallet,
  FileChartColumn,
  LockKeyhole,
  CircleHelp,
  RefreshCw,
} from "lucide-react";
import { appName, backendConfig, centerName } from "./lib/config";
import { api } from "./lib/api";
const modules = [
  ["Học viên", "Hồ sơ và đăng ký nhiều môn", Users, "academic"],
  ["Lớp học", "Lớp, môn và phân công giáo viên", BookOpen, "classes"],
  ["Lịch học", "Lịch dạy và duyệt buổi học", CalendarDays, "schedule"],
  ["Học phí", "Hóa đơn, thanh toán và công nợ", Wallet, "billing"],
  ["Tiền lương", "Chính sách và chốt kỳ lương", FileChartColumn, "payroll"],
  [
    "Thu chi & báo cáo",
    "Đối soát và báo cáo quản trị",
    LayoutDashboard,
    "finance",
  ],
] as const;
function Connection() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ status: string }>("/health"),
    enabled: false,
  });
  return (
    <div className="connection">
      <div className="icon-square">
        <Server size={21} />
      </div>
      <div className="grow">
        <strong>Kết nối backend</strong>
        <p aria-live="polite">
          {!backendConfig
            ? "Chưa cấu hình Supabase"
            : health.isFetching
              ? "Đang kiểm tra Edge Function…"
              : health.isError
                ? health.error.message
                : health.data?.status === "ok"
                  ? "Edge Function phản hồi. Kết nối database cần kiểm tra riêng."
                  : "Đã có cấu hình. Chưa xác minh kết nối."}
        </p>
      </div>
      <button
        className="button secondary"
        disabled={!backendConfig || health.isFetching}
        onClick={() => void health.refetch()}
      >
        <RefreshCw size={16} className={health.isFetching ? "spin" : ""} />
        Kiểm tra
      </button>
    </div>
  );
}
function Overview() {
  return (
    <>
      <div className="eyebrow">KHÔNG GIAN QUẢN LÝ</div>
      <div className="page-heading">
        <div>
          <h1>
            Nền tảng cho một trung tâm
            <br className="desktop-break" /> vận hành hiệu quả.
          </h1>
          <p>
            Tập trung dữ liệu. Rõ ràng nghiệp vụ. An toàn trong từng thao tác.
          </p>
        </div>
        <span className="tag">EduManager · Vận hành trung tâm</span>
      </div>
      <div className="hero">
        <div>
          <span className="hero-label">EDUMANAGER / NHẬT NHƯ</span>
          <h2>
            Sẵn sàng từ một
            <br />
            nền tảng vững chắc.
          </h2>
          <p>
            Quản lý học viên, lớp học và tài chính trong cùng một không gian.
            Đăng nhập để làm việc với dữ liệu của trung tâm.
          </p>
          <Link className="button white" to="/access">
            Truy cập hệ thống
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit one" />
          <div className="orbit two" />
          <div className="art-card">
            <GraduationCap size={52} />
            <span>NHẬT NHƯ</span>
            <small>Chất lượng · Tận tâm · Hiệu quả</small>
          </div>
          <div className="floating-icon">
            <ShieldCheck size={25} />
          </div>
        </div>
      </div>
      <Connection />
      <div className="section-heading">
        <div>
          <h2>Các phân hệ quản lý</h2>
          <p>Chọn phân hệ để bắt đầu công việc</p>
        </div>
        <span className="subtle">Không có dữ liệu mẫu</span>
      </div>
      <div className="module-grid">
        {modules.map(([title, desc, Icon, phase]) => (
          <article className="module-card" key={title}>
            <div className="module-top">
              <span className="icon-square pale">
                <Icon size={22} />
              </span>
              <span className="phase">NGHIỆP VỤ</span>
            </div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <Link className="module-link" to={'/work/'+phase}>Mở phân hệ</Link>
          </article>
        ))}
      </div>
      <div className="note">
        <ShieldCheck size={20} />
        <p>
          Dữ liệu học viên và tài chính chỉ được truy cập sau khi xác thực và
          kiểm tra quyền tại backend.
        </p>
      </div>
    </>
  );
}
function Setup() {
  return (
    <>
      <div className="eyebrow">THIẾT LẬP HỆ THỐNG</div>
      <h1>Kết nối môi trường</h1>
      <p className="intro">
        Cấu hình thật được đọc khi khởi động hoặc build ứng dụng. Không nhập
        khóa đặc quyền vào trình duyệt.
      </p>
      <Connection />
      <section className="panel">
        <h2>Frontend</h2>
        <ol className="steps">
          <li>
            <strong>Tạo tệp môi trường</strong>
            <p>
              Sao chép <code>.env.example</code> thành <code>.env.local</code>{" "}
              trong thư mục dự án.
            </p>
          </li>
          <li>
            <strong>Điền thông tin dự án Supabase</strong>
            <pre>VITE_SUPABASE_URL=…{"\n"}VITE_SUPABASE_ANON_KEY=…</pre>
            <p>Chỉ dùng khóa công khai. Không dùng service role key.</p>
          </li>
          <li>
            <strong>Khởi động lại ứng dụng</strong>
            <p>
              Chạy <code>npm run dev</code>, sau đó kiểm tra kết nối phía trên.
            </p>
          </li>
        </ol>
      </section>
      <section className="panel">
        <h2>Backend và database</h2>
        <p>
          Áp dụng migrations, triển khai Edge Function <code>edumanager</code>{" "}
          và cấu hình <code>ALLOWED_ORIGINS</code> trên Supabase. Hướng dẫn chi
          tiết nằm trong README của dự án.
        </p>
        <div className="notice">
          <CircleHelp size={20} />
          <span>
            Kiểm tra health chỉ xác nhận Edge Function hoạt động; không chứng
            minh database hoặc đăng nhập đã sẵn sàng.
          </span>
        </div>
      </section>
    </>
  );
}
export function App() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState("");
  return (
    <div className="app-shell">
      <button
        className="skip"
        onClick={() => document.getElementById("main")?.focus()}
      >
        Đến nội dung chính
      </button>
      {open && (
        <button
          className="backdrop"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-icon">
            <GraduationCap size={25} />
          </span>
          <span>
            {appName}
            <small>TRUNG TÂM NHẬT NHƯ</small>
          </span>
        </Link>
        <button
          className="mobile-close"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
        <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
        <nav aria-label="Điều hướng chính">
          {(
            [
              ["/", "Tổng quan", LayoutDashboard],
              ["/setup", "Thiết lập kết nối", Settings],
              ["/access", "Truy cập hệ thống", ShieldCheck],
            ] as const
          ).map(([path, label, Icon]) => (
            <NavLink
              end={path === "/"}
              key={String(path)}
              to={String(path)}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} />
              <span>{String(label)}</span>
              <ChevronRight size={15} />
            </NavLink>
          ))}
          {user?.permissions.includes("users.manage") &&
            !user.must_change_password && (
              <NavLink to="/users" onClick={() => setOpen(false)}>
                <Users size={19} />
                Tài khoản và phân quyền
              </NavLink>
            )}
          {user?.permissions.includes("audit.view") &&
            !user.must_change_password && (
              <NavLink to="/audit" onClick={() => setOpen(false)}>
                <ShieldCheck size={19} />
                Nhật ký thao tác
              </NavLink>
            )}
          {user && !user.must_change_password && modules.filter(([, , , key]) => {
            const p=user.permissions;
            return key==='academic'||key==='classes'?p.includes('academic.view'):key==='schedule'?p.includes('schedule.view')||p.includes('schedule.own'):key==='billing'?p.includes('billing.view'):key==='payroll'?p.includes('payroll.view')||p.includes('payroll.own'):p.includes('finance.view');
          }).map(([name,,Icon,key])=><NavLink to={'/work/'+key} key={key} onClick={()=>setOpen(false)}><Icon size={19}/>{name}</NavLink>)}
          {user?.permissions.includes('settings.manage')&&!user.must_change_password&&<NavLink to="/work/settings" onClick={()=>setOpen(false)}><Settings size={19}/>Thông tin trung tâm</NavLink>}
        </nav>
        <div className="sidebar-message">
          <Database size={22} />
          <strong>
            Dữ liệu tập trung.
            <br />
            Quản lý nhất quán.
          </strong>
          <p>Học vụ, học phí và vận hành trong một hệ thống.</p>
        </div>
        <div className="sidebar-bottom">
          <span className="mini-mark">NN</span>
          <div>
            Trung tâm Nhật Như<small>Chất lượng – Tận tâm – Hiệu quả</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <button
            className="mobile-menu"
            aria-label="Mở menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu />
          </button>
          <span className="header-center">{centerName}</span>
          <div className="header-status">
            <span className="status-dot" />
            {user ? (
              <Link to="/access">{user.display_name}</Link>
            ) : (
              <Link to="/access">Đăng nhập</Link>
            )}
            {user && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await logout();
                    setLogoutError("");
                  } catch (e) {
                    setLogoutError((e as Error).message);
                  }
                }}
              >
                Đăng xuất
              </button>
            )}
            <span className="avatar">
              <LockKeyhole size={17} />
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {logoutError && (
            <p role="alert" className="error-box">
              {logoutError}
            </p>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/access" element={<AccountPage />} />
            <Route path="/local-setup" element={<LocalSetup />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/work/:section" element={<BusinessPage />} />
            <Route
              path="*"
              element={
                <section className="panel">
                  <h1>Không tìm thấy trang</h1>
                  <p>Đường dẫn không tồn tại hoặc chưa được triển khai.</p>
                  <Link className="button" to="/">
                    Về tổng quan
                  </Link>
                </section>
              }
            />
          </Routes>
          <footer>
            <span>
              {appName} · {centerName}
            </span>
            <span>EduManager v0.9.0 · Bản nghiệm thu</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
