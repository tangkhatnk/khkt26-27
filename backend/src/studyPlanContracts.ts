/** Dependency-free DTOs shared by the backend planner and browser clients. */
export interface StudyPlanRequest {
  goal: string;
  topic?: string;
  level?: string;
  preferredMinutes: number;
  sourceText?: string;
  sourceFingerprint?: string;
}

export interface StudyPlanStep {
  title: string;
  action: string;
  outcome: string;
  check: string;
  sourceExcerpt?: string;
}

export interface StudyPlanResponse {
  title: string;
  steps: StudyPlanStep[];
  finalCheck?: string;
  verificationNote?: string;
}
