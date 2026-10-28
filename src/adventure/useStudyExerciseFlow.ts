import { useCallback, useEffect, useRef, useState } from "react";
import {
  bindStudyExercises,
  getStudyExercisesForSession,
  invalidateStudyExercises,
  prepareStudyExercises,
  requestStudyExerciseSolutions,
  type StudyExercisePreparationInput,
  type StudyExercisePreparationResponse,
  type StudyExerciseSolutionResponse,
} from "../services/studyExercisesApi.ts";
import type { MaterialSource } from "./materialSources.ts";
import {
  fingerprintStudyExerciseSourceText,
} from "./studyExercises.ts";
import {
  acceptStudyExercisePreparationResult,
  isStudyExercisePreparationSourceCurrent,
  isStudyExerciseSetSourceCurrent,
  loadStudyExercisePreparationWithCurrentSources,
  loadStudyExerciseSolutionsAfterSync,
  matchStudyExercisePreparationSource,
  shouldInvalidateStudyExerciseForSourceChange,
} from "./studyExerciseSessionFlow.ts";
import type { StudyExerciseSolutionStatus } from "./StudyExercisePreparation.tsx";

type StudyExerciseSourceScope = { sourceId: string; textFingerprint: string };
type PreparedStudyExerciseSourceScope = StudyExerciseSourceScope & {
  preparationId: string;
  sourceRevision: number;
};
type PendingStudyExerciseRequest = {
  ownerId: string;
  authGeneration: number;
  workspaceGeneration: number;
  plannedSessionId: string;
  requestId: string;
  mode: "provided" | "generated";
  sourceScope: StudyExerciseSourceScope | null;
  sourceRevision: number;
  controller: AbortController;
};
type StudyExerciseSolutionUi = {
  ownerId: string;
  sessionId: string;
  preparationId: string;
  status: "loading" | "error" | "ready";
  solutions?: StudyExerciseSolutionResponse;
};
type StudyExerciseAvailabilityMessage = {
  ownerId: string;
  sessionId: string;
  message: string;
};

type FocusSessionSource = {
  id: string;
  owner: string;
  sources?: readonly MaterialSource[];
} | null;
type SummarySessionSource = {
  id: string;
  effectiveMetrics?: { completed?: boolean } | null;
} | null;

export type StudyExerciseFlowOptions = {
  ownerId: string;
  authenticated: boolean;
  needsLogin: boolean;
  online: boolean;
  loaded: boolean;
  exclusive: boolean;
  view: string;
  plannedSessionId: string;
  sources: readonly MaterialSource[];
  activeSession: FocusSessionSource;
  summarySession: SummarySessionSource;
  summarySources: readonly MaterialSource[];
  getAuthGeneration: () => number;
  getWorkspaceGeneration: () => number;
  isOwnerWorkspaceCurrent: (ownerId: string, authGeneration: number, workspaceGeneration: number) => boolean;
  isRouteScopeCurrent: (ownerId: string, sessionId: string, view: "ticket" | "focus" | "summary") => boolean;
  isPersistedOwnerSession: (ownerId: string, sessionId: string) => boolean;
  isPersistedCompleted: (ownerId: string, sessionId: string) => boolean;
  sync: () => Promise<void>;
};

function sourceRevisionKey(sessionId: string, sourceId: string): string {
  return JSON.stringify([sessionId, sourceId]);
}

function hasHttpStatus(error: unknown, expected: number): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    Number(error.status) === expected;
}

