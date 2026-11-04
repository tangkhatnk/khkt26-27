import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CuratedCourse, CuratedLesson } from "./curatedCurriculum.ts";
import type { AssessedAnswer, LearningPathProgress } from "./learningPath.ts";
import type { DailyStudySummary, DifficultySuggestion, DurationSuggestion } from "./learningPathInsights.ts";
import { chooseDuration } from "./learningPathInsights.ts";
import "./learningPath.css";

type LessonStatus = "available" | "current" | "completed" | "locked";
type LessonState = { lesson: CuratedLesson; status: LessonStatus };

function Buddy({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={compact ? "learning-buddy learning-buddy--small" : "learning-buddy"}
      viewBox="0 0 132 132"
      role="img"
      aria-label="Người bạn học, một sinh vật nhỏ đội lá"
    >
      <ellipse cx="66" cy="119" rx="38" ry="7" fill="#182a2340" />
      <path d="M28 65c0-23 15-40 38-40s38 17 38 40v27c0 12-10 21-22 21H50c-12 0-22-9-22-21V65Z" fill="#e7b87e" stroke="#76563b" strokeWidth="3" />
      <path d="M35 69c0-18 12-31 31-31s31 13 31 31v21c0 10-8 17-18 17H53c-10 0-18-7-18-17V69Z" fill="#eff5d8" />
      <path d="M55 28c2-13 11-21 25-23-1 12-8 20-21 23m6 3c7-11 16-13 26-11-4 10-12 15-24 13" fill="#75a677" stroke="#426b50" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="55" cy="69" r="3.2" fill="#263b34" />
      <circle cx="78" cy="69" r="3.2" fill="#263b34" />
      <path d="M58 81c5 5 12 5 17 0" fill="none" stroke="#263b34" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M36 85c-8 2-12 8-11 15 7 1 13-2 17-8m55-2c8 2 12 8 11 15-7 1-13-2-17-8" fill="#d89a63" stroke="#76563b" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M47 105h38l-3 12H50l-3-12Z" fill="#5b8d77" stroke="#426b50" strokeWidth="2" />
      <path d="M54 109h24" stroke="#f0d9a8" strokeWidth="2" strokeLinecap="round" />
      <path d="m103 37 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#e5a758" />
    </svg>
  );
}

function CourseIcon({ subjectId }: { subjectId: string }) {
  if (subjectId === "mathematics") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 14 10M19 7 5 17M12 3v18M3 12h18" /></svg>;
  if (subjectId === "physics") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" /></svg>;
  if (subjectId === "biology") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5c-8 0-13 4-13 10a4 4 0 0 0 4 4c6 0 10-5 9-14Z" /><path d="M4 21c3-5 7-8 12-11" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5c3-1 6-.5 8 1.5 2-2 5-2.5 8-1.5V19c-3-1-6-.5-8 1.5-2-2-5-2.5-8-1.5v-12Z" /><path d="M12 8v12" /></svg>;
}

