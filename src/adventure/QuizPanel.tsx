import { useEffect, useRef, useState } from "react";
import type { Session } from "../../backend/src/adventure/domain";
import type { SessionHistoryEntry } from "./storage";
import { hasGuestAiCredential } from "../services/guestAiApi.ts";
import { knowledgeGaps } from "./learning";
import { StudyGuideInlineText } from "./StudyGuideRenderer";
import { quizPrefetchNotice } from "./quizPrefetchPresentation";
import {
  canManuallyGenerateQuiz,
  isQuizCount,
  isValidQuizDraft,
  QuizRequestGuard,
  quizPanelDraftState,
  type QuizDraft,
  type GuestQuizQuestion,
  type QuizQuestion,
} from "./quizDrafts";

type Answer = { id: string; selected: number };
type Assessment = NonNullable<Session["quiz"]>;
type GeneratedQuizDeck =
  | { questions: QuizQuestion[]; guestQuizId?: undefined }
  | { questions: GuestQuizQuestion[]; guestQuizId: string };

type Props = {
  ownerId: string;
  session: SessionHistoryEntry;
  draft?: QuizDraft;
  prefetchStatus?: "pending" | "ready" | "failed";
  prefetchError?: string;
  canUseAI: boolean;
  isGuest: boolean;
  needsLogin: boolean;
  onGenerate: (count: number) => Promise<GeneratedQuizDeck>;
  onSaveDraft: (draft: QuizDraft) => void;
  onGrade: (answers: Answer[]) => Promise<Session | { guestGrade: Assessment }>;
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
  isGuest,
  needsLogin,
  onGenerate,
  onSaveDraft,
  onGrade,
  onLogin,
  onStartReview,
}: Props) {
  const correctionVersion = session.correctionVersion ?? 0;
  const firstPanelState = quizPanelDraftState(initialDraft, correctionVersion);
  const [draft, setDraft] = useState<QuizDraft>(() => firstPanelState.draft);
  const [countInput, setCountInput] = useState(() => firstPanelState.countInput);
  const [generating, setGenerating] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState("");
  const [gradedQuiz, setGradedQuiz] = useState<Assessment | null>(null);
  const [guestCredentialAvailable, setGuestCredentialAvailable] = useState(() => !isGuest || hasGuestAiCredential());
  const requests = useRef(new QuizRequestGuard());
  const incomingDraft = useRef(initialDraft);
  const lastSavedDraft = useRef<QuizDraft | null>(null);
  const assessment = gradedQuiz ?? draft.guestGrade ?? session.quiz;
  const questions = draft.questions;
  const staleGuestDeck = isGuest && !!draft.guestQuizId && !draft.guestGrade && !guestCredentialAvailable;
  const prefetchNotice = quizPrefetchNotice(prefetchStatus, prefetchError, generating, Boolean(error), questions.length);

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
    const next = quizPanelDraftState(initialDraft, correctionVersion);
    setDraft(next.draft);
    setCountInput(next.countInput);
    setGuestCredentialAvailable(!isGuest || hasGuestAiCredential());
    setGenerating(false);
    setError("");
  }, [initialDraft, correctionVersion, isGuest]);

  function saveDraft(next: QuizDraft) {
    setDraft(next);
    lastSavedDraft.current = next;
    onSaveDraft(next);
  }

  async function generate() {
    const count = Number(countInput);
    if (!canManuallyGenerateQuiz({
      count,
      draft,
      canUseAI,
      hasAssessment: Boolean(assessment),
      generating,
      grading,
    })) return;
    const request = requests.current.begin(ownerId, session.id);
    setGenerating(true);
    setError("");
    try {
      const result = await onGenerate(count);
      if (!requests.current.isCurrent(request, ownerId, session.id)) return;
      if (result.questions.length !== count) {
        throw new Error("AI chưa tạo đủ số câu hỏi đã chọn. Bạn có thể thử lại.");
      }
      const next: QuizDraft = {
        correctionVersion,
        count: result.questions.length,
        requestedCount: count,
        questions: result.questions,
        answers: {},
        ...(result.guestQuizId ? { guestQuizId: result.guestQuizId } : {}),
      };
      if (!isValidQuizDraft(next)) throw new Error("AI trả về câu hỏi chưa hợp lệ. Hãy thử lại.");
      saveDraft(next);
      if (result.guestQuizId) setGuestCredentialAvailable(hasGuestAiCredential());
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
      if ("guestGrade" in result) {
        const next = { ...draft, guestGrade: result.guestGrade };
        if (!isValidQuizDraft(next)) throw new Error("Máy chủ trả về kết quả riêng tư chưa hợp lệ.");
        saveDraft(next);
        setGradedQuiz(result.guestGrade);
        return;
      }
      if (!result.quiz) throw new Error("Máy chủ chưa trả kết quả chấm. Câu trả lời vẫn được giữ lại.");
      setGradedQuiz(result.quiz);
    } catch (cause) {
      if (requests.current.isCurrent(request, ownerId, session.id)) {
        const status = typeof cause === "object" && cause !== null && "status" in cause
          ? Number(cause.status)
          : 0;
        if (isGuest && draft.guestQuizId && (status === 401 || status === 404)) {
          saveDraft({
            ...draft,
            guestQuizId: undefined,
            guestGrade: undefined,
            questions: [],
            answers: {},
          });
          setGuestCredentialAvailable(hasGuestAiCredential());
          setError("Bộ câu hỏi riêng tư đã hết hạn. Hãy tạo lại câu hỏi để tiếp tục.");
          return;
        }
        setError(cause instanceof Error ? cause.message : "Chưa chấm được quiz. Câu trả lời vẫn được giữ lại.");
      }
    } finally {
      if (requests.current.isCurrent(request, ownerId, session.id)) setGrading(false);
    }
  }

  const wrongAnswers = assessment?.feedback?.filter((item) => !item.correct) ?? [];
  const gaps = assessment ? knowledgeGaps(assessment) : [];
  const hasCorrectedQuizResult = session.correctionFlags?.quizResult === true;
  const hasCorrectedTopic = session.correctionFlags?.topic === true;
  const correctedScore = session.effectiveMetrics?.quizScore ?? null;
  const correctedTotal = session.effectiveMetrics?.quizTotal ?? null;
  return (
    <section className="quiz-panel" aria-labelledby="quiz-panel-title">
      <div className="quiz-panel-heading">
        <div>
          <span className="eyebrow">ÔN TẬP PHIÊN HỌC</span>
          <h2 id="quiz-panel-title">Câu hỏi học tập</h2>
        </div>
      </div>
      {hasCorrectedQuizResult && (
        <p className="quiz-corrected-result" role="status">
          Điểm theo lịch sử đã điều chỉnh: {correctedScore === null || correctedTotal === null
            ? "chưa ghi nhận điểm"
            : `${correctedScore}/${correctedTotal}`}.
          {assessment && " Phản hồi bên dưới vẫn giữ nguyên từ lượt chấm ban đầu."}
        </p>
      )}
      {hasCorrectedTopic && !hasCorrectedQuizResult && assessment && (
        <p className="quiz-corrected-result" role="status">
          Chủ đề phiên học đã được hiệu chỉnh; điểm và phản hồi dưới đây vẫn là kết quả chấm ban đầu.
        </p>
      )}
      {assessment ? (
        <div className="quiz-result" role="status">
          <h3>{hasCorrectedQuizResult || hasCorrectedTopic ? "Điểm chấm ban đầu" : "Điểm"}: {assessment.score}/{assessment.total}</h3>
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
          <button className="primary" onClick={onStartReview}>Bắt đầu phiên ôn tập →</button>
        </div>
      ) : (
        <>
          <p>{isGuest
            ? "Câu hỏi dùng chủ đề, mục tiêu và nguồn bạn đã xác nhận. Bộ câu hỏi và kết quả riêng tư không đi vào lịch sử công khai."
            : "Câu hỏi dùng nguồn tài liệu đã kiểm tra. Khi không có tệp, AI dùng chủ đề, mục tiêu và ghi chú của phiên học."}</p>
          {staleGuestDeck && <p className="quiz-prefetch-status" role="status">Bộ câu hỏi này không còn gắn với phiên AI riêng tư hiện tại. Hãy tạo lại bộ câu hỏi trước khi trả lời.</p>}
          {draft.reviewSkipped ? (
            <div className="quiz-review-skipped" role="status">
              <p>Đã bỏ qua câu hỏi ôn tập cho phiên này. Phần học và lịch sử phiên học đã được lưu.</p>
              <button type="button" onClick={() => saveDraft({ ...draft, correctionVersion, reviewSkipped: false })}>
                Bật ôn tập
              </button>
            </div>
          ) : canUseAI ? (
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
                        ? { ...draft, correctionVersion, requestedCount: count }
                        : { correctionVersion, count, requestedCount: count, questions: [], answers: {} });
                    }
                  }}
                />
              </label>
              <button className="primary quiz-panel__generate" disabled={generating || grading || prefetchStatus === "pending" || !isQuizCount(Number(countInput))} onClick={() => void generate()}>
                {generating || prefetchStatus === "pending" ? "Đang chuẩn bị câu hỏi…" : questions.length ? "Tạo lại câu hỏi bằng AI" : "Tạo câu hỏi bằng AI"}
              </button>
              {prefetchNotice && <p className="quiz-prefetch-status" role={prefetchNotice.role}>{prefetchNotice.message}</p>}
              {questions.length > 0 && <p className="quiz-replace-hint">Tạo lại trước khi chấm sẽ thay câu hỏi và câu trả lời hiện tại.</p>}
            </>
          ) : (
            <div className="choice-row">
              <p>{isGuest
                ? "Kết nối mạng để tạo câu hỏi AI riêng tư. Các bài học có sẵn vẫn dùng được khi ngoại tuyến."
                : needsLogin ? "Đăng nhập lại để tạo quiz AI." : "Quiz AI cần tài khoản đã đăng nhập."}</p>
              {!isGuest && <button onClick={onLogin}>Đăng nhập</button>}
            </div>
          )}
          {questions.length > 0 && (
            <div className="quiz">
              {questions.map((question, index) => (
                <fieldset key={question.id} disabled={grading || staleGuestDeck}>
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
              {!staleGuestDeck && <button className="primary" disabled={grading || generating || questions.some((question) => !Number.isSafeInteger(draft.answers[question.id]))} onClick={() => void grade()}>
                {grading ? "Đang chấm…" : "Nộp câu trả lời"}
              </button>}
            </div>
          )}
        </>
      )}
      {error && <p className="quiz-error" role="alert">{error}</p>}
    </section>
  );
}
