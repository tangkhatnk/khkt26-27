import {
  CURATED_COURSES,
  type CuratedCourse,
  type CuratedLesson,
} from "./curatedCurriculum.ts";

export { CURATED_COURSES, CURRICULUM_VERSION } from "./curatedCurriculum.ts";
export type { CuratedCourse, CuratedLesson, CuratedQuestion } from "./curatedCurriculum.ts";

export const DEFAULT_COURSE_ID = "math-7-ratios";
const courseById = new Map(CURATED_COURSES.map((course) => [course.id, course]));
const lessonById = new Map(CURATED_COURSES.flatMap((course) =>
  course.lessons.map((lesson) => [lesson.id, { course, lesson }] as const),
));

export type LessonRunPhase = "lesson" | "ticket" | "focus" | "review";
export type AssessedAnswer = { questionId: string; conceptId: string; correct: boolean };
export type LearningPathProgress = {
  schemaVersion: 1;
  selectedCourseId: string;
  selectedLessonId?: string;
  selectedLessonVersion?: number;
  guideDismissed: boolean;
  completed: {
    lessonId: string;
    lessonVersion: number;
    sessionId: string;
    score: number;
    total: number;
    completedAt: number;
    assessedAnswers: AssessedAnswer[];
  }[];
  activeRun?: {
    courseId: string;
    lessonId: string;
    lessonVersion: number;
    sessionId: string;
    phase: LessonRunPhase;
  };
};

export function createLearningPathProgress(courseId = DEFAULT_COURSE_ID): LearningPathProgress {
  return {
    schemaVersion: 1,
    selectedCourseId: courseById.has(courseId) ? courseId : DEFAULT_COURSE_ID,
    guideDismissed: false,
    completed: [],
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
      item.lessonId === lesson.id,
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
      progress.completed.some((completed) => completed.lessonId === item.id))
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
      assessedAnswers.some((answer) => typeof answer.questionId !== "string" || !answer.questionId ||
        typeof answer.conceptId !== "string" || !answer.conceptId || typeof answer.correct !== "boolean") ||
      assessedAnswers.filter((answer) => answer.correct).length !== score)
    throw new Error("Invalid lesson evaluation result.");
  return {
    ...progress,
    completed: [
      ...progress.completed,
      {
        lessonId: run.lessonId,
        lessonVersion: run.lessonVersion,
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
      !Array.isArray(progress.completed))
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
        (completed.assessedAnswers !== undefined && (!Array.isArray(completed.assessedAnswers) ||
          completed.assessedAnswers.some((answer) => !answer || typeof answer !== "object" || Array.isArray(answer) ||
            typeof (answer as Record<string, unknown>).questionId !== "string" ||
            typeof (answer as Record<string, unknown>).conceptId !== "string" ||
            typeof (answer as Record<string, unknown>).correct !== "boolean")))) return false;
  }
  if (progress.activeRun === undefined) return true;
  if (!progress.activeRun || typeof progress.activeRun !== "object" || Array.isArray(progress.activeRun)) return false;
  const run = progress.activeRun as Record<string, unknown>;
  const known = typeof run.lessonId === "string" ? lessonById.get(run.lessonId) : undefined;
  return Boolean(known && run.courseId === known.course.id && run.lessonVersion === known.lesson.version &&
    typeof run.sessionId === "string" && run.sessionId.length > 0 && run.sessionId.length <= 200 &&
    ["lesson", "ticket", "focus", "review"].includes(String(run.phase)));
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
              const scored = answer as Record<string, unknown>;
              if (typeof scored.questionId !== "string" || !scored.questionId ||
                  typeof scored.conceptId !== "string" || !scored.conceptId || typeof scored.correct !== "boolean") return [];
              return [{ questionId: scored.questionId, conceptId: scored.conceptId, correct: scored.correct }];
            })
          : [];
        return [{
          lessonId: item.lessonId,
          lessonVersion: Number(item.lessonVersion),
          sessionId: item.sessionId,
          score: Number(item.score),
          total: Number(item.total),
          completedAt: Number(item.completedAt),
          assessedAnswers,
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
    ...(activeRun ? { activeRun } : {}),
  };
}
