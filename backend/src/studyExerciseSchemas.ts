import { z } from "zod";

export const MAX_STUDY_EXERCISE_TEXT_CHARACTERS = 20_000;
export const DEFAULT_STUDY_EXERCISE_COUNT = 3;
export const MAX_GENERATED_STUDY_EXERCISES = 5;

const problemText = z.string().min(1).max(MAX_STUDY_EXERCISE_TEXT_CHARACTERS)
  .refine((value) => value.trim().length > 0, "Problem text must contain non-whitespace characters.");
const questionText = z.string().min(1).max(MAX_STUDY_EXERCISE_TEXT_CHARACTERS)
  .refine((value) => value.trim().length > 0, "Question text must contain non-whitespace characters.");

export const studyExercisePreparationRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    requestId: z.uuid(),
    plannedSessionId: z.uuid(),
    mode: z.literal("provided"),
    text: problemText,
  }).strict(),
  z.object({
    requestId: z.uuid(),
    plannedSessionId: z.uuid(),
    mode: z.literal("generated"),
    text: problemText,
    count: z.number().int().min(1).max(MAX_GENERATED_STUDY_EXERCISES)
      .default(DEFAULT_STUDY_EXERCISE_COUNT),
  }).strict(),
]);

export type StudyExercisePreparationInput = z.infer<typeof studyExercisePreparationRequestSchema>;
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
}).strict();

export type StudyExerciseQuestion = z.infer<typeof studyExerciseQuestionSchema>;

/** Private provider contract: evidence is persisted server-side, never returned as a question DTO. */
export const studyExerciseProviderQuestionSchema = z.object({
  prompt: questionText,
  choices: choices.optional(),
  evidenceExcerpt: z.string().min(5).max(2_000),
}).strict();

export const studyExerciseProviderResponseSchema = z.object({
  exercises: z.array(studyExerciseProviderQuestionSchema)
    .min(1).max(MAX_GENERATED_STUDY_EXERCISES),
}).strict();

export type StudyExerciseProviderQuestion = z.infer<typeof studyExerciseProviderQuestionSchema>;

const studyExerciseQuestionList = z.array(studyExerciseQuestionSchema).min(1).max(MAX_GENERATED_STUDY_EXERCISES);
export const studyExercisePreparationResponseSchema = z.discriminatedUnion("mode", [
  z.object({
    id: z.uuid(),
    plannedSessionId: z.uuid(),
    mode: z.literal("provided"),
    exercises: studyExerciseQuestionList,
  }).strict(),
  z.object({
    id: z.uuid(),
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
  exercises: z.array(studyExerciseSolutionSchema).min(1).max(MAX_GENERATED_STUDY_EXERCISES),
}).strict();

export type StudyExerciseSolution = z.infer<typeof studyExerciseSolutionSchema>;
export type StudyExerciseSolutionResponse = z.infer<typeof studyExerciseSolutionResponseSchema>;

export const studyExerciseSolutionProviderResponseSchema = studyExerciseSolutionResponseSchema;

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
  expectedCount: number,
): StudyExerciseProviderQuestion[] {
  const parsed = studyExerciseProviderResponseSchema.parse(value);
  if (parsed.exercises.length !== expectedCount)
    throw new Error("Provider returned an unexpected study-exercise count.");

  for (const exercise of parsed.exercises) {
    const evidence = exercise.evidenceExcerpt;
    if (!evidence.trim() || !sourceText.includes(evidence))
      throw new Error("Study-exercise evidence is not present in the reviewed source.");

    const evidenceTerms = new Set(sourceTerms(evidence).filter((term) =>
      !groundingStopWords.has(term)));
    const promptTerms = new Set(sourceTerms(exercise.prompt));
    if (![...evidenceTerms].some((term) => promptTerms.has(term)))
      throw new Error("Study exercise is not related to its source evidence.");
  }
  return parsed.exercises;
}