export function useStudyExerciseFlow(options: StudyExerciseFlowOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sourcesRef = useRef(options.sources);
  sourcesRef.current = options.sources;
  const summarySourcesRef = useRef(options.summarySources);
  summarySourcesRef.current = options.summarySources;

  const [preparation, setPreparationState] = useState<StudyExercisePreparationResponse | null>(null);
  const preparationRef = useRef<StudyExercisePreparationResponse | null>(null);
  const sourceScopeRef = useRef<PreparedStudyExerciseSourceScope | null>(null);
  const [pending, setPending] = useState<Pick<PendingStudyExerciseRequest, "ownerId" | "plannedSessionId" | "requestId"> | null>(null);
  const pendingRef = useRef<PendingStudyExerciseRequest | null>(null);
  const skippedRequests = useRef(new Set<string>());
  const [startPromptVisible, setStartPromptVisible] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState<StudyExerciseAvailabilityMessage | null>(null);
  const [solutionUi, setSolutionUiState] = useState<StudyExerciseSolutionUi | null>(null);
  const solutionUiRef = useRef<StudyExerciseSolutionUi | null>(null);
  const solutionController = useRef<AbortController | null>(null);
  const solutionGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const sourceRevisions = useRef(new Map<string, number>());
  const sessionSourceRevisions = useRef(new Map<string, number>());
  const boundSessions = useRef(new Set<string>());
  const sourceInvalidationLookups = useRef(new Set<string>());
  const syncRef = useRef(options.sync);
  syncRef.current = options.sync;

  const setSolutionUi = useCallback((next: StudyExerciseSolutionUi | null) => {
    solutionUiRef.current = next;
    setSolutionUiState(next);
  }, []);

  const setPreparation = useCallback((
    next: StudyExercisePreparationResponse | null,
    nextSourceScope?: (StudyExerciseSourceScope & { preparationId: string }) | null,
  ) => {
    const previousId = preparationRef.current?.id;
    preparationRef.current = next;
    const sourceMatchesDto = next?.mode !== "generated" || !nextSourceScope ||
      next.sourceFingerprint === nextSourceScope.textFingerprint;
    sourceScopeRef.current = next && nextSourceScope && sourceMatchesDto
      ? {
        ...nextSourceScope,
        sourceRevision: sourceRevisions.current.get(
          sourceRevisionKey(next.plannedSessionId, nextSourceScope.sourceId),
        ) ?? 0,
      }
      : null;
    if (next && next.mode === "generated" && sourceScopeRef.current) {
      sourceInvalidationLookups.current.delete(
        sourceRevisionKey(next.plannedSessionId, sourceScopeRef.current.sourceId),
      );
    }
    setPreparationState(next);
    if (!next || previousId !== next.id) setSolutionUi(null);
    setAvailabilityMessage(null);
  }, [setSolutionUi]);

  const isSourceCurrent = useCallback((
    currentPreparation: StudyExercisePreparationResponse,
    sessionId: string,
    currentScope: PreparedStudyExerciseSourceScope | null,
    currentSources: readonly MaterialSource[],
  ): boolean => {
    const selectedSource = currentScope
      ? currentSources.find(source => source.id === currentScope.sourceId) ?? null
      : null;
    return isStudyExerciseSetSourceCurrent({
      bound: boundSessions.current.has(sessionId),
      mode: currentPreparation.mode,
      ...(currentPreparation.mode === "generated" ? { sourceFingerprint: currentPreparation.sourceFingerprint } : {}),
      sourceScope: currentScope,
      selectedSource,
      sourceRevision: currentScope
        ? sourceRevisions.current.get(sourceRevisionKey(sessionId, currentScope.sourceId)) ?? 0
        : 0,
      preparationSourceRevision: currentScope?.sourceRevision ?? null,
    });
  }, []);

  const hydrate = useCallback(async (input: {
    ownerId: string;
    sessionId: string;
    targetView: "focus" | "summary";
    sources: readonly MaterialSource[];
    controller: AbortController;
    authGeneration: number;
    workspaceGeneration: number;
    sourceRevision: number;
  }) => {
    boundSessions.current.add(input.sessionId);
    const currentOptions = () => optionsRef.current;
    const isCurrent = () => {
      const current = currentOptions();
      return !input.controller.signal.aborted &&
        current.isOwnerWorkspaceCurrent(input.ownerId, input.authGeneration, input.workspaceGeneration) &&
        current.isRouteScopeCurrent(input.ownerId, input.sessionId, input.targetView);
    };
    try {
      const loaded = await loadStudyExercisePreparationWithCurrentSources({
        load: () => getStudyExercisesForSession(input.sessionId, input.controller.signal),
        isCurrent,
        getSources: () => input.targetView === "summary" ? summarySourcesRef.current : input.sources,
        match: (preparation, sources) => matchStudyExercisePreparationSource({
          mode: preparation.mode,
          ...(preparation.mode === "generated" ? { sourceFingerprint: preparation.sourceFingerprint } : {}),
          sources,
          fingerprint: fingerprintStudyExerciseSourceText,
        }),
      });
      if (!loaded) return;
      const { preparation: stored, sourceMatch } = loaded;
      if (skippedRequests.current.has(stored.id)) {
        void invalidateStudyExercises(input.sessionId, stored.id).catch(() => {});
        return;
      }
      if (stored.mode === "generated" &&
          (sessionSourceRevisions.current.get(input.sessionId) ?? 0) !== input.sourceRevision) {
        void invalidateStudyExercises(input.sessionId, stored.id).catch(() => {});
        return;
      }
      if (sourceMatch.status === "mismatch") {
        setAvailabilityMessage({
          ownerId: input.ownerId,
          sessionId: input.sessionId,
          message: "Nguồn đã lưu không còn khớp với bộ câu hỏi. Hãy dùng nguồn đã kiểm tra trước khi tạo bộ mới.",
        });
        void invalidateStudyExercises(input.sessionId, stored.id).catch(() => {});
        return;
      }
      setPreparation(stored, sourceMatch.status === "matched"
        ? { preparationId: stored.id, sourceId: sourceMatch.sourceId, textFingerprint: sourceMatch.textFingerprint }
        : null);
    } catch (reason) {
      if (!input.controller.signal.aborted && !hasHttpStatus(reason, 404) && isCurrent())
        setAvailabilityMessage({
          ownerId: input.ownerId,
          sessionId: input.sessionId,
          message: "Chưa tải được bộ bài tập riêng tư. Kết nối lại rồi mở lại phiên học.",
        });
    }
  }, [setPreparation]);

  const activeSessionId = options.activeSession?.id;
  const activeSessionOwner = options.activeSession?.owner;
  useEffect(() => {
    const current = optionsRef.current;
    if (current.view !== "focus" || !current.activeSession || current.ownerId === "guest" ||
        !current.authenticated || current.needsLogin || !current.online || !current.loaded || !current.exclusive) return;
    const ownerId = current.ownerId;
    const sessionId = current.activeSession.id;
    boundSessions.current.add(sessionId);
    const authGeneration = current.getAuthGeneration();
    const workspaceGeneration = current.getWorkspaceGeneration();
    const sourceRevision = sessionSourceRevisions.current.get(sessionId) ?? 0;
    const controller = new AbortController();
    loadController.current?.abort();
    loadController.current = controller;
    void bindStudyExercises(sessionId, controller.signal).catch(() => {});
    if (preparationRef.current?.plannedSessionId !== sessionId) {
      void hydrate({
        ownerId,
        sessionId,
        targetView: "focus",
        sources: current.activeSession.sources ?? [],
        controller,
        authGeneration,
        workspaceGeneration,
        sourceRevision,
      });
    }
    return () => {
      controller.abort();
      if (loadController.current === controller) loadController.current = null;
    };
  }, [options.view, options.ownerId, options.authenticated, options.needsLogin, options.online, options.loaded,
    options.exclusive, activeSessionId, activeSessionOwner, hydrate]);

  const summarySessionId = options.summarySession?.id;
  useEffect(() => {
    const current = optionsRef.current;
    const sessionId = current.summarySession?.id;
    if (current.view !== "summary" || !sessionId || current.ownerId === "guest" || !current.authenticated ||
        current.needsLogin || !current.online || !current.loaded || !current.exclusive) return;
    const ownerId = current.ownerId;
    boundSessions.current.add(sessionId);
    const authGeneration = current.getAuthGeneration();
    const workspaceGeneration = current.getWorkspaceGeneration();
    const sourceRevision = sessionSourceRevisions.current.get(sessionId) ?? 0;
    const controller = new AbortController();
    loadController.current?.abort();
    loadController.current = controller;
    if (preparationRef.current?.plannedSessionId !== sessionId) {
      void hydrate({
        ownerId,
        sessionId,
        targetView: "summary",
        sources: current.summarySources,
        controller,
        authGeneration,
        workspaceGeneration,
        sourceRevision,
      });
    }
    return () => {
      controller.abort();
      if (loadController.current === controller) loadController.current = null;
    };
  }, [options.view, options.ownerId, options.authenticated, options.needsLogin, options.online, options.loaded,
    options.exclusive, summarySessionId, hydrate]);

  useEffect(() => {
    const current = optionsRef.current;
    const sessionId = current.summarySession?.id;
    const storedPreparation = preparationRef.current;
    if (current.view !== "summary" || !sessionId || current.ownerId === "guest" || !current.authenticated ||
        current.needsLogin || !current.online || !storedPreparation || storedPreparation.plannedSessionId !== sessionId) return;
    const ownerId = current.ownerId;
    const authGeneration = current.getAuthGeneration();
    const workspaceGeneration = current.getWorkspaceGeneration();
    let cancelled = false;
    void syncRef.current().then(() => {
      const latest = optionsRef.current;
      if (cancelled || !latest.isOwnerWorkspaceCurrent(ownerId, authGeneration, workspaceGeneration) ||
          !latest.isRouteScopeCurrent(ownerId, sessionId, "summary")) return;
      if (latest.isPersistedOwnerSession(ownerId, sessionId)) void bindStudyExercises(sessionId).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [options.view, options.ownerId, options.authenticated, options.needsLogin, options.online,
    summarySessionId, preparation?.id]);

  useEffect(() => {
    solutionController.current?.abort();
    solutionController.current = null;
    setSolutionUi(null);
    return () => solutionController.current?.abort();
  }, [options.view, options.ownerId, options.needsLogin, options.authenticated, options.online,
    options.loaded, options.exclusive, summarySessionId, setSolutionUi]);

  const onInvalidate = useCallback((plannedSessionId: string, requestId: string) =>
    invalidateStudyExercises(plannedSessionId, requestId), []);

  const onPrepare = useCallback(async (
    input: StudyExercisePreparationInput,
    signal: AbortSignal,
    sourceScope: StudyExerciseSourceScope | null = null,
  ): Promise<StudyExercisePreparationResponse> => {
    const current = optionsRef.current;
    const ownerId = current.ownerId;
    if (ownerId === "guest" || !current.authenticated || current.needsLogin || input.plannedSessionId !== current.plannedSessionId)
      throw new Error("Đăng nhập và mở lại vé để chuẩn bị bài tập riêng tư.");

    const request: PendingStudyExerciseRequest = {
      ownerId,
      authGeneration: current.getAuthGeneration(),
      workspaceGeneration: current.getWorkspaceGeneration(),
      plannedSessionId: input.plannedSessionId,
      requestId: input.requestId,
      mode: input.mode,
      sourceScope,
      sourceRevision: sourceScope
        ? sourceRevisions.current.get(sourceRevisionKey(input.plannedSessionId, sourceScope.sourceId)) ?? 0
        : 0,
      controller: new AbortController(),
    };
    const forwardAbort = () => request.controller.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
    pendingRef.current?.controller.abort();
    pendingRef.current = request;
    setPending({ ownerId, plannedSessionId: input.plannedSessionId, requestId: input.requestId });
    setStartPromptVisible(false);

    try {
      const result = await prepareStudyExercises(input, request.controller.signal);
      const selectedSource = sourceScope
        ? sourcesRef.current.find(source => source.id === sourceScope.sourceId) ?? null
        : null;
      const sourceCurrent = isStudyExercisePreparationSourceCurrent({
        mode: input.mode,
        sourceScope,
        selectedSource,
        sourceRevision: sourceScope
          ? sourceRevisions.current.get(sourceRevisionKey(input.plannedSessionId, sourceScope.sourceId)) ?? 0
          : 0,
        preparationSourceRevision: sourceScope ? request.sourceRevision : null,
      }) && (input.mode !== "generated" || !sourceScope ||
        result.mode === "generated" && result.sourceFingerprint === sourceScope.textFingerprint);
      const accepted = await acceptStudyExercisePreparationResult({
        result,
        signal: request.controller.signal,
        isCurrent: () => {
          const currentOptions = optionsRef.current;
          return pendingRef.current === request &&
            currentOptions.isOwnerWorkspaceCurrent(ownerId, request.authGeneration, request.workspaceGeneration) &&
            currentOptions.isRouteScopeCurrent(ownerId, input.plannedSessionId, "ticket") &&
            !skippedRequests.current.has(input.requestId) && sourceCurrent;
        },
        invalidate: () => invalidateStudyExercises(input.plannedSessionId, input.requestId),
      });
      setPreparation(accepted, sourceScope ? { preparationId: accepted.id, ...sourceScope } : null);
      return accepted;
    } finally {
      signal.removeEventListener("abort", forwardAbort);
      if (pendingRef.current === request) {
        pendingRef.current = null;
        setPending(null);
        setStartPromptVisible(false);
      }
    }
  }, [setPreparation]);

  const cancelPendingForStart = useCallback((plannedSessionId: string) => {
    const pendingRequest = pendingRef.current;
    if (!pendingRequest || pendingRequest.plannedSessionId !== plannedSessionId) return;
    skippedRequests.current.add(pendingRequest.requestId);
    pendingRequest.controller.abort();
    pendingRef.current = null;
    setPending(null);
    void invalidateStudyExercises(pendingRequest.plannedSessionId, pendingRequest.requestId).catch(() => {});
  }, []);

  const noteSourceChange = useCallback((plannedSessionId: string, sourceId: string) => {
    const storedPreparation = preparationRef.current;
    const sourceScope = sourceScopeRef.current;
    const pendingRequest = pendingRef.current;
    if ((storedPreparation?.plannedSessionId === plannedSessionId && storedPreparation.mode === "provided") ||
        (pendingRequest?.plannedSessionId === plannedSessionId && pendingRequest.mode === "provided")) return;
    if (!shouldInvalidateStudyExerciseForSourceChange({
      bound: boundSessions.current.has(plannedSessionId),
      sourceId: storedPreparation?.plannedSessionId === plannedSessionId && storedPreparation.mode === "generated"
        ? sourceScope?.sourceId ?? null
        : pendingRef.current?.plannedSessionId === plannedSessionId && pendingRef.current.mode === "generated"
          ? pendingRef.current.sourceScope?.sourceId ?? null
          : null,
      changedSourceId: sourceId,
    })) return;
    const key = sourceRevisionKey(plannedSessionId, sourceId);
    sourceRevisions.current.set(key, (sourceRevisions.current.get(key) ?? 0) + 1);
    sessionSourceRevisions.current.set(
      plannedSessionId,
      (sessionSourceRevisions.current.get(plannedSessionId) ?? 0) + 1,
    );
    if (pendingRequest?.plannedSessionId === plannedSessionId && pendingRequest.mode === "generated" &&
        (!pendingRequest.sourceScope || pendingRequest.sourceScope.sourceId === sourceId)) {
      pendingRequest.controller.abort();
      pendingRef.current = null;
      setPending(null);
      sourceInvalidationLookups.current.add(key);
      void invalidateStudyExercises(plannedSessionId, pendingRequest.requestId).catch(() => {});
      setAvailabilityMessage({
        ownerId: pendingRequest.ownerId,
        sessionId: plannedSessionId,
        message: "Nguồn tài liệu đã thay đổi. Yêu cầu bài tập cũ đã bị hủy; hãy xác nhận nguồn mới.",
      });
      return;
    }
    if (storedPreparation?.plannedSessionId === plannedSessionId && storedPreparation.mode === "generated") {
      if (!sourceScope || sourceScope.sourceId === sourceId) {
        setPreparation(null);
        sourceInvalidationLookups.current.add(key);
        void invalidateStudyExercises(plannedSessionId, storedPreparation.id).catch(() => {});
        setAvailabilityMessage({
          ownerId: optionsRef.current.ownerId,
          sessionId: plannedSessionId,
          message: "Nguồn tài liệu đã thay đổi. Bộ câu hỏi cũ đã bị hủy; hãy xác nhận nguồn mới.",
        });
      }
      return;
    }
    if (storedPreparation?.plannedSessionId === plannedSessionId || pendingRequest?.plannedSessionId === plannedSessionId ||
        optionsRef.current.ownerId === "guest" || !optionsRef.current.authenticated || optionsRef.current.needsLogin ||
        sourceInvalidationLookups.current.has(key)) return;
    const current = optionsRef.current;
    const ownerId = current.ownerId;
    const authGeneration = current.getAuthGeneration();
    const workspaceGeneration = current.getWorkspaceGeneration();
    sourceInvalidationLookups.current.add(key);
    void getStudyExercisesForSession(plannedSessionId).then(stored => {
      const latest = optionsRef.current;
      if (!latest.isOwnerWorkspaceCurrent(ownerId, authGeneration, workspaceGeneration) || stored.mode !== "generated") return;
      void invalidateStudyExercises(plannedSessionId, stored.id).catch(() => {});
    }).catch(() => {});
  }, [setPreparation]);

  const onFocusStarted = useCallback((sessionId: string) => {
    boundSessions.current.add(sessionId);
  }, []);

  const invalidatePreparationForSession = useCallback((sessionId: string) => {
    const stored = preparationRef.current;
    if (stored?.plannedSessionId !== sessionId) return;
    setPreparation(null);
    void invalidateStudyExercises(sessionId, stored.id).catch(() => {});
  }, [setPreparation]);

  const isReadyForSession = useCallback((sessionId: string) => {
    const stored = preparationRef.current;
    if (stored?.plannedSessionId !== sessionId) return false;
    const scope = sourceScopeRef.current?.preparationId === stored.id ? sourceScopeRef.current : null;
    const currentSources = optionsRef.current.view === "summary"
      ? summarySourcesRef.current
      : sourcesRef.current;
    return isSourceCurrent(stored, sessionId, scope, currentSources);
  }, [isSourceCurrent]);

  const isPendingForSession = useCallback((sessionId: string) =>
    pendingRef.current?.plannedSessionId === sessionId, []);

  const cancelSolutionRequest = useCallback(() => {
    solutionController.current?.abort();
    solutionController.current = null;
    solutionGeneration.current++;
    setSolutionUi(null);
  }, [setSolutionUi]);

  const loadSummarySolutions = useCallback(async () => {
    const current = optionsRef.current;
    const stored = preparationRef.current;
    const ownerId = current.ownerId;
    const sessionId = current.summarySession?.id;
    if (!stored || !sessionId || stored.plannedSessionId !== sessionId || ownerId === "guest" ||
        !current.authenticated || current.needsLogin || !current.online || !current.loaded || !current.exclusive) return;
    const authGeneration = current.getAuthGeneration();
    const workspaceGeneration = current.getWorkspaceGeneration();
    const sourceScope = sourceScopeRef.current?.preparationId === stored.id ? sourceScopeRef.current : null;
    const generation = ++solutionGeneration.current;
    solutionController.current?.abort();
    const controller = new AbortController();
    solutionController.current = controller;
    setSolutionUi({ ownerId, sessionId, preparationId: stored.id, status: "loading" });
    const isSourceCurrentNow = () => isSourceCurrent(
      stored,
      sessionId,
      sourceScope,
      summarySourcesRef.current,
    );
    const clearLoading = () => {
      const latest = solutionUiRef.current;
      if (generation === solutionGeneration.current && latest?.status === "loading" &&
          latest.preparationId === stored.id && latest.sessionId === sessionId)
        setSolutionUi(null);
    };
    const isScopeCurrent = () => {
      const latest = optionsRef.current;
      return generation === solutionGeneration.current && !controller.signal.aborted &&
        latest.authenticated && !latest.needsLogin && latest.online && latest.loaded && latest.exclusive &&
        latest.isOwnerWorkspaceCurrent(ownerId, authGeneration, workspaceGeneration) &&
        latest.isRouteScopeCurrent(ownerId, sessionId, "summary") &&
        preparationRef.current?.id === stored.id && isSourceCurrentNow();
    };
    const isPersistedCompleted = () => optionsRef.current.isPersistedCompleted(ownerId, sessionId);
    try {
      const solutions = await loadStudyExerciseSolutionsAfterSync({
        sync: () => syncRef.current(),
        isScopeCurrent,
        isPersistedCompleted,
        load: () => requestStudyExerciseSolutions(stored.id, controller.signal),
        onRejected: clearLoading,
      });
      if (!isScopeCurrent()) {
        clearLoading();
        return;
      }
      if (!solutions || !isPersistedCompleted()) {
        setSolutionUi(null);
        return;
      }
      setSolutionUi({ ownerId, sessionId, preparationId: stored.id, status: "ready", solutions });
    } catch {
      if (controller.signal.aborted || generation !== solutionGeneration.current || !isScopeCurrent()) {
        clearLoading();
        return;
      }
      setSolutionUi({ ownerId, sessionId, preparationId: stored.id, status: "error" });
    }
  }, [isSourceCurrent, setSolutionUi]);

  const summaryPreparation = preparation?.plannedSessionId === summarySessionId ? preparation : null;
  const summarySourceScope = summaryPreparation && sourceScopeRef.current?.preparationId === summaryPreparation.id
    ? sourceScopeRef.current
    : null;
  const summarySourceCurrent = summaryPreparation?.mode !== "generated" ||
    isSourceCurrent(summaryPreparation, summaryPreparation.plannedSessionId, summarySourceScope, options.summarySources);
  const summaryPersistedCompleted = options.summarySession?.effectiveMetrics?.completed === true;
  const summarySolutionUi = solutionUi?.ownerId === options.ownerId &&
    solutionUi.sessionId === summarySessionId && solutionUi.preparationId === summaryPreparation?.id
    ? solutionUi
    : null;
  const summarySolutionStatus: StudyExerciseSolutionStatus = !summaryPersistedCompleted || !summarySourceCurrent
    ? "locked"
    : summarySolutionUi?.status ?? "available";
  const summaryAvailabilityMessage = availabilityMessage?.ownerId === options.ownerId &&
    availabilityMessage.sessionId === summarySessionId ? availabilityMessage.message : "";
  const focusAvailabilityMessage = availabilityMessage?.ownerId === options.ownerId &&
    availabilityMessage.sessionId === options.activeSession?.id ? availabilityMessage.message : "";

  useEffect(() => () => {
    const request = pendingRef.current;
    if (request) {
      request.controller.abort();
      void invalidateStudyExercises(request.plannedSessionId, request.requestId).catch(() => {});
    }
    loadController.current?.abort();
    solutionController.current?.abort();
  }, []);

  return {
    preparation,
    setPreparation,
    pending,
    startPromptVisible,
    setStartPromptVisible,
    availabilityMessage,
    focusAvailabilityMessage,
    summaryPreparation,
    summarySolutionUi,
    summarySolutionStatus,
    summaryAvailabilityMessage,
    onPrepare,
    onInvalidate,
    noteSourceChange,
    cancelPendingForStart,
    invalidatePreparationForSession,
    onFocusStarted,
    isReadyForSession,
    isPendingForSession,
    loadSummarySolutions,
    cancelSolutionRequest,
  };
}
