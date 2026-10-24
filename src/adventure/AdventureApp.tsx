import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useBrowserView } from "./navigation";
import { useAuthStore } from "@/store/authStore";
import { post, request } from "@/services/api";
import { AuthForm } from "./AuthForm";
import { AdminPanel } from "./AdminPanel";
import { ProfilePanel } from "./ProfilePanel";
import { profileStats } from "./profileStats";
import { useAdminAccess } from "./useAdminAccess";
import { SceneFallback } from "./SceneFallback";
import { BoardingTicket } from "./BoardingTicket";
import { StudyNotesInput } from "./StudyNotesInput";
import { StudyGuideComposer } from "./StudyGuideComposer";
import { MaterialSourceReader, MaterialSourceReviewButton } from "./MaterialSourceReader";
import { FlipClock } from "./FlipClock";
import { ThemeToggle } from "./theme";
import { studyGuideDownload, studyGuideSource, type StudyGuideDraft } from "./studyGuide";
import { createStudyGuideReviewState, hasPendingStudyGuide as hasPendingGuideReview, reduceStudyGuideReview } from "./studyGuideReview";
import { useStudyFullscreen } from "./useStudyFullscreen";
import { JourneyView } from "./JourneyView";
import { TopDownScene } from "./TopDownScene";
import { detectDeviceCategory } from "./device";
import { explorationProgress } from "./exploration";
import type { MaterialExtractionProgress } from "./materialExtraction";
import { createMaterialSource, reviewMaterialSource, recoveredMaterialSource, type MaterialSource } from "./materialSources";
import { DurationPicker } from "./DurationPicker";
import { ExperimentResults, ExperimentShare } from "./ExperimentResults";
import { QuizPanel } from "./QuizPanel";
import { HomeTripForm } from "./HomeTripForm";
import { updateQuickTripDraft, type QuickTripDraft } from "./quickTripDraft";
import { QuizPrefetchCoordinator, quizPrefetchScopeKey, type QuizPrefetchScope } from "./quizPrefetch";
import { isCurrentQuizPrefetchRequest } from "./quizPrefetchPresentation";
import { buildQuizGenerationPayload, quizDraftFromQuestions, quizGenerationSourceKey } from "./quizGeneration";
import { permanentGuestFailure, publishGuestSessions, type GuestPublicationStatus } from "./guestPublication";
import { GuestHistorySync } from "./GuestHistorySync";
import { studyTopics } from "./topics";
import {
  breakStatus,
  studyStageStatus,
  totalDuration,
  tripSceneTiming,
  depart,
  elapsedSeconds,
  focused,
  isDeviceClockBehind,
  leaveFocusView,
  restore,
  returnFromBackground,
  sessionEndAt,
  tick,
  type ActiveTrip,
} from "./focus";
import { isValidBreakPlan, studyElapsedSeconds } from "../../backend/src/adventure/domain";
import { emptySaved, readSaved, writeSaved, type Saved } from "./storage";
import { isQuizCount, isValidQuizDraft, updateQuizDrafts, type QuizDraft, type QuizQuestion } from "./quizDrafts";
import { analyzeSession, knowledgeGaps, reviewPlan } from "./learning";
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
import "./departure.css";
import "./studyGuide.css";
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
  { id: "experiments", icon: "◎", label: "Lịch sử chuyến đi" },
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
type MaterialInfo = { sourceId?: string; name: string; size: number; type: string; status: string; message: string };
type QuizPrefetchUiState = {
  ownerId: string;
  sessionId: string;
  count: number;
  sourceKey?: string;
  requestGeneration?: number;
  status: "pending" | "ready" | "failed";
  message?: string;
};
export default function AdventureApp() {
  const { user, bootstrap, ready } = useAuthStore();
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  if (!ready) return <div className="adventure empty">Đang mở hành trình…</div>;
  return <><GuestHistorySync accountId={user?.id} /><AdventureWorkspace key={user?.id ?? "guest"} /></>;
}
function AdventureWorkspace() {
  const [requestedView, setView] = useBrowserView();
  const views = ["station", "map", "carriage", "group", "journal", "experiments", "ticket", "focus", "summary", "account", "admin"];
  const view = views.includes(requestedView) ? requestedView : "station";
  const { user, login, logout, offline: authOffline, needsLogin } = useAuthStore();
  const owner = user?.id ?? "guest";
  const [saved, setSaved] = useState<Saved>(emptySaved);
  const current = useRef(saved),
    ownerRef = useRef(owner);
  const workspaceLive = useRef(false);
  const [guestPublication, setGuestPublication] = useState<Record<string, GuestPublicationStatus>>({});
  const hasActiveTrip = Boolean(saved.active);
  const studyFullscreen = useStudyFullscreen(view === "focus" && hasActiveTrip);
  const [loaded, setLoaded] = useState(false),
    [exclusive, setExclusive] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(() => Date.now()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true);
  const adminAccess = useAdminAccess(owner, !!user && !needsLogin && online && !authOffline);
  const adminNoticeHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (view === "admin" && !adminAccess.allowed && !adminAccess.checking)
      adminNoticeHeading.current?.focus({ preventScroll: true });
  }, [view, adminAccess.allowed, adminAccess.checking]);
  const workspaceNav = adminAccess.allowed ? [...nav, { id: "admin", icon: "▥", label: "Quản trị" }] : nav;
  const lastLocalDay = useRef(localDayKey(now));
  const [goal, setGoal] = useState(""),
    [topic, setTopic] = useState("biology"),
    [documentText, setDocumentText] = useState("");
  const quickTripDraft = useRef<QuickTripDraft>({
    goal,
    topic,
    minutes: 25,
    breakCount: 0,
    breakMinutes: 5,
  });
  const [quizCount, setQuizCount] = useState("3");
  const [quizPrefetch] = useState(() => new QuizPrefetchCoordinator<QuizQuestion[]>());
  const [quizPrefetchUi, setQuizPrefetchUi] = useState<QuizPrefetchUiState | null>(null);
  const quizRequestGeneration = useRef(0);
  const quizPrefetchSaved = useRef(new Set<string>());
  const quizPrefetchLifecycle = useRef({ generation: 0 });
  useEffect(() => {
    const lifecycle = quizPrefetchLifecycle.current;
    const lease = ++lifecycle.generation;
    return () => queueMicrotask(() => {
      if (lifecycle.generation === lease) quizPrefetch.cancel();
    });
  }, [quizPrefetch]);
  const [draftTripId, setDraftTripId] = useState(() => crypto.randomUUID());
  const [ticketCode, setTicketCode] = useState<{ id: string; value: string } | null>(null);
  const ticketId = saved.active?.id ?? draftTripId;
  const needsTicketCode = view === "ticket" || view === "focus";
  useEffect(() => {
    if (!needsTicketCode || !loaded || !exclusive || !online || needsLogin || ticketCode?.id === ticketId) return;
    const controller = new AbortController();
    void request<{ tripCode: string }>("/adventure/trip-code", {
      method: "POST", body: JSON.stringify({ id: ticketId }), signal: controller.signal,
    }, owner !== "guest").then((result) => {
      if (!controller.signal.aborted && ownerRef.current === owner && workspaceLive.current && /^V-[A-F0-9]{12}$/.test(result.tripCode))
        setTicketCode({ id: ticketId, value: result.tripCode });
    }).catch(() => { /* Offline or unavailable code lookup must not prevent study. */ });
    return () => controller.abort();
  }, [needsTicketCode, ticketId, ticketCode, loaded, exclusive, online, needsLogin, owner]);
  const [sources, setSources] = useState<MaterialSource[]>([]);
  const [studyGuideReview, dispatchStudyGuideReview] = useReducer(reduceStudyGuideReview, createStudyGuideReviewState());
  const studyGuideNeedsConfirmation = hasPendingGuideReview(studyGuideReview);
  const [studyInput, setStudyInput] = useState<"notes" | "files" | "ai">("notes");
  const originalFiles = useRef(new Map<string, File>());
  const [preferAiReading, setPreferAiReading] = useState(false);
  const [materials, setMaterials] = useState<MaterialInfo[]>([]);
  const [materialProgress, setMaterialProgress] = useState<(MaterialExtractionProgress & { file: string }) | null>(null);
  const materialRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { materialRequest.current?.abort(); }, [view]);
  const [breakCount, setBreakCount] = useState(0);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [minutes, setMinutes] = useState(25),
    [mode, setMode] = useState<"solo" | "group">("solo");
  const plannedBreaks = {count:breakCount,seconds:breakMinutes * 60};
  const validBreaks = breakCount === 0 || isValidBreakPlan(plannedBreaks, minutes * 60);
  const [carriageName, setCarriageName] = useState(""),
    [groupName, setGroupName] = useState(""),
    [invite, setInvite] = useState("");
  const [inviteResult, setInviteResult] = useState<{
    token: string;
    expires: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<"finish" | "leave" | "reset" | null>(null),
    [summary, setSummary] = useState<Session | null>(null);
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
            workspaceLive.current = true;
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
      workspaceLive.current = false;
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
  async function run<T>(action: () => Promise<T>): Promise<void> {
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
    syncing.current = (async () => {
      if (id === "guest") {
        const isCurrent = () => workspaceLive.current && ownerRef.current === id;
        while (isCurrent()) {
          const unpublished = Object.values(current.current.local.sessions).filter(session =>
            session.userId === "guest" && !current.current.guestPublished?.includes(session.id));
          if (!unpublished.length) return;
          await publishGuestSessions({
            sessions: unpublished,
            publishedIds: current.current.guestPublished ?? [],
            isCurrent,
            continueAfterFailure: permanentGuestFailure,
            send: session => post<{ tripCode: string }>("/adventure/guest-sessions", session, false),
            markPublished: sessionId => commit({ ...current.current,
              guestPublished: [...new Set([...(current.current.guestPublished ?? []), sessionId])] }),
            onStatus: status => setGuestPublication(value => ({ ...value, [status.sessionId]: status })),
          });
          // Stop on a failed request/save; retain unacknowledged trips for the next retry.
          if (unpublished.some(session => !current.current.guestPublished?.includes(session.id))) return;
        }
        return;
      }
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
    if (!loaded || !exclusive || !online || needsLogin) return;
    let disposed = false;
    if (owner === "guest") {
      const retry = () => { void sync().catch(e => {
          if (!disposed) setError(e instanceof Error ? e.message : "Chưa gửi được chuyến vào lịch sử.");
        }); };
      retry();
      const interval = setInterval(retry, 60000);
      return () => { disposed = true; clearInterval(interval); };
    }
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
  }, [loaded, exclusive, owner, online, needsLogin]);
  const data = saved.snapshot;
  const accountStats = useMemo(() => profileStats(owner,
    owner === "guest" ? Object.values(saved.local.sessions) : data?.sessions ?? [], saved.pending),
  [owner, saved.local.sessions, data?.sessions, saved.pending]);
  const carriage = data?.person;
  const group = data?.group;
  const pendingSoloSeconds = saved.pending.filter(session => !session.groupId &&
    session.userId === owner && !data?.sessions.some(stored => stored.id === session.id))
    .reduce((total, session) => total + session.seconds, 0);
  const personalJourney = useMemo(() => {
    if (!carriage?.journey || pendingSoloSeconds <= 0) return carriage?.journey;
    const pendingSoloProgress = explorationProgress(carriage.journey, pendingSoloSeconds);
    return {
      ...carriage.journey,
      station: pendingSoloProgress.station,
      remaining: pendingSoloProgress.remainingSeconds,
    };
  }, [carriage?.journey, pendingSoloSeconds]);
  const journey = mode === "group" && group ? group.journey : personalJourney;
  const trainCars = useMemo(
    () => mode === "group" && group
      ? group.members
      : [{
          id: owner,
          name: carriage?.name ?? "Toa Mây",
          color: carriage?.color ?? "#398575",
        }],
    [mode, group, owner, carriage?.name, carriage?.color],
  );
  const availableTopics = useMemo(() => [
    ...studyTopics,
    ...topics.filter((t) => !studyTopics.some((s) => s.id === t.id)),
  ], [topics]);
  const active = saved.active
    ? tick(saved.active, Math.max(now, saved.active.lastAt))
    : null;
  const deviceClockBehind = active ? isDeviceClockBehind(active.lastAt) : false;
  // Group contributions need server confirmation of membership and the daily cap.
  const displayAt = active ? Math.max(now, active.lastAt) : now;
  const rest = active ? breakStatus(active, displayAt) : null;
  const studyStage = active ? studyStageStatus(active, displayAt) : null;
  const mapActive = active && !(mode === "group" && group) && active.groupId === null ? active : null;
  const mapProgress = explorationProgress(journey, mapActive ? focused(mapActive) : 0, mapActive?.target);
  const sessions = [...saved.pending, ...(data?.sessions ?? [])];
  const summarySession = summary
    ? sessions.find((session) => session.id === summary.id) ?? summary
    : view === "summary"
      ? sessions.find((session) => session.id === saved.summarySessionId) ?? null
      : null;
  const summaryCompleted = Boolean(summarySession && studyElapsedSeconds(
    summarySession.started, summarySession.target, summarySession.breakPlan, summarySession.ended,
  ) >= summarySession.target);
  const summaryQuizDraft = summarySession ? saved.quizDrafts?.[summarySession.id] : undefined;
  const summaryQuizCount = summaryQuizDraft?.requestedCount ?? summaryQuizDraft?.count ?? 3;
  const summaryQuizPrefetch = quizPrefetchUi?.ownerId === owner &&
    quizPrefetchUi.sessionId === summarySession?.id && quizPrefetchUi.count === summaryQuizCount
    ? quizPrefetchUi
    : null;
  const readQuizGenerationSource = useCallback((session: Pick<Session, "id" | "topic" | "goal">) => {
    const value = current.current;
    const trip = value.active?.id === session.id ? value.active : null;
    if (!trip && value.summarySessionId !== session.id)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần ôn tập.");
    return {
      topic: trip?.topic ?? session.topic,
      goal: trip?.goal ?? session.goal,
      notes: trip?.document ?? value.notes[session.id] ?? "",
      sources: trip?.sources ?? value.sources?.[session.id] ?? [],
      materials: trip?.materials ?? value.materials?.[session.id] ?? [],
    };
  }, []);
  const buildQuizScope = useCallback((session: Pick<Session, "id" | "topic" | "goal">, count: number) => {
    if (!isQuizCount(count)) throw new Error("Số câu hỏi cần là số nguyên từ 1 đến 30.");
    const payload = buildQuizGenerationPayload(readQuizGenerationSource(session), count);
    const scope: QuizPrefetchScope = {
      ownerId: ownerRef.current,
      sessionId: session.id,
      sourceKey: quizGenerationSourceKey(payload),
      count,
    };
    return { scope, payload };
  }, [readQuizGenerationSource]);
  const requestQuizQuestions = useCallback(async (
    session: Pick<Session, "id" | "topic" | "goal">,
    count: number,
    requestedScope: QuizPrefetchScope,
    signal: AbortSignal,
  ): Promise<QuizQuestion[]> => {
    if (ownerRef.current !== requestedScope.ownerId || !workspaceLive.current || signal.aborted)
      throw new DOMException("Chuyến học đã đổi.", "AbortError");
    const initial = buildQuizScope(session, count);
    const keyFor = (scope: QuizPrefetchScope) => JSON.stringify([
      scope.ownerId, scope.sessionId, scope.sourceKey, scope.count,
    ]);
    if (keyFor(initial.scope) !== keyFor(requestedScope))
      throw new DOMException("Nguồn học đã đổi.", "AbortError");
    const result = await request<QuizQuestion[]>("/quiz/generate", {
      method: "POST",
      body: JSON.stringify(initial.payload),
      signal,
    });
    if (ownerRef.current !== requestedScope.ownerId || !workspaceLive.current || signal.aborted ||
        (current.current.active?.id !== session.id && current.current.summarySessionId !== session.id))
      throw new DOMException("Chuyến học đã đổi.", "AbortError");
    const latest = buildQuizScope(session, count);
    if (keyFor(latest.scope) !== keyFor(requestedScope))
      throw new DOMException("Nguồn học đã đổi.", "AbortError");
    return result;
  }, [buildQuizScope]);
  const recordQuizPrefetchFailure = useCallback((scope: QuizPrefetchScope, error: unknown) => {
    if (!quizPrefetch.isCurrent(scope)) return;
    setQuizPrefetchUi({
      ownerId: scope.ownerId,
      sessionId: scope.sessionId,
      count: scope.count,
      status: "failed",
      message: error instanceof Error ? error.message : "Chưa chuẩn bị được câu hỏi.",
    });
  }, [quizPrefetch]);
  const recordQuizPrefetchResult = useCallback((
    scope: QuizPrefetchScope,
    session: Pick<Session, "id" | "topic" | "goal">,
    questions: QuizQuestion[],
  ) => {
    if (!quizPrefetch.isCurrent(scope) || ownerRef.current !== scope.ownerId || !workspaceLive.current)
      return;
    const value = current.current;
    if (value.active?.id !== scope.sessionId && value.summarySessionId !== scope.sessionId) return;
    const currentSession = value.active?.id === scope.sessionId
      ? value.active
      : value.pending.find((item) => item.id === scope.sessionId) ??
        value.snapshot?.sessions.find((item) => item.id === scope.sessionId);
    if (!currentSession) return;
    const draftPreference = value.quizDrafts?.[scope.sessionId];
    if ((draftPreference?.requestedCount ?? draftPreference?.count ?? 3) !== scope.count) return;
    const latest = buildQuizScope(currentSession ?? session, scope.count);
    if (latest.scope.sourceKey !== scope.sourceKey) return;
    const draft = quizDraftFromQuestions(questions, scope.count);
    if (!isValidQuizDraft(draft) || questions.length !== scope.count) {
      recordQuizPrefetchFailure(scope, new Error("AI chưa tạo đủ số câu hỏi đã chọn. Bạn có thể thử lại."));
      return;
    }
    const savedKey = JSON.stringify([scope.ownerId, scope.sessionId, scope.sourceKey, scope.count]);
    if (!quizPrefetchSaved.current.has(savedKey)) {
      const committed = commitRef.current({
        ...current.current,
        quizDrafts: updateQuizDrafts(current.current.quizDrafts, scope.sessionId, draft),
      });
      if (!committed) {
        recordQuizPrefetchFailure(scope, new Error("Không lưu được câu hỏi đã chuẩn bị. Bạn có thể thử tạo lại."));
        return;
      }
      quizPrefetchSaved.current.add(savedKey);
    }
    setQuizPrefetchUi({
      ownerId: scope.ownerId,
      sessionId: scope.sessionId,
      count: scope.count,
      status: "ready",
    });
  }, [buildQuizScope, quizPrefetch, recordQuizPrefetchFailure]);
  const activeQuizDraft = saved.active ? saved.quizDrafts?.[saved.active.id] : undefined;
  const activeQuizCount = activeQuizDraft?.requestedCount ?? activeQuizDraft?.count ?? 3;
  const activeTripId = saved.active?.id;
  const activeTripTopic = saved.active?.topic;
  const activeTripGoal = saved.active?.goal;
  const activeTripDocument = saved.active?.document;
  const activeTripSources = saved.active?.sources;
  const activeTripMaterials = saved.active?.materials;
  const activeTripNotes = saved.notes[activeTripId ?? ""];
  const activeTripSavedSources = saved.sources?.[activeTripId ?? ""];
  const activeTripSavedMaterials = saved.materials?.[activeTripId ?? ""];
  const activeQuizPrefetch = useMemo(() => {
    if (!activeTripId) return { scope: null, error: null };
    try {
      const payload = buildQuizGenerationPayload({
        topic: activeTripTopic ?? "",
        goal: activeTripGoal ?? "",
        notes: activeTripDocument ?? activeTripNotes ?? "",
        sources: activeTripSources ?? activeTripSavedSources ?? [],
        materials: activeTripMaterials ?? activeTripSavedMaterials ?? [],
      }, activeQuizCount);
      return {
        scope: {
          ownerId: owner,
          sessionId: activeTripId,
          sourceKey: quizGenerationSourceKey(payload),
          count: activeQuizCount,
        },
        error: null,
      };
    } catch (cause) {
      return {
        scope: null,
        error: cause instanceof Error ? cause.message : "Chưa chuẩn bị được câu hỏi.",
      };
    }
  }, [
    activeTripId,
    activeTripTopic,
    activeTripGoal,
    activeTripDocument,
    activeTripSources,
    activeTripMaterials,
    activeTripNotes,
    activeTripSavedSources,
    activeTripSavedMaterials,
    activeQuizCount,
    owner,
  ]);
  const activeQuizPrefetchKey = activeQuizPrefetch.scope
    ? quizPrefetchScopeKey(activeQuizPrefetch.scope)
    : JSON.stringify([owner, activeTripId, activeQuizCount, activeQuizPrefetch.error]);
  useEffect(() => {
    const trip = current.current.active;
    if (!trip || trip.id !== activeTripId) {
      const pendingScope = quizPrefetch.currentScope();
      if (pendingScope && current.current.summarySessionId !== pendingScope.sessionId)
        quizPrefetch.cancel();
      return;
    }
    if (view !== "focus" || trip.owner !== owner || !user || needsLogin || authOffline ||
        !online || !loaded || !exclusive || !workspaceLive.current) {
      quizPrefetch.cancel();
      setQuizPrefetchUi((previous) => previous?.sessionId === trip.id ? null : previous);
      return;
    }
    const existingDraft = current.current.quizDrafts?.[trip.id];
    if (existingDraft?.questions.length) return;

    const scope = activeQuizPrefetch.scope;
    if (!scope) {
      setQuizPrefetchUi({
        ownerId: owner,
        sessionId: trip.id,
        count: activeQuizCount,
        status: "failed",
        message: activeQuizPrefetch.error ?? "Chưa chuẩn bị được câu hỏi.",
      });
      return;
    }

    const start = (signal: AbortSignal) => requestQuizQuestions(trip, activeQuizCount, scope, signal);
    setQuizPrefetchUi({ ownerId: owner, sessionId: trip.id, count: activeQuizCount, status: "pending" });
    const pending = quizPrefetch.getOrStart(scope, start);
    const existingStatus = quizPrefetch.status(scope);
    if (existingStatus?.status === "ready")
      setQuizPrefetchUi({ ownerId: owner, sessionId: trip.id, count: activeQuizCount, status: "ready" });
    if (existingStatus?.status === "failed")
      setQuizPrefetchUi({
        ownerId: owner,
        sessionId: trip.id,
        count: activeQuizCount,
        status: "failed",
        message: existingStatus.error instanceof Error ? existingStatus.error.message : "Chưa chuẩn bị được câu hỏi.",
      });
    void pending.then((questions) => {
      recordQuizPrefetchResult(scope, trip, questions);
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        recordQuizPrefetchFailure(scope, cause);
    });

  }, [view, activeTripId, activeQuizPrefetchKey, activeQuizPrefetch, activeQuizCount, owner, user, needsLogin, authOffline, online, loaded, exclusive, quizPrefetch, requestQuizQuestions, recordQuizPrefetchFailure, recordQuizPrefetchResult]);
  const minutesTotal = Math.floor((carriage?.seconds ?? 0) / 60);
  const go = (next: string) => {
    if (next === "focus" && current.current.active) studyFullscreen.request();
    else if (next !== "focus") studyFullscreen.leave();
    if (next !== "focus" && current.current.active)
      commit({ ...current.current, active: leaveFocusView(current.current.active, Date.now()) });
    setError("");
    setNotice("");
    if (next === "ticket" && !studyGuideNeedsConfirmation) {
      const draft = quickTripDraft.current;
      setGoal(draft.goal);
      setTopic(draft.topic);
      setMinutes(draft.minutes);
      setBreakCount(draft.breakCount);
      setBreakMinutes(draft.breakMinutes);
    }
    setView(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const prepareQuickTripRef = useRef<(draft: QuickTripDraft) => void>(() => {});
  const onPrepareQuickTrip = useCallback((draft: QuickTripDraft) => prepareQuickTripRef.current(draft), []);
  prepareQuickTripRef.current = (draft) => {
    if (studyGuideNeedsConfirmation) {
      setError("Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi đổi mục tiêu hay nguồn học.");
      return;
    }
    updateQuickTripDraft(quickTripDraft, draft);
    if (current.current.active) {
      go("focus");
      return;
    }
    setGoal(draft.goal);
    setTopic(draft.topic);
    setMinutes(draft.minutes);
    setBreakCount(draft.breakCount);
    setBreakMinutes(draft.breakMinutes);
    go("ticket");
  };
  async function mutation(path: string, body: unknown): Promise<Snapshot> {
    if (needsLogin) throw new Error("Đăng nhập lại để cập nhật đoàn hoặc đồng bộ trang trí.");
    const id = ownerRef.current;
    const result = await post<Snapshot>(`/adventure/${path}`, body);
    if (ownerRef.current === id && workspaceLive.current)
      commit({ ...current.current, snapshot: result });
    return result;
  }
  function start() {
    if (
      busy || materialRequest.current ||
      studyGuideNeedsConfirmation ||
      !loaded ||
      !exclusive ||
      current.current.active ||
      goal.trim().length < 3 ||
      minutes < 1 ||
      minutes > 240 ||
      !Number.isInteger(minutes) || !validBreaks || !isQuizCount(Number(quizCount))
    )
      return;
    const at = Date.now();
    const trip: ActiveTrip = {
      id: draftTripId,
      owner,
      goal: goal.trim(),
      topic,
      document: documentText,
      materials,
      sources,
      target: minutes * 60,
      breakPlan: breakCount > 0 ? plannedBreaks : undefined,
      deviceCategory: detectDeviceCategory(navigator.userAgent, navigator.maxTouchPoints),
      groupId: mode === "group" && group ? group.id : null,
      started: at,
      lastAt: at,
      segments: [],
      state: "focus",
      reconnect: 0,
    };
    const selectedQuizCount = isQuizCount(Number(quizCount)) ? Number(quizCount) : 3;
    const initialQuizDraft = quizDraftFromQuestions([], selectedQuizCount);
    if (commit({
      ...current.current,
      active: trip,
      quizDrafts: updateQuizDrafts(current.current.quizDrafts, trip.id, initialQuizDraft),
    })) {
      setNow(at);
      setQuizPrefetchUi(null);
      setDraftTripId(crypto.randomUUID());
      setSummary(null);
      go("focus");
    }
  }
  function finish() {
    const trip = current.current.active;
    const at = Date.now();
    if (!trip || isDeviceClockBehind(trip.lastAt, () => at)) return;
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
      breakPlan: next.breakPlan,
      segments: next.segments,
      seconds: focused(next),
      contribution: 0,
      rules: "train-v1",
      distractions: next.distractions ?? 0,
      deviceCategory: next.deviceCategory,
    };
    const value = structuredClone(current.current);
    value.active = null;
    value.notes[s.id] = next.document;
    (value.materials ??= {})[s.id] = next.materials ?? [];
    (value.sources ??= {})[s.id] = next.sources ?? [];
    value.summarySessionId = s.id;
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
      go("summary");
      if (online) void run(sync);
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
    if (!files.length || busy || studyGuideNeedsConfirmation || materialRequest.current || !workspaceLive.current || view !== "ticket") return;
    if (files.length > 10 || materials.length + files.length > 10) {
      setError("Mỗi chuyến tối đa 10 tài liệu. Hãy gộp nội dung hoặc bắt đầu chuyến mới.");
      return;
    }
    const id = owner;
    const controller = new AbortController();
    materialRequest.current = controller;
    const isCurrent = () => workspaceLive.current && ownerRef.current === id &&
      materialRequest.current === controller && !controller.signal.aborted;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { extractMaterialFile } = await import("./materialExtraction");
      if (!isCurrent()) return;
      let used = sources.reduce((total, source) => total + source.text.length + source.name.length + 12, 0);
      const importedSources: MaterialSource[] = [];
      const originals = new Map<string, File>();
      const imported: MaterialInfo[] = [];
      for (const file of files) {
        if (!isCurrent()) return;
        setMaterialProgress({ file: file.name, phase: "loading", progress: 0 });
        const remaining = Math.max(0, 50000 - used - file.name.length - 12);
        const result = preferAiReading && file.size <= 32 * 1024 * 1024 && /\.(pdf|png|jpe?g|webp)$/i.test(file.name)
          ? {name:file.name,size:file.size,type:file.type,text:"",status:"empty",message:"Tài liệu đang chờ đọc. Bấm Đọc bằng AI rồi kiểm tra nội dung.",source:"local-ocr",quality:"needs-review"}
          : await extractMaterialFile(file, {
          maxTextChars: remaining,
          signal: controller.signal,
          onProgress: (progress) => { if (isCurrent()) setMaterialProgress({ file: file.name, ...progress }); },
        });
        if (!isCurrent()) return;
        const { name, size, type, status, message } = result;
        const source = createMaterialSource(crypto.randomUUID(), result);
        imported.push({ sourceId:source.id, name, size, type, status, message });
        importedSources.push(source);
        originals.set(source.id, file);
        used += result.text.length + file.name.length + 12;
      }
      for (const [sourceId, file] of originals) originalFiles.current.set(sourceId, file);
      setSources((current) => [...current, ...importedSources]);
      setMaterials((current) => [...current, ...imported]);
      setNotice("Đã giữ nguồn tài liệu riêng với ghi chú. Kiểm tra kết quả đọc trước khi tạo câu hỏi.");
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Không đọc được tài liệu.");
    } finally {
      if (materialRequest.current === controller) {
        materialRequest.current = null;
        if (workspaceLive.current && ownerRef.current === id) {
          setMaterialProgress(null);
          setBusy(false);
        }
      }
    }
  }
  async function readHandwriting(sourceId: string) {
    if (busy || materialRequest.current || view !== "ticket") return;
    if (!user || needsLogin) { setError("Đăng nhập để đọc tài liệu bằng AI."); return; }
    const file = originalFiles.current.get(sourceId);
    if (!file || file.size > 32 * 1024 * 1024) { setError("Hãy nhập lại tệp gốc, tối đa 32 MiB."); return; }
    const id = ownerRef.current;
    const controller = new AbortController();
    materialRequest.current = controller;
    const isCurrent = () => workspaceLive.current && ownerRef.current === id && materialRequest.current === controller && !controller.signal.aborted;
    setBusy(true); setError(""); setMaterialProgress({file:file.name,phase:"recognizing",progress:0});
    try {
      const data = await new Promise<string>((resolve,reject) => {
        const reader = new FileReader();
        const abort = () => { reader.abort(); reject(new Error("Đã hủy đọc tài liệu.")); };
        controller.signal.addEventListener("abort",abort,{once:true});
        reader.onload = () => { controller.signal.removeEventListener("abort",abort); resolve(String(reader.result).split(",")[1] ?? ""); };
        reader.onerror = () => { controller.signal.removeEventListener("abort",abort); reject(new Error("Không đọc được tệp gốc.")); };
        reader.readAsDataURL(file);
      });
      if (!isCurrent()) return;
      const extension = file.name.split(".").pop()?.toLowerCase();
      const mimeType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      const context = `${availableTopics.find(item => item.id === topic)?.name ?? topic}. Mục tiêu học: ${goal}`.slice(0, 1000);
      const result = await request<{text:string;message?:string}>("/materials/read", {method:"POST",body:JSON.stringify({mimeType,data,recoverContext:true,context}),signal:controller.signal});
      if (!isCurrent()) return;
      setSources((items) => items.map((source) => source.id === sourceId ? {...source,text:result.text,source:"ai-vision",requiresReview:true,reviewed:false} : source));
      setMaterials((items) => items.map((item) => item.sourceId === sourceId ? {...item,status:result.text ? "extracted" : "empty",message:result.message ?? "AI đã đọc. Hãy kiểm tra từ vựng, nghĩa và các chỗ [không rõ]."} : item));
      setNotice("AI đã đọc tệp và đề xuất khôi phục chỗ mờ khi có đủ ngữ cảnh. Kiểm tra các chỗ [suy luận] hoặc [không rõ] trước khi xác nhận.");
    } catch(e) { if (isCurrent()) setError(e instanceof Error ? e.message : "Không đọc được tài liệu."); }
    finally { if (materialRequest.current === controller) { materialRequest.current = null; if(workspaceLive.current && ownerRef.current === id) {setBusy(false);setMaterialProgress(null);} } }
  }
  async function generateStudyGuide(prompt: string): Promise<StudyGuideDraft | undefined> {
    if (busy || materialRequest.current || !workspaceLive.current || view !== "ticket" || materials.length || sources.length || documentText.trim()) return;
    if (!user || needsLogin) { setError("Đăng nhập để tạo bản ôn tập bằng AI."); return; }
    const id = ownerRef.current;
    const controller = new AbortController();
    materialRequest.current = controller;
    const isCurrent = () => workspaceLive.current && ownerRef.current === id && materialRequest.current === controller && !controller.signal.aborted;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<StudyGuideDraft>("/materials/generate", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ prompt, topic: availableTopics.find(item => item.id === topic)?.name ?? topic,
          ...(goal.trim() ? { goal: goal.trim() } : {}) }),
      });
      if (!isCurrent()) return;
      studyGuideSource("validation", result);
      dispatchStudyGuideReview({ type: "generated", draft: result });
      return result;
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Chưa tạo được bản ôn tập.");
    } finally {
      if (materialRequest.current === controller) {
        materialRequest.current = null;
        if (workspaceLive.current && ownerRef.current === id) setBusy(false);
      }
    }
  }
  function acceptStudyGuide(draft: StudyGuideDraft) {
    if (busy || !workspaceLive.current || view !== "ticket" || !studyGuideNeedsConfirmation ||
        studyGuideReview.draft !== draft || materials.length || sources.length || documentText.trim()) return;
    try {
      const source = studyGuideSource(crypto.randomUUID(), draft);
      const reviewed = reviewMaterialSource(source, source.text);
      setSources([reviewed]);
      setMaterials([{ sourceId: source.id, name: source.name, size: new TextEncoder().encode(source.text).length,
        type: "text/plain", status: "extracted", message: "Bản ôn tập do AI tạo, đã được bạn kiểm tra và xác nhận." }]);
      dispatchStudyGuideReview({ type: "discard" });
      setError(""); setNotice("Đã dùng bản ôn tập làm tài liệu cho chuyến này. Bạn có thể tải lại trong phần nội dung tài liệu.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không dùng được bản ôn tập."); }
  }
  function discardStudyGuideDraft() {
    if (busy || !studyGuideNeedsConfirmation) return;
    dispatchStudyGuideReview({ type: "discard" });
    setError("");
    setNotice("Đã bỏ bản ôn tập AI. Bạn có thể chọn mục tiêu hoặc nguồn học khác.");
  }
  function downloadStudyGuide(draft: StudyGuideDraft) {
    try { downloadData(studyGuideDownload(draft), "vien-du-on-tap.txt", "text/plain;charset=utf-8"); }
    catch (e) { setError(e instanceof Error ? e.message : "Không tải được bản ôn tập."); }
  }
  function exportRawData() {
    try {
      downloadData(localStorage.getItem(`train-adventure:v1:${owner}`) ?? "null", "vien-du-recovery.json");
    } catch {
      setError("Trình duyệt đang chặn truy cập bộ nhớ. Hãy bật lưu trữ cho ứng dụng rồi tải lại.");
    }
  }
  function downloadData(text: string, filename: string, type = "application/json") {
    const blob = new Blob([text], {
      type,
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function generateQuiz(session: Session, count: number): Promise<QuizQuestion[]> {
    if (!user || needsLogin) throw new Error("Đăng nhập lại để tạo quiz AI.");
    const id = ownerRef.current;
    if (current.current.summarySessionId !== session.id)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần ôn tập.");
    const initial = buildQuizScope(session, count);
    const requestIdentity = {
      ownerId: id,
      sessionId: session.id,
      count,
      sourceKey: initial.scope.sourceKey,
      requestGeneration: ++quizRequestGeneration.current,
    };
    const pendingState = { ...requestIdentity, status: "pending" as const };
    const isSameRequest = (state: QuizPrefetchUiState | null) =>
      isCurrentQuizPrefetchRequest(state, requestIdentity);
    setQuizPrefetchUi(pendingState);
    try {
      const pendingRequest = quizPrefetch.status(initial.scope)?.status === "pending"
        ? quizPrefetch.retry(initial.scope, (signal) => requestQuizQuestions(session, count, initial.scope, signal))
        : null;
      await sync();
      if (ownerRef.current !== id || !workspaceLive.current ||
          current.current.summarySessionId !== session.id)
        throw new Error("Chuyến đã đổi trước khi quiz được tạo.");
      if (current.current.snapshot?.sessions.find((item) => item.id === session.id)?.quiz)
        throw new Error("Chuyến này đã có điểm. Hãy mở một chuyến ôn tập mới để làm thêm câu hỏi.");
      let result: QuizQuestion[];
      if (pendingRequest) result = await pendingRequest;
      else {
        const latest = buildQuizScope(session, count);
        result = await quizPrefetch.retry(latest.scope, (signal) =>
          requestQuizQuestions(session, count, latest.scope, signal));
      }
      if (ownerRef.current !== id || !workspaceLive.current ||
          current.current.summarySessionId !== session.id)
        throw new Error("Chuyến đã đổi trước khi quiz được lưu.");
      setQuizPrefetchUi((previous) => isSameRequest(previous)
        ? { ...pendingState, status: "ready" }
        : previous);
      return result;
    } catch (cause) {
      setQuizPrefetchUi((previous) => isSameRequest(previous)
        ? null
        : previous);
      throw cause;
    }
  }
  function saveQuizDraft(ownerId: string, sessionId: string, draft: QuizDraft) {
    if (!workspaceLive.current || ownerRef.current !== ownerId || !isValidQuizDraft(draft) ||
        (current.current.active?.id !== sessionId && current.current.summarySessionId !== sessionId)) return;
    const previous = current.current.quizDrafts?.[sessionId];
    const previousCount = previous?.requestedCount ?? previous?.count ?? 3;
    const nextCount = draft.requestedCount ?? draft.count;
    if (previousCount !== nextCount) {
      quizPrefetch.cancelSession(ownerId, sessionId);
      quizPrefetchSaved.current.clear();
      setQuizPrefetchUi((state) => state?.ownerId === ownerId && state.sessionId === sessionId ? null : state);
    }
    commitRef.current({
      ...current.current,
      quizDrafts: updateQuizDrafts(current.current.quizDrafts, sessionId, draft),
    });
  }
  function invalidateQuizForSourceEdit(ownerId: string, sessionId: string) {
    if (ownerRef.current !== ownerId || current.current.summarySessionId !== sessionId) return;
    quizPrefetch.cancelSession(ownerId, sessionId);
    quizPrefetchSaved.current.clear();
    setQuizPrefetchUi((state) => state?.ownerId === ownerId && state.sessionId === sessionId ? null : state);
  }
  function emptyQuizDraftForSourceEdit(value: Saved, sessionId: string): Record<string, QuizDraft> {
    const previous = value.quizDrafts?.[sessionId];
    const count = previous?.requestedCount ?? previous?.count ?? 3;
    return updateQuizDrafts(value.quizDrafts, sessionId, quizDraftFromQuestions([], isQuizCount(count) ? count : 3));
  }
  async function gradeQuiz(sessionId: string, answers: { id: string; selected: number }[]): Promise<Session> {
    if (!user || needsLogin) throw new Error("Đăng nhập lại để chấm quiz.");
    const id = ownerRef.current;
    if (!workspaceLive.current || current.current.summarySessionId !== sessionId)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần chấm.");
    // Prefetched questions can be answered before the finished trip finishes uploading.
    await sync();
    if (ownerRef.current !== id || !workspaceLive.current ||
        current.current.summarySessionId !== sessionId)
      throw new Error("Chuyến đã đổi trước khi bài được chấm.");
    const result = await mutation("quiz", { sessionId, answers });
    if (ownerRef.current !== id || !workspaceLive.current ||
        current.current.summarySessionId !== sessionId)
      throw new Error("Chuyến đã đổi trước khi kết quả quiz được hiển thị.");
    const graded = result.sessions.find((session) => session.id === sessionId);
    if (!graded) throw new Error("Máy chủ chưa trả lại chuyến đã chấm.");
    return graded;
  }
  function startReviewTrip(session: Session) {
    if (studyGuideNeedsConfirmation) {
      setError("Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi đổi sang chuyến ôn tập khác.");
      return;
    }
    if (current.current.active) {
      go("focus");
      setNotice("Chuyến hiện tại vẫn đang chạy. Kết thúc chuyến đó trước khi chuẩn bị chuyến ôn tập.");
      return;
    }
    const plan = reviewPlan(
      session,
      current.current.notes[session.id] ?? "",
      current.current.materials?.[session.id] ?? [],
    );
    updateQuickTripDraft(quickTripDraft, {
      goal: plan.goal,
      topic: plan.topic,
      minutes: plan.minutes,
      breakCount: 0,
      breakMinutes: 5,
    });
    setGoal(plan.goal);
    setTopic(plan.topic);
    setDocumentText(plan.documentText);
    setMaterials(plan.materials);
    const restoredSources = current.current.sources?.[session.id] ?? [];
    setSources(structuredClone(restoredSources.length ? restoredSources : plan.materials.length ? [recoveredMaterialSource(plan.documentText,plan.materials)] : []));
    setMinutes(plan.minutes);
    setBreakCount(0);
    setBreakMinutes(5);
    setMode(session.groupId && group && session.groupId === group.id ? "group" : "solo");
    go("ticket");
  }
  const progress = journey
    ? Math.min(100, (journey.remaining / journey.threshold) * 100)
    : 0;
  return (
    <div className="adventure" ref={studyFullscreen.ref}>
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
          {workspaceNav.map((n) => (
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
              {workspaceNav.find((n) => n.id === view)?.label ??
                (
                  {
                    ticket: "Vé học",
                    focus: "Chuyến đang chạy",
                    summary: "Thành quả",
                    account: "Tài khoản",
                    admin: "Quản trị",
                  } as Record<string, string>
                )[view] ??
                "Ga chính"}
            </strong>
          </span>
          <div className="top-actions">
            <ThemeToggle />
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
                    <HomeTripForm
                      draftRef={quickTripDraft}
                      topics={availableTopics}
                      hasActiveTrip={Boolean(active)}
                      onPrepare={onPrepareQuickTrip}
                    />
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
                    kicker="CHUẨN BỊ KHỞI HÀNH"
                    title="Tấm vé cho chặng học của bạn"
                    text="Kiểm tra lộ trình, mang theo tài liệu rồi lên tàu."
                  />
                  <BoardingTicket
                    goal={goal}
                    topicName={availableTopics.find((item) => item.id === topic)?.name ?? "Tự học"}
                    minutes={minutes}
                    breakCount={breakCount}
                    breakMinutes={breakMinutes}
                    station={stations[journey?.station ?? 0]}
                    branch={journey?.branch}
                    carriageName={carriage?.name ?? "Toa Mây"}
                    mode={mode}
                    tripCode={ticketCode?.id === ticketId ? ticketCode.value : undefined}
                  />
                  <div className="boarding-preparation">
                    <section className="panel form departure-materials">
                      <div className="eyebrow">HÀNH TRANG HỌC TẬP</div>
                      <h2>Nội dung ôn tập</h2>
                      <p className="departure-intro">Dán nội dung đã có, chọn tệp hoặc nhờ AI soạn một bản ôn tập để mang lên tàu.</p>
                      <div className="departure-source-options" role="group" aria-label="Chọn cách chuẩn bị nội dung">
                        <button disabled={busy || studyGuideNeedsConfirmation} aria-pressed={studyInput === "notes"} onClick={() => setStudyInput("notes")}>Dán nội dung</button>
                        <button disabled={busy || studyGuideNeedsConfirmation} aria-pressed={studyInput === "files"} onClick={() => setStudyInput("files")}>Tải tài liệu</button>
                        <button disabled={busy} aria-pressed={studyInput === "ai"} onClick={() => setStudyInput("ai")}>Nhờ AI soạn</button>
                      </div>
                      <div className="departure-source-panel" hidden={studyInput !== "ai"}>
                        {!materials.length && !sources.length && !documentText.trim() ? <StudyGuideComposer
                          disabled={busy} canGenerate={Boolean(user && !needsLogin && online)}
                          unavailableReason={!online ? "Kết nối mạng để tạo bản ôn tập bằng AI." : "Đăng nhập để tạo bản ôn tập bằng API Google AI Studio."}
                          review={studyGuideReview} onReviewAction={dispatchStudyGuideReview}
                          onGenerate={generateStudyGuide} onCancel={() => materialRequest.current?.abort()} onUse={acceptStudyGuide}
                          onDiscard={discardStudyGuideDraft} onDownload={downloadStudyGuide}
                        /> : <p className="info-box">Bạn đã có nội dung cho chuyến này. Để tạo bản ôn tập mới từ yêu cầu bằng chữ, hãy xóa nội dung đã dán và gỡ các tài liệu bên dưới trước.</p>}
                      </div>
                      <div className="departure-source-panel" hidden={studyInput !== "notes"}>
                        <StudyNotesInput value={documentText} onChange={setDocumentText} disabled={busy || studyGuideNeedsConfirmation} hasDocuments={Boolean(materials.length || sources.length)} />
                      </div>
                      <div className="departure-source-panel" hidden={studyInput !== "files"}>
                      <h3 className="material-title">Tài liệu học tập</h3>
                      <label className="material-ai-option">
                          <input type="checkbox" checked={preferAiReading} disabled={busy || studyGuideNeedsConfirmation} onChange={(e) => setPreferAiReading(e.target.checked)} aria-describedby="material-ai-help" />
                        <span>Ưu tiên dùng AI để đọc PDF/ảnh</span>
                      </label>
                      <p id="material-ai-help" className="material-hint">Thông thường, ứng dụng đọc chữ trên thiết bị. Với ảnh/PDF khó đọc, AI dùng chính API Google AI Studio (Gemini) đã tích hợp. Tệp chỉ được gửi khi bạn bấm “Đọc bằng AI”; cần đăng nhập.</p>
                      <label className="file-label">
                        Chọn tệp tài liệu
                        <input
                          type="file"
                          multiple
                          disabled={busy || studyGuideNeedsConfirmation}
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            e.target.value = "";
                            void importMaterials(files);
                          }}
                        />
                      </label>
                      <details className="material-formats"><summary>Định dạng và giới hạn tệp</summary><p className="material-hint">Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), PDF, OpenDocument và văn bản. OCR đọc tiếng Việt và tiếng Anh từ PDF quét, ảnh PNG/JPG/WebP/BMP ngay trên thiết bị. Tối đa 32 MiB/tệp, 10 tệp/chuyến, 50.000 ký tự; ảnh tối đa 20 megapixel, PDF tối đa 20 trang được đọc và 20 trang dùng OCR. Tệp chưa hỗ trợ đọc vẫn hiển thị tên và báo trạng thái.</p></details>
                      {materialProgress && <div className="material-progress">
                        <p role="status"><strong>{materialProgress.file}</strong><br/>
                          {{ loading: "Đang nạp bộ đọc", recognizing: "Đang nhận diện chữ (OCR)", rendering: "Đang dựng trang", extracting: "Đang đọc văn bản" }[materialProgress.phase]}
                          {materialProgress.page != null && ` · Trang ${materialProgress.page}${materialProgress.totalPages ? `/${materialProgress.totalPages}` : ""}`}
                        </p>
                        <progress aria-label="Tiến độ đọc tài liệu" max={1} value={materialProgress.progress} />
                        <button onClick={() => materialRequest.current?.abort()}>Hủy đọc tài liệu</button>
                      </div>}
                      <p className="material-hint">AI đọc cả chữ in và chữ viết tay, đồng thời đề xuất khôi phục phần mờ dựa trên ngữ cảnh. Chỗ suy luận được đánh dấu [suy luận: …]; chỗ thiếu căn cứ giữ [không rõ]. Hãy kiểm tra trước khi dùng làm tài liệu.</p>
                      </div>
                      {sources.map((source) => <details className="material-source" key={source.id} open={!source.reviewed}>
                        <summary>{source.name} · {source.reviewed ? "Đã kiểm tra" : "Cần kiểm tra nội dung"}</summary>
                        <MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} disabled={busy} maxLength={source.source === "ai-generated" ? 20000 : 50000} textareaLabel={`Nội dung nguồn · ${source.name}`} placeholder="Nhập hoặc sửa bản chép đúng của tài liệu. Không tự dịch nội dung." onChange={(text) => setSources((items) => items.map((item) => item.id === source.id ? {...item,text,reviewed:false} : item))} />
                        <div className="choice-row">
                          <MaterialSourceReviewButton disabled={busy || source.text.trim().length < 10} onClick={() => { try { const reviewed = reviewMaterialSource(source, source.text); setSources((items) => items.map((item) => item.id === source.id ? reviewed : item)); setError(""); } catch(e) { setError(e instanceof Error ? e.message : "Không xác nhận được tài liệu."); } }} />
                          {source.source !== "ai-generated" && <button disabled={busy || !originalFiles.current.has(source.id) || !/\.(pdf|png|jpe?g|webp)$/i.test(source.name)} onClick={() => void readHandwriting(source.id)}>Đọc bằng AI · gửi tệp này</button>}
                          {source.source === "ai-generated" && <button disabled={busy} onClick={() => downloadStudyGuide({title:source.name.replace(/\.txt$/i, ""),text:source.text})}>Tải bản ôn tập (.txt)</button>}
                          <button disabled={busy} onClick={() => { originalFiles.current.delete(source.id); setSources((items) => items.filter((item) => item.id !== source.id)); setMaterials((items) => items.filter((file) => source.covers ? !source.covers.includes(file.name) : file.sourceId !== source.id)); }}>Gỡ tài liệu</button>
                        </div>
                        {source.source !== "ai-generated" && !originalFiles.current.has(source.id) && <small>Muốn đọc lại bằng AI, hãy nhập lại tệp gốc.</small>}
                      </details>)}
                      {!!materials.length && <ul className="material-list" aria-label="Tài liệu đã chọn">{materials.map((file, i) => <li key={`${i}:${file.name}`}>
                        <strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · {file.message}</span>
                      </li>)}</ul>}
                    </section>
                    <section className="panel form departure-settings">
                      <div className="eyebrow">LỘ TRÌNH CỦA BẠN</div>
                      <h2>Sẵn sàng khởi hành</h2>
                      <TicketEditor initiallyOpen={goal.trim().length < 3 || !Number.isInteger(minutes) || minutes < 1 || minutes > 240 || !validBreaks}>
                        <label>
                          Mục tiêu học tập
                          <textarea
                            value={goal}
                            maxLength={500}
                              disabled={busy || studyGuideNeedsConfirmation}
                            onChange={(e) => {
                              updateQuickTripDraft(quickTripDraft, { goal: e.target.value });
                              setGoal(e.target.value);
                            }}
                            placeholder="Mình muốn hiểu điều gì sau chuyến này?"
                          />
                        </label>
                        <label>
                          Chủ đề
                          <select
                            value={topic}
                              disabled={busy || studyGuideNeedsConfirmation}
                            onChange={(e) => {
                              updateQuickTripDraft(quickTripDraft, { topic: e.target.value });
                              setTopic(e.target.value);
                            }}
                          >
                            {availableTopics.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <DurationPicker
                          value={minutes}
                          onChange={(value) => {
                            updateQuickTripDraft(quickTripDraft, { minutes: value });
                            setMinutes(value);
                          }}
                          breakCount={breakCount}
                          breakMinutes={breakMinutes}
                          onBreakCountChange={(value) => {
                            updateQuickTripDraft(quickTripDraft, { breakCount: value });
                            setBreakCount(value);
                          }}
                          onBreakMinutesChange={(value) => {
                            updateQuickTripDraft(quickTripDraft, { breakMinutes: value });
                            setBreakMinutes(value);
                          }}
                        />
                      </TicketEditor>
                      <label className="quiz-count-label" htmlFor="departure-quiz-count">
                        Số câu hỏi ôn tập
                        <input
                          id="departure-quiz-count"
                          type="number"
                          min={1}
                          max={30}
                          step={1}
                          value={quizCount}
                          aria-invalid={!isQuizCount(Number(quizCount))}
                          onChange={(event) => setQuizCount(event.target.value)}
                          aria-describedby="departure-quiz-hint"
                        />
                      </label>
                      <small id="departure-quiz-hint" className="departure-quiz-hint">
                        {isQuizCount(Number(quizCount))
                          ? "Khi đăng nhập, nguồn đã kiểm tra được gửi cho AI để chuẩn bị câu hỏi trong lúc bạn tập trung. Bạn có thể đổi số lượng ở phần thành quả."
                          : "Chọn số câu hỏi là số nguyên từ 1 đến 30."}
                      </small>
                      <h3 className="departure-companion-title">Bạn đồng hành</h3>
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
                      <p className="material-hint">Chuyến chỉ xuất hiện trong Kết quả tester nếu bạn đăng nhập, đồng bộ và chủ động công khai từ tổng kết. Mục tiêu riêng, tài liệu và ghi chú vẫn được giữ riêng.</p>
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          studyGuideNeedsConfirmation ||
                          !!active ||
                          goal.trim().length < 3 ||
                          !Number.isInteger(minutes) ||
                          minutes < 1 ||
                          minutes > 240 || !validBreaks ||
                          !isQuizCount(Number(quizCount)) ||
                          !exclusive
                        }
                        onClick={start}
                      >
                        Bắt đầu chuyến ·{" "}
                        {Number.isFinite(minutes) ? minutes : "…"} phút học →
                      </button>
                      {studyGuideNeedsConfirmation && <p className="material-hint" role="status">Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi bắt đầu chuyến.</p>}
                      {active && (
                        <button onClick={() => go("focus")}>
                          Tiếp tục phiên đang mở
                        </button>
                      )}
                      <details className="info-box trip-rules">
                        <summary>Quy tắc chuyến đi & quyền riêng tư</summary>
                        <p>Chỉ phiên đã đồng bộ mà bạn chủ động chọn công khai từ tổng kết mới xuất hiện trong Kết quả tester. Có thể cập nhật mức hoàn thành tự đánh giá hoặc rút từng phiên bất cứ lúc nào. Bảng công khai không hiển thị mục tiêu riêng, email tài khoản, tài liệu, lời giải hay câu trả lời chi tiết.</p>
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
                      </details>
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
                      {ticketCode?.id === active.id && <span className="pill">Mã chuyến {ticketCode.value}</span>}
                      <p>
                        {rest ? "Dừng chân một chút. Chuyến sẽ tự tiếp tục sau giải lao." : active.state === "away"
                          ? "Đồng hồ vẫn chạy. Khoảng thời gian bạn rời đi không được cộng vào thời gian học."
                          : "Không vội vàng. Chỉ cần hiện diện ở đây."}
                      </p>
                    </div>
                    <section className="focus-card">
                      <div className="focus-phase-label">
                        {rest ? `Trạm dừng chân ${rest.index}/${rest.count}` : `Chặng học ${(studyStage?.index ?? 0) + 1}/${studyStage?.count ?? 1}`}
                      </div>
                      <FlipClock seconds={rest ? rest.remainingSeconds : studyStage?.remainingSeconds ?? active.target - elapsedSeconds(active, displayAt)}
                        label={rest ? "Giải lao còn lại" : "Chặng học còn lại"}
                        motionAllowed={active.state === "focus" || active.state === "reconnecting"} />
                      <p className="focus-next" role="status">
                        {rest
                          ? `Tự tiếp tục chặng học ${rest.index + 1}/${rest.count + 1} lúc ${new Date(rest.endsAt).toLocaleTimeString("vi-VN", {hour: "2-digit", minute: "2-digit", second: "2-digit"})}`
                          : studyStage && studyStage.index < studyStage.count - 1
                            ? `Tiếp theo: giải lao ${clock(active.breakPlan?.seconds ?? 0)}`
                            : "Chặng cuối · chuyến hoàn tất khi đồng hồ về 00:00"}
                      </p>
                      {active.breakPlan && active.breakPlan.count > 0 && <p className="focus-plan-total">{active.target / 60} phút học + {active.breakPlan.count * active.breakPlan.seconds / 60} phút nghỉ · tổng chuyến {totalDuration(active) / 60} phút</p>}
                      <div className="timer-label">
                        {Math.floor(focused(active) / 60)} PHÚT ĐÃ HỌC ·{" "}
                        {Math.round((focused(active) / active.target) * 100)}%
                        CHUYẾN ĐI
                        <br />
                        {active.distractions ?? 0} LẦN XAO NHÃNG
                      </div>
                      <JourneyView
                        journey={
                          active.groupId && group?.id === active.groupId
                            ? group.journey
                            : personalJourney
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
                        fog={active.state === "away" && !rest}
                        draftSeconds={active.groupId ? 0 : focused(active)}
                        targetSeconds={active.target}
                        focusState={rest ? "break" : active.state}
                        restStop={rest ? {index:rest.index,count:rest.count} : null}
                        upcomingRestStop={!rest && studyStage && active.breakPlan && studyStage.index < active.breakPlan.count
                          ? { index: studyStage.index + 1, count: active.breakPlan.count, remainingSeconds: Math.max(0, (studyStage.endsAt - displayAt) / 1000) }
                          : null}
                        sessionTiming={tripSceneTiming(active, displayAt)}
                        motionAllowed={active.state === "focus" || active.state === "reconnecting"}
                        reconnect={active.reconnect}
                      />
                      {active.groupId && <p className="overhead-hint">Bản đồ đoàn mở thêm vùng sau khi máy chủ xác nhận phần đóng góp của phiên này.</p>}
                      <div className="focus-controls">
                        <ThemeToggle />
                        <div className="study-fullscreen-control">
                          <button type="button" onClick={studyFullscreen.toggle} aria-pressed={studyFullscreen.isFullscreen} disabled={studyFullscreen.status === "pending" && !studyFullscreen.isFullscreen}>
                            {studyFullscreen.isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
                          </button>
                          {studyFullscreen.message && <span className="study-fullscreen-status" role="status">{studyFullscreen.message}</span>}
                        </div>
                        {deviceClockBehind && <div className="info-box">
                          <p>Đồng hồ thiết bị đang chạy lùi. Hãy đặt lại giờ đúng để tiếp tục; dữ liệu phiên vẫn được giữ.</p>
                          <button onClick={exportData}>Xuất bản sao phiên học</button>
                        </div>}
                        <button disabled={deviceClockBehind} onClick={() => setConfirm("finish")}>
                          Kết thúc và lưu
                        </button>
                      </div>
                    </section>
                    {active.document && (
                      <details className="panel study-notes">
                        <summary>Tài liệu của bạn · đọc ngay tại đây</summary>
                        <MaterialSourceReader title="Nội dung ôn tập" text={active.document} />
                      </details>
                    )}
                    {active.sources?.map((source) => <details className="panel study-notes" key={source.id}><summary>Nguồn tài liệu · {source.name}{!source.reviewed && " · chưa kiểm tra"}</summary><MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} /></details>)}
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
                    journey={journey}
                    carriages={trainCars}
                    ownId={owner}
                    draftSeconds={mapActive ? focused(mapActive) : 0}
                    targetSeconds={mapActive?.target}
                  />
                  {mode === "group" && group && <p className="overhead-hint">Bản đồ đoàn dùng tiến độ đã được máy chủ xác nhận, gồm giới hạn đóng góp mỗi ngày.</p>}
                  {mode === "solo" && pendingSoloSeconds > 0 && <p className="overhead-hint">Vùng đã học được giữ trên thiết bị; các phiên đang chờ đồng bộ sẽ được máy chủ xác nhận khi có mạng.</p>}
                  <div className="station-list">
                    {stations.map((s, i) => (
                      <article
                        key={s}
                        className={`station-stop ${i <= mapProgress.station ? "unlocked" : ""}`}
                      >
                        <span className="station-number">
                          {i <= mapProgress.station ? "✓" : "?"}
                        </span>
                        <div>
                          <small>
                            {i === mapProgress.station
                              ? "BẠN ĐANG Ở ĐÂY"
                              : i < mapProgress.station
                                ? "ĐÃ KHÁM PHÁ"
                                : "CHƯA MỞ"}
                          </small>
                          <h2>{i <= mapProgress.station ? s : "Vùng chưa khám phá"}</h2>
                          <p>
                            {i <= mapProgress.station
                              ? stories[i]
                              : "Học thêm để mở cảnh quan và câu chuyện ở trạm này."}
                          </p>
                        </div>
                        {i === mapProgress.station && (
                          <strong>
                            {Math.floor(mapProgress.remainingSeconds / 60)} phút
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
                  <SceneFallback
                    color={carriage?.color}
                    decor={carriage?.decor}
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
                            thấy tài liệu, lời giải hay chi tiết trả lời quiz.
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
                    text="Phiên ngắn hay dài đều có giá trị. Kết quả chỉ được công khai nếu bạn chủ động chọn chia sẻ từ tổng kết."
                  />
                  {sessions.length ? (
                    <div className="session-list">
                      {sessions.map((s) => {
                        const analysis = analyzeSession(s);
                        const gaps = knowledgeGaps(s.quiz);
                        return (
                          <button
                            key={s.id}
                            className="session-row"
                            onClick={() => {
                              setSummary(s);
                              commitRef.current({ ...current.current, summarySessionId: s.id });
                              go("summary");
                            }}
                          >
                            <span className="feature-icon green">▤</span>
                            <div className="session-row-content">
                              <h3>{s.goal}</h3>
                              <p>
                                {date(s.ended)} ·{" "}
                                {s.groupId ? "Đóng góp cho đoàn" : "Cá nhân"} ·{" "}
                                {saved.pending.some((p) => p.id === s.id)
                                  ? "Chờ đồng bộ"
                                  : "Đã lưu"}
                              </p>
                              <div className="session-analysis">
                                {analysis.breakSeconds > 0 && <p>Giải lao: {clock(analysis.breakSeconds)} · không tính xao nhãng hoặc XP</p>}
                                <span>{analysis.focusLabel} · {analysis.focusPercent === null ? "—" : `${Math.floor(analysis.focusPercent)}%`} tập trung</span>
                                <span>Số lần xao nhãng: <b>{analysis.distractions}</b></span>
                                <span>Điểm {s.quiz ? `${s.quiz.score}/${s.quiz.total}` : "Chưa làm"}</span>
                                <span>{s.quiz?.feedback
                                  ? gaps.length ? `${gaps.length} nội dung cần ôn lại` : "Chưa ghi nhận câu sai trong bộ này"
                                  : analysis.knowledgeLabel}</span>
                                <small>{analysis.focusExplanation}</small>
                              </div>
                            </div>
                            <strong>{Math.floor(s.seconds / 60)} phút ↗</strong>
                          </button>
                        );
                      })}
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
              {view === "admin" && (adminAccess.allowed
                ? <AdminPanel onClose={() => go("station")} onAccessDenied={adminAccess.refresh} currentUserId={user?.id} />
                : <section className="panel">
                  <h2 ref={adminNoticeHeading} tabIndex={-1}>Khu vực quản trị</h2>
                  <p>{adminAccess.checking ? "Đang kiểm tra quyền truy cập…" : !user || needsLogin
                    ? "Đăng nhập bằng tài khoản quản trị để xem báo cáo."
                    : !online || authOffline ? "Kết nối lại máy chủ để mở báo cáo quản trị."
                      : "Tài khoản này chưa được cấp quyền quản trị."}</p>
                  <div className="choice-row">
                    <button onClick={() => go("account")}>Mở tài khoản</button>
                    {user && !needsLogin && online && !authOffline && <button disabled={adminAccess.checking} onClick={adminAccess.refresh}>Kiểm tra lại quyền</button>}
                  </div>
                </section>)}
              {view === "summary" &&
                (summarySession ? (
                  <>
                    <Heading
                      kicker="MỖI PHÚT ĐỀU CÓ Ý NGHĨA"
                      title="Thêm một chặng đường đáng nhớ."
                      text={summarySession.goal}
                    />
                    <div className="summary-arrival">
                      <TopDownScene
                        carriages={[{
                          id: owner,
                          name: carriage?.name ?? "Toa của bạn",
                          color: carriage?.color ?? "#398575",
                        }]}
                        ownId={owner}
                        running={false}
                        fogStrength={0}
                        motionAllowed={false}
                        arrival={{
                          label: summaryCompleted
                            ? "Đã đến ga cuối của chuyến học."
                            : "Chuyến dừng sớm · thành quả vẫn được giữ.",
                          completed: summaryCompleted,
                        }}
                      />
                    </div>
                    <div className="stat-row summary-stats">
                      <Stat
                        icon="◷"
                        label="THỜI GIAN TẬP TRUNG"
                        value={clock(summarySession.seconds)}
                        detail="Đã loại khoảng xao nhãng"
                      />
                      <Stat
                        icon="✦"
                        label="KINH NGHIỆM TOA"
                        value={`${Math.floor(summarySession.seconds / 60)} XP`}
                        detail="1 phút tập trung = 1 XP · XP ghi nhận nỗ lực, không đo mức độ thành thạo"
                      />
                      <Stat
                        icon="↗"
                        label="SỐ LẦN XAO NHÃNG"
                        value={`${summarySession.distractions ?? summarySession.segments.filter(segment => segment.kind === "distraction").length}`}
                        detail="Mỗi lần rời phiên được ghi nhận một lần"
                      />
                      <Stat
                        icon="⚑"
                        label="TRẠNG THÁI"
                        value={
                          saved.pending.some((s) => s.id === summarySession.id)
                            ? "Đang chờ"
                            : "Đã lưu"
                        }
                        detail="Quiz không chặn lưu thành quả"
                      />
                    </div>
                    <section className="panel">
                      <h2>Mang kiến thức theo chuyến đi</h2>
                      {!!saved.materials?.[summarySession.id]?.length && <details className="material-history"><summary>Tài liệu của chuyến · {saved.materials[summarySession.id].length} tệp</summary><ul className="material-list">{saved.materials[summarySession.id].map((file, i) => <li key={`${i}:${file.name}`}><strong>{file.name}</strong><span>{file.message}</span></li>)}</ul></details>}
                      <p>
                        Ôn lại một chút trước khi nghỉ. Làm sau cũng được; phần
                        học của bạn đã được lưu.
                      </p>
                      {!!saved.materials?.[summarySession.id]?.length && !saved.sources?.[summarySession.id]?.length && <div className="info-box"><p>Tài liệu này được lưu bằng phiên bản cũ. Khôi phục bản chép đã lưu hoặc dán nội dung đúng, rồi xác nhận làm nguồn câu hỏi.</p><button onClick={() => {const value = current.current;if(value.summarySessionId !== summarySession.id) return;invalidateQuizForSourceEdit(owner, summarySession.id);commitRef.current({...value,sources:{...value.sources,[summarySession.id]:[recoveredMaterialSource(value.notes[summarySession.id] ?? "",value.materials?.[summarySession.id] ?? [])]},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});}}>Khôi phục / nhập bản chép tài liệu cũ</button></div>}
                      {(saved.sources?.[summarySession.id] ?? []).map((source) => <details className="material-source" key={source.id} open={!source.reviewed}>
                        <summary>Nguồn câu hỏi · {source.name} · {source.reviewed ? "Đã kiểm tra" : "Cần kiểm tra"}</summary>
                        <MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} textareaLabel="Bản chép tài liệu" onChange={(text) => {
                          const value = current.current;
                          if(value.summarySessionId !== summarySession.id) return;
                          invalidateQuizForSourceEdit(owner, summarySession.id);
                          commitRef.current({...value,sources:{...value.sources,[summarySession.id]:(value.sources?.[summarySession.id] ?? []).map(item => item.id === source.id ? {...item,text,reviewed:false} : item)},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});
                        }} />
                        <MaterialSourceReviewButton disabled={source.text.trim().length < 10} onClick={() => {try {
                          const value = current.current;
                          if(value.summarySessionId !== summarySession.id) return;
                          const reviewed = reviewMaterialSource(source, source.text);
                          invalidateQuizForSourceEdit(owner, summarySession.id);
                          commitRef.current({...value,sources:{...value.sources,[summarySession.id]:(value.sources?.[summarySession.id] ?? []).map(item => item.id === source.id ? reviewed : item)},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});
                          setError("");
                        } catch(e) {setError(e instanceof Error ? e.message : "Không xác nhận được nguồn.");}}} />
                      </details>)}
                      <QuizPanel
                        key={`${owner}:${summarySession.id}`}
                        ownerId={owner}
                        session={summarySession}
                        draft={saved.quizDrafts?.[summarySession.id]}
                        prefetchStatus={summaryQuizPrefetch?.status}
                        prefetchError={summaryQuizPrefetch?.message}
                        canUseAI={!!user && !needsLogin}
                        needsLogin={needsLogin}
                        onGenerate={(count) => generateQuiz(summarySession, count)}
                        onSaveDraft={(draft) => saveQuizDraft(owner, summarySession.id, draft)}
                        onGrade={(answers) => gradeQuiz(summarySession.id, answers)}
                        onLogin={() => go("account")}
                        onStartReview={() => startReviewTrip(summarySession)}
                      />
                    </section>
                    {owner === "guest" ? <section className="panel experiment-share">
                      <h2>Đóng góp kết quả thực nghiệm</h2>
                      <p>Phiên khách không được công khai tự động. Hãy bắt đầu phiên sau khi đăng nhập; khi phiên được đồng bộ, bạn có thể chọn công khai từ tổng kết.</p>
                      <p role="status">{saved.guestPublished?.includes(summarySession.id)
                        ? "Bản lưu khách đã được máy chủ nhận; phiên này vẫn chưa được công khai."
                        : guestPublication[summarySession.id]?.status === "save-failed"
                          ? "Máy chủ đã nhận bản lưu khách, nhưng thiết bị chưa lưu xác nhận. Phiên này vẫn chưa được công khai."
                          : guestPublication[summarySession.id]?.status === "sending"
                            ? "Đang lưu bản khách riêng; phiên này chưa được công khai."
                            : guestPublication[summarySession.id]?.status === "failed"
                              ? `Chuyến vẫn lưu trên thiết bị; chưa gửi được bản khách riêng. ${guestPublication[summarySession.id].message ?? ""}`
                              : "Chuyến khách được lưu trên thiết bị; không tự động công khai."}</p>
                    </section> : <ExperimentShare
                      key={summarySession.id}
                      sessionId={summarySession.id}
                      canPublish={Boolean(user) && !needsLogin}
                      sync={sync}
                    />}
                    <div className="choice-row">
                      <button onClick={() => go("experiments")}>Xem kết quả tester →</button>
                      {owner !== "guest" && saved.pending.some(session => session.id === summarySession.id) &&
                        <button disabled={busy || !online || needsLogin} onClick={() => void run(sync)}>Thử đồng bộ lại</button>}
                    </div>
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
                <ProfilePanel
                  account={user}
                  connectionLabel={!user ? "Lưu trên thiết bị này" : needsLogin
                    ? "Cần đăng nhập lại để đồng bộ" : !online || authOffline
                      ? "Đang dùng dữ liệu trên thiết bị" : saved.pending.length
                        ? `Còn ${saved.pending.length} phiên chờ đồng bộ` : data
                          ? "Đã có bản đồng bộ của tài khoản" : "Chưa có bản đồng bộ từ máy chủ"}
                  journey={personalJourney ? {
                    carriageName: carriage?.name ?? "Toa Mây",
                    stationLabel: stations[Math.min(stations.length - 1, personalJourney.station)],
                    stationIndex: personalJourney.station,
                    stationCount: stations.length,
                  } : null}
                  stats={{ ...accountStats, recentStudies: accountStats.recentStudies.map(study => ({
                    ...study, topic: availableTopics.find(item => item.id === study.topic)?.name ?? study.topic,
                  })) }}
                  admin={{ state: !user || needsLogin ? "login-required" : !online || authOffline
                    ? "offline" : adminAccess.checking ? "checking" : adminAccess.allowed
                      ? "available" : "not-confirmed",
                    canRefresh: !!user && !needsLogin && online && !authOffline }}
                  actions={{
                    onSync: () => void run(sync), syncDisabled: busy || needsLogin || !online,
                    onLogout: () => void run(logout), logoutDisabled: busy || !!active,
                    onExport: exportData, onOpenAdmin: () => go("admin"),
                    onRefreshAdmin: adminAccess.refresh,
                  }}
                  authContent={(!user || needsLogin) ? (
                    <AuthForm
                      busy={busy}
                      blocked={!!active && !needsLogin}
                      disableRegistration={!!active}
                      lockedEmail={needsLogin && active && user ? user.email : undefined}
                      onAuthenticate={({ email, password, name }) => run(async () => {
                        await login(email, password, name);
                        go("station");
                      })}
                      onContinue={() => go("station")}
                    />
                  ) : null}
                  privacyContent={
                    <div className="info-box">
                      <h3>Dữ liệu và quyền riêng tư</h3>
                      <p>
                        Nội dung tài liệu được giữ trên thiết bị. Tạo câu hỏi gửi nguồn đã kiểm tra cho AI;
                        “Đọc bằng AI” gửi riêng tệp gốc đã chọn tới Google Gemini để nhận diện chữ.
                        Dữ liệu học của tài khoản được lưu trên máy chủ; đoàn chỉ xem toa và tiến độ chung.
                      </p>
                      <p>Chỉ phiên đã đăng nhập và đồng bộ mà bạn chủ động chọn công khai từ tổng kết mới xuất hiện trong Kết quả tester. Bạn có thể cập nhật mức hoàn thành tự đánh giá hoặc rút từng phiên. Mục tiêu riêng, email, tên tài khoản, tài liệu, lời giải và câu trả lời chi tiết không xuất hiện công khai.</p>
                      <p>
                        Ở chế độ khách, tiến độ và tài liệu được giữ trong trình duyệt này;
                        chuyến khách không được công khai tự động.
                        Xuất bản sao trước khi xóa dữ liệu trình duyệt.
                      </p>
                      <p>Tên tài khoản gần nhất được giữ trên thiết bị để mở lại phiên offline. Đăng xuất sẽ xóa thông tin này; mật khẩu và token không được lưu lâu dài.</p>
                    </div>
                  }
                />
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
          ▥ {rest ? `Giải lao ${rest.index}/${rest.count}` : `Chặng học ${(studyStage?.index ?? 0) + 1}/${studyStage?.count ?? 1}`} · {clock(rest ? rest.remainingSeconds : studyStage?.remainingSeconds ?? active.target - elapsedSeconds(active, displayAt))} →
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
function TicketEditor({ initiallyOpen, children }: { initiallyOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className="ticket-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="ticket-editor-icon" aria-hidden="true">✎</span>
        <span className="ticket-editor-copy"><strong>Sửa vé chuyến học</strong><small>Mục tiêu · chủ đề · thời gian</small></span>
        <span className="ticket-editor-action" aria-hidden="true">{open ? "Thu gọn −" : "Chỉnh sửa +"}</span>
      </summary>
      <div className="ticket-editor-fields">{children}</div>
    </details>
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
