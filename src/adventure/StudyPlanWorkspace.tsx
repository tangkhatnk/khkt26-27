import { useState, type ReactNode } from "react";
import type { SavedStudyPlan, StudyPlanStep } from "./studyPlanStorage.ts";
import { isValidStudyMinutes } from "./quickTripDraft.ts";
import "./studyPlanWorkspace.css";

export type StudyPlanWorkspaceStatus = "idle" | "pending" | "ready" | "error" | "cancelled";
export type StudyPlanStepDraft = Pick<StudyPlanStep, "action" | "outcome" | "check">;
export type StudyPlanStepPatch = Partial<Pick<StudyPlanStep, "title" | "action" | "outcome" | "check">>;
export type StudyPlanStepDraftErrors = Partial<Record<keyof StudyPlanStepDraft, string>>;
export type StudyPlanStepRouteState = "available" | "completed" | "locked";
export type StudyPlanStepState = { stepId: string; state: StudyPlanStepRouteState };

const STUDY_PLAN_STEP_STATE_LABELS: Record<StudyPlanStepRouteState, string> = {
  available: "Có thể học",
  completed: "Đã hoàn thành",
  locked: "Chưa mở",
};

function getStudyPlanStepState(stepId: string, stepStates?: readonly StudyPlanStepState[]): StudyPlanStepRouteState {
  // The App owns eligibility. Missing state is deliberately closed until it supplies an explicit mapping.
  return stepStates?.find((entry) => entry.stepId === stepId)?.state ?? "locked";
}

