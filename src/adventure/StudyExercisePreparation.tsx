import { useEffect, useRef, useState } from "react";
import type { MaterialSource } from "./materialSources.ts";
import { StudyGuideArticle, StudyGuideInlineText } from "./StudyGuideRenderer.ts";
import {
  EMPTY_STUDY_EXERCISE_TEXT_IMPORT,
  StudyExerciseTextImportController,
} from "./studyExerciseTextImport.ts";
import type { StudyExerciseTextImportState } from "./studyExerciseTextImport.ts";
import {
  applyStudyExerciseTextImport,
  canSubmitStudyExercisePreparation,
  canRevealStudyExerciseSolutions,
  createStudyExercisePreparationInput,
  fingerprintStudyExerciseSourceText,
  isCurrentStudyExerciseConfirmation,
  isCurrentStudyExerciseSourceFingerprint,
  isCurrentStudyExerciseSourceScope,
  isReviewedStudyExerciseSource,
  STUDY_EXERCISE_TEXT_LIMIT,
} from "./studyExercises.ts";
import type {
  StudyExerciseConfirmationScope,
  StudyExerciseSourceFingerprint,
  StudyExerciseSourceScope,
} from "./studyExercises.ts";
import type {
  StudyExercisePreparationInput,
  StudyExercisePreparationResponse,
  StudyExerciseSolutionResponse,
} from "../services/studyExercisesApi.ts";
import "./studyExercises.css";

export type StudyExercisePreparationProps = {
  plannedSessionId: string;
  authenticated: boolean;
  sources: readonly MaterialSource[];
  preparation: StudyExercisePreparationResponse | null;
  disabled?: boolean;
  onPrepare: (
    input: StudyExercisePreparationInput,
    signal: AbortSignal,
    sourceScope?: StudyExerciseSourceScope | null,
  ) => Promise<StudyExercisePreparationResponse>;
  onPreparationChange: (
    preparation: StudyExercisePreparationResponse | null,
    sourceScope?: { preparationId: string; sourceId: string; textFingerprint: string } | null,
  ) => void;
  onInvalidate: (plannedSessionId: string, requestId: string) => Promise<unknown>;
};

export type StudyExerciseSolutionStatus = "locked" | "available" | "loading" | "error" | "ready";

type PreparedStudyExerciseSourceScope = StudyExerciseSourceScope & { preparationId: string };

export function studyExerciseConfirmationCopy(mode: "provided" | "generated") {
  return mode === "provided"
    ? "Tôi xác nhận gửi nguyên văn đề bài này cho AI để nhận lời giải sau khi phiên học hoàn tất."
    : "Tôi xác nhận gửi nguồn đã xem lại cho AI để tạo câu hỏi mở; lời giải chỉ có sau khi phiên học hoàn tất.";
}

export function StudyExerciseProblemEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return <>
    <label htmlFor="study-exercise-provided-text">Đề bài hoặc phần cần giải
      <textarea id="study-exercise-provided-text" rows={6}
        value={value} disabled={disabled}
        onChange={event => onChange(event.target.value)}
        aria-describedby="study-exercise-provided-help" />
    </label>
    <p id="study-exercise-provided-help" className="material-hint">Giữ nguyên câu hỏi, mã nguồn và các ý được đánh số. Giới hạn 20.000 ký tự.</p>
    {value && <details className="study-exercises__preview">
      <summary>Xem đúng nội dung sẽ gửi</summary><pre>{value}</pre>
    </details>}
  </>;
}

