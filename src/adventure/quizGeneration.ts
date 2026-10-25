import { quizSourceText, type MaterialSource } from "./materialSources.ts";
import type { QuizQuestion } from "./quizDrafts";

export type QuizGenerationSource = {
  topic: string;
  goal: string;
  notes: string;
  sources: MaterialSource[];
  materials: { name: string; sourceId?: string }[];
  pendingStudyGuide?: boolean;
};

export type QuizGenerationPayload = {
  topic: string;
  goal: string;
  count: number;
  documentAttached: boolean;
  documentText?: string;
};

/** Build one canonical request for both focus-time preparation and manual retry. */
export function buildQuizGenerationPayload(
  source: QuizGenerationSource,
  count: number,
): QuizGenerationPayload {
  if (source.pendingStudyGuide)
    throw new Error("Hãy xác nhận hoặc bỏ bản ôn tập AI trước khi tạo câu hỏi.");
  const text = quizSourceText(source.notes, source.sources, source.materials);
  return {
    topic: source.topic,
    goal: source.goal,
    count,
    documentAttached: Boolean(source.materials.length),
    ...(text && text.length >= 10 && text.length <= 50000 ? { documentText: text } : {}),
  };
}

/** Count is a separate scope dimension; this key captures the exact source sent to AI. */
export function quizGenerationSourceKey(payload: QuizGenerationPayload): string {
  return JSON.stringify([
    payload.topic,
    payload.goal,
    payload.documentAttached,
    payload.documentText ?? null,
  ]);
}

export function quizDraftFromQuestions(
  questions: QuizQuestion[],
  count: number,
  correctionVersion = 0,
) {
  return { correctionVersion, count, requestedCount: count, questions, answers: {} };
}
