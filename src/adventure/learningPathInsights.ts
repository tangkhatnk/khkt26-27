import {
  isValidBreakPlan,
  studyElapsedSeconds,
} from "../../backend/src/adventure/domain.ts";
import {
  analyzeSession,
  type LearningSession,
} from "./learning.ts";
import { CURATED_COURSES, type CuratedLesson } from "./curatedCurriculum.ts";
import type { LearningPathProgress } from "./learningPath.ts";

const currentLessons = new Map(CURATED_COURSES.flatMap((course) =>
  course.lessons.map((lesson) => [lesson.id, { version: lesson.version, lesson }] as const),
));

export type DifficultySuggestion = {
  kind: "curated-default" | "step-up" | "worked-review" | "stay";
  completedEvaluations: number;
  scoredAnswers: number;
  correctAnswers: number;
  correctRate: number | null;
};

export function difficultySuggestion(
  progress: Pick<LearningPathProgress, "completed">,
  conceptId: string,
): DifficultySuggestion {
  const evaluations = progress.completed.filter((evaluation) =>
    currentLessons.get(evaluation.lessonId)?.version === evaluation.lessonVersion &&
    evaluation.assessedAnswers?.some((answer) => answer.conceptId === conceptId),
  );
  const answers = evaluations.flatMap((evaluation) =>
    (evaluation.assessedAnswers ?? []).filter((answer) => answer.conceptId === conceptId),
  );
  const correctAnswers = answers.filter((answer) => answer.correct).length;
  const correctRate = answers.length ? correctAnswers / answers.length : null;
  const evidence = {
    completedEvaluations: evaluations.length,
    scoredAnswers: answers.length,
    correctAnswers,
    correctRate,
  };

  if (evaluations.length < 3 || answers.length < 10)
    return { kind: "curated-default", ...evidence };
  if (correctRate !== null && correctRate >= 0.8)
    return { kind: "step-up", ...evidence };
  if (correctRate !== null && correctRate <= 0.5)
    return { kind: "worked-review", ...evidence };
  return { kind: "stay", ...evidence };
}

export function workedReviewLesson(
  progress: Pick<LearningPathProgress, "completed">,
  conceptId: string,
): CuratedLesson | undefined {
  const latestByLesson = new Map<string, LearningPathProgress["completed"][number]>();
  for (const evaluation of progress.completed) {
    if (currentLessons.get(evaluation.lessonId)?.version !== evaluation.lessonVersion ||
        !evaluation.assessedAnswers?.some((answer) => answer.conceptId === conceptId)) continue;
    const previous = latestByLesson.get(evaluation.lessonId);
    if (!previous || evaluation.completedAt > previous.completedAt)
      latestByLesson.set(evaluation.lessonId, evaluation);
  }
  return [...latestByLesson.values()]
    .map((evaluation) => {
      const answers = evaluation.assessedAnswers.filter((answer) => answer.conceptId === conceptId);
      const correct = answers.filter((answer) => answer.correct).length;
      return { evaluation, lesson: currentLessons.get(evaluation.lessonId)!.lesson, rate: correct / answers.length };
    })
    .filter((item) => Number.isFinite(item.rate))
    .sort((left, right) => left.rate - right.rate || right.evaluation.completedAt - left.evaluation.completedAt)[0]?.lesson;
}

export type DurationSuggestion = {
  minutes: number;
  source: "curated-estimate" | "recent-sessions";
  sampleCount: number;
  medianFocusedMinutes: number | null;
};

