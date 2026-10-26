import { useEffect, useRef, useState } from "react";
import {
  composePublicMaterialSummary,
  eligiblePublicMaterialSummaryCandidates,
  publicMaterialSummaryLength,
  publicSummaryModeMatchesStatus,
  publicSummaryPreviewMatches,
  publicSummaryWriteIntent,
  publicSummaryWithdrawalIntent,
  readPublicMaterialSummary,
  publishPublicMaterialSummary,
  replacePublicMaterialSummary,
  withdrawPublicMaterialSummary,
  type PublicMaterialSummaryCandidate,
  type PublicMaterialSummaryStatus,
  type PublicMaterialSummaryPreviewSnapshot,
  type PublicSummaryWithdrawalConfirmation,
} from "@/services/publicMaterialSummary";
import { ApiError } from "@/services/api";
import "./publicMaterialSummary.css";

export type PublicMaterialSummaryScope = {
  ownerId: string;
  sessionId: string;
  authGeneration: number;
  workspaceGeneration: number;
  view: "summary";
};

type ScopedStatus = { scopeKey: string; value: PublicMaterialSummaryStatus };
type Preview = PublicMaterialSummaryPreviewSnapshot & {
  text: string;
  candidateKey: string;
  selectedSourceIds: string[];
};

export function PublicMaterialSummaryControl({
  scope,
  candidates: rawCandidates,
  canManage = true,
  disabledReason = "",
  isScopeCurrent,
  isCandidateCurrent,
}: {
  scope: PublicMaterialSummaryScope;
  candidates: readonly PublicMaterialSummaryCandidate[];
  canManage?: boolean;
  disabledReason?: string;
  isScopeCurrent: (scope: PublicMaterialSummaryScope) => boolean;
  isCandidateCurrent: (candidate: PublicMaterialSummaryCandidate) => boolean;
}) {
  const candidates = eligiblePublicMaterialSummaryCandidates(rawCandidates);
  const candidateKey = JSON.stringify(candidates.map(({ sourceId, sourceFingerprint, summary }) =>
    [sourceId, sourceFingerprint, summary],
  ));
  const scopeKey = JSON.stringify(scope);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const scopeEpoch = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  const [statusState, setStatusState] = useState<ScopedStatus | null>(null);
  const statusStateRef = useRef(statusState);
  statusStateRef.current = statusState;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"publish" | "replace" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState<PublicSummaryWithdrawalConfirmation | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const status = statusState?.scopeKey === scopeKey ? statusState.value : null;
  const activeSummary = status?.summary ?? null;

  useEffect(() => {
    setSelected([]);
    setDraft("");
    setMode(null);
    setPreview(null);
    setConfirmWithdraw(null);
    setNotice("");
  }, [scopeKey, candidateKey]);

  useEffect(() => {
    if (preview && !publicSummaryPreviewMatches(preview, status, mode)) setPreview(null);
  }, [preview, status, mode]);

  useEffect(() => {
    if (mode === null || status === null || publicSummaryModeMatchesStatus(mode, status)) return;
    setMode(null);
    setSelected([]);
    setDraft("");
    setPreview(null);
    setNotice("Trạng thái chia sẻ đã thay đổi. Hãy chọn thao tác phù hợp với trạng thái mới.");
  }, [mode, status]);

  useEffect(() => {
    if (confirmWithdraw && publicSummaryWithdrawalIntent({
      confirmation: confirmWithdraw, status, scopeKey, scopeCurrent: isScopeCurrent(scope), canManage,
    }) === null) setConfirmWithdraw(null);
  }, [confirmWithdraw, status, scopeKey, scope, isScopeCurrent, canManage]);

  useEffect(() => {
    const epoch = ++scopeEpoch.current;
    const controller = new AbortController();
    operationController.current?.abort();
    operationController.current = null;
    setBusy(false);
    setError("");
    const hasScopedStatus = statusStateRef.current?.scopeKey === scopeKey;
    if (!hasScopedStatus) {
      setStatusState(null);
      setLoading(true);
    } else {
      setLoading(false);
    }
    if (!canManage || !isScopeCurrent(scope)) {
      setLoading(false);
      return () => controller.abort();
    }
    const isCurrent = () => epoch === scopeEpoch.current && scopeKeyRef.current === scopeKey &&
      !controller.signal.aborted && isScopeCurrent(scope);
    void readPublicMaterialSummary(scope.sessionId, controller.signal).then((value) => {
      if (isCurrent()) { setStatusState({ scopeKey, value }); setError(""); }
    }).catch((failure: unknown) => {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : "Không tải được trạng thái chia sẻ.");
    }).finally(() => {
      if (isCurrent()) setLoading(false);
    });
    return () => {
      controller.abort();
      if (operationController.current) operationController.current.abort();
    };
  }, [scope, scopeKey, canManage, isScopeCurrent, reloadGeneration]);

  const isCurrentOperation = (controller: AbortController, epoch: number) =>
    !controller.signal.aborted && epoch === scopeEpoch.current && scopeKeyRef.current === scopeKey &&
    isScopeCurrent(scope);
  const selectedCandidates = candidates.filter((candidate) => selected.includes(candidate.sourceId));
  const selectedCandidatesAreCurrent = selectedCandidates.length === selected.length &&
    selectedCandidates.every(isCandidateCurrent);
  const modeMatchesStatus = publicSummaryModeMatchesStatus(mode, status);
  const currentPreview = modeMatchesStatus && preview !== null && preview.candidateKey === candidateKey &&
    JSON.stringify(preview.selectedSourceIds) === JSON.stringify(selected) && selectedCandidatesAreCurrent &&
    publicSummaryPreviewMatches(preview, status, mode)
    ? preview.text
    : null;
  const withdrawalIntent = publicSummaryWithdrawalIntent({
    confirmation: confirmWithdraw, status, scopeKey, scopeCurrent: isScopeCurrent(scope), canManage,
  });
  const selectSource = (sourceId: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selected, sourceId])]
      : selected.filter((id) => id !== sourceId);
    const nextCandidates = candidates.filter((candidate) => next.includes(candidate.sourceId));
    setSelected(next);
    setDraft(composePublicMaterialSummary(nextCandidates));
    setPreview(null);
    setError("");
    setNotice("");
  };
  const startReplace = () => {
    setSelected([]);
    setDraft("");
    setMode("replace");
    setPreview(null);
    setConfirmWithdraw(null);
    setNotice("");
  };
  const startPublish = () => {
    setSelected([]);
    setDraft("");
    setMode("publish");
    setPreview(null);
    setConfirmWithdraw(null);
    setNotice("");
  };
  const startWithdrawConfirmation = () => {
    if (!status || status.summary === null || status.approvedAt === null) return;
    setConfirmWithdraw({
      version: status.version,
      summary: status.summary,
      approvedAt: status.approvedAt,
      scopeKey,
    });
  };
  const refreshAfterConflict = () => {
    setMode(null);
    setPreview(null);
    setConfirmWithdraw(null);
    setStatusState(null);
    setLoading(true);
    setError("");
    setNotice("Bản chia sẻ đã thay đổi. Hãy kiểm tra trạng thái mới trước khi xác nhận lại.");
    setReloadGeneration((value) => value + 1);
  };
  const submit = async () => {
    const intent = publicSummaryWriteIntent({
      sessionId: scope.sessionId,
      status,
      mode,
      previewText: currentPreview,
      previewMode: preview?.mode ?? null,
      previewVersion: preview?.expectedVersion ?? null,
      previewSummary: preview?.statusSummary ?? null,
      previewApprovedAt: preview?.statusApprovedAt ?? null,
      selectedSourceCount: selected.length,
      selectedCandidatesCurrent: selectedCandidatesAreCurrent,
      scopeCurrent: isScopeCurrent(scope),
      canManage,
    });
    if (!intent) return;
    const controller = new AbortController();
    operationController.current?.abort();
    operationController.current = controller;
    const epoch = scopeEpoch.current;
    setBusy(true);
    setError("");
    try {
      const next = intent.mode === "replace"
        ? await replacePublicMaterialSummary(intent.sessionId, intent.summary, intent.expectedVersion, controller.signal)
        : await publishPublicMaterialSummary(intent.sessionId, intent.summary, intent.expectedVersion, controller.signal);
      if (!isCurrentOperation(controller, epoch)) return;
      setStatusState({ scopeKey, value: next });
      setMode(null);
      setPreview(null);
      setDraft("");
      setSelected([]);
      setNotice("");
    } catch (failure) {
      if (isCurrentOperation(controller, epoch)) {
        if (failure instanceof ApiError && failure.status === 409) refreshAfterConflict();
        else setError(failure instanceof Error ? failure.message : "Không cập nhật được tóm tắt chia sẻ.");
      }
    } finally {
      if (isCurrentOperation(controller, epoch)) setBusy(false);
      if (operationController.current === controller) operationController.current = null;
    }
  };
  const withdraw = async () => {
    const intent = publicSummaryWithdrawalIntent({
      confirmation: confirmWithdraw, status, scopeKey, scopeCurrent: isScopeCurrent(scope), canManage,
    });
    if (!intent) return;
    const controller = new AbortController();
    operationController.current?.abort();
    operationController.current = controller;
    const epoch = scopeEpoch.current;
    setBusy(true);
    setError("");
    try {
      const next = await withdrawPublicMaterialSummary(scope.sessionId, intent.expectedVersion, controller.signal);
      if (!isCurrentOperation(controller, epoch)) return;
      setStatusState({ scopeKey, value: next });
      setConfirmWithdraw(null);
      setMode(null);
      setPreview(null);
      setNotice("");
    } catch (failure) {
      if (isCurrentOperation(controller, epoch)) {
        if (failure instanceof ApiError && failure.status === 409) refreshAfterConflict();
        else setError(failure instanceof Error ? failure.message : "Không thu hồi được tóm tắt chia sẻ.");
      }
    } finally {
      if (isCurrentOperation(controller, epoch)) setBusy(false);
      if (operationController.current === controller) operationController.current = null;
    }
  };
  const length = publicMaterialSummaryLength(draft);
  const canPreview = canManage && modeMatchesStatus && status !== null && !loading && !busy && selected.length > 0 &&
    selectedCandidatesAreCurrent && draft.trim().length > 0 && !draft.includes("\u0000") && length <= 500 &&
    isScopeCurrent(scope);
  if (!isScopeCurrent(scope)) return null;
  return <section className="public-material-summary" aria-labelledby={`public-summary-title-${scope.sessionId}`}>
    <h3 id={`public-summary-title-${scope.sessionId}`}>Chia sẻ tóm tắt tài liệu</h3>
    <p className="material-hint">Chỉ bản tóm tắt bạn duyệt mới xuất hiện dưới mục tiêu trong lịch sử chung. Tên tệp và nội dung nguồn vẫn riêng tư.</p>
    {loading && <p role="status">Đang tải trạng thái chia sẻ…</p>}
    {!loading && status === null && error && <button type="button" disabled={!canManage} onClick={() => {
      setError(""); setLoading(true); setReloadGeneration((value) => value + 1);
    }}>Thử tải lại trạng thái</button>}
    {!loading && status && activeSummary !== null && <div className="public-material-summary__current">
      <h4>Đang chia sẻ</h4>
      <blockquote>{activeSummary}</blockquote>
      {mode === null && !confirmWithdraw ? <div className="choice-row">
        <button type="button" disabled={!canManage || busy} onClick={startReplace}>Chuẩn bị thay thế</button>
        <button type="button" className="public-material-summary__withdraw" disabled={!canManage || busy}
          onClick={startWithdrawConfirmation}>Thu hồi</button>
      </div> : confirmWithdraw ? <div className="public-material-summary__confirm">
        <p>Thu hồi sẽ gỡ bản tóm tắt khỏi lịch sử chung.</p>
        <button type="button" className="public-material-summary__withdraw"
          disabled={!canManage || busy || withdrawalIntent === null} onClick={() => void withdraw()}>
          {busy ? "Đang thu hồi…" : "Xác nhận thu hồi"}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirmWithdraw(null)}>Giữ nguyên</button>
      </div> : null}
    </div>}
    {!loading && status && activeSummary === null && mode === null && <button type="button" disabled={!canManage || candidates.length === 0}
      onClick={startPublish}>Tạo bản chia sẻ</button>}
    {!loading && status && mode !== null && <div className="public-material-summary__composer">
      <h4>{mode === "replace" ? "Soạn bản thay thế" : "Soạn tóm tắt để chia sẻ"}</h4>
      {candidates.length ? <fieldset>
        <legend>Chọn tóm tắt riêng tư đã tạo từ nguồn đã kiểm tra</legend>
        {candidates.map((candidate) => <label key={candidate.sourceId}>
          <input type="checkbox" checked={selected.includes(candidate.sourceId)} disabled={busy}
            onChange={(event) => selectSource(candidate.sourceId, event.currentTarget.checked)} />
          <span>{candidate.sourceName}</span>
        </label>)}
      </fieldset> : <p className="material-hint">Chưa có tóm tắt riêng tư phù hợp. Hãy kiểm tra nguồn và tạo tóm tắt trước khi chia sẻ.</p>}
      <label htmlFor={`public-summary-draft-${scope.sessionId}`}>Bản nháp công khai</label>
      <textarea id={`public-summary-draft-${scope.sessionId}`} value={draft} disabled={busy} rows={5}
        onChange={(event) => { setDraft(event.currentTarget.value); setPreview(null); }} />
      <p className={length > 500 ? "public-material-summary__count public-material-summary__count--error" : "public-material-summary__count"}>
        {length}/500 ký tự{length > 500 && " · Hãy rút gọn; nội dung sẽ không bị cắt tự động."}
      </p>
      {!canManage && disabledReason && <p className="material-hint">{disabledReason}</p>}
      <div className="choice-row">
        <button type="button" className="public-material-summary__preview-action" disabled={!canPreview} onClick={() => {
          if (!status || !mode) return;
          setPreview({
            text: draft, candidateKey, selectedSourceIds: [...selected], mode,
            expectedVersion: status.version, statusSummary: status.summary, statusApprovedAt: status.approvedAt,
          });
        }}>
          {mode === "replace" ? "Xem trước bản thay thế" : "Xem trước bản chia sẻ"}
        </button>
        <button type="button" disabled={busy} onClick={() => { setMode(null); setPreview(null); }}>Hủy soạn</button>
      </div>
      {currentPreview !== null && <div className="public-material-summary__preview">
        <h4>{mode === "replace" ? "Xác nhận nội dung thay thế" : "Xác nhận nội dung công khai"}</h4>
        <blockquote>{currentPreview}</blockquote>
        <p>Bản xem trước này sẽ hiển thị với mọi người trong lịch sử chuyến đi.</p>
        <button type="button" className="primary" disabled={busy || !canManage || !isScopeCurrent(scope)} onClick={() => void submit()}>
          {busy ? "Đang lưu…" : mode === "replace" ? "Xác nhận thay thế" : "Xác nhận chia sẻ"}
        </button>
      </div>}
    </div>}
    {notice && <p role="status" className="material-hint">{notice}</p>}
    {error && <p role="alert" className="info-box">{error}</p>}
  </section>;
}
