import {
  isValidBreakPlan,
  studyElapsedSeconds,
  type BreakPlan,
} from "../../backend/src/adventure/domain.ts";
import type { StudyPlanSessionBinding, StudyPlanStorage } from "./studyPlanStorage.ts";

export type StudyPlanStartScope = {
  transition: number;
  candidateSessionId: string | null;
  selectedPlanId: string | null;
  selectedStepId: string | null;
};

/** Capture the owner-local selection that an asynchronous start is allowed to commit. */
export function captureStudyPlanStartScope(
  storage: Pick<StudyPlanStorage, "draft"> | null | undefined,
  transition: number,
): StudyPlanStartScope {
  return {
    transition,
    candidateSessionId: storage?.draft.candidateSessionId ?? null,
    selectedPlanId: storage?.draft.selectedPlanId ?? null,
    selectedStepId: storage?.draft.selectedStepId ?? null,
  };
}

export function isStudyPlanStartScopeCurrent(
  expected: StudyPlanStartScope,
  current: StudyPlanStartScope,
): boolean {
  return expected.transition === current.transition &&
    expected.candidateSessionId === current.candidateSessionId &&
    expected.selectedPlanId === current.selectedPlanId &&
    expected.selectedStepId === current.selectedStepId;
}

export type StudyPlanStepCompletionEvidence = {
  binding: StudyPlanSessionBinding | null;
  sessionId: string;
  activeSessionId: string | null;
  tripOwner: string;
  currentOwner: string;
  sessionOwner: string;
  groupId: string | null;
  started: number;
  ended: number;
  target: number;
  breakPlan?: BreakPlan;
  focusedSeconds: number;
};

/** Validate the existing local focus proof before a plan-step receipt is added. */
export function qualifiesStudyPlanStepCompletion(evidence: StudyPlanStepCompletionEvidence): boolean {
  const { binding, sessionId, activeSessionId, tripOwner, currentOwner, sessionOwner, groupId,
    started, ended, target, breakPlan, focusedSeconds } = evidence;
  if (!binding || binding.sessionId !== sessionId || activeSessionId !== sessionId ||
      tripOwner !== currentOwner || sessionOwner !== currentOwner || groupId !== null ||
      !Number.isSafeInteger(target) || target < 60 || target > 14_400 ||
      !Number.isFinite(started) || !Number.isFinite(ended) || ended < started ||
      !Number.isFinite(focusedSeconds) || focusedSeconds <= 0 ||
      (breakPlan !== undefined && !isValidBreakPlan(breakPlan, target))) return false;
  return studyElapsedSeconds(started, target, breakPlan, ended) >= target;
}
