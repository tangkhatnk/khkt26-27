import { z } from "zod";

export const MAX_STUDY_EXERCISE_TEXT_CHARACTERS = 20_000;
export const DEFAULT_STUDY_EXERCISE_COUNT = 3;
export const MAX_GENERATED_STUDY_EXERCISES = 5;
export const MAX_STUDY_EXERCISES = 20;

export const studyExerciseTypeSchema = z.enum([
  "multiple-choice",
  "true-false",
  "short-answer",
  "essay",
]);
export type StudyExerciseType = z.infer<typeof studyExerciseTypeSchema>;

export const studyExerciseCountsSchema = z.object({
  multipleChoice: z.number().int().min(0).max(MAX_GENERATED_STUDY_EXERCISES),
  trueFalse: z.number().int().min(0).max(MAX_GENERATED_STUDY_EXERCISES),
  shortAnswer: z.number().int().min(0).max(MAX_GENERATED_STUDY_EXERCISES),
  essay: z.number().int().min(0).max(MAX_GENERATED_STUDY_EXERCISES),
}).strict().superRefine((counts, context) => {
  const total = counts.multipleChoice + counts.trueFalse + counts.shortAnswer + counts.essay;
  if (total < 1 || total > MAX_STUDY_EXERCISES)
    context.addIssue({ code: "custom", message: "Choose between 1 and 20 study exercises." });
});

export type StudyExerciseCounts = z.infer<typeof studyExerciseCountsSchema>;

const problemText = z.string().min(1).max(MAX_STUDY_EXERCISE_TEXT_CHARACTERS)
  .refine((value) => value.trim().length > 0, "Problem text must contain non-whitespace characters.");
const questionText = z.string().min(1).max(MAX_STUDY_EXERCISE_TEXT_CHARACTERS)
  .refine((value) => value.trim().length > 0, "Question text must contain non-whitespace characters.");

const providedRequestSchema = z.object({
  requestId: z.uuid(),
  plannedSessionId: z.uuid(),
  mode: z.literal("provided"),
  text: problemText,
}).strict();

const generatedRequestSchema = z.object({
  requestId: z.uuid(),
  plannedSessionId: z.uuid(),
  mode: z.literal("generated"),
  text: problemText,
  count: z.number().int().min(1).max(MAX_GENERATED_STUDY_EXERCISES).optional(),
  counts: studyExerciseCountsSchema.optional(),
}).strict();

export type StudyExercisePreparationInput =
  | { requestId: string; plannedSessionId: string; mode: "provided"; text: string }
  | { requestId: string; plannedSessionId: string; mode: "generated"; text: string; count: number }
  | { requestId: string; plannedSessionId: string; mode: "generated"; text: string; counts: StudyExerciseCounts };

export const studyExercisePreparationRequestSchema = z.union([
  providedRequestSchema,
  generatedRequestSchema,
]).superRefine((input, context) => {
  if (input.mode === "generated" && input.count !== undefined && input.counts !== undefined) {
    context.addIssue({ code: "custom", message: "Use either count or counts, not both.", path: ["counts"] });
  }
}).transform((input): StudyExercisePreparationInput => {
  if (input.mode !== "generated") return input;
  if (input.counts !== undefined)
    return { requestId: input.requestId, plannedSessionId: input.plannedSessionId, mode: input.mode, text: input.text, counts: input.counts };
  return {
    requestId: input.requestId,
    plannedSessionId: input.plannedSessionId,
    mode: input.mode,
    text: input.text,
    count: input.count ?? DEFAULT_STUDY_EXERCISE_COUNT,
  };
});

export type StudyExerciseMode = StudyExercisePreparationInput["mode"];

const choices = z.array(z.string().trim().min(1).max(2_000)).min(2).max(8)
  .superRefine((items, context) => {
    const normalized = items.map((item) => item.replace(/\s+/gu, " ").toLocaleLowerCase("vi"));
    if (new Set(normalized).size !== normalized.length)
      context.addIssue({ code: "custom", message: "Choices must be distinct." });
  });

/** Public question DTO. Deliberately excludes every answer/solution field. */
export const studyExerciseQuestionSchema = z.object({
  id: z.uuid(),
  prompt: questionText,
  choices: choices.optional(),
  type: studyExerciseTypeSchema.optional(),
}).strict();

export type StudyExerciseQuestion = z.infer<typeof studyExerciseQuestionSchema>;

/** Private provider contract: evidence is persisted server-side, never returned as a question DTO. */
export const studyExerciseProviderQuestionSchema = z.object({
  prompt: questionText,
  choices: choices.optional(),
  evidenceExcerpt: z.string().min(5).max(2_000),
  type: studyExerciseTypeSchema.optional(),
}).strict();

export const studyExerciseProviderResponseSchema = z.object({
  exercises: z.array(studyExerciseProviderQuestionSchema)
    .min(1).max(MAX_STUDY_EXERCISES),
}).strict();

