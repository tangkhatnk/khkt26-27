export type QuickTripDraft = {
  goal: string;
  topic: string;
  minutes: number;
  breakCount: number;
  breakMinutes: number;
};

/** Keep the newest controlled-input values available synchronously for route changes. */
export function updateQuickTripDraft(
  draft: { current: QuickTripDraft },
  changes: Partial<QuickTripDraft>,
): QuickTripDraft {
  draft.current = { ...draft.current, ...changes };
  return draft.current;
}
