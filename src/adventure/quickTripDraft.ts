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
