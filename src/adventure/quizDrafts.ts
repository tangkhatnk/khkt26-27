import type { QuizAssessment } from "../../backend/src/adventure/quizAssessment";

export type QuizQuestionBase = {
  id: string;
  question: string;
  options: string[];
  knowledgePoint?: string;
};
export type QuizQuestion = QuizQuestionBase & { correctAnswerIndex: number; explanation: string };
export type GuestQuizQuestion = QuizQuestionBase;
export type GuestQuizGrade = {
  quizId: string;
  score: number;
  total: number;
  questions: { id: string; selected: number; correct: boolean; correctAnswerIndex: number; explanation: string }[];
};

export type QuizDraft = {
  /** Version of the server-corrected session projection used to prepare these questions. */
  correctionVersion?: number;
  /** The learner chose to skip quiz preparation before starting this session. */
  reviewSkipped?: boolean;
  /** The number of questions in the saved generation (or the selected count before generation). */
  count: number;
  /** Next generation preference; it may differ from count while saved questions are being reviewed. */
  requestedCount?: number;
  questions: (QuizQuestion | GuestQuizQuestion)[];
  answers: Record<string, number>;
  /** Private Redis deck identifier; guest grading is never copied to Session.quiz. */
  guestQuizId?: string;
  /** Private guest result retained in this device's owner-scoped draft. */
  guestGrade?: QuizAssessment;
};

export function isQuizCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 30;
}

export function canStartSessionWithQuizReview(countInput: string, reviewSkipped: boolean): boolean {
  return reviewSkipped || isQuizCount(Number(countInput));
}

function isCorrectionVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isIndex = (value: unknown, length: number) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < length;

function isQuestionBase(value: unknown): value is GuestQuizQuestion {
  if (!record(value)) return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (typeof value.id !== "string" || !uuid.test(value.id) ||
      typeof value.question !== "string" || !value.question.trim() ||
      !Array.isArray(value.options) || value.options.length !== 4 ||
      !value.options.every((option) => typeof option === "string" && !!option.trim()) ||
      new Set(value.options.map((option) => String(option).trim().toLocaleLowerCase())).size !== 4 ||
      (value.knowledgePoint !== undefined && typeof value.knowledgePoint !== "string")) return false;
  return true;
}

function isQuestion(value: unknown): value is QuizQuestion {
  if (!isQuestionBase(value)) return false;
  const question = value as Record<string, unknown>;
  return isIndex(question.correctAnswerIndex, value.options.length) &&
    typeof question.explanation === "string" && !!question.explanation.trim();
}

function isGuestQuestion(value: unknown): value is GuestQuizQuestion {
  if (!isQuestionBase(value)) return false;
  const question = value as Record<string, unknown>;
  return question.correctAnswerIndex === undefined && question.explanation === undefined;
}

