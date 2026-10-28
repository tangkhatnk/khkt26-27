import type { MaterialSource } from "./materialSources.ts";

const EMPTY_STUDY_EXERCISE_SOURCES: readonly MaterialSource[] = Object.freeze([]);

export function studyExerciseSourcesForSession(
  sourcesBySession: Readonly<Record<string, readonly MaterialSource[] | undefined>> | undefined,
  sessionId: string | null | undefined,
): readonly MaterialSource[] {
  return sessionId ? sourcesBySession?.[sessionId] ?? EMPTY_STUDY_EXERCISE_SOURCES : EMPTY_STUDY_EXERCISE_SOURCES;
}

export async function loadStudyExercisePreparationWithCurrentSources<Preparation, Source, Match>(input: {
  load: () => Promise<Preparation>;
  isCurrent: () => boolean;
  getSources: () => readonly Source[];
  match: (preparation: Preparation, sources: readonly Source[]) => Promise<Match>;
}): Promise<{ preparation: Preparation; sourceMatch: Match } | null> {
  const preparation = await input.load();
  if (!input.isCurrent()) return null;
  const sourceMatch = await input.match(preparation, input.getSources());
  if (!input.isCurrent()) return null;
  return { preparation, sourceMatch };
}

export type StudyExerciseFocusStartResult =
  | "needs-skip-choice"
  | "started-with-exercises"
  | "started-without-exercises";

export type StudyExerciseSourceMatch =
  | { status: "not-needed" | "no-local-source" }
  | { status: "matched"; sourceId: string; textFingerprint: string }
  | { status: "mismatch" };

export async function matchStudyExercisePreparationSource(input: {
  mode: "provided" | "generated";
  sourceFingerprint?: string;
  sources: readonly { id: string; text: string; reviewed: boolean }[];
  fingerprint: (text: string) => Promise<string>;
}): Promise<StudyExerciseSourceMatch> {
  if (input.mode === "provided") return { status: "not-needed" };
  for (const source of input.sources) {
    if (!source.reviewed) continue;
    const textFingerprint = await input.fingerprint(source.text);
    if (textFingerprint === input.sourceFingerprint)
      return { status: "matched", sourceId: source.id, textFingerprint };
  }
  // The private server snapshot is authoritative once a set is bound. Without
  // a source ID in the DTO, unrelated or missing local materials cannot prove
  // that the original source changed; known edits are invalidated via scope.
  return { status: "no-local-source" };
}

export function isStudyExercisePreparationSourceCurrent(input: {
  mode: "provided" | "generated";
  sourceScope: { sourceId: string; textFingerprint: string } | null;
  selectedSource: { id: string; reviewed: boolean } | null;
  sourceRevision: number;
  preparationSourceRevision: number | null;
}): boolean {
  if (input.mode === "provided") return true;
  return input.sourceScope !== null && input.selectedSource?.reviewed === true &&
    input.sourceScope.sourceId === input.selectedSource.id &&
    input.preparationSourceRevision !== null &&
    input.sourceRevision === input.preparationSourceRevision;
}

export function isStudyExerciseSetSourceCurrent(input: {
  bound: boolean;
  mode: "provided" | "generated";
  sourceFingerprint?: string;
  sourceScope: { sourceId: string; textFingerprint: string } | null;
  selectedSource: { id: string; reviewed: boolean } | null;
  sourceRevision: number;
  preparationSourceRevision: number | null;
}): boolean {
  if (input.mode === "provided" || input.bound || !input.sourceScope) return true;
  if (input.sourceFingerprint !== input.sourceScope.textFingerprint) return false;
  return isStudyExercisePreparationSourceCurrent(input);
}

export function shouldInvalidateStudyExerciseForSourceChange(input: {
  bound: boolean;
  sourceId: string | null;
  changedSourceId: string;
}): boolean {
  return !input.bound && (!input.sourceId || input.sourceId === input.changedSourceId);
}

export function startStudyExerciseFocusIfAllowed(input: {
  hasReadyPreparation: boolean;
  generationPending: boolean;
  skipConfirmed: boolean;
  cancelPending: () => void;
  startFocus: (withExercises: boolean) => void;
}): StudyExerciseFocusStartResult {
  if (input.generationPending && !input.hasReadyPreparation) {
    if (!input.skipConfirmed) return "needs-skip-choice";
    input.cancelPending();
    input.startFocus(false);
    return "started-without-exercises";
  }

  input.startFocus(input.hasReadyPreparation);
  return input.hasReadyPreparation ? "started-with-exercises" : "started-without-exercises";
}

export async function loadStudyExerciseSolutionsAfterSync<T>(input: {
  sync: () => Promise<void>;
  isScopeCurrent: () => boolean;
  isPersistedCompleted: () => boolean;
  load: () => Promise<T>;
  onRejected?: () => void;
}): Promise<T | null> {
  const reject = () => {
    input.onRejected?.();
    return null;
  };
  if (!input.isScopeCurrent()) return reject();
  await input.sync();
  if (!input.isScopeCurrent() || !input.isPersistedCompleted()) return reject();
  const result = await input.load();
  if (!input.isScopeCurrent() || !input.isPersistedCompleted()) return reject();
  return result;
}

export async function acceptStudyExercisePreparationResult<T>(input: {
  result: T;
  signal: AbortSignal;
  isCurrent: () => boolean;
  invalidate: () => Promise<unknown>;
}): Promise<T> {
  if (input.signal.aborted || !input.isCurrent()) {
    await input.invalidate().catch(() => {});
    throw new DOMException("Bộ bài tập không còn thuộc phiên đang mở.", "AbortError");
  }
  return input.result;
}
