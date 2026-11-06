import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { canonicalStudyView, isStudyWorkspaceView, replaceBrowserView, useBrowserView } from "./navigation";
import { useAuthStore } from "@/store/authStore";
import { getAuthGeneration, post, request } from "@/services/api";
import { postGuestAi, startGuestAiSession } from "@/services/guestAiApi";
import { summarizeReviewedMaterial } from "@/services/materialSummary";
import { bindStudyExercises } from "@/services/studyExercisesApi";
import { AuthForm } from "./AuthForm";
import { AdminPanel } from "./AdminPanel";
import { ProfilePanel } from "./ProfilePanel";
import { profileStats } from "./profileStats";
import { useAdminAccess } from "./useAdminAccess";
import { SceneFallback } from "./SceneFallback";
import { BoardingTicket } from "./BoardingTicket";
import { StudyNotesInput } from "./StudyNotesInput";
import { StudyGuideComposer, type StudyGuideUseMode } from "./StudyGuideComposer";
import { MaterialSourceReader, MaterialSourceReviewButton } from "./MaterialSourceReader";
import { MaterialSummaryControl } from "./MaterialSummaryControl";
import { PublicMaterialSummaryControl, type PublicMaterialSummaryScope } from "./PublicMaterialSummaryControl";
import { QuietFocusCanvas } from "./QuietFocusCanvas";
import { ThemeToggle } from "./theme";
import { studyGuideDownload, studyGuideSource, type StudyGuideDraft } from "./studyGuide";
import { createStudyGuideReviewState, hasPendingStudyGuide as hasPendingGuideReview, reduceStudyGuideReview } from "./studyGuideReview";
import { useStudyFullscreen } from "./useStudyFullscreen";
import { FocusFullscreenRecovery } from "./FocusFullscreenRecovery";
import { JourneyView } from "./JourneyView";
import { FocusStudyCompanion, SessionSummaryCompanion } from "./StudySessionPresentation";
import { detectDeviceCategory } from "./device";
import { explorationProgress } from "./exploration";
import type { MaterialExtractionProgress } from "./materialExtraction";
import { createMaterialSource, editMaterialSourceText, reviewMaterialSource, recoveredMaterialSource, quizSourceText, validateStudyGuideAppend, type MaterialSource } from "./materialSources";
import { cachedMaterialSummary, canApplyMaterialSummaryResponse, canRequestMaterialSummary, fingerprintMaterialSourceText, type MaterialSummaryScope } from "./materialSummary";
import {
  eligiblePublicMaterialSummaryCandidates,
  type PublicMaterialSummaryCandidate,
} from "@/services/publicMaterialSummary";
import { StudyWorkspaceSettings } from "./StudyWorkspaceSettings";
import { ExperimentResults } from "./ExperimentResults";
import { PublicReport } from "./PublicReport";
import { QuizPanel } from "./QuizPanel";
import { QuizReviewPreference } from "./QuizReviewPreference";
import {
  StudyExercisePreparation as StudyExercisePreparationEditor,
  StudyExerciseQuestionViewer,
} from "./StudyExercisePreparation";
import { StudyOnboarding } from "./StudyOnboarding";
import { StudyJournal } from "./StudyJournal.tsx";
import { buildStudyJournalEntries, buildStudyJournalSources } from "./studyJournal.ts";
import { canShowStudyOnboarding, completeStudyOnboardingRetrievalChoice, reopenStudyOnboardingFromDraft, syncStudySurveyWithCurrentDraft, type StudyOnboardingProgress } from "./studyOnboardingModel.ts";
import {
  advanceStudyPlanCandidateAfterStart,
  applyStudyPlanStepPatch,
  createStudyPlanStorage,
  findStudyWorkspaceDraft,
  saveStudyWorkspaceDraft,
  selectedStudyWorkspaceIdentity,
  studyWorkspaceSourceContentChanged,
  updateStudyPlanDraftFromQuickTrip,
  type StudyPlanStorage,
} from "./studyPlanStorage.ts";
import { StudyPlanWorkspace, type StudyPlanStepPatch } from "./StudyPlanWorkspace";
import { buildStudyPlanRequest, generateStudyPlan } from "@/services/studyPlanApi";
import { isCurrentStudyPlanRequest } from "./studyPlanFlow";
import {
  CuratedEvaluation,
  CuratedEvaluationReceipt,
  LearningPathLessonDetail,
  LearningPathRetryNotice,
} from "./LearningPathView";
import {
  canResumeBoundSynchronizedTrip,
  isSynchronizedTrip,
  shouldAutoResumeSynchronizedTrip,
  canOfferLegacyGroupCleanup,
  synchronizedTripControls,
  synchronizedTripDraftForSession,
  synchronizedTripQuizPreferences,
  tripDraftLocks,
} from "./synchronizedTripUi";
import { isValidPersonalStudyStartDuration, isValidStudyMinutes, updateQuickTripDraft, updateQuickTripDuration, type QuickTripDraft } from "./quickTripDraft";
import { QuizPrefetchCoordinator, quizPrefetchScopeKey, type QuizPrefetchScope } from "./quizPrefetch";
import { isCurrentQuizPrefetchRequest } from "./quizPrefetchPresentation";
import {
  startStudyExerciseFocusIfAllowed,
  isGuestExerciseStartScopeCurrent,
  isPersistedStudyExerciseSessionCompleted,
  studyExerciseSourcesForSession,
} from "./studyExerciseSessionFlow";
import { useStudyExerciseFlow } from "./useStudyExerciseFlow";
import {
  groupDraftSessionId,
  isTripStartCurrent,
  recoverBoundTripSessionId,
  rotateDraftSessionId,
  startAfterTripReservation,
  type TripDraftSessionIds,
} from "./tripStart";
import { buildQuizGenerationPayload, quizDraftFromQuestions, quizGenerationSourceKey } from "./quizGeneration";
import { guestPublicationNotice, permanentGuestFailure, publishGuestSessions, type GuestPublicationStatus } from "./guestPublication";
import { GuestHistorySync } from "./GuestHistorySync";
import { SessionCorrectionNotice } from "./SessionCorrectionNotice";
import { RevisionMaterialsLibrary } from "./RevisionMaterialsLibrary";
import { buildRevisionMaterialEntries, collectRevisionMaterialRecords } from "./revisionMaterialEntries";
import { studyTopics } from "./topics";
import {
  CURATED_COURSES,
  beginLessonRun,
  completeLessonRun,
  createLearningPathProgress,
  finishLessonFocus,
  interruptedLessonForSession,
  lessonStates,
  nextAvailableLesson,
  retireInactiveLegacyLessonRun,
  selectPathLesson,
  setLessonRunPlan,
  setLessonRunPhase,
} from "./learningPath";
import {
  difficultySuggestion,
  durationSuggestion,
} from "./learningPathInsights";
import type { CuratedLesson } from "./curatedCurriculum";
import {
  breakStatus,
  studyStageStatus,
  totalDuration,
  depart,
  elapsedSeconds,
  focused,
  isDeviceClockBehind,
  leaveFocusView,
  restore,
  resolveTripBreakPlan,
  returnFromBackground,
  sessionEndAt,
  startSynchronizedSession,
  startGuestAnchoredSession,
  tick,
  tripClockNow,
  type ActiveTrip,
} from "./focus";
import { estimateServerClockOffset, serverTimeFromClientTime } from "./serverClock";
import { isValidBreakPlan, studyElapsedSeconds } from "../../backend/src/adventure/domain";
import {
  emptySaved,
  historySessions,
  isCurrentOwnerWorkspace,
  readSaved,
  reconcileOwnerSnapshot,
  suppressRemovedSessions,
  syncOwnerHistory,
  cacheMaterialSummary,
  removeMaterialSummaryCacheEntry,
  writeSaved,
  type Saved,
  type SessionHistoryEntry,
} from "./storage";
import { canStartSessionWithQuizReview, createSessionQuizDraft, isQuizCount, isValidGuestQuizDeck, isValidGuestQuizGrade, isValidQuizAssessment, isValidQuizDraft, quizPanelDraftState, shouldPrefetchQuizReview, updateQuizDrafts, type GuestQuizQuestion, type QuizDraft, type QuizQuestion } from "./quizDrafts";
import { analyzeSession, reviewPlan } from "./learning";
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
  { id: "station", icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 7.5 10 3l6.5 4.5v9h-13v-9Z"/><path d="M8 16.5v-5h4v5"/></svg>, label: "Lộ trình", mobileLabel: "Lộ trình" },
  { id: "library", icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5h8.5a3 3 0 0 1 3 3v8H6a3 3 0 0 1-3-3z"/><path d="M6 4.5v11m3-8h3m-3 3h3"/></svg>, label: "Thư viện ôn tập", mobileLabel: "Tài liệu" },
  { id: "journal", icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 2.5h12v15H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z"/><path d="M7 7h7m-7 4h7m-7 4h4"/></svg>, label: "Nhật ký học tập", mobileLabel: "Nhật ký" },
  { id: "experiments", icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3v7l4 2.5M17 8a7.5 7.5 0 1 1-3-4"/><path d="M14 2.5h4v4"/></svg>, label: "Lịch sử phiên học", mobileLabel: "Lịch sử" },
  { id: "report", icon: <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 3.5v13h14" /><path d="M6 13v-3m4 3V6m4 7V8" strokeLinecap="round" /></svg>, label: "Báo cáo", mobileLabel: "Báo cáo" },
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
  correctionVersion: number;
  count: number;
  sourceKey?: string;
  requestGeneration?: number;
  status: "pending" | "ready" | "failed";
  message?: string;
};
type QuizPrefetchResult = {
  questions: (QuizQuestion | GuestQuizQuestion)[];
  guestQuizId?: string;
};
type QuizSessionSource = Pick<SessionHistoryEntry, "id" | "topic" | "goal"> &
  Partial<Pick<SessionHistoryEntry, "correctionVersion" | "effectiveMetrics" | "correctionFlags" | "quiz">>;

type MaterialSummaryUiState = MaterialSummaryScope & {
  status: "pending" | "ready" | "failed";
  summary?: string;
  error?: string;
};
type ActiveMaterialSummaryRequest = {
  controller: AbortController;
  ownerId: string;
  workspaceGeneration: number;
  authGeneration: number;
  sessionId: string;
  sourceId: string;
  sourceText: string;
  sourceFingerprint: string;
  requestGeneration: number;
  view: MaterialSummaryScope["view"];
  planId: string | null;
  stepId: string | null;
};
function hasHttpStatus(error: unknown, expected: number): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    Number(error.status) === expected;
}
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
  const { user, login, logout, offline: authOffline, needsLogin } = useAuthStore();
  const owner = user?.id ?? "guest";
  const [saved, setSaved] = useState<Saved>(emptySaved);
  const [loaded, setLoaded] = useState(false);
  const firstUseNeedsWorkspace = loaded && !saved.active &&
    saved.studyPlanStorage?.onboarding.phase !== "complete";
  const view = canonicalStudyView(requestedView, {
    active: Boolean(saved.active),
    firstUseNeedsWorkspace,
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const current = useRef(saved),
    ownerRef = useRef(owner);
  const serverClockOffsetMs = useRef<number | null>(null);
  const workspaceLive = useRef(false);
  const exclusiveLease = useRef(false);
  const materialSummaryWorkspaceGeneration = useRef(0);
  const [materialSummaryWorkspaceVersion, setMaterialSummaryWorkspaceVersion] = useState(0);
  const materialSummaryRequestGeneration = useRef(0);
  const materialSummaryRequest = useRef<ActiveMaterialSummaryRequest | null>(null);
  const [materialSummaryUi, setMaterialSummaryUi] = useState<MaterialSummaryUiState | null>(null);
  const [materialSummaryFingerprints, setMaterialSummaryFingerprints] = useState<Record<string, { text: string; fingerprint: string }>>({});
  const materialSummaryFingerprintsRef = useRef(materialSummaryFingerprints);
  materialSummaryFingerprintsRef.current = materialSummaryFingerprints;
  const cancelMaterialSummaryRequest = useCallback((sessionId?: string, sourceId?: string, clearUi = true) => {
    const active = materialSummaryRequest.current;
    if (!active || (sessionId !== undefined && active.sessionId !== sessionId) ||
        (sourceId !== undefined && active.sourceId !== sourceId)) return;
    active.controller.abort();
    materialSummaryRequest.current = null;
    materialSummaryRequestGeneration.current++;
    if (clearUi)
      setMaterialSummaryUi((state) => state?.requestGeneration === active.requestGeneration ? null : state);
  }, []);
  const [guestPublication, setGuestPublication] = useState<Record<string, GuestPublicationStatus>>({});
  const [guestNoticeStatus, setGuestNoticeStatus] = useState<GuestPublicationStatus | null>(null);
  const hasActiveTrip = Boolean(saved.active);
  const synchronizedTripInLobby = isSynchronizedTrip(saved.snapshot?.group?.trip) &&
    saved.snapshot.group.trip.status === "departed";
  const studyFullscreen = useStudyFullscreen(view === "focus" && hasActiveTrip);
  const [exclusive, setExclusive] = useState(false);
  useEffect(() => {
    if (loaded && requestedView !== view) replaceBrowserView(view);
  }, [loaded, requestedView, view]);
  const [storageError, setStorageError] = useState(false);
  const [clockSkewUnsupported, setClockSkewUnsupported] = useState(false);
  const [serverClockReady, setServerClockReady] = useState(false);
  useEffect(() => {
    serverClockOffsetMs.current = null;
    setClockSkewUnsupported(false);
    setServerClockReady(false);
  }, [owner]);
  const [now, setNow] = useState(() => Date.now()),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true);
  const adminAccess = useAdminAccess(owner, !!user && !needsLogin && online && !authOffline);
  const adminNoticeHeading = useRef<HTMLHeadingElement>(null);
  const fullscreenContinueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (view === "admin" && !adminAccess.allowed && !adminAccess.checking)
      adminNoticeHeading.current?.focus({ preventScroll: true });
  }, [view, adminAccess.allowed, adminAccess.checking]);
  useEffect(() => {
    cancelMaterialSummaryRequest();
    return () => cancelMaterialSummaryRequest(undefined, undefined, false);
  }, [owner, needsLogin, cancelMaterialSummaryRequest]);
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
  const [skipQuizReview, setSkipQuizReview] = useState(false);
  const [quizPrefetch] = useState(() => new QuizPrefetchCoordinator<QuizPrefetchResult>());
  const [quizPrefetchUi, setQuizPrefetchUi] = useState<QuizPrefetchUiState | null>(null);
  const quizRequestGeneration = useRef(0);
  const guestQuizRequest = useRef<AbortController | null>(null);
  const quizPrefetchSaved = useRef(new Set<string>());
  const quizPrefetchLifecycle = useRef({ generation: 0 });
  useEffect(() => {
    const lifecycle = quizPrefetchLifecycle.current;
    const lease = ++lifecycle.generation;
    return () => queueMicrotask(() => {
      if (lifecycle.generation === lease) quizPrefetch.cancel();
    });
  }, [quizPrefetch]);
  const [draftTripId, setDraftTripIdState] = useState<string>(() => crypto.randomUUID());
  const draftTripIdRef = useRef(draftTripId);
  const draftSessionIdsRef = useRef<TripDraftSessionIds>({ solo: draftTripId, groups: new Map() });
  function setDraftTripId(id: string) {
    draftTripIdRef.current = id;
    setDraftTripIdState(id);
  }
  const [ticketCode, setTicketCode] = useState<{ id: string; value: string } | null>(null);
  const ticketId = saved.active?.id ?? draftTripId;
  const needsTicketCode = view === "focus";
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
  const [revisionPreviewId, setRevisionPreviewId] = useState<string | null>(null);
  const revisionPreviewReturnFocus = useRef<HTMLButtonElement | null>(null);
  const [studyGuideReview, dispatchStudyGuideReview] = useReducer(reduceStudyGuideReview, createStudyGuideReviewState());
  const studyGuideNeedsConfirmation = hasPendingGuideReview(studyGuideReview);
  const [studyInput, setStudyInput] = useState<"notes" | "files" | "ai">("notes");
  const [studyPlanStatus, setStudyPlanStatus] = useState<"idle" | "pending" | "ready" | "error" | "cancelled">("idle");
  const [studyPlanError, setStudyPlanError] = useState("");
  const [includeStudyPlanSource, setIncludeStudyPlanSource] = useState(false);
  const studyPlanRequest = useRef<AbortController | null>(null);
  const studyPlanRequestGeneration = useRef(0);
  const studyPlanResetSuppression = useRef(false);
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
  const authGeneration = getAuthGeneration();
  const studyPlanContext = useRef({
    owner,
    authGeneration,
    draftTripId,
    goal,
    topic,
    minutes,
    level: saved.studyPlanStorage?.draft.level ?? "",
    documentText,
    sources,
    materials,
    selectedPlanId: saved.studyPlanStorage?.draft.selectedPlanId ?? null,
    selectedStepId: saved.studyPlanStorage?.draft.selectedStepId ?? null,
    view,
    activeSessionId: saved.active?.id ?? null,
    exclusive: exclusive && exclusiveLease.current,
  });
  studyPlanContext.current = {
    owner,
    authGeneration,
    draftTripId,
    goal,
    topic,
    minutes,
    level: saved.studyPlanStorage?.draft.level ?? "",
    documentText,
    sources,
    materials,
    selectedPlanId: saved.studyPlanStorage?.draft.selectedPlanId ?? null,
    selectedStepId: saved.studyPlanStorage?.draft.selectedStepId ?? null,
    view,
    activeSessionId: saved.active?.id ?? null,
    exclusive: exclusive && exclusiveLease.current,
  };
  useEffect(() => {
    if (studyPlanResetSuppression.current) {
      studyPlanResetSuppression.current = false;
      return () => studyPlanRequest.current?.abort();
    }
    studyPlanRequest.current?.abort();
    studyPlanRequest.current = null;
    studyPlanRequestGeneration.current++;
    setStudyPlanStatus("idle");
    setStudyPlanError("");
    setIncludeStudyPlanSource(false);
    return () => studyPlanRequest.current?.abort();
  }, [owner, draftTripId, goal, topic, minutes, documentText, sources, materials,
    saved.studyPlanStorage?.draft.level, saved.studyPlanStorage?.draft.selectedPlanId,
    saved.studyPlanStorage?.draft.selectedStepId, view, saved.active?.id, exclusive, authGeneration]);
  const plannedBreaks = {count:breakCount,seconds:breakMinutes * 60};
  const validBreaks = breakCount === 0 || isValidBreakPlan(plannedBreaks, minutes * 60);
  const [carriageName, setCarriageName] = useState("");
  const [confirm, setConfirm] = useState<"finish" | "leave" | "reset" | null>(null),
    [summary, setSummary] = useState<Session | null>(null);
  const tripStartInFlight = useRef(false);
  const autoResumeAttempt = useRef<string | null>(null);
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
    if (value.snapshot) value = reconcileOwnerSnapshot(value, value.snapshot);
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
  function commitRemoteSnapshot(
    result: Snapshot,
    changes: Partial<Saved> = {},
    sampleServerClock = false,
  ): boolean {
    let active = current.current.active;
    if (sampleServerClock && ownerRef.current !== "guest" && Number.isSafeInteger(result.serverNow) &&
        result.revision >= (current.current.snapshot?.revision ?? -1)) {
      const offset = estimateServerClockOffset(result.serverNow, Date.now());
      serverClockOffsetMs.current = offset;
      setClockSkewUnsupported(offset === null);
      setServerClockReady(offset !== null);
      if (active?.syncClock)
        active = { ...active, ...(offset === null ? { clockOffsetMs: undefined } : { clockOffsetMs: offset }) };
    }
    return commit({ ...current.current, ...changes, snapshot: result, active });
  }
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    ownerRef.current = owner;
    materialSummaryWorkspaceGeneration.current++;
    setMaterialSummaryWorkspaceVersion(materialSummaryWorkspaceGeneration.current);
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
          exclusiveLease.current = false;
          setError(
            "Hành trình đang mở ở cửa sổ khác. Đóng cửa sổ đó rồi tải lại để tiếp tục.",
          );
          return;
        }
        try {
          const value = readSaved(owner);
          const pathRun = value.learningPath?.activeRun;
          if ((!value.active || value.active.groupId === null) && (!pathRun || pathRun.phase === "review")) {
            const storage = value.studyPlanStorage ?? createStudyPlanStorage();
            const draft = storage.draft;
            const quickDraft = {
              goal: draft.goal,
              topic: draft.topicId,
              topicLabel: draft.topicLabel,
              minutes: draft.preferredMinutes,
              breakCount: draft.breakCount,
              breakMinutes: draft.breakMinutes,
              level: draft.level,
              confidence: draft.confidence,
              selectedPlanId: draft.selectedPlanId,
              selectedStepId: draft.selectedStepId,
            };
            const workspaceIdentity = selectedStudyWorkspaceIdentity(storage);
            const workspaceDraft = findStudyWorkspaceDraft(storage, workspaceIdentity);
            updateQuickTripDraft(quickTripDraft, quickDraft);
            setGoal(draft.goal);
            setTopic(draft.topicId);
            setMinutes(draft.preferredMinutes);
            setBreakCount(draft.breakCount);
            setBreakMinutes(draft.breakMinutes);
            setDraftTripId(workspaceIdentity.sessionId);
            draftSessionIdsRef.current.solo = workspaceIdentity.sessionId;
            setDocumentText(workspaceDraft?.notes ?? "");
            setSources(structuredClone(workspaceDraft?.sources ?? []));
            setMaterials(structuredClone(workspaceDraft?.materials ?? []));
            originalFiles.current.clear();
          }
          if (pathRun && (pathRun.phase === "lesson" || pathRun.phase === "ticket") && !value.active) {
            const runCourse = CURATED_COURSES.find((course) => course.id === pathRun.courseId);
            const runLesson = runCourse?.lessons.find((lesson) => lesson.id === pathRun.lessonId && lesson.version === pathRun.lessonVersion);
            if (runCourse && runLesson) {
              setDraftTripId(pathRun.sessionId);
              draftSessionIdsRef.current.solo = pathRun.sessionId;
              setMode("solo");
              setStudyInput("notes");
              const draft = {
                goal: `Học bài: ${runLesson.title}`,
                topic: runCourse.subjectId,
                minutes: Math.max(1, Math.floor((pathRun.target ?? runLesson.minutes * 60) / 60)),
                breakCount: pathRun.breakPlan?.count ?? 0,
                breakMinutes: pathRun.breakPlan ? pathRun.breakPlan.seconds / 60 : 5,
                selectedPlanId: null,
                selectedStepId: null,
              };
              const topicLabel = studyTopics.find((item) => item.id === runCourse.subjectId)?.name ?? runCourse.subjectId;
              const recoveredText = value.notes[pathRun.sessionId] ?? runLesson.content;
              const recoveredMaterials = value.materials?.[pathRun.sessionId] ?? [];
              const recoveredSources = value.sources?.[pathRun.sessionId] ?? [createMaterialSource(runLesson.id, {
                name: `${runCourse.title} · ${runLesson.title}`,
                text: runLesson.content,
                source: "curated",
              })];
              const studyStorage = value.studyPlanStorage ?? createStudyPlanStorage({ legacyActivity: true });
              const recoveredStorage = {
                ...studyStorage,
                draft: {
                  ...updateStudyPlanDraftFromQuickTrip(studyStorage.draft, draft, topicLabel),
                  candidateSessionId: pathRun.sessionId,
                  quizPrefetch: { ...studyStorage.draft.quizPrefetch, sourceConsent: false },
                },
              };
              value.studyPlanStorage = saveStudyWorkspaceDraft(recoveredStorage, {
                sessionId: pathRun.sessionId,
                planId: null,
                stepId: null,
                notes: recoveredText,
                sources: recoveredSources,
                materials: recoveredMaterials,
                updatedAt: Date.now(),
              });
              updateQuickTripDraft(quickTripDraft, { ...draft, topicLabel });
              setGoal(draft.goal);
              setTopic(draft.topic);
              setMinutes(draft.minutes);
              setBreakCount(draft.breakCount);
              setBreakMinutes(draft.breakMinutes);
              value.notes = { ...value.notes, [pathRun.sessionId]: recoveredText };
              value.materials = { ...value.materials, [pathRun.sessionId]: recoveredMaterials };
              value.sources = { ...value.sources, [pathRun.sessionId]: recoveredSources };
              setDocumentText(recoveredText);
              setMaterials(recoveredMaterials);
              setSources(recoveredSources);
            }
            if (value.learningPath)
              value.learningPath = retireInactiveLegacyLessonRun(value.learningPath, pathRun.sessionId);
          }
          if (value.active) {
            if (value.active.syncClock && value.active.clockOffsetMs !== undefined)
              serverClockOffsetMs.current = value.active.clockOffsetMs;
            value.active = restore(value.active, tripClockNow(value.active, Date.now()));
          }
          if (owner === "guest")
            value.snapshot = snapshot(value.local, owner, Date.now());
          if (commitRef.current(value)) {
            workspaceLive.current = true;
            exclusiveLease.current = true;
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
      exclusiveLease.current = false;
      cancelMaterialSummaryRequest(undefined, undefined, false);
      release?.();
    };
  }, [owner, cancelMaterialSummaryRequest]);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refreshClock = () => {
      const at = Date.now();
      const currentDay = localDayKey(at);
      if (
        shouldRefreshWorkspaceClock(
          hasActiveTrip || synchronizedTripInLobby,
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
    if (hasActiveTrip || synchronizedTripInLobby) {
      interval = setInterval(() => {
        const at = refreshClock();
        const trip = current.current.active;
        if (trip && elapsedSeconds(trip, tripClockNow(trip, at)) >= trip.target)
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
  }, [hasActiveTrip, synchronizedTripInLobby]);
  useEffect(() => {
    if (!loaded || !exclusive) return;
    const checkpoint = () => {
      const s = current.current;
      if (s.active) {
        const at = tripClockNow(s.active, Date.now());
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
          active: depart(current.current.active, tripClockNow(current.current.active, Date.now())),
        });
    };
    const returned = () => {
      const s = current.current;
      if (s.active && view === "focus" && !document.hidden && document.hasFocus())
        commitRef.current({ ...s, active: returnFromBackground(s.active, tripClockNow(s.active, Date.now())) });
    };
    const visibility = () => document.hidden ? away() : returned();
    const interval = setInterval(checkpoint, 5000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", away);
    window.addEventListener("blur", away);
    window.addEventListener("focus", returned);
    if (view !== "focus" && current.current.active)
      commitRef.current({ ...current.current, active: leaveFocusView(current.current.active, tripClockNow(current.current.active, Date.now())) });
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
      const isCurrent = () => isCurrentOwnerWorkspace(
        id,
        ownerRef.current,
        workspaceLive.current,
        useAuthStore.getState().user?.id,
      );
      if (id === "guest") {
        while (isCurrent()) {
          const unpublished = Object.values(current.current.local.sessions).filter(session =>
            session.userId === "guest" && !current.current.guestPublished?.includes(session.id) &&
            !current.current.removedSessionIds?.includes(session.id));
          if (!unpublished.length) return;
          await publishGuestSessions({
            sessions: unpublished,
            publishedIds: current.current.guestPublished ?? [],
            removedIds: current.current.removedSessionIds ?? [],
            isCurrent,
            continueAfterFailure: permanentGuestFailure,
            send: session => post<{ tripCode: string }>("/adventure/guest-sessions", session, false),
            markPublished: sessionId => commit({ ...current.current,
              guestPublished: [...new Set([...(current.current.guestPublished ?? []), sessionId])] }),
            markRemoved: sessionId => isCurrent() && commit(suppressRemovedSessions(current.current, [sessionId])),
            onStatus: status => {
              setGuestPublication(value => ({ ...value, [status.sessionId]: status }));
              if (status.status === "removed" || status.status === "suppression-failed")
                setGuestNoticeStatus(status);
            },
          });
          // Stop on a failed request/save; retain unacknowledged trips for the next retry.
          if (unpublished.some(session => !current.current.guestPublished?.includes(session.id) &&
              !current.current.removedSessionIds?.includes(session.id))) return;
        }
        return;
      }
      await syncOwnerHistory({
        isCurrent,
        pending: () => current.current.pending,
        send: session => post<Snapshot>("/adventure/sessions", session),
        commitPending: (session, result) => commitRemoteSnapshot(result, {
          pending: current.current.pending.filter((pendingSession) => pendingSession.id !== session.id),
        }),
        handleSendError: (session, cause) => {
          if (!hasHttpStatus(cause, 410)) return;
          if (!commit(suppressRemovedSessions(current.current, [session.id]))) return "stop";
          setNotice("Phiên đã được máy chủ gỡ khỏi lịch sử và sẽ không được gửi lại.");
          return "continue";
        },
        fetchSnapshot: () => request<Snapshot>("/adventure"),
        commitSnapshot: result => commitRemoteSnapshot(result, {}, true),
      });
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
    const syncOwner = ownerRef.current;
    const isCurrent = () => isCurrentOwnerWorkspace(
      syncOwner,
      ownerRef.current,
      workspaceLive.current,
      useAuthStore.getState().user?.id,
    );
    void sync()
      .then(async () => {
        if (disposed || !isCurrent()) return;
        const result = await request<{ topics: { id: string; name: string }[] }>("/topics");
        if (!disposed && isCurrent()) setTopics(result.topics);
      })
      .catch((e) => {
        if (!disposed && isCurrent())
          setError(e instanceof Error ? e.message : "Chưa đồng bộ được.");
      });
    return () => {
      disposed = true;
    };
    // Sync on sign-in and reconnection; explicit refresh is also available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, exclusive, owner, online, needsLogin]);
  const data = saved.snapshot;
  const synchronizedTripId = isSynchronizedTrip(data?.group?.trip) &&
    (data.group.trip.status === "waiting" || data.group.trip.status === "departed")
    ? data.group.id
    : null;
  useEffect(() => {
    if (!synchronizedTripId || owner === "guest" || !loaded || !exclusive || !online || needsLogin) return;
    let disposed = false;
    const refresh = () => void sync().catch((cause) => {
      if (!disposed && workspaceLive.current)
        setError(cause instanceof Error ? cause.message : "Chưa cập nhật được trạng thái chuyến.");
    });
    const interval = setInterval(refresh, 5000);
    return () => { disposed = true; clearInterval(interval); };
    // `sync` is task-local and reads the latest owner/session state from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synchronizedTripId, owner, loaded, exclusive, online, needsLogin]);
  const removedSessionIds = useMemo(() =>
    [...new Set([...(saved.removedSessionIds ?? []), ...(data?.removedSessionIds ?? [])])],
  [saved.removedSessionIds, data?.removedSessionIds]);
  const accountStats = useMemo(() => profileStats(owner,
    owner === "guest" ? Object.values(saved.local.sessions) : data?.sessions ?? [], saved.pending, removedSessionIds),
  [owner, saved.local.sessions, data?.sessions, saved.pending, removedSessionIds]);
  const carriage = data?.person;
  const group = data?.group;
  const synchronizedClockSupported = serverClockReady && !clockSkewUnsupported && serverClockOffsetMs.current !== null;
  const synchronizedControls = synchronizedTripControls(group ?? null, user?.id, synchronizedClockSupported);
  const ownGroupTripStatus = group?.members.find((member) => member.id === user?.id)?.tripStatus;
  const ownsWaitingLegacyTrip = Boolean(user && group?.owner === user.id && group.trip?.status === "waiting");
  const selectedGroupTrip = mode === "group" ? group?.trip : undefined;
  const { privateInputsLocked: privateTripDraftLocked, sharedPlanLocked: tripPlanFieldsLocked } =
    tripDraftLocks(selectedGroupTrip, synchronizedControls.privateDraftLocked);
  const legacyGroupCleanupAvailable = canOfferLegacyGroupCleanup({
    authenticatedMember: owner !== "guest" && Boolean(user) && !needsLogin && !authOffline && online,
    isMember: Boolean(user && group?.members.some((member) => member.id === user.id)),
    tripStatus: group?.trip?.status,
    ownStatus: ownGroupTripStatus,
    hasActiveSession: Boolean(group && saved.active?.groupId === group.id),
    hasPendingSession: Boolean(group && saved.pending.some((session) => session.groupId === group.id)),
  });
  const removedIds = new Set(removedSessionIds);
  const pendingSoloSeconds = saved.pending.filter(session => !session.groupId &&
    session.userId === owner && !removedIds.has(session.id) &&
    !data?.sessions.some(stored => stored.id === session.id))
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
  const studyPlanStorage = saved.studyPlanStorage ?? createStudyPlanStorage();
  const onboardingComplete = studyPlanStorage.onboarding.phase === "complete";
  const tutorialActive = loaded && !saved.active && !onboardingComplete;
  const quizPrefetchSettings = studyPlanStorage.draft.quizPrefetch;
  const selectedStudyPlan = studyPlanStorage.plans.find((plan) => plan.id === studyPlanStorage.draft.selectedPlanId);
  const sourceForStudyPlan = useMemo(() => {
    try {
      const text = quizSourceText(documentText, sources, materials);
      return text ? { text, reviewed: sources.every((source) => source.reviewed) } : null;
    } catch {
      return null;
    }
  }, [documentText, sources, materials]);
  const hasStudyPlanSource = Boolean(documentText.trim() || sources.length || materials.length);
  const studyPlanAccessReason = !onboardingComplete
    ? "Hoàn tất hướng dẫn thao tác trước khi gửi yêu cầu AI. Bạn có thể tiếp tục chỉnh nội dung trên thiết bị."
    : !isValidStudyMinutes(minutes)
      ? "Thời lượng cần là số nguyên từ 1 đến 240 phút trước khi lập kế hoạch."
    : !online || authOffline
    ? "Kết nối mạng để yêu cầu AI chia mục tiêu. Bạn vẫn có thể học trực tiếp từ nội dung của mình."
    : owner !== "guest" && (!user || needsLogin)
      ? "Phiên đăng nhập đã hết hạn. Đăng nhập lại để yêu cầu AI chia mục tiêu."
      : !exclusive
        ? "Đang chờ quyền mở dữ liệu riêng trên thiết bị này."
        : saved.active
          ? "Hãy kết thúc phiên đang chạy trước khi tạo kế hoạch mới."
          : mode === "group"
            ? "Kế hoạch AI dùng trong buổi học cá nhân."
            : "";
  const ticketTopicName = availableTopics.find((item) => item.id === topic)?.name ??
    (selectedGroupTrip && "topic" in selectedGroupTrip ? selectedGroupTrip.topic : undefined) ?? "Tự học";
  const activeNow = saved.active ? tripClockNow(saved.active, now) : now;
  const active = saved.active
    ? tick(saved.active, Math.max(activeNow, saved.active.lastAt))
    : null;
  const deviceClockBehind = active
    ? isDeviceClockBehind(active.lastAt, () => tripClockNow(active, Date.now()))
    : false;
  // Group contributions need server confirmation of membership and the daily cap.
  const displayAt = active ? Math.max(activeNow, active.lastAt) : now;
  const rest = active ? breakStatus(active, displayAt) : null;
  const studyStage = active ? studyStageStatus(active, displayAt) : null;
  const mapActive = active && !(mode === "group" && group) && active.groupId === null ? active : null;
  const mapProgress = explorationProgress(journey, mapActive ? focused(mapActive) : 0, mapActive?.target);
  // Timer ticks replace `saved`; history changes only when one of these persisted row arrays changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sessions = useMemo(() => historySessions(saved, owner), [owner, saved.snapshot?.sessions,
    saved.snapshot?.removedSessionIds, saved.pending, saved.removedSessionIds]);
  const learningPathProgress = useMemo(() => saved.learningPath ?? createLearningPathProgress(), [saved.learningPath]);
  const studyJournalEntries = useMemo(() => buildStudyJournalEntries(
    buildStudyJournalSources({
      ownerId: owner,
      sessions,
      learningPath: learningPathProgress,
      quizDrafts: saved.quizDrafts,
      topicLabel: (topicId) => availableTopics.find((item) => item.id === topicId)?.name ?? topicId,
    }),
  ), [owner, sessions, learningPathProgress, saved.quizDrafts, availableTopics]);
  const revisionMaterialRecords = useMemo(() => collectRevisionMaterialRecords({
    current: {
      sessionId: draftTripId,
      planId: studyPlanStorage.draft.selectedPlanId,
      stepId: studyPlanStorage.draft.selectedStepId,
      notes: documentText,
      sources,
      materials,
    },
    drafts: (saved.studyPlanStorage?.workspaceDrafts ?? []).map((draft) => ({
      sessionId: draft.sessionId,
      planId: draft.planId,
      stepId: draft.stepId,
      notes: draft.notes,
      sources: draft.sources,
      materials: draft.materials,
    })),
    history: sessions.filter((session) => session.userId === owner).map((session) => ({
      sessionId: session.id,
      planId: null,
      stepId: null,
      notes: saved.notes[session.id],
      sources: saved.sources?.[session.id] ?? [],
      materials: saved.materials?.[session.id] ?? [],
    })),
  }, removedSessionIds), [draftTripId, studyPlanStorage.draft.selectedPlanId,
    studyPlanStorage.draft.selectedStepId, documentText, sources, materials,
    saved.studyPlanStorage?.workspaceDrafts, sessions, owner, removedSessionIds,
    saved.notes, saved.sources, saved.materials]);
  const selectedRevisionMaterial = revisionPreviewId
    ? revisionMaterialRecords.find((record) => record.id === revisionPreviewId)
    : undefined;
  const revisionMaterialEntries = useMemo(() => buildRevisionMaterialEntries(revisionMaterialRecords), [revisionMaterialRecords]);
  const selectedRevisionMaterialEntry = revisionMaterialEntries.find((entry) => entry.id === revisionPreviewId);
  const selectedLearningCourse = CURATED_COURSES.find((course) => course.id === learningPathProgress.selectedCourseId) ?? CURATED_COURSES[0];
  const learningPathCourse = CURATED_COURSES.find((course) => course.id === learningPathProgress.activeRun?.courseId) ?? selectedLearningCourse;
  const learningPathStates = lessonStates(learningPathCourse, learningPathProgress);
  const nextLearningLesson = nextAvailableLesson(learningPathCourse, learningPathProgress);
  const learningDifficulty = difficultySuggestion(learningPathProgress, learningPathCourse.conceptId);
  const learningDuration = durationSuggestion(
    sessions,
    learningPathCourse.subjectId,
    nextLearningLesson?.minutes ?? learningPathCourse.lessons[0].minutes,
  );
  const selectedPathLesson = learningPathProgress.activeRun
    ? learningPathCourse.lessons.find((lesson) => lesson.id === learningPathProgress.activeRun?.lessonId &&
      lesson.version === learningPathProgress.activeRun.lessonVersion)
    : learningPathCourse.lessons.find((lesson) => lesson.id === learningPathProgress.selectedLessonId &&
      lesson.version === learningPathProgress.selectedLessonVersion);
  const selectedPathLessonState = selectedPathLesson
    ? learningPathStates.find((item) => item.lesson.id === selectedPathLesson.id)?.status ?? "locked"
    : "locked";
  const summarySessionId = summary?.id ?? (view === "summary" ? saved.summarySessionId : undefined);
  const summarySession = summarySessionId
    ? sessions.find((session) => session.id === summarySessionId && !removedIds.has(session.id)) ?? null
    : null;
  useEffect(() => () => guestQuizRequest.current?.abort(), [owner, view, summarySessionId]);
  const summaryCompleted = Boolean(summarySession && (summarySession.effectiveMetrics?.completed ??
    studyElapsedSeconds(
      summarySession.started, summarySession.target, summarySession.breakPlan, summarySession.ended,
    ) >= summarySession.target));
  const summaryCuratedEvaluation = summarySession
    ? learningPathProgress.completed.find((evaluation) => evaluation.sessionId === summarySession.id)
    : undefined;
  const summaryInterruptedLesson = summarySession && !summaryCompleted
    ? interruptedLessonForSession(learningPathProgress, summarySession.id)
    : undefined;
  const summaryLearningRun = summarySession && learningPathProgress.activeRun?.phase === "review" &&
    learningPathProgress.activeRun.sessionId === summarySession.id
    ? learningPathProgress.activeRun
    : undefined;
  const summaryLearningCourse = summaryLearningRun
    ? CURATED_COURSES.find((course) => course.id === summaryLearningRun.courseId)
    : summaryInterruptedLesson?.course;
  const summaryLearningLesson = summaryLearningCourse && summaryLearningRun
    ? summaryLearningCourse.lessons.find((lesson) => lesson.id === summaryLearningRun.lessonId &&
      lesson.version === summaryLearningRun.lessonVersion)
    : summaryInterruptedLesson?.lesson;
  const summaryMaterialSessionId = summarySession?.id;
  const summaryMaterialSources = useMemo(() => view === "summary" && summaryMaterialSessionId
    ? saved.sources?.[summaryMaterialSessionId] ?? []
    : [], [view, saved.sources, summaryMaterialSessionId]);
  const materialSummaryTargetView: MaterialSummaryScope["view"] | null = view === "summary"
    ? "summary"
    : isStudyWorkspaceView(view) ? view as "station" | "ticket" : null;
  const materialSummaryTargetSessionId = materialSummaryTargetView === "summary"
    ? summaryMaterialSessionId
    : materialSummaryTargetView ? draftTripId : undefined;
  const materialSummaryTargetSources = useMemo(() => materialSummaryTargetView === "summary"
    ? summaryMaterialSources
    : materialSummaryTargetView ? sources : [],
  [materialSummaryTargetView, summaryMaterialSources, sources]);
  const renderAuthGeneration = getAuthGeneration();
  const publicSummaryScope = useMemo<PublicMaterialSummaryScope>(() => ({
    ownerId: owner,
    sessionId: summaryMaterialSessionId ?? "",
    authGeneration: renderAuthGeneration,
    workspaceGeneration: materialSummaryWorkspaceVersion,
    view: "summary",
  }), [owner, summaryMaterialSessionId, renderAuthGeneration, materialSummaryWorkspaceVersion]);
  const publicSummaryCandidates = useMemo(() => {
    if (!summaryMaterialSessionId) return [];
    const candidates: PublicMaterialSummaryCandidate[] = summaryMaterialSources.map((source) => {
      const fingerprintState = materialSummaryFingerprints[JSON.stringify([summaryMaterialSessionId, source.id])];
      const currentSourceFingerprint = fingerprintState?.text === source.text ? fingerprintState.fingerprint : "";
      const cached = saved.materialSummaries?.[summaryMaterialSessionId]?.[source.id];
      return {
        sourceId: source.id,
        sourceName: source.name,
        summary: cached?.summary ?? "",
        reviewed: source.reviewed,
        sourceFingerprint: cached?.sourceFingerprint ?? "",
        currentSourceFingerprint,
      };
    });
    return eligiblePublicMaterialSummaryCandidates(candidates);
  }, [summaryMaterialSessionId, summaryMaterialSources, materialSummaryFingerprints, saved.materialSummaries]);
  const canManagePublicSummary = !!user && !needsLogin && owner !== "guest" && online && !authOffline &&
    loaded && exclusive && workspaceLive.current;
  const publicSummaryDisabledReason = !user || needsLogin || owner === "guest"
    ? "Đăng nhập để quản lý bản tóm tắt chia sẻ."
    : !online || authOffline
      ? "Kết nối mạng để quản lý bản tóm tắt chia sẻ."
      : !loaded || !exclusive || !workspaceLive.current
        ? "Mở hành trình trên thiết bị này để quản lý bản tóm tắt."
        : "";
  const isPublicSummaryScopeCurrent = useCallback((scope: PublicMaterialSummaryScope) => {
    const auth = useAuthStore.getState();
    const value = current.current;
    const removed = new Set([...(value.removedSessionIds ?? []), ...(value.snapshot?.removedSessionIds ?? [])]);
    const session = historySessions(value, scope.ownerId).find((item) => item.id === scope.sessionId);
    return scope.view === "summary" && scope.ownerId !== "guest" &&
      ownerRef.current === scope.ownerId && getAuthGeneration() === scope.authGeneration &&
      materialSummaryWorkspaceGeneration.current === scope.workspaceGeneration && workspaceLive.current &&
      viewRef.current === "summary" && value.summarySessionId === scope.sessionId &&
      auth.user?.id === scope.ownerId && !auth.needsLogin && !removed.has(scope.sessionId) &&
      session?.userId === scope.ownerId;
  }, []);
  const isPublicSummaryCandidateCurrent = useCallback((candidate: PublicMaterialSummaryCandidate) => {
    const value = current.current;
    const sessionId = value.summarySessionId;
    if (!sessionId || ownerRef.current === "guest") return false;
    const source = value.sources?.[sessionId]?.find((item) => item.id === candidate.sourceId);
    const fingerprint = materialSummaryFingerprintsRef.current[JSON.stringify([sessionId, candidate.sourceId])];
    const cached = value.materialSummaries?.[sessionId]?.[candidate.sourceId];
    return source?.reviewed === true && fingerprint?.text === source.text &&
      fingerprint.fingerprint === candidate.currentSourceFingerprint &&
      cached?.sourceFingerprint === fingerprint.fingerprint &&
      cached.sourceFingerprint === candidate.sourceFingerprint && cached.summary === candidate.summary;
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!materialSummaryTargetView || !materialSummaryTargetSessionId || materialSummaryTargetSources.length === 0) {
      setMaterialSummaryFingerprints({});
      return () => { cancelled = true; };
    }
    void Promise.all(materialSummaryTargetSources.filter((source) => source.reviewed).map(async (source) => [
      JSON.stringify([materialSummaryTargetSessionId, source.id]),
      { text: source.text, fingerprint: await fingerprintMaterialSourceText(source.text) },
    ] as const)).then((entries) => {
      if (!cancelled) setMaterialSummaryFingerprints(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setMaterialSummaryFingerprints({});
    });
    return () => { cancelled = true; };
  }, [owner, materialSummaryTargetView, materialSummaryTargetSessionId, materialSummaryTargetSources]);
  useEffect(() => {
    setMaterialSummaryUi(null);
    return () => cancelMaterialSummaryRequest(undefined, undefined, false);
  }, [view, summarySessionId, draftTripId, selectedStudyPlan?.id, studyPlanStorage.draft.selectedStepId,
    onboardingComplete, saved.active?.id, exclusive, owner, cancelMaterialSummaryRequest]);
  useEffect(() => {
    const active = materialSummaryRequest.current;
    if (!active) return;
    const source = active.view === "summary"
      ? summaryMaterialSources.find((item) => item.id === active.sourceId)
      : isStudyWorkspaceView(view) && draftTripId === active.sessionId
        ? sources.find((item) => item.id === active.sourceId)
        : undefined;
    if (active.ownerId !== owner || active.view !== view || active.sessionId !== materialSummaryTargetSessionId ||
        active.planId !== (active.view === "summary" ? null : studyPlanContext.current.selectedPlanId) ||
        active.stepId !== (active.view === "summary" ? null : studyPlanContext.current.selectedStepId) ||
        !source?.reviewed || source.text !== active.sourceText)
      cancelMaterialSummaryRequest(active.sessionId, active.sourceId);
  }, [owner, view, summarySessionId, materialSummaryTargetSessionId, summaryMaterialSources, sources, draftTripId, studyPlanStorage.draft.selectedStepId, cancelMaterialSummaryRequest]);
  const guestNotice = guestNoticeStatus ? guestPublicationNotice(guestNoticeStatus) : null;
  const isStudyExerciseOwnerWorkspaceCurrent = useCallback((ownerId: string, authGeneration: number, workspaceGeneration: number) => {
    const auth = useAuthStore.getState();
    return ownerRef.current === ownerId && getAuthGeneration() === authGeneration &&
      materialSummaryWorkspaceGeneration.current === workspaceGeneration && workspaceLive.current &&
      !auth.needsLogin && (ownerId === "guest" ? !auth.user : auth.user?.id === ownerId);
  }, []);
  const isStudyExerciseRouteScopeCurrent = useCallback((
    ownerId: string,
    sessionId: string,
    targetView: "ticket" | "focus" | "summary",
  ) => {
    const auth = useAuthStore.getState();
    const value = current.current;
    const removed = new Set([...(value.removedSessionIds ?? []), ...(value.snapshot?.removedSessionIds ?? [])]);
    const authMatchesOwner = ownerId === "guest" ? !auth.user : auth.user?.id === ownerId;
    if (ownerRef.current !== ownerId || !workspaceLive.current ||
        (targetView === "ticket" ? !isStudyWorkspaceView(viewRef.current) : viewRef.current !== targetView) ||
        !authMatchesOwner || auth.needsLogin || removed.has(sessionId)) return false;
    if (targetView === "ticket") return draftTripId === sessionId;
    if (targetView === "focus") return value.active?.id === sessionId && value.active.owner === ownerId;
    const session = historySessions(value, ownerId).find(item => item.id === sessionId);
    return value.summarySessionId === sessionId && session?.userId === ownerId;
  }, [draftTripId]);
  const isStudyExercisePersistedOwnerSession = useCallback((ownerId: string, sessionId: string) =>
    historySessions(current.current, ownerId).some(session => session.id === sessionId && session.userId === ownerId), []);
  const isStudyExercisePersistedCompleted = useCallback((ownerId: string, sessionId: string) =>
    historySessions(current.current, ownerId).some(session =>
      session.id === sessionId && session.userId === ownerId &&
        isPersistedStudyExerciseSessionCompleted(ownerId, session)), []);
  const studyExerciseFlow = useStudyExerciseFlow({
    ownerId: owner,
    authenticated: owner === "guest" || (!!user && !needsLogin),
    needsLogin,
    online,
    loaded,
    exclusive,
    view,
    plannedSessionId: draftTripId,
    guestExerciseSessions: saved.guestExerciseSessions ?? [],
    sources,
    activeSession: saved.active,
    summarySession,
    summarySources: studyExerciseSourcesForSession(saved.sources, summarySession?.id),
    getAuthGeneration,
    getWorkspaceGeneration: () => materialSummaryWorkspaceGeneration.current,
    isOwnerWorkspaceCurrent: isStudyExerciseOwnerWorkspaceCurrent,
    isRouteScopeCurrent: isStudyExerciseRouteScopeCurrent,
    isPersistedOwnerSession: isStudyExercisePersistedOwnerSession,
    isPersistedCompleted: isStudyExercisePersistedCompleted,
    sync,
  });
  const {
    preparation: studyExercisePreparation,
    setPreparation: setStudyExercisePreparation,
    pending: pendingStudyExercise,
    startPromptVisible: studyExerciseStartPrompt,
    setStartPromptVisible: setStudyExerciseStartPrompt,
    focusAvailabilityMessage: studyExerciseFocusAvailabilityMessage,
    summaryPreparation: summaryExercisePreparation,
    summarySolutionUi: summaryExerciseSolutionUi,
    summarySolutionStatus: summaryExerciseSolutionStatus,
    summaryAvailabilityMessage: summaryExerciseAvailability,
    onPrepare: onPrepareStudyExercises,
    onInvalidate: onInvalidateStudyExercises,
    noteSourceChange: noteStudyExerciseSourceChange,
    cancelPendingForStart: cancelPendingStudyExerciseForStart,
    invalidatePreparationForSession: invalidateStudyExercisePreparationForSession,
    onFocusStarted: onStudyExerciseFocusStarted,
    isReadyForSession: isStudyExercisePreparationReadyForSession,
    isPendingForSession: isStudyExerciseGenerationPendingForSession,
    loadSummarySolutions: loadSummaryStudyExerciseSolutions,
    cancelSolutionRequest: cancelStudyExerciseSolutionRequest,
  } = studyExerciseFlow;
  const summaryAnalysis = summarySession ? analyzeSession(summarySession) : null;
  const savedSummaryQuizDraft = summarySession ? saved.quizDrafts?.[summarySession.id] : undefined;
  const summaryCorrectionVersion = summarySession?.correctionVersion ?? 0;
  const summaryQuizDraft = useMemo(() => savedSummaryQuizDraft &&
    (savedSummaryQuizDraft.correctionVersion ?? 0) === summaryCorrectionVersion
      ? savedSummaryQuizDraft
      : savedSummaryQuizDraft
        ? quizPanelDraftState(savedSummaryQuizDraft, summaryCorrectionVersion).draft
        : undefined,
  [savedSummaryQuizDraft, summaryCorrectionVersion]);
  const summaryQuizCount = summaryQuizDraft?.requestedCount ?? summaryQuizDraft?.count ??
    savedSummaryQuizDraft?.requestedCount ?? savedSummaryQuizDraft?.count ?? 3;
  const summaryQuizPrefetch = quizPrefetchUi?.ownerId === owner &&
    quizPrefetchUi.sessionId === summarySession?.id &&
    quizPrefetchUi.correctionVersion === summaryCorrectionVersion && quizPrefetchUi.count === summaryQuizCount
    ? quizPrefetchUi
    : null;
  function getCurrentMaterialSummarySource(
    targetView: MaterialSummaryScope["view"],
    sessionId: string,
    sourceId: string,
  ): MaterialSource | undefined {
    if (targetView === "summary")
      return current.current.sources?.[sessionId]?.find((item) => item.id === sourceId);
    const context = studyPlanContext.current;
    if (context.view !== targetView || context.draftTripId !== sessionId) return undefined;
    return context.sources.find((item) => item.id === sourceId);
  }
  function canGeneratePrivateMaterialSummary(targetView: MaterialSummaryScope["view"], source: MaterialSource): boolean {
    return canRequestMaterialSummary({
      targetView,
      view,
      ownerReady: owner === "guest" ? !user && !needsLogin : !!user && user.id === owner && !needsLogin,
      online,
      authOffline,
      loaded,
      exclusive,
      workspaceLive: workspaceLive.current,
      onboardingComplete,
      activeSession: Boolean(saved.active),
      source,
    });
  }
  function privateMaterialSummaryUnavailableReason(targetView: MaterialSummaryScope["view"]): string {
    if (owner !== "guest" && (!user || needsLogin)) return "Đăng nhập lại để tạo tóm tắt tài liệu.";
    if (!online || authOffline) return "Kết nối mạng để tạo tóm tắt tài liệu.";
    if (!loaded || !exclusive || !workspaceLive.current) return "Mở dữ liệu riêng trên thiết bị này để tạo tóm tắt.";
    if (targetView !== "summary" && !onboardingComplete)
      return "Hoàn tất hướng dẫn trước khi dùng AI trong buổi học.";
    if (targetView !== "summary" && saved.active) return "Kết thúc phiên đang mở trước khi tạo tóm tắt.";
    return "";
  }
  async function generateMaterialSummary(
    sessionId: string,
    sourceId: string,
    targetView: MaterialSummaryScope["view"],
  ) {
    const ownerId = ownerRef.current;
    const guest = ownerId === "guest";
    const value = current.current;
    const removed = new Set([...(value.removedSessionIds ?? []), ...(value.snapshot?.removedSessionIds ?? [])]);
    const context = studyPlanContext.current;
    const session = targetView === "summary"
      ? historySessions(value, ownerId).find((item) => item.id === sessionId)
      : undefined;
    const source = targetView === "summary"
      ? value.sources?.[sessionId]?.find((item) => item.id === sourceId)
      : context.draftTripId === sessionId && context.view === targetView
        ? context.sources.find((item) => item.id === sourceId)
        : undefined;
    const planId = targetView === "summary" ? null : context.selectedPlanId;
    const stepId = targetView === "summary" ? null : context.selectedStepId;
    const hasEligibleAccess = (candidate: MaterialSource | undefined) => {
      const auth = useAuthStore.getState();
      return canRequestMaterialSummary({
        targetView,
        view: viewRef.current,
        ownerReady: guest ? !auth.user && !auth.needsLogin : auth.user?.id === ownerId && !auth.needsLogin,
        online: navigator.onLine,
        authOffline: auth.offline,
        loaded,
        exclusive: exclusiveLease.current,
        workspaceLive: workspaceLive.current,
        onboardingComplete: current.current.studyPlanStorage?.onboarding.phase === "complete",
        activeSession: Boolean(current.current.active),
        source: candidate ?? { reviewed: false, text: "" },
      });
    };
    if (!source || !hasEligibleAccess(source) ||
        (targetView === "summary" && (value.summarySessionId !== sessionId || removed.has(sessionId) ||
          !session || session.userId !== ownerId)) ||
        (targetView !== "summary" && (context.draftTripId !== sessionId ||
          context.selectedPlanId !== planId || context.selectedStepId !== stepId))) return;

    cancelMaterialSummaryRequest();
    const requestGeneration = ++materialSummaryRequestGeneration.current;
    const controller = new AbortController();
    const active: ActiveMaterialSummaryRequest = {
      controller,
      ownerId,
      workspaceGeneration: materialSummaryWorkspaceGeneration.current,
      authGeneration: getAuthGeneration(),
      sessionId,
      sourceId,
      sourceText: source.text,
      sourceFingerprint: "",
      requestGeneration,
      view: targetView,
      planId,
      stepId,
    };
    materialSummaryRequest.current = active;
    const currentScope = (): MaterialSummaryScope => ({
      ownerId: ownerRef.current,
      workspaceGeneration: materialSummaryWorkspaceGeneration.current,
      authGeneration: getAuthGeneration(),
      sessionId: targetView === "summary"
        ? current.current.summarySessionId ?? ""
        : studyPlanContext.current.draftTripId,
      sourceId: getCurrentMaterialSummarySource(targetView, sessionId, sourceId)?.id ?? "",
      sourceFingerprint: active.sourceFingerprint,
      requestGeneration: materialSummaryRequestGeneration.current,
      view: targetView,
      planId: targetView === "summary" ? null : studyPlanContext.current.selectedPlanId,
      stepId: targetView === "summary" ? null : studyPlanContext.current.selectedStepId,
    });
    const isCurrent = () => {
      const latest = current.current;
      const latestSession = targetView === "summary"
        ? historySessions(latest, ownerId).find((item) => item.id === sessionId)
        : undefined;
      const latestSource = getCurrentMaterialSummarySource(targetView, sessionId, sourceId);
      const latestContext = studyPlanContext.current;
      const latestRemoved = new Set([...(latest.removedSessionIds ?? []), ...(latest.snapshot?.removedSessionIds ?? [])]);
      const expected: MaterialSummaryScope = {
        ownerId: active.ownerId,
        workspaceGeneration: active.workspaceGeneration,
        authGeneration: active.authGeneration,
        sessionId: active.sessionId,
        sourceId: active.sourceId,
        sourceFingerprint: active.sourceFingerprint,
        requestGeneration: active.requestGeneration,
        view: active.view,
        planId: active.planId,
        stepId: active.stepId,
      };
      const currentScopeValue = currentScope();
      const sessionValid = targetView === "summary"
        ? latest.summarySessionId === sessionId && !latestRemoved.has(sessionId) && latestSession?.userId === ownerId
        : latestContext.draftTripId === sessionId && latestContext.view === targetView &&
          latestContext.selectedPlanId === active.planId && latestContext.selectedStepId === active.stepId &&
          latest.studyPlanStorage?.onboarding.phase === "complete" && !latest.active;
      return materialSummaryRequest.current === active && !controller.signal.aborted &&
        ownerRef.current === ownerId && workspaceLive.current &&
        getAuthGeneration() === active.authGeneration &&
        viewRef.current === targetView &&
        canApplyMaterialSummaryResponse({
          expected,
          current: currentScopeValue,
          ownerMatches: ownerRef.current === ownerId,
          workspaceLive: workspaceLive.current,
          sessionValid,
          source: latestSource,
          sourceText: active.sourceText,
          onboardingComplete: latest.studyPlanStorage?.onboarding.phase === "complete",
          activeSession: Boolean(latest.active),
        });
    };
    setMaterialSummaryUi({
      ownerId, workspaceGeneration: active.workspaceGeneration, authGeneration: active.authGeneration,
        sessionId, sourceId, sourceFingerprint: "", requestGeneration, status: "pending",
        view: targetView, planId, stepId,
    });
    try {
      active.sourceFingerprint = await fingerprintMaterialSourceText(source.text);
      if (!isCurrent()) return;
      const existing = cachedMaterialSummary(current.current, sessionId, source, active.sourceFingerprint);
      if (existing) {
        setMaterialSummaryUi({
          ownerId, workspaceGeneration: active.workspaceGeneration, authGeneration: active.authGeneration,
          sessionId, sourceId, sourceFingerprint: active.sourceFingerprint, requestGeneration,
          status: "ready", summary: existing, view: targetView, planId, stepId,
        });
        return;
      }
      const result = await summarizeReviewedMaterial(active.sourceText, controller.signal, guest);
      if (!isCurrent()) return;
      const latestSource = getCurrentMaterialSummarySource(targetView, sessionId, sourceId);
      if (!latestSource || await fingerprintMaterialSourceText(latestSource.text) !== active.sourceFingerprint || !isCurrent()) return;
      if (typeof result.summary !== "string" || result.summary.trim().length === 0 || result.summary.length > 4_000)
        throw new Error("Gemini chưa trả về được bản tóm tắt. Hãy thử lại.");
      const summary = result.summary;
      const next = cacheMaterialSummary(current.current, sessionId, sourceId, {
        sourceFingerprint: active.sourceFingerprint,
        summary,
        generatedAt: Date.now(),
      });
      commitRef.current(next);
      if (!isCurrent()) return;
      setMaterialSummaryUi({
        ownerId, workspaceGeneration: active.workspaceGeneration, authGeneration: active.authGeneration,
        sessionId, sourceId, sourceFingerprint: active.sourceFingerprint, requestGeneration,
        status: "ready", summary, view: targetView, planId, stepId,
      });
    } catch (cause) {
      if (isCurrent()) setMaterialSummaryUi({
        ownerId, workspaceGeneration: active.workspaceGeneration, authGeneration: active.authGeneration,
        sessionId, sourceId, sourceFingerprint: active.sourceFingerprint, requestGeneration,
        status: "failed", error: cause instanceof Error ? cause.message : "Chưa tạo được tóm tắt tài liệu.",
        view: targetView, planId, stepId,
      });
    } finally {
      if (materialSummaryRequest.current === active) materialSummaryRequest.current = null;
    }
  }
  const resolveCurrentQuizSession = useCallback((sessionId: string): QuizSessionSource => {
    const value = current.current;
    const trip = value.active?.id === sessionId ? value.active : null;
    if (trip) {
      if (trip.owner !== ownerRef.current)
        throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần ôn tập.");
      return trip;
    }
    if (value.summarySessionId !== sessionId)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần ôn tập.");
    const removed = new Set([...(value.removedSessionIds ?? []), ...(value.snapshot?.removedSessionIds ?? [])]);
    if (removed.has(sessionId))
      throw new Error("Chuyến này đã được gỡ khỏi lịch sử và không thể tạo câu hỏi.");
    const canonical = value.snapshot?.sessions.find((item) => item.id === sessionId);
    if (!canonical || canonical.userId !== ownerRef.current)
      throw new Error("Chuyến chưa được máy chủ xác nhận. Hãy đồng bộ rồi thử lại.");
    return canonical;
  }, []);
  const readQuizGenerationSource = useCallback((session: QuizSessionSource) => {
    const value = current.current;
    const trip = value.active?.id === session.id ? value.active : null;
    const canonical = resolveCurrentQuizSession(session.id);
    return {
      topic: trip?.topic ?? canonical.topic,
      goal: trip?.goal ?? canonical.goal,
      notes: trip?.document ?? value.notes[session.id] ?? "",
      sources: trip?.sources ?? value.sources?.[session.id] ?? [],
      materials: trip?.materials ?? value.materials?.[session.id] ?? [],
    };
  }, [resolveCurrentQuizSession]);
  const buildQuizScope = useCallback((session: QuizSessionSource, count: number) => {
    if (!isQuizCount(count)) throw new Error("Số câu hỏi cần là số nguyên từ 1 đến 30.");
    const canonical = resolveCurrentQuizSession(session.id);
    const payload = buildQuizGenerationPayload(readQuizGenerationSource(canonical), count);
    const scope: QuizPrefetchScope = {
      ownerId: ownerRef.current,
      sessionId: session.id,
      correctionVersion: canonical.correctionVersion ?? 0,
      sourceKey: quizGenerationSourceKey(payload),
      count,
    };
    return { scope, payload };
  }, [readQuizGenerationSource, resolveCurrentQuizSession]);
  const requestQuizQuestions = useCallback(async (
    session: QuizSessionSource,
    count: number,
    requestedScope: QuizPrefetchScope,
    signal: AbortSignal,
  ): Promise<QuizPrefetchResult> => {
    if (ownerRef.current !== requestedScope.ownerId || !workspaceLive.current || signal.aborted)
      throw new DOMException("Chuyến học đã đổi.", "AbortError");
    const initialSession = resolveCurrentQuizSession(session.id);
    const initial = buildQuizScope(initialSession, count);
    if (quizPrefetchScopeKey(initial.scope) !== quizPrefetchScopeKey(requestedScope))
      throw new DOMException("Nguồn học đã đổi.", "AbortError");
    const result = requestedScope.ownerId === "guest"
      ? await postGuestAi<{ id: string; plannedSessionId: string; questions: GuestQuizQuestion[] }>("/quizzes/generate", {
          plannedSessionId: session.id,
          ...initial.payload,
        }, signal)
      : await request<QuizQuestion[]>("/quiz/generate", {
          method: "POST",
          body: JSON.stringify(initial.payload),
          signal,
        });
    if (ownerRef.current !== requestedScope.ownerId || !workspaceLive.current || signal.aborted)
      throw new DOMException("Chuyến học đã đổi.", "AbortError");
    const latestSession = resolveCurrentQuizSession(session.id);
    const latest = buildQuizScope(latestSession, count);
    if (quizPrefetchScopeKey(latest.scope) !== quizPrefetchScopeKey(requestedScope))
      throw new DOMException("Nguồn học đã đổi.", "AbortError");
    if (requestedScope.ownerId === "guest") {
      if (!isValidGuestQuizDeck(result) || result.plannedSessionId !== session.id || result.questions.length !== count)
        throw new Error("AI chưa trả về đúng số câu hỏi riêng tư. Hãy thử tạo lại.");
      return { questions: result.questions, guestQuizId: result.id };
    }
    if (!Array.isArray(result) || result.length !== count || !result.every((question) =>
      typeof question.correctAnswerIndex === "number" && typeof question.explanation === "string"))
      throw new Error("AI chưa trả về đúng số câu hỏi đã chọn. Hãy thử tạo lại.");
    return { questions: result };
  }, [buildQuizScope, resolveCurrentQuizSession]);
  const recordQuizPrefetchFailure = useCallback((scope: QuizPrefetchScope, error: unknown) => {
    if (!quizPrefetch.isCurrent(scope)) return;
    setQuizPrefetchUi({
      ownerId: scope.ownerId,
      sessionId: scope.sessionId,
      correctionVersion: scope.correctionVersion,
      count: scope.count,
      status: "failed",
      message: error instanceof Error ? error.message : "Chưa chuẩn bị được câu hỏi.",
    });
  }, [quizPrefetch]);
  const recordQuizPrefetchResult = useCallback((
    scope: QuizPrefetchScope,
    session: QuizSessionSource,
    result: QuizPrefetchResult,
  ) => {
    if (!quizPrefetch.isCurrent(scope) || ownerRef.current !== scope.ownerId || !workspaceLive.current)
      return;
    const value = current.current;
    let currentSession: QuizSessionSource;
    try {
      currentSession = resolveCurrentQuizSession(scope.sessionId);
    } catch {
      return;
    }
    if ((currentSession.correctionVersion ?? 0) !== scope.correctionVersion) return;
    const draftPreference = value.quizDrafts?.[scope.sessionId];
    if (!shouldPrefetchQuizReview(draftPreference)) {
      quizPrefetch.cancelSession(scope.ownerId, scope.sessionId);
      return;
    }
    if ((draftPreference?.requestedCount ?? draftPreference?.count ?? 3) !== scope.count) return;
    const latest = buildQuizScope(currentSession ?? session, scope.count);
    if (quizPrefetchScopeKey(latest.scope) !== quizPrefetchScopeKey(scope)) return;
    const draft = quizDraftFromQuestions(result.questions, scope.count, scope.correctionVersion, result.guestQuizId);
    const prefetchFields = value.quizDrafts?.[scope.sessionId];
    if (prefetchFields) Object.assign(draft, {
      ...(prefetchFields.reviewSkipped === undefined ? {} : { reviewSkipped: prefetchFields.reviewSkipped }),
      ...(prefetchFields.prefetchEnabled === undefined ? {} : {
        prefetchEnabled: prefetchFields.prefetchEnabled,
        prefetchSourcePresent: prefetchFields.prefetchSourcePresent,
        prefetchSourceConsent: prefetchFields.prefetchSourceConsent,
      }),
    });
    if (!isValidQuizDraft(draft) || result.questions.length !== scope.count) {
      recordQuizPrefetchFailure(scope, new Error("AI chưa tạo đủ số câu hỏi đã chọn. Bạn có thể thử lại."));
      return;
    }
    const savedKey = quizPrefetchScopeKey(scope);
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
      correctionVersion: scope.correctionVersion,
      count: scope.count,
      status: "ready",
    });
  }, [buildQuizScope, quizPrefetch, recordQuizPrefetchFailure, resolveCurrentQuizSession]);
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
          correctionVersion: 0,
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
    if (view !== "focus" || trip.owner !== owner ||
        (owner !== "guest" && (!user || needsLogin || authOffline)) ||
        !online || !loaded || !exclusive || !workspaceLive.current) {
      quizPrefetch.cancel();
      setQuizPrefetchUi((previous) => previous?.sessionId === trip.id ? null : previous);
      return;
    }
    const existingDraft = current.current.quizDrafts?.[trip.id];
    const guestNeedsExplicitOptIn = owner === "guest" && existingDraft?.prefetchEnabled !== true;
    if (guestNeedsExplicitOptIn || !shouldPrefetchQuizReview(existingDraft)) {
      quizPrefetch.cancelSession(ownerRef.current, trip.id);
      setQuizPrefetchUi((previous) => previous?.sessionId === trip.id ? null : previous);
      return;
    }
    if (existingDraft?.questions.length) return;

    const scope = activeQuizPrefetch.scope;
    if (!scope) {
      setQuizPrefetchUi({
        ownerId: owner,
        sessionId: trip.id,
        correctionVersion: 0,
        count: activeQuizCount,
        status: "failed",
        message: activeQuizPrefetch.error ?? "Chưa chuẩn bị được câu hỏi.",
      });
      return;
    }

    const start = (signal: AbortSignal) => requestQuizQuestions(trip, activeQuizCount, scope, signal);
    setQuizPrefetchUi({ ownerId: owner, sessionId: trip.id, correctionVersion: 0, count: activeQuizCount, status: "pending" });
    const pending = quizPrefetch.getOrStart(scope, start);
    const existingStatus = quizPrefetch.status(scope);
    if (existingStatus?.status === "ready")
      setQuizPrefetchUi({ ownerId: owner, sessionId: trip.id, correctionVersion: 0, count: activeQuizCount, status: "ready" });
    if (existingStatus?.status === "failed")
      setQuizPrefetchUi({
        ownerId: owner,
        sessionId: trip.id,
        correctionVersion: 0,
        count: activeQuizCount,
        status: "failed",
        message: existingStatus.error instanceof Error ? existingStatus.error.message : "Chưa chuẩn bị được câu hỏi.",
      });
    void pending.then((result) => {
      recordQuizPrefetchResult(scope, trip, result);
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        recordQuizPrefetchFailure(scope, cause);
    });

  }, [view, activeTripId, activeQuizPrefetchKey, activeQuizPrefetch, activeQuizCount, owner, user, needsLogin, authOffline, online, loaded, exclusive, quizPrefetch, requestQuizQuestions, recordQuizPrefetchFailure, recordQuizPrefetchResult]);
  const minutesTotal = Math.floor((carriage?.seconds ?? 0) / 60);
  const go = (next: string, options: { preserveTicketPlan?: boolean } = {}) => {
    if (next === "focus" && current.current.active) studyFullscreen.request();
    else if (next !== "focus") studyFullscreen.leave();
    if (next !== "focus" && current.current.active)
      commit({
        ...current.current,
        active: leaveFocusView(
          current.current.active,
          tripClockNow(current.current.active, Date.now()),
        ),
      });
    setError("");
    setNotice("");
    if (next === "ticket" && !studyGuideNeedsConfirmation && !options.preserveTicketPlan) {
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
  function selectSoloMode() {
    setMode("solo");
    setDraftTripId(draftSessionIdsRef.current.solo);
    const draft = quickTripDraft.current;
    setGoal(draft.goal);
    setTopic(draft.topic);
    setMinutes(draft.minutes);
    setBreakCount(draft.breakCount);
    setBreakMinutes(draft.breakMinutes);
  }
  function openLearningLesson(lesson: CuratedLesson) {
    const course = CURATED_COURSES.find((item) => item.lessons.some((candidate) => candidate.id === lesson.id && candidate.version === lesson.version));
    if (!course) return;
    const value = current.current;
    const progress = selectPathLesson(value.learningPath ?? createLearningPathProgress(), course, lesson);
    if (commit({ ...value, learningPath: progress })) go("lesson");
  }
  function updateLearningPathPlan(target: number, count = breakCount, breakDuration = breakMinutes) {
    const value = current.current;
    const progress = value.learningPath;
    const run = progress?.activeRun;
    if (!progress || !run || run.sessionId !== draftTripIdRef.current || run.phase !== "ticket") return;
    const breakPlan = count > 0 ? { count, seconds: breakDuration * 60 } : undefined;
    const updated = setLessonRunPlan(progress, run.sessionId, target, breakPlan);
    if (updated !== progress) commit({ ...value, learningPath: updated });
  }
  function startLearningLesson(lesson: CuratedLesson, minutesValue: number) {
    const value = current.current;
    if (studyGuideNeedsConfirmation) {
      setError("Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi bắt đầu chặng học.");
      return;
    }
    if (value.active) {
      go("focus");
      setNotice("Hãy tiếp tục hoặc kết thúc phiên đang chạy trước khi bắt đầu bài học.");
      return;
    }
    if (value.learningPath?.activeRun) {
      resumeLearningPathRun();
      return;
    }
    const course = CURATED_COURSES.find((item) => item.lessons.some((candidate) => candidate.id === lesson.id && candidate.version === lesson.version));
    if (!course || !Number.isSafeInteger(minutesValue) || minutesValue < 5 || minutesValue > 25) return;
    const sessionId = draftTripIdRef.current;
    const replay = (value.learningPath?.completed ?? []).some((entry) =>
      entry.lessonId === lesson.id && entry.lessonVersion === lesson.version,
    );
    const started = beginLessonRun(value.learningPath ?? createLearningPathProgress(course.id), course, lesson.id, sessionId, replay);
    if (!started) {
      setError("Bài học này chưa mở hoặc một chặng khác đang chờ tiếp tục.");
      return;
    }
    const pathProgress = setLessonRunPlan(
      setLessonRunPhase(started, sessionId, "ticket"),
      sessionId,
      minutesValue * 60,
    );
    if (!commit({ ...value, learningPath: pathProgress })) return;
    const draft = {
      goal: `Học bài: ${lesson.title}`,
      topic: course.subjectId,
      minutes: minutesValue,
      breakCount: 0,
      breakMinutes: 5,
    };
    updateQuickTripDraft(quickTripDraft, draft);
    setDraftTripId(sessionId);
    draftSessionIdsRef.current.solo = sessionId;
    setMode("solo");
    setGoal(draft.goal);
    setTopic(draft.topic);
    setMinutes(draft.minutes);
    setBreakCount(0);
    setBreakMinutes(5);
    setDocumentText(lesson.content);
    setMaterials([]);
    setSources([createMaterialSource(lesson.id, {
      name: `${course.title} · ${lesson.title}`,
      text: lesson.content,
      source: "curated",
    })]);
    setStudyInput("notes");
    setSummary(null);
    go("station");
  }
  function resumeLearningPathRun() {
    const value = current.current;
    const run = value.learningPath?.activeRun;
    if (!run) {
      if (value.active) go("focus");
      return;
    }
    if (run.phase === "focus" && value.active?.id === run.sessionId) {
      go("focus");
      return;
    }
    if (run.phase === "review") {
      const session = historySessions(value, ownerRef.current).find((item) => item.id === run.sessionId);
      if (!session) {
        setError("Không tìm thấy phiên đã lưu cho bài tự kiểm tra này. Hãy mở nhật ký học tập để xem dữ liệu trên thiết bị.");
        return;
      }
      commit({ ...value, summarySessionId: session.id });
      setSummary(session as Session);
      go("summary");
      return;
    }
    const course = CURATED_COURSES.find((item) => item.id === run.courseId);
    const lesson = course?.lessons.find((item) => item.id === run.lessonId && item.version === run.lessonVersion);
    if (!course || !lesson) {
      setError("Phiên bản bài học đã thay đổi. Tiến độ cũ vẫn được giữ trong nhật ký.");
      return;
    }
    const target = run.target ?? lesson.minutes * 60;
    const draft = {
      goal: `Học bài: ${lesson.title}`,
      topic: course.subjectId,
      minutes: target / 60,
      breakCount: run.breakPlan?.count ?? 0,
      breakMinutes: run.breakPlan ? run.breakPlan.seconds / 60 : 5,
    };
    updateQuickTripDraft(quickTripDraft, draft);
    setDraftTripId(run.sessionId);
    draftSessionIdsRef.current.solo = run.sessionId;
    setMode("solo");
    setGoal(draft.goal);
    setTopic(draft.topic);
    setMinutes(draft.minutes);
    setBreakCount(draft.breakCount);
    setBreakMinutes(draft.breakMinutes);
    setDocumentText(value.notes[run.sessionId] ?? lesson.content);
    setMaterials(value.materials?.[run.sessionId] ?? []);
    setSources(value.sources?.[run.sessionId] ?? [createMaterialSource(lesson.id, {
      name: `${course.title} · ${lesson.title}`,
      text: lesson.content,
      source: "curated",
    })]);
    setStudyInput("notes");
    go("ticket", { preserveTicketPlan: true });
  }
  function completeCuratedEvaluation(sessionId: string, score: number, total: number, answers: Parameters<typeof completeLessonRun>[5]): boolean {
    const value = current.current;
    if (!value.learningPath?.activeRun || value.learningPath.activeRun.sessionId !== sessionId ||
        value.learningPath.activeRun.phase !== "review") return false;
    try {
      const progress = completeLessonRun(value.learningPath, sessionId, score, total, Date.now(), answers);
      return commit({ ...value, learningPath: progress });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa lưu được kết quả tự kiểm tra.");
      return false;
    }
  }
  async function mutation(path: string, body: unknown): Promise<Snapshot> {
    if (needsLogin) throw new Error("Đăng nhập lại để cập nhật nhóm hoặc đồng bộ trang trí.");
    const id = ownerRef.current;
    const result = await post<Snapshot>(`/adventure/${path}`, body);
    if (ownerRef.current === id && workspaceLive.current)
      commitRemoteSnapshot(result);
    return result;
  }
  function restoreSynchronizedDraft(sessionId: string, trip: NonNullable<Snapshot["group"]>["trip"], groupId: string): boolean {
    if (!isSynchronizedTrip(trip)) return true;
    const draft = synchronizedTripDraftForSession(current.current.readyTripDrafts, sessionId, groupId);
    if (!draft) return false;
    const quizPreferences = synchronizedTripQuizPreferences(draft);
    setGoal(draft.goal);
    setTopic(draft.topic);
    setDocumentText(current.current.notes[sessionId] ?? "");
    setSources(current.current.sources?.[sessionId] ?? []);
    setMaterials(current.current.materials?.[sessionId] ?? []);
    setQuizCount(quizPreferences.quizCount);
    setSkipQuizReview(quizPreferences.skipQuizReview);
    setMinutes(trip.target / 60);
    setBreakCount(trip.breakPlan?.count ?? 0);
    setBreakMinutes(trip.breakPlan ? trip.breakPlan.seconds / 60 : 5);
    return true;
  }
  function prepareGroupTripTicket() {
    const trip = group?.trip;
    if (!trip || !group || !isSynchronizedTrip(trip) || trip.status !== "departed") return;
    const memberStatus = group.members.find((member) => member.id === user?.id)?.tripStatus;
    if (memberStatus !== "bound") return;
    const recoveredId = recoverBoundTripSessionId({
      ownSessionId: trip.ownSessionId,
      activeSessionId: saved.active?.id ?? null,
      pendingSessionIds: saved.pending.map((session) => session.id),
      savedSessionIds: saved.snapshot?.sessions.map((session) => session.id) ?? [],
    });
    if (!recoveredId) {
      setError("Phiên đã liên kết nhưng chưa có bản cục bộ để tiếp tục. Hãy kết thúc và đồng bộ phiên đang chạy trước.");
      return;
    }
    if (!restoreSynchronizedDraft(recoveredId, trip, group.id)) {
      setError("Không tìm thấy kế hoạch riêng đã sẵn sàng trên thiết bị này. Hãy mở chuyến trên thiết bị đã chuẩn bị trước đó để khôi phục.");
      return;
    }
    const sessionId = groupDraftSessionId(draftSessionIdsRef.current, group.id, recoveredId);
    setDraftTripId(sessionId);
    setMode("group");
    go("ticket", { preserveTicketPlan: true });
  }
  function start(skipPendingExercises = false) {
    const sharedTrip = mode === "group" ? group?.trip : undefined;
    const synchronizedTrip = isSynchronizedTrip(sharedTrip) ? sharedTrip : undefined;
    const ownTripStatus = group?.members.find((member) => member.id === user?.id)?.tripStatus;
    const localBoundDraftReady = Boolean(synchronizedTrip && group && synchronizedTripDraftForSession(
      current.current.readyTripDrafts,
      synchronizedTrip.ownSessionId,
      group.id,
    ));
    const canResumeBoundSession = canResumeBoundSynchronizedTrip({
      authenticatedMember: owner !== "guest" && Boolean(user) && !needsLogin && !authOffline && online,
      tripStatus: synchronizedTrip?.status,
      ownStatus: ownTripStatus,
      ownSessionId: synchronizedTrip?.ownSessionId,
      draftSessionId: draftTripId,
      localDraftReady: localBoundDraftReady,
      activeSessionId: current.current.active?.id ?? null,
    });
    if (!current.current.active && current.current.studyPlanStorage?.onboarding.phase !== "complete" && !canResumeBoundSession) {
      setError("Hoàn tất hướng dẫn thao tác trước khi bắt đầu buổi học.");
      go("station");
      return;
    }
    const synchronized = Boolean(synchronizedTrip);
    if (mode === "group" && !sharedTrip) {
      setError("Đoàn cũ chỉ giữ lịch sử và các phiên đã liên kết. Hãy lập chuyến mới để bắt đầu phiên chung.");
      return;
    }
    if (sharedTrip?.status === "closed") {
      setError("Chuyến này đã đóng. Hãy lập một chuyến mới để bắt đầu phiên khác.");
      return;
    }
    if (synchronized && !synchronizedClockSupported) {
      setError(clockSkewUnsupported
        ? "Đồng hồ thiết bị lệch quá 24 giờ so với máy chủ. Hãy bật đặt giờ tự động rồi cập nhật tiến độ trước khi khởi hành hoặc khôi phục phiên."
        : "Đang chờ đồng bộ đồng hồ máy chủ. Hãy cập nhật tiến độ rồi thử lại.");
      return;
    }
    if (synchronizedTrip && synchronizedTrip.ownSessionId && group &&
        (synchronizedTrip.status === "departed" || ownTripStatus === "ready") &&
        !synchronizedTripDraftForSession(current.current.readyTripDrafts, synchronizedTrip.ownSessionId, group.id)) {
      setError("Không tìm thấy kế hoạch riêng đã sẵn sàng trên thiết bị này. Hãy mở chuyến trên thiết bị đã chuẩn bị trước đó để khôi phục.");
      return;
    }
    if (synchronizedTrip && synchronizedTrip.status === "waiting" && ownTripStatus !== "ready") {
      setError("Hãy chuẩn bị mục tiêu riêng rồi sẵn sàng trước khi khởi hành.");
      return;
    }
    if (synchronizedTrip && synchronizedTrip.status === "waiting" && group?.owner !== user?.id) {
      setError("Chờ chủ chuyến khởi hành trước khi bắt đầu phiên.");
      return;
    }
    if (synchronizedTrip && synchronizedTrip.status === "departed" && ownTripStatus !== "bound") {
      setError("Không tìm thấy phiên đã liên kết cho thành viên này. Hãy cập nhật tiến độ.");
      return;
    }
    const startGoal = synchronizedTrip ? goal.trim() : isSynchronizedTrip(sharedTrip) ? goal.trim() : sharedTrip?.goal ?? goal.trim();
    const startTopic = synchronizedTrip ? topic : isSynchronizedTrip(sharedTrip) ? topic : sharedTrip?.topic ?? topic;
    const startTarget = sharedTrip?.target ?? minutes * 60;
    const currentLessonRun = current.current.learningPath?.activeRun;
    const legacyRunTarget = currentLessonRun?.phase === "ticket" && currentLessonRun.sessionId === draftTripId
      ? currentLessonRun.target
      : undefined;
    const personalDurationValid = isValidPersonalStudyStartDuration(minutes, startTarget, legacyRunTarget);
    const startBreakPlan = synchronizedTrip?.breakPlan ?? (synchronized ? undefined : breakCount > 0 ? plannedBreaks : undefined);
    const startBreaksValid = !startBreakPlan || isValidBreakPlan(startBreakPlan, startTarget);
    if (synchronizedTrip && (!synchronizedTrip.ownSessionId || draftTripId !== synchronizedTrip.ownSessionId)) {
      setError("Mã phiên riêng chưa sẵn sàng trên thiết bị. Hãy mở lại vé và cập nhật tiến độ.");
      return;
    }
    if (
      busy || materialRequest.current ||
      studyGuideNeedsConfirmation ||
      !loaded ||
      !exclusive ||
      current.current.active ||
      (!sharedTrip && !personalDurationValid) ||
      startGoal.trim().length < 3 ||
      startTarget < 60 ||
      startTarget > 14400 ||
      !Number.isInteger(startTarget) ||
      !startBreaksValid ||
      !canStartSessionWithQuizReview(quizCount, skipQuizReview)
    )
      return;
    const hasReadyPreparation = isStudyExercisePreparationReadyForSession(draftTripId);
    const generationPending = isStudyExerciseGenerationPendingForSession(draftTripId);
    const startResult = startStudyExerciseFocusIfAllowed({
      hasReadyPreparation,
      generationPending,
      skipConfirmed: skipPendingExercises,
      cancelPending: () => cancelPendingStudyExerciseForStart(draftTripId),
      startFocus: (withExercises) => {
        const beginFocus = (input: {
          id: string;
          started: number;
          goal: string;
          topic: string;
          target: number;
          groupId: string | null;
          observedAt?: number;
          serverObservedAt?: number;
          endsAt?: number;
          breakPlan?: ActiveTrip["breakPlan"];
          serverAnchored?: boolean;
          serverAnchorOffsetMs?: number;
          syncClock?: boolean;
          clockOffsetMs?: number;
          snapshot?: Snapshot;
        }) => {
        const at = input.started;
        const observedAt = input.syncClock ? input.observedAt ?? input.started : input.started;
        const breakPlan = input.serverAnchored ? input.breakPlan : resolveTripBreakPlan({
          synchronized,
          sharedPlan: input.breakPlan,
          localPlan: breakCount > 0 ? plannedBreaks : undefined,
        });
        let trip: ActiveTrip = {
          id: input.id,
          owner,
          goal: input.goal,
          topic: input.topic,
          document: documentText,
          materials,
          sources,
          target: input.target,
          breakPlan,
          deviceCategory: detectDeviceCategory(navigator.userAgent, navigator.maxTouchPoints),
          groupId: input.groupId,
          ...(input.syncClock ? { syncClock: true, clockOffsetMs: input.clockOffsetMs } : {}),
          ...(input.serverAnchored && input.serverAnchorOffsetMs !== undefined
            ? { serverAnchorOffsetMs: input.serverAnchorOffsetMs }
            : {}),
          started: at,
          lastAt: at,
          segments: [],
          state: "focus",
          reconnect: 0,
        };
        const quizPrefetchPreference = current.current.studyPlanStorage?.draft.quizPrefetch ?? {
          enabled: false,
          sourceConsent: false,
        };
        const useAutomaticQuizPrefetch = input.groupId === null;
        const hasQuizSource = Boolean(documentText.trim() || sources.length || materials.length);
        const initialQuizDraft = createSessionQuizDraft(quizCount, skipQuizReview, 0, {
          enabled: useAutomaticQuizPrefetch && quizPrefetchPreference.enabled,
          sourcePresent: useAutomaticQuizPrefetch && hasQuizSource,
          sourceConsent: useAutomaticQuizPrefetch && quizPrefetchPreference.sourceConsent,
        });
        if (input.syncClock)
          trip = startSynchronizedSession(trip, Math.min(input.endsAt ?? Number.POSITIVE_INFINITY, observedAt),
            !document.hidden && document.hasFocus());
        else if (input.serverAnchored)
          trip = startGuestAnchoredSession(trip, input.serverObservedAt ?? input.started,
            !document.hidden && document.hasFocus());
        const nextDraftSessionId = input.groupId ? null : crypto.randomUUID();
        const nextStudyPlanStorage = nextDraftSessionId && current.current.studyPlanStorage
          ? advanceStudyPlanCandidateAfterStart(current.current.studyPlanStorage, trip.id, nextDraftSessionId)
          : undefined;
        if (commit({
          ...current.current,
          ...(nextStudyPlanStorage ? { studyPlanStorage: nextStudyPlanStorage } : {}),
          ...(input.snapshot ? { snapshot: input.snapshot } : {}),
          ...(current.current.learningPath?.activeRun?.sessionId === trip.id
            ? { learningPath: setLessonRunPhase(current.current.learningPath, trip.id, "focus") }
            : {}),
          ...(input.serverAnchored && owner === "guest"
            ? { guestExerciseSessions: [...new Set([...(current.current.guestExerciseSessions ?? []), trip.id])] }
            : {}),
          active: trip,
          quizDrafts: updateQuizDrafts(current.current.quizDrafts, trip.id, initialQuizDraft),
        })) {
          setNow(Date.now());
          setSkipQuizReview(false);
          setQuizPrefetchUi(null);
          const nextDraftTripId = input.groupId
            ? rotateDraftSessionId(draftSessionIdsRef.current, "group", input.groupId)
            : nextDraftSessionId ?? draftTripIdRef.current;
          if (!input.groupId) draftSessionIdsRef.current.solo = nextDraftTripId;
          setDraftTripId(nextDraftTripId);
          setSummary(null);
          if (withExercises) onStudyExerciseFocusStarted(trip.id);
          setStudyExerciseStartPrompt(false);
          go("focus");
        }
        };
        if (owner === "guest" && withExercises) {
          const sessionId = draftTripId;
          const ownerId = ownerRef.current;
          const authGeneration = getAuthGeneration();
          const workspaceGeneration = materialSummaryWorkspaceGeneration.current;
          const isCurrent = () => isGuestExerciseStartScopeCurrent({
            ownerId,
            expectedOwnerId: ownerId,
            currentOwnerId: ownerRef.current,
            view: viewRef.current,
            sessionId,
            currentDraftSessionId: draftTripIdRef.current,
            authGenerationMatches: getAuthGeneration() === authGeneration,
            workspaceGenerationMatches: materialSummaryWorkspaceGeneration.current === workspaceGeneration,
            workspaceLive: workspaceLive.current,
            hasActiveSession: Boolean(current.current.active),
            preparationReady: isStudyExercisePreparationReadyForSession(sessionId),
          });
          if (tripStartInFlight.current) return;
          tripStartInFlight.current = true;
          void run(async () => {
            try {
              const exerciseId = studyExercisePreparation?.plannedSessionId === sessionId
                ? studyExercisePreparation.id
                : undefined;
              if (!exerciseId) throw new Error("Bộ bài tập không còn sẵn sàng. Hãy chuẩn bị lại trước khi bắt đầu.");
              await bindStudyExercises(sessionId, undefined, true, exerciseId);
              if (!isCurrent()) return;
              const started = await startGuestAiSession({
                id: sessionId,
                target: startTarget,
                ...(startBreakPlan ? { breakPlan: startBreakPlan } : {}),
              });
              const clientReceivedAt = Date.now();
              if (!isCurrent()) return;
              if (started.sessionId !== sessionId || !Number.isSafeInteger(started.startedAt) ||
                  started.startedAt <= 0 || !Number.isSafeInteger(started.serverNow) || started.serverNow < started.startedAt ||
                  started.target !== startTarget ||
                  JSON.stringify(started.breakPlan) !== JSON.stringify(startBreakPlan))
                throw new Error("Máy chủ chưa xác nhận đúng thời lượng cho phiên AI riêng tư.");
              const serverAnchorOffsetMs = estimateServerClockOffset(started.serverNow, clientReceivedAt);
              if (serverAnchorOffsetMs === null)
                throw new Error("Đồng hồ thiết bị lệch quá 24 giờ. Hãy đặt ngày và giờ tự động rồi thử lại.");
              onStudyExerciseFocusStarted(sessionId);
              beginFocus({
                id: started.sessionId,
                started: started.startedAt,
                goal: startGoal,
                topic: startTopic,
                target: started.target,
                groupId: null,
                breakPlan: started.breakPlan,
                serverAnchored: true,
                serverAnchorOffsetMs,
                serverObservedAt: started.serverNow,
              });
            } finally {
              tripStartInFlight.current = false;
            }
          });
          return;
        }
        if (sharedTrip && group) {
          if (!user || needsLogin) {
            setError("Đăng nhập lại để bắt đầu phiên của chuyến.");
            return;
          }
          if (sharedTrip.status === "waiting" && group.owner !== user.id) {
            setError("Hãy chờ chủ chuyến khởi hành trước.");
            return;
          }
          if (synchronizedTrip && sharedTrip.status === "waiting" && !synchronizedControls.canLaunch) {
            setError("Chưa sẵn sàng khởi hành. Cần từ hai đến sáu thành viên đã tham gia, mọi người đều sẵn sàng và đồng hồ đã đồng bộ.");
            return;
          }
          if (tripStartInFlight.current) return;
          tripStartInFlight.current = true;
          const sessionId = synchronizedTrip ? synchronizedTrip.ownSessionId! : draftTripId;
          const ownerId = ownerRef.current;
          const authGeneration = getAuthGeneration();
          void run(async () => {
            try {
              const started = await startAfterTripReservation({
                sessionId,
                reserve: async (requestedId) => {
                  const binding = await post<Snapshot & { tripStart: { sessionId: string; startedAt?: number; endsAt?: number } }>(
                    "/adventure/trip/start",
                    { groupId: group.id, sessionId: requestedId },
                  );
                  if (binding.tripStart.sessionId !== requestedId)
                    throw new Error("Máy chủ không xác nhận đúng mã phiên đã chuẩn bị.");
                  const boundGroup = binding.group;
                  const canonicalPlan = boundGroup?.trip;
                  const boundMember = boundGroup?.members.find((member) => member.id === ownerId);
                  if (!boundGroup || boundGroup.id !== group.id || canonicalPlan?.status !== "departed" ||
                      boundMember?.tripStatus !== "bound")
                    throw new Error("Chuyến chưa sẵn sàng để bắt đầu phiên. Hãy cập nhật tiến độ rồi thử lại.");
                  if (synchronizedTrip &&
                      (!isSynchronizedTrip(canonicalPlan) || !Number.isSafeInteger(binding.tripStart.startedAt) ||
                        !Number.isSafeInteger(binding.tripStart.endsAt)))
                    throw new Error("Máy chủ chưa xác nhận giờ khởi hành chung. Hãy cập nhật tiến độ rồi thử lại.");
                  return binding;
                },
                isCurrent: () => {
                  const auth = useAuthStore.getState();
                  return isTripStartCurrent({
                    expectedOwnerId: ownerId,
                    ownerId: ownerRef.current,
                    workspaceLive: workspaceLive.current,
                    exclusiveLease: exclusiveLease.current,
                    activeSessionId: current.current.active?.id ?? null,
                    expectedSessionId: sessionId,
                    draftSessionId: draftTripIdRef.current,
                    expectedAuthGeneration: authGeneration,
                    authGeneration: getAuthGeneration(),
                    authenticatedUserId: auth.user?.id,
                    expectedGroupId: group.id,
                    currentGroupId: current.current.snapshot?.group?.id ?? null,
                    needsLogin: auth.needsLogin,
                    currentView: viewRef.current,
                  });
                },
                start: (binding, startedAt) => {
                  const boundGroup = binding.group!;
                  const canonicalPlan = boundGroup.trip!;
                  if (synchronizedTrip) {
                    const serverOffset = serverClockOffsetMs.current;
                    if (serverOffset === null) {
                      setError("Đồng hồ thiết bị lệch quá 24 giờ so với máy chủ. Hãy bật đặt giờ tự động rồi cập nhật tiến độ.");
                      return;
                    }
                    const commonStartedAt = binding.tripStart.startedAt!;
                    const commonEndsAt = binding.tripStart.endsAt!;
                    const convertedNow = serverTimeFromClientTime(startedAt, serverOffset);
                    if (!Number.isSafeInteger(convertedNow)) {
                      setError("Không thể xác nhận giờ thiết bị với máy chủ. Hãy bật đặt giờ tự động rồi cập nhật tiến độ.");
                      return;
                    }
                    beginFocus({
                      id: sessionId,
                      started: commonStartedAt,
                      observedAt: convertedNow,
                      endsAt: commonEndsAt,
                      goal: startGoal,
                      topic: startTopic,
                      target: canonicalPlan.target,
                      breakPlan: isSynchronizedTrip(canonicalPlan) ? canonicalPlan.breakPlan : undefined,
                      syncClock: true,
                      clockOffsetMs: serverOffset,
                      groupId: boundGroup.id,
                      snapshot: binding,
                    });
                    return;
                  }
                  beginFocus({
                    id: sessionId,
                    started: startedAt,
                    goal: isSynchronizedTrip(canonicalPlan) ? startGoal : canonicalPlan.goal ?? startGoal,
                    topic: isSynchronizedTrip(canonicalPlan) ? startTopic : canonicalPlan.topic ?? startTopic,
                    target: canonicalPlan.target,
                    groupId: boundGroup.id,
                    snapshot: binding,
                  });
                },
              });
              if (!started && ownerRef.current === ownerId && workspaceLive.current) {
                setError(current.current.active
                  ? "Một phiên học khác đã bắt đầu. Hãy tiếp tục phiên đang chạy trước."
                  : "Trạng thái chuyến đã thay đổi trước khi bắt đầu. Hãy cập nhật tiến độ rồi thử lại.");
              }
            } finally {
              tripStartInFlight.current = false;
            }
          });
          return;
        }
        beginFocus({
          id: draftTripId,
          started: Date.now(),
          goal: startGoal,
          topic: startTopic,
          target: startTarget,
          groupId: mode === "group" && group ? group.id : null,
        });
      },
    });
    if (startResult === "needs-skip-choice") setStudyExerciseStartPrompt(true);
  }
  const autoResumePrepared = useRef<string | null>(null);
  useEffect(() => {
    const trip = group?.trip;
    const synchronizedTrip = isSynchronizedTrip(trip) ? trip : undefined;
    const sessionId = synchronizedTrip?.ownSessionId;
    if (!sessionId) return;
    const key = `${group!.id}:${sessionId}`;
    const shouldResume = shouldAutoResumeSynchronizedTrip({
      mode: synchronizedTrip?.mode,
      tripStatus: synchronizedTrip?.status,
      ownStatus: synchronizedControls.ownStatus,
      ownSessionId: sessionId,
      clockSupported: synchronizedClockSupported,
      foreground: !document.hidden && document.hasFocus(),
      activeSessionId: saved.active?.id ?? null,
      pendingSessionIds: saved.pending.map((session) => session.id),
      savedSessionIds: data?.sessions.map((session) => session.id) ?? [],
      localDraftReady: Boolean(synchronizedTripDraftForSession(saved.readyTripDrafts, sessionId, group?.id ?? "")),
      inFlight: busy || tripStartInFlight.current,
    });
    if (!shouldResume || !loaded || !exclusive || !online || needsLogin || studyGuideNeedsConfirmation || materialRequest.current)
      return;
    if (autoResumeAttempt.current === key) return;
    if (!isStudyWorkspaceView(view) || draftTripId !== sessionId) {
      if (autoResumePrepared.current !== key) {
        autoResumePrepared.current = key;
        prepareGroupTripTicket();
      }
      return;
    }
    autoResumeAttempt.current = key;
    start();
  });
  function finish() {
    const trip = current.current.active;
    const at = trip ? tripClockNow(trip, Date.now()) : Date.now();
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
    if (value.learningPath?.activeRun?.sessionId === s.id)
      value.learningPath = finishLessonFocus(value.learningPath, s);
    if (value.readyTripDrafts) delete value.readyTripDrafts[s.id];
    value.notes[s.id] = next.document;
    (value.materials ??= {})[s.id] = next.materials ?? [];
    (value.sources ??= {})[s.id] = next.sources ?? [];
    value.summarySessionId = s.id;
    const personalStorage = trip.groupId
      ? value.studyPlanStorage ?? createStudyPlanStorage({ legacyActivity: true })
      : undefined;
    if (personalStorage) value.studyPlanStorage = personalStorage;
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
      if (trip.groupId && personalStorage) {
        const personalDraft = personalStorage.draft;
        const personalIdentity = selectedStudyWorkspaceIdentity(personalStorage);
        const personalWorkspace = findStudyWorkspaceDraft(personalStorage, personalIdentity);
        const legacySessionId = personalIdentity.sessionId === s.id ? null : personalIdentity.sessionId;
        updateQuickTripDraft(quickTripDraft, {
          goal: personalDraft.goal,
          topic: personalDraft.topicId,
          topicLabel: personalDraft.topicLabel,
          minutes: personalDraft.preferredMinutes,
          breakCount: personalDraft.breakCount,
          breakMinutes: personalDraft.breakMinutes,
          level: personalDraft.level,
          confidence: personalDraft.confidence,
          selectedPlanId: personalDraft.selectedPlanId,
          selectedStepId: personalDraft.selectedStepId,
        });
        draftSessionIdsRef.current.solo = personalIdentity.sessionId;
        setDraftTripId(personalIdentity.sessionId);
        setGoal(personalDraft.goal);
        setTopic(personalDraft.topicId);
        setMinutes(personalDraft.preferredMinutes);
        setBreakCount(personalDraft.breakCount);
        setBreakMinutes(personalDraft.breakMinutes);
        setDocumentText(personalWorkspace?.notes ?? (legacySessionId ? value.notes[legacySessionId] ?? "" : ""));
        setSources(structuredClone(personalWorkspace?.sources ?? (legacySessionId ? value.sources?.[legacySessionId] ?? [] : [])));
        setMaterials(structuredClone(personalWorkspace?.materials ?? (legacySessionId ? value.materials?.[legacySessionId] ?? [] : [])));
        setMode("solo");
      }
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
    if (!files.length || busy || studyGuideNeedsConfirmation || materialRequest.current || !workspaceLive.current || !isStudyWorkspaceView(view)) return;
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
      const nextSources = [...sources, ...importedSources];
      const nextMaterials = [...materials, ...imported];
      if (!persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })) return;
      for (const [sourceId, file] of originals) originalFiles.current.set(sourceId, file);
      setSources(nextSources);
      setMaterials(nextMaterials);
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
    if (busy || tutorialActive || materialRequest.current || !isStudyWorkspaceView(view)) return;
    const guest = ownerRef.current === "guest";
    if (!guest && (!user || needsLogin)) { setError("Đăng nhập lại để đọc tài liệu bằng AI."); return; }
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
      const requestBody = { mimeType, data, recoverContext: true, context };
      const result = guest
        ? await postGuestAi<{text:string;message?:string}>("/materials/read", requestBody, controller.signal)
        : await request<{text:string;message?:string}>("/materials/read", {method:"POST",body:JSON.stringify(requestBody),signal:controller.signal});
      if (!isCurrent()) return;
      const nextSources = sources.map((source) => source.id === sourceId ? {...source,text:result.text,source:"ai-vision",requiresReview:true,reviewed:false} : source);
      const nextMaterials = materials.map((item) => item.sourceId === sourceId ? {...item,status:result.text ? "extracted" : "empty",message:result.message ?? "AI đã đọc. Hãy kiểm tra từ vựng, nghĩa và các chỗ [không rõ]."} : item);
      if (!persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })) return;
      noteStudyExerciseSourceChange(draftTripId, sourceId);
      setSources(nextSources);
      setMaterials(nextMaterials);
      setNotice("AI đã đọc tệp và đề xuất khôi phục chỗ mờ khi có đủ ngữ cảnh. Kiểm tra các chỗ [suy luận] hoặc [không rõ] trước khi xác nhận.");
    } catch(e) { if (isCurrent()) setError(e instanceof Error ? e.message : "Không đọc được tài liệu."); }
    finally { if (materialRequest.current === controller) { materialRequest.current = null; if(workspaceLive.current && ownerRef.current === id) {setBusy(false);setMaterialProgress(null);} } }
  }
  async function generateStudyGuide(prompt: string): Promise<StudyGuideDraft | undefined> {
    if (busy || tutorialActive || materialRequest.current || !workspaceLive.current || !isStudyWorkspaceView(view)) return;
    const guest = ownerRef.current === "guest";
    if (!guest && (!user || needsLogin)) { setError("Đăng nhập lại để tạo bản ôn tập bằng AI."); return; }
    const id = ownerRef.current;
    const controller = new AbortController();
    materialRequest.current = controller;
    const isCurrent = () => workspaceLive.current && ownerRef.current === id && materialRequest.current === controller && !controller.signal.aborted;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { prompt, topic: availableTopics.find(item => item.id === topic)?.name ?? topic,
        ...(goal.trim() ? { goal: goal.trim() } : {}) };
      const result = guest
        ? await postGuestAi<StudyGuideDraft>("/materials/generate", body, controller.signal)
        : await request<StudyGuideDraft>("/materials/generate", {
            method: "POST", signal: controller.signal, body: JSON.stringify(body),
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
  function acceptStudyGuide(draft: StudyGuideDraft, mode: StudyGuideUseMode) {
    if (busy || !workspaceLive.current || !isStudyWorkspaceView(view) || !studyGuideNeedsConfirmation ||
        studyGuideReview.draft !== draft) return;
    try {
      const source = studyGuideSource(crypto.randomUUID(), draft);
      const reviewed = reviewMaterialSource(source, source.text);
      const material: MaterialInfo = { sourceId: source.id, name: source.name, size: new TextEncoder().encode(source.text).length,
        type: "text/plain", status: "extracted", message: "Bản ôn tập do AI tạo, đã được bạn kiểm tra và xác nhận." };
      if (mode === "append") {
        const appendCheck = validateStudyGuideAppend(sources, materials, reviewed);
        if (!appendCheck.ok) {
          setError(appendCheck.message);
          setNotice("");
          return;
        }
      }
      const nextNotes = mode === "replace" ? "" : documentText;
      const nextSources = mode === "replace" ? [reviewed] : [...sources, reviewed];
      const nextMaterials = mode === "replace" ? [material] : [...materials, material];
      if (!persistStudyWorkspaceDraft({ notes: nextNotes, sources: nextSources, materials: nextMaterials }, { revokeSourceConsent: true })) return;
      for (const existing of sources) noteStudyExerciseSourceChange(draftTripId, existing.id);
      if (mode === "replace") {
        originalFiles.current.clear();
        setDocumentText(nextNotes);
      }
      setSources(nextSources);
      setMaterials(nextMaterials);
      dispatchStudyGuideReview({ type: "discard" });
      setError("");
      setNotice(mode === "replace"
        ? "Đã thay nội dung hiện có bằng bản ôn tập bạn vừa xác nhận."
        : "Đã thêm bản ôn tập bạn xác nhận bên cạnh nội dung hiện có.");
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
  async function generateQuiz(session: SessionHistoryEntry, count: number): Promise<
    { questions: QuizQuestion[] } | { questions: GuestQuizQuestion[]; guestQuizId: string }
  > {
    const id = ownerRef.current;
    if (current.current.summarySessionId !== session.id)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần ôn tập.");
    if (id === "guest") {
      const isCurrent = () => ownerRef.current === "guest" && workspaceLive.current &&
        viewRef.current === "summary" && current.current.summarySessionId === session.id;
      const buildPayload = () => {
        if (!isCurrent()) throw new DOMException("Phiên học đã đổi.", "AbortError");
        const value = current.current;
        const removed = new Set([...(value.removedSessionIds ?? []), ...(value.snapshot?.removedSessionIds ?? [])]);
        const canonical = historySessions(value, "guest").find((item) => item.id === session.id && item.userId === "guest");
        if (removed.has(session.id) || !canonical)
          throw new Error("Phiên khách này không còn trên thiết bị. Hãy mở lại lịch sử rồi thử lại.");
        const source = {
          topic: canonical.topic,
          goal: canonical.goal,
          notes: value.notes[session.id] ?? "",
          sources: value.sources?.[session.id] ?? [],
          materials: value.materials?.[session.id] ?? [],
        };
        return buildQuizGenerationPayload(source, count);
      };
      const initial = buildPayload();
      guestQuizRequest.current?.abort();
      const controller = new AbortController();
      guestQuizRequest.current = controller;
      try {
        const response = await postGuestAi<{
          id: string;
          plannedSessionId: string;
          questions: GuestQuizQuestion[];
        }>("/quizzes/generate", {
          plannedSessionId: session.id,
          ...initial,
        }, controller.signal);
        if (controller.signal.aborted || guestQuizRequest.current !== controller || !isCurrent())
          throw new DOMException("Phiên học đã đổi.", "AbortError");
        const latest = buildPayload();
        if (quizGenerationSourceKey(latest) !== quizGenerationSourceKey(initial))
          throw new DOMException("Nguồn học đã đổi.", "AbortError");
        if (!isValidGuestQuizDeck(response) || response.plannedSessionId !== session.id ||
            response.questions.length !== count)
          throw new Error("AI chưa trả về đúng số câu hỏi riêng tư. Hãy thử tạo lại.");
        return { guestQuizId: response.id, questions: response.questions };
      } finally {
        if (guestQuizRequest.current === controller) guestQuizRequest.current = null;
      }
    }
    if (!user || needsLogin) throw new Error("Đăng nhập lại để tạo quiz AI.");
    await sync();
    if (ownerRef.current !== id || !workspaceLive.current ||
        current.current.summarySessionId !== session.id)
      throw new Error("Chuyến đã đổi trước khi quiz được tạo.");
    const canonical = resolveCurrentQuizSession(session.id);
    if (canonical.quiz)
      throw new Error("Phiên này đã có điểm. Hãy mở một phiên ôn tập mới để làm thêm câu hỏi.");
    const initial = buildQuizScope(canonical, count);
    const requestIdentity = {
      ownerId: id,
      sessionId: session.id,
      correctionVersion: initial.scope.correctionVersion,
      count,
      sourceKey: initial.scope.sourceKey,
      requestGeneration: ++quizRequestGeneration.current,
    };
    const pendingState = { ...requestIdentity, status: "pending" as const };
    const isSameRequest = (state: QuizPrefetchUiState | null) =>
      isCurrentQuizPrefetchRequest(state, requestIdentity);
    setQuizPrefetchUi(pendingState);
    try {
      const result = await quizPrefetch.retry(initial.scope, (signal) =>
        requestQuizQuestions(canonical, count, initial.scope, signal));
      if (ownerRef.current !== id || !workspaceLive.current ||
          current.current.summarySessionId !== session.id)
        throw new Error("Chuyến đã đổi trước khi quiz được lưu.");
      const latest = resolveCurrentQuizSession(session.id);
      if (latest.quiz)
        throw new Error("Phiên này đã có điểm. Hãy mở một phiên ôn tập mới để làm thêm câu hỏi.");
      if (quizPrefetchScopeKey(buildQuizScope(latest, count).scope) !== quizPrefetchScopeKey(initial.scope))
        throw new Error("Thông tin chuyến đã thay đổi. Hãy tạo lại câu hỏi theo dữ liệu mới.");
      setQuizPrefetchUi((previous) => isSameRequest(previous)
        ? { ...pendingState, status: "ready" }
        : previous);
      return { questions: result.questions as QuizQuestion[] };
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
    const activeTrip = current.current.active?.id === sessionId ? current.current.active : null;
    if (activeTrip && activeTrip.owner !== ownerId) return;
    const currentSession = activeTrip ??
      current.current.snapshot?.sessions.find((item) => item.id === sessionId && item.userId === ownerId);
    if (!currentSession || current.current.removedSessionIds?.includes(sessionId) ||
        current.current.snapshot?.removedSessionIds?.includes(sessionId)) return;
    const correctionVersion = "correctionVersion" in currentSession
      ? currentSession.correctionVersion ?? 0
      : 0;
    if ((draft.correctionVersion ?? 0) !== correctionVersion) return;
    const previous = current.current.quizDrafts?.[sessionId];
    const versionedDraft = {
      ...draft,
      correctionVersion,
      ...(draft.prefetchEnabled === undefined && previous?.prefetchEnabled !== undefined ? {
        prefetchEnabled: previous.prefetchEnabled,
        prefetchSourcePresent: previous.prefetchSourcePresent,
        prefetchSourceConsent: previous.prefetchSourceConsent,
      } : {}),
    };
    const previousCount = previous?.requestedCount ?? previous?.count ?? 3;
    const nextCount = versionedDraft.requestedCount ?? versionedDraft.count;
    if (previousCount !== nextCount) {
      quizPrefetch.cancelSession(ownerId, sessionId);
      quizPrefetchSaved.current.clear();
      setQuizPrefetchUi((state) => state?.ownerId === ownerId && state.sessionId === sessionId ? null : state);
    }
    commitRef.current({
      ...current.current,
      quizDrafts: updateQuizDrafts(current.current.quizDrafts, sessionId, versionedDraft),
    });
  }
  function invalidateQuizForSourceEdit(ownerId: string, sessionId: string) {
    if (ownerRef.current !== ownerId || current.current.summarySessionId !== sessionId) return;
    guestQuizRequest.current?.abort();
    guestQuizRequest.current = null;
    quizPrefetch.cancelSession(ownerId, sessionId);
    quizPrefetchSaved.current.clear();
    setQuizPrefetchUi((state) => state?.ownerId === ownerId && state.sessionId === sessionId ? null : state);
  }
  function emptyQuizDraftForSourceEdit(value: Saved, sessionId: string): Record<string, QuizDraft> {
    const previous = value.quizDrafts?.[sessionId];
    const count = previous?.requestedCount ?? previous?.count ?? 3;
    const correctionVersion = value.snapshot?.sessions.find((item) => item.id === sessionId)?.correctionVersion ?? 0;
    return updateQuizDrafts(value.quizDrafts, sessionId,
      {
        ...quizDraftFromQuestions([], isQuizCount(count) ? count : 3, correctionVersion),
        ...(previous?.prefetchEnabled === undefined ? {} : {
          prefetchEnabled: previous.prefetchEnabled,
          prefetchSourcePresent: previous.prefetchSourcePresent,
          prefetchSourceConsent: false,
        }),
      });
  }
  async function gradeQuiz(sessionId: string, answers: { id: string; selected: number }[]): Promise<
    Session | { guestGrade: NonNullable<Session["quiz"]> }
  > {
    const id = ownerRef.current;
    if (!workspaceLive.current || current.current.summarySessionId !== sessionId)
      throw new Error("Chuyến đã đổi. Hãy mở lại chuyến cần chấm.");
    if (id === "guest") {
      const draft = current.current.quizDrafts?.[sessionId];
      if (!draft?.guestQuizId || draft.guestGrade || !draft.questions.length)
        throw new Error("Không tìm thấy bộ câu hỏi riêng tư. Hãy tạo lại câu hỏi rồi thử chấm.");
      const deck = draft.questions as GuestQuizQuestion[];
      guestQuizRequest.current?.abort();
      const controller = new AbortController();
      guestQuizRequest.current = controller;
      try {
        const result = await postGuestAi<{
          quizId: string;
          score: number;
          total: number;
          questions: { id: string; selected: number; correct: boolean; correctAnswerIndex: number; explanation: string }[];
        }>(`/quizzes/${encodeURIComponent(draft.guestQuizId)}/grade`, { answers }, controller.signal);
        if (controller.signal.aborted || guestQuizRequest.current !== controller ||
            ownerRef.current !== id || !workspaceLive.current || viewRef.current !== "summary" ||
            current.current.summarySessionId !== sessionId)
          throw new DOMException("Phiên học đã đổi.", "AbortError");
        if (!isValidGuestQuizGrade(result, deck) || result.quizId !== draft.guestQuizId ||
            answers.length !== deck.length || answers.some((answer) =>
              result.questions.find((item) => item.id === answer.id)?.selected !== answer.selected))
          throw new Error("Máy chủ chưa trả về kết quả chấm riêng tư hợp lệ.");
        const feedback = result.questions.map((item) => {
          const question = deck.find((candidate) => candidate.id === item.id);
          if (!question) throw new Error("Không tìm thấy câu hỏi trong bộ riêng tư.");
          return {
            questionId: item.id,
            question: question.question,
            options: question.options,
            selected: item.selected,
            correctIndex: item.correctAnswerIndex,
            correct: item.correct,
            explanation: item.explanation,
            knowledgePoint: question.knowledgePoint ?? "Nội dung chuyến học",
          };
        });
        const guestGrade = { score: result.score, total: result.total, feedback };
        if (!isValidQuizAssessment(guestGrade))
          throw new Error("Máy chủ chưa trả về kết quả chấm riêng tư hợp lệ.");
        return { guestGrade };
      } finally {
        if (guestQuizRequest.current === controller) guestQuizRequest.current = null;
      }
    }
    if (!user || needsLogin) throw new Error("Đăng nhập lại để chấm quiz.");
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
    const restoredSources = current.current.sources?.[session.id] ?? [];
    const reviewSources = structuredClone(restoredSources.length ? restoredSources : plan.materials.length
      ? [recoveredMaterialSource(plan.documentText, plan.materials)] : []);
    const reviewMaterials = structuredClone(plan.materials);
    const reviewSessionId = crypto.randomUUID();
    const topicLabel = availableTopics.find((item) => item.id === plan.topic)?.name ?? plan.topic;
    const reviewDraft = {
      ...quickTripDraft.current,
      goal: plan.goal,
      topic: plan.topic,
      topicLabel,
      minutes: plan.minutes,
      breakCount: 0,
      breakMinutes: 5,
      selectedPlanId: null,
      selectedStepId: null,
    };
    const storage = current.current.studyPlanStorage ?? createStudyPlanStorage();
    const nextStorage = {
      ...storage,
      draft: {
        ...updateStudyPlanDraftFromQuickTrip(storage.draft, reviewDraft, topicLabel),
        selectedPlanId: null,
        selectedStepId: null,
        candidateSessionId: reviewSessionId,
        quizPrefetch: { ...storage.draft.quizPrefetch, sourceConsent: false },
      },
    };
    let savedStorage: StudyPlanStorage;
    try {
      savedStorage = saveStudyWorkspaceDraft(nextStorage, {
        sessionId: reviewSessionId,
        planId: null,
        stepId: null,
        notes: plan.documentText,
        sources: reviewSources,
        materials: reviewMaterials,
        updatedAt: Date.now(),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không lưu được nội dung ôn tập trên thiết bị.");
      return;
    }
    if (!commit({ ...current.current, studyPlanStorage: savedStorage })) return;
    draftSessionIdsRef.current.solo = reviewSessionId;
    updateQuickTripDraft(quickTripDraft, reviewDraft);
    setGoal(plan.goal);
    setTopic(plan.topic);
    setDocumentText(plan.documentText);
    setMaterials(reviewMaterials);
    cancelPendingStudyExerciseForStart(draftTripId);
    invalidateStudyExercisePreparationForSession(draftTripId);
    setDraftTripId(reviewSessionId);
    setSources(reviewSources);
    setMinutes(plan.minutes);
    setBreakCount(0);
    setBreakMinutes(5);
    setMode("solo");
    go("station");
  }
  function saveStudyOnboardingProgress(progress: StudyOnboardingProgress) {
    const storage = current.current.studyPlanStorage ?? createStudyPlanStorage();
    const onboardingProgress = storage.onboarding.phase === "tutorial"
      ? {
          ...progress,
          survey: syncStudySurveyWithCurrentDraft(progress.survey, {
            goal,
            topicId: topic,
            topicLabel: availableTopics.find((item) => item.id === topic)?.name ?? topic,
            preferredMinutes: storage.draft.preferredMinutes,
            level: storage.draft.level,
            confidence: storage.draft.confidence,
          }, minutes),
        }
      : progress;
    const survey = onboardingProgress.survey;
    const preferredMinutes = survey.preferredMinutes !== null && Number.isSafeInteger(survey.preferredMinutes) &&
      survey.preferredMinutes >= 1 && survey.preferredMinutes <= 240
      ? survey.preferredMinutes : storage.draft.preferredMinutes;
    const validMinutes = preferredMinutes === survey.preferredMinutes;
    const draft = {
      ...storage.draft,
      ...survey,
      preferredMinutes,
      selectedPlanId: storage.draft.selectedPlanId,
      selectedStepId: storage.draft.selectedStepId,
    };
    const quickDraft = {
      goal: survey.goal,
      topic: survey.topicId,
      topicLabel: survey.topicLabel,
      minutes: preferredMinutes,
      level: survey.level,
      confidence: survey.confidence,
    };
    updateQuickTripDraft(quickTripDraft, quickDraft);
    setGoal(survey.goal);
    setTopic(survey.topicId);
    if (validMinutes) setMinutes(preferredMinutes);
    commit({
      ...current.current,
      studyPlanStorage: { ...storage, onboarding: onboardingProgress, draft },
    });
  }
  function reopenStudyOnboarding() {
    const storage = current.current.studyPlanStorage;
    if (!storage) return;
    saveStudyOnboardingProgress(reopenStudyOnboardingFromDraft(storage.onboarding, {
      goal: storage.draft.goal,
      topicId: storage.draft.topicId,
      topicLabel: storage.draft.topicLabel,
      preferredMinutes: storage.draft.preferredMinutes,
      level: storage.draft.level,
      confidence: storage.draft.confidence,
    }));
  }
  function cancelStudyPlanRequest() {
    if (!studyPlanRequest.current) return;
    studyPlanRequest.current.abort();
    studyPlanRequest.current = null;
    studyPlanRequestGeneration.current++;
    setStudyPlanError("");
    setStudyPlanStatus("cancelled");
  }
  async function requestStudyPlanFromWorkspace() {
    if (studyPlanAccessReason) return;
    if (!isValidStudyMinutes(minutes)) {
      setStudyPlanError("Thời lượng cần là số nguyên từ 1 đến 240 phút.");
      setStudyPlanStatus("error");
      return;
    }
    if (goal.trim().length < 3) {
      setStudyPlanError("Hãy nhập mục tiêu dài ít nhất 3 ký tự.");
      setStudyPlanStatus("error");
      return;
    }
    if (includeStudyPlanSource && !sourceForStudyPlan?.reviewed) {
      setStudyPlanError("Hãy kiểm tra nội dung nguồn trước khi chọn gửi cho AI.");
      setStudyPlanStatus("error");
      return;
    }

    const controller = new AbortController();
    studyPlanRequest.current?.abort();
    studyPlanRequest.current = controller;
    const generation = ++studyPlanRequestGeneration.current;
    const scope = { ...studyPlanContext.current };
    const currentScope = () => {
      const latest = studyPlanContext.current;
      return studyPlanRequestGeneration.current === generation && !controller.signal.aborted &&
        ownerRef.current === scope.owner && isCurrentStudyPlanRequest(scope, latest);
    };
    setStudyPlanStatus("pending");
    setStudyPlanError("");
    try {
      const requestBody = await buildStudyPlanRequest({
        goal: scope.goal,
        topic: ticketTopicName,
        level: scope.level,
        preferredMinutes: scope.minutes,
        includeSource: includeStudyPlanSource,
        source: sourceForStudyPlan ?? undefined,
      });
      if (!currentScope()) return;
      const response = await generateStudyPlan(requestBody, {
        owner: scope.owner,
        signal: controller.signal,
      });
      if (!currentScope()) return;

      const now = Date.now();
      const planId = crypto.randomUUID();
      const firstStepSessionId = scope.selectedPlanId ? crypto.randomUUID() : draftTripId;
      const steps = response.steps.map((step, index) => ({
        ...step,
        id: crypto.randomUUID(),
        plannedSessionId: index === 0 ? firstStepSessionId : crypto.randomUUID(),
        preferredMinutes: scope.minutes,
      }));
      const topicLabel = ticketTopicName;
      const plan = {
        id: planId,
        origin: "ai" as const,
        title: response.title,
        goal: requestBody.goal,
        topicId: scope.topic,
        topicLabel,
        level: scope.level.trim(),
        preferredMinutes: scope.minutes,
        selectedStepId: steps[0].id,
        createdAt: now,
        updatedAt: now,
        steps,
        ...(response.finalCheck ? { finalCheck: response.finalCheck } : {}),
        ...(response.verificationNote ? { verificationNote: response.verificationNote } : {}),
      };
      const storage = current.current.studyPlanStorage ?? createStudyPlanStorage();
      const studyDraft = {
        ...storage.draft,
        goal: requestBody.goal,
        topicId: scope.topic,
        topicLabel,
        preferredMinutes: scope.minutes,
        level: scope.level.trim(),
        selectedPlanId: planId,
        selectedStepId: steps[0].id,
        candidateSessionId: steps[0].plannedSessionId,
      };
      let nextStorage: StudyPlanStorage = {
        ...storage,
        draft: studyDraft,
        plans: [...storage.plans.filter((entry) => entry.id !== planId), plan].slice(-50),
      };
      nextStorage = saveStudyWorkspaceDraft(nextStorage, {
        sessionId: steps[0].plannedSessionId,
        planId,
        stepId: steps[0].id,
        notes: documentText,
        sources,
        materials,
        updatedAt: now,
      });
      studyPlanRequest.current = null;
      studyPlanResetSuppression.current = true;
      if (!commit({
        ...current.current,
        studyPlanStorage: nextStorage,
      })) {
        studyPlanResetSuppression.current = false;
        throw new Error("Không lưu được bản nháp lộ trình trên thiết bị này.");
      }
      updateQuickTripDraft(quickTripDraft, {
        goal: requestBody.goal,
        topic: scope.topic,
        topicLabel,
        minutes: scope.minutes,
        level: scope.level.trim(),
        selectedPlanId: planId,
        selectedStepId: steps[0].id,
      });
      cancelPendingStudyExerciseForStart(draftTripId);
      invalidateStudyExercisePreparationForSession(draftTripId);
      setDraftTripId(steps[0].plannedSessionId);
      draftSessionIdsRef.current.solo = steps[0].plannedSessionId;
      setStudyPlanStatus("ready");
    } catch (cause) {
      if (!currentScope() || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setStudyPlanError(cause instanceof Error ? cause.message : "Chưa tạo được lộ trình. Hãy thử lại.");
      setStudyPlanStatus("error");
    } finally {
      if (studyPlanRequest.current === controller) studyPlanRequest.current = null;
    }
  }
  function saveStudyPlanStep(stepId: string, patch: StudyPlanStepPatch): boolean {
    const value = current.current;
    const storage = value.studyPlanStorage;
    if (!storage || value.active || mode !== "solo") {
      setError("Không thể lưu bước học trong phiên đang chạy hoặc chuyến nhóm.");
      return false;
    }
    const identity = selectedStudyWorkspaceIdentity(storage);
    if (identity.stepId !== stepId || identity.sessionId !== draftTripIdRef.current) {
      setError("Bước học đã thay đổi. Hãy mở lại bước hiện tại rồi lưu lại.");
      return false;
    }
    const nextStorage = applyStudyPlanStepPatch(storage, stepId, patch, Date.now());
    if (!nextStorage) {
      setError("Mỗi nội dung bước học cần từ 3 đến 400 ký tự. Hãy kiểm tra rồi lưu lại.");
      return false;
    }
    if (!commit({ ...value, studyPlanStorage: nextStorage })) return false;
    setError("");
    return true;
  }
  function persistStudyWorkspaceDraft(
    changes: Partial<{ notes: string; sources: MaterialSource[]; materials: MaterialInfo[] }> = {},
    options: { revokeSourceConsent?: boolean } = {},
  ): boolean {
    const value = current.current;
    if (!loaded || !exclusive || value.active || mode !== "solo" ||
        (!isStudyWorkspaceView(view) && view !== "library")) {
      setError(value.active
        ? "Phiên đang chạy; không thể thay đổi nội dung nguồn hoặc sự đồng ý gửi quiz."
        : !loaded || !exclusive
          ? "Dữ liệu riêng trên thiết bị chưa sẵn sàng. Nội dung chưa được thay đổi."
          : mode !== "solo"
            ? "Chỉ có thể sửa nguồn trong bản nháp cá nhân."
            : "Mở lại lộ trình cá nhân để sửa nội dung.");
      return false;
    }
    let storage = value.studyPlanStorage ?? createStudyPlanStorage();
    const selectedIdentity = selectedStudyWorkspaceIdentity(storage);
    if (selectedIdentity.planId && selectedIdentity.sessionId !== draftTripIdRef.current) {
      setError("Bản nháp nội dung không còn khớp với bước đang chọn. Hãy mở lại bước trước khi chỉnh sửa.");
      return false;
    }
    const identity = selectedIdentity.planId
      ? selectedIdentity
      : { ...selectedIdentity, sessionId: draftTripIdRef.current };
    if (!identity.planId && storage.draft.candidateSessionId !== identity.sessionId) {
      storage = { ...storage, draft: { ...storage.draft, candidateSessionId: identity.sessionId } };
    }
    try {
      const nextWorkspaceDraft = {
        ...identity,
        notes: changes.notes ?? documentText,
        sources: changes.sources ?? sources,
        materials: changes.materials ?? materials,
        updatedAt: Date.now(),
      };
      const previousWorkspaceDraft = findStudyWorkspaceDraft(storage, identity);
      const savedStorage = saveStudyWorkspaceDraft(storage, nextWorkspaceDraft);
      const revokeSourceConsent = options.revokeSourceConsent ||
        studyWorkspaceSourceContentChanged(previousWorkspaceDraft, nextWorkspaceDraft);
      const nextStorage = revokeSourceConsent
        ? {
            ...savedStorage,
            draft: {
              ...savedStorage.draft,
              quizPrefetch: { ...savedStorage.draft.quizPrefetch, sourceConsent: false },
            },
          }
        : savedStorage;
      const saved = commit({ ...value, studyPlanStorage: nextStorage });
      if (!saved) return false;
      setError("");
      return true;
    } catch (error) {
      setError(error instanceof Error
        ? error.message
        : "Không lưu được nội dung buổi học trên thiết bị.");
      return false;
    }
  }
  function selectStudyPlanStep(stepId: string, targetPlanId?: string): boolean {
    const currentStorage = current.current.studyPlanStorage;
    if (!currentStorage || current.current.active || mode !== "solo") return false;
    let storage = currentStorage;
    const plan = currentStorage.plans.find((entry) => entry.id === (targetPlanId ?? currentStorage.draft.selectedPlanId));
    if (!plan) return false;
    const samePlan = plan.id === currentStorage.draft.selectedPlanId;
    const selectedStep = plan.steps.find((step) => step.id === stepId);
    if (!selectedStep) return false;
    const usedSessionIds = new Set([
      ...historySessions(current.current, ownerRef.current).map((session) => session.id),
      ...(current.current.guestExerciseSessions ?? []),
      ...removedSessionIds,
    ]);
    const candidateUsed = usedSessionIds.has(selectedStep.plannedSessionId);
    if (samePlan && plan.selectedStepId === stepId && !candidateUsed) return true;
    if (busy || materialRequest.current || studyGuideNeedsConfirmation) {
      setError("Hãy kết thúc thao tác nội dung đang mở trước khi đổi bước học.");
      return false;
    }
    const currentIdentity = selectedStudyWorkspaceIdentity(storage);
    if (currentIdentity.sessionId === draftTripIdRef.current) {
      try {
        storage = saveStudyWorkspaceDraft(storage, {
          ...currentIdentity,
          notes: documentText,
          sources,
          materials,
          updatedAt: Date.now(),
        });
      } catch {
        setError("Không thể lưu nội dung của bước hiện tại. Hãy kiểm tra dung lượng rồi thử lại.");
        return false;
      }
    }
    const plannedSessionId = candidateUsed
      ? crypto.randomUUID()
      : selectedStep.plannedSessionId;
    const nextPlan = {
      ...plan,
      selectedStepId: stepId,
      updatedAt: Date.now(),
      steps: plan.steps.map((step) => step.id === stepId ? { ...step, plannedSessionId } : step),
    };
    const nextGoal = samePlan ? storage.draft.goal : plan.goal;
    const nextTopicId = samePlan ? storage.draft.topicId : plan.topicId;
    const nextTopicLabel = samePlan ? storage.draft.topicLabel : plan.topicLabel;
    const nextLevel = samePlan ? storage.draft.level : plan.level;
    const nextStorage = {
      ...storage,
      draft: {
        ...storage.draft,
        goal: nextGoal,
        topicId: nextTopicId,
        topicLabel: nextTopicLabel,
        level: nextLevel,
        selectedPlanId: plan.id,
        selectedStepId: stepId,
        candidateSessionId: plannedSessionId,
        quizPrefetch: { ...storage.draft.quizPrefetch, sourceConsent: false },
      },
      plans: storage.plans.map((entry) => entry.id === plan.id ? nextPlan : entry),
    };
    const targetIdentity = { sessionId: plannedSessionId, planId: plan.id, stepId };
    const targetDraft = findStudyWorkspaceDraft(nextStorage, targetIdentity);
    if (!commit({
      ...current.current,
      studyPlanStorage: nextStorage,
    })) return false;
    updateQuickTripDraft(quickTripDraft, {
      goal: nextGoal,
      topic: nextTopicId,
      topicLabel: nextTopicLabel,
      level: nextLevel,
      selectedPlanId: plan.id,
      selectedStepId: stepId,
    });
    cancelPendingStudyExerciseForStart(draftTripId);
    invalidateStudyExercisePreparationForSession(draftTripId);
    setDraftTripId(plannedSessionId);
    draftSessionIdsRef.current.solo = plannedSessionId;
    setGoal(nextGoal);
    setTopic(nextTopicId);
    setDocumentText(targetDraft?.notes ?? "");
    setSources(structuredClone(targetDraft?.sources ?? []));
    setMaterials(structuredClone(targetDraft?.materials ?? []));
    originalFiles.current.clear();
    setError("");
    return true;
  }
  function focusRevisionSource(sourceId: string) {
    requestAnimationFrame(() => {
      const details = [...document.querySelectorAll<HTMLDetailsElement>("details[data-revision-source-id]")]
        .find((item) => item.dataset.revisionSourceId === sourceId);
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ behavior: "auto", block: "center" });
      details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    });
  }
  function focusRevisionNote(entryId: string) {
    requestAnimationFrame(() => {
      const panel = [...document.querySelectorAll<HTMLElement>("[data-revision-note-id]")]
        .find((item) => item.dataset.revisionNoteId === entryId);
      const field = panel?.querySelector<HTMLTextAreaElement>("textarea");
      if (!field) return;
      field.scrollIntoView({ behavior: "auto", block: "center" });
      field.focus({ preventScroll: true });
    });
  }
  function previewRevisionMaterial(entryId: string, trigger?: HTMLButtonElement) {
    const record = revisionMaterialRecords.find((item) => item.id === entryId);
    if (!record || removedSessionIds.includes(record.sessionId ?? "")) return;
    revisionPreviewReturnFocus.current = trigger ??
      (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    setRevisionPreviewId(entryId);
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".revision-material-preview");
      if (!panel) return;
      panel.scrollIntoView({ behavior: "auto", block: "start" });
      panel.querySelector<HTMLHeadingElement>("#revision-material-preview-title")?.focus({ preventScroll: true });
    });
  }
  function closeRevisionMaterialPreview() {
    setRevisionPreviewId(null);
    requestAnimationFrame(() => {
      const trigger = revisionPreviewReturnFocus.current;
      if (trigger?.isConnected) trigger.focus();
      else document.getElementById("revision-materials-library-title")?.focus();
      revisionPreviewReturnFocus.current = null;
    });
  }
  function useRevisionMaterialInPlan(entryId: string) {
    const record = revisionMaterialRecords.find((item) => item.id === entryId);
    if (!record || removedSessionIds.includes(record.sessionId ?? "") ||
        !record.source.reviewed || record.source.text.trim().length < 10) return;
    if (saved.active || mode !== "solo" || busy || tutorialActive || !loaded || !exclusive) {
      setError("Hãy mở một buổi học cá nhân đang được lưu để dùng tài liệu.");
      return;
    }
    const existing = sources.find((item) => item.id === record.source.id && draftTripId === record.sessionId);
    if (existing) {
      go("station");
      focusRevisionSource(JSON.stringify([draftTripId, existing.id]));
      return;
    }
    if (record.kind === "note" && draftTripId === record.sessionId) {
      setStudyInput("notes");
      go("station");
      focusRevisionNote(record.id);
      return;
    }
    const copiedSource = { ...record.source, id: crypto.randomUUID() };
    const appendCheck = validateStudyGuideAppend(sources, materials, copiedSource);
    if (!appendCheck.ok) {
      setError(appendCheck.message);
      setNotice("");
      return;
    }
    const copiedMaterial: MaterialInfo = {
      sourceId: copiedSource.id,
      name: copiedSource.name,
      size: record.material?.size ?? new TextEncoder().encode(copiedSource.text).length,
      type: record.material?.type ?? "text/plain",
      status: record.material?.status ?? "extracted",
      message: record.material?.message ?? "Nguồn đã được kiểm tra trong thư viện.",
    };
    const nextSources = [...sources, copiedSource];
    const nextMaterials = [...materials, copiedMaterial];
    if (!persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials }, { revokeSourceConsent: true })) return;
    setSources(nextSources);
    setMaterials(nextMaterials);
    setStudyInput("files");
    go("station");
    setError("");
    setNotice("Đã thêm bản sao riêng của tài liệu vào buổi học. Hãy xem lại nguồn trước khi gửi cho AI.");
    focusRevisionSource(JSON.stringify([draftTripId, copiedSource.id]));
  }
  function openWorkspaceSourceMode(mode: "notes" | "files" | "ai") {
    if (saved.active) {
      go("focus");
      return;
    }
    setStudyInput(mode);
    go("station");
  }
  function persistQuickTripStudyDraft(changes: Partial<QuickTripDraft>) {
    const draft = "minutes" in changes
      ? updateQuickTripDuration(quickTripDraft, changes.minutes!).draft
      : updateQuickTripDraft(quickTripDraft, changes);
    const storage = current.current.studyPlanStorage ?? createStudyPlanStorage();
    const topicLabel = availableTopics.find((item) => item.id === draft.topic)?.name ?? draft.topicLabel ?? draft.topic;
    const studyDraft = updateStudyPlanDraftFromQuickTrip(storage.draft, draft, topicLabel);
    setGoal(draft.goal);
    setTopic(draft.topic);
    setMinutes(draft.minutes);
    if (isValidStudyMinutes(draft.minutes)) {
      updateLearningPathPlan(draft.minutes * 60);
    }
    setBreakCount(draft.breakCount);
    setBreakMinutes(draft.breakMinutes);
    commit({ ...current.current, studyPlanStorage: { ...storage, draft: studyDraft } });
  }
  function updateQuizPrefetchPreference(changes: Partial<{ enabled: boolean; sourceConsent: boolean }>) {
    const storage = current.current.studyPlanStorage ?? createStudyPlanStorage();
    const quizPrefetch = { ...storage.draft.quizPrefetch, ...changes };
    if (!quizPrefetch.enabled) quizPrefetch.sourceConsent = false;
    commit({
      ...current.current,
      studyPlanStorage: { ...storage, draft: { ...storage.draft, quizPrefetch } },
    });
  }
  function recordStudyTutorialRetrievalChoice() {
    const progress = current.current.studyPlanStorage?.onboarding;
    if (!progress) return;
    const nextProgress = completeStudyOnboardingRetrievalChoice(progress);
    if (nextProgress !== progress) saveStudyOnboardingProgress(nextProgress);
  }
  function focusStudyTutorialControl(control: "goal" | "source" | "duration" | "retrieval"): boolean {
    const selector = control === "goal" ? "#study-workspace-goal"
      : control === "duration" ? ".departure-settings .custom-duration input"
        : control === "source" ? ".departure-source-panel:not([hidden]) .study-notes-input textarea"
        : ".quiz-review-preference input:not(:disabled), .quiz-review-preference button:not(:disabled)";
    const target = document.querySelector<HTMLElement>(selector);
    if (!target || target.closest("[hidden]") || target.getAttribute("aria-disabled") === "true" ||
        ("disabled" in target && Boolean(target.disabled)) || target.getClientRects().length === 0) return false;
    target?.scrollIntoView({ behavior: "auto", block: "center" });
    target?.focus({ preventScroll: true });
    return true;
  }
  function chooseStudyTutorialSource(choice: "notes" | "files" | "none") {
    const mode = choice === "files" ? "files" : "notes";
    setStudyInput(mode);
    if (choice === "none") return;
    requestAnimationFrame(() => {
      const selector = choice === "files"
        ? ".departure-source-panel:not([hidden]) input[type=file]"
        : ".departure-source-panel:not([hidden]) .study-notes-input textarea";
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "auto", block: "center" });
      target?.focus({ preventScroll: true });
    });
  }
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
          <span className="brand-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 27V6l11 11L27 6v21" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 22h12" stroke="#8fc09a" strokeWidth="2" strokeLinecap="round"/></svg></span>
          <span>
            viễn du<small>HỌC TẬP · KHÁM PHÁ</small>
          </span>
        </a>
          <div className="nav-heading">KHÔNG GIAN CỦA BẠN</div>
        <nav aria-label="Điều hướng chính">
          {nav.map((n) => {
            return (
              <button
                key={n.id}
                className={view === n.id ? "nav active" : "nav"}
                data-mobile-label={n.mobileLabel}
                aria-current={view === n.id ? "page" : undefined}
                aria-label={n.label}
                onClick={() => go(n.id)}
              >
                <span aria-hidden="true">{n.icon}</span>
                {n.label}
                {n.id === "station" && <i />}
              </button>
            );
          })}
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
                    lesson: "Bài học",
                    map: "Bản đồ hành trình",
                    carriage: "Toa của tôi",
                    ticket: "Chuẩn bị",
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
          {guestNotice && guestNoticeStatus && (
            <div
              className={guestNoticeStatus.status === "suppression-failed" ? "message error" : "message"}
              role={guestNoticeStatus.status === "suppression-failed" ? "alert" : "status"}
            >
              {guestNotice}
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
          ) : canShowStudyOnboarding(loaded, saved.active, saved.studyPlanStorage?.onboarding) &&
            saved.studyPlanStorage?.onboarding.phase !== "tutorial" ? (
            <StudyOnboarding
              progress={saved.studyPlanStorage?.onboarding ?? createStudyPlanStorage().onboarding}
              topics={availableTopics}
              onProgressChange={saveStudyOnboardingProgress}
            />
          ) : (
            <>
              {canShowStudyOnboarding(loaded, saved.active, saved.studyPlanStorage?.onboarding) &&
                saved.studyPlanStorage?.onboarding.phase === "tutorial" && (
                  <StudyOnboarding
                    progress={saved.studyPlanStorage.onboarding}
                    currentDraft={{
                      goal,
                      topicId: topic,
                      topicLabel: ticketTopicName,
                      preferredMinutes: studyPlanStorage.draft.preferredMinutes,
                      level: studyPlanStorage.draft.level,
                      confidence: studyPlanStorage.draft.confidence,
                    }}
                    currentDuration={minutes}
                    topics={availableTopics}
                    onProgressChange={saveStudyOnboardingProgress}
                    onGuideControl={focusStudyTutorialControl}
                    onSourceChoice={chooseStudyTutorialSource}
                  />
                )}
              {view === "lesson" && (selectedPathLesson ? (
                <LearningPathLessonDetail
                  course={learningPathCourse}
                  lesson={selectedPathLesson}
                  status={selectedPathLessonState}
                  active={learningPathProgress.activeRun?.lessonId === selectedPathLesson.id &&
                    learningPathProgress.activeRun.lessonVersion === selectedPathLesson.version}
                  replay={selectedPathLessonState === "completed"}
                  difficulty={learningDifficulty}
                  duration={learningDuration}
                  onBack={() => go("station")}
                  onStart={(minutesValue) => startLearningLesson(selectedPathLesson, minutesValue)}
                  onResume={resumeLearningPathRun}
                />
              ) : (
                <Empty title="Bài học không còn trong lộ trình" text="Tiến độ cũ vẫn được giữ trong nhật ký. Hãy chọn một bài hiện có để tiếp tục." action="Mở lộ trình" onClick={() => go("station")} />
              ))}
              {(view === "station" || view === "ticket") && (
                <>
                  {!saved.active && saved.studyPlanStorage?.onboarding.phase === "complete" && (
                    <button className="study-onboarding-reopen" type="button" onClick={reopenStudyOnboarding}>
                      Mở lại hướng dẫn
                    </button>
                  )}
                  <StudyPlanWorkspace
                    goal={goal}
                    subject={ticketTopicName}
                    preferredMinutes={minutes}
                    breakCount={breakCount}
                    breakMinutes={breakMinutes}
                    plan={selectedStudyPlan}
                    planStatus={studyPlanStatus}
                    planError={studyPlanError}
                    planActionReason={studyPlanAccessReason}
                    onGeneratePlan={requestStudyPlanFromWorkspace}
                    onCancelPlan={cancelStudyPlanRequest}
                    onSelectStep={selectStudyPlanStep}
                    onSaveStep={saveStudyPlanStep}
                    sourceAvailable={hasStudyPlanSource}
                    sourceReviewed={Boolean(sourceForStudyPlan?.reviewed)}
                    includeSource={includeStudyPlanSource}
                    onIncludeSourceChange={setIncludeStudyPlanSource}
                    legacyDetails={<BoardingTicket
                      goal={goal}
                      topicName={ticketTopicName}
                      minutes={minutes}
                      breakCount={breakCount}
                      breakMinutes={breakMinutes}
                      station={stations[journey?.station ?? 0]}
                      branch={journey?.branch}
                      carriageName={carriage?.name ?? "Toa Mây"}
                      mode={mode}
                      synchronizedTrip={isSynchronizedTrip(selectedGroupTrip)}
                      tripCode={ticketCode?.id === ticketId ? ticketCode.value : undefined}
                    />}
                  >
                  <div className="boarding-preparation">
                    <section className="panel form departure-materials">
                      <div className="eyebrow">HÀNH TRANG HỌC TẬP</div>
                      <h2>Nội dung ôn tập</h2>
                      <p className="departure-intro">Dán nội dung đã có, chọn tệp hoặc nhờ AI soạn bản ôn tập theo mục tiêu buổi học.</p>
                      <div className="departure-source-options" role="group" aria-label="Chọn cách chuẩn bị nội dung">
                        <button disabled={busy || !!active || studyGuideNeedsConfirmation || privateTripDraftLocked} aria-pressed={studyInput === "notes"} onClick={() => setStudyInput("notes")}>Dán nội dung</button>
                        <button disabled={busy || !!active || studyGuideNeedsConfirmation || privateTripDraftLocked} aria-pressed={studyInput === "files"} onClick={() => setStudyInput("files")}>Tải tài liệu</button>
                        <button disabled={busy || !!active || privateTripDraftLocked} aria-pressed={studyInput === "ai"} onClick={() => setStudyInput("ai")}>Nhờ AI soạn</button>
                      </div>
                      <div className="departure-source-panel" hidden={studyInput !== "ai"}>
                        <StudyGuideComposer
                          disabled={busy || !!active || tutorialActive || privateTripDraftLocked} canGenerate={owner === "guest" ? online && !authOffline : Boolean(user && !needsLogin && online)}
                          unavailableReason={!online || authOffline ? "Kết nối mạng để tạo bản ôn tập bằng AI." : owner === "guest" ? "Nội dung gửi AI được giữ riêng trong phiên khách." : "Đăng nhập để tạo bản ôn tập bằng API Google AI Studio."}
                          review={studyGuideReview} onReviewAction={dispatchStudyGuideReview}
                          onGenerate={generateStudyGuide} onCancel={() => materialRequest.current?.abort()} onUse={acceptStudyGuide}
                          onDiscard={discardStudyGuideDraft} onDownload={downloadStudyGuide}
                          hasExistingContent={Boolean(materials.length || sources.length || documentText.trim())}
                        />
                      </div>
                      <div className="departure-source-panel" data-revision-note-id={JSON.stringify([draftTripId, "notes"])} hidden={studyInput !== "notes"}>
                        <StudyNotesInput value={documentText} onChange={(text) => {
                          if (!persistStudyWorkspaceDraft({ notes: text })) return;
                          setDocumentText(text);
                        }} disabled={busy || !!active || studyGuideNeedsConfirmation || privateTripDraftLocked} hasDocuments={Boolean(materials.length || sources.length)} />
                      </div>
                      <div className="departure-source-panel" hidden={studyInput !== "files"}>
                      <h3 className="material-title">Tài liệu học tập</h3>
                      <label className="material-ai-option">
                          <input type="checkbox" checked={preferAiReading} disabled={busy || !!active || tutorialActive || studyGuideNeedsConfirmation || privateTripDraftLocked} onChange={(e) => setPreferAiReading(e.target.checked)} aria-describedby="material-ai-help" />
                        <span>Ưu tiên dùng AI để đọc PDF/ảnh</span>
                      </label>
                      <p id="material-ai-help" className="material-hint">Thông thường, ứng dụng đọc chữ trên thiết bị. Với ảnh/PDF khó đọc, AI dùng chính API Google AI Studio (Gemini) đã tích hợp. Tệp chỉ được gửi khi bạn bấm “Đọc bằng AI”; phiên khách không cần tài khoản.</p>
                      <label className="file-label">
                        Chọn tệp tài liệu
                        <input
                          type="file"
                          multiple
                          disabled={busy || !!active || studyGuideNeedsConfirmation || privateTripDraftLocked}
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
                      {sources.map((source) => {
                        const targetView = view as "station" | "ticket";
                        const fingerprintState = materialSummaryFingerprints[JSON.stringify([draftTripId, source.id])];
                        const sourceFingerprint = fingerprintState?.text === source.text ? fingerprintState.fingerprint : "";
                        const ui = materialSummaryUi?.ownerId === owner && materialSummaryUi.view === targetView &&
                          materialSummaryUi.sessionId === draftTripId && materialSummaryUi.sourceId === source.id &&
                          materialSummaryUi.planId === (studyPlanContext.current.selectedPlanId ?? null) &&
                          materialSummaryUi.stepId === (studyPlanContext.current.selectedStepId ?? null)
                          ? materialSummaryUi
                          : null;
                        const cachedSummary = sourceFingerprint
                          ? cachedMaterialSummary(saved, draftTripId, source, sourceFingerprint)
                          : undefined;
                        const summaryText = source.reviewed
                          ? cachedSummary ?? (ui?.status === "ready" && ui.sourceFingerprint === sourceFingerprint ? ui.summary : undefined)
                          : undefined;
                        const summaryError = ui?.status === "failed" && ui.sourceFingerprint === sourceFingerprint
                          ? ui.error
                          : "";
                        const canGenerateSummary = canGeneratePrivateMaterialSummary(targetView, source);
                        return <details className="material-source" key={source.id} data-revision-source-id={JSON.stringify([draftTripId, source.id])} open={!source.reviewed}>
                        <summary>{source.name} · {source.reviewed ? "Đã kiểm tra" : "Cần kiểm tra nội dung"}</summary>
                        <MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} illustrations={source.illustrations} disabled={busy || !!active || privateTripDraftLocked} maxLength={source.source === "ai-generated" ? 20000 : 50000} textareaLabel={`Nội dung nguồn · ${source.name}`} placeholder="Nhập hoặc sửa bản chép đúng của tài liệu. Không tự dịch nội dung." onChange={(text) => {
                          const nextSources = sources.map((item) => item.id === source.id ? editMaterialSourceText(item, text) : item);
                          if (!persistStudyWorkspaceDraft({ sources: nextSources })) return;
                          noteStudyExerciseSourceChange(draftTripId, source.id);
                          setSources(nextSources);
                        }} />
                        <div className="choice-row">
                          <MaterialSourceReviewButton disabled={busy || !!active || privateTripDraftLocked || source.text.trim().length < 10} onClick={() => {
                            try {
                              const reviewed = reviewMaterialSource(source, source.text);
                              const nextSources = sources.map((item) => item.id === source.id ? reviewed : item);
                              if (!persistStudyWorkspaceDraft({ sources: nextSources })) return;
                              noteStudyExerciseSourceChange(draftTripId, source.id);
                              setSources(nextSources);
                              setError("");
                            } catch(e) { setError(e instanceof Error ? e.message : "Không xác nhận được tài liệu."); }
                          }} />
                          {source.source !== "ai-generated" && <button disabled={busy || !!active || tutorialActive || privateTripDraftLocked || !originalFiles.current.has(source.id) || !/\.(pdf|png|jpe?g|webp)$/i.test(source.name)} onClick={() => void readHandwriting(source.id)}>Đọc bằng AI · gửi tệp này</button>}
                          {source.source === "ai-generated" && <button disabled={busy || privateTripDraftLocked} onClick={() => downloadStudyGuide({title:source.name.replace(/\.txt$/i, ""),text:source.text})}>Tải bản ôn tập (.txt)</button>}
                          <button disabled={busy || !!active || privateTripDraftLocked} onClick={() => {
                            const nextSources = sources.filter((item) => item.id !== source.id);
                            const nextMaterials = materials.filter((file) => source.covers ? !source.covers.includes(file.name) : file.sourceId !== source.id);
                            if (!persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })) return;
                            originalFiles.current.delete(source.id);
                            noteStudyExerciseSourceChange(draftTripId, source.id);
                            setSources(nextSources);
                            setMaterials(nextMaterials);
                          }}>Gỡ tài liệu</button>
                        </div>
                        {source.source !== "ai-generated" && !originalFiles.current.has(source.id) && <small>Muốn đọc lại bằng AI, hãy nhập lại tệp gốc.</small>}
                        <MaterialSummaryControl
                          source={source}
                          summary={summaryText}
                          pending={ui?.status === "pending"}
                          error={summaryError}
                          canGenerate={canGenerateSummary}
                          disabledReason={!canGenerateSummary ? privateMaterialSummaryUnavailableReason(targetView) : ""}
                          onGenerate={() => void generateMaterialSummary(draftTripId, source.id, targetView)}
                          onCancel={() => cancelMaterialSummaryRequest(draftTripId, source.id)}
                        />
                      </details>;
                      })}
                      {!!materials.length && <ul className="material-list" aria-label="Tài liệu đã chọn">{materials.map((file, i) => <li key={`${i}:${file.name}`}>
                        <strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · {file.message}</span>
                      </li>)}</ul>}
                      {!active && <StudyExercisePreparationEditor
                        key={`${owner}:${draftTripId}`}
                        plannedSessionId={draftTripId}
                        authenticated={owner === "guest" || (!!user && !needsLogin)}
                        sources={sources}
                        preparation={studyExercisePreparation?.plannedSessionId === draftTripId ? studyExercisePreparation : null}
                        disabled={busy || tutorialActive || privateTripDraftLocked || !online || authOffline || !loaded || !exclusive}
                        onPrepare={onPrepareStudyExercises}
                        onPreparationChange={setStudyExercisePreparation}
                        onInvalidate={onInvalidateStudyExercises}
                      />}
                    </section>
                    <section className="panel form departure-settings">
                      <div className="eyebrow">LỘ TRÌNH CỦA BẠN</div>
                      <h2>Thiết lập buổi học</h2>
                      <StudyWorkspaceSettings
                        goal={goal}
                        topic={topic}
                        topics={availableTopics}
                        fallbackTopic={selectedGroupTrip && "topic" in selectedGroupTrip ? selectedGroupTrip.topic : undefined}
                        minutes={minutes}
                        breakCount={breakCount}
                        breakMinutes={breakMinutes}
                        goalDisabled={busy || studyGuideNeedsConfirmation || tripPlanFieldsLocked}
                        topicDisabled={busy || studyGuideNeedsConfirmation || tripPlanFieldsLocked}
                        durationLocked={Boolean(selectedGroupTrip)}
                        breaksLocked={isSynchronizedTrip(selectedGroupTrip)}
                        legacyDisclosure={view === "ticket"}
                        legacyInitiallyOpen={goal.trim().length < 3 || !Number.isInteger(minutes) || minutes < 1 || minutes > 240 || !validBreaks}
                        onGoalChange={(value) => persistQuickTripStudyDraft({ goal: value })}
                        onTopicChange={(value) => persistQuickTripStudyDraft({ topic: value })}
                        onDurationChange={(value) => persistQuickTripStudyDraft({ minutes: value })}
                        onBreakCountChange={(value) => {
                          if (!selectedGroupTrip) persistQuickTripStudyDraft({ breakCount: value });
                          else setBreakCount(value);
                          updateLearningPathPlan(minutes * 60, value, breakMinutes);
                        }}
                        onBreakMinutesChange={(value) => {
                          if (!selectedGroupTrip) persistQuickTripStudyDraft({ breakMinutes: value });
                          else setBreakMinutes(value);
                          updateLearningPathPlan(minutes * 60, breakCount, value);
                        }}
                      />
                      <QuizReviewPreference
                        count={quizCount}
                        skipped={skipQuizReview}
                        disabled={busy || privateTripDraftLocked}
                        onCountChange={(value) => { setQuizCount(value); recordStudyTutorialRetrievalChoice(); }}
                        onToggleSkip={() => { setSkipQuizReview((value) => !value); recordStudyTutorialRetrievalChoice(); }}
                        prefetchEnabled={quizPrefetchSettings.enabled}
                        sourcePresent={hasStudyPlanSource}
                        sourceReviewed={Boolean(sourceForStudyPlan?.reviewed)}
                        sourceConsent={quizPrefetchSettings.sourceConsent}
                        onPrefetchChange={(enabled) => { updateQuizPrefetchPreference({ enabled }); recordStudyTutorialRetrievalChoice(); }}
                        onSourceConsentChange={(sourceConsent) => { updateQuizPrefetchPreference({ sourceConsent }); recordStudyTutorialRetrievalChoice(); }}
                      />
                      <p className="material-hint">Mục tiêu có thể xuất hiện trong lịch sử phiên học. Tránh ghi thông tin riêng tư vào mục tiêu.</p>
                      <button
                        className="primary"
                        disabled={
                          busy || studyGuideNeedsConfirmation || !!active || tutorialActive || goal.trim().length < 3 ||
                          !isValidStudyMinutes(minutes) || !validBreaks ||
                          !canStartSessionWithQuizReview(quizCount, skipQuizReview) || !exclusive
                        }
                        onClick={() => start()}
                      >
                        Bắt đầu buổi học · {Number.isFinite(minutes) ? minutes : "…"} phút →
                      </button>
                      {studyExerciseStartPrompt && pendingStudyExercise?.ownerId === owner &&
                        pendingStudyExercise.plannedSessionId === draftTripId && <div className="info-box study-exercise-start-prompt" role="group" aria-label="Bài tập đang được tạo">
                          <p>AI vẫn đang tạo đề. Bạn có thể hủy lần bắt đầu này để chờ, hoặc bỏ qua bài tập và bắt đầu phiên học ngay.</p>
                          <div className="choice-row">
                            <button type="button" onClick={() => setStudyExerciseStartPrompt(false)}>Hủy và chờ đề</button>
                            <button type="button" className="primary" onClick={() => start(true)}>Bỏ qua bài tập và bắt đầu phiên học</button>
                          </div>
                        </div>}
                      {studyGuideNeedsConfirmation && <p className="material-hint" role="status">Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi bắt đầu chuyến.</p>}
                      {active && (
                        <button onClick={() => go("focus")}>
                          Tiếp tục phiên đang mở
                        </button>
                      )}
                      <details className="info-box trip-rules">
                        <summary>Quy tắc chuyến đi & dữ liệu lịch sử</summary>
                        <p>Phiên đã lưu tự động xuất hiện trong lịch sử chung; tóm tắt mục tiêu tối đa 200 ký tự được hiển thị. Tránh ghi thông tin riêng tư vào mục tiêu. Lịch sử không gửi email, mã tài khoản, tài liệu hay câu trả lời chi tiết thành các trường riêng.</p>
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
                  </StudyPlanWorkspace>
                </>
              )}
              {view === "focus" &&
                (active ? (
                  <>
                    {studyFullscreen.restorePrompt && (
                      <FocusFullscreenRecovery
                        status={studyFullscreen.status}
                        message={studyFullscreen.message}
                        onRequest={studyFullscreen.request}
                        onDismiss={studyFullscreen.dismissRestorePrompt}
                      />
                    )}
                    {studyFullscreen.initialPrompt && (
                      <FocusFullscreenRecovery
                        variant="initial"
                        status={studyFullscreen.status}
                        message={studyFullscreen.message}
                        onRequest={studyFullscreen.request}
                        onDismiss={studyFullscreen.dismissInitialPrompt}
                        returnFocusRef={fullscreenContinueRef}
                      />
                    )}
                    <section className="focus-card quiet-focus-shell">
                      <QuietFocusCanvas
                        goal={active.goal}
                        clockSeconds={rest ? rest.remainingSeconds : studyStage?.remainingSeconds ?? active.target - elapsedSeconds(active, displayAt)}
                        clockLabel={rest ? "Giải lao còn lại" : "Lượt học còn lại"}
                        motionAllowed={active.state === "focus" || active.state === "reconnecting"}
                        status={
                          <>
                            <p className="focus-phase-label">
                              {rest ? `Nghỉ giải lao ${rest.index}/${rest.count}` : `Lượt học ${(studyStage?.index ?? 0) + 1}/${studyStage?.count ?? 1}`}
                            </p>
                            <p className="focus-next">
                              {rest
                                ? `Tự tiếp tục lượt học ${rest.index + 1}/${rest.count + 1} lúc ${new Date(rest.endsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                                : studyStage && studyStage.index < studyStage.count - 1
                                  ? `Tiếp theo: nghỉ ${clock(active.breakPlan?.seconds ?? 0)}`
                                  : "Lượt cuối · phiên học hoàn tất khi đồng hồ về 00:00"}
                            </p>
                            {active.breakPlan && active.breakPlan.count > 0 && <p className="focus-plan-total">
                              {active.target / 60} phút học + {active.breakPlan.count * active.breakPlan.seconds / 60} phút nghỉ · tổng thời lượng {totalDuration(active) / 60} phút
                            </p>}
                          </>
                        }
                        warnings={deviceClockBehind || (active.syncClock && !synchronizedClockSupported) || studyExerciseFocusAvailabilityMessage
                          ? <>
                            {deviceClockBehind && <div className="info-box">
                              <p>Đồng hồ thiết bị đang chạy lùi. Hãy đặt lại giờ đúng để tiếp tục; dữ liệu phiên vẫn được giữ.</p>
                              <button onClick={exportData}>Xuất bản sao phiên học</button>
                            </div>}
                            {active.syncClock && !synchronizedClockSupported && <div className="info-box" role="status">
                              <p>{clockSkewUnsupported
                                ? "Đồng hồ thiết bị lệch quá 24 giờ so với máy chủ. Bật đặt ngày và giờ tự động, rồi đồng bộ để tiếp tục tính thời gian."
                                : "Đang chờ mẫu giờ mới từ máy chủ. Thời gian học sẽ tiếp tục sau khi đồng hồ được xác nhận."}</p>
                              <button disabled={!online || busy} onClick={() => void run(sync)}>Cập nhật tiến độ</button>
                            </div>}
                            {studyExerciseFocusAvailabilityMessage && <p className="study-exercises__error" role="alert">{studyExerciseFocusAvailabilityMessage}</p>}
                          </>
                          : undefined}
                        essentialControls={
                          <div className="focus-controls">
                            <ThemeToggle />
                            <div className="study-fullscreen-control">
                              <button ref={fullscreenContinueRef} type="button" onClick={studyFullscreen.toggle} aria-pressed={studyFullscreen.isFullscreen} disabled={studyFullscreen.status === "pending" && !studyFullscreen.isFullscreen}>
                                {studyFullscreen.isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
                              </button>
                              {studyFullscreen.message && !studyFullscreen.restorePrompt && <span className="study-fullscreen-status" role="status">{studyFullscreen.message}</span>}
                            </div>
                            <button disabled={deviceClockBehind} onClick={() => setConfirm("finish")}>
                              Kết thúc và lưu phiên
                            </button>
                          </div>
                        }
                        materials={active.document || active.sources?.length || active.materials?.length || studyExercisePreparation?.plannedSessionId === active.id
                          ? <>
                            {studyExercisePreparation?.plannedSessionId === active.id &&
                              <StudyExerciseQuestionViewer preparation={studyExercisePreparation} phase="focus" />}
                            {active.document && <details className="panel study-notes">
                              <summary>Tài liệu của bạn · đọc ngay tại đây</summary>
                              <MaterialSourceReader title="Nội dung ôn tập" text={active.document} />
                            </details>}
                            {active.sources?.map((source) => <details className="panel study-notes" key={source.id}>
                              <summary>Nguồn tài liệu · {source.name}{!source.reviewed && " · chưa kiểm tra"}</summary>
                              <MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} illustrations={source.illustrations} />
                            </details>)}
                            {!!active.materials?.length && <div className="panel material-list" aria-label="Tệp của phiên học">
                              {active.materials.map((file, i) => <p key={`${i}:${file.name}`}><strong>{file.name}</strong> · {file.message}</p>)}
                            </div>}
                          </>
                          : undefined}
                        details={
                          <>
                            {ticketCode?.id === active.id && <p className="focus-plan-total">Mã phiên {ticketCode.value}</p>}
                            <FocusStudyCompanion
                              state={active.state}
                              resting={Boolean(rest)}
                              focusedSeconds={focused(active)}
                              targetSeconds={active.target}
                              distractions={active.distractions ?? 0}
                            />
                            {active.groupId && <p className="overhead-hint">Tiến độ nhóm cập nhật sau khi máy chủ xác nhận thời gian học của từng người.</p>}
                          </>
                        }
                      />
                    </section>
                  </>
                ) : (
                  <Empty
                    title="Chưa có chuyến đang chạy"
                    text="Đặt mục tiêu, chọn nội dung và thời lượng để tiếp tục."
                    action="Chuẩn bị buổi học"
                    onClick={() => { selectSoloMode(); go("station"); }}
                  />
                ))}
              {view === "map" && (
                <>
                  <Heading
                    kicker="BẢN ĐỒ KHÁM PHÁ"
                    title="Theo dấu bình minh"
                    text="Năm trạm dừng. Vô vàn điều nhỏ bé để khám phá."
                  />
                  <JourneyView
                    journey={journey}
                    carriages={trainCars}
                    ownId={owner}
                    draftSeconds={mapActive ? focused(mapActive) : 0}
                    targetSeconds={mapActive?.target}
                  />
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
              {view === "library" && <>
                <RevisionMaterialsLibrary
                  entries={revisionMaterialEntries}
                  onPreview={previewRevisionMaterial}
                  onUseInPlan={useRevisionMaterialInPlan}
                  onAddNotes={() => openWorkspaceSourceMode("notes")}
                  onAddFiles={() => openWorkspaceSourceMode("files")}
                  onComposeWithAI={() => openWorkspaceSourceMode("ai")}
                />
                {selectedRevisionMaterial && <section className="revision-material-preview" aria-labelledby="revision-material-preview-title">
                  <header className="revision-material-preview__header">
                    <div>
                      <p className="revision-material-preview__eyebrow">Bản xem trước · {selectedRevisionMaterialEntry?.sourceLabel ?? "Tài liệu ôn tập"}</p>
                      <h2 id="revision-material-preview-title" tabIndex={-1}>{selectedRevisionMaterial.source.name}</h2>
                    </div>
                    <button type="button" onClick={closeRevisionMaterialPreview}>Đóng bản xem trước</button>
                  </header>
                  <MaterialSourceReader
                    title={selectedRevisionMaterial.source.name}
                    text={selectedRevisionMaterial.source.text}
                    aiGenerated={selectedRevisionMaterial.source.source === "ai-generated"}
                    illustrations={selectedRevisionMaterial.source.illustrations}
                  />
                </section>}
              </>}
              {view === "journal" && (
                <>
                  <StudyJournal
                    entries={studyJournalEntries}
                    onOpenSession={(id) => {
                      const session = sessions.find((item) => item.id === id && item.userId === owner);
                      if (!session) return;
                      setSummary(session);
                      commitRef.current({ ...current.current, summarySessionId: session.id });
                      go("summary");
                    }}
                  />
                  <button onClick={exportData}>
                    Xuất bản sao dữ liệu riêng
                  </button>
                </>
              )}
              {view === "experiments" && <ExperimentResults />}
              {view === "report" && <PublicReport />}
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
                      title="Phiên học đã được lưu."
                      text={summarySession.goal}
                    />
                    {summaryCuratedEvaluation ? (
                      <CuratedEvaluationReceipt evaluation={summaryCuratedEvaluation} />
                    ) : summaryLearningLesson && summaryLearningCourse && summaryLearningRun ? (
                      <CuratedEvaluation
                        lesson={summaryLearningLesson}
                        conceptId={summaryLearningCourse.conceptId}
                        onSubmit={(score, total, answers) => completeCuratedEvaluation(summarySession.id, score, total, answers)}
                      />
                    ) : summaryInterruptedLesson ? (
                      <LearningPathRetryNotice
                        lessonTitle={summaryInterruptedLesson.lesson.title}
                        onRetry={() => openLearningLesson(summaryInterruptedLesson.lesson)}
                      />
                    ) : null}
                    <SessionSummaryCompanion
                      completed={summaryCompleted}
                      focusedSeconds={summaryAnalysis!.focusedSeconds}
                    />
                    <SessionCorrectionNotice
                      correctionFlags={summarySession.correctionFlags}
                      recordedEnd={date(summarySession.ended)}
                    />
                    <div className="stat-row summary-stats">
                      <Stat
                        icon="◷"
                        label="THỜI GIAN TẬP TRUNG"
                        value={clock(summaryAnalysis!.focusedSeconds)}
                        detail="Đã loại khoảng xao nhãng"
                      />
                      <Stat
                        icon="✦"
                        label="NỖ LỰC HỌC"
                        value={`${Math.floor(summaryAnalysis!.focusedSeconds / 60)} XP`}
                        detail="XP ghi nhận thời gian tập trung, không đo mức độ thành thạo"
                      />
                      <Stat
                        icon="↗"
                        label="SỐ LẦN XAO NHÃNG"
                        value={`${summaryAnalysis!.distractions}`}
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
                      <h2>Ôn tập phiên học</h2>
                      {!!saved.materials?.[summarySession.id]?.length && <details className="material-history"><summary>Tài liệu của phiên · {saved.materials[summarySession.id].length} tệp</summary><ul className="material-list">{saved.materials[summarySession.id].map((file, i) => <li key={`${i}:${file.name}`}><strong>{file.name}</strong><span>{file.message}</span></li>)}</ul></details>}
                      {!!saved.notes[summarySession.id]?.trim() && <details className="material-source" data-revision-source-id={JSON.stringify([summarySession.id, "notes"])}>
                        <summary>Ghi chú buổi học</summary>
                        <div className="material-source__notes">{saved.notes[summarySession.id]}</div>
                      </details>}
                      <p>
                        Bạn có thể xem lại câu hỏi và tài liệu. Phần học của bạn đã được lưu.
                      </p>
                      {!!saved.materials?.[summarySession.id]?.length && !saved.sources?.[summarySession.id]?.length && <div className="info-box"><p>Tài liệu này được lưu bằng phiên bản cũ. Khôi phục bản chép đã lưu hoặc dán nội dung đúng, rồi xác nhận làm nguồn câu hỏi.</p><button onClick={() => {const value = current.current;if(value.summarySessionId !== summarySession.id) return;invalidateQuizForSourceEdit(owner, summarySession.id);commitRef.current({...value,sources:{...value.sources,[summarySession.id]:[recoveredMaterialSource(value.notes[summarySession.id] ?? "",value.materials?.[summarySession.id] ?? [])]},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});}}>Khôi phục / nhập bản chép tài liệu cũ</button></div>}
                      {(saved.sources?.[summarySession.id] ?? []).map((source) => {
                        const fingerprintKey = JSON.stringify([summarySession.id, source.id]);
                        const fingerprintState = materialSummaryFingerprints[fingerprintKey];
                        const sourceFingerprint = fingerprintState?.text === source.text ? fingerprintState.fingerprint : "";
                        const ui = materialSummaryUi?.ownerId === owner && materialSummaryUi.view === "summary" &&
                          materialSummaryUi.sessionId === summarySession.id && materialSummaryUi.sourceId === source.id
                          ? materialSummaryUi
                          : null;
                        const cachedSummary = sourceFingerprint
                          ? cachedMaterialSummary(saved, summarySession.id, source, sourceFingerprint)
                          : undefined;
                        const summaryText = source.reviewed
                          ? cachedSummary ?? (ui?.status === "ready" && ui.sourceFingerprint === sourceFingerprint ? ui.summary : undefined)
                          : undefined;
                        const summaryError = ui?.status === "failed" && ui.sourceFingerprint === sourceFingerprint
                          ? ui.error
                          : "";
                        const canGenerateSummary = canGeneratePrivateMaterialSummary("summary", source);
                        const summaryUnavailableReason = !canGenerateSummary
                          ? privateMaterialSummaryUnavailableReason("summary")
                          : owner === "guest" ? "Tóm tắt được lưu riêng trên thiết bị này." : "";
                        return <details className="material-source" key={source.id} data-revision-source-id={JSON.stringify([summarySession.id, source.id])} open={!source.reviewed}>
                          <summary>Nguồn câu hỏi · {source.name} · {source.reviewed ? "Đã kiểm tra" : "Cần kiểm tra"}</summary>
                          <MaterialSourceReader title={source.name} text={source.text} aiGenerated={source.source === "ai-generated"} illustrations={source.illustrations} textareaLabel="Bản chép tài liệu" onChange={(text) => {
                            const value = current.current;
                            if(value.summarySessionId !== summarySession.id) return;
                            cancelMaterialSummaryRequest(summarySession.id, source.id);
                            noteStudyExerciseSourceChange(summarySession.id, source.id);
                            invalidateQuizForSourceEdit(owner, summarySession.id);
                            const withoutSummary = removeMaterialSummaryCacheEntry(value, summarySession.id, source.id);
                            commitRef.current({...withoutSummary,sources:{...withoutSummary.sources,[summarySession.id]:(withoutSummary.sources?.[summarySession.id] ?? []).map(item => item.id === source.id ? editMaterialSourceText(item, text) : item)},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});
                          }} />
                          <MaterialSourceReviewButton disabled={source.text.trim().length < 10} onClick={() => {try {
                            const value = current.current;
                            if(value.summarySessionId !== summarySession.id) return;
                            cancelMaterialSummaryRequest(summarySession.id, source.id);
                            noteStudyExerciseSourceChange(summarySession.id, source.id);
                            const reviewed = reviewMaterialSource(source, source.text);
                            invalidateQuizForSourceEdit(owner, summarySession.id);
                            const withoutSummary = removeMaterialSummaryCacheEntry(value, summarySession.id, source.id);
                            commitRef.current({...withoutSummary,sources:{...withoutSummary.sources,[summarySession.id]:(withoutSummary.sources?.[summarySession.id] ?? []).map(item => item.id === source.id ? reviewed : item)},quizDrafts:emptyQuizDraftForSourceEdit(value,summarySession.id)});
                            setError("");
                          } catch(e) {setError(e instanceof Error ? e.message : "Không xác nhận được nguồn.");}}} />
                          <MaterialSummaryControl
                            source={source}
                            summary={summaryText}
                            pending={ui?.status === "pending"}
                            error={summaryError}
                            canGenerate={canGenerateSummary}
                            disabledReason={summaryUnavailableReason}
                            onGenerate={() => void generateMaterialSummary(summarySession.id, source.id, "summary")}
                            onCancel={() => cancelMaterialSummaryRequest(summarySession.id, source.id)}
                          />
                        </details>;
                      })}
                      {owner !== "guest" && <PublicMaterialSummaryControl
                        key={`${owner}:${summarySession.id}:${publicSummaryScope.authGeneration}:${publicSummaryScope.workspaceGeneration}`}
                        scope={publicSummaryScope}
                        candidates={publicSummaryCandidates}
                        canManage={canManagePublicSummary}
                        disabledReason={publicSummaryDisabledReason}
                        isScopeCurrent={isPublicSummaryScopeCurrent}
                        isCandidateCurrent={isPublicSummaryCandidateCurrent}
                      />}
                      <QuizPanel
                        key={`${owner}:${summarySession.id}:${summaryCorrectionVersion}`}
                        ownerId={owner}
                        session={summarySession}
                        draft={saved.quizDrafts?.[summarySession.id]}
                        prefetchStatus={summaryQuizPrefetch?.status}
                        prefetchError={summaryQuizPrefetch?.message}
                        canUseAI={owner === "guest" ? online && !authOffline : !!user && !needsLogin && online && !authOffline}
                        isGuest={owner === "guest"}
                        needsLogin={needsLogin}
                        onGenerate={(count) => generateQuiz(summarySession, count)}
                        onSaveDraft={(draft) => saveQuizDraft(owner, summarySession.id, draft)}
                        onGrade={(answers) => gradeQuiz(summarySession.id, answers)}
                        onLogin={() => go("account")}
                        onStartReview={() => startReviewTrip(summarySession)}
                      />
                      {summaryExercisePreparation && <StudyExerciseQuestionViewer
                        preparation={summaryExercisePreparation}
                        phase="summary"
                        solutionStatus={summaryExerciseSolutionStatus}
                        solutions={summaryExerciseSolutionUi?.status === "ready" ? summaryExerciseSolutionUi.solutions ?? null : null}
                        onRequestSolution={() => void loadSummaryStudyExerciseSolutions()}
                        onCancelSolution={cancelStudyExerciseSolutionRequest}
                      />}
                      {summaryExerciseAvailability && <div className="study-exercises__error" role="alert">
                        <p>{summaryExerciseAvailability}</p>
                      {owner === "guest" && /không còn|hết hạn/iu.test(summaryExerciseAvailability) && <button type="button" onClick={() => { selectSoloMode(); go("station"); }}>Mở buổi học mới</button>}
                      </div>}
                    </section>
                    {owner === "guest" && <section className="panel">
                      <h2>Lịch sử phiên học</h2>
                      <p>Phiên học đã lưu sẽ xuất hiện tự động trong lịch sử chung sau khi đồng bộ với máy chủ.</p>
                      <p role={guestPublication[summarySession.id]?.status === "suppression-failed" ? "alert" : "status"}>{guestPublication[summarySession.id]?.status === "suppression-failed"
                        ? guestPublication[summarySession.id].message ?? "Máy chủ đã gỡ phiên này nhưng thiết bị chưa lưu trạng thái. Hãy thử lại."
                        : saved.guestPublished?.includes(summarySession.id)
                          ? "Phiên khách đã được máy chủ lưu và sẽ xuất hiện trong lịch sử tự động."
                        : guestPublication[summarySession.id]?.status === "save-failed"
                          ? "Máy chủ đã nhận bản lưu khách, nhưng thiết bị chưa lưu xác nhận. Hãy đồng bộ lại để cập nhật lịch sử."
                          : guestPublication[summarySession.id]?.status === "sending"
                            ? "Đang đồng bộ phiên đã lưu với máy chủ."
                            : guestPublication[summarySession.id]?.status === "failed"
                              ? `Phiên vẫn lưu trên thiết bị; chưa đồng bộ được với máy chủ. ${guestPublication[summarySession.id].message ?? ""}`
                              : "Phiên khách đã lưu trên thiết bị; lịch sử chung sẽ cập nhật sau khi đồng bộ."}</p>
                    </section>}
                    <div className="choice-row">
                      <button onClick={() => go("experiments")}>Xem lịch sử phiên học →</button>
                      {owner !== "guest" && saved.pending.some(session => session.id === summarySession.id) &&
                        <button disabled={busy || !online || needsLogin} onClick={() => void run(sync)}>Thử đồng bộ lại</button>}
                    </div>
                    <button className="primary" onClick={() => go("station")}>
                      Về lộ trình →
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
                      <p>Phiên đã lưu tự động xuất hiện trong lịch sử chung; tóm tắt mục tiêu tối đa 200 ký tự được hiển thị. Tránh ghi thông tin riêng tư vào mục tiêu. Lịch sử không gửi email, mã tài khoản, tài liệu hay câu trả lời chi tiết thành các trường riêng.</p>
                      <p>
                        Ở chế độ khách, tiến độ và tài liệu được giữ trong trình duyệt này;
                        phiên khách xuất hiện trong lịch sử chung sau khi đồng bộ với máy chủ.
                        Xuất bản sao trước khi xóa dữ liệu trình duyệt.
                      </p>
                      <p>Tên tài khoản gần nhất được giữ trên thiết bị để mở lại phiên offline. Đăng xuất sẽ xóa thông tin này; mật khẩu và token không được lưu lâu dài.</p>
                    </div>
                  }
                />
                {legacyGroupCleanupAvailable && <section className="panel legacy-group-cleanup" aria-labelledby="legacy-group-cleanup-title">
                  <h2 id="legacy-group-cleanup-title">Đoàn cũ</h2>
                  <p>{ownsWaitingLegacyTrip
                    ? "Đoàn vẫn có một chuyến đang chờ. Hủy chuyến này sẽ gỡ mọi thành viên khỏi chuyến."
                    : "Tư cách thành viên cũ không còn phiên đang chạy. Bạn có thể rời đoàn mà vẫn giữ nguyên lịch sử học."}</p>
                  <button type="button" disabled={busy} onClick={() => setConfirm("leave")}>
                    {ownsWaitingLegacyTrip ? "Hủy chuyến chờ cũ" : "Rời đoàn cũ"}
                  </button>
                </section>}
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
                  : confirm === "reset" ? "Tạo lại hành trình trên thiết bị?"
                    : ownsWaitingLegacyTrip ? "Hủy chuyến chờ cho mọi người?" : "Rời đoàn cũ?"}
            </h2>
            <p>
              {confirm === "finish"
                ? "Phần thời gian học hợp lệ sẽ được lưu. Bạn không mất kinh nghiệm đã kiếm được."
                : confirm === "reset" ? "Dữ liệu cục bộ của tài khoản này sẽ bị xóa. Hãy tải dữ liệu gốc trước. Dữ liệu đã đồng bộ trên máy chủ vẫn được giữ."
                  : ownsWaitingLegacyTrip
                    ? "Chuyến đang chờ sẽ bị hủy cho tất cả thành viên. Lịch sử và phiên học đã lưu vẫn được giữ."
                    : "Chỉ tư cách thành viên của đoàn cũ sẽ được gỡ. Phiên học và lịch sử của bạn được giữ nguyên."}
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
                  } else
                    void run(async () => {
                      if (!legacyGroupCleanupAvailable) throw new Error("Đoàn đã đổi trạng thái hoặc còn phiên liên kết; hãy cập nhật dữ liệu trước khi rời.");
                      await mutation("leave", {});
                      selectSoloMode();
                      setConfirm(null);
                    });
                }}
              >
                {confirm === "leave" ? ownsWaitingLegacyTrip ? "Hủy chuyến chờ" : "Rời đoàn cũ" : "Xác nhận"}
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
