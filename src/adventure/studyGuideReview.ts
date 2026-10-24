import type { StudyGuideDraft } from "./studyGuide.ts";

export type StudyGuideDraftView = "preview" | "edit";
export type StudyGuideReviewState = { draft: StudyGuideDraft | null; view: StudyGuideDraftView };
export type StudyGuideReviewAction =
  | { type: "generated"; draft: StudyGuideDraft }
  | { type: "set-view"; view: StudyGuideDraftView }
  | { type: "edit-title"; title: string }
  | { type: "edit-text"; text: string };

export function createStudyGuideReviewState(): StudyGuideReviewState {
  return { draft: null, view: "preview" };
}

export function reduceStudyGuideReview(state: StudyGuideReviewState, action: StudyGuideReviewAction): StudyGuideReviewState {
  switch (action.type) {
    case "generated": return { draft: action.draft, view: "preview" };
    case "set-view": return { ...state, view: action.view };
    case "edit-title": return state.draft ? { ...state, draft: { ...state.draft, title: action.title } } : state;
    case "edit-text": return state.draft ? { ...state, draft: { ...state.draft, text: action.text } } : state;
  }
}
