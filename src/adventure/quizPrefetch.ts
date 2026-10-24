export type QuizPrefetchScope = {
  ownerId: string;
  sessionId: string;
  /** Includes the canonical request source and its review state. */
  sourceKey: string;
  count: number;
};

export type QuizPrefetchStatus = "pending" | "ready" | "failed";

type Entry<T> = {
  key: string;
  scope: QuizPrefetchScope;
  controller: AbortController;
  promise: Promise<T>;
  status: QuizPrefetchStatus;
  result?: T;
  error?: unknown;
};

export function quizPrefetchScopeKey(scope: QuizPrefetchScope) {
  return JSON.stringify([scope.ownerId, scope.sessionId, scope.sourceKey, scope.count]);
}

function abortError() {
  return new DOMException("Quiz preparation was canceled.", "AbortError");
}

/** Keeps one owner/session/source/count-scoped request available to focus and summary. */
export class QuizPrefetchCoordinator<T> {
  private current: Entry<T> | null = null;
  private disposed = false;

  getOrStart(scope: QuizPrefetchScope, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(abortError());
    const key = quizPrefetchScopeKey(scope);
    if (this.current?.key === key) return this.current.promise;
    this.cancel();
    return this.begin(key, scope, start);
  }

  /** An explicit user retry replaces settled data, but still joins a live request. */
  retry(scope: QuizPrefetchScope, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(abortError());
    const key = quizPrefetchScopeKey(scope);
    if (this.current?.key === key && this.current.status === "pending")
      return this.current.promise;
    this.cancel();
    return this.begin(key, scope, start);
  }

  isCurrent(scope: QuizPrefetchScope): boolean {
    return this.current?.key === quizPrefetchScopeKey(scope);
  }

  currentScope(): QuizPrefetchScope | undefined {
    return this.current?.scope;
  }

  status(scope: QuizPrefetchScope): { status: QuizPrefetchStatus; error?: unknown } | undefined {
    const entry = this.current;
    if (!entry || entry.key !== quizPrefetchScopeKey(scope)) return undefined;
    return { status: entry.status, ...(entry.error === undefined ? {} : { error: entry.error }) };
  }

  cancelSession(ownerId: string, sessionId: string): void {
    if (this.current?.scope.ownerId === ownerId && this.current.scope.sessionId === sessionId)
      this.cancel();
  }

  cancel(): void {
    const previous = this.current;
    this.current = null;
    previous?.controller.abort();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private begin(
    key: string,
    scope: QuizPrefetchScope,
    start: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const entry = {
      key,
      scope,
      controller,
      status: "pending" as const,
      promise: Promise.resolve(undefined as T),
    } as Entry<T>;
    this.current = entry;
    let started: Promise<T>;
    try {
      started = Promise.resolve(start(controller.signal));
    } catch (error) {
      started = Promise.reject(error);
    }
    entry.promise = started
      .then((result) => {
        if (controller.signal.aborted || this.current !== entry) throw abortError();
        entry.status = "ready";
        entry.result = result;
        return result;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.current !== entry) throw abortError();
        entry.status = "failed";
        entry.error = error;
        throw error;
      });
    return entry.promise;
  }
}