function RouteNodeIcon({ status, milestone }: { status: LessonStatus; milestone: boolean }) {
  if (status === "locked") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (status === "completed") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg>;
  if (milestone) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.4l6-.9L12 3Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>;
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} phút`;
}

function routeRailPath(nodeCount: number): string {
  if (!nodeCount) return "";
  const point = (index: number) => ({
    x: index % 2 === 0 ? 44 : 56,
    y: ((index + 0.5) / nodeCount) * 1000,
  });
  const first = point(0);
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < nodeCount; index += 1) {
    const previous = point(index - 1);
    const next = point(index);
    const middleY = (previous.y + next.y) / 2;
    commands.push(`C ${previous.x} ${middleY} ${next.x} ${middleY} ${next.x} ${next.y}`);
  }
  return commands.join(" ");
}

function PathGuide({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="learning-guide" aria-labelledby="learning-guide-title">
      <div className="learning-guide__copy">
        <span className="learning-guide__eyebrow">CÁCH DÙNG LỘ TRÌNH</span>
        <p id="learning-guide-title">Đọc bài → chuẩn bị → tập trung → tự kiểm tra. Kết quả được lưu riêng trên thiết bị.</p>
      </div>
      <button className="learning-guide__dismiss" type="button" onClick={onDismiss}>Bỏ qua hướng dẫn</button>
    </section>
  );
}

type HomeProps = {
  courses: readonly CuratedCourse[];
  course: CuratedCourse;
  progress: LearningPathProgress;
  lessonStates: readonly LessonState[];
  nextLesson?: CuratedLesson;
  reviewLesson?: CuratedLesson;
  daily: DailyStudySummary;
  difficulty: DifficultySuggestion;
  duration: DurationSuggestion;
  guideOpen: boolean;
  existingSessionGoal?: string;
  ownGoalForm?: ReactNode;
  onSelectCourse: (courseId: string) => void;
  onOpenLesson: (lesson: CuratedLesson) => void;
  onResume: () => void;
  onResumeExistingSession: () => void;
  onOpenGuide: () => void;
  onDismissGuide: () => void;
  onNavigate: (view: string) => void;
};

export function LearningPathHome({
  courses,
  course,
  progress,
  lessonStates,
  nextLesson,
  reviewLesson,
  daily,
  difficulty,
  duration,
  guideOpen,
  existingSessionGoal,
  ownGoalForm,
  onSelectCourse,
  onOpenLesson,
  onResume,
  onResumeExistingSession,
  onOpenGuide,
  onDismissGuide,
  onNavigate,
}: HomeProps) {
  const active = progress.activeRun;
  const recommendedLesson = difficulty.kind === "worked-review" ? reviewLesson : nextLesson;
  const difficultyCopy = difficulty.kind === "step-up"
    ? "Các câu tự kiểm tra gần đây đạt từ 80% trở lên. Bài vận dụng tiếp theo đang mở."
    : difficulty.kind === "worked-review"
      ? "Các câu tự kiểm tra gần đây đạt không quá 50%. Bạn có thể xem lại bài có kết quả thấp nhất."
      : difficulty.kind === "stay"
        ? "Kết quả nằm trong khoảng 51–79%. Tiếp tục theo nhịp hiện tại."
        : "Chưa đủ ba lần đánh giá và mười câu trả lời để cá nhân hóa độ khó.";
  const difficultyTitle = difficulty.kind === "step-up"
    ? "Thử bài vận dụng"
    : difficulty.kind === "worked-review"
      ? "Ôn lại một bài"
      : difficulty.kind === "stay"
        ? "Tiếp tục cùng mức độ"
        : "Gợi ý ban đầu";
  const durationCopy = duration.source === "recent-sessions"
    ? `Trung vị ${Math.round(duration.medianFocusedMinutes ?? 0)} phút từ ${duration.sampleCount} phiên học đã hoàn thành.`
    : `Ước lượng ngắn cho môn học này; hiện có ${duration.sampleCount}/3 phiên đủ điều kiện.`;
  const todayLabel = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="learning-path-page">
      <header className="learning-path-hero">
        <div className="learning-path-hero__copy">
          <span className="learning-path-kicker">VIỄN DU · LỘ TRÌNH HỌC</span>
          <h1>Chọn chặng học tiếp theo<span>.</span></h1>
          <p>Mỗi chặng gồm một phần đọc ngắn, một khoảng tập trung và câu hỏi tự kiểm tra có giải thích.</p>
          <button className="learning-guide-toggle" type="button" onClick={onOpenGuide}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M8.2 7.5a1.9 1.9 0 1 1 3.3 1.3c-.8.8-1.5 1.1-1.5 2.4M10 14.5h.01"/></svg>
            {guideOpen ? "Đang mở hướng dẫn" : "Xem hướng dẫn"}
          </button>
        </div>
        <div className="learning-path-hero__buddy"><Buddy /></div>
        <div className="learning-path-hero__meta">
          <span className="learning-path-meta-date">{todayLabel}</span>
          <label htmlFor="learning-course">Lớp và môn học</label>
          <select id="learning-course" value={course.id} disabled={Boolean(active)} onChange={(event) => onSelectCourse(event.target.value)}>
            {courses.map((item) => <option key={item.id} value={item.id}>{`Lớp ${item.grade} · ${item.subjectName}`}</option>)}
          </select>
          <small>{course.lessons.length} bài có sẵn trong lộ trình này.</small>
        </div>
      </header>

      {guideOpen && <PathGuide onDismiss={onDismissGuide} />}
      {ownGoalForm}

      {!active && existingSessionGoal && (
        <section className="learning-active-session" aria-label="Phiên học đang dở">
          <span><strong>Phiên học đang dở:</strong> {existingSessionGoal}</span>
          <button type="button" onClick={onResumeExistingSession}>Tiếp tục phiên học</button>
        </section>
      )}

      <section className="learning-route-section" aria-labelledby="learning-route-title">
        <div className="learning-section-heading">
          <div>
            <span className="learning-path-kicker">LỘ TRÌNH CỤ THỂ</span>
            <h2 id="learning-route-title">{course.title}</h2>
            <p>{course.description} Đây là nhóm bài học thử nghiệm, không đại diện toàn bộ chương trình lớp học.</p>
          </div>
          <div className="learning-route-legend" aria-label="Trạng thái bài học">
            <span><i className="legend-current" /> Tiếp theo</span>
            <span><i className="legend-completed" /> Đã hoàn thành</span>
            <span><i className="legend-locked" /> Chưa mở</span>
          </div>
        </div>
        <div className="learning-route" aria-label={`Các bài học trong ${course.title}`}>
          <svg className="learning-route__rail" viewBox="0 0 100 1000" preserveAspectRatio="none" aria-hidden="true">
            <path className="learning-route__rail-shadow" d={routeRailPath(lessonStates.length)} />
            <path className="learning-route__rail-line" d={routeRailPath(lessonStates.length)} />
          </svg>
          {lessonStates.map(({ lesson, status }, index) => {
            const milestone = index === lessonStates.length - 1;
            const firstAvailable = status === "available" && lessonStates.findIndex((item) => item.status === "available") === index;
            const active = progress.activeRun?.lessonId === lesson.id && progress.activeRun.lessonVersion === lesson.version;
            const label = status === "current" ? "Đang học" : status === "completed" ? "Đã hoàn thành" : status === "available" ? "Có thể bắt đầu" : "Chưa mở khóa";
            const actionLabel = status === "current" ? "Tiếp tục" : status === "available" ? "Bắt đầu" : label;
            const statusLabel = status === "available" ? "BẮT ĐẦU" : label.toUpperCase();
            return (
              <div className={`learning-route__row learning-route__row--${index % 2 === 0 ? "left" : "right"}`} key={lesson.id}>
                <div className={`learning-route__node-wrap learning-route__node-wrap--${index % 2 === 0 ? "left" : "right"}`}>
                  {firstAvailable && <span className="learning-route__start-marker">Bắt đầu</span>}
                  <button
                    type="button"
                    className={`learning-route__node is-${status}${milestone ? " is-milestone" : ""}`}
                    aria-label={`Bài ${index + 1}: ${lesson.title}. ${actionLabel}.`}
                    disabled={status === "locked" || (Boolean(active) && status !== "current")}
                    onClick={() => status === "current" && active ? onResume() : onOpenLesson(lesson)}
                  >
                    <span className="learning-route__node-number">{String(index + 1).padStart(2, "0")}</span>
                    <RouteNodeIcon status={status} milestone={milestone} />
                  </button>
                </div>
                <div className="learning-route__copy">
                  <span className={`learning-route__status is-${status}`}>{milestone ? status === "locked" ? "CHƯA MỞ · VẬN DỤNG" : "ĐIỂM VẬN DỤNG" : statusLabel}</span>
                  <h3>{lesson.title}</h3>
                  <p>{lesson.summary}</p>
                  <small>{lesson.minutes} phút nội dung{active ? " · Chặng đang mở" : status === "available" ? " · Chọn nút để xem bài" : ""}</small>
                  {status === "locked" && <span className="learning-route__locked-note">Hoàn thành bài trước để mở.</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="learning-suggestion" aria-labelledby="learning-suggestion-title">
        <div className="learning-suggestion__heading">
          <span className="learning-path-kicker">GỢI Ý HỌC TẬP</span>
          <span className={`learning-evidence-tag ${difficulty.kind === "curated-default" ? "is-default" : ""}`}>
            {difficulty.kind === "curated-default" ? "Chưa cá nhân hóa" : `${difficulty.completedEvaluations} lần đánh giá`}
          </span>
        </div>
        <h2 id="learning-suggestion-title">{difficultyTitle}</h2>
        <p>{difficultyCopy}</p>
        {recommendedLesson && !active && (
          <button className="learning-suggestion__link" type="button" onClick={() => onOpenLesson(recommendedLesson)}>
            {difficulty.kind === "worked-review" ? `Mở lại: ${recommendedLesson.title}` : `Mở: ${recommendedLesson.title}`}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>
          </button>
        )}
        <div className="learning-duration-note">
          <span>Thời lượng gợi ý</span>
          <strong>{duration.minutes} phút</strong>
          <small>{durationCopy} Bạn có thể đổi thời lượng trước khi bắt đầu.</small>
        </div>
      </section>

      <section className="learning-daily" aria-labelledby="learning-daily-title">
        <div className="learning-daily__heading">
          <span className="learning-path-kicker">GHI NHẬN HÔM NAY</span>
          <h2 id="learning-daily-title">Tiến độ từ các phiên đã lưu</h2>
          <p>Thời gian tập trung và bài tự kiểm tra được ghi riêng; phút học không dùng để suy ra mức độ thành thạo.</p>
        </div>
        <div className="learning-daily__metrics">
          <div><span>Tập trung thực tế</span><strong>{formatMinutes(daily.focusedSeconds)}</strong><small>{daily.sessionCount} phiên đã lưu</small></div>
          <div><span>Giải lao theo kế hoạch</span><strong>{formatMinutes(daily.plannedBreakSeconds)}</strong><small>Không tính là thời gian tập trung</small></div>
          <div><span>Giải lao thực tế</span><strong>{formatMinutes(daily.actualBreakSeconds)}</strong><small>Thời gian nghỉ đã ghi nhận</small></div>
          <div><span>Rời phiên / gián đoạn</span><strong>{daily.distractions} lần</strong><small>{formatMinutes(daily.awaySeconds)} ngoài giờ nghỉ</small></div>
          <div><span>Quiz AI đã chấm</span><strong>{daily.latestQuiz ? `${daily.latestQuiz.score}/${daily.latestQuiz.total}` : "—"}</strong><small>{daily.quizCount} kết quả hôm nay</small></div>
          <div><span>Tự kiểm tra bài học</span><strong>{daily.latestCuratedEvaluation ? `${daily.latestCuratedEvaluation.score}/${daily.latestCuratedEvaluation.total}` : "—"}</strong><small>{daily.curatedEvaluationCount} kết quả hôm nay · lưu riêng</small></div>
        </div>
      </section>

      <section className="learning-shortcuts" aria-labelledby="learning-shortcuts-title">
        <div className="learning-section-heading">
          <div><span className="learning-path-kicker">KHÔNG GIAN CỦA BẠN</span><h2 id="learning-shortcuts-title">Các mục khác</h2></div>
        </div>
        <div className="learning-shortcuts__grid">
          <button type="button" onClick={() => onNavigate("journal")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h13v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><span><strong>Nhật ký học tập</strong><small>Phiên và bài đã lưu riêng</small></span><svg className="learning-shortcut-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></button>
          <button type="button" onClick={() => onNavigate("experiments")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3"/><path d="M7 15h10"/></svg><span><strong>Lịch sử phiên học</strong><small>Những phiên đã ghi nhận</small></span><svg className="learning-shortcut-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></button>
          <button type="button" onClick={() => onNavigate("report")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h16"/><path d="M8 16v-4m4 4V7m4 9v-6"/></svg><span><strong>Báo cáo</strong><small>Tổng hợp tiến độ công khai</small></span><svg className="learning-shortcut-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></button>
          <button type="button" onClick={() => onNavigate("group")}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5.5a3 3 0 0 1 0 5.8M18 14a4 4 0 0 1 3 4v2"/></svg><span><strong>Học cùng bạn</strong><small>Chuẩn bị một buổi học chung</small></span><svg className="learning-shortcut-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg></button>
        </div>
      </section>
      <details className="learning-legacy-data">
        <summary>Dữ liệu hành trình trước đây</summary>
        <div>
          <button type="button" onClick={() => onNavigate("map")}>Bản đồ hành trình</button>
          <button type="button" onClick={() => onNavigate("carriage")}>Toa của tôi</button>
        </div>
      </details>
      <p className="learning-path-footnote">Không cần đăng nhập để học các bài có sẵn và lưu tiến độ trên thiết bị.</p>
    </div>
  );
}

type LessonDetailProps = {
  course: CuratedCourse;
  lesson: CuratedLesson;
  status: LessonStatus;
  active: boolean;
  replay: boolean;
  difficulty: DifficultySuggestion;
  duration: DurationSuggestion;
  onBack: () => void;
  onStart: (minutes: number) => void;
  onResume: () => void;
};

export function LearningPathLessonDetail({
  course,
  lesson,
  status,
  active,
  replay,
  difficulty,
  duration,
  onBack,
  onStart,
  onResume,
}: LessonDetailProps) {
  const [override, setOverride] = useState<number | undefined>();
  useEffect(() => setOverride(undefined), [course.id, lesson.id, duration.minutes]);
  const selectedMinutes = chooseDuration(duration, override);
  const descriptionId = `lesson-duration-note-${lesson.id}`;
  const canStart = status === "available" || (replay && status === "completed");

  return (
    <div className="learning-lesson-page">
      <button className="learning-back-link" type="button" onClick={onBack}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H3m5 5-5-5 5-5" /></svg>
        Về lộ trình
      </button>
      <header className="learning-lesson-hero">
        <div className="learning-lesson-hero__text">
          <span className="learning-path-kicker">LỚP {course.grade} · {course.subjectName.toUpperCase()}</span>
          <h1>{lesson.title}</h1>
          <p>{lesson.summary}</p>
          <div className="learning-lesson-tags"><span><CourseIcon subjectId={course.subjectId} />{course.title}</span><span>{lesson.minutes} phút nội dung</span>{replay && <span>Ôn lại bài đã học</span>}</div>
        </div>
        <div className="learning-lesson-hero__buddy"><Buddy /></div>
      </header>

      {(difficulty.kind === "step-up" || difficulty.kind === "worked-review") && (
        <div className="learning-lesson-recommendation" role="status">
          <strong>{difficulty.kind === "step-up" ? "Bài vận dụng được gợi ý" : "Bài được gợi ý để ôn lại"}</strong>
          <span>{difficulty.completedEvaluations} bài đánh giá · {difficulty.scoredAnswers} câu đã chấm theo chủ đề này.</span>
        </div>
      )}

      <div className="learning-lesson-layout">
        <article className="learning-material">
          <div className="learning-material__heading"><span className="learning-step">01</span><div><span className="learning-path-kicker">NỘI DUNG BÀI HỌC</span><h2>Đọc và nắm ý chính</h2></div></div>
          <p className="learning-material__text">{lesson.content}</p>
          <p className="learning-material__source">Bài học có sẵn trên thiết bị; không cần kết nối mạng.</p>
        </article>
        <aside className="learning-prepare">
          <div className="learning-prepare__heading"><span className="learning-step">02</span><div><span className="learning-path-kicker">CHUẨN BỊ</span><h2>Mục tiêu và thời lượng</h2></div></div>
          <p>Chặng này sẽ đi qua vé học và bộ đếm giờ hiện có. Bạn có thể thêm ghi chú hoặc tài liệu ở bước chuẩn bị.</p>
          <label htmlFor="lesson-duration">Thời lượng tập trung</label>
          <div className="learning-duration-choice"><strong>{selectedMinutes} phút</strong><span>{override === undefined ? "Gợi ý" : "Bạn đã điều chỉnh"}</span></div>
          <input
            id="lesson-duration"
            type="range"
            min="5"
            max="25"
            step="1"
            value={selectedMinutes}
            aria-describedby={descriptionId}
            onChange={(event) => setOverride(Number(event.target.value))}
          />
          <div className="learning-duration-range"><span>5 phút</span><span>25 phút</span></div>
          <p id={descriptionId} className="learning-duration-explanation">
            {duration.source === "recent-sessions"
              ? `Trung vị ${Math.round(duration.medianFocusedMinutes ?? 0)} phút từ ${duration.sampleCount} phiên đã hoàn thành cùng môn.`
              : `Ước lượng ban đầu cho môn học; mới có ${duration.sampleCount}/3 phiên đủ điều kiện.`}
          </p>
          {active ? (
            <button className="learning-primary-action" type="button" onClick={onResume}>Tiếp tục chặng <span aria-hidden="true">→</span></button>
          ) : (
            <button className="learning-primary-action" type="button" disabled={!canStart} onClick={() => onStart(selectedMinutes)}>
              {replay ? "Bắt đầu ôn lại" : "Chuẩn bị chặng học"}<span aria-hidden="true">→</span>
            </button>
          )}
          <small>Tiến độ bài chỉ hoàn thành sau khi bạn kết thúc phiên và gửi câu trả lời tự kiểm tra.</small>
        </aside>
      </div>

      <section className="learning-sequence" aria-label="Các bước của một chặng học">
        <div><span>01</span><strong>Mục tiêu</strong><small>{lesson.title}</small></div>
        <div><span>02</span><strong>Tài liệu</strong><small>Đọc nội dung bài học</small></div>
        <div><span>03</span><strong>Tập trung</strong><small>{selectedMinutes} phút gợi ý · có thể đổi</small></div>
        <div><span>04</span><strong>Tự kiểm tra</strong><small>Câu hỏi và giải thích có sẵn</small></div>
      </section>
    </div>
  );
}

type EvaluationAnswer = {
  questionId: string;
  conceptId: string;
  correct: boolean;
  prompt: string;
  options: string[];
  selectedIndex: number;
  correctIndex: number;
  explanation: string;
};

type EvaluationProps = {
  lesson: CuratedLesson;
  conceptId: string;
  savedAnswers?: readonly EvaluationAnswer[];
  onSubmit?: (score: number, total: number, answers: EvaluationAnswer[]) => boolean | void;
};

export function CuratedEvaluation({ lesson, conceptId, savedAnswers, onSubmit }: EvaluationProps) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState("");
  const readOnly = Boolean(savedAnswers);
  const visibleQuestions = savedAnswers?.length
    ? savedAnswers.map((answer) => {
        const current = lesson.questions.find((question) => question.id === answer.questionId);
        return {
          id: answer.questionId,
          prompt: answer.prompt ?? current?.prompt ?? "Câu hỏi đã lưu",
          options: answer.options ?? current?.options ?? [],
          correctIndex: answer.correctIndex ?? current?.correctIndex ?? 0,
          explanation: answer.explanation ?? current?.explanation ?? "",
        };
      })
    : lesson.questions;
  const answers = savedAnswers ?? (submitted ? lesson.questions.map((question) => {
    const selectedIndex = selected[question.id];
    return {
      questionId: question.id,
      conceptId,
      correct: selectedIndex === question.correctIndex,
      prompt: question.prompt,
      options: [...question.options],
      selectedIndex,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
    } satisfies EvaluationAnswer;
  }) : undefined);
  const score = answers?.filter((answer) => answer.correct).length ?? 0;
  const allAnswered = lesson.questions.every((question) => Number.isSafeInteger(selected[question.id]));

  function submit() {
    if (!allAnswered || readOnly || submitted) return;
    const results = lesson.questions.map((question) => {
      const selectedIndex = selected[question.id];
      return {
        questionId: question.id,
        conceptId,
        correct: selectedIndex === question.correctIndex,
        prompt: question.prompt,
        options: [...question.options],
        selectedIndex,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
      };
    });
    const saved = onSubmit?.(results.filter((answer) => answer.correct).length, results.length, results);
    if (saved === false) {
      setSaveError("Chưa lưu được kết quả. Hãy thử gửi lại.");
      return;
    }
    setSaveError("");
    setSubmitted(true);
  }

  return (
    <section className="curated-evaluation" aria-labelledby="curated-evaluation-title">
      <div className="curated-evaluation__header">
        <div><span className="learning-path-kicker">04 · TỰ KIỂM TRA</span><h2 id="curated-evaluation-title">{readOnly ? "Kết quả bài học" : "Bạn nhớ được những gì?"}</h2></div>
        {answers && <strong className="curated-evaluation__score">{score}/{answers.length}</strong>}
      </div>
      {!readOnly && !submitted && <p>Chọn một đáp án cho mỗi câu. Khi gửi bài, bạn sẽ thấy đáp án đúng và phần giải thích.</p>}
      {readOnly && <p>Kết quả này được lưu riêng cùng phiên học.</p>}
      <div className="curated-evaluation__questions">
        {visibleQuestions.map((question, index) => {
          const result = answers?.find((answer) => answer.questionId === question.id);
          const answerOptions = result?.options ?? question.options;
          const correctIndex = result?.correctIndex ?? question.correctIndex;
          return (
            <fieldset className={`curated-question${result ? result.correct ? " is-correct" : " is-incorrect" : ""}`} key={question.id}>
              <legend><span>{String(index + 1).padStart(2, "0")}</span>{result?.prompt ?? question.prompt}</legend>
              <div className="curated-question__options">
                {answerOptions.map((option, optionIndex) => {
                  const checked = result ? result.selectedIndex === optionIndex : selected[question.id] === optionIndex;
                  const isAnswer = correctIndex === optionIndex;
                  return (
                    <label className={result ? `${isAnswer ? "is-answer" : ""}${checked && !result.correct ? " is-wrong-choice" : ""}` : ""} key={`${question.id}-${optionIndex}`}>
                      <input
                        type="radio"
                        name={`answer-${question.id}`}
                        value={optionIndex}
                        checked={checked}
                        disabled={readOnly || submitted}
                        onChange={() => setSelected((current) => ({ ...current, [question.id]: optionIndex }))}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
              {result && <p className="curated-question__feedback"><strong>{result.correct ? "Đúng" : "Đáp án đúng"}.</strong> {result.explanation ?? question.explanation}</p>}
            </fieldset>
          );
        })}
      </div>
      {!readOnly && !submitted && (
        <div className="curated-evaluation__submit">
          <button className="learning-primary-action" type="button" disabled={!allAnswered} onClick={submit}>Gửi đáp án <span aria-hidden="true">→</span></button>
          <small>{allAnswered ? "Câu trả lời sẽ được lưu riêng trên thiết bị." : `Đã chọn ${Object.keys(selected).length}/${lesson.questions.length} câu.`}</small>
        </div>
      )}
      {saveError && <p className="message error" role="alert">{saveError}</p>}
      {submitted && <p className="curated-evaluation__saved" role="status">Đã lưu kết quả riêng: {score}/{answers?.length ?? 0} câu đúng.</p>}
    </section>
  );
}

export function CuratedEvaluationReceipt({
  evaluation,
}: {
  evaluation: LearningPathProgress["completed"][number];
}) {
  const saved = evaluation.assessedAnswers.filter((answer): answer is AssessedAnswer & {
    prompt: string;
    options: string[];
    selectedIndex: number;
    correctIndex: number;
    explanation: string;
  } => typeof answer.prompt === "string" && Array.isArray(answer.options) &&
    Number.isSafeInteger(answer.selectedIndex) && Number.isSafeInteger(answer.correctIndex) &&
    typeof answer.explanation === "string");

  return (
    <section className="curated-receipt" aria-labelledby={`curated-receipt-${evaluation.sessionId}`}>
      <div className="curated-receipt__heading">
        <div><span className="learning-path-kicker">BÀI TỰ KIỂM TRA · LƯU RIÊNG</span><h2 id={`curated-receipt-${evaluation.sessionId}`}>{evaluation.lessonTitle ?? "Kết quả bài học"}</h2></div>
        <strong className="curated-receipt__score">{evaluation.score}/{evaluation.total}</strong>
      </div>
      {saved.length ? (
        <div className="curated-receipt__questions">
          {saved.map((answer, index) => (
            <article className={`curated-receipt__item${answer.correct ? "" : " is-incorrect"}`} key={answer.questionId}>
              <h3><span>{index + 1}. </span>{answer.prompt}</h3>
              <p><strong>Bạn chọn:</strong> {answer.options[answer.selectedIndex]}</p>
              {!answer.correct && <p><strong>Đáp án đúng:</strong> {answer.options[answer.correctIndex]}</p>}
              <p>{answer.explanation}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="curated-receipt__legacy">Bản ghi cũ giữ tổng điểm; câu hỏi và lựa chọn chi tiết chưa được lưu.</p>
      )}
    </section>
  );
}
