import {
  createStudyOnboardingProgress,
  isValidStudyOnboardingProgress,
  type StudyOnboardingProgress,
  type StudySurvey,
} from "./studyOnboardingModel.ts";
import type { QuickTripDraft } from "./quickTripDraft.ts";

export const STUDY_PLAN_STORAGE_VERSION = 1 as const;
export const MAX_LOCAL_STUDY_PLANS = 50;

export type StudyPlanStep = {
  id: string;
  plannedSessionId: string;
  title: string;
  action: string;
  outcome: string;
  check: string;
  preferredMinutes: number;
  sourceExcerpt?: string;
};

export type SavedStudyPlan = {
  id: string;
  origin: "ai" | "manual";
  title: string;
  goal: string;
  topicId: string;
  topicLabel: string;
  level: string;
  preferredMinutes: number;
  selectedStepId: string;
  createdAt: number;
  updatedAt: number;
  steps: StudyPlanStep[];
  finalCheck?: string;
  verificationNote?: string;
};

export type StudyPlanDraft = Omit<StudySurvey, "preferredMinutes"> & { preferredMinutes: number } & {
  breakCount: number;
  breakMinutes: number;
  selectedPlanId: string | null;
  selectedStepId: string | null;
  quizPrefetch: { enabled: boolean; sourceConsent: boolean };
};

