import {
  CURATED_COURSES,
  type CuratedCourse,
  type CuratedLesson,
} from "./curatedCurriculum.ts";
import {
  isValidBreakPlan,
  studyElapsedSeconds,
  type BreakPlan,
  type Session,
} from "../../backend/src/adventure/domain.ts";

export { CURATED_COURSES, CURRICULUM_VERSION } from "./curatedCurriculum.ts";
export type { CuratedCourse, CuratedLesson, CuratedQuestion } from "./curatedCurriculum.ts";

export const DEFAULT_COURSE_ID = "math-7-ratios";
const courseById = new Map(CURATED_COURSES.map((course) => [course.id, course]));
const lessonById = new Map(CURATED_COURSES.flatMap((course) =>
  course.lessons.map((lesson) => [lesson.id, { course, lesson }] as const),
));

export type LessonRunPhase = "lesson" | "ticket" | "focus" | "review";
export type AssessedAnswer = {
  questionId: string;
  conceptId: string;
  correct: boolean;
  prompt?: string;
  options?: string[];
  selectedIndex?: number;
  correctIndex?: number;
  explanation?: string;
};
export type InterruptedLessonRun = {
  courseId: string;
  lessonId: string;
  lessonVersion: number;
  sessionId: string;
  endedAt: number;
};
export type LearningPathProgress = {
  schemaVersion: 1;
  selectedCourseId: string;
  selectedLessonId?: string;
  selectedLessonVersion?: number;
  guideDismissed: boolean;
  completed: {
    lessonId: string;
    lessonVersion: number;
    lessonTitle?: string;
    sessionId: string;
    score: number;
    total: number;
    completedAt: number;
    assessedAnswers: AssessedAnswer[];
  }[];
  interruptedRuns: InterruptedLessonRun[];
  activeRun?: {
    courseId: string;
    lessonId: string;
    lessonVersion: number;
    sessionId: string;
    phase: LessonRunPhase;
    target?: number;
    breakPlan?: BreakPlan;
  };
};

function isValidAssessedAnswer(value: unknown): value is AssessedAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answer = value as Record<string, unknown>;
  if (typeof answer.questionId !== "string" || !answer.questionId ||
      typeof answer.conceptId !== "string" || !answer.conceptId || typeof answer.correct !== "boolean" ||
      (answer.prompt !== undefined && typeof answer.prompt !== "string") ||
      (answer.options !== undefined && (!Array.isArray(answer.options) || answer.options.length < 2 ||
        answer.options.some((option) => typeof option !== "string"))) ||
      (answer.selectedIndex !== undefined && (!Number.isSafeInteger(answer.selectedIndex) || Number(answer.selectedIndex) < 0)) ||
      (answer.correctIndex !== undefined && (!Number.isSafeInteger(answer.correctIndex) || Number(answer.correctIndex) < 0)) ||
      (answer.explanation !== undefined && typeof answer.explanation !== "string")) return false;
  if (answer.selectedIndex !== undefined && (!Array.isArray(answer.options) || Number(answer.selectedIndex) >= answer.options.length)) return false;
  if (answer.correctIndex !== undefined && (!Array.isArray(answer.options) || Number(answer.correctIndex) >= answer.options.length)) return false;
  if (answer.selectedIndex !== undefined && answer.correctIndex !== undefined &&
      (answer.selectedIndex === answer.correctIndex) !== answer.correct) return false;
  return true;
}

export function createLearningPathProgress(courseId = DEFAULT_COURSE_ID): LearningPathProgress {
  return {
    schemaVersion: 1,
    selectedCourseId: courseById.has(courseId) ? courseId : DEFAULT_COURSE_ID,
    guideDismissed: false,
    completed: [],
    interruptedRuns: [],
  };
}

export function selectLearningPathCourse(
  progress: LearningPathProgress,
  courseId: string,
): LearningPathProgress {
  if (!courseById.has(courseId)) return progress;
  return { ...progress, selectedCourseId: courseId };
}

export function selectPathLesson(
  progress: LearningPathProgress,
  course: CuratedCourse,
  lesson: CuratedLesson,
): LearningPathProgress {
  if (!course.lessons.some((item) => item.id === lesson.id && item.version === lesson.version)) return progress;
  return {
    ...progress,
    selectedCourseId: course.id,
    selectedLessonId: lesson.id,
    selectedLessonVersion: lesson.version,
  };
}

export function lessonStates(course: CuratedCourse, progress: LearningPathProgress) {
  let unlocked = true;
  return course.lessons.map((lesson) => {
    const isCompleted = progress.completed.some((item) =>
      item.lessonId === lesson.id && item.lessonVersion === lesson.version,
    );
    const isCurrent = progress.activeRun?.courseId === course.id &&
      progress.activeRun.lessonId === lesson.id &&
      progress.activeRun.lessonVersion === lesson.version;
    const status = isCurrent ? "current" as const
      : isCompleted ? "completed" as const
        : unlocked && !progress.activeRun ? "available" as const
          : "locked" as const;
    if (!isCompleted) unlocked = false;
    return { lesson, status };
  });
}

