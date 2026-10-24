export type StudyFullscreenStatus =
  | "idle"
  | "pending"
  | "active"
  | "unsupported"
  | "failed";

export type StudyFullscreenSnapshot = {
  status: StudyFullscreenStatus;
  isFullscreen: boolean;
  message: string;
};

type FullscreenTarget = Element & {
  requestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = {
  fullscreenEnabled?: boolean;
  fullscreenElement: Element | null;
  addEventListener: (type: "fullscreenchange", listener: () => void) => void;
  removeEventListener: (type: "fullscreenchange", listener: () => void) => void;
  exitFullscreen?: () => Promise<void> | void;
};

type PendingRequest = {
  target: FullscreenTarget;
  confirmed: boolean;
};

export type StudyFullscreenController = {
  readonly status: StudyFullscreenStatus;
  readonly isFullscreen: boolean;
  readonly message: string;
  request: () => void;
  leave: () => void;
  toggle: () => void;
  setActiveFocus: (active: boolean) => void;
  dispose: () => void;
};

const messages: Record<StudyFullscreenStatus, string> = {
  idle: "",
  pending: "Đang bật toàn màn hình…",
  active: "",
  unsupported:
    "Toàn màn hình không khả dụng trên trình duyệt này. Bạn vẫn có thể học.",
  failed: "Không bật được toàn màn hình. Bạn vẫn có thể học và thử lại.",
};

/**
 * Owns only fullscreen requests started by this study control. The request
 * method deliberately invokes requestFullscreen before returning so callers
 * can call it directly in a user-gesture handler.
 */
export function createStudyFullscreenController(
  document: FullscreenDocument,
  getTarget: () => FullscreenTarget | null,
  onSnapshot: (snapshot: StudyFullscreenSnapshot) => void = () => undefined,
): StudyFullscreenController {
  let statusValue: StudyFullscreenStatus = "idle";
  let activeFocus = false;
  let allowFullscreen = false;
  let disposed = false;
  let nextRequestId = 0;
  let currentRequestId: number | null = null;
  const pendingRequests = new Map<number, PendingRequest>();
  const ownedTargets = new Set<FullscreenTarget>();
  const exitingTargets = new Set<FullscreenTarget>();

  const isFullscreen = () => {
    const current = document.fullscreenElement;
    return current !== null && ownedTargets.has(current as FullscreenTarget);
  };

  const snapshot = (): StudyFullscreenSnapshot => {
    const fullscreen = isFullscreen();
    return {
      status: statusValue,
      isFullscreen: fullscreen,
      message: fullscreen ? "" : messages[statusValue],
    };
  };

  const emit = () => {
    if (!disposed) onSnapshot(snapshot());
  };

  const setStatus = (status: StudyFullscreenStatus) => {
    statusValue = status;
    emit();
  };

  const hasCurrentPendingRequest = () =>
    currentRequestId !== null && pendingRequests.has(currentRequestId);

  const invalidateCurrentRequest = () => {
    nextRequestId += 1;
    currentRequestId = null;
  };

  const exitExactOwnedTarget = (target: FullscreenTarget) => {
    if (
      document.fullscreenElement !== target ||
      exitingTargets.has(target) ||
      typeof document.exitFullscreen !== "function"
    ) return;

    // The browser exits the current fullscreen element, so verify identity at
    // the last synchronous point before invoking it. Never exit a different
    // element that another surface placed on top.
    ownedTargets.add(target);
    exitingTargets.add(target);
    try {
      const result = document.exitFullscreen();
      void Promise.resolve(result)
        .catch(() => undefined)
        .then(() => exitingTargets.delete(target));
    } catch {
      exitingTargets.delete(target);
    }
  };

  const finishRequest = (requestId: number, target: FullscreenTarget) => {
    const request = pendingRequests.get(requestId);
    const confirmed = request?.confirmed ?? false;
    pendingRequests.delete(requestId);

    if (document.fullscreenElement === target) ownedTargets.add(target);

    if (disposed || !activeFocus || !allowFullscreen) {
      if (document.fullscreenElement === target) exitExactOwnedTarget(target);
      return;
    }

    // A late request can report actual fullscreen ownership, but it must never
    // replace the state of a newer request.
    if (requestId !== currentRequestId) {
      emit();
      return;
    }

    if (isFullscreen()) setStatus("active");
    else setStatus(confirmed ? "idle" : "failed");
  };

  const failRequest = (requestId: number, target: FullscreenTarget) => {
    const request = pendingRequests.get(requestId);
    const confirmed = request?.confirmed ?? false;
    pendingRequests.delete(requestId);

    if (document.fullscreenElement === target) ownedTargets.add(target);

    if (disposed || !activeFocus || !allowFullscreen) {
      if (document.fullscreenElement === target) exitExactOwnedTarget(target);
      return;
    }

    if (requestId !== currentRequestId) {
      emit();
      return;
    }

    if (isFullscreen()) setStatus("active");
    else setStatus(confirmed ? "idle" : "failed");
  };

  const handleFullscreenChange = () => {
    const current = document.fullscreenElement as FullscreenTarget | null;
    if (current) {
      // fullscreenchange does not identify which request caused it. Match the
      // oldest still-pending request for this exact element; later promise
      // settlement remains generation-checked.
      const matchingRequest = [...pendingRequests.values()].find(
        (request) => request.target === current,
      );
      if (matchingRequest) matchingRequest.confirmed = true;

      if (matchingRequest || ownedTargets.has(current)) ownedTargets.add(current);

      if ((!activeFocus || !allowFullscreen) && ownedTargets.has(current)) {
        exitExactOwnedTarget(current);
      } else if (ownedTargets.has(current) && !hasCurrentPendingRequest()) {
        statusValue = "active";
      } else if (!ownedTargets.has(current) && statusValue === "active") {
        statusValue = "idle";
      }
    } else if (statusValue === "active") {
      statusValue = "idle";
    }
    emit();
  };

  document.addEventListener("fullscreenchange", handleFullscreenChange);

  const request = () => {
    if (disposed) return;
    activeFocus = true;

    const target = getTarget();
    if (
      !target ||
      document.fullscreenEnabled === false ||
      typeof target.requestFullscreen !== "function"
    ) {
      setStatus("unsupported");
      return;
    }

    if (hasCurrentPendingRequest()) return;
    allowFullscreen = true;

    if (isFullscreen()) {
      setStatus("active");
      return;
    }

    const requestId = ++nextRequestId;
    currentRequestId = requestId;
    pendingRequests.set(requestId, { target, confirmed: false });
    setStatus("pending");

    // Keep this invocation synchronous: browsers require the call itself to
    // remain in the user's gesture stack.
    let result: Promise<void> | void;
    try {
      result = target.requestFullscreen();
    } catch {
      failRequest(requestId, target);
      return;
    }

    void Promise.resolve(result).then(
      () => finishRequest(requestId, target),
      () => failRequest(requestId, target),
    );
  };

  const leave = () => {
    if (disposed) return;
    activeFocus = false;
    allowFullscreen = false;
    invalidateCurrentRequest();

    // Requests keep their captured targets until settlement, so a ref change
    // or owner remount cannot make cleanup miss the element they requested.
    const capturedTargets = new Set<FullscreenTarget>(ownedTargets);
    for (const request of pendingRequests.values()) {
      capturedTargets.add(request.target);
    }
    for (const target of capturedTargets) {
      if (document.fullscreenElement === target) exitExactOwnedTarget(target);
    }

    setStatus("idle");
  };

  const toggle = () => {
    if (disposed) return;
    const current = document.fullscreenElement as FullscreenTarget | null;
    if (current && ownedTargets.has(current)) {
      allowFullscreen = false;
      invalidateCurrentRequest();
      exitExactOwnedTarget(current);
      setStatus("idle");
      return;
    }
    if (hasCurrentPendingRequest()) return;
    request();
  };

  const setActiveFocus = (active: boolean) => {
    if (disposed) return;
    if (!active) {
      leave();
      return;
    }
    activeFocus = true;
  };

  const dispose = () => {
    if (disposed) return;
    activeFocus = false;
    allowFullscreen = false;
    invalidateCurrentRequest();

    const capturedTargets = new Set<FullscreenTarget>(ownedTargets);
    for (const request of pendingRequests.values()) {
      capturedTargets.add(request.target);
    }
    for (const target of capturedTargets) {
      if (document.fullscreenElement === target) exitExactOwnedTarget(target);
    }

    statusValue = "idle";
    disposed = true;
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  };

  return {
    get status() {
      return statusValue;
    },
    get isFullscreen() {
      return isFullscreen();
    },
    get message() {
      const current = snapshot();
      return current.message;
    },
    request,
    leave,
    toggle,
    setActiveFocus,
    dispose,
  };
}