export function StudyExerciseTextImportPanel({
  state,
  disabled,
  onFileSelected,
  onCancel,
  onEdit,
  onApply,
}: {
  state: StudyExerciseTextImportState;
  disabled: boolean;
  onFileSelected: (file: File) => void;
  onCancel: () => void;
  onEdit: (text: string) => void;
  onApply: (action: "replace" | "append") => void;
}) {
  return <div className="study-exercises__file-import">
    <div>
      <h4>Nhập đề từ tệp hoặc ảnh</h4>
      <p>Tệp được đọc ngay trên thiết bị. Sau khi đọc, bạn xem lại rồi chọn thay thế hoặc nối vào đề. Chỉ nội dung bạn xác nhận mới được gửi cho AI.</p>
    </div>
    <label htmlFor="study-exercise-file">Tệp đề bài hoặc ảnh
      <input id="study-exercise-file" type="file"
        accept=".txt,.text,.md,.markdown,.json,.csv,.tsv,.xml,.tex,.yaml,.yml,.toml,.ini,.log,.sql,.js,.jsx,.ts,.tsx,.css,.py,.java,.c,.h,.cpp,.sh,.properties,.conf,.rst,.svg,.docx,.pptx,.xlsx,.pdf,.rtf,.odt,.ods,.odp,.epub,.html,.htm,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/png,image/jpeg,image/webp,image/bmp"
        disabled={disabled}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFileSelected(file);
        }} />
    </label>
    {state.extracting && <div className="study-exercises__extracting">
      <p role="status">Đang đọc {state.fileName} trên thiết bị{state.progress > 0 ? ` · ${state.progress}%` : "…"}</p>
      <button type="button" onClick={onCancel}>Hủy đọc tệp</button>
    </div>}
    {state.message && !state.error && !state.extracting && <p className="material-hint" role="status">{state.fileName}: {state.message}</p>}
    {state.error && <p className="study-exercises__error" role="alert">{state.error}</p>}
    {state.text && <>
      <label htmlFor="study-exercise-extracted-text">Kiểm tra và sửa nội dung đã trích xuất
        <textarea id="study-exercise-extracted-text" rows={5} maxLength={STUDY_EXERCISE_TEXT_LIMIT}
          value={state.text} disabled={disabled || state.extracting}
          onChange={event => onEdit(event.target.value)} />
      </label>
      <p className="study-exercises__length">{state.text.length.toLocaleString("vi-VN")} / 20.000 ký tự</p>
      <div className="study-exercises__import-actions">
        <button type="button" disabled={disabled || state.extracting || !state.text.trim()}
          onClick={() => onApply("replace")}>Thay đề bằng nội dung đã trích xuất</button>
        <button type="button" disabled={disabled || state.extracting || !state.text.trim()}
          onClick={() => onApply("append")}>Nối vào cuối đề</button>
      </div>
    </>}
  </div>;
}