export function nextAvailableLesson(
  course: CuratedCourse,
  progress: LearningPathProgress,
): CuratedLesson | undefined {
  if (progress.activeRun) {
    if (progress.activeRun.courseId !== course.id) return undefined;
    return course.lessons.find((lesson) => lesson.id === progress.activeRun?.lessonId &&
      lesson.version === progress.activeRun.lessonVersion);
  }
  return lessonStates(course, progress).find((item) => item.status === "available")?.lesson;
}

export function beginLessonRun(
  progress: LearningPathProgress,
  course: CuratedCourse,
  lessonId: string,
  sessionId: string,
  replay = false,
): LearningPathProgress | null {
  if (!sessionId || progress.activeRun) return null;
  const lesson = replay
    ? course.lessons.find((item) => item.id === lessonId &&
      progress.completed.some((completed) => completed.lessonId === item.id &&
        completed.lessonVersion === item.version))
    : nextAvailableLesson(course, progress);
  if (!lesson || lesson.id !== lessonId) return null;
  return {
    ...progress,
    selectedCourseId: course.id,
    selectedLessonId: lesson.id,
    selectedLessonVersion: lesson.version,
    activeRun: {
      courseId: course.id,
      lessonId: lesson.id,
      lessonVersion: lesson.version,
      sessionId,
      phase: "lesson",
    },
  };
}

const phaseOrder: LessonRunPhase[] = ["lesson", "ticket", "focus", "review"];

export function setLessonRunPhase(
  progress: LearningPathProgress,
  sessionId: string,
  phase: LessonRunPhase,
): LearningPathProgress {
  const activeRun = progress.activeRun;
  if (!activeRun || activeRun.sessionId !== sessionId ||
      phaseOrder.indexOf(phase) < phaseOrder.indexOf(activeRun.phase)) return progress;
  return { ...progress, activeRun: { ...activeRun, phase } };
}

export function finishLessonFocus(
  progress: LearningPathProgress,
  session: Pick<Session, "id" | "started" | "target" | "breakPlan" | "ended">,
): LearningPathProgress {
  const run = progress.activeRun;
  if (!run || run.sessionId !== session.id || run.phase !== "focus") return progress;
  const breakPlanIsValid = !session.breakPlan || isValidBreakPlan(session.breakPlan, session.target);
  const reachedTarget = Number.isSafeInteger(session.target) && session.target > 0 && breakPlanIsValid &&
    studyElapsedSeconds(session.started, session.target, session.breakPlan, session.ended) >= session.target;
  return reachedTarget
    ? setLessonRunPhase(progress, session.id, "review")
    : {
      ...progress,
      interruptedRuns: [
        ...(progress.interruptedRuns ?? []).filter((item) => item.sessionId !== run.sessionId),
        {
          courseId: run.courseId,
          lessonId: run.lessonId,
          lessonVersion: run.lessonVersion,
          sessionId: run.sessionId,
          endedAt: session.ended,
        },
      ],
      activeRun: undefined,
    };
}

export function interruptedLessonForSession(
  progress: Pick<LearningPathProgress, "interruptedRuns">,
  sessionId: string,
): { course: CuratedCourse; lesson: CuratedLesson } | undefined {
  const interrupted = progress.interruptedRuns.find((item) => item.sessionId === sessionId);
  if (!interrupted) return undefined;
  const known = lessonById.get(interrupted.lessonId);
  return known && known.course.id === interrupted.courseId && known.lesson.version === interrupted.lessonVersion
    ? known
    : undefined;
}

export function setLessonRunPlan(
  progress: LearningPathProgress,
  sessionId: string,
  target: number,
  breakPlan?: BreakPlan,
): LearningPathProgress {
  const activeRun = progress.activeRun;
  if (!activeRun || activeRun.sessionId !== sessionId || !Number.isSafeInteger(target) ||
      target < 60 || target > 14_400 || (breakPlan !== undefined && !isValidBreakPlan(breakPlan, target)))
    return progress;
  if (activeRun.target === target && JSON.stringify(activeRun.breakPlan) === JSON.stringify(breakPlan)) return progress;
  return {
    ...progress,
    activeRun: {
      ...activeRun,
      target,
      ...(breakPlan ? { breakPlan: { ...breakPlan } } : {}),
    },
  };
}