function studyPlanRouteRailPath(nodeCount: number): string {
  if (!nodeCount) return "";
  const routeX = [330, 670, 420, 580];
  const point = (index: number) => ({
    x: routeX[index % routeX.length],
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

const STUDY_PLAN_STEP_DRAFT_FIELDS = ["action", "outcome", "check"] as const;

export function getStudyPlanStepDraftErrors(draft: StudyPlanStepDraft): StudyPlanStepDraftErrors {
  const errors: StudyPlanStepDraftErrors = {};
  for (const field of STUDY_PLAN_STEP_DRAFT_FIELDS) {
    const trimmedLength = draft[field].trim().length;
    if (trimmedLength < 3) errors[field] = "Nhập ít nhất 3 ký tự.";
    else if (trimmedLength > 400) errors[field] = "Tối đa 400 ký tự.";
  }
  return errors;
}

export function isStudyPlanStepDraftDirty(step: StudyPlanStepDraft, draft: StudyPlanStepDraft): boolean {
  return STUDY_PLAN_STEP_DRAFT_FIELDS.some((field) => step[field].trim() !== draft[field].trim());
}

export function buildStudyPlanStepPatch(draft: StudyPlanStepDraft): StudyPlanStepDraft {
  return {
    action: draft.action.trim(),
    outcome: draft.outcome.trim(),
    check: draft.check.trim(),
  };
}

export function commitStudyPlanStepDraft({
  stepId,
  current,
  draft,
  onSave,
}: {
  stepId: string;
  current: StudyPlanStepDraft;
  draft: StudyPlanStepDraft;
  onSave: (stepId: string, patch: StudyPlanStepPatch) => boolean;
}): boolean {
  if (!isStudyPlanStepDraftDirty(current, draft) || Object.keys(getStudyPlanStepDraftErrors(draft)).length > 0) return false;
  return onSave(stepId, buildStudyPlanStepPatch(draft)) === true;
}

export function requestStudyPlanStepSelection({
  stepId,
  dirty,
  onSelect,
  onBlocked,
}: {
  stepId: string;
  dirty: boolean;
  onSelect: (stepId: string) => void;
  onBlocked: () => void;
}): boolean {
  if (dirty) {
    onBlocked();
    return false;
  }
  onSelect(stepId);
  return true;
}

export function StudyPlanStepNavigation({
  steps,
  stepStates,
  selectedStepId,
  onSelectStep,
}: {
  steps: readonly StudyPlanStep[];
  stepStates?: readonly StudyPlanStepState[];
  selectedStepId: string;
  onSelectStep?: (stepId: string) => void;
}) {
  // Keep the exported standalone navigation helper compatible with legacy callers. The Workspace passes [] when its App-owned map is absent.
  const resolvedStepStates = stepStates ?? steps.map((step) => ({ stepId: step.id, state: "available" as const }));
  const availableStepId = steps.find((step) => getStudyPlanStepState(step.id, resolvedStepStates) === "available")?.id;
  const hasLockedSteps = steps.some((step) => getStudyPlanStepState(step.id, resolvedStepStates) === "locked");
  return <div className="study-plan-workspace__route-frame">
    {hasLockedSteps && <p className="study-plan-workspace__route-note">Các bước màu xám hiện chưa thể chọn.</p>}
    <div className="study-plan-workspace__route-canvas">
      {steps.length > 1 && <svg className="study-plan-workspace__route-rail" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <path className="study-plan-workspace__route-line" d={studyPlanRouteRailPath(steps.length)} />
      </svg>}
      <ol className={`study-plan-workspace__steps ${steps.length > 1 ? "has-rail" : "is-single"} study-plan-workspace__step-route study-plan-workspace__step-nav`} aria-label="Các bước trong lộ trình cá nhân">
        {steps.map((step, index) => {
          const state = getStudyPlanStepState(step.id, resolvedStepStates);
          const stateLabel = STUDY_PLAN_STEP_STATE_LABELS[state];
          const selected = step.id === selectedStepId;
          const canSelect = state !== "locked" && Boolean(onSelectStep);
          const isAvailableStep = step.id === availableStepId;
          const sideClass = index % 2 === 0 ? "left" : "right";
          const distanceClass = index % 4 < 2 ? "far" : "near";
          const calloutLabel = index === 0 ? "Bắt đầu" : "Bước tiếp theo";
          return <li className={`study-plan-workspace__route-row study-plan-workspace__route-row--${sideClass}`} key={step.id}>
            <div className={`study-plan-workspace__route-node-wrap study-plan-workspace__route-node-wrap--${sideClass} study-plan-workspace__route-node-wrap--${distanceClass}`}>
              <button type="button"
                className={`study-plan-workspace__route-node is-${state}${selected ? " is-selected" : ""}`}
              aria-label={`Bước ${index + 1}: ${step.title} · ${stateLabel}${isAvailableStep ? ` · ${calloutLabel}` : ""}`}
                aria-current={selected ? "step" : undefined}
                disabled={!canSelect}
                onClick={() => { if (canSelect) onSelectStep?.(step.id); }}>
                <span>{index + 1}</span>
              </button>
            </div>
            <div className={`study-plan-workspace__route-copy study-plan-workspace__route-copy--${sideClass}`}>
              {isAvailableStep && <span className="study-plan-workspace__route-callout" aria-hidden="true">{calloutLabel}</span>}
              <div aria-hidden="true">
                {state === "completed" && <span className="study-plan-workspace__route-status is-completed">{stateLabel}</span>}
                <strong>{step.title}</strong>
              </div>
            </div>
          </li>;
        })}
      </ol>
    </div>
  </div>;
}

export function StudyPlanStepEditor({
  stepId,
  stepTitle,
  draft,
  errors,
  canSave,
  onDraftChange,
  onSave,
  onCancel,
}: {
  stepId: string;
  stepTitle: string;
  draft: StudyPlanStepDraft;
  errors: StudyPlanStepDraftErrors;
  canSave: boolean;
  onDraftChange: (field: keyof StudyPlanStepDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const fields: Array<{ key: keyof StudyPlanStepDraft; label: string }> = [
    { key: "action", label: "Hành động" },
    { key: "outcome", label: "Kết quả mong đợi" },
    { key: "check", label: "Câu tự kiểm tra" },
  ];
  return <fieldset className="study-plan-workspace__editor">
    <legend>Chỉnh sửa bước {stepTitle}</legend>
    {fields.map(({ key, label }) => {
      const id = `study-plan-step-${stepId}-${key}`;
      const errorId = `${id}-error`;
      const error = errors[key];
      return <div className="study-plan-workspace__editor-field" key={key}>
        <label htmlFor={id}>{label}</label>
        <textarea id={id} aria-label={`${label} cho bước ${stepTitle}`} aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined} autoFocus={key === "action"} required maxLength={400} rows={3} value={draft[key]}
          onChange={(event) => onDraftChange(key, event.currentTarget.value)} />
        {error && <p id={errorId} className="study-plan-workspace__field-error" role="alert">{error}</p>}
      </div>;
    })}
    <div className="study-plan-workspace__editor-actions">
      <button type="button" className="study-plan-workspace__save" disabled={!canSave} onClick={onSave}>Lưu thay đổi</button>
      <button type="button" className="study-plan-workspace__discard" onClick={onCancel}>Hủy</button>
    </div>
  </fieldset>;
}

export function StudyPlanWorkspace({
  goal,
  subject,
  preferredMinutes,
  breakCount,
  breakMinutes,
  plan,
  stepStates,
  selectedStepId,
  planStatus = "idle",
  planError,
  planActionReason,
  onGeneratePlan,
  onCancelPlan,
  onSelectStep,
  onSaveStep,
  sourceAvailable = false,
  sourceReviewed = false,
  includeSource = false,
  onIncludeSourceChange,
  children,
  legacyDetails,
}: {
  goal: string;
  subject: string;
  preferredMinutes: number;
  breakCount: number;
  breakMinutes: number;
  plan?: SavedStudyPlan;
  /** Explicit App-owned eligibility state for every route node; missing entries render locked. */
  stepStates?: readonly StudyPlanStepState[];
  /** The App-owned current selection, independent of whether that step is available or completed. */
  selectedStepId?: string;
  planStatus?: StudyPlanWorkspaceStatus;
  planError?: string;
  planActionReason?: string;
  onGeneratePlan?: () => void;
  onCancelPlan?: () => void;
  onSelectStep?: (stepId: string) => void;
  onSaveStep?: (stepId: string, patch: StudyPlanStepPatch) => boolean;
  sourceAvailable?: boolean;
  sourceReviewed?: boolean;
  includeSource?: boolean;
  onIncludeSourceChange?: (include: boolean) => void;
  children?: ReactNode;
  legacyDetails?: ReactNode;
}) {
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<StudyPlanStepDraft | null>(null);
  const [editNotice, setEditNotice] = useState("");
  const [stepSaveError, setStepSaveError] = useState("");
  const requestedStepId = selectedStepId ?? plan?.selectedStepId;
  const selectedStep = plan?.steps.find((step) => step.id === requestedStepId) ?? plan?.steps[0];
  const selectedStepIndex = selectedStep && plan ? plan.steps.findIndex((step) => step.id === selectedStep.id) : -1;
  const editingSelectedStep = Boolean(plan && selectedStep && editingPlanId === plan.id && editingStepId === selectedStep.id && stepDraft);
  const draftErrors = stepDraft ? getStudyPlanStepDraftErrors(stepDraft) : {};
  const stepDraftDirty = Boolean(editingSelectedStep && selectedStep && stepDraft && isStudyPlanStepDraftDirty(selectedStep, stepDraft));
  const stepDraftValid = Object.keys(draftErrors).length === 0;

  const clearStepDraft = () => {
    setEditingPlanId(null);
    setEditingStepId(null);
    setStepDraft(null);
    setEditNotice("");
    setStepSaveError("");
  };
  const selectPlanStep = (stepId: string) => {
    if (stepId === selectedStep?.id) return;
    requestStudyPlanStepSelection({
      stepId,
      dirty: stepDraftDirty,
      onSelect: (nextStepId) => {
        clearStepDraft();
        onSelectStep?.(nextStepId);
      },
      onBlocked: () => setEditNotice("Hãy lưu hoặc hủy thay đổi trước khi chuyển bước hoặc tạo lại lộ trình."),
    });
  };
  const startStepEditing = () => {
    if (!selectedStep || !onSaveStep || planStatus === "pending") return;
    setEditingPlanId(plan?.id ?? null);
    setEditingStepId(selectedStep.id);
    setStepDraft({ action: selectedStep.action, outcome: selectedStep.outcome, check: selectedStep.check });
    setEditNotice("");
    setStepSaveError("");
  };
  const saveStepDraft = () => {
    if (!selectedStep || !stepDraft || !onSaveStep) return;
    if (commitStudyPlanStepDraft({
      stepId: selectedStep.id,
      current: selectedStep,
      draft: stepDraft,
      onSave: onSaveStep,
    })) clearStepDraft();
    else setStepSaveError("Không lưu được thay đổi. Hãy thử lại.");
  };

  const durationValid = isValidStudyMinutes(preferredMinutes);
  const totalMinutes = durationValid && Number.isSafeInteger(breakCount) && breakCount >= 0 &&
    Number.isSafeInteger(breakMinutes) && breakMinutes >= 1
    ? preferredMinutes + breakCount * breakMinutes
    : null;
  return <section className="study-plan-workspace" aria-labelledby="study-plan-workspace-title">
    <header className="study-plan-workspace__summary">
      <div className="study-plan-workspace__goal">
        <p className="study-plan-workspace__eyebrow">BUỔI HỌC THEO MỤC TIÊU</p>
        <h1 id="study-plan-workspace-title">{goal.trim() || "Bạn muốn đạt điều gì?"}</h1>
        <p className="study-plan-workspace__hero-meta">
          <span>{subject}</span>
          <span aria-hidden="true">·</span>
          <span>{durationValid ? `${preferredMinutes} phút học` : "Thời lượng chưa hợp lệ"}</span>
        </p>
      </div>
      <dl className="study-plan-workspace__timing">
        <div><dt>Giải lao</dt><dd>{breakCount > 0 ? `${breakCount} lượt × ${breakMinutes} phút` : "Không có"}</dd></div>
        <div><dt>Tổng buổi</dt><dd>{totalMinutes === null ? "Chưa xác định" : `${totalMinutes} phút`}</dd></div>
      </dl>
    </header>

    <section className="study-plan-workspace__plan" aria-labelledby="study-plan-workspace-plan-title">
      <div className="study-plan-workspace__plan-heading">
        <div>
          <p className="study-plan-workspace__eyebrow">LỘ TRÌNH CÁ NHÂN</p>
          <h2 id="study-plan-workspace-plan-title">{plan?.title ?? "Chọn bước học của bạn"}</h2>
        </div>
        {plan?.origin === "ai" && <span className="study-plan-workspace__draft-label">Đề xuất AI · chưa xác minh</span>}
        {plan?.origin === "manual" && <span className="study-plan-workspace__draft-label">Kế hoạch của bạn</span>}
      </div>
      {plan?.steps.length ? <div className="study-plan-workspace__plan-layout">
        {selectedStep && <section className="study-plan-workspace__selected-step" aria-labelledby="study-plan-workspace-selected-step-title">
          <div className="study-plan-workspace__selected-heading">
            <div>
              <p className="study-plan-workspace__eyebrow study-plan-workspace__step-position">
                BƯỚC {selectedStepIndex + 1} / {plan.steps.length}
              </p>
              <h3 id="study-plan-workspace-selected-step-title">{selectedStep.title}</h3>
            </div>
            {onSaveStep && !editingSelectedStep && <button type="button" className="study-plan-workspace__edit" disabled={planStatus === "pending"} onClick={startStepEditing}>Chỉnh sửa bước</button>}
          </div>
          {editingSelectedStep && stepDraft ? <StudyPlanStepEditor
            stepId={selectedStep.id}
            stepTitle={selectedStep.title}
            draft={stepDraft}
            errors={draftErrors}
            canSave={stepDraftDirty && stepDraftValid}
            onDraftChange={(field, value) => {
              setEditNotice("");
              setStepSaveError("");
              setStepDraft((current) => current ? { ...current, [field]: value } : current);
            }}
            onSave={saveStepDraft}
            onCancel={clearStepDraft}
          /> : <dl className="study-plan-workspace__selected-content">
            <div><dt>Hành động</dt><dd>{selectedStep.action}</dd></div>
            <div><dt>Kết quả mong đợi</dt><dd>{selectedStep.outcome}</dd></div>
            <div><dt>Tự kiểm tra</dt><dd>{selectedStep.check}</dd></div>
          </dl>}
          {editingSelectedStep && stepSaveError && <p role="alert" className="study-plan-workspace__save-error">{stepSaveError}</p>}
        </section>}
        <StudyPlanStepNavigation steps={plan.steps} stepStates={stepStates ?? []} selectedStepId={selectedStep?.id ?? requestedStepId ?? ""}
          onSelectStep={onSelectStep ? selectPlanStep : undefined} />
      </div> : <p className="study-plan-workspace__empty-plan">Bắt đầu với nội dung của bạn; có thể nhờ AI chia mục tiêu thành các bước rồi xem lại trước khi dùng.</p>}
      {(stepDraftDirty || editNotice) && <p role="status" className="study-plan-workspace__edit-notice">
        {editNotice || "Hãy lưu hoặc hủy thay đổi trước khi chuyển bước hoặc tạo lại lộ trình."}
      </p>}
      {planStatus === "pending" && <p role="status" className="study-plan-workspace__status">Đang tạo bản nháp lộ trình…</p>}
      {planStatus === "error" && planError && <p role="alert" className="study-plan-workspace__error">{planError}</p>}
      {planStatus === "cancelled" && <p role="status" className="study-plan-workspace__status">Đã hủy yêu cầu lập kế hoạch.</p>}
      {sourceAvailable && onIncludeSourceChange && <label className="study-plan-workspace__source-consent">
        <input type="checkbox" checked={includeSource} disabled={!sourceReviewed || planStatus === "pending"}
          onChange={(event) => onIncludeSourceChange(event.target.checked)} />
        <span>Gửi nội dung đã kiểm tra cùng mục tiêu cho AI lập kế hoạch. Chỉ gửi khi chọn ô này.</span>
      </label>}
      {planActionReason && <p className="study-plan-workspace__reason">{planActionReason}</p>}
      {planStatus === "pending" && onCancelPlan && <button className="study-plan-workspace__cancel" type="button" onClick={onCancelPlan}>Hủy yêu cầu</button>}
      {onGeneratePlan && <button className="study-plan-workspace__generate" type="button"
        disabled={planStatus === "pending" || goal.trim().length < 3 || !durationValid || Boolean(planActionReason) || stepDraftDirty}
        onClick={() => {
          if (stepDraftDirty) {
            setEditNotice("Hãy lưu hoặc hủy thay đổi trước khi chuyển bước hoặc tạo lại lộ trình.");
            return;
          }
          if (editingSelectedStep) clearStepDraft();
          onGeneratePlan();
        }}>
        {planStatus === "pending" ? "Đang chia mục tiêu…" : plan ? "Tạo lại bản nháp AI" : "Nhờ AI chia mục tiêu thành các bước"}
      </button>}
    </section>

    <div className="study-plan-workspace__content">{children}</div>
    {legacyDetails && <details className="study-plan-workspace__legacy">
      <summary>Chi tiết hành trình cũ</summary>
      {legacyDetails}
    </details>}
  </section>;
}
