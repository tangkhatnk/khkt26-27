import type { QuizAssessment, QuizFeedback } from "../../backend/src/adventure/quizAssessment";
import { breakElapsedSeconds as scheduledBreakElapsedSeconds, type Session } from "../../backend/src/adventure/domain.ts";
import type { ActiveTrip } from "./focus";

export type MaterialInfo = NonNullable<ActiveTrip["materials"]>[number];
export type KnowledgeGap = {
  knowledgePoint: string;
  wrong: number;
  total: number;
  feedback: QuizFeedback[];
};
export type SessionAnalysis = {
  elapsedSeconds: number;
  studyElapsedSeconds: number;
  breakSeconds: number;
  focusedSeconds: number;
  focusPercent: number | null;
  distractions: number;
  focusLabel: string;
  focusExplanation: string;
  quizPercent: number | null;
  knowledgeLabel: string;
};
export type ReviewPlan = {
  goal: string;
  topic: string;
  minutes: number;
  documentText: string;
  materials: MaterialInfo[];
};

function elapsedContext(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (!minutes) return `${remainingSeconds} giây`;
  return remainingSeconds
    ? `${minutes} phút ${remainingSeconds} giây`
    : `${minutes} phút`;
}

export function distractionCount(session: Session): number {
  const explicit = session.distractions;
  if (Number.isSafeInteger(explicit) && explicit! >= 0) return explicit!;
  return session.segments.filter((segment) => segment.kind === "distraction").length;
}

export function analyzeSession(session: Session): SessionAnalysis {
  const elapsedSeconds = Number.isFinite(session.started) && Number.isFinite(session.ended)
    ? Math.max(0, (session.ended - session.started) / 1000)
    : 0;
  const recordedBreakSeconds = session.segments.reduce(
    (sum, segment) => sum + (segment.kind === "break" ? Math.max(0, (segment.end - segment.start) / 1000) : 0),
    0,
  );
  const breakSeconds = session.breakPlan
    ? scheduledBreakElapsedSeconds(session.started, session.target, session.breakPlan, session.ended)
    : recordedBreakSeconds;
  const studyElapsedSeconds = Math.max(0, elapsedSeconds - breakSeconds);
  const recordedFocus = Number.isFinite(session.seconds) ? Math.max(0, session.seconds) : 0;
  const focusedSeconds = Math.min(studyElapsedSeconds, recordedFocus);
  const focusPercent = studyElapsedSeconds > 0
    ? Math.min(100, (focusedSeconds / studyElapsedSeconds) * 100)
    : null;
  const distractions = distractionCount(session);
  const focusContext = `Trong ${elapsedContext(studyElapsedSeconds)} tính cả thời gian rời phiên, ghi nhận ${distractions} lần rời phiên.`;
  const interruptionReminder = distractions > 0
    ? " Bạn có thể thử tắt thông báo trước chuyến tiếp theo."
    : "";

  let focusLabel = "Chưa đủ dữ liệu";
  let focusExplanation = `${focusContext} Chuyến không ghi nhận thời lượng thực tế nên chưa đủ thời gian để đánh giá mức tập trung.${interruptionReminder}`;
  if (focusPercent !== null) {
    if (focusPercent >= 80) {
      focusLabel = "Tập trung tốt";
      focusExplanation = `${focusContext} Ít nhất 80% thời gian thực tế được tính là tập trung.${interruptionReminder}`;
    } else if (focusPercent >= 50) {
      focusLabel = "Có gián đoạn";
      focusExplanation = `${focusContext} Từ 50% đến dưới 80% thời gian thực tế được tính là tập trung.${interruptionReminder}`;
    } else {
      focusLabel = "Cần cải thiện";
      focusExplanation = `${focusContext} Dưới 50% thời gian thực tế được tính là tập trung.${interruptionReminder}`;
    }
  }

  const quiz = session.quiz;
  const quizPercent = quiz && Number.isFinite(quiz.score) && Number.isFinite(quiz.total) && quiz.total > 0
    ? Math.max(0, Math.min(100, (quiz.score / quiz.total) * 100))
    : null;
  let knowledgeLabel: string;
  if (!quiz) {
    knowledgeLabel = "Chưa có dữ liệu quiz";
  } else if (!Array.isArray(quiz.feedback) || !quiz.feedback.length) {
    knowledgeLabel = "Có điểm quiz nhưng thiếu dữ liệu theo từng câu";
  } else if (quiz.feedback.some((item) => !item.correct)) {
    knowledgeLabel = knowledgeGaps(quiz).length
      ? "Có nội dung cần ôn lại"
      : "Có câu sai nhưng chưa xác định được nội dung cần ôn";
  } else {
    knowledgeLabel = "Không ghi nhận câu sai trong quiz này";
  }

  return {
    elapsedSeconds,
    studyElapsedSeconds,
    breakSeconds,
    focusedSeconds,
    focusPercent,
    distractions,
    focusLabel,
    focusExplanation,
    quizPercent,
    knowledgeLabel,
  };
}

function normalizeKnowledgePoint(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function knowledgeGaps(quiz: QuizAssessment | undefined): KnowledgeGap[] {
  const groups = new Map<string, KnowledgeGap>();
  for (const item of quiz?.feedback ?? []) {
    const knowledgePoint = normalizeKnowledgePoint(item.knowledgePoint);
    if (!knowledgePoint) continue;
    const key = knowledgePoint.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { knowledgePoint, wrong: 0, total: 0, feedback: [] };
      groups.set(key, group);
    }
    group.total++;
    if (!item.correct) {
      group.wrong++;
      group.feedback.push(item);
    }
  }
  return [...groups.values()].filter((group) => group.wrong > 0);
}

function limitGoal(value: string): string {
  if (value.length <= 500) return value;
  let prefix = "";
  for (const character of Array.from(value)) {
    if (prefix.length + character.length > 499) break;
    prefix += character;
  }
  return `${prefix}…`;
}

export function reviewPlan(
  session: Session,
  notes: string,
  materials: MaterialInfo[] = [],
): ReviewPlan {
  const gaps = knowledgeGaps(session.quiz);
  const reviewTopics = gaps.map((gap) => gap.knowledgePoint);
  const goal = reviewTopics.length
    ? `Ôn lại: ${reviewTopics.join(", ")}`
    : `Ôn lại: ${session.goal}`;
  const target = Number.isFinite(session.target) ? session.target : 60;

  return {
    goal: limitGoal(goal),
    topic: session.topic,
    minutes: Math.max(1, Math.min(240, Math.ceil(target / 60))),
    documentText: notes,
    materials: materials.map((material) => ({ ...material })),
  };
}
