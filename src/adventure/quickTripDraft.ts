export type QuickTripDraft = {
  goal: string;
  topic: string;
  topicLabel?: string;
  minutes: number;
  breakCount: number;
  breakMinutes: number;
  level?: string;
  confidence?: number | null;
  selectedPlanId?: string | null;
  selectedStepId?: string | null;
};

export function createQuickTripDraft(overrides: Partial<QuickTripDraft> = {}): QuickTripDraft {
  return {
    goal: "",
    topic: "biology",
    minutes: 25,
    breakCount: 0,
    breakMinutes: 5,
    ...overrides,
  };
}

/** Keep the newest controlled-input values available synchronously for route changes. */
export function updateQuickTripDraft(
  draft: { current: QuickTripDraft },
  changes: Partial<QuickTripDraft>,
): QuickTripDraft {
  draft.current = { ...draft.current, ...changes };
  return draft.current;
}

export function isValidStudyMinutes(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 240;
}

/** Keep the controlled input's raw value so invalid edits stay visible. */
export function updateQuickTripDuration(
  draft: { current: QuickTripDraft },
  minutes: number,
): { draft: QuickTripDraft; canStart: boolean } {
  const next = updateQuickTripDraft(draft, { minutes });
  return { draft: next, canStart: isValidStudyMinutes(minutes) };
}

/** Only a matching persisted curated run may reuse a legacy second-based target. */
export function isValidPersonalStudyStartDuration(
  minutes: number,
  targetSeconds: number,
  legacyRunTargetSeconds?: number,
): boolean {
  if (!Number.isSafeInteger(targetSeconds) || targetSeconds < 60 || targetSeconds > 14_400) return false;
  if (isValidStudyMinutes(minutes) && targetSeconds === minutes * 60) return true;
  return Number.isSafeInteger(legacyRunTargetSeconds) && legacyRunTargetSeconds === targetSeconds;
}