export function completeLessonRun(
  progress: LearningPathProgress,
  sessionId: string,
  score: number,
  total: number,
  completedAt: number,
  assessedAnswers: AssessedAnswer[],
): LearningPathProgress {
  const run = progress.activeRun;
  if (!run || run.sessionId !== sessionId || run.phase !== "review")
    throw new Error("A lesson can only be completed after its review.");
  if (!Number.isSafeInteger(score) || !Number.isSafeInteger(total) || total < 1 || score < 0 || score > total ||
      !Number.isSafeInteger(completedAt) || completedAt < 0 ||
      !Array.isArray(assessedAnswers) || assessedAnswers.length !== total ||
      assessedAnswers.some((answer) => !isValidAssessedAnswer(answer)) ||
      assessedAnswers.filter((answer) => answer.correct).length !== score)
    throw new Error("Invalid lesson evaluation result.");
  return {
    ...progress,
    completed: [
      ...progress.completed,
      {
        lessonId: run.lessonId,
        lessonVersion: run.lessonVersion,
        lessonTitle: courseById.get(run.courseId)?.lessons.find((item) => item.id === run.lessonId)?.title,
        sessionId: run.sessionId,
        score,
        total,
        completedAt,
        assessedAnswers: assessedAnswers.map((answer) => ({ ...answer })),
      },
    ],
    activeRun: undefined,
  };
}

export function isValidLearningPathProgress(value: unknown): value is LearningPathProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  if (progress.schemaVersion !== 1 || typeof progress.selectedCourseId !== "string" ||
      !courseById.has(progress.selectedCourseId) || typeof progress.guideDismissed !== "boolean" ||
      ((progress.selectedLessonId === undefined) !== (progress.selectedLessonVersion === undefined)) ||
      (progress.selectedLessonId !== undefined && (!lessonById.has(String(progress.selectedLessonId)) ||
        !Number.isSafeInteger(progress.selectedLessonVersion) || Number(progress.selectedLessonVersion) < 1)) ||
      !Array.isArray(progress.completed) ||
      (progress.interruptedRuns !== undefined && (!Array.isArray(progress.interruptedRuns) ||
        progress.interruptedRuns.some((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
          const interrupted = entry as Record<string, unknown>;
          return typeof interrupted.courseId !== "string" || !interrupted.courseId || interrupted.courseId.length > 200 ||
            typeof interrupted.lessonId !== "string" || !interrupted.lessonId || interrupted.lessonId.length > 200 ||
            !Number.isSafeInteger(interrupted.lessonVersion) || Number(interrupted.lessonVersion) < 1 ||
            typeof interrupted.sessionId !== "string" || !interrupted.sessionId || interrupted.sessionId.length > 200 ||
            !Number.isSafeInteger(interrupted.endedAt) || Number(interrupted.endedAt) < 0;
        }))))
    return false;
  for (const entry of progress.completed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const completed = entry as Record<string, unknown>;
    if (typeof completed.lessonId !== "string" || completed.lessonId.length === 0 || completed.lessonId.length > 200 ||
        !Number.isSafeInteger(completed.lessonVersion) || Number(completed.lessonVersion) < 1 ||
        typeof completed.sessionId !== "string" || completed.sessionId.length === 0 || completed.sessionId.length > 200 ||
        !Number.isSafeInteger(completed.score) || Number(completed.score) < 0 ||
        !Number.isSafeInteger(completed.total) || Number(completed.total) < 1 ||
        Number(completed.score) > Number(completed.total) ||
        !Number.isSafeInteger(completed.completedAt) || Number(completed.completedAt) < 0 ||
        (completed.lessonTitle !== undefined && typeof completed.lessonTitle !== "string")) return false;
    if (completed.assessedAnswers !== undefined && (!Array.isArray(completed.assessedAnswers) ||
        completed.assessedAnswers.some((answer) => !isValidAssessedAnswer(answer)))) return false;
  }
  if (progress.activeRun === undefined) return true;
  if (!progress.activeRun || typeof progress.activeRun !== "object" || Array.isArray(progress.activeRun)) return false;
  const run = progress.activeRun as Record<string, unknown>;
  const known = typeof run.lessonId === "string" ? lessonById.get(run.lessonId) : undefined;
  const target = run.target;
  const breakPlan = run.breakPlan;
  return Boolean(known && run.courseId === known.course.id && run.lessonVersion === known.lesson.version &&
    typeof run.sessionId === "string" && run.sessionId.length > 0 && run.sessionId.length <= 200 &&
    ["lesson", "ticket", "focus", "review"].includes(String(run.phase)) &&
    (target === undefined || (Number.isSafeInteger(target) && Number(target) >= 60 && Number(target) <= 14_400)) &&
    (breakPlan === undefined || (typeof target === "number" && isValidBreakPlan(breakPlan, target))));
}