export type DailyStudySummary = {
  sessionCount: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  awaySeconds: number;
  distractions: number;
  quizCount: number;
  latestQuiz: { score: number; total: number; percent: number } | null;
  curatedEvaluationCount: number;
  latestCuratedEvaluation: { lessonId: string; score: number; total: number; percent: number } | null;
};

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dailyStudySummary(
  sessions: readonly LearningSession[],
  now = Date.now(),
  curatedEvaluations: readonly LearningPathProgress["completed"][number][] = [],
): DailyStudySummary {
  const today = localDayKey(now);
  const daily = sessions.filter((session) => Number.isFinite(session.ended) && localDayKey(session.ended) === today);
  const quizResults = daily.flatMap((session) => {
    const analysis = analyzeSession(session);
    if (analysis.quizPercent === null) return [];
    const score = session.effectiveMetrics ? session.effectiveMetrics.quizScore : session.quiz?.score;
    const total = session.effectiveMetrics ? session.effectiveMetrics.quizTotal : session.quiz?.total;
    if (!Number.isSafeInteger(score) || !Number.isSafeInteger(total) || Number(total) < 1) return [];
    return [{ ended: session.ended, score: Number(score), total: Number(total), percent: analysis.quizPercent }];
  }).sort((left, right) => right.ended - left.ended);
  const dailyCurated = curatedEvaluations
    .filter((evaluation) => Number.isFinite(evaluation.completedAt) && localDayKey(evaluation.completedAt) === today)
    .sort((left, right) => right.completedAt - left.completedAt);

  return {
    sessionCount: daily.length,
    focusedSeconds: daily.reduce((total, session) => total + analyzeSession(session).focusedSeconds, 0),
    plannedBreakSeconds: daily.reduce((total, session) => {
      const planned = session.effectiveMetrics?.plannedBreakSeconds ??
        (session.breakPlan ? session.breakPlan.count * session.breakPlan.seconds : 0);
      return total + Math.max(0, planned);
    }, 0),
    actualBreakSeconds: daily.reduce((total, session) => total + analyzeSession(session).breakSeconds, 0),
    awaySeconds: daily.reduce((total, session) => {
      const analysis = analyzeSession(session);
      return total + Math.max(0, analysis.studyElapsedSeconds - analysis.focusedSeconds);
    }, 0),
    distractions: daily.reduce((total, session) => total + analyzeSession(session).distractions, 0),
    quizCount: quizResults.length,
    latestQuiz: quizResults[0]
      ? { score: quizResults[0].score, total: quizResults[0].total, percent: quizResults[0].percent }
      : null,
    curatedEvaluationCount: dailyCurated.length,
    latestCuratedEvaluation: dailyCurated[0]
      ? {
          lessonId: dailyCurated[0].lessonId,
          score: dailyCurated[0].score,
          total: dailyCurated[0].total,
          percent: Math.round((dailyCurated[0].score / dailyCurated[0].total) * 100),
        }
      : null,
  };
}

const clampMinutes = (minutes: number) => Math.max(5, Math.min(25, minutes));

export function chooseDuration(suggestion: DurationSuggestion, override?: number): number {
  return Number.isSafeInteger(override) ? clampMinutes(Number(override)) : suggestion.minutes;
}

function hasCompletedTarget(session: LearningSession): boolean {
  if (session.effectiveMetrics) return session.effectiveMetrics.completed === true;
  if (!Number.isFinite(session.started) || !Number.isFinite(session.ended) ||
      !Number.isFinite(session.target) || session.target < 1 || session.ended < session.started) return false;
  if (session.breakPlan && !isValidBreakPlan(session.breakPlan, session.target)) return false;
  return studyElapsedSeconds(session.started, session.target, session.breakPlan, session.ended) >= session.target;
}

export function durationSuggestion(
  sessions: readonly LearningSession[],
  subjectId: string,
  curatedEstimate: number,
): DurationSuggestion {
  const latest = sessions
    .filter((session) => session.topic === subjectId &&
      Number.isFinite(session.started) && Number.isFinite(session.ended) &&
      session.ended >= session.started && hasCompletedTarget(session))
    .map((session) => ({
      ended: session.ended,
      focusedSeconds: analyzeSession(session).focusedSeconds,
    }))
    .filter((session) => session.focusedSeconds > 0)
    .sort((left, right) => right.ended - left.ended)
    .slice(0, 3);

  if (latest.length < 3) {
    return {
      minutes: clampMinutes(Math.round(curatedEstimate)),
      source: "curated-estimate",
      sampleCount: latest.length,
      medianFocusedMinutes: null,
    };
  }

  const focusedMinutes = latest.map((session) => session.focusedSeconds / 60).sort((a, b) => a - b);
  const medianFocusedMinutes = focusedMinutes[1];
  return {
    minutes: clampMinutes(Math.round(medianFocusedMinutes / 5) * 5),
    source: "recent-sessions",
    sampleCount: latest.length,
    medianFocusedMinutes,
  };
}
