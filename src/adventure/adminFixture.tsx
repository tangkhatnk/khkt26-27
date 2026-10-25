import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { acceptTokens, clearTokens } from "../services/api";
import { AdminPanel } from "./AdminPanel";
import "./theme.css";
import "./adventure.css";

type FixtureMode = "allowed" | "denied" | "offline" | "revoked";
const fixtureOwnerId = "00000000-0000-4000-8000-000000000999";
const modeValues: FixtureMode[] = ["allowed", "denied", "offline", "revoked"];

function initialMode(): FixtureMode {
  const value = new URLSearchParams(window.location.search).get("mode");
  return modeValues.includes(value as FixtureMode) ? value as FixtureMode : "allowed";
}

function AdminFixtureApp() {
  const [mode, setMode] = useState<FixtureMode>(initialMode);
  const [theme, setTheme] = useState("light");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  const [deniedByRequest, setDeniedByRequest] = useState(false);
  const [panelGeneration, setPanelGeneration] = useState(0);
  const [failArmed, setFailArmed] = useState(false);
  const [reportFailArmed, setReportFailArmed] = useState(false);
  const [revokeArmed, setRevokeArmed] = useState(false);
  const failNext = useRef(false);
  const failNextReport = useRef(false);
  const revokeNextMutation = useRef(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/v1/")) return originalFetch(input, init);
      if (modeRef.current === "offline") throw new TypeError("Fixture network is offline.");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("x-admin-fixture-mode", modeRef.current);
      if (failNext.current) {
        headers.set("x-admin-fixture-fail-next", "true");
        failNext.current = false;
        setFailArmed(false);
      }
      if (failNextReport.current && new URL(url, window.location.origin).pathname === "/api/v1/admin/report") {
        headers.set("x-admin-fixture-fail-report", "true");
        failNextReport.current = false;
        setReportFailArmed(false);
      }
      if (revokeNextMutation.current && ["PUT", "PATCH", "DELETE"].includes((init?.method ?? "").toUpperCase())) {
        headers.set("x-admin-fixture-revoke-mutation", "true");
        revokeNextMutation.current = false;
        setRevokeArmed(false);
      }
      return originalFetch(input, { ...init, headers });
    }) as typeof window.fetch;

    void acceptTokens({
      access_token: "admin-fixture-token",
      refresh_token: "admin-fixture-refresh-token",
      expires_in: 3600,
    }).then(() => setReady(true));

    return () => {
      window.fetch = originalFetch;
      void clearTokens();
    };
  }, []);

  const chooseMode = (next: FixtureMode) => {
    modeRef.current = next;
    setMode(next);
    setDeniedByRequest(false);
    setFailArmed(false);
    setReportFailArmed(false);
    setRevokeArmed(false);
    failNext.current = false;
    failNextReport.current = false;
    revokeNextMutation.current = false;
    setPanelGeneration((value) => value + 1);
  };

  return <main className="adventure" style={{ padding: "18px", minHeight: "100vh" }}>
    <section style={{ maxWidth: 1180, margin: "0 auto 14px", padding: "14px 16px", border: "1px solid #d9dfd5", borderRadius: 14, background: "#fffdf8", color: "#31483c" }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase" }}>Fixture quản trị · chỉ dữ liệu tổng hợp</p>
      <p style={{ margin: "0 0 12px", color: "#647267", fontSize: 12 }}>API bị khóa vào loopback cổng 5194. Tài khoản, phiên học và email đều là dữ liệu giả; không dùng thông tin người học thật.</p>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <label htmlFor="admin-fixture-theme">Giao diện</label>
        <select id="admin-fixture-theme" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">Sáng</option><option value="dark">Tối</option></select>
        <label htmlFor="admin-fixture-mode" style={{ fontSize: 12, fontWeight: 700 }}>Kịch bản</label>
        <select id="admin-fixture-mode" value={mode} onChange={(event) => chooseMode(event.target.value as FixtureMode)} style={{ minHeight: 38, padding: "6px 10px", borderRadius: 9 }}>
          <option value="allowed">Quản trị được phép</option>
          <option value="denied">Từ chối trước khi mở panel</option>
          <option value="offline">Mất kết nối API</option>
          <option value="revoked">Quyền bị thu hồi</option>
        </select>
        <button type="button" disabled={mode !== "allowed"} onClick={() => { failNext.current = true; setFailArmed(true); }} style={{ minHeight: 38, padding: "6px 11px", borderRadius: 9 }}>
          {failArmed ? "Đã bật: lỗi một lần" : "Lỗi API kế tiếp"}
        </button>
        <button type="button" disabled={mode !== "allowed"} onClick={() => { failNextReport.current = true; setReportFailArmed(true); }} style={{ minHeight: 38, padding: "6px 11px", borderRadius: 9 }}>
          {reportFailArmed ? "Đã bật: lỗi báo cáo kế tiếp" : "Lỗi báo cáo kế tiếp"}
        </button>
        <button type="button" disabled={mode !== "allowed"} onClick={() => { revokeNextMutation.current = true; setRevokeArmed(true); }} style={{ minHeight: 38, padding: "6px 11px", borderRadius: 9 }}>
          {revokeArmed ? "Thu hồi ở lần sửa kế tiếp" : "Thu hồi khi xác nhận sửa"}
        </button>
        <button type="button" onClick={() => setPanelGeneration((value) => value + 1)} style={{ minHeight: 38, padding: "6px 11px", borderRadius: 9 }}>Tải lại panel</button>
      </div>
    </section>
    {mode === "denied" || deniedByRequest
      ? <section className="admin-panel" aria-labelledby="fixture-denied-title">
        <p className="admin-eyebrow">Viễn Du · Fixture</p>
        <h1 id="fixture-denied-title">Không có quyền quản trị</h1>
        <p>{mode === "denied" ? "Máy chủ fixture từ chối tài khoản trước khi mở panel." : "Máy chủ trả về 401/403. Panel đã xóa dữ liệu quản trị và yêu cầu kiểm tra quyền lại."}</p>
        <p>Tài khoản hiện tại trong fixture: <code>{fixtureOwnerId}</code></p>
        <button type="button" onClick={() => chooseMode("allowed")}>Mở lại fixture quản trị được phép</button>
      </section>
      : ready
        ? <AdminPanel
          key={mode + "-" + panelGeneration}
          currentUserId={fixtureOwnerId}
          onAccessDenied={() => setDeniedByRequest(true)}
          onClose={() => chooseMode("denied")}
        />
        : <section className="admin-panel"><p role="status">Đang khởi tạo token giả cho fixture…</p></section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<AdminFixtureApp />);
