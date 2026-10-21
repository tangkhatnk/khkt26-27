import { useEffect, useRef, useState } from "react";
import { useBrowserView } from "./navigation";
import { useAuthStore } from "@/store/authStore";
import { post, request, REGISTRATION_PASSWORD_HINT } from "@/services/api";
import { Scene } from "./Scene";
import { JourneyView } from "./JourneyView";
import { DurationPicker } from "./DurationPicker";
import { ExperimentResults, ExperimentShare } from "./ExperimentResults";
import { studyTopics } from "./topics";
import {
  depart,
  elapsedSeconds,
  focused,
  leaveFocusView,
  restore,
  returnFromBackground,
  sessionEndAt,
  tick,
  type ActiveTrip,
} from "./focus";
import { emptySaved, readSaved, writeSaved, type Saved } from "./storage";
import {
  localDayKey,
  millisecondsUntilNextLocalDay,
  shouldRefreshWorkspaceClock,
} from "./idleClock";
import {
  person,
  settle,
  snapshot,
  type Session,
  type Snapshot,
} from "../../backend/src/adventure/domain";
import "./adventure.css";
const stations = [
  "Ga Khởi đầu",
  "Đồng cỏ Gió",
  "Rừng Sương mù",
  "Đèo Ánh sao",
  "Thành phố Bình minh",
];
const stories = [
  "Một tấm vé nhỏ, một hành trình lớn. Toa của bạn đã sẵn sàng.",
  "Gió mang theo hương cỏ mới. Mỗi phút tập trung là một bước đến chân trời.",
  "Trong làn sương, bạn tìm thấy một mảnh bản đồ. Núi cao hay bờ biển đang chờ phía trước?",
  "Những vì sao soi đường. Bạn đã đi xa hơn chính mình của ngày hôm qua.",
  "Bình minh lên trên những mái nhà. Mỗi nỗ lực nhỏ đã góp thành chuyến đi này.",
];
const nav = [
  { id: "station", icon: "⌂", label: "Ga chính" },
  { id: "map", icon: "⌁", label: "Bản đồ hành trình" },
  { id: "carriage", icon: "▣", label: "Toa của tôi" },
  { id: "group", icon: "♧", label: "Đoàn tàu" },
  { id: "journal", icon: "▤", label: "Nhật ký học tập" },
  { id: "experiments", icon: "◎", label: "Kết quả tester" },
];
const clock = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const date = (time: number) =>
  new Date(time).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
