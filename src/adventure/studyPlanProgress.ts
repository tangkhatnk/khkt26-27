import {
  isValidBreakPlan,
  studyElapsedSeconds,
  type BreakPlan,
} from "../../backend/src/adventure/domain.ts";
import type { StudyPlanSessionBinding } from "./studyPlanStorage.ts";

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