export function isValidGuestQuizDeck(value: unknown): value is {
  id: string;
  plannedSessionId: string;
  questions: GuestQuizQuestion[];
} {
  return record(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.plannedSessionId === "string" && value.plannedSessionId.length > 0 &&
    Array.isArray(value.questions) && value.questions.length > 0 &&
    value.questions.every(isGuestQuestion) &&
    new Set(value.questions.map((question) => (question as GuestQuizQuestion).id)).size === value.questions.length;
}

export function isValidGuestQuizGrade(value: unknown, deck: readonly GuestQuizQuestion[]): value is GuestQuizGrade {
  if (!record(value) || typeof value.quizId !== "string" || value.quizId.length === 0 ||
      !Number.isSafeInteger(value.score) || !Number.isSafeInteger(value.total) ||
      Number(value.total) !== deck.length || Number(value.score) < 0 || Number(value.score) > Number(value.total) ||
      !Array.isArray(value.questions) || value.questions.length !== deck.length) return false;
  const ids = new Set<string>();
  let correctCount = 0;
  for (const item of value.questions) {
    if (!record(item) || typeof item.id !== "string" || ids.has(item.id) ||
        !deck.some((question) => question.id === item.id) ||
        !isIndex(item.selected, 4) || !isIndex(item.correctAnswerIndex, 4) ||
        typeof item.correct !== "boolean" || item.correct !== (item.selected === item.correctAnswerIndex) ||
        typeof item.explanation !== "string" || !item.explanation.trim()) return false;
    ids.add(item.id);
    if (item.correct) correctCount++;
  }
  return Number(value.score) === correctCount;
}

export function isValidQuizDraft(value: unknown): value is QuizDraft {
  if (!record(value) || !isQuizCount(value.count) || !Array.isArray(value.questions) ||
      !record(value.answers)) return false;
  const questions: unknown[] = value.questions;
  const answers = value.answers;
  const guestDeck = value.guestQuizId !== undefined;
  if ((value.reviewSkipped !== undefined && typeof value.reviewSkipped !== "boolean") ||
      (value.correctionVersion !== undefined && !isCorrectionVersion(value.correctionVersion)) ||
      (value.requestedCount !== undefined && !isQuizCount(value.requestedCount)) ||
      (guestDeck && (typeof value.guestQuizId !== "string" || !value.guestQuizId)) ||
      (value.guestGrade !== undefined && (!guestDeck || !isValidQuizAssessment(value.guestGrade))) ||
      questions.length > 30 || (questions.length > 0 && questions.length !== value.count) ||
      !questions.every(guestDeck ? isGuestQuestion : isQuestion)) return false;
  const validatedQuestions = questions as (QuizQuestion | GuestQuizQuestion)[];
  const ids = new Set(validatedQuestions.map((question) => question.id));
  if (ids.size !== validatedQuestions.length) return false;
  return Object.entries(answers).every(([id, selected]) => {
    const question = validatedQuestions.find((item) => item.id === id);
    return !!question && isIndex(selected, question.options.length);
  });
}

/** Legacy drafts remain eligible; only an explicit saved skip disables preparation. */
export function shouldPrefetchQuizReview(draft: Pick<QuizDraft, "reviewSkipped"> | undefined): boolean {
  return draft?.reviewSkipped !== true;
}

export function isValidQuizDraftMap(value: unknown): value is Record<string, QuizDraft> {
  return record(value) && Object.entries(value).every(([sessionId, draft]) =>
    sessionId.length > 0 && isValidQuizDraft(draft));
}

export function isValidQuizAssessment(value: unknown): value is QuizAssessment {
  if (!record(value) || !Number.isSafeInteger(value.score) || Number(value.score) < 0 ||
      !Number.isSafeInteger(value.total) || Number(value.total) < 1 || Number(value.total) > 30 ||
      Number(value.score) > Number(value.total)) return false;
  if (value.feedback === undefined) return true;
  if (!Array.isArray(value.feedback) || value.feedback.length !== value.total) return false;
  const ids = new Set<string>();
  let correctCount = 0;
  for (const item of value.feedback) {
    if (!record(item) || typeof item.questionId !== "string" || !item.questionId ||
        ids.has(item.questionId) || typeof item.question !== "string" ||
        !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4 ||
        !item.options.every((option) => typeof option === "string") ||
        !isIndex(item.selected, item.options.length) || !isIndex(item.correctIndex, item.options.length) ||
        typeof item.correct !== "boolean" || item.correct !== (item.selected === item.correctIndex) ||
      typeof item.explanation !== "string" ||
        typeof item.knowledgePoint !== "string") return false;
    ids.add(item.questionId);
    if (item.correct) correctCount++;
  }
  return Number(value.score) === correctCount;
}

export type QuizRequestToken = { ownerId: string; sessionId: string; sequence: number };

/** Tracks only the latest generation or grading request for one mounted panel. */
export class QuizRequestGuard {
  private sequence = 0;

  begin(ownerId: string, sessionId: string): QuizRequestToken {
    this.sequence += 1;
    return { ownerId, sessionId, sequence: this.sequence };
  }

  isCurrent(token: QuizRequestToken, ownerId: string, sessionId: string): boolean {
    return token.ownerId === ownerId && token.sessionId === sessionId &&
      token.sequence === this.sequence;
  }

  invalidate(): void {
    this.sequence += 1;
  }
}

export const emptyQuizDraft = (correctionVersion = 0): QuizDraft => ({
  correctionVersion,
  count: 3,
  questions: [],
  answers: {},
});

export function createSessionQuizDraft(
  countInput: string,
  reviewSkipped: boolean,
  correctionVersion = 0,
): QuizDraft {
  const parsedCount = Number(countInput);
  const count = isQuizCount(parsedCount) ? parsedCount : 3;
  return {
    correctionVersion,
    count,
    requestedCount: count,
    questions: [],
    answers: {},
    ...(reviewSkipped ? { reviewSkipped: true } : {}),
  };
}

/** Adopt a persisted/prefetched draft as the panel's controlled state. */
export function quizPanelDraftState(value: unknown, correctionVersion = 0): { draft: QuizDraft; countInput: string } {
  const valid = isValidQuizDraft(value) ? structuredClone(value) : null;
  const savedVersion = valid?.correctionVersion ?? 0;
  const draft = valid && savedVersion === correctionVersion
    ? { ...valid, correctionVersion }
    : {
        ...emptyQuizDraft(correctionVersion),
        ...(valid?.reviewSkipped !== undefined ? { reviewSkipped: valid.reviewSkipped } : {}),
        ...(valid ? { count: valid.requestedCount ?? valid.count, requestedCount: valid.requestedCount ?? valid.count } : {}),
      };
  return { draft, countInput: String(draft.requestedCount ?? draft.count) };
}

export function updateQuizDrafts(
  drafts: Readonly<Record<string, QuizDraft>> | undefined,
  sessionId: string,
  draft: QuizDraft | null,
): Record<string, QuizDraft> {
  const next = { ...drafts };
  if (draft) next[sessionId] = draft;
  else delete next[sessionId];
  return next;
}
