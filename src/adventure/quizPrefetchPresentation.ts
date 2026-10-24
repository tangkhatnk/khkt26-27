export type QuizPrefetchNotice = {
  role: "status";
  message: string;
};

export type QuizPrefetchRequestIdentity = {
  ownerId: string;
  sessionId: string;
  count: number;
  sourceKey: string;
  requestGeneration: number;
};

export function isCurrentQuizPrefetchRequest(
  current: Partial<QuizPrefetchRequestIdentity> | null,
  expected: QuizPrefetchRequestIdentity,
): boolean {
  return current?.ownerId === expected.ownerId &&
    current.sessionId === expected.sessionId &&
    current.count === expected.count &&
    current.sourceKey === expected.sourceKey &&
    current.requestGeneration === expected.requestGeneration;
}

export function quizPrefetchNotice(
  status: "pending" | "ready" | "failed" | undefined,
  failureMessage: string | undefined,
  generating: boolean,
  manualError: boolean,
  questionCount: number,
): QuizPrefetchNotice | null {
  if (manualError || status === "ready" || questionCount > 0) return null;
  if (generating || status === "pending")
    return { role: "status", message: "Đang chuẩn bị câu hỏi…" };
  if (status === "failed")
    return {
      role: "status",
      message: failureMessage || "Chưa chuẩn bị sẵn được. Bạn có thể thử tạo câu hỏi ngay bây giờ.",
    };
  return null;
}
