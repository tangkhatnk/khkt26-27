import { useRef, useState, type ReactNode } from "react";
import type { ProfileStudySummary } from "./profileStats";
import "./profile.css";

export type ProfileAdminState = "checking" | "available" | "not-confirmed" | "offline" | "login-required";

export type ProfilePanelProps = {
  account: { id: string; name: string; email: string } | null;
  connectionLabel?: string;
  journey: {
    carriageName: string;
    stationLabel: string;
    stationIndex: number;
    stationCount: number;
  } | null;
  stats: {
    sessionCount: number;
    focusedSeconds: number;
    recentStudies: readonly ProfileStudySummary[];
  };
  admin: { state: ProfileAdminState; canRefresh: boolean };
  actions: {
    onSync: () => void;
    syncDisabled: boolean;
    onLogout: () => void;
    logoutDisabled: boolean;
    onExport: () => void;
    onOpenAdmin: () => void;
    onRefreshAdmin: () => void;
  };
  authContent?: ReactNode;
  privacyContent?: ReactNode;
};

const adminDescriptions: Record<ProfileAdminState, string> = {
  checking: "Đang kiểm tra quyền truy cập với máy chủ.",
  available: "Quyền quản trị đã được máy chủ xác nhận cho tài khoản này.",
  "not-confirmed": "Quyền quản trị do máy chủ cấp. Máy chủ chưa xác nhận quyền cho tài khoản này; nếu bạn cần quyền, hãy gửi mã tài khoản cho người phụ trách.",
  offline: "Kết nối lại máy chủ để kiểm tra quyền quản trị.",
  "login-required": "Đăng nhập bằng tài khoản được cấp quyền quản trị để mở khu vực này.",
};

export function formatProfileDuration(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
  if (minutes) return `${minutes} phút`;
  return `${total} giây`;
}

function profileDate(value: number) {
  if (!Number.isFinite(value)) return "Không rõ ngày";
  return new Date(value).toLocaleDateString("vi-VN", { day: "numeric", month: "short" });
}

function recentStudiesFirst(studies: readonly ProfileStudySummary[]) {
  return [...studies]
    .sort((first, second) => second.studiedAt - first.studiedAt)
    .slice(0, 4);
}

