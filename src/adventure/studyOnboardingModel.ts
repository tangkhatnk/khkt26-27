export const STUDY_ONBOARDING_VERSION = 1 as const;

export type StudySurvey = {
  goal: string;
  topicId: string;
  topicLabel: string;
  preferredMinutes: number | null;
  level: string;
  confidence: number | null;
};

export type StudyOnboardingPhase = "survey" | "tutorial" | "paused" | "complete";
export type StudyTutorialControl = "goal" | "source" | "duration" | "retrieval";
export type StudySourceChoice = "notes" | "files" | "none";

export type StudyOnboardingProgress = {
  version: typeof STUDY_ONBOARDING_VERSION;
  phase: StudyOnboardingPhase;
  surveyStep: 0 | 1;
  tutorialStep: 0 | 1 | 2 | 3;
  survey: StudySurvey;
  tutorial: { sourceChoice: StudySourceChoice | null };
  pausedFrom?: "survey" | "tutorial";
};

export type StudyOnboardingAction =
  | { type: "survey/change"; changes: Partial<StudySurvey> }
  | { type: "survey/next" }
  | { type: "survey/previous" }
  | { type: "tutorial/used"; control: StudyTutorialControl; choice?: StudySourceChoice }
  | { type: "tutorial/previous" }
  | { type: "onboarding/pause" }
  | { type: "onboarding/resume" }
  | { type: "onboarding/reopen" }
  | { type: "onboarding/edit-survey" };

export const DEFAULT_STUDY_SURVEY: StudySurvey = {
  goal: "",
  topicId: "biology",
  topicLabel: "Sinh học",
  preferredMinutes: 25,
  level: "",
  confidence: null,
};

