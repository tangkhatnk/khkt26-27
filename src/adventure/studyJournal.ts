export type StudyJournalQuizOrigin = "guest-ai" | "curated" | "legacy-session" | "none";

export type StudyJournalSource = {
  /** Saved session ID; it is the only value sent to the detail callback. */
  id: string;
  startedAt: number;
  goal: string;
  topic: string;
  /** Effective focused seconds after any session correction. */
  focusedSeconds: number;
  quizResult: {
    origin: StudyJournalQuizOrigin;
    correct?: number;
    total?: number;
  };
  corrected: boolean;
};

export type StudyJournalEntry = {
  id: string;
  startedAt: number;
  /** A short summary of the recorded goal, never source or material text. */
  summary: string;
  topic: string;
  focusedSeconds: number;
  quizResult: {
    origin: StudyJournalQuizOrigin;
    label: string;
    correct?: number;
    total?: number;
  };
  corrected: boolean;
};

const quizLabels: Record<StudyJournalQuizOrigin, string> = {
  "guest-ai": "Quiz AI",
  curated: "Quiz lộ trình",
  "legacy-session": "Quiz",
  none: "Chưa có quiz",
};

function boundedGoalSummary(goal: string): string {
  const normalized = goal.replace(/\s+/gu, " ").trim() || "Phiên học tập";
  const characters = Array.from(normalized);
  return characters.length <= 220
    ? normalized
    : `${characters.slice(0, 219).join("")}…`;
}

function normalizedQuizResult(result: StudyJournalSource["quizResult"]): StudyJournalEntry["quizResult"] {
  if (!result || result.origin === "none")
    return { origin: "none", label: quizLabels.none };

  const { correct, total, origin } = result;
  if (!Number.isSafeInteger(correct) || !Number.isSafeInteger(total) ||
    total! < 1 || correct! < 0 || correct! > total!)
    return { origin: "none", label: quizLabels.none };

  return {
    origin,
    label: quizLabels[origin],
    correct,
    total,
  };
}

/** Maps owner-filtered session summaries to short, newest-first journal entries. */
export function buildStudyJournalEntries(
  sources: readonly StudyJournalSource[],
): StudyJournalEntry[] {
  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) =>
      typeof source.id === "string" && source.id.length > 0 &&
      Number.isFinite(source.startedAt) && typeof source.goal === "string" &&
      typeof source.topic === "string",
    )
    .sort((first, second) => second.source.startedAt - first.source.startedAt || first.index - second.index)
    .map(({ source }) => ({
      id: source.id,
      startedAt: source.startedAt,
      summary: boundedGoalSummary(source.goal),
      topic: source.topic.trim() || "Chưa phân loại",
      focusedSeconds: Number.isFinite(source.focusedSeconds)
        ? Math.max(0, Math.floor(source.focusedSeconds))
        : 0,
      quizResult: normalizedQuizResult(source.quizResult),
      corrected: source.corrected === true,
    }));
}

export function formatStudyJournalDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const parts = [
    ...(hours ? [`${hours} giờ`] : []),
    ...(minutes ? [`${minutes} phút`] : []),
    ...(remainingSeconds || total === 0 ? [`${remainingSeconds} giây`] : []),
  ];
  return parts.join(" ");
}

export type StudyJournalLayout = "single" | "spread";

export function getStudyJournalPagePosition(
  entryCount: number,
  requestedIndex: number,
  layout: StudyJournalLayout,
) {
  const count = Number.isFinite(entryCount) ? Math.max(0, Math.floor(entryCount)) : 0;
  if (count === 0) {
    return { currentIndex: 0, visibleIndexes: [] as number[], previousDisabled: true, nextDisabled: true };
  }
  const requested = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  const currentIndex = Math.max(0, Math.min(count - 1, requested));
  if (layout === "single") {
    return {
      currentIndex,
      visibleIndexes: [currentIndex],
      previousDisabled: currentIndex === 0,
      nextDisabled: currentIndex === count - 1,
    };
  }

  const spreadStart = currentIndex - (currentIndex % 2);
  const visibleIndexes = [spreadStart];
  if (spreadStart + 1 < count) visibleIndexes.push(spreadStart + 1);
  return {
    currentIndex,
    visibleIndexes,
    previousDisabled: spreadStart === 0,
    nextDisabled: spreadStart + 2 >= count,
  };
}

export function moveStudyJournalPage(
  currentIndex: number,
  entryCount: number,
  layout: StudyJournalLayout,
  direction: -1 | 1,
): number {
  const position = getStudyJournalPagePosition(entryCount, currentIndex, layout);
  if (!position.visibleIndexes.length) return 0;
  if (layout === "single")
    return Math.max(0, Math.min(entryCount - 1, position.currentIndex + direction));
  const spreadStart = position.visibleIndexes[0]!;
  const lastSpreadStart = Math.floor((entryCount - 1) / 2) * 2;
  return Math.max(0, Math.min(lastSpreadStart, spreadStart + direction * 2));
}

export function activateStudyJournalEntry(
  sessionId: string,
  onOpenSession: (id: string) => void,
): void {
  onOpenSession(sessionId);
}