export type StudyPlanStorage = {
  version: typeof STUDY_PLAN_STORAGE_VERSION;
  onboarding: StudyOnboardingProgress;
  draft: StudyPlanDraft;
  plans: SavedStudyPlan[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" && value.length <= max && value.trim().length >= min;
const isMinutes = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 240;
const isTimestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function createStudyPlanDraft(survey: Partial<StudySurvey> = {}): StudyPlanDraft {
  const preferredMinutes = isMinutes(survey.preferredMinutes) ? survey.preferredMinutes : 25;
  return {
    ...survey,
    goal: survey.goal ?? "",
    topicId: survey.topicId ?? "biology",
    topicLabel: survey.topicLabel ?? "Sinh học",
    preferredMinutes,
    level: survey.level ?? "",
    confidence: survey.confidence ?? null,
    breakCount: 0,
    breakMinutes: 5,
    selectedPlanId: null,
    selectedStepId: null,
    quizPrefetch: { enabled: false, sourceConsent: false },
  };
}

export function createStudyPlanStorage(options: { legacyActivity?: boolean } = {}): StudyPlanStorage {
  const onboarding = createStudyOnboardingProgress();
  if (options.legacyActivity) onboarding.phase = "complete";
  return {
    version: STUDY_PLAN_STORAGE_VERSION,
    onboarding,
    draft: createStudyPlanDraft(onboarding.survey),
    plans: [],
  };
}

export function updateStudyPlanDraftFromQuickTrip(
  current: StudyPlanDraft,
  draft: QuickTripDraft,
  topicLabel: string,
): StudyPlanDraft {
  return {
    ...current,
    goal: draft.goal,
    topicId: draft.topic,
    topicLabel,
    preferredMinutes: isMinutes(draft.minutes) ? draft.minutes : current.preferredMinutes,
    breakCount: Number.isSafeInteger(draft.breakCount) && draft.breakCount >= 0 && draft.breakCount <= 10
      ? draft.breakCount : current.breakCount,
    breakMinutes: Number.isSafeInteger(draft.breakMinutes) && draft.breakMinutes >= 1 && draft.breakMinutes <= 30
      ? draft.breakMinutes : current.breakMinutes,
    level: draft.level === undefined ? current.level : draft.level,
    confidence: draft.confidence === undefined ? current.confidence : draft.confidence,
    selectedPlanId: draft.selectedPlanId === undefined ? current.selectedPlanId : draft.selectedPlanId,
    selectedStepId: draft.selectedStepId === undefined ? current.selectedStepId : draft.selectedStepId,
  };
}

function validStudyPlanStep(value: unknown): value is StudyPlanStep {
  return isRecord(value) && isText(value.id, 100, 1) && isText(value.plannedSessionId, 200, 1) &&
    isText(value.title, 120, 3) && isText(value.action, 400, 3) && isText(value.outcome, 400, 3) &&
    isText(value.check, 400, 3) && isMinutes(value.preferredMinutes) &&
    (value.sourceExcerpt === undefined || isText(value.sourceExcerpt, 500, 5));
}

function validStudyPlan(value: unknown): value is SavedStudyPlan {
  if (!isRecord(value) || !isText(value.id, 100, 1) ||
      (value.origin !== "ai" && value.origin !== "manual") ||
      !isText(value.title, 120, 3) || !isText(value.goal, 500, 3) ||
      !isText(value.topicId, 100, 1) || !isText(value.topicLabel, 100, 1) ||
      !isText(value.level, 100) || !isMinutes(value.preferredMinutes) ||
      !isText(value.selectedStepId, 100, 1) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
      !Array.isArray(value.steps) || value.steps.length < (value.origin === "ai" ? 3 : 1) || value.steps.length > 8 ||
      !value.steps.every(validStudyPlanStep) ||
      !value.steps.some((step) => step.id === value.selectedStepId) ||
      (value.finalCheck !== undefined && !isText(value.finalCheck, 500, 3)) ||
      (value.verificationNote !== undefined && !isText(value.verificationNote, 500, 3))) return false;
  return true;
}

function normalizedDraft(value: unknown): StudyPlanDraft {
  if (!isRecord(value)) return createStudyPlanDraft();
  const fallback = createStudyPlanDraft();
  return {
    ...fallback,
    goal: isText(value.goal, 500) ? value.goal : fallback.goal,
    topicId: isText(value.topicId, 100, 1) ? value.topicId : fallback.topicId,
    topicLabel: isText(value.topicLabel, 100, 1) ? value.topicLabel : fallback.topicLabel,
    preferredMinutes: isMinutes(value.preferredMinutes) ? Number(value.preferredMinutes) : fallback.preferredMinutes,
    level: isText(value.level, 100) ? value.level : fallback.level,
    confidence: value.confidence === null || (Number.isSafeInteger(value.confidence) && Number(value.confidence) >= 1 && Number(value.confidence) <= 4)
      ? value.confidence as number | null : fallback.confidence,
    breakCount: Number.isSafeInteger(value.breakCount) && Number(value.breakCount) >= 0 && Number(value.breakCount) <= 10
      ? Number(value.breakCount) : fallback.breakCount,
    breakMinutes: Number.isSafeInteger(value.breakMinutes) && Number(value.breakMinutes) >= 1 && Number(value.breakMinutes) <= 30
      ? Number(value.breakMinutes) : fallback.breakMinutes,
    selectedPlanId: value.selectedPlanId === null || isText(value.selectedPlanId, 100, 1)
      ? value.selectedPlanId as string | null : fallback.selectedPlanId,
    selectedStepId: value.selectedStepId === null || isText(value.selectedStepId, 100, 1)
      ? value.selectedStepId as string | null : fallback.selectedStepId,
    quizPrefetch: isRecord(value.quizPrefetch) && typeof value.quizPrefetch.enabled === "boolean" &&
      typeof value.quizPrefetch.sourceConsent === "boolean"
      ? { enabled: value.quizPrefetch.enabled, sourceConsent: value.quizPrefetch.sourceConsent }
      : fallback.quizPrefetch,
  };
}

export function normalizeStudyPlanStorage(
  value: unknown,
  options: { legacyActivity?: boolean } = {},
): StudyPlanStorage {
  const fallback = createStudyPlanStorage(options);
  if (!isRecord(value) || value.version !== STUDY_PLAN_STORAGE_VERSION) return fallback;

  const onboarding = isValidStudyOnboardingProgress(value.onboarding)
    ? value.onboarding
    : fallback.onboarding;
  const draft = normalizedDraft(value.draft);
  const plans = Array.isArray(value.plans)
    ? value.plans.filter(validStudyPlan).slice(-MAX_LOCAL_STUDY_PLANS)
    : [];
  const planIds = new Set(plans.map((plan) => plan.id));
  if (draft.selectedPlanId && !planIds.has(draft.selectedPlanId)) {
    draft.selectedPlanId = null;
    draft.selectedStepId = null;
  } else if (draft.selectedPlanId &&
      !plans.find((plan) => plan.id === draft.selectedPlanId)?.steps.some((step) => step.id === draft.selectedStepId)) {
    draft.selectedStepId = plans.find((plan) => plan.id === draft.selectedPlanId)?.selectedStepId ?? null;
  }

  return { version: STUDY_PLAN_STORAGE_VERSION, onboarding, draft, plans };
}

export function hasLegacyStudyActivity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.active || (Array.isArray(value.pending) && value.pending.length > 0)) return true;
  if (isRecord(value.local) && isRecord(value.local.sessions) && Object.keys(value.local.sessions).length > 0) return true;
  if (isRecord(value.local) && ((isRecord(value.local.groups) && Object.keys(value.local.groups).length > 0) ||
      (isRecord(value.local.people) && Object.keys(value.local.people).length > 0))) return true;
  if (isRecord(value.snapshot) && Array.isArray(value.snapshot.sessions) && value.snapshot.sessions.length > 0) return true;
  if (isRecord(value.notes) && Object.values(value.notes).some((note) => typeof note === "string" && note.trim().length > 0)) return true;
  for (const field of [value.sources, value.materials, value.quizDrafts]) {
    if (isRecord(field) && Object.keys(field).length > 0) return true;
  }
  return false;
}
