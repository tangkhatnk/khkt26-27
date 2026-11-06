import {
  createStudyOnboardingProgress,
  isValidStudyOnboardingProgress,
  type StudyOnboardingProgress,
  type StudySurvey,
} from "./studyOnboardingModel.ts";
import { validMaterialSources, type MaterialSource } from "./materialSources.ts";
import type { QuickTripDraft } from "./quickTripDraft.ts";

export const STUDY_PLAN_STORAGE_VERSION = 1 as const;
export const MAX_LOCAL_STUDY_PLANS = 50;
export const MAX_LOCAL_STUDY_WORKSPACE_DRAFTS = 12;

export type StudyWorkspaceMaterial = {
  sourceId?: string;
  name: string;
  size: number;
  type: string;
  status: string;
  message: string;
};

export type StudyWorkspaceDraftIdentity = {
  sessionId: string;
  planId: string | null;
  stepId: string | null;
};

export type StudyWorkspaceDraft = StudyWorkspaceDraftIdentity & {
  notes: string;
  sources: MaterialSource[];
  materials: StudyWorkspaceMaterial[];
  updatedAt: number;
};

export function studyWorkspaceSourceContentChanged(
  previous: Pick<StudyWorkspaceDraft, "notes" | "sources" | "materials"> | undefined,
  next: Pick<StudyWorkspaceDraft, "notes" | "sources" | "materials">,
): boolean {
  return !previous || previous.notes !== next.notes ||
    JSON.stringify(previous.sources) !== JSON.stringify(next.sources) ||
    JSON.stringify(previous.materials) !== JSON.stringify(next.materials);
}

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

export type StudyPlanStepContentPatch = Partial<Pick<StudyPlanStep, "action" | "outcome" | "check">>;

export type StudyPlanDraft = Omit<StudySurvey, "preferredMinutes"> & { preferredMinutes: number } & {
  breakCount: number;
  breakMinutes: number;
  selectedPlanId: string | null;
  selectedStepId: string | null;
  /** Stable local candidate when the learner has not selected a plan step. */
  candidateSessionId: string;
  quizPrefetch: { enabled: boolean; sourceConsent: boolean };
};

