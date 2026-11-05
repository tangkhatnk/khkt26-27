import { request } from "./api";
import { requestGuestAi } from "./guestAiApi";

export type StudyExerciseMode = "provided" | "generated";
export type StudyExerciseType = "multiple-choice" | "true-false" | "short-answer" | "essay";
export type StudyExerciseCounts = {
  multipleChoice: number;
  trueFalse: number;
  shortAnswer: number;
  essay: number;
};
export type StudyExerciseQuestion = {
  id: string;
  prompt: string;
  choices?: string[];
  type?: StudyExerciseType;
};
export type StudyExercisePreparationResponse = {
  id: string;
  /** Guest AI cancellation key; account responses may omit it for compatibility. */
  requestId?: string;
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
  | { requestId: string; plannedSessionId: string; mode: "generated"; text: string; count: number }
  | { requestId: string; plannedSessionId: string; mode: "generated"; text: string; counts: StudyExerciseCounts };

export function prepareStudyExercises(
  input: StudyExercisePreparationInput,
  signal?: AbortSignal,
  guest = false,
) {
  const requestBody: RequestInit = {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  };
  return guest
    ? requestGuestAi<StudyExercisePreparationResponse>("/study-exercises", requestBody)
    : request<StudyExercisePreparationResponse>("/study-exercises", requestBody);
}

export function getStudyExercisesForSession(plannedSessionId: string, signal?: AbortSignal, guest = false) {
  const path = `/study-exercises/session/${encodeURIComponent(plannedSessionId)}`;
  return guest
    ? requestGuestAi<StudyExercisePreparationResponse>(path, { method: "GET", signal })
    : request<StudyExercisePreparationResponse>(path, { method: "GET", signal });
}

export function getStudyExercise(id: string, signal?: AbortSignal, guest = false) {
  const path = `/study-exercises/${encodeURIComponent(id)}`;
  return guest
    ? requestGuestAi<StudyExercisePreparationResponse>(path, { method: "GET", signal })
    : request<StudyExercisePreparationResponse>(path, { method: "GET", signal });
}

export function bindStudyExercises(
  plannedSessionId: string,
  signal?: AbortSignal,
  guest = false,
  exerciseId?: string,
) {
  const path = `/study-exercises/session/${encodeURIComponent(plannedSessionId)}/bind`;
  if (guest && !exerciseId)
    throw new Error("Chưa có bộ bài tập riêng tư để liên kết với phiên học.");
  const init = { method: "POST", body: JSON.stringify(guest ? { exerciseId } : {}), signal };
  return guest
    ? requestGuestAi<{ ok: true; exerciseId: string }>(path, init)
    : request<{ ok: true }>(path, init);
}

export function invalidateStudyExercises(plannedSessionId: string, requestId: string, signal?: AbortSignal, guest = false) {
  const path = `/study-exercises/session/${encodeURIComponent(plannedSessionId)}/requests/${encodeURIComponent(requestId)}`;
  const init = { method: "DELETE", body: JSON.stringify({}), signal };
  return guest
    ? requestGuestAi<{ ok: true }>(path, init)
    : request<{ ok: true }>(path, init);
}

export function requestStudyExerciseSolutions(id: string, signal?: AbortSignal, guest = false) {
  const path = `/study-exercises/${encodeURIComponent(id)}/solution`;
  const init = { method: "POST", body: JSON.stringify({}), signal };
  return guest
    ? requestGuestAi<StudyExerciseSolutionResponse>(path, init)
    : request<StudyExerciseSolutionResponse>(path, init);
}

export function studyExerciseRequestId(preparation: StudyExercisePreparationResponse): string {
  return preparation.requestId ?? preparation.id;
}
