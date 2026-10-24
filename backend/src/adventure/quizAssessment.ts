/** Private, server-graded evidence. Public history exposes only score and total. */
export type QuizFeedback = {
  questionId: string;
  question: string;
  options: string[];
  selected: number;
  correctIndex: number;
  correct: boolean;
  explanation: string;
  knowledgePoint: string;
};
export type QuizAssessment = {
  score: number;
  total: number;
  /** Optional for assessments saved before detailed feedback was introduced. */
  feedback?: QuizFeedback[];
};
