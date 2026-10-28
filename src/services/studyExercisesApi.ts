import { request } from "./api";

export type StudyExerciseMode = "provided" | "generated";
export type StudyExerciseQuestion = {
  id: string;
  prompt: string;
  choices?: string[];
};
export type StudyExercisePreparationResponse = {
  id: string;
  plannedSessionId: string;
  exercises: StudyExerciseQuestion[];
} & (
  | { mode: "provided" }
  | { mode: "generated"; sourceFingerprint: string }
);
export type StudyExerciseSolution = {
  id: string;
  solution: string;
  explanation: string;
};
export type StudyExerciseSolutionResponse = { exercises: StudyExerciseSolution[] };
export type StudyExercisePreparationInput =
  | { requestId: string; plannedSessionId: string; mode: "provided"; text: string }
  | { requestId: string; plannedSessionId: string; mode: "generated"; text: string; count: number };

export function prepareStudyExercises(
  input: StudyExercisePreparationInput,
  signal?: AbortSignal,
) {
  return request<StudyExercisePreparationResponse>("/study-exercises", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function getStudyExercisesForSession(plannedSessionId: string, signal?: AbortSignal) {
  return request<StudyExercisePreparationResponse>(
    `/study-exercises/session/${encodeURIComponent(plannedSessionId)}`,
    { method: "GET", signal },
  );
}

export function getStudyExercise(id: string, signal?: AbortSignal) {
  return request<StudyExercisePreparationResponse>(
    `/study-exercises/${encodeURIComponent(id)}`,
    { method: "GET", signal },
  );
}

export function bindStudyExercises(plannedSessionId: string, signal?: AbortSignal) {
  return request<{ ok: true }>(
    `/study-exercises/session/${encodeURIComponent(plannedSessionId)}/bind`,
    { method: "POST", signal },
  );
}

export function invalidateStudyExercises(plannedSessionId: string, requestId: string, signal?: AbortSignal) {
  return request<{ ok: true }>(
    `/study-exercises/session/${encodeURIComponent(plannedSessionId)}/requests/${encodeURIComponent(requestId)}`,
    { method: "DELETE", signal },
  );
}

export function requestStudyExerciseSolutions(id: string, signal?: AbortSignal) {
  return request<StudyExerciseSolutionResponse>(
    `/study-exercises/${encodeURIComponent(id)}/solution`,
    { method: "POST", signal },
  );
}
