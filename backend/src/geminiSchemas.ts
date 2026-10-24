import { z } from "zod";

/** Contract for the singular /quiz/generate endpoint. */
export const geminiRequestSchema = z.object({
  topic: z.string().trim().min(1).max(50).regex(/^[a-z0-9-]+$/),
  goal: z.string().trim().min(1).max(500).optional(),
  documentText: z.string().trim().min(10).max(50000).optional(),
  documentAttached: z.boolean().default(false),
  count: z.number().int().min(1).max(30).default(3),
}).strict().superRefine((value, context) => {
  if (value.documentAttached && !value.documentText)
    context.addIssue({
      code: "custom",
      path: ["documentText"],
      message: "An attached study file must have recognized source text",
    });
});

export const geminiQuestionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(500)).length(4)
    .refine(options => new Set(options.map(option => option.toLocaleLowerCase("vi"))).size === 4,
      "Answer options must be distinct"),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(4000),
  knowledgePoint: z.string().trim().min(1).max(200).optional(),
  sourceExcerpt: z.string().trim().min(5).max(1000).optional(),
}).strict();

export type GenerateQuizInput = z.input<typeof geminiRequestSchema>;
export type GeneratedQuizQuestion = z.infer<typeof geminiQuestionSchema>;

export class QuizGroundingError extends Error {
  constructor(public reason: "missing-excerpt" | "ungrounded-answer") {
    super(reason === "missing-excerpt"
      ? "AI question has no exact source excerpt"
      : "AI question is not grounded in its source excerpt");
  }
}

export type GroundedQuizCandidates = {
  questions: GeneratedQuizQuestion[];
  groundingFailure?: QuizGroundingError["reason"];
};

function normalizeEvidence(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("vi")
    .replace(/\s+/g, " ").trim();
}

const evidenceStopWords = new Set([
  "about", "after", "again", "also", "among", "because", "before", "between", "could", "does", "from", "have", "into", "more", "most", "other", "should", "their", "there", "these", "they", "this", "those", "through", "under", "using", "which", "while", "with", "would",
  "cac", "cua", "cho", "duoc", "hay", "khi", "khong", "la", "ma", "mot", "nhu", "nhung", "theo", "thi", "trong", "tu", "va", "voi",
]);

function hasSourceGrounding(question: GeneratedQuizQuestion, sourceExcerpt: string) {
  const normalizedExcerpt = normalizeEvidence(sourceExcerpt);
  const normalizedAnswer = normalizeEvidence(question.options[question.correctAnswerIndex]);
  const escapedAnswer = normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A phrase must stand on its own: "art" inside "partial chart" is not evidence.
  const answerIsQuoted = normalizedAnswer.length >= 2 &&
    new RegExp(`(?<![\\p{L}\\p{N}_])${escapedAnswer}(?![\\p{L}\\p{N}_])`, "u").test(normalizedExcerpt);
  const evidenceTerms = normalizedExcerpt.match(/[a-z0-9]+/g) ?? [];
  const reasoningTerms = new Set(
    normalizeEvidence(`${question.question} ${question.explanation}`).match(/[a-z0-9]+/g) ?? [],
  );
  const mentionsKeyTerm = evidenceTerms.some(term =>
    term.length >= 4 && !evidenceStopWords.has(term) && reasoningTerms.has(term),
  );
  return answerIsQuoted && mentionsKeyTerm;
}

function parseQuestionBatch(text: string, count: number) {
  if (Buffer.byteLength(text, "utf8") > 512 * 1024)
    throw new Error("AI output exceeds size limit");
  const questions = z.array(geminiQuestionSchema).length(count).parse(JSON.parse(text));
  if (new Set(questions.map(question => question.id)).size !== questions.length)
    throw new Error("AI question IDs must be distinct");
  return questions;
}

/** Parses one complete batch and keeps only questions that independently pass source validation. */
export function parseGroundedQuizCandidates(
  text: string,
  count: number,
  sourceText: string,
): GroundedQuizCandidates {
  const questions = parseQuestionBatch(text, count);
  const normalizedSource = normalizeEvidence(sourceText);
  const groundedQuestions: GeneratedQuizQuestion[] = [];
  let groundingFailure: GroundedQuizCandidates["groundingFailure"];
  for (const question of questions) {
    const excerpt = question.sourceExcerpt;
    if (!excerpt || !normalizedSource.includes(normalizeEvidence(excerpt))) {
      groundingFailure ??= "missing-excerpt";
      continue;
    }
    if (!hasSourceGrounding(question, excerpt)) {
      groundingFailure ??= "ungrounded-answer";
      continue;
    }
    groundedQuestions.push(question);
  }
  return { questions: groundedQuestions, groundingFailure };
}

export function parseGeneratedQuiz(text: string, count: number, sourceText?: string): GeneratedQuizQuestion[] {
  if (!sourceText) return parseQuestionBatch(text, count);
  const result = parseGroundedQuizCandidates(text, count, sourceText);
  if (result.groundingFailure) throw new QuizGroundingError(result.groundingFailure);
  return result.questions;
}