type MaterialInfo = { name: string; size: number; type: string; status: string; message: string };
type Question = {
  id: string;
  question: string;
  options: string[];
  correct_index?: number;
  correctAnswerIndex?: number;
  explanation: string;
};
export default function AdventureApp() {
  const { user, bootstrap, ready } = useAuthStore();
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  if (!ready) return <div className="adventure empty">Đang mở hành trình…</div>;
  return <AdventureWorkspace key={user?.id ?? "guest"} />;
}
function AdventureWorkspace() {
  const [requestedView, setView] = useBrowserView();
  const views = ["station", "map", "carriage", "group", "journal", "experiments", "ticket", "focus", "summary", "account"];
  const view = views.includes(requestedView) ? requestedView : "station";
  const { user, login, logout, offline: authOffline, needsLogin } = useAuthStore();
  const owner = user?.id ?? "guest";
  const [saved, setSaved] = useState<Saved>(emptySaved);
  const current = useRef(saved),
    ownerRef = useRef(owner);
  const hasActiveTrip = Boolean(saved.active);
  const [loaded, setLoaded] = useState(false),
    [exclusive, setExclusive] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(() => Date.now()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true);
  const lastLocalDay = useRef(localDayKey(now));
  const [goal, setGoal] = useState(""),
    [topic, setTopic] = useState("biology"),
    [documentText, setDocumentText] = useState("");
  const [materials, setMaterials] = useState<MaterialInfo[]>([]);
  const [minutes, setMinutes] = useState(25),
    [mode, setMode] = useState<"solo" | "group">("solo");
  const [carriageName, setCarriageName] = useState(""),
    [groupName, setGroupName] = useState(""),
    [invite, setInvite] = useState("");
  const [inviteResult, setInviteResult] = useState<{
    token: string;
    expires: number;
  } | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [confirm, setConfirm] = useState<"finish" | "leave" | "reset" | null>(null),
    [summary, setSummary] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [revealed, setRevealed] = useState(false);
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const commitRef = useRef<(v: Saved) => boolean>(() => false);
  function commit(value: Saved) {
    if (
      ownerRef.current !== "guest" &&
      value.snapshot &&
      current.current.snapshot &&
      value.snapshot.revision < current.current.snapshot.revision
    )
      value = { ...value, snapshot: current.current.snapshot };
    try {
      writeSaved(ownerRef.current, value);
      current.current = value;
      setSaved(value);
      return true;
    } catch {
      setError(
        "Không lưu được trên thiết bị. Có thể bộ nhớ đã đầy. Hãy xuất dữ liệu; phiên hiện tại chưa bị xóa.",
      );
      return false;
    }
  }
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    ownerRef.current = owner;
    let release: (() => void) | undefined,
      disposed = false;
    if (!navigator.locks) {
      queueMicrotask(() =>
        setError(
          "Trình duyệt cần hỗ trợ Web Locks và kết nối HTTPS hoặc localhost.",
        ),
      );
      return;
    }
    void navigator.locks.request(
      `train-adventure:${owner}`,
      { ifAvailable: true },
      async (lock) => {
        if (disposed) return;
        if (!lock) {
          setError(
            "Hành trình đang mở ở cửa sổ khác. Đóng cửa sổ đó rồi tải lại để tiếp tục.",
          );
          return;
        }
        try {
          const value = readSaved(owner);
          if (value.active) value.active = restore(value.active, Date.now());
          if (owner === "guest")
            value.snapshot = snapshot(value.local, owner, Date.now());
          if (commitRef.current(value)) {
            setLoaded(true);
            setExclusive(true);
          }
        } catch (e) {
          setStorageError(true);
          setError(e instanceof Error ? e.message : "Không đọc được dữ liệu.");
        }
        await new Promise<void>((resolve) => {
          release = resolve;
          if (disposed) resolve();
        });
      },
    );
    return () => {
      disposed = true;
      release?.();
    };
  }, [owner]);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refreshClock = () => {
      const at = Date.now();
      const currentDay = localDayKey(at);
      if (
        shouldRefreshWorkspaceClock(
          hasActiveTrip,
          lastLocalDay.current,
          currentDay,
        )
      ) {
        lastLocalDay.current = currentDay;
        setNow(at);
      }
      return at;
    };
    const scheduleNextLocalDay = () => {
      timeout = setTimeout(() => {
        refreshClock();
        scheduleNextLocalDay();
      }, millisecondsUntilNextLocalDay(Date.now()) + 50);
    };
    refreshClock();
    if (hasActiveTrip) {
      interval = setInterval(() => {
        const at = refreshClock();
        const trip = current.current.active;
        if (trip && elapsedSeconds(trip, at) >= trip.target)
          finishRef.current();
      }, 1000);
    }
    else scheduleNextLocalDay();
    const connectivity = () => setOnline(navigator.onLine);
    connectivity();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshClock);
    return () => {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshClock);
    };
  }, [hasActiveTrip]);
  useEffect(() => {
    if (!loaded || !exclusive) return;
    const checkpoint = () => {
      const s = current.current;
      if (s.active) {
        const at = Date.now();
        const active = view === "focus" && !document.hidden && document.hasFocus()
          ? returnFromBackground(s.active, at)
          : tick(s.active, at);
        commitRef.current({ ...s, active });
      }
    };
    const away = () => {
      if (current.current.active)
        commitRef.current({
          ...current.current,
          active: depart(current.current.active, Date.now()),
        });
    };
    const returned = () => {
      const s = current.current;
      if (s.active && view === "focus" && !document.hidden && document.hasFocus())
        commitRef.current({ ...s, active: returnFromBackground(s.active, Date.now()) });
    };
    const visibility = () => document.hidden ? away() : returned();
    const interval = setInterval(checkpoint, 5000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", away);
    window.addEventListener("blur", away);
    window.addEventListener("focus", returned);
    if (view !== "focus" && current.current.active)
      commitRef.current({ ...current.current, active: leaveFocusView(current.current.active, Date.now()) });
    else returned();
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", returned);
    };
  }, [loaded, exclusive, view]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Thao tác chưa hoàn tất. Hãy thử lại.",
      );
    } finally {
      setBusy(false);
    }
  }
  const syncing = useRef<Promise<void> | null>(null);
  function sync(): Promise<void> {
    if (needsLogin) return Promise.reject(new Error("Đăng nhập lại để đồng bộ. Phiên và dữ liệu cục bộ vẫn được giữ."));
    if (syncing.current) return syncing.current;
    const id = ownerRef.current;
    if (id === "guest") return Promise.resolve();
    syncing.current = (async () => {
      while (current.current.pending.length) {
        const session = current.current.pending[0];
        const result = await post<Snapshot>("/adventure/sessions", session);
        if (ownerRef.current !== id) return;
        if (
          !commit({
            ...current.current,
            pending: current.current.pending.filter((p) => p.id !== session.id),
            snapshot: result,
          })
        )
          return;
      }
      const result = await request<Snapshot>("/adventure");
      if (ownerRef.current === id)
        commit({ ...current.current, snapshot: result });
    })().finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }
  useEffect(() => {
    if (!loaded || owner === "guest" || !online || needsLogin) return;
    let disposed = false;
    void sync()
      .then(() =>
        request<{ topics: { id: string; name: string }[] }>("/topics"),
      )
      .then((r) => {
        if (!disposed) {
          setTopics(r.topics);
        }
      })
      .catch((e) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Chưa đồng bộ được.");
      });
    return () => {
      disposed = true;
    };
    // Sync on sign-in and reconnection; explicit refresh is also available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, owner, online, needsLogin]);
  const data = saved.snapshot;
  const carriage = data?.person;
  const group = data?.group;
  const journey = mode === "group" && group ? group.journey : carriage?.journey;
  const trainCars =
    mode === "group" && group
      ? group.members
      : [
          {
            id: owner,
            name: carriage?.name ?? "Toa Mây",
            color: carriage?.color ?? "#398575",
          },
        ];
  const availableTopics = [
    ...studyTopics,
    ...topics.filter((t) => !studyTopics.some((s) => s.id === t.id)),
  ];
  const active = saved.active
    ? tick(saved.active, Math.max(now, saved.active.lastAt))
    : null;
  const sessions = [...saved.pending, ...(data?.sessions ?? [])];
  const minutesTotal = Math.floor((carriage?.seconds ?? 0) / 60);
  const go = (next: string) => {
    if (next !== "focus" && current.current.active)
      commit({ ...current.current, active: leaveFocusView(current.current.active, Date.now()) });
    setError("");
    setNotice("");
    setView(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  async function mutation(path: string, body: unknown) {
    if (needsLogin) throw new Error("Đăng nhập lại để cập nhật đoàn hoặc đồng bộ trang trí.");
    const id = ownerRef.current;
    const result = await post<Snapshot>(`/adventure/${path}`, body);
    if (ownerRef.current === id)
      commit({ ...current.current, snapshot: result });
  }
  function start() {
    if (
      !loaded ||
      !exclusive ||
      current.current.active ||
      goal.trim().length < 3 ||
      minutes < 1 ||
      minutes > 240 ||
      !Number.isInteger(minutes)
    )
      return;
    const at = Date.now();
    const trip: ActiveTrip = {
      id: crypto.randomUUID(),
      owner,
      goal: goal.trim(),
      topic,
      document: documentText,
      materials,
      target: minutes * 60,
      groupId: mode === "group" && group ? group.id : null,
      started: at,
      lastAt: at,
      segments: [],
      state: "focus",
      reconnect: 0,
    };
    if (commit({ ...current.current, active: trip })) {
      setSummary(null);
      go("focus");
    }
  }
  function finish() {
    const trip = current.current.active;
    const at = Date.now();
    if (!trip || at < trip.lastAt) return;
    const next = tick(trip, at);
    const s: Session = {
      id: next.id,
      userId: owner,
      groupId: next.groupId,
      goal: next.goal,
      topic: next.topic,
      started: next.started,
      ended: sessionEndAt(trip, at),
      target: next.target,
      segments: next.segments,
      seconds: focused(next),
      contribution: 0,
      rules: "train-v1",
      distractions: next.distractions ?? 0,
    };
    const value = structuredClone(current.current);
    value.active = null;
    value.notes[s.id] = next.document;
    (value.materials ??= {})[s.id] = next.materials ?? [];
    if (owner === "guest") {
      try {
        const result = settle(value.local, s, at);
        value.snapshot = snapshot(value.local, owner, at);
        s.contribution = result.contribution;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không lưu được phiên.");
        return;
      }
    } else value.pending.push(s);
    if (commit(value)) {
      setConfirm(null);
      setSummary(s);
      setQuestions([]);
      setAnswers({});
      setRevealed(false);
      go("summary");
      if (user && online) void run(sync);
    }
  }
  useEffect(() => {
    finishRef.current = finish;
  });
  async function customize(
    color = carriage?.color ?? "#398575",
    decor = carriage?.decor ?? "plant",
    at = now,
  ) {
    const value = {
      name: carriageName.trim() || carriage?.name || "Toa Mây",
      color,
      decor,
    };
    if (user) await mutation("carriage", value);
    else {
      const local = structuredClone(current.current.local);
      Object.assign(person(local, owner), value);
      commit({
        ...current.current,
        local,
        snapshot: snapshot(local, owner, at),
      });
    }
    setNotice("Đã lưu toa của bạn.");
  }
  function exportData() {
    downloadData(JSON.stringify(current.current, null, 2), "vien-du-backup.json");
  }
  async function importMaterials(files: File[]) {
    if (!files.length) return;
    if (files.length > 10 || materials.length + files.length > 10) {
      setError("Mỗi chuyến tối đa 10 tài liệu. Hãy gộp nội dung hoặc bắt đầu chuyến mới.");
      return;
    }
    await run(async () => {
      const { extractMaterialFile } = await import("./materialExtraction");
      let text = documentText;
      const imported: MaterialInfo[] = [];
      for (const file of files) {
        const header = `\n\n--- ${file.name} ---\n`;
        const remaining = Math.max(0, 50000 - text.length - header.length);
        const result = await extractMaterialFile(file, { maxTextChars: remaining });
        const { name, size, type, status, message } = result;
        imported.push({ name, size, type, status, message });
        if (result.text) text += header + result.text;
      }
      setDocumentText(text);
      setMaterials((current) => [...current, ...imported]);
      setNotice("Đã kiểm tra tài liệu trên thiết bị. Chỉ nội dung trong ô ghi chú được gửi khi bạn chọn tạo quiz AI.");
    });
  }
  function exportRawData() {
    try {
      downloadData(localStorage.getItem(`train-adventure:v1:${owner}`) ?? "null", "vien-du-recovery.json");
    } catch {
      setError("Trình duyệt đang chặn truy cập bộ nhớ. Hãy bật lưu trữ cho ứng dụng rồi tải lại.");
    }
  }
  function downloadData(text: string, filename: string) {
    const blob = new Blob([text], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function loadQuiz(ai: boolean) {
    if (!summary || !user) return;
    await sync();
    const text = current.current.notes[summary.id]?.trim();
    const result = ai
      ? await post<Question[]>("/quiz/generate", {
          topic: summary.topic,
          count: 3,
          ...(text ? { documentText: text } : {}),
        })
      : (
          await request<{ questions: Question[] }>(
            `/quizzes?topic_id=${encodeURIComponent(summary.topic)}&limit=3`,
          )
        ).questions;
    if (!result.length)
      throw new Error("Chủ đề chưa có câu hỏi. Phiên học vẫn đã được lưu.");
    setQuestions(result);
    setAnswers({});
    setRevealed(false);
  }
  const progress = journey
    ? Math.min(100, (journey.remaining / journey.threshold) * 100)
    : 0;
  return (
    <div className="adventure">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("station");
          }}
        >
          <span className="brand-icon">▥</span>
          <span>
            viễn du<small>HỌC TẬP · KHÁM PHÁ</small>
          </span>
        </a>
        <div className="nav-heading">KHÔNG GIAN CỦA BẠN</div>
        <nav aria-label="Điều hướng chính">
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "nav active" : "nav"}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => go(n.id)}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.id === "station" && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="little-ticket">
            <span>✧ Mỗi ngày một chút</span>
            <p>
              Không cần đi thật nhanh.
              <br />
              Chỉ cần tiếp tục hành trình.
            </p>
          </div>
          <button className="account" onClick={() => go("account")}>
            <span className="avatar">{(user?.name ?? "B")[0]}</span>
            <span>
              {user?.name ?? "Bạn lữ hành"}
              <small>
                {user ? "Tài khoản của bạn" : "Đang học trên thiết bị này"}
              </small>
            </span>
            <span>↗</span>
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>
            Không gian học tập <span className="slash">/</span>{" "}
            <strong>
              {nav.find((n) => n.id === view)?.label ??
                (
                  {
                    ticket: "Vé học",
                    focus: "Chuyến đang chạy",
                    summary: "Thành quả",
                    account: "Tài khoản",
                  } as Record<string, string>
                )[view] ??
                "Ga chính"}
            </strong>
          </span>
          <div className="top-actions">
            <span className={`connection ${online ? "" : "offline"}`}>
              {online && !authOffline && !needsLogin
                ? "● Sẵn sàng lên đường"
                : "○ Đang offline"}
            </span>
            <button
              aria-label="Mở tài khoản"
              className="avatar"
              onClick={() => go("account")}
            >
              {(user?.name ?? "B")[0]}
            </button>
          </div>
        </header>
        <main key={view} className="view-entrance">
          {error && (
            <div className="message error" role="alert">
              {error}
              <button
                aria-label="Đóng thông báo lỗi"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="message" role="status">
              {notice}
            </div>
          )}
          {needsLogin && <div className="sync-banner"><span>Hành trình đang dùng dữ liệu trên thiết bị. Đăng nhập lại để đồng bộ; bạn vẫn có thể tiếp tục học.</span><button onClick={() => go("account")}>Đăng nhập lại</button></div>}
          {saved.pending.length > 0 && (
            <div className="sync-banner">
              <span>
                {saved.pending.length} phiên đã lưu trên thiết bị · chờ máy chủ
                xác nhận
              </span>
              <button
                disabled={busy || !user || !online || needsLogin}
                onClick={() => void run(sync)}
              >
                Đồng bộ lại ↻
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="empty">
              <h1>{storageError ? "Cần khôi phục dữ liệu hành trình" : error ? "Chưa mở được hành trình" : "Đang mở toa của bạn…"}</h1>
              <p>{storageError ? "Tải bản dữ liệu gốc để giữ lại trước khi tạo hành trình mới trên thiết bị này." : "Dữ liệu hành trình sẽ xuất hiện tại đây."}</p>
              {storageError && <div className="choice-row">
                <button className="primary" onClick={exportRawData}>Tải dữ liệu gốc</button>
                <button onClick={() => setConfirm("reset")}>Tạo lại hành trình cục bộ</button>
              </div>}
              {error && <button onClick={() => window.location.reload()}>Thử mở lại</button>}
            </div>
          ) : (
            <>
              {view === "station" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        CHƯƠNG 01 · THEO DẤU BÌNH MINH
                      </div>
                      <h1>
                        Một hành trình mới,
                        <br />
                        bắt đầu từ hôm nay<span className="orange">.</span>
                      </h1>
                      <p>
                        Dành một khoảng lặng cho việc học. Để toa tàu đưa bạn đi
                        xa.
                      </p>
                    </div>
                    <div className="date-chip">
                      ◷{" "}
                      <span>
                        {new Date(now).toLocaleDateString("vi-VN", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="dashboard-grid">
                    <section className="hero-card">
                      <div className="hero-label">
                        <span className="pill">
                          ✦ HÀNH TRÌNH CỦA{" "}
                          {mode === "group" && group ? "ĐOÀN" : "BẠN"}
                        </span>
                        <span className="chapter">
                          0{(journey?.station ?? 0) + 1} / 05
                        </span>
                      </div>
                      <JourneyView
                        journey={journey}
                        carriages={trainCars}
                        ownId={owner}
                        decor={carriage?.decor}
                      />
                      <div className="hero-caption">
                        <div>
                          <span className="eyebrow">BẠN ĐANG Ở</span>
                          <h2>{stations[journey?.station ?? 0]}</h2>
                          <p>{stories[journey?.station ?? 0]}</p>
                        </div>
                        <button
                          className="round-button"
                          aria-label="Xem bản đồ"
                          onClick={() => go("map")}
                        >
                          ↗
                        </button>
                      </div>
                      <div className="journey-progress">
                        <div>
                          <span>
                            {journey?.station === 4
                              ? "Đã đến đích · phần dư được giữ lại"
                              : `Trạm tiếp theo: ${stations[(journey?.station ?? 0) + 1]}`}
                          </span>
                          <strong>
                            {Math.floor((journey?.remaining ?? 0) / 60)} /{" "}
                            {Math.floor((journey?.threshold ?? 1800) / 60)} phút
                          </strong>
                        </div>
                        <progress max="100" value={progress} />
                      </div>
                    </section>
                    <section className="ticket-card">
                      <div className="eyebrow">CHUYẾN ĐI TIẾP THEO</div>
                      <h2>
                        Mang mục tiêu nhỏ,
                        <br />
                        đi một chặng xa.
                      </h2>
                      <p>
                        Mỗi phút tập trung nuôi lớn toa tàu và mở ra vùng đất
                        mới.
                      </p>
                      <div className="ticket-divider" />
                      <label className="field-label" htmlFor="quick-goal">
                        HÔM NAY BẠN MUỐN HỌC GÌ?
                      </label>
                      <textarea
                        id="quick-goal"
                        maxLength={500}
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="Ví dụ: Hiểu chương 2 môn Sinh học…"
                        rows={3}
                      />
                      <DurationPicker value={minutes} onChange={setMinutes} />
                      <button
                        className="primary"
                        onClick={() => go(active ? "focus" : "ticket")}
                      >
                        {active
                          ? "Tiếp tục chuyến đang học"
                          : "Chuẩn bị lên tàu"}{" "}
                        <span>→</span>
                      </button>
                      <small className="ticket-footnote">
                        ♧ Đi một mình cũng là một hành trình đẹp.
                      </small>
                    </section>
                  </div>
                  <div className="stat-row">
                    <Stat
                      icon="◷"
                      label="PHÚT ĐÃ TẬP TRUNG"
                      value={`${minutesTotal}`}
                      detail="Từng phút đều có ý nghĩa"
                    />
                    <Stat
                      icon="▤"
                      label="CHUYẾN ĐÃ LƯU"
                      value={`${sessions.length}`}
                      detail="Gồm cả những chặng ngắn"
                    />
                    <Stat
                      icon="⚑"
                      label="TRẠM ĐÃ KHÁM PHÁ"
                      value={`${(carriage?.journey.station ?? 0) + 1} / 5`}
                      detail="Một thế giới đang chờ bạn"
                    />
                  </div>
                  <div className="section-heading">
                    <h2>Hành trình là của bạn</h2>
                    <span>Từng bước nhỏ, mỗi ngày</span>
                  </div>
                  <div className="feature-row">
                    <button className="feature" onClick={() => go("carriage")}>
                      <span className="feature-icon peach">▣</span>
                      <div>
                        <h3>Một toa mang dấu ấn riêng</h3>
                        <p>Đổi màu, đặt tên và lưu những kỷ niệm.</p>
                      </div>
                      <span>↗</span>
                    </button>
                    <button className="feature" onClick={() => go("group")}>
                      <span className="feature-icon green">♧</span>
                      <div>
                        <h3>Cùng bạn bè đi xa hơn</h3>
                        <p>Nối toa. Khác lịch học, chung điểm đến.</p>
                      </div>
                      <span>↗</span>
                    </button>
                  </div>
                </>
              )}
              {view === "ticket" && (
                <>
                  <Heading
                    kicker="TẤM VÉ CỦA BẠN"
                    title="Bạn muốn đi đâu hôm nay?"
                    text="Chọn một mục tiêu vừa sức. Bạn có thể kết thúc và lưu phần đã học."
                  />
                  <div className="two-columns">
                    <section className="panel form">
                      <label>
                        Mục tiêu học tập
                        <textarea
                          value={goal}
                          maxLength={500}
                          onChange={(e) => setGoal(e.target.value)}
                          placeholder="Mình muốn hiểu điều gì sau chuyến này?"
                        />
                      </label>
                      <label>
                        Chủ đề
                        <select
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                        >
                          {availableTopics.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <DurationPicker value={minutes} onChange={setMinutes} />
                      <label>
                        Tài liệu / ghi chú riêng
                        <textarea
                          rows={5}
                          maxLength={50000}
                          disabled={busy}
                          value={documentText}
                          onChange={(e) => setDocumentText(e.target.value)}
                          placeholder="Dán nội dung bài học. Chỉ gửi tới dịch vụ AI khi bạn chọn tạo quiz."
                        />
                      </label>
                      <label className="file-label">
                        Nhập tài liệu · mọi loại tệp
                        <input
                          type="file"
                          multiple
                          disabled={busy}
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            e.target.value = "";
                            void importMaterials(files);
                          }}
                        />
                      </label>
                      <p className="material-hint">Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), PDF, OpenDocument và văn bản. Tối đa 20 MB/tệp, 10 tệp/chuyến, 50.000 ký tự. Tệp chưa hỗ trợ đọc vẫn hiển thị tên và báo trạng thái.</p>
                      {!!materials.length && <ul className="material-list" aria-label="Tài liệu đã chọn">{materials.map((file, i) => <li key={`${i}:${file.name}`}>
                        <strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · {file.message}</span>
                      </li>)}</ul>}
                    </section>
                    <section className="panel form">
                      <div className="eyebrow">ĐIỂM ĐẾN</div>
                      <h2>{stations[journey?.station ?? 0]}</h2>
                      <div className="choice-row">
                        <button
                          className={mode === "solo" ? "selected" : ""}
                          onClick={() => setMode("solo")}
                        >
                          Một mình
                        </button>
                        <button
                          disabled={!group}
                          className={mode === "group" ? "selected" : ""}
                          onClick={() => setMode("group")}
                        >
                          Cùng đoàn
                        </button>
                      </div>
                      <p>
                        {mode === "group"
                          ? "Đóng góp được máy chủ xác nhận sau phiên, tối đa 60 phút/ngày theo múi giờ đoàn."
                          : "Tiến độ được giữ trong hành trình cá nhân của bạn."}
                      </p>
                      <div className="info-box">
                        <h3>Hỗ trợ tập trung</h3>
                        <p>
                          Khi bạn rời cửa sổ, đồng hồ vẫn tiếp tục nhưng khoảng đó được ghi là
                          xao nhãng và không cộng vào thời gian học. Khi quay lại, phiên tiếp
                          tục ngay. Bạn có thể kết thúc và lưu phần đã học bất cứ lúc nào.
                        </p>
                        <p>
                          Web và bản desktop này chỉ nhắc tập trung; không chặn
                          ứng dụng khác.
                        </p>
                        <p>Đồng bộ phiên trong 30 ngày từ lúc bắt đầu. Khi offline, hãy giữ dữ liệu trình duyệt hoặc xuất bản sao.</p>
                        <p>
                          Quiz là tùy chọn. Điểm thấp không trừ tiến độ của bạn
                          hoặc đoàn.
                        </p>
                      </div>
                      <button
                        className="primary"
                        disabled={
                          !!active ||
                          goal.trim().length < 3 ||
                          !Number.isInteger(minutes) ||
                          minutes < 1 ||
                          minutes > 240 ||
                          !exclusive
                        }
                        onClick={start}
                      >
                        Bắt đầu chuyến ·{" "}
                        {Number.isFinite(minutes) ? minutes : "…"} phút →
                      </button>
                      {active && (
                        <button onClick={() => go("focus")}>
                          Tiếp tục phiên đang mở
                        </button>
                      )}
                    </section>
                  </div>
                </>
              )}
              {view === "focus" &&
                (active ? (
                  <>
                    <div className="focus-heading">
                      <span className="pill">
                        {active.groupId
                          ? "ĐỒNG HÀNH BẤT ĐỒNG BỘ"
                          : "CHUYẾN CÁ NHÂN"}
                      </span>
                      <h1>{active.goal}</h1>
                      <p>
                        {active.state === "away"
                          ? "Đồng hồ vẫn chạy. Khoảng thời gian bạn rời đi không được cộng vào thời gian học."
                          : "Không vội vàng. Chỉ cần hiện diện ở đây."}
                      </p>
                    </div>
                    <section className="focus-card">
                      <div
                        className="timer"
                        role="timer"
                        aria-label="Thời gian còn lại"
                      >
                        {clock(active.target - elapsedSeconds(active, now))}
                      </div>
                      <div className="timer-label">
                        {Math.floor(focused(active) / 60)} PHÚT ĐÃ HỌC ·{" "}
                        {Math.round((focused(active) / active.target) * 100)}%
                        CHẶNG ĐƯỜNG
                        <br />
                        {active.distractions ?? 0} LẦN XAO NHÃNG
                      </div>
                      <JourneyView
                        initial="2d"
                        journey={
                          active.groupId && group?.id === active.groupId
                            ? group.journey
                            : carriage?.journey
                        }
                        carriages={
                          active.groupId && group?.id === active.groupId
                            ? group.members
                            : [
                                {
                                  id: owner,
                                  name: carriage?.name ?? "Toa Mây",
                                  color: carriage?.color ?? "#398575",
                                },
                              ]
                        }
                        ownId={owner}
                        decor={carriage?.decor}
                        fog={active.state === "away"}
                        calm
                        draftSeconds={focused(active)}
                        targetSeconds={active.target}
                        focusState={active.state}
                        reconnect={active.reconnect}
                      />
                      <div className="focus-controls">
                        {now < active.lastAt && <div className="info-box">
                          <p>Đồng hồ thiết bị đang chạy lùi. Hãy đặt lại giờ đúng để tiếp tục; dữ liệu phiên vẫn được giữ.</p>
                          <button onClick={exportData}>Xuất bản sao phiên học</button>
                        </div>}
                        <button disabled={now < active.lastAt} onClick={() => setConfirm("finish")}>
                          Kết thúc và lưu
                        </button>
                      </div>
                    </section>
                    {active.document && (
                      <details className="panel study-notes">
                        <summary>Tài liệu của bạn · đọc ngay tại đây</summary>
                        <pre>{active.document}</pre>
                      </details>
                    )}
                    {!!active.materials?.length && <div className="panel material-list" aria-label="Tệp của phiên học">{active.materials.map((file, i) => <p key={`${i}:${file.name}`}><strong>{file.name}</strong> · {file.message}</p>)}</div>}
                  </>
                ) : (
                  <Empty
                    title="Chưa có chuyến đang chạy"
                    text="Chuẩn bị một tấm vé và bắt đầu hành trình của bạn."
                    action="Chuẩn bị vé"
                    onClick={() => go("ticket")}
                  />
                ))}
              {view === "map" && (
                <>
                  <Heading
                    kicker="BẢN ĐỒ KHÁM PHÁ"
                    title="Theo dấu bình minh"
                    text="Năm trạm dừng. Vô vàn điều nhỏ bé để khám phá."
                  />
                  {group && (
                    <div className="choice-row">
                      <button
                        className={mode === "solo" ? "selected" : ""}
                        onClick={() => setMode("solo")}
                      >
                        Bản đồ của tôi
                      </button>
                      <button
                        className={mode === "group" ? "selected" : ""}
                        onClick={() => setMode("group")}
                      >
                        Bản đồ đoàn
                      </button>
                    </div>
                  )}
                  <JourneyView
                    initial="2d"
                    journey={journey}
                    carriages={trainCars}
                    ownId={owner}
                    decor={carriage?.decor}
                  />
                  <div className="station-list">
                    {stations.map((s, i) => (
                      <article
                        key={s}
                        className={`station-stop ${i <= (journey?.station ?? 0) ? "unlocked" : ""}`}
                      >
                        <span className="station-number">
                          {i <= (journey?.station ?? 0) ? "✓" : `0${i + 1}`}
                        </span>
                        <div>
                          <small>
                            {i === (journey?.station ?? 0)
                              ? "BẠN ĐANG Ở ĐÂY"
                              : i < (journey?.station ?? 0)
                                ? "ĐÃ KHÁM PHÁ"
                                : "CHƯA MỞ"}
                          </small>
                          <h2>{s}</h2>
                          <p>
                            {i <= (journey?.station ?? 0)
                              ? stories[i]
                              : "Học thêm để mở cảnh quan và câu chuyện ở trạm này."}
                          </p>
                        </div>
                        {i === (journey?.station ?? 0) && (
                          <strong>
                            {Math.floor((journey?.remaining ?? 0) / 60)} phút
                            tích lũy
                          </strong>
                        )}
                      </article>
                    ))}
                  </div>
                  {journey?.voteUntil && (
                    <section className="panel">
                      <h2>Chọn ngã rẽ của hành trình</h2>
                      <p>
                        Hết hạn {date(journey.voteUntil)}. Hòa phiếu hoặc không
                        có phiếu: qua núi.
                      </p>
                      <div className="choice-row">
                        {(["mountain", "coast"] as const).map((branch) => (
                          <button
                            key={branch}
                            aria-pressed={journey.votes[owner] === branch}
                            className={
                              journey.votes[owner] === branch ? "selected" : ""
                            }
                            disabled={busy || needsLogin}
                            onClick={() =>
                              void run(async () => {
                                if (user)
                                  await mutation("vote", { mode, branch });
                                else {
                                  const local = structuredClone(
                                    current.current.local,
                                  );
                                  person(local, owner).journey.votes[owner] =
                                    branch;
                                  commit({
                                    ...current.current,
                                    local,
                                    snapshot: snapshot(
                                      local,
                                      owner,
                                      Date.now(),
                                    ),
                                  });
                                }
                              })
                            }
                          >
                            {branch === "mountain" ? "△ Qua núi" : "≈ Ven biển"}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <p className="muted">
                    Tuyến hiện tại:{" "}
                    {journey?.branch === "coast" ? "Ven biển" : "Qua núi"} · Mỗi
                    phút học hợp lệ tương ứng một đơn vị. Phần dư ở đích được
                    giữ lại.
                  </p>
                </>
              )}
              {view === "carriage" && (
                <>
                  <Heading
                    kicker="GÓC NHỎ CỦA RIÊNG BẠN"
                    title={carriage?.name ?? "Toa của tôi"}
                    text="Toa tàu luôn đi cùng bạn, kể cả khi bạn chuyển hoặc rời đoàn."
                  />
                  <Scene
                    color={carriage?.color}
                    decor={carriage?.decor}
                    station={journey?.station}
                    branch={journey?.branch}
                  />
                  <div className="two-columns">
                    <section className="panel form">
                      <h2>Đặt dấu ấn của bạn</h2>
                      <label>
                        Tên toa
                        <input
                          maxLength={60}
                          placeholder={carriage?.name}
                          value={carriageName}
                          onChange={(e) => setCarriageName(e.target.value)}
                        />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const at = Date.now();
                          void run(() => customize(undefined, undefined, at));
                        }}
                      >
                        Lưu tên toa
                      </button>
                      <h3>Màu toa</h3>
                      <div className="swatches">
                        {["#398575", "#d98b55", "#7384b3", "#b97186"].map(
                          (color, i) => (
                            <button
                              key={color}
                              style={{ background: color }}
                              aria-label={
                                ["Xanh lá", "Cam đất", "Xanh tím", "Hồng"][i]
                              }
                              aria-pressed={carriage?.color === color}
                              disabled={busy}
                              onClick={() => {
                                const at = Date.now();
                                void run(() => customize(color, undefined, at));
                              }}
                            >
                              {carriage?.color === color ? "✓" : ""}
                            </button>
                          ),
                        )}
                      </div>
                      <h3>Góc cửa sổ</h3>
                      <div className="choice-row">
                        {["plant", "books", "stars"].map((decor, i) => (
                          <button
                            key={decor}
                            className={
                              carriage?.decor === decor ? "selected" : ""
                            }
                            disabled={busy}
                            onClick={() =>
                              {
                                const at = Date.now();
                                void run(() => customize(undefined, decor, at));
                              }
                            }
                          >
                            {["♣ Chậu cây", "▤ Sách", "✦ Ngôi sao"][i]}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <h2>Kệ kỷ niệm</h2>
                      <p>
                        Trang trí không tăng điểm học. Thành quả đến từ thời
                        gian bạn dành cho bản thân.
                      </p>
                      <div className="souvenirs">
                        <div>
                          ⚑<h3>Biển tên lữ hành</h3>
                          <p>
                            {sessions.length
                              ? "Đã có chuyến đầu tiên"
                              : "Hoàn thành một phiên để nhận"}
                          </p>
                        </div>
                        <div>
                          ✦<h3>Dấu ấn hiểu bài</h3>
                          <p>
                            {sessions.filter((s) => s.quiz).length} phiên đã làm
                            quiz
                          </p>
                        </div>
                        <div>
                          ♧<h3>Người khám phá</h3>
                          <p>
                            {(carriage?.journey.station ?? 0) + 1} trạm cá nhân
                          </p>
                        </div>
                      </div>
                      <h3>
                        {minutesTotal} XP · {Math.floor(minutesTotal / 60) + 1}{" "}
                        cấp toa
                      </h3>
                      <p>
                        1 phút học hợp lệ = 1 XP. Không mất XP vì nghỉ hoặc xao
                        nhãng.
                      </p>
                    </section>
                  </div>
                </>
              )}
              {view === "group" && (
                <>
                  <Heading
                    kicker="KHÁC LỊCH HỌC · CHUNG ĐIỂM ĐẾN"
                    title={group?.name ?? "Đi cùng những người bạn"}
                    text="Đoàn riêng từ 2 đến 6 người. Mỗi người giữ mục tiêu và nhịp học của mình."
                  />
                  {!user || needsLogin ? (
                    <Empty
                      title="Nối toa bằng một tài khoản"
                      text="Đăng nhập để mời bạn bè và đồng bộ hành trình. Bạn vẫn có thể học cá nhân ngay trên thiết bị."
                      action="Đăng nhập / đăng ký"
                      onClick={() => go("account")}
                    />
                  ) : group ? (
                    <>
                      <div className="group-cars">
                        {group.members.map((m) => (
                          <article className="panel member" key={m.id}>
                            <div
                              style={{ background: m.color }}
                              className="mini-car"
                            >
                              ▣
                            </div>
                            <h3>{m.name}</h3>
                            <p>
                              {m.id === group.owner ? "Chủ đoàn" : "Thành viên"}
                              {m.id === user.id ? " · Bạn" : ""}
                            </p>
                            {group.owner === user.id && m.id !== user.id && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    mutation("transfer", { userId: m.id }),
                                  )
                                }
                              >
                                Chuyển quyền chủ đoàn
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                      <div className="two-columns">
                        <section className="panel">
                          <h2>Chuyến đi chung</h2>
                          <p>
                            {group.members.length} / 6 toa · Múi giờ{" "}
                            {group.timezone}
                          </p>
                          <p>
                            Đã đến {stations[group.journey.station]}. Ngưỡng
                            chặng này được giữ nguyên khi thành viên thay đổi.
                          </p>
                          <button
                            className="primary"
                            onClick={() => {
                              setMode("group");
                              go("ticket");
                            }}
                          >
                            Đóng góp một phiên học →
                          </button>
                          <h3>Nhật ký đoàn</h3>
                          {group.journey.journal.length ? (
                            group.journey.journal.map((e, i) => (
                              <p key={i}>
                                {date(e.at)} · {e.text}
                              </p>
                            ))
                          ) : (
                            <p>
                              Chuyến đi đang bắt đầu. Hãy cùng nhau mở trạm đầu
                              tiên.
                            </p>
                          )}
                        </section>
                        <section className="panel form">
                          <h2>Lời mời & quyền riêng tư</h2>
                          <p>
                            Chỉ tên toa và trang trí được chia sẻ. Đoàn không
                            thấy tài liệu, điểm quiz hay chi tiết gián đoạn.
                          </p>
                          {group.owner === user.id && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () =>
                                    setInviteResult(
                                      await post("/adventure/invite", {}),
                                    ),
                                  )
                                }
                              >
                                Tạo mã mời (hết hạn sau 24 giờ)
                              </button>
                              {inviteResult && (
                                <div className="info-box">
                                  <label>
                                    Mã mời
                                    <input
                                      readOnly
                                      value={inviteResult.token}
                                      onFocus={(e) => e.target.select()}
                                    />
                                  </label>
                                  <small>
                                    Hết hạn {date(inviteResult.expires)}
                                  </small>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        await navigator.clipboard.writeText(
                                          inviteResult.token,
                                        );
                                        setNotice("Đã sao chép mã mời.");
                                      })
                                    }
                                  >
                                    Sao chép
                                  </button>
                                </div>
                              )}
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await post("/adventure/invite/revoke", {});
                                    setInviteResult(null);
                                    setNotice("Đã thu hồi các mã mời.");
                                  })
                                }
                              >
                                Thu hồi lời mời
                              </button>
                            </>
                          )}
                          <button
                            className="danger-button"
                            disabled={
                              !!active || saved.pending.length > 0 || busy
                            }
                            onClick={() => setConfirm("leave")}
                          >
                            Rời đoàn
                          </button>
                          <small>
                            Hãy đồng bộ các phiên trước khi rời. Chủ đoàn rời sẽ
                            chuyển quyền cho thành viên tham gia sớm nhất còn
                            lại.
                          </small>
                          <button
                            disabled={busy}
                            onClick={() => void run(sync)}
                          >
                            Cập nhật tiến độ ↻
                          </button>
                        </section>
                      </div>
                    </>
                  ) : (
                    <div className="two-columns">
                      <section className="panel form">
                        <h2>Mở một đoàn mới</h2>
                        <label>
                          Tên đoàn
                          <input
                            maxLength={60}
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            placeholder="Những người đi tìm bình minh"
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={busy || !groupName.trim()}
                          onClick={() =>
                            void run(() =>
                              mutation("groups", {
                                name: groupName,
                                timezone:
                                  Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone,
                              }),
                            )
                          }
                        >
                          Tạo đoàn của bạn →
                        </button>
                      </section>
                      <section className="panel form">
                        <h2>Bạn có một lời mời?</h2>
                        <label>
                          Mã mời
                          <input
                            value={invite}
                            onChange={(e) => setInvite(e.target.value)}
                            placeholder="Dán mã bạn nhận được"
                          />
                        </label>
                        <button
                          disabled={busy || !invite.trim()}
                          onClick={() =>
                            void run(() =>
                              mutation("join", { token: invite.trim() }),
                            )
                          }
                        >
                          Nối toa vào đoàn
                        </button>
                      </section>
                    </div>
                  )}
                  <div className="info-box">
                    <strong>Đồng hành bất đồng bộ</strong>
                    <p>
                      Tiến độ chỉ cộng sau khi phiên học được xác nhận. Bản này
                      chưa có phòng khởi hành trực tiếp hoặc thưởng phối hợp
                      thời gian thực.
                    </p>
                  </div>
                </>
              )}
              {view === "journal" && (
                <>
                  <Heading
                    kicker="NHỮNG CHẶNG ĐƯỜNG ĐÃ QUA"
                    title="Nỗ lực của bạn, được giữ lại."
                    text="Phiên ngắn hay dài đều có giá trị. Chỉ bạn thấy mục tiêu và kết quả học của mình."
                  />
                  {sessions.length ? (
                    <div className="session-list">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          className="session-row"
                          onClick={() => {
                            setSummary(s);
                            setQuestions([]);
                            setAnswers({});
                            setRevealed(false);
                            go("summary");
                          }}
                        >
                          <span className="feature-icon green">▤</span>
                          <div>
                            <h3>{s.goal}</h3>
                            <p>
                              {date(s.ended)} ·{" "}
                              {s.groupId ? "Đóng góp cho đoàn" : "Cá nhân"} ·{" "}
                              {saved.pending.some((p) => p.id === s.id)
                                ? "Chờ đồng bộ"
                                : "Đã lưu"}
                            </p>
                          </div>
                          <strong>{Math.floor(s.seconds / 60)} phút ↗</strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Nhật ký đang chờ chuyến đầu tiên"
                      text="Bắt đầu học và trở lại đây để nhìn thấy quãng đường của mình."
                      action="Bắt đầu"
                      onClick={() => go("ticket")}
                    />
                  )}
                  <button onClick={exportData}>
                    Xuất bản sao dữ liệu riêng
                  </button>
                </>
              )}
              {view === "experiments" && <ExperimentResults />}
              {view === "summary" &&
                (summary ? (
                  <>
                    <Heading
                      kicker="MỖI PHÚT ĐỀU CÓ Ý NGHĨA"
                      title="Thêm một chặng đường đáng nhớ."
                      text={summary.goal}
                    />
                    <div className="stat-row">
                      <Stat
                        icon="◷"
                        label="THỜI GIAN HỢP LỆ"
                        value={clock(summary.seconds)}
                        detail="Đã loại thời gian rời phiên học"
                      />
                      <Stat
                        icon="✦"
                        label="KINH NGHIỆM TOA"
                        value={`${Math.floor(summary.seconds / 60)} XP`}
                        detail="Phần giây lẻ vẫn được tích lũy"
                      />
                      <Stat
                        icon="⚑"
                        label="TRẠNG THÁI"
                        value={
                          saved.pending.some((s) => s.id === summary.id)
                            ? "Đang chờ"
                            : "Đã lưu"
                        }
                        detail="Quiz không chặn lưu thành quả"
                      />
                    </div>
                    <p className="muted">
                      {summary.distractions ?? summary.segments.filter(segment => segment.kind === "distraction").length} lần xao nhãng ·
                      Đồng hồ vẫn chạy khi rời phiên học.
                    </p>
                    <section className="panel">
                      <h2>Mang kiến thức theo chuyến đi</h2>
                      {!!saved.materials?.[summary.id]?.length && <details className="material-history"><summary>Tài liệu của chuyến · {saved.materials[summary.id].length} tệp</summary><ul className="material-list">{saved.materials[summary.id].map((file, i) => <li key={`${i}:${file.name}`}><strong>{file.name}</strong><span>{file.message}</span></li>)}</ul></details>}
                      <p>
                        Ôn lại một chút trước khi nghỉ. Làm sau cũng được; phần
                        học của bạn đã được lưu.
                      </p>
                      {!user || needsLogin ? (
                        <button onClick={() => go("account")}>
                          Đăng nhập để dùng ngân hàng quiz và AI
                        </button>
                      ) : !questions.length ? (
                        <div className="choice-row">
                          <button
                            disabled={busy}
                            onClick={() => void run(() => loadQuiz(false))}
                          >
                            Lấy quiz chủ đề
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void run(() => loadQuiz(true))}
                          >
                            Tạo quiz với Gemini
                          </button>
                        </div>
                      ) : (
                        <div className="quiz">
                          {questions.map((q, i) => (
                            <fieldset key={q.id}>
                              <legend>
                                {i + 1}. {q.question}
                              </legend>
                              {q.options.map((option, index) => (
                                <label
                                  key={index}
                                  className={`answer ${revealed && index === (q.correct_index ?? q.correctAnswerIndex) ? "correct" : ""}`}
                                >
                                  <input
                                    type="radio"
                                    name={q.id}
                                    disabled={revealed}
                                    checked={answers[q.id] === index}
                                    onChange={() =>
                                      setAnswers({ ...answers, [q.id]: index })
                                    }
                                  />
                                  {option}
                                </label>
                              ))}
                              {revealed && (
                                <p className="info-box">{q.explanation}</p>
                              )}
                            </fieldset>
                          ))}
                          <button
                            className="primary"
                            disabled={
                              busy ||
                              revealed ||
                              Object.keys(answers).length !== questions.length
                            }
                            onClick={() =>
                              void run(async () => {
                                await mutation("quiz", {
                                  sessionId: summary.id,
                                  answers: questions.map((q) => ({
                                    id: q.id,
                                    selected: answers[q.id],
                                  })),
                                });
                                setRevealed(true);
                              })
                            }
                          >
                            Xác nhận & xem giải thích
                          </button>
                        </div>
                      )}
                    </section>
                    <ExperimentShare key={summary.id} sessionId={summary.id} canPublish={Boolean(user) && !needsLogin} sync={sync} />
                    <button className="primary" onClick={() => go("station")}>
                      Trở về ga chính →
                    </button>
                  </>
                ) : (
                  <Empty
                    title="Thành quả đang chờ bạn"
                    text="Xem một phiên trong nhật ký để mở lại tổng kết."
                    action="Mở nhật ký"
                    onClick={() => go("journal")}
                  />
                ))}
              {view === "account" && (
                <>
                  <Heading
                    kicker="BẠN LỮ HÀNH"
                    title={
                      user
                        ? `Xin chào, ${user.name}`
                        : "Giữ hành trình bên mình"
                    }
                    text="Học cá nhân không cần tài khoản. Đăng nhập để đồng bộ và cùng bạn bè khám phá."
                  />
                  {user && (
                    <section className="panel form">
                      <h2>{user.email}</h2>
                      <p>
                        Tiến độ tài khoản và tiến độ khách được lưu riêng, không
                        tự cộng lại hai lần.
                      </p>
                      <button disabled={busy || needsLogin || !online} onClick={() => void run(sync)}>
                        Đồng bộ tài khoản
                      </button>
                      <button
                        disabled={busy || !!active}
                        onClick={() => void run(logout)}
                      >
                        Đăng xuất
                      </button>
                      <small>
                        Hoàn tất phiên đang chạy trước khi đăng xuất. Phiên chờ đồng bộ được giữ trên thiết bị cho lần đăng nhập sau.
                      </small>
                      <button onClick={exportData}>Xuất dữ liệu riêng</button>
                    </section>
                  )}
                  {(!user || needsLogin) && (
                    <form
                      className="panel form auth-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await login(
                            needsLogin && active && user ? user.email : email,
                            password,
                            authMode === "register" ? name : undefined,
                          );
                          go("station");
                        });
                      }}
                    >
                      <div className="choice-row">
                        <button
                          type="button"
                          className={authMode === "login" ? "selected" : ""}
                          onClick={() => setAuthMode("login")}
                        >
                          Đăng nhập
                        </button>
                        <button
                          type="button"
                          className={authMode === "register" ? "selected" : ""}
                          disabled={!!active}
                          onClick={() => setAuthMode("register")}
                        >
                          Tạo tài khoản
                        </button>
                      </div>
                      {authMode === "register" && (
                        <label>
                          Tên của bạn
                          <input
                            required
                            maxLength={100}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoComplete="name"
                          />
                        </label>
                      )}
                      <label>
                        Email
                        <input
                          required
                          type="email"
                          value={needsLogin && active && user ? user.email : email}
                          readOnly={!!active}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="email"
                        />
                      </label>
                      <label>
                        Mật khẩu
                        <input
                          required
                          type="password"
                          minLength={8}
                          maxLength={authMode === "register" ? 72 : undefined}
                          pattern={authMode === "register" ? "(?=.*[A-Z])(?=.*[0-9])(?=.*[^a-zA-Z0-9]).{8,72}" : undefined}
                          title={authMode === "register" ? REGISTRATION_PASSWORD_HINT : undefined}
                          aria-describedby={authMode === "register" ? "registration-password-hint" : undefined}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete={
                            authMode === "login"
                              ? "current-password"
                              : "new-password"
                          }
                        />
                      </label>
                      {authMode === "register" && (
                        <small id="registration-password-hint">{REGISTRATION_PASSWORD_HINT}</small>
                      )}
                      <button className="primary" disabled={busy || (!!active && !needsLogin)}>
                        {busy
                          ? "Đang kết nối…"
                          : authMode === "login"
                            ? "Đăng nhập →"
                            : "Tạo tài khoản →"}
                      </button>
                      {active && !needsLogin && (
                        <p>
                          Hãy lưu phiên khách hiện tại trước khi đổi sang tài
                          khoản.
                        </p>
                      )}
                    </form>
                  )}
                  <div className="info-box">
                    <h3>Dữ liệu và quyền riêng tư</h3>
                    <p>
                      Tài liệu nhập được giữ trên thiết bị, chỉ gửi cho AI khi
                      bạn bấm tạo quiz. Dữ liệu học của tài khoản được lưu trên
                      máy chủ; đoàn chỉ xem toa và tiến độ chung.
                    </p>
                    <p>
                      Ở chế độ khách, dữ liệu thuộc trình duyệt này. Xuất bản
                      sao trước khi xóa dữ liệu trình duyệt.
                    </p>
                    <p>Tên tài khoản gần nhất được giữ trên thiết bị để mở lại phiên offline. Đăng xuất sẽ xóa thông tin này; mật khẩu và token không được lưu lâu dài.</p>
                  </div>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>VIỄN DU · HỌC ĐỂ ĐI XA</span>
            <span>Không so sánh. Không mất thành quả. Cứ tiếp tục.</span>
          </footer>
        </main>
      </div>
      {active && view !== "focus" && (
        <button className="active-trip" onClick={() => go("focus")}>
          ▥ Chuyến đang chạy · {clock(active.target - elapsedSeconds(active, now))} →
        </button>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">
              {confirm === "finish"
                ? "Dừng ở ga này nhé?"
                : confirm === "reset" ? "Tạo lại hành trình trên thiết bị?" : "Rời đoàn hiện tại?"}
            </h2>
            <p>
              {confirm === "finish"
                ? "Phần thời gian học hợp lệ sẽ được lưu. Bạn không mất kinh nghiệm đã kiếm được."
                : confirm === "reset" ? "Dữ liệu cục bộ của tài khoản này sẽ bị xóa. Hãy tải dữ liệu gốc trước. Dữ liệu đã đồng bộ trên máy chủ vẫn được giữ." : "Toa cá nhân được giữ nguyên. Đóng góp cũ vẫn thuộc hành trình của đoàn."}
            </p>
            <div className="choice-row">
              <button autoFocus onClick={() => setConfirm(null)}>
                Tiếp tục hành trình
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (confirm === "finish") finish();
                  else if (confirm === "reset") {
                    try {
                      localStorage.removeItem(`train-adventure:v1:${owner}`);
                      window.location.reload();
                    } catch { setError("Không xóa được dữ liệu. Hãy kiểm tra quyền lưu trữ của trình duyệt."); }
                  }
                  else
                    void run(async () => {
                      await mutation("leave", {});
                      setMode("solo");
                      setConfirm(null);
                    });
                }}
              >
                Xác nhận
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Heading({
  kicker,
  title,
  text,
}: {
  kicker: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{kicker}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="stat">
      <span className="stat-icon">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </section>
  );
}
function Empty({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <section className="empty panel">
      <span className="empty-icon">♧</span>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={onClick}>
        {action} →
      </button>
    </section>
  );
}
