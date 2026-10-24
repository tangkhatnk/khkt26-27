import { useEffect, useRef, useState } from "react";
import type { Session } from "../../backend/src/adventure/domain";
import { knowledgeGaps } from "./learning";
import { StudyGuideInlineText } from "./StudyGuideRenderer";
import {
  isQuizCount,
  isValidQuizDraft,
  QuizRequestGuard,
  quizPanelDraftState,
  type QuizDraft,
  type QuizQuestion,
} from "./quizDrafts";

type Answer = { id: string; selected: number };
type Assessment = NonNullable<Session["quiz"]>;

type Props = {
  ownerId: string;
  session: Session;
  draft?: QuizDraft;
  prefetchStatus?: "pending" | "ready" | "failed";
  prefetchError?: string;
  canUseAI: boolean;
  needsLogin: boolean;
  onGenerate: (count: number) => Promise<QuizQuestion[]>;
  onSaveDraft: (draft: QuizDraft) => void;
  onGrade: (answers: Answer[]) => Promise<Session>;
  onLogin: () => void;
  onStartReview: () => void;
};

export function QuizPanel({
  ownerId,
  session,
  draft: initialDraft,
  prefetchStatus,
  prefetchError,
  canUseAI,
  needsLogin,
  onGenerate,
  onSaveDraft,
  onGrade,
  onLogin,
  onStartReview,
}: Props) {
  const firstPanelState = quizPanelDraftState(initialDraft);
  const [draft, setDraft] = useState<QuizDraft>(() => firstPanelState.draft);
  const [countInput, setCountInput] = useState(() => firstPanelState.countInput);
  const [generating, setGenerating] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [gradedQuiz, setGradedQuiz] = useState<Assessment | null>(null);
  const requests = useRef(new QuizRequestGuard());
  const incomingDraft = useRef(initialDraft);
  const lastSavedDraft = useRef<QuizDraft | null>(null);
  const assessment = gradedQuiz ?? session.quiz;
  const questions = draft.questions;

  useEffect(() => () => requests.current.invalidate(), [ownerId, session.id]);

  useEffect(() => {
    if (initialDraft === lastSavedDraft.current) {
      lastSavedDraft.current = null;
      incomingDraft.current = initialDraft;
      return;
    }
    if (incomingDraft.current === initialDraft) return;
    incomingDraft.current = initialDraft;
    requests.current.invalidate();
    const next = quizPanelDraftState(initialDraft);
    setDraft(next.draft);
    setCountInput(next.countInput);
    setGenerating(false);
    setError("");
  }, [initialDraft]);

  function saveDraft(next: QuizDraft) {
    setDraft(next);
    lastSavedDraft.current = next;
    onSaveDraft(next);
  }

  async function generate() {
    const count = Number(countInput);
    if (!isQuizCount(count) || assessment || generating || grading || !canUseAI) return;
    const request = requests.current.begin(ownerId, session.id);
    setGenerating(true);
    setError("");
    try {
      const result = await onGenerate(count);
      if (!requests.current.isCurrent(request, ownerId, session.id)) return;
      if (result.length !== count) {
        throw new Error("AI chưa tạo đủ số câu hỏi đã chọn. Bạn có thể thử lại.");
      }
      const next: QuizDraft = { count: result.length, requestedCount: count, questions: result, answers: {} };
      if (!isValidQuizDraft(next)) throw new Error("AI trả về câu hỏi chưa hợp lệ. Hãy thử lại.");
      saveDraft(next);
    } catch (cause) {
      if (requests.current.isCurrent(request, ownerId, session.id))
        setError(cause instanceof Error ? cause.message : "Chưa tạo được quiz. Hãy thử lại.");
    } finally {
      if (requests.current.isCurrent(request, ownerId, session.id)) setGenerating(false);
    }
  }

  function choose(questionId: string, selected: number) {
    const next: QuizDraft = { ...draft, answers: { ...draft.answers, [questionId]: selected } };
    saveDraft(next);
  }

  async function grade() {
    if (assessment || grading || generating || !questions.length ||
        questions.some((question) => !Number.isSafeInteger(draft.answers[question.id]))) return;
    const request = requests.current.begin(ownerId, session.id);
    setGrading(true);
    setError("");
    try {
      const result = await onGrade(questions.map((question) => ({
        id: question.id,
        selected: draft.answers[question.id],
      })));
      if (!requests.current.isCurrent(request, ownerId, session.id)) return;
      if (!result.quiz) throw new Error("Máy chủ chưa trả kết quả chấm. Câu trả lời vẫn được giữ lại.");
      setGradedQuiz(result.quiz);
    } catch (cause) {
      if (requests.current.isCurrent(request, ownerId, session.id))
        setError(cause instanceof Error ? cause.message : "Chưa chấm được quiz. Câu trả lời vẫn được giữ lại.");
    } finally {
      if (requests.current.isCurrent(request, ownerId, session.id)) setGrading(false);
    }
  }

  const wrongAnswers = assessment?.feedback?.filter((item) => !item.correct) ?? [];
  const gaps = assessment ? knowledgeGaps(assessment) : [];
  return (
    <section className="quiz-panel" aria-labelledby="quiz-panel-title">
      <div className="quiz-panel-heading">
        <div>
          <span className="eyebrow">ÔN TẬP THEO CHUYẾN</span>
          <h2 id="quiz-panel-title">Câu hỏi học tập</h2>
        </div>
      </div>
      {assessment ? (
        <div className="quiz-result" role="status">
          <h3>Điểm: {assessment.score}/{assessment.total}</h3>
          {assessment.feedback ? (
            <>
              {wrongAnswers.length ? (
                <div>
                  <h4>Kiến thức nên ôn lại</h4>
                  {gaps.length ? <ul>
                    {gaps.map((gap) => (
                      <li key={gap.knowledgePoint.toLocaleLowerCase()}>
                        <strong><StudyGuideInlineText text={gap.knowledgePoint} /></strong> — {gap.wrong}/{gap.total} câu sai
                        {gap.feedback.map((item) => item.explanation && (
                          <p key={item.questionId}><StudyGuideInlineText text={item.explanation} /></p>
                        ))}
                      </li>
                    ))}
                  </ul> : <p>Có câu trả lời sai nhưng máy chủ chưa gửi nhãn kiến thức để nhóm nội dung cần ôn.</p>}
                </div>
              ) : (
                <p>Không có câu trả lời sai trong lượt quiz này.</p>
              )}
              <details>
                <summary>Xem lại câu trả lời</summary>
                <ol className="quiz-feedback-list">
                  {assessment.feedback.map((item) => (
                    <li key={item.questionId}>
                      <strong><StudyGuideInlineText text={item.question} /></strong>
                      <p className={item.correct ? "quiz-answer-correct" : "quiz-answer-wrong"}>
                        Bạn chọn: <StudyGuideInlineText text={item.options[item.selected] ?? "Không rõ"} />
                        {item.correct ? " · Đúng" : <> · Đáp án: <StudyGuideInlineText text={item.options[item.correctIndex] ?? "Không rõ"} /></>}
                      </p>
                      {item.explanation && <p><StudyGuideInlineText text={item.explanation} /></p>}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <p>Kết quả được lưu trên máy chủ. Chi tiết câu hỏi của lượt cũ không có trong bản lưu.</p>
          )}
          <button className="primary" onClick={onStartReview}>Bắt đầu chuyến ôn tập →</button>
        </div>
      ) : (
        <>
          <p>Câu hỏi dùng nguồn tài liệu đã kiểm tra. Khi không có tệp, AI dùng chủ đề, mục tiêu và ghi chú của chuyến.</p>
          {canUseAI ? (
            <>
              <label className="quiz-count-label">
                Số câu hỏi
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={countInput}
                  disabled={generating || grading}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCountInput(value);
                    const count = Number(value);
                    if (isQuizCount(count)) {
                      const selected = draft.requestedCount ?? draft.count;
                      saveDraft(draft.questions.length && selected === count
                        ? { ...draft, requestedCount: count }
                        : { count, requestedCount: count, questions: [], answers: {} });
                    }
                  }}
                />
              </label>
              <button className="primary" disabled={generating || grading || prefetchStatus === "pending" || !isQuizCount(Number(countInput))} onClick={() => void generate()}>
                {generating || prefetchStatus === "pending" ? "Đang chuẩn bị câu hỏi…" : questions.length ? "Tạo lại câu hỏi bằng AI" : "Tạo câu hỏi bằng AI"}
              </button>
              {prefetchStatus === "pending" && <p className="quiz-prefetch-status" role="status">Viễn Du đang chuẩn bị câu hỏi trong lúc bạn tập trung.</p>}
              {prefetchStatus === "failed" && <p className="quiz-prefetch-status" role="status">{prefetchError || "Chưa chuẩn bị sẵn được. Bạn có thể thử tạo câu hỏi ngay bây giờ."}</p>}
              {questions.length > 0 && <p className="quiz-replace-hint">Tạo lại trước khi chấm sẽ thay câu hỏi và câu trả lời hiện tại.</p>}
            </>
          ) : (
            <div className="choice-row">
              <p>{needsLogin ? "Đăng nhập lại để tạo quiz AI." : "Quiz AI cần tài khoản đã đăng nhập."}</p>
              <button onClick={onLogin}>Đăng nhập</button>
            </div>
          )}
          {questions.length > 0 && (
            <div className="quiz">
              {questions.map((question, index) => (
                <fieldset key={question.id} disabled={grading}>
                  <legend>{index + 1}. <StudyGuideInlineText text={question.question} /></legend>
                  {question.options.map((option, optionIndex) => (
                    <label className="answer" key={`${question.id}:${optionIndex}`}>
                      <input
                        type="radio"
                        name={`quiz-${session.id}-${question.id}`}
                        checked={draft.answers[question.id] === optionIndex}
                        onChange={() => choose(question.id, optionIndex)}
                      />
                      <StudyGuideInlineText text={option} />
                    </label>
                  ))}
                </fieldset>
              ))}
              <button className="primary" disabled={grading || generating || questions.some((question) => !Number.isSafeInteger(draft.answers[question.id]))} onClick={() => void grade()}>
                {grading ? "Đang chấm…" : "Nộp câu trả lời"}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="quiz-error" role="alert">{error}</p>}
    </section>
  );
}
