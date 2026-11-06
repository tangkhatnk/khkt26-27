export type StudyPlanRequestContext = {
  owner: string;
  authGeneration: number;
  draftTripId: string;
  goal: string;
  topic: string;
  minutes: number;
  level: string;
  documentText: string;
  sources: unknown;
  materials: unknown;
  selectedPlanId: string | null;
  selectedStepId: string | null;
  view: string;
  activeSessionId: string | null;
  exclusive: boolean;
};

export function isCurrentStudyPlanRequest(
  expected: StudyPlanRequestContext,
  current: StudyPlanRequestContext,
): boolean {
  return expected.owner === current.owner && expected.authGeneration === current.authGeneration &&
    expected.draftTripId === current.draftTripId && expected.goal === current.goal &&
    expected.topic === current.topic && Object.is(expected.minutes, current.minutes) && expected.level === current.level &&
    expected.documentText === current.documentText && expected.sources === current.sources &&
    expected.materials === current.materials && expected.selectedPlanId === current.selectedPlanId &&
    expected.selectedStepId === current.selectedStepId && expected.view === current.view &&
    expected.activeSessionId === current.activeSessionId && expected.exclusive && current.exclusive;
}
