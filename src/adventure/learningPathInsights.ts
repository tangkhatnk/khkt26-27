import {
  analyzeSession,
  type LearningSession,
} from "./learning.ts";
import type { LearningPathProgress } from "./learningPath.ts";

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
};

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dailyStudySummary(
  sessions: readonly LearningSession[],
  now = Date.now(),
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
  };
}

const clampMinutes = (minutes: number) => Math.max(5, Math.min(25, minutes));

export function durationSuggestion(
  sessions: readonly LearningSession[],
  subjectId: string,
  curatedEstimate: number,
): DurationSuggestion {
  const latest = sessions
    .filter((session) => session.topic === subjectId &&
      Number.isFinite(session.started) && Number.isFinite(session.ended) &&
      session.ended >= session.started && session.effectiveMetrics?.completed !== false)
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
