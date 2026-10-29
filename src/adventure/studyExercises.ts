import type { MaterialSource } from "./materialSources.ts";
import type {
  StudyExerciseMode,
  StudyExercisePreparationInput,
} from "../services/studyExercisesApi.ts";

export const STUDY_EXERCISE_TEXT_LIMIT = 20_000;

export type StudyExerciseRequestScope = {
  ownerId: string;
  authGeneration: number;
  workspaceGeneration: number;
  plannedSessionId: string;
  sourceId: string;
  sourceFingerprint: string;
  requestGeneration: number;
};

export type StudyExerciseSourceFingerprint = {
  sourceId: string;
  sourceText: string;
  sourceReviewed: boolean;
  textFingerprint: string;
};

export type StudyExerciseSourceScope = {
  sourceId: string;
  textFingerprint: string;
};

export type StudyExerciseTextImportScope = {
  generation: number;
  plannedSessionId: string;
  mode: StudyExerciseMode;
};

export type StudyExerciseTextImportAction = "replace" | "append";

export type StudyExerciseConfirmationScope =
  | { mode: "provided"; exactText: string }
  | ({ mode: "generated" } & StudyExerciseSourceScope);

export async function fingerprintStudyExerciseSourceText(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function isCurrentStudyExerciseSourceFingerprint(
  fingerprintedSource: StudyExerciseSourceFingerprint | null,
  currentSource: MaterialSource | undefined,
): boolean {
  return Boolean(
    fingerprintedSource && currentSource?.reviewed &&
    fingerprintedSource.sourceId === currentSource.id &&
    fingerprintedSource.sourceText === currentSource.text &&
    fingerprintedSource.sourceReviewed === currentSource.reviewed,
  );
}

export function isCurrentStudyExerciseSourceScope(
  scope: StudyExerciseSourceScope | null,
  fingerprintedSource: StudyExerciseSourceFingerprint | null,
  currentSource: MaterialSource | undefined,
): boolean {
  return Boolean(
    scope && isCurrentStudyExerciseSourceFingerprint(fingerprintedSource, currentSource) && currentSource &&
    scope.sourceId === currentSource.id &&
    scope.textFingerprint === fingerprintedSource?.textFingerprint,
  );
}

export function isCurrentStudyExerciseConfirmation(
  confirmation: StudyExerciseConfirmationScope | null,
  mode: StudyExerciseMode,
  providedText: string,
  fingerprintedSource: StudyExerciseSourceFingerprint | null,
  currentSource: MaterialSource | undefined,
): boolean {
  if (!confirmation || confirmation.mode !== mode) return false;
  if (confirmation.mode === "provided") return confirmation.exactText === providedText;
  return isCurrentStudyExerciseSourceScope(confirmation, fingerprintedSource, currentSource);
}

export function canSubmitStudyExercisePreparation(
  input: StudyExercisePreparationInput | null,
  options: { disabled?: boolean; pending?: boolean; invalidating?: boolean; sourceFingerprintReady?: boolean } = {},
): boolean {
  return input !== null && !options.disabled && !options.pending && !options.invalidating &&
    options.sourceFingerprintReady !== false;
}

export function isCurrentStudyExerciseScope(
  expected: StudyExerciseRequestScope,
  current: StudyExerciseRequestScope,
): boolean {
  return expected.ownerId === current.ownerId &&
    expected.authGeneration === current.authGeneration &&
    expected.workspaceGeneration === current.workspaceGeneration &&
    expected.plannedSessionId === current.plannedSessionId &&
    expected.sourceId === current.sourceId &&
    expected.sourceFingerprint === current.sourceFingerprint &&
    expected.requestGeneration === current.requestGeneration;
}

export function isCurrentStudyExerciseTextImport(
  expected: StudyExerciseTextImportScope,
  current: StudyExerciseTextImportScope,
): boolean {
  return expected.generation === current.generation &&
    expected.plannedSessionId === current.plannedSessionId &&
    expected.mode === current.mode;
}

export function applyStudyExerciseTextImport(
  currentText: string,
  importedText: string,
  action: StudyExerciseTextImportAction,
): string | null {
  if (!importedText.trim() || importedText.length > STUDY_EXERCISE_TEXT_LIMIT) return null;
  const nextText = action === "replace"
    ? importedText
    : `${currentText}${currentText && !currentText.endsWith("\n") ? "\n" : ""}${importedText}`;
  return nextText.length <= STUDY_EXERCISE_TEXT_LIMIT ? nextText : null;
}

export function isReviewedStudyExerciseSource(source: MaterialSource | undefined): source is MaterialSource {
  return source?.reviewed === true && source.text.trim().length > 0 &&
    source.text.length <= STUDY_EXERCISE_TEXT_LIMIT;
}

export function createStudyExercisePreparationInput(input: {
  requestId: string;
  plannedSessionId: string;
  mode: StudyExerciseMode;
  text: string;
  count: number;
  authenticated: boolean;
  confirmed: boolean;
  selectedSource?: MaterialSource;
}): StudyExercisePreparationInput | null {
  const { requestId, plannedSessionId, mode, text } = input;
  if (!input.authenticated || !input.confirmed || !requestId || !plannedSessionId ||
      text.trim().length === 0 || text.length > STUDY_EXERCISE_TEXT_LIMIT)
    return null;
  if (mode === "generated" && (!isReviewedStudyExerciseSource(input.selectedSource) ||
      input.selectedSource.text !== text || !Number.isInteger(input.count) || input.count < 1 || input.count > 5))
    return null;
  return mode === "provided"
    ? { requestId, plannedSessionId, mode, text }
    : { requestId, plannedSessionId, mode, text, count: input.count };
}

export function canRevealStudyExerciseSolutions(
  phase: "focus" | "summary",
  solutionStatus: "locked" | "available" | "loading" | "error" | "ready",
): boolean {
  return phase === "summary" && solutionStatus === "ready";
}