export function StudyExercisePreparation({
  plannedSessionId,
  authenticated,
  sources,
  preparation,
  disabled = false,
  onPrepare,
  onPreparationChange,
  onInvalidate,
}: StudyExercisePreparationProps) {
  const [mode, setMode] = useState<"provided" | "generated">("provided");
  const [providedText, setProvidedText] = useState("");
  const [textImport, setTextImport] = useState(EMPTY_STUDY_EXERCISE_TEXT_IMPORT);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [count, setCount] = useState(3);
  const [confirmationScope, setConfirmationScope] = useState<StudyExerciseConfirmationScope | null>(null);
  const [fingerprintedSource, setFingerprintedSource] = useState<StudyExerciseSourceFingerprint | null>(null);
  const [preparedSourceScope, setPreparedSourceScope] = useState<PreparedStudyExerciseSourceScope | null>(null);
  const [invalidatedPreparationId, setInvalidatedPreparationId] = useState<string | null>(null);
  const [editing, setEditing] = useState(preparation === null);
  const [pending, setPending] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState("");
  const textImportContextRef = useRef({ plannedSessionId, mode });
  textImportContextRef.current = { plannedSessionId, mode };
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const requestSourceScopeRef = useRef<StudyExerciseSourceScope | null>(null);
  const invalidatedPreparationRef = useRef<string | null>(null);
  const textImportControllerRef = useRef<StudyExerciseTextImportController | null>(null);
  if (!textImportControllerRef.current)
    textImportControllerRef.current = new StudyExerciseTextImportController(
      setTextImport,
      undefined,
      () => textImportContextRef.current,
    );

  useEffect(() => {
    setEditing(preparation?.id == null);
    setSkipped(false);
    setConfirmationScope(null);
    setError("");
  }, [plannedSessionId, preparation?.id]);

  useEffect(() => {
    textImportControllerRef.current?.setContext({ plannedSessionId, mode });
  }, [plannedSessionId, mode]);

  useEffect(() => () => {
    // Ticket-to-focus unmounts this editor while generation may still finish.
    // The parent validates request scope and retries the start bind on result;
    // explicit cancel remains the only UI action that aborts and tombstones it.
    generationRef.current += 1;
    textImportControllerRef.current?.dispose();
  }, []);

  const selectedSource = sources.find(source => source.id === selectedSourceId);
  const selectedSourceIdValue = selectedSource?.id;
  const selectedSourceTextValue = selectedSource?.text;
  const selectedSourceReviewedValue = selectedSource?.reviewed;
  useEffect(() => {
    let active = true;
    if (mode !== "generated" || selectedSourceIdValue === undefined || selectedSourceTextValue === undefined ||
        selectedSourceReviewedValue !== true || selectedSourceTextValue.length > 20_000) {
      setFingerprintedSource(null);
      return () => { active = false; };
    }
    void fingerprintStudyExerciseSourceText(selectedSourceTextValue).then(textFingerprint => {
      if (active) setFingerprintedSource({
        sourceId: selectedSourceIdValue,
        sourceText: selectedSourceTextValue,
        sourceReviewed: selectedSourceReviewedValue,
        textFingerprint,
      });
    }).catch(() => {
      if (active) setError("Không thể xác nhận phiên bản tài liệu. Hãy thử lại.");
    });
    return () => { active = false; };
  }, [mode, selectedSourceIdValue, selectedSourceTextValue, selectedSourceReviewedValue]);

  const sourceFingerprintIsCurrent = isCurrentStudyExerciseSourceFingerprint(fingerprintedSource, selectedSource);
  const selectedSourceFingerprint = sourceFingerprintIsCurrent && fingerprintedSource ? fingerprintedSource.textFingerprint : null;
  const currentSourceRef = useRef({ selectedSource, fingerprintedSource });
  currentSourceRef.current = { selectedSource, fingerprintedSource };
  const confirmationIsCurrent = isCurrentStudyExerciseConfirmation(
    confirmationScope,
    mode,
    providedText,
    fingerprintedSource,
    selectedSource,
  );
  const trackedPreparedScope = preparation && preparedSourceScope?.preparationId === preparation.id
    ? preparedSourceScope
    : null;
  const preparedSourceChanged = preparation?.mode === "generated" && trackedPreparedScope !== null &&
    !isCurrentStudyExerciseSourceScope(trackedPreparedScope, fingerprintedSource, selectedSource);
  const preparedSetInvalidated = preparation !== null && invalidatedPreparationId === preparation.id;
  const activePreparation = preparation && !preparedSourceChanged && !preparedSetInvalidated ? preparation : null;

  useEffect(() => {
    if (!confirmationScope) return;
    const stillConfirmed = isCurrentStudyExerciseConfirmation(
      confirmationScope,
      mode,
      providedText,
      fingerprintedSource,
      selectedSource,
    );
    if (!stillConfirmed) setConfirmationScope(null);
  }, [confirmationScope, mode, providedText, fingerprintedSource, selectedSource, selectedSource?.id, selectedSource?.text, selectedSource?.reviewed]);

  useEffect(() => {
    const requestScope = requestSourceScopeRef.current;
    if (pendingRef.current && requestScope &&
        !isCurrentStudyExerciseSourceScope(requestScope, fingerprintedSource, selectedSource)) {
      const requestId = requestIdRef.current;
      generationRef.current += 1;
      controllerRef.current?.abort();
      pendingRef.current = false;
      requestSourceScopeRef.current = null;
      setPending(false);
      setConfirmationScope(null);
      setError("Nguồn tài liệu đã thay đổi. Hãy xác nhận lại trước khi tạo đề.");
      if (requestId) {
        setInvalidating(true);
        void onInvalidate(plannedSessionId, requestId).then(() => {
          if (requestIdRef.current === requestId) requestIdRef.current = null;
        }).catch(reason => {
          setError(reason instanceof Error ? reason.message : "Không thể hủy bộ bài tập cũ. Hãy thử lại.");
        }).finally(() => setInvalidating(false));
      }
    }
  }, [fingerprintedSource, onInvalidate, plannedSessionId, selectedSource, selectedSource?.id, selectedSource?.text, selectedSource?.reviewed]);

  useEffect(() => {
    if (!preparedSourceChanged || !preparation || invalidatedPreparationRef.current === preparation.id) return;
    const stalePreparationId = preparation.id;
    invalidatedPreparationRef.current = stalePreparationId;
    setInvalidatedPreparationId(stalePreparationId);
    setPreparedSourceScope(null);
    setConfirmationScope(null);
    setEditing(true);
    onPreparationChange(null, null);
    if (requestIdRef.current === stalePreparationId) requestIdRef.current = null;
    setInvalidating(true);
    setError("Nguồn tài liệu đã thay đổi hoặc cần xem lại. Hãy xác nhận nguồn mới trước khi tạo đề.");
    void onInvalidate(plannedSessionId, stalePreparationId).catch(reason => {
      setError(reason instanceof Error ? reason.message : "Không thể hủy bộ bài tập cũ. Hãy thử lại.");
    }).finally(() => setInvalidating(false));
  }, [onInvalidate, onPreparationChange, plannedSessionId, preparation, preparedSourceChanged]);

  const text = mode === "provided" ? providedText : selectedSource?.text ?? "";
  const input = createStudyExercisePreparationInput({
    requestId: requestIdRef.current ?? "preview-only-request-id",
    plannedSessionId,
    mode,
    text,
    count,
    authenticated,
    confirmed: confirmationIsCurrent,
    ...(mode === "generated" ? { selectedSource } : {}),
  });
  const isTooLong = text.length > 20_000;
  const canSubmit = canSubmitStudyExercisePreparation(input, {
    disabled,
    pending,
    invalidating,
    sourceFingerprintReady: mode !== "generated" || selectedSourceFingerprint !== null,
  });

  const invalidateRequest = async (requestId: string) => {
    setInvalidating(true);
    setError("");
    try {
      await onInvalidate(plannedSessionId, requestId);
      onPreparationChange(null, null);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể hủy bộ bài tập. Hãy thử lại.");
      return false;
    } finally {
      setInvalidating(false);
    }
  };

  const editPreparedSet = async () => {
    if (!preparation) return;
    if (!await invalidateRequest(preparation.id)) return;
    setEditing(true);
    setSkipped(false);
    setConfirmationScope(null);
  };

  const cancelPendingRequest = async () => {
    const requestId = requestIdRef.current;
    if (!requestId) return;
    generationRef.current += 1;
    controllerRef.current?.abort();
    pendingRef.current = false;
    setPending(false);
    if (await invalidateRequest(requestId)) {
      requestIdRef.current = null;
      setEditing(true);
      setConfirmationScope(null);
    }
  };

  const cancelPreparedSet = async () => {
    const requestId = activePreparation?.id ?? requestIdRef.current;
    if (!requestId) {
      setSkipped(true);
      setEditing(false);
      setError("");
      return;
    }
    if (activePreparation || pendingRef.current || requestIdRef.current) {
      if (!activePreparation) {
        generationRef.current += 1;
        controllerRef.current?.abort();
        pendingRef.current = false;
        setPending(false);
      }
      if (!await invalidateRequest(requestId)) return;
      requestIdRef.current = null;
    }
    setSkipped(true);
    setEditing(false);
    setConfirmationScope(null);
  };

  const cancelTextImport = () => textImportControllerRef.current?.cancel("Đã hủy trích xuất.");

  const extractExerciseText = (file: File) => {
    void textImportControllerRef.current?.start(file, { plannedSessionId, mode: "provided" });
  };

  const changeMode = (nextMode: "provided" | "generated") => {
    if (nextMode === mode) return;
    textImportControllerRef.current?.setContext({ plannedSessionId, mode: nextMode });
    setMode(nextMode);
    setConfirmationScope(null);
    setError("");
  };

  const applyProvidedTextImport = (imported: string, action: "replace" | "append") => {
    const nextText = applyStudyExerciseTextImport(providedText, imported, action);
    setConfirmationScope(null);
    if (nextText === null) {
      setError(action === "append"
        ? "Nội dung sau khi nối sẽ vượt giới hạn 20.000 ký tự."
        : "Nội dung này vượt giới hạn 20.000 ký tự hoặc chưa có chữ để dùng.");
      return;
    }
    setProvidedText(nextText);
    setError("");
  };

  const applyExtractedText = (action: "replace" | "append") => {
    const nextText = textImportControllerRef.current?.apply(providedText, action) ?? null;
    setConfirmationScope(null);
    if (nextText === null) {
      setError(action === "append"
        ? "Nội dung sau khi nối sẽ vượt giới hạn 20.000 ký tự."
        : "Nội dung này vượt giới hạn 20.000 ký tự hoặc chưa có chữ để dùng.");
      return;
    }
    setProvidedText(nextText);
    setError("");
  };

  const changeSource = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    setConfirmationScope(null);
    setError("");
  };

  const prepare = async () => {
    if (!canSubmit) return;
    const requestSourceScope = mode === "generated" && selectedSourceFingerprint && selectedSource
      ? { sourceId: selectedSource.id, textFingerprint: selectedSourceFingerprint }
      : null;
    const currentRequestId = globalThis.crypto.randomUUID();
    requestIdRef.current = currentRequestId;
    requestSourceScopeRef.current = requestSourceScope;
    const body = { ...input, requestId: currentRequestId } as StudyExercisePreparationInput;
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setSkipped(false);
    try {
      const result = await onPrepare(body, controller.signal, requestSourceScope);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (requestSourceScope && (result.mode !== "generated" || result.sourceFingerprint !== requestSourceScope.textFingerprint)) {
        await onInvalidate(plannedSessionId, result.id);
        if (requestIdRef.current === result.id) requestIdRef.current = null;
        setError("Phiên bản nguồn không khớp với đề vừa tạo. Hãy xác nhận lại tài liệu.");
        return;
      }
      const currentSource = currentSourceRef.current;
      if (requestSourceScope && !isCurrentStudyExerciseSourceScope(
        requestSourceScope,
        currentSource.fingerprintedSource,
        currentSource.selectedSource,
      )) {
        await onInvalidate(plannedSessionId, result.id);
        if (requestIdRef.current === result.id) requestIdRef.current = null;
        setError("Nguồn tài liệu đã thay đổi. Bộ bài tập cũ đã bị hủy; hãy xác nhận lại.");
        return;
      }
      pendingRef.current = false;
      requestIdRef.current = result.id;
      setPreparedSourceScope(requestSourceScope ? { ...requestSourceScope, preparationId: result.id } : null);
      setInvalidatedPreparationId(null);
      invalidatedPreparationRef.current = null;
      onPreparationChange(result, requestSourceScope
        ? { ...requestSourceScope, preparationId: result.id }
        : null);
      setMode(result.mode);
      setEditing(false);
      setConfirmationScope(null);
    } catch (reason) {
      const aborted = reason instanceof DOMException && reason.name === "AbortError";
      if (!controller.signal.aborted && !aborted && generation === generationRef.current)
        setError(reason instanceof Error ? reason.message : "Không thể tạo bộ bài tập. Hãy thử lại.");
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        requestSourceScopeRef.current = null;
        setPending(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  if (!authenticated) {
    return <section className="study-exercises" aria-labelledby="study-exercises-title">
      <h3 id="study-exercises-title">Giải bài tập bằng AI</h3>
      <p className="material-hint" role="status">
        Đăng nhập để lưu bài tập riêng tư và nhận lời giải sau khi phiên học hoàn tất. Bạn vẫn có thể bắt đầu phiên học như bình thường.
      </p>
    </section>;
  }

  if (activePreparation && !editing) {
    return <section className="study-exercises" aria-labelledby="study-exercises-title">
      <div className="study-exercises__heading">
        <div><h3 id="study-exercises-title">Giải bài tập bằng AI</h3>
          <p className="material-hint">Chỉ hiện đề trong phiên học. Lời giải được yêu cầu sau khi máy chủ xác nhận phiên đã hoàn tất.</p></div>
      </div>
      <StudyExerciseQuestionViewer preparation={activePreparation} phase="focus" />
      <div className="study-exercises__actions">
        <button type="button" disabled={disabled || invalidating} onClick={() => void editPreparedSet()}>
          {invalidating ? "Đang hủy bộ bài…" : "Sửa đề hoặc nguồn"}
        </button>
        <button type="button" className="study-exercises__secondary" disabled={disabled || invalidating} onClick={() => void cancelPreparedSet()}>
          Bỏ bộ bài tập
        </button>
      </div>
      {error && <p className="study-exercises__error" role="alert">{error}</p>}
    </section>;
  }

  if (skipped) {
    return <section className="study-exercises" aria-labelledby="study-exercises-title">
      <h3 id="study-exercises-title">Giải bài tập bằng AI</h3>
      <p className="material-hint">Phiên này sẽ không dùng bộ bài tập riêng.</p>
      <button type="button" disabled={disabled} onClick={() => { setSkipped(false); setEditing(true); }}>
        Chuẩn bị bài tập
      </button>
    </section>;
  }

  const sourceNeedsReview = mode === "generated" && selectedSource && !selectedSource.reviewed;
  const sourceTooLong = mode === "generated" && selectedSource && selectedSource.text.length > 20_000;

  return <section className="study-exercises" aria-labelledby="study-exercises-title">
    <div className="study-exercises__heading">
      <div><h3 id="study-exercises-title">Giải bài tập bằng AI</h3>
        <p className="material-hint">Dán đề bài để nhận lời giải sau phiên học, hoặc chọn nguồn đã xem lại để AI tạo câu hỏi mở. Chỉ nội dung bạn xác nhận mới được gửi.</p></div>
    </div>

    <fieldset className="study-exercises__modes" disabled={disabled || pending || invalidating}>
      <legend>Chọn cách chuẩn bị</legend>
      <label><input type="radio" name="study-exercise-mode" value="provided" checked={mode === "provided"}
        onChange={() => changeMode("provided")} />
        Tôi sẽ nhập đề</label>
      <label><input type="radio" name="study-exercise-mode" value="generated" checked={mode === "generated"}
        onChange={() => changeMode("generated")} />
        Tạo đề từ tài liệu đã xem lại</label>
    </fieldset>

    {mode === "provided" ? <>
      {sources.length > 0 && <label className="study-exercises__source-select">
        Chép nội dung từ tài liệu đã xác nhận
        <select value={selectedSourceId} disabled={disabled || pending || invalidating} onChange={event => changeSource(event.target.value)}>
          <option value="">Không chọn tài liệu</option>
          {sources.map(source => <option key={source.id} value={source.id} disabled={!source.reviewed}>
            {source.name}{!source.reviewed ? " · cần kiểm tra" : source.text.length > STUDY_EXERCISE_TEXT_LIMIT ? " · vượt giới hạn" : " · đã xác nhận"}
          </option>)}
        </select>
      </label>}
      {selectedSource && <div className="study-exercises__source-import">
        <label htmlFor="study-exercise-source-preview">{selectedSource.reviewed ? "Xem lại nội dung nguồn đã xác nhận" : "Nội dung nguồn cần kiểm tra"}
          <textarea id="study-exercise-source-preview" rows={5} value={selectedSource.text} readOnly aria-readonly="true" />
        </label>
        {!selectedSource.reviewed && <p className="material-hint" role="status">Hãy xem lại và xác nhận nguồn trong phần Tài liệu trước khi chép vào đề.</p>}
        {selectedSource.text.length > STUDY_EXERCISE_TEXT_LIMIT &&
          <p className="study-exercises__error" role="alert">Nguồn vượt 20.000 ký tự. Hãy chọn một phần ngắn hơn trong tài liệu.</p>}
        <div className="study-exercises__import-actions">
          <button type="button" disabled={disabled || pending || invalidating || !isReviewedStudyExerciseSource(selectedSource)}
            onClick={() => applyProvidedTextImport(selectedSource.text, "replace")}>Thay đề bằng nội dung này</button>
          <button type="button" disabled={disabled || pending || invalidating || !isReviewedStudyExerciseSource(selectedSource)}
            onClick={() => applyProvidedTextImport(selectedSource.text, "append")}>Nối vào cuối đề</button>
        </div>
      </div>}
      <StudyExerciseTextImportPanel
        state={textImport}
        disabled={disabled || pending || invalidating}
        onFileSelected={extractExerciseText}
        onCancel={cancelTextImport}
        onEdit={text => textImportControllerRef.current?.editText(text)}
        onApply={applyExtractedText}
      />
      <StudyExerciseProblemEditor
        value={providedText}
        disabled={disabled || pending || invalidating}
        onChange={value => { setProvidedText(value); setConfirmationScope(null); setError(""); }}
      />
    </> : <>
      <label className="study-exercises__source-select" htmlFor="study-exercise-source">Nguồn tài liệu
        <select id="study-exercise-source" value={selectedSourceId} disabled={disabled || pending || invalidating}
          onChange={event => changeSource(event.target.value)}>
          <option value="">Chọn nguồn đã xác nhận</option>
          {sources.map(source => <option key={source.id} value={source.id}
            disabled={!source.reviewed || source.text.length > 20_000}>
            {source.name}{!source.reviewed ? " · cần kiểm tra" : source.text.length > 20_000 ? " · vượt giới hạn" : " · đã xác nhận"}
          </option>)}
        </select>
      </label>
      {sourceNeedsReview && <p className="material-hint" role="status">Hãy kiểm tra và xác nhận nội dung trong phần Tài liệu trước khi dùng nguồn này.</p>}
      {sourceTooLong && <p className="study-exercises__error" role="alert">Nguồn vượt 20.000 ký tự. Hãy chọn phần cần học.</p>}
      {selectedSource && selectedSource.reviewed && <label htmlFor="study-exercise-source-preview">Xem lại đúng nội dung sẽ gửi
        <textarea id="study-exercise-source-preview" rows={5} value={selectedSource.text} readOnly aria-readonly="true" />
      </label>}
      <label className="study-exercises__count" htmlFor="study-exercise-count">Số bài tập dạng mở
        <select id="study-exercise-count" value={count} disabled={disabled || pending || invalidating}
          onChange={event => { setCount(Number(event.target.value)); setConfirmationScope(null); }}>
          {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <p className="material-hint">Lựa chọn chỉ xuất hiện nếu thực sự hữu ích; bài tập không bắt buộc là trắc nghiệm.</p>
    </>}

    {isTooLong && <p className="study-exercises__error" role="alert">
      {mode === "provided" ? "Đề vượt 20.000 ký tự. Hãy chọn phần cần giải." : "Nguồn vượt 20.000 ký tự. Hãy chọn phần cần học."}
    </p>}
    <p className="study-exercises__length" aria-live="polite">{text.length.toLocaleString("vi-VN")} / 20.000 ký tự</p>
    <label className="study-exercises__confirmation">
      <input type="checkbox" checked={confirmationIsCurrent} disabled={disabled || pending || invalidating || !text.trim() || isTooLong ||
        (mode === "generated" && (!isReviewedStudyExerciseSource(selectedSource) || selectedSourceFingerprint === null))}
        onChange={event => {
          if (!event.target.checked) {
            setConfirmationScope(null);
          } else if (mode === "provided") {
            setConfirmationScope({ mode: "provided", exactText: providedText });
          } else if (selectedSource && selectedSourceFingerprint) {
            setConfirmationScope({ mode: "generated", sourceId: selectedSource.id, textFingerprint: selectedSourceFingerprint });
          }
        }} />
      {studyExerciseConfirmationCopy(mode)}
    </label>

    <div className="study-exercises__actions">
      <button type="button" className="study-exercises__primary" disabled={!canSubmit} onClick={() => void prepare()}>
        {pending ? "Đang tạo bài tập…" : "Tạo bộ bài tập"}
      </button>
      {pending && <button type="button" className="study-exercises__secondary" disabled={invalidating} onClick={() => void cancelPendingRequest()}>
        Hủy yêu cầu
      </button>}
      {!pending && <button type="button" className="study-exercises__secondary" disabled={disabled || invalidating} onClick={() => void cancelPreparedSet()}>
        Bỏ qua bài tập
      </button>}
    </div>
    {pending && <p className="material-hint" role="status">Đang tạo đề. Bạn có thể hủy yêu cầu; phiên tập trung vẫn hoạt động bình thường.</p>}
    {error && <p className="study-exercises__error" role="alert">{error}</p>}
  </section>;
}

export function StudyExerciseQuestionViewer({
  preparation,
  phase,
  solutionStatus = "locked",
  solutions = null,
  onRequestSolution,
  onCancelSolution,
  onSkip,
}: {
  preparation: StudyExercisePreparationResponse | null;
  phase: "focus" | "summary";
  solutionStatus?: StudyExerciseSolutionStatus;
  solutions?: StudyExerciseSolutionResponse | null;
  onRequestSolution?: () => void;
  onCancelSolution?: () => void;
  onSkip?: () => void;
}) {
  if (!preparation) return null;
  const reveal = canRevealStudyExerciseSolutions(phase, solutionStatus) && solutions !== null;
  return <section className={`study-exercises__viewer study-exercises__viewer--${phase}`} aria-label="Bộ bài tập">
    <ol className="study-exercises__questions">
      {preparation.exercises.map((exercise, index) => {
        const solution = reveal ? solutions.exercises.find(item => item.id === exercise.id) : undefined;
        return <li key={exercise.id}>
          <StudyGuideArticle title={`Bài ${index + 1}`} text={exercise.prompt} aiGenerated={preparation.mode === "generated"} />
          {exercise.choices && <ul className="study-exercises__choices" aria-label={`Lựa chọn cho bài ${index + 1}`}>
            {exercise.choices.map((choice, choiceIndex) => <li key={`${exercise.id}-${choiceIndex}`}>
              <StudyGuideInlineText text={choice} />
            </li>)}
          </ul>}
          {solution && <StudyGuideArticle
            title={`Lời giải bài ${index + 1}`}
            text={`${solution.solution}\n\n## Giải thích từng bước\n${solution.explanation}`}
            aiGenerated
          />}
        </li>;
      })}
    </ol>

    {phase === "summary" && solutionStatus === "locked" &&
      <p className="material-hint" role="status">Lời giải chỉ mở sau khi phiên đã được lưu và máy chủ xác nhận hoàn tất.</p>}
    {phase === "summary" && solutionStatus === "available" && <div className="study-exercises__actions">
      <button type="button" className="study-exercises__primary" onClick={onRequestSolution}>Xem lời giải</button>
      {onSkip && <button type="button" className="study-exercises__secondary" onClick={onSkip}>Bỏ qua lời giải</button>}
    </div>}
    {phase === "summary" && solutionStatus === "loading" && <div className="study-exercises__actions" aria-busy="true">
      <p className="material-hint" role="status">Đang soạn lời giải theo đề đã lưu…</p>
      {onCancelSolution && <button type="button" className="study-exercises__secondary" onClick={onCancelSolution}>Hủy yêu cầu</button>}
    </div>}
    {phase === "summary" && solutionStatus === "error" && <div className="study-exercises__actions">
      <p className="study-exercises__error" role="alert">Chưa lấy được lời giải. Phiên học vẫn đã hoàn tất.</p>
      <button type="button" onClick={onRequestSolution}>Thử lại</button>
      {onSkip && <button type="button" className="study-exercises__secondary" onClick={onSkip}>Bỏ qua lời giải</button>}
    </div>}
    {phase === "summary" && solutionStatus === "ready" && !solutions &&
      <p className="material-hint" role="status">Máy chủ chưa trả lời giải cho bộ bài tập này.</p>}
  </section>;
}