export function syncStudySurveyWithCurrentDraft(
  survey: StudySurvey,
  draft: StudySurvey,
  currentDuration: number,
): StudySurvey {
  return {
    ...survey,
    goal: draft.goal,
    topicId: draft.topicId,
    topicLabel: draft.topicLabel,
    preferredMinutes: Number.isSafeInteger(currentDuration) && currentDuration >= 1 && currentDuration <= 240
      ? currentDuration
      : null,
    level: draft.level,
    confidence: draft.confidence,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validSurvey(value: unknown): value is StudySurvey {
  return isRecord(value) &&
    typeof value.goal === "string" && value.goal.length <= 500 &&
    typeof value.topicId === "string" && value.topicId.trim().length >= 1 && value.topicId.length <= 100 &&
    typeof value.topicLabel === "string" && value.topicLabel.trim().length >= 1 && value.topicLabel.length <= 100 &&
    (value.preferredMinutes === null || (typeof value.preferredMinutes === "number" && Number.isFinite(value.preferredMinutes))) &&
    typeof value.level === "string" && value.level.length <= 100 &&
    (value.confidence === null || (Number.isSafeInteger(value.confidence) && Number(value.confidence) >= 1 && Number(value.confidence) <= 4));
}

function validSourceChoice(value: unknown): value is StudySourceChoice {
  return value === "notes" || value === "files" || value === "none";
}

export function createStudyOnboardingProgress(survey: Partial<StudySurvey> = {}): StudyOnboardingProgress {
  return {
    version: STUDY_ONBOARDING_VERSION,
    phase: "survey",
    surveyStep: 0,
    tutorialStep: 0,
    survey: { ...DEFAULT_STUDY_SURVEY, ...survey },
    tutorial: { sourceChoice: null },
  };
}

export function isValidStudyOnboardingProgress(value: unknown): value is StudyOnboardingProgress {
  if (!isRecord(value) || value.version !== STUDY_ONBOARDING_VERSION ||
      typeof value.phase !== "string" || !["survey", "tutorial", "paused", "complete"].includes(value.phase) ||
      (value.surveyStep !== 0 && value.surveyStep !== 1) ||
      !Number.isSafeInteger(value.tutorialStep) || ![0, 1, 2, 3].includes(Number(value.tutorialStep)) || !validSurvey(value.survey) ||
      !isRecord(value.tutorial) ||
      !(value.tutorial.sourceChoice === null || validSourceChoice(value.tutorial.sourceChoice))) return false;
  if (value.phase === "paused")
    return value.pausedFrom === "survey" || value.pausedFrom === "tutorial";
  return value.pausedFrom === undefined;
}

function surveyStepIsValid(progress: StudyOnboardingProgress): boolean {
  if (progress.surveyStep === 0)
    return progress.survey.goal.trim().length >= 3 &&
      progress.survey.topicId.trim().length > 0 && progress.survey.topicLabel.trim().length > 0;
  return progress.survey.preferredMinutes !== null &&
    Number.isSafeInteger(progress.survey.preferredMinutes) &&
    progress.survey.preferredMinutes >= 1 && progress.survey.preferredMinutes <= 240 &&
    progress.survey.level.length <= 100 &&
    (progress.survey.confidence === null ||
      (Number.isSafeInteger(progress.survey.confidence) && progress.survey.confidence >= 1 && progress.survey.confidence <= 4));
}

const tutorialControlByStep: StudyTutorialControl[] = ["goal", "source", "duration", "retrieval"];

export function reduceStudyOnboardingProgress(
  state: StudyOnboardingProgress,
  action: StudyOnboardingAction,
): StudyOnboardingProgress {
  if (!isValidStudyOnboardingProgress(state)) return createStudyOnboardingProgress();
  switch (action.type) {
    case "survey/change":
      if (state.phase !== "survey" && state.phase !== "tutorial") return state;
      return { ...state, survey: { ...state.survey, ...action.changes } };
    case "survey/next":
      if (state.phase !== "survey" || !surveyStepIsValid(state)) return state;
      if (state.surveyStep === 0) return { ...state, surveyStep: 1 };
      return { ...state, phase: "tutorial", tutorialStep: 0, tutorial: { sourceChoice: null } };
    case "survey/previous":
      return state.phase === "survey" && state.surveyStep === 1 ? { ...state, surveyStep: 0 } : state;
    case "tutorial/used": {
      if (state.phase !== "tutorial" || tutorialControlByStep[state.tutorialStep] !== action.control) return state;
      if (action.control === "goal" && state.survey.goal.trim().length < 3) return state;
      if (action.control === "duration" &&
          (!Number.isSafeInteger(state.survey.preferredMinutes) || state.survey.preferredMinutes === null ||
           state.survey.preferredMinutes < 1 || state.survey.preferredMinutes > 240)) return state;
      if (action.control === "source" && !validSourceChoice(action.choice)) return state;
      if (action.control === "source") {
        return { ...state, tutorialStep: 2, tutorial: { sourceChoice: action.choice! } };
      }
      if (state.tutorialStep === 3) return { ...state, phase: "complete" };
      return { ...state, tutorialStep: (state.tutorialStep + 1) as StudyOnboardingProgress["tutorialStep"] };
    }
    case "tutorial/previous":
      if (state.phase !== "tutorial") return state;
      if (state.tutorialStep > 0)
        return { ...state, tutorialStep: (state.tutorialStep - 1) as StudyOnboardingProgress["tutorialStep"] };
      return { ...state, phase: "survey", surveyStep: 1 };
    case "onboarding/pause":
      if (state.phase !== "survey" && state.phase !== "tutorial") return state;
      return { ...state, phase: "paused", pausedFrom: state.phase };
    case "onboarding/resume":
      if (state.phase !== "paused" || !state.pausedFrom) return state;
      return { ...state, phase: state.pausedFrom, pausedFrom: undefined };
    case "onboarding/reopen":
      return state.phase === "complete"
        ? { ...state, phase: "tutorial", tutorialStep: 0, tutorial: { sourceChoice: null } }
        : state;
    case "onboarding/edit-survey":
      return state.phase === "complete" ? { ...state, phase: "survey", surveyStep: 0 } : state;
  }
}

export function reopenStudyOnboardingFromDraft(
  progress: StudyOnboardingProgress,
  draft: StudySurvey,
): StudyOnboardingProgress {
  return reduceStudyOnboardingProgress({
    ...progress,
    survey: { ...draft },
  }, { type: "onboarding/reopen" });
}

export function completeStudyOnboardingRetrievalChoice(
  progress: StudyOnboardingProgress,
): StudyOnboardingProgress {
  if (progress.phase !== "tutorial" || progress.tutorialStep !== 3) return progress;
  return reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "retrieval" });
}

export function canShowStudyOnboarding(
  loaded: boolean,
  activeSession: unknown,
  progress: unknown,
): boolean {
  if (!loaded || activeSession) return false;
  return !isValidStudyOnboardingProgress(progress) || progress.phase !== "complete";
}