export type StudyPlanStorage = {
  version: typeof STUDY_PLAN_STORAGE_VERSION;
  onboarding: StudyOnboardingProgress;
  draft: StudyPlanDraft;
  plans: SavedStudyPlan[];
  workspaceDrafts: StudyWorkspaceDraft[];
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
    candidateSessionId: crypto.randomUUID(),
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
    workspaceDrafts: [],
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

/** Persist a fresh owner-local candidate after the current session has started. */
export function advanceStudyPlanCandidateAfterStart(
  storage: StudyPlanStorage,
  startedSessionId: string,
  nextSessionId: string,
): StudyPlanStorage {
  if (!isText(startedSessionId, 200, 1) || !isText(nextSessionId, 200, 1)) return storage;
  const plan = storage.plans.find((item) => item.id === storage.draft.selectedPlanId);
  const step = plan?.steps.find((item) => item.id === storage.draft.selectedStepId);
  const matchingPlan = step?.plannedSessionId === startedSessionId ? plan : undefined;
  const matchingStep = matchingPlan ? step : undefined;
  const workspaceDraft = matchingPlan && matchingStep
    ? findStudyWorkspaceDraft(storage, { sessionId: startedSessionId, planId: matchingPlan.id, stepId: matchingStep.id })
    : storage.draft.selectedPlanId === null && storage.draft.selectedStepId === null
      ? findStudyWorkspaceDraft(storage, { sessionId: startedSessionId, planId: null, stepId: null })
      : undefined;
  const workspaceDrafts = workspaceDraft
    ? [...storage.workspaceDrafts.filter((draft) => draft.sessionId !== nextSessionId), {
        ...workspaceDraft,
        sessionId: nextSessionId,
      }].slice(-MAX_LOCAL_STUDY_WORKSPACE_DRAFTS)
    : storage.workspaceDrafts;
  return {
    ...storage,
    draft: {
      ...storage.draft,
      candidateSessionId: nextSessionId,
      selectedPlanId: matchingPlan?.id ?? null,
      selectedStepId: matchingStep?.id ?? null,
    },
    plans: matchingPlan && matchingStep
      ? storage.plans.map((item) => item.id === matchingPlan.id
        ? { ...item, steps: item.steps.map((candidate) => candidate.id === matchingStep.id
          ? { ...candidate, plannedSessionId: nextSessionId }
          : candidate) }
        : item)
      : storage.plans,
    workspaceDrafts,
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
    candidateSessionId: isText(value.candidateSessionId, 200, 1)
      ? value.candidateSessionId : fallback.candidateSessionId,
    quizPrefetch: isRecord(value.quizPrefetch) && typeof value.quizPrefetch.enabled === "boolean" &&
      typeof value.quizPrefetch.sourceConsent === "boolean"
      ? { enabled: value.quizPrefetch.enabled, sourceConsent: value.quizPrefetch.sourceConsent }
      : fallback.quizPrefetch,
  };
}

function validWorkspaceDraft(value: unknown): value is StudyWorkspaceDraft {
  if (!isRecord(value) || !isText(value.sessionId, 200, 1) ||
      !(value.planId === null || isText(value.planId, 100, 1)) ||
      !(value.stepId === null || isText(value.stepId, 100, 1)) ||
      (value.planId === null) !== (value.stepId === null) ||
      typeof value.notes !== "string" || value.notes.length > 50_000 ||
      !validMaterialSources(value.sources) || !Array.isArray(value.materials) || value.materials.length > 10 ||
      !value.materials.every((item) => isRecord(item) &&
        (item.sourceId === undefined || isText(item.sourceId, 200, 1)) &&
        isText(item.name, 500, 1) && Number.isFinite(item.size) && Number(item.size) >= 0 &&
        isText(item.type, 200) && isText(item.status, 100) && isText(item.message, 2_000)) ||
      !isTimestamp(value.updatedAt)) return false;
  const sourceLength = value.sources.reduce((total, source) => total + source.name.length + source.text.length + 12, 0);
  return sourceLength <= 50_000;
}

function workspaceDraftMatchesPlan(draft: StudyWorkspaceDraft, plans: readonly SavedStudyPlan[]): boolean {
  if (draft.planId === null) return draft.stepId === null;
  const plan = plans.find((item) => item.id === draft.planId);
  const step = plan?.steps.find((item) => item.id === draft.stepId);
  return step?.plannedSessionId === draft.sessionId;
}

export function selectedStudyWorkspaceIdentity(storage: StudyPlanStorage): StudyWorkspaceDraftIdentity {
  const plan = storage.plans.find((item) => item.id === storage.draft.selectedPlanId);
  const step = plan?.steps.find((item) => item.id === storage.draft.selectedStepId);
  if (plan && step) return { sessionId: step.plannedSessionId, planId: plan.id, stepId: step.id };
  return { sessionId: storage.draft.candidateSessionId, planId: null, stepId: null };
}

export function saveStudyWorkspaceDraft(storage: StudyPlanStorage, draft: StudyWorkspaceDraft): StudyPlanStorage {
  if (!validWorkspaceDraft(draft))
    throw new Error("Nội dung vượt giới hạn lưu của buổi học. Hãy rút ngắn ghi chú hoặc gỡ bớt tài liệu.");
  if (!workspaceDraftMatchesPlan(draft, storage.plans))
    throw new Error("Bản nội dung buổi học không khớp với bước đã chọn.");
  const workspaceDrafts = [...storage.workspaceDrafts.filter((item) => item.sessionId !== draft.sessionId), draft]
    .slice(-MAX_LOCAL_STUDY_WORKSPACE_DRAFTS);
  return { ...storage, workspaceDrafts };
}

export function findStudyWorkspaceDraft(
  storage: StudyPlanStorage,
  identity: StudyWorkspaceDraftIdentity,
): StudyWorkspaceDraft | undefined {
  return storage.workspaceDrafts.find((draft) => draft.sessionId === identity.sessionId &&
    draft.planId === identity.planId && draft.stepId === identity.stepId &&
    workspaceDraftMatchesPlan(draft, storage.plans));
}

export function applyStudyPlanStepPatch(
  storage: StudyPlanStorage,
  stepId: string,
  patch: StudyPlanStepContentPatch,
  updatedAt: number,
): StudyPlanStorage | null {
  const allowedFields = new Set(["action", "outcome", "check"]);
  const patchEntries = Object.entries(patch);
  if (!stepId || !isTimestamp(updatedAt) || patchEntries.length === 0 ||
      patchEntries.some(([field, value]) => !allowedFields.has(field) || typeof value !== "string")) return null;
  const plan = storage.plans.find((item) => item.id === storage.draft.selectedPlanId);
  const selectedStep = plan?.steps.find((step) => step.id === storage.draft.selectedStepId && step.id === stepId);
  if (!plan || !selectedStep) return null;
  const updatedPlan = {
    ...plan,
    updatedAt,
    steps: plan.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
  };
  if (!validStudyPlan(updatedPlan)) return null;
  return {
    ...storage,
    plans: storage.plans.map((item) => item.id === plan.id ? updatedPlan : item),
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
  const workspaceDraftValues = Array.isArray(value.workspaceDrafts)
    ? value.workspaceDrafts.filter(validWorkspaceDraft).filter((draft) => workspaceDraftMatchesPlan(draft, plans))
    : [];
  const workspaceDraftBySession = new Map<string, StudyWorkspaceDraft>();
  for (const draft of workspaceDraftValues) workspaceDraftBySession.set(draft.sessionId, draft);
  const workspaceDrafts = [...workspaceDraftBySession.values()].slice(-MAX_LOCAL_STUDY_WORKSPACE_DRAFTS);
  const planIds = new Set(plans.map((plan) => plan.id));
  if (draft.selectedPlanId && !planIds.has(draft.selectedPlanId)) {
    draft.selectedPlanId = null;
    draft.selectedStepId = null;
  } else if (draft.selectedPlanId &&
      !plans.find((plan) => plan.id === draft.selectedPlanId)?.steps.some((step) => step.id === draft.selectedStepId)) {
    draft.selectedStepId = plans.find((plan) => plan.id === draft.selectedPlanId)?.selectedStepId ?? null;
  }

  return { version: STUDY_PLAN_STORAGE_VERSION, onboarding, draft, plans, workspaceDrafts };
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