export function normalizeLearningPathProgress(value: unknown): LearningPathProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createLearningPathProgress();
  const raw = value as Record<string, unknown>;
  const selectedCourseId = typeof raw.selectedCourseId === "string" && courseById.has(raw.selectedCourseId)
    ? raw.selectedCourseId
    : DEFAULT_COURSE_ID;
  const completed = Array.isArray(raw.completed)
    ? raw.completed.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        if (typeof item.lessonId !== "string" || !item.lessonId || item.lessonId.length > 200 ||
            !Number.isSafeInteger(item.lessonVersion) || Number(item.lessonVersion) < 1 ||
            typeof item.sessionId !== "string" || !item.sessionId || item.sessionId.length > 200 ||
            !Number.isSafeInteger(item.score) || Number(item.score) < 0 ||
            !Number.isSafeInteger(item.total) || Number(item.total) < 1 || Number(item.score) > Number(item.total) ||
            !Number.isSafeInteger(item.completedAt) || Number(item.completedAt) < 0) return [];
        const assessedAnswers = Array.isArray(item.assessedAnswers)
          ? item.assessedAnswers.flatMap((answer) => {
              if (!answer || typeof answer !== "object" || Array.isArray(answer)) return [];
              if (!isValidAssessedAnswer(answer)) return [];
              return [{ ...answer, ...(answer.options ? { options: [...answer.options] } : {}) }];
            })
          : [];
        return [{
          lessonId: item.lessonId,
          lessonVersion: Number(item.lessonVersion),
          ...(typeof item.lessonTitle === "string" ? { lessonTitle: item.lessonTitle } : {}),
          sessionId: item.sessionId,
          score: Number(item.score),
          total: Number(item.total),
          completedAt: Number(item.completedAt),
          assessedAnswers,
        }];
      })
    : [];
  const interruptedRuns = Array.isArray(raw.interruptedRuns)
    ? raw.interruptedRuns.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const interrupted = entry as Record<string, unknown>;
        if (typeof interrupted.courseId !== "string" || !interrupted.courseId || interrupted.courseId.length > 200 ||
            typeof interrupted.lessonId !== "string" || !interrupted.lessonId || interrupted.lessonId.length > 200 ||
            !Number.isSafeInteger(interrupted.lessonVersion) || Number(interrupted.lessonVersion) < 1 ||
            typeof interrupted.sessionId !== "string" || !interrupted.sessionId || interrupted.sessionId.length > 200 ||
            !Number.isSafeInteger(interrupted.endedAt) || Number(interrupted.endedAt) < 0) return [];
        return [{
          courseId: interrupted.courseId,
          lessonId: interrupted.lessonId,
          lessonVersion: Number(interrupted.lessonVersion),
          sessionId: interrupted.sessionId,
          endedAt: Number(interrupted.endedAt),
        }];
      })
    : [];
  const run = raw.activeRun && typeof raw.activeRun === "object" && !Array.isArray(raw.activeRun)
    ? raw.activeRun as Record<string, unknown>
    : undefined;
  const knownRun = run && typeof run.lessonId === "string" ? lessonById.get(run.lessonId) : undefined;
  const activeRun = knownRun && run?.courseId === knownRun.course.id &&
      run.lessonVersion === knownRun.lesson.version && typeof run.sessionId === "string" &&
      run.sessionId.length > 0 && run.sessionId.length <= 200 &&
      ["lesson", "ticket", "focus", "review"].includes(String(run.phase))
    ? {
        courseId: knownRun.course.id,
        lessonId: knownRun.lesson.id,
        lessonVersion: knownRun.lesson.version,
        sessionId: run.sessionId,
        phase: run.phase as LessonRunPhase,
        ...(Number.isSafeInteger(run.target) && Number(run.target) >= 60 && Number(run.target) <= 14_400
          ? { target: Number(run.target) } : {}),
        ...(run.breakPlan && Number.isSafeInteger(run.target) && isValidBreakPlan(run.breakPlan, Number(run.target))
          ? { breakPlan: { ...(run.breakPlan as BreakPlan) } } : {}),
      }
    : undefined;
  const selectedLesson = typeof raw.selectedLessonId === "string" ? lessonById.get(raw.selectedLessonId) : undefined;
  return {
    schemaVersion: 1,
    selectedCourseId,
    ...(selectedLesson && selectedLesson.course.id === selectedCourseId &&
      raw.selectedLessonVersion === selectedLesson.lesson.version
      ? { selectedLessonId: selectedLesson.lesson.id, selectedLessonVersion: selectedLesson.lesson.version }
      : {}),
    guideDismissed: typeof raw.guideDismissed === "boolean" ? raw.guideDismissed : false,
    completed,
    interruptedRuns,
    ...(activeRun ? { activeRun } : {}),
  };
}