export function ProfilePanel({ account, connectionLabel, journey, stats, admin, actions, authContent, privacyContent }: ProfilePanelProps) {
  const accountIdRef = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const recentStudies = recentStudiesFirst(stats.recentStudies);
  const station = journey
    ? Math.max(0, Math.min(journey.stationIndex, Math.max(0, journey.stationCount - 1))) + 1
    : 0;

  const copyAccountId = async () => {
    if (!account) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(account.id);
        setCopyMessage("Đã sao chép mã tài khoản.");
        return;
      }
    } catch {
      // The visible selectable field below remains available as a manual fallback.
    }
    accountIdRef.current?.focus();
    accountIdRef.current?.select();
    setCopyMessage("Mã đã được chọn. Hãy sao chép thủ công.");
  };

  return <div className="profile-panel">
    <header className="profile-page-heading">
      <p className="profile-eyebrow">BẠN LỮ HÀNH</p>
      <h1>{account ? `Xin chào, ${account.name}` : "Giữ hành trình bên mình"}</h1>
      <p>{account
        ? "Hồ sơ, tiến độ và những chặng học gần đây của bạn."
        : "Học cá nhân không cần tài khoản. Đăng nhập để đồng bộ và cùng bạn bè khám phá."}</p>
    </header>

    <section className="profile-panel-card profile-identity-card" aria-label="Thông tin tài khoản">
      <div className="profile-monogram" aria-hidden="true">
        {(account?.name.trim().slice(0, 1) || "B").toLocaleUpperCase("vi-VN")}
      </div>
      <div className="profile-identity-copy">
        <p className="profile-card-kicker">{account ? "TÀI KHOẢN VIỄN DU" : "HÀNH TRÌNH TRÊN THIẾT BỊ NÀY"}</p>
          <h2>{account?.name ?? "Bạn lữ hành trên thiết bị này"}</h2>
        <p>{account?.email ?? "Dữ liệu đang được lưu trên thiết bị này."}</p>
        {connectionLabel && <span className="profile-connection-label">{connectionLabel}</span>}
      </div>
      {account && <div className="profile-account-id">
        <label htmlFor="profile-account-id">Mã tài khoản riêng</label>
        <div className="profile-id-row">
          <input
            id="profile-account-id"
            ref={accountIdRef}
            type="text"
            value={account.id}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className="profile-secondary-button" onClick={() => void copyAccountId()}>
            Sao chép mã tài khoản
          </button>
        </div>
        <p className="profile-copy-status" role="status">{copyMessage || "Bạn có thể chọn mã này để gửi cho người phụ trách."}</p>
      </div>}
    </section>

    {authContent && <div className="profile-auth-slot">{authContent}</div>}

    <section className={`profile-panel-card profile-admin-card profile-admin-${admin.state}`} aria-labelledby="profile-admin-title">
      <div className="profile-admin-copy">
        <p className="profile-card-kicker">CÔNG CỤ NỘI BỘ</p>
        <h2 id="profile-admin-title">Khu vực quản trị</h2>
        <p role="status" aria-live="polite">{adminDescriptions[admin.state]}</p>
      </div>
      <div className="profile-admin-actions">
        {admin.state === "available"
          ? <button type="button" className="profile-primary-button" onClick={actions.onOpenAdmin}>Mở khu vực quản trị</button>
          : admin.canRefresh && <button type="button" className="profile-secondary-button" disabled={admin.state === "checking"} onClick={actions.onRefreshAdmin}>
            {admin.state === "checking" ? "Đang kiểm tra…" : "Kiểm tra lại quyền"}
          </button>}
      </div>
    </section>

    <div className="profile-overview-grid">
      <section className="profile-panel-card profile-journey-card" aria-labelledby="profile-journey-title">
        <div className="profile-section-heading">
          <div>
            <p className="profile-card-kicker">TIẾN ĐỘ CỦA RIÊNG BẠN</p>
            <h2 id="profile-journey-title">Hành trình cá nhân</h2>
          </div>
          <span className="profile-card-icon" aria-hidden="true">⌁</span>
        </div>
        {journey
          ? <>
            <h3 className="profile-carriage-name">{journey.carriageName}</h3>
            <p className="profile-station-label">Đang ở trạm {journey.stationLabel}</p>
            <p className="profile-station-count">Chặng {station} / {Math.max(1, journey.stationCount)}</p>
          </>
          : <p className="profile-empty">Hành trình đang chờ bạn bắt đầu chuyến học đầu tiên.</p>}
      </section>

      <section className="profile-panel-card profile-study-stats" aria-labelledby="profile-stats-title">
        <div className="profile-section-heading">
          <div>
            <p className="profile-card-kicker">MỖI PHÚT ĐỀU CÓ Ý NGHĨA</p>
            <h2 id="profile-stats-title">Nhịp học tập</h2>
          </div>
          <span className="profile-card-icon" aria-hidden="true">◷</span>
        </div>
        <dl className="profile-stat-grid">
          <div>
            <dt>Phiên đã lưu</dt>
            <dd>{Math.max(0, Math.floor(stats.sessionCount))}</dd>
          </div>
          <div>
            <dt>Tổng thời gian đã ghi nhận</dt>
            <dd>{formatProfileDuration(stats.focusedSeconds)}</dd>
          </div>
        </dl>
      </section>
    </div>

    <section className="profile-panel-card profile-recent-card" aria-labelledby="profile-recent-title">
      <div className="profile-section-heading profile-recent-heading">
        <div>
          <p className="profile-card-kicker">GHI DẤU NHỮNG NỖ LỰC GẦN ĐÂY</p>
          <h2 id="profile-recent-title">Học gần đây</h2>
        </div>
        <span className="profile-recent-count">{recentStudies.length} phiên</span>
      </div>
      {recentStudies.length
        ? <ol className="profile-recent-list">
          {recentStudies.map((study) => <li key={study.id}>
            <div className="profile-study-date">{profileDate(study.studiedAt)}</div>
            <div className="profile-study-copy">
              <h3>{study.goal}</h3>
              <p>{study.topic}</p>
            </div>
            <span className="profile-study-duration">{formatProfileDuration(study.focusedSeconds)}</span>
          </li>)}
        </ol>
        : <p className="profile-empty">Nhật ký đang chờ chuyến đầu tiên. Bắt đầu học để lưu lại một chặng đường.</p>}
      <p className="profile-private-note">Chỉ hiển thị các chuyến của bạn; tài liệu và ghi chú không đưa vào hồ sơ.</p>
    </section>

    {account && <section className="profile-panel-card profile-account-actions" aria-label="Thao tác tài khoản">
      <div className="profile-account-actions-copy">
        <p className="profile-card-kicker">DỮ LIỆU CỦA BẠN</p>
        <h2>Giữ mọi thứ đồng bộ</h2>
        <p>Tiến độ tài khoản và tiến độ khách được lưu riêng, không tự cộng lại hai lần.</p>
      </div>
      <div className="profile-action-buttons">
        <button type="button" className="profile-primary-button" disabled={actions.syncDisabled} onClick={actions.onSync}>Đồng bộ tài khoản</button>
        <button type="button" className="profile-secondary-button" disabled={actions.logoutDisabled} onClick={actions.onLogout}>Đăng xuất</button>
        <button type="button" className="profile-secondary-button" onClick={actions.onExport}>Xuất dữ liệu riêng</button>
      </div>
      <p className="profile-action-note">Hoàn tất phiên đang chạy trước khi đăng xuất. Phiên chờ đồng bộ được giữ trên thiết bị cho lần đăng nhập sau.</p>
    </section>}

    {privacyContent && <div className="profile-privacy-slot">{privacyContent}</div>}
  </div>;
}