export type StudyExerciseProviderQuestion = z.infer<typeof studyExerciseProviderQuestionSchema>;

const studyExerciseQuestionList = z.array(studyExerciseQuestionSchema).min(1).max(MAX_STUDY_EXERCISES);
export const studyExercisePreparationResponseSchema = z.discriminatedUnion("mode", [
  z.object({
    id: z.uuid(),
    requestId: z.uuid().optional(),
    plannedSessionId: z.uuid(),
    mode: z.literal("provided"),
    exercises: studyExerciseQuestionList,
  }).strict(),
  z.object({
    id: z.uuid(),
    requestId: z.uuid().optional(),
    plannedSessionId: z.uuid(),
    mode: z.literal("generated"),
    sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    exercises: studyExerciseQuestionList,
  }).strict(),
]);

export type StudyExercisePreparationResponse = z.infer<typeof studyExercisePreparationResponseSchema>;

export const studyExerciseSolutionSchema = z.object({
  id: z.uuid(),
  solution: z.string().trim().min(1).max(10_000),
  explanation: z.string().trim().min(1).max(20_000),
}).strict();

export const studyExerciseSolutionResponseSchema = z.object({
  exercises: z.array(studyExerciseSolutionSchema).min(1).max(MAX_STUDY_EXERCISES),
}).strict();

export type StudyExerciseSolution = z.infer<typeof studyExerciseSolutionSchema>;
export type StudyExerciseSolutionResponse = z.infer<typeof studyExerciseSolutionResponseSchema>;

export const studyExerciseSolutionProviderResponseSchema = z.object({
  exercises: z.array(studyExerciseSolutionSchema).min(1).max(MAX_GENERATED_STUDY_EXERCISES),
}).strict();

const groundingStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "what", "when", "which", "with",
  "cac", "cho", "cua", "da", "duoc", "hay", "la", "mot", "nao", "nhu", "theo", "trong", "va", "voi",
]);

function sourceTerms(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("vi")
    .replace(/đ/gu, "d").match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Validates provider-generated prompts and evidence without requiring or producing an answer key. */
export function parseGroundedStudyExercises(
  value: unknown,
  sourceText: string,
  expectedComposition: number | StudyExerciseCounts,
): StudyExerciseProviderQuestion[] {
  const parsed = studyExerciseProviderResponseSchema.parse(value);
  const expectedCounts = typeof expectedComposition === "number"
    ? null
    : studyExerciseCountsSchema.parse(expectedComposition);
  const expectedCount = typeof expectedComposition === "number"
    ? expectedComposition
    : expectedComposition.multipleChoice + expectedComposition.trueFalse +
      expectedComposition.shortAnswer + expectedComposition.essay;
  if (parsed.exercises.length !== expectedCount)
    throw new Error("Provider returned an unexpected study-exercise count.");

  const actualCounts: StudyExerciseCounts = {
    multipleChoice: 0,
    trueFalse: 0,
    shortAnswer: 0,
    essay: 0,
  };

  for (const exercise of parsed.exercises) {
    if (expectedCounts) {
      if (!exercise.type)
        throw new Error("Provider omitted a requested study-exercise type.");
      const key = exercise.type === "multiple-choice" ? "multipleChoice"
        : exercise.type === "true-false" ? "trueFalse"
          : exercise.type === "short-answer" ? "shortAnswer" : "essay";
      actualCounts[key] += 1;
      if ((exercise.type === "multiple-choice" || exercise.type === "true-false") && !exercise.choices)
        throw new Error("Provider omitted choices for a closed-answer study exercise.");
      if ((exercise.type === "short-answer" || exercise.type === "essay") && exercise.choices !== undefined)
        throw new Error("Provider returned choices for an open-answer study exercise.");
      if (exercise.type === "true-false" &&
          (exercise.choices?.length !== 2 ||
           new Set(exercise.choices.map((choice) => choice.trim().toLocaleLowerCase("vi"))).size !== 2 ||
           !["đúng", "sai"].every((answer) =>
             exercise.choices?.some((choice) => choice.trim().toLocaleLowerCase("vi") === answer))))
        throw new Error("Provider returned invalid true-false choices.");
    }
    const evidence = exercise.evidenceExcerpt;
    if (!evidence.trim() || !sourceText.includes(evidence))
      throw new Error("Study-exercise evidence is not present in the reviewed source.");

    const evidenceTerms = new Set(sourceTerms(evidence).filter((term) =>
      !groundingStopWords.has(term)));
    const promptTerms = new Set(sourceTerms(exercise.prompt));
    if (![...evidenceTerms].some((term) => promptTerms.has(term)))
      throw new Error("Study exercise is not related to its source evidence.");
  }
  if (expectedCounts && Object.keys(expectedCounts).some((key) =>
    actualCounts[key as keyof StudyExerciseCounts] !== expectedCounts[key as keyof StudyExerciseCounts]))
    throw new Error("Provider returned an unexpected study-exercise type composition.");
  return parsed.exercises;
}
