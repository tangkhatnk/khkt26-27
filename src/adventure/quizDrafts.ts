import type { QuizAssessment } from "../../backend/src/adventure/quizAssessment";

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  knowledgePoint?: string;
};

export type QuizDraft = {
  /** The number of questions in the saved generation (or the selected count before generation). */
  count: number;
  /** Next generation preference; it may differ from count while saved questions are being reviewed. */
  requestedCount?: number;
  questions: QuizQuestion[];
  answers: Record<string, number>;
};

export function isQuizCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 30;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isIndex = (value: unknown, length: number) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < length;

function isQuestion(value: unknown): value is QuizQuestion {
  if (!record(value)) return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (typeof value.id !== "string" || !uuid.test(value.id) ||
      typeof value.question !== "string" || !value.question.trim() ||
      !Array.isArray(value.options) || value.options.length !== 4 ||
      !value.options.every((option) => typeof option === "string" && !!option.trim()) ||
      new Set(value.options.map((option) => String(option).trim().toLocaleLowerCase())).size !== 4 ||
      !isIndex(value.correctAnswerIndex, value.options.length) ||
      typeof value.explanation !== "string" || !value.explanation.trim() ||
      (value.knowledgePoint !== undefined && typeof value.knowledgePoint !== "string")) return false;
  return true;
}

export function isValidQuizDraft(value: unknown): value is QuizDraft {
  if (!record(value) || !isQuizCount(value.count) || !Array.isArray(value.questions) ||
      !record(value.answers)) return false;
  const questions: unknown[] = value.questions;
  const answers = value.answers;
  if ((value.requestedCount !== undefined && !isQuizCount(value.requestedCount)) ||
      questions.length > 30 || (questions.length > 0 && questions.length !== value.count) ||
      !questions.every(isQuestion)) return false;
  const validatedQuestions = questions as QuizQuestion[];
  const ids = new Set(validatedQuestions.map((question) => question.id));
  if (ids.size !== validatedQuestions.length) return false;
  return Object.entries(answers).every(([id, selected]) => {
    const question = validatedQuestions.find((item) => item.id === id);
    return !!question && isIndex(selected, question.options.length);
  });
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

export const emptyQuizDraft = (): QuizDraft => ({ count: 3, questions: [], answers: {} });

/** Adopt a persisted/prefetched draft as the panel's controlled state. */
export function quizPanelDraftState(value: unknown): { draft: QuizDraft; countInput: string } {
  const draft = isValidQuizDraft(value) ? structuredClone(value) : emptyQuizDraft();
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
