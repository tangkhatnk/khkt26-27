import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../services/api";
import {
  exportAdminReport,
  fetchAdminAccounts,
  fetchAdminAudit,
  fetchAdminGroups,
  fetchAdminReport,
  fetchAdminSession,
  fetchAdminSessionAudit,
  fetchAdminSessions,
  removeAdminSession,
  updateAdminSession,
  updateAdminAccountRole,
  updateAdminAccountSuspension,
  updateAdminAccountProfile,
  updateAdminAccountDeletion,
} from "../services/admin";
import type {
  AdminAccount,
  AdminActionAudit,
  AdminGroup,
  AdminMetricTotals,
  AdminPeriod,
  AdminReportFilters,
  AdminReport,
  AdminSessionAuditAction,
  AdminSessionCorrectionChanges,
  AdminSessionCorrectionField,
  AdminSessionDetail,
  AdminSessionPeriod,
  AdminSession,
  AdminSessionMetrics,
  AdminStateVersion,
} from "../services/adminContracts";
import "./admin.css";

const pageSize = 25;
const periods: AdminPeriod[] = [7, 30, 90];
const sessionPeriods: AdminSessionPeriod[] = ["all", 7, 30, 90];
export const defaultAdminSessionPeriod: AdminSessionPeriod = "all";
export type AdminSessionScope = "global" | "account" | "group";

export function adminSessionApiFilters(
  scope: AdminSessionScope,
  accountId: string | undefined,
  groupId: string | undefined,
  durationBasis: "planned" | "actual" | "",
) {
  return {
    ...(scope === "account" && accountId ? { accountId } : {}),
    ...(scope === "group" && groupId ? { groupId } : {}),
    ...(durationBasis ? { durationBasis } : {}),
  };
}

export function adminSessionOwnerLabel(session: Pick<AdminSession, "accountId">) {
  return session.accountId ? "Phiên tài khoản" : "Phiên khách";
}

export function adminReportCacheKey(days: AdminPeriod, accountId: string | undefined, groupId: string | undefined, revision = 0) {
  return `${days}:${accountId ?? ""}:${groupId ?? ""}:${revision}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không tải được dữ liệu quản trị.";
}

export function isAdminAccessDenied(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export type AdminMutationAction = { kind: "role" | "suspension" | "deletion"; value: boolean } | { kind: "profile" };

export function adminAccountMutationBlockReason(account: AdminAccount, currentUserId?: string, action?: AdminMutationAction) {
  if (currentUserId && account.id === currentUserId) return "Không thể thay đổi tài khoản đang đăng nhập.";
  if (account.adminSource === "bootstrap") return "Không thể thay đổi tài khoản quản trị bootstrap.";
  if (account.status === "deleted" && action && action.kind !== "deletion") return "Tài khoản đã xóa. Hãy khôi phục trước khi chỉnh sửa.";
  if (action?.kind === "role" && action.value === account.isAdmin) return "Tài khoản đã ở trạng thái quyền được yêu cầu.";
  if (action?.kind === "suspension" && action.value === (account.status === "suspended")) return "Tài khoản đã ở trạng thái được yêu cầu.";
  if (action?.kind === "deletion" && action.value === (account.status === "deleted")) return "Tài khoản đã ở trạng thái được yêu cầu.";
  return "";
}

export function isAdminReasonValid(reason: string) {
  return reason.trim().length > 0 && reason.length <= 500;
}

export function isAdminNameValid(name: string) {
  return name.trim().length > 0 && name.trim().length <= 100;
}

type AdminSessionEditDraft = {
  goal: string;
  topic: string;
  targetSeconds: string;
  elapsedSeconds: string;
  actualStudySeconds: string;
  focusedSeconds: string;
  actualBreakSeconds: string;
  distractions: string;
  quizScore: string;
  quizTotal: string;
};

function adminSessionDraft(detail: AdminSessionDetail): AdminSessionEditDraft {
  return {
    goal: detail.goal,
    topic: detail.topic,
    targetSeconds: String(detail.metrics.targetSeconds),
    elapsedSeconds: String(detail.metrics.elapsedSeconds),
    actualStudySeconds: String(detail.metrics.actualStudySeconds),
    focusedSeconds: String(detail.metrics.focusedSeconds),
    actualBreakSeconds: String(detail.metrics.actualBreakSeconds),
    distractions: String(detail.metrics.distractions),
    quizScore: detail.metrics.quizScore === null ? "" : String(detail.metrics.quizScore),
    quizTotal: detail.metrics.quizTotal === null ? "" : String(detail.metrics.quizTotal),
  };
}

export function buildAdminSessionChanges(
  detail: AdminSessionDetail,
  draft: AdminSessionEditDraft,
  resetFields: Iterable<AdminSessionCorrectionField>,
): AdminSessionCorrectionChanges {
  const resets = new Set(resetFields);
  const changes: AdminSessionCorrectionChanges = {};
  for (const field of ["goal", "topic"] as const) {
    if (resets.has(field)) changes[field] = null;
    else if (draft[field] !== detail[field]) changes[field] = draft[field].trim();
  }
  const metricFields = [
    "targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds", "actualBreakSeconds", "distractions",
  ] as const;
  for (const field of metricFields) {
    if (resets.has(field)) {
      changes[field] = null;
      continue;
    }
    const value = Number(draft[field]);
    if (!draft[field].trim() || !Number.isFinite(value) || value === detail.metrics[field]) continue;
    if ((field === "targetSeconds" || field === "distractions") && !Number.isInteger(value)) continue;
    changes[field] = value;
  }
  if (resets.has("quizResult")) changes.quizResult = null;
  else if (draft.quizScore !== "" && draft.quizTotal !== "") {
    const score = Number(draft.quizScore);
    const total = Number(draft.quizTotal);
    if (Number.isInteger(score) && Number.isInteger(total) &&
      (score !== detail.metrics.quizScore || total !== detail.metrics.quizTotal)) {
      changes.quizResult = { score, total };
    }
  }
  return changes;
}

export function adminSessionDraftValidationError(
  detail: AdminSessionDetail,
  draft: AdminSessionEditDraft,
  resetFields: Iterable<AdminSessionCorrectionField>,
) {
  const resets = new Set(resetFields);
  if (!resets.has("goal") && draft.goal !== detail.goal && (draft.goal.trim().length < 3 || draft.goal.trim().length > 500))
    return "Mục tiêu mới cần có từ 3 đến 500 ký tự.";
  if (!resets.has("topic") && draft.topic !== detail.topic && (draft.topic.trim().length < 1 || draft.topic.trim().length > 100))
    return "Chủ đề mới cần có từ 1 đến 100 ký tự.";
  const limits = {
    targetSeconds: { minimum: 60, maximum: 14400, integer: true, label: "Thời lượng học dự kiến" },
    elapsedSeconds: { minimum: 0, maximum: 32400, integer: false, label: "Thời lượng đã trôi qua" },
    actualStudySeconds: { minimum: 0, maximum: 14400, integer: false, label: "Thời gian học thực tế" },
    focusedSeconds: { minimum: 0, maximum: 14400, integer: false, label: "Thời gian tập trung" },
    actualBreakSeconds: { minimum: 0, maximum: 32400, integer: false, label: "Thời gian nghỉ thực tế" },
    distractions: { minimum: 0, maximum: 10000, integer: true, label: "Số lần rời phiên" },
  } as const;
  for (const [field, limit] of Object.entries(limits) as [keyof typeof limits, typeof limits[keyof typeof limits]][]) {
    if (resets.has(field) || draft[field] === String(detail.metrics[field])) continue;
    const value = Number(draft[field]);
    if (!draft[field].trim() || !Number.isFinite(value) || value < limit.minimum || value > limit.maximum ||
      (limit.integer && !Number.isInteger(value))) {
      return `${limit.label} chưa hợp lệ.`;
    }
  }
  if (!resets.has("quizResult")) {
    const currentScore = detail.metrics.quizScore === null ? "" : String(detail.metrics.quizScore);
    const currentTotal = detail.metrics.quizTotal === null ? "" : String(detail.metrics.quizTotal);
    if (draft.quizScore !== currentScore || draft.quizTotal !== currentTotal) {
      const score = Number(draft.quizScore);
      const total = Number(draft.quizTotal);
      if (draft.quizScore === "" || draft.quizTotal === "" || !Number.isInteger(score) || !Number.isInteger(total) ||
        score < 0 || score > 1000 || total < 1 || total > 1000 || score > total) {
        return "Kết quả quiz cần có điểm và tổng số câu hợp lệ, hoặc hãy đặt lại kết quả theo dữ liệu đo.";
      }
    }
  }
  const changes = buildAdminSessionChanges(detail, draft, resets);
  const targetSeconds = changes.targetSeconds === null ? detail.measuredMetrics.targetSeconds : changes.targetSeconds ?? detail.metrics.targetSeconds;
  const actualStudySeconds = changes.actualStudySeconds === null ? detail.measuredMetrics.actualStudySeconds : changes.actualStudySeconds ?? detail.metrics.actualStudySeconds;
  const focusedSeconds = changes.focusedSeconds === null ? detail.measuredMetrics.focusedSeconds : changes.focusedSeconds ?? detail.metrics.focusedSeconds;
  const elapsedSeconds = changes.elapsedSeconds === null ? detail.measuredMetrics.elapsedSeconds : changes.elapsedSeconds ?? detail.metrics.elapsedSeconds;
  const actualBreakSeconds = changes.actualBreakSeconds === null ? detail.measuredMetrics.actualBreakSeconds : changes.actualBreakSeconds ?? detail.metrics.actualBreakSeconds;
  if (actualStudySeconds > targetSeconds) return "Thời gian học thực tế không thể vượt thời lượng mục tiêu.";
  if (focusedSeconds > actualStudySeconds) return "Thời gian tập trung không thể vượt thời gian học thực tế.";
  if (elapsedSeconds < actualStudySeconds + actualBreakSeconds) return "Thời lượng đã trôi qua phải bao gồm thời gian học và nghỉ thực tế.";
  return "";
}

function adminSessionDraftIsDirty(detail: AdminSessionDetail, draft: AdminSessionEditDraft, resetFields: Iterable<AdminSessionCorrectionField>) {
  return Object.keys(buildAdminSessionChanges(detail, draft, resetFields)).length > 0 || [...resetFields].length > 0 ||
    draft.goal !== detail.goal || draft.topic !== detail.topic ||
    ["targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds", "actualBreakSeconds", "distractions"]
      .some((field) => draft[field as keyof AdminSessionEditDraft] !== String(detail.metrics[field as keyof AdminSessionMetrics])) ||
    draft.quizScore !== (detail.metrics.quizScore === null ? "" : String(detail.metrics.quizScore)) ||
    draft.quizTotal !== (detail.metrics.quizTotal === null ? "" : String(detail.metrics.quizTotal));
}

export function adminSessionMutationProblem(error: unknown) {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (error.status === 409) return "Phiên học đã thay đổi. Hãy tải lại phiên để xem giá trị mới rồi áp dụng lại hiệu chỉnh.";
  if (error.status === 410) return "Phiên học này đã được gỡ khỏi lịch sử.";
  if (error.status === 404) return "Không còn tìm thấy phiên học này.";
  if (error.status === 400 || error.status === 422) return `Thông tin hiệu chỉnh chưa hợp lệ: ${error.message}`;
  return error.message;
}

function adminRoleLabel(isAdmin: boolean) {
  return isAdmin ? "Quản trị" : "Không quản trị";
}

function adminStatusLabel(suspended: boolean) {
  return suspended ? "Tạm ngưng" : "Hoạt động";
}

function adminStateSummary(state: AdminStateVersion) {
  return `${adminRoleLabel(state.isAdmin)} · ${state.deleted ? "Đã xóa" : adminStatusLabel(state.suspended)} · phiên bản ${state.version}`;
}

function adminMutationTitle(action: AdminMutationAction) {
  if (action.kind === "role") return action.value ? "Cấp quyền quản trị" : "Thu hồi quyền quản trị";
  if (action.kind === "profile") return "Chỉnh sửa tên";
  if (action.kind === "deletion") return action.value ? "Xóa tài khoản" : "Khôi phục tài khoản đã xóa";
  return action.value ? "Tạm ngưng tài khoản" : "Khôi phục tài khoản";
}

export function adminMutationProblem(error: unknown) {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (error.status === 400) return `Thông tin thay đổi chưa hợp lệ: ${error.message}`;
  if (error.status === 404) return "Không còn tìm thấy tài khoản này. Hãy tải lại danh sách tài khoản.";
  if (error.status === 409) return `Trạng thái tài khoản đã thay đổi hoặc thao tác không được phép: ${error.message}`;
  return error.message;
}

export function formatAdminDuration(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
  if (minutes) return seconds ? `${minutes} phút ${seconds} giây` : `${minutes} phút`;
  return `${seconds} giây`;
}

function percent(value: number | null) {
  return value === null ? "Chưa có dữ liệu" : `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

export function AdminSessionFilters({ days, durationBasis, onDaysChange, onDurationBasisChange }: {
  days: AdminSessionPeriod;
  durationBasis: "planned" | "actual" | "";
  onDaysChange: (value: AdminSessionPeriod) => void;
  onDurationBasisChange: (value: "planned" | "actual" | "") => void;
}) {
  return <div className="admin-session-filters" aria-label="Bộ lọc lịch sử phiên">
    <label htmlFor="admin-session-period">Lịch sử phiên
      <select id="admin-session-period" value={days} onChange={(event) => {
        const value = event.target.value;
        onDaysChange(value === "all" ? "all" : Number(value) as AdminPeriod);
      }}>
        {sessionPeriods.map((period) => <option value={period} key={period}>
          {period === "all" ? "Toàn bộ lịch sử" : `${period} ngày`}
        </option>)}
      </select>
    </label>
    <label htmlFor="admin-session-duration">Lọc phiên có thời lượng ≤ 60 giây
      <select id="admin-session-duration" value={durationBasis} onChange={(event) => {
        onDurationBasisChange(event.target.value as "planned" | "actual" | "");
      }}>
        <option value="">Không lọc</option>
        <option value="planned">Theo thời lượng dự kiến</option>
        <option value="actual">Theo thời lượng thực tế đã trôi qua (bao gồm thời gian nghỉ và vắng mặt)</option>
      </select>
    </label>
    <p className="admin-analysis-note">Chỉ lọc khi được chọn; đây không phải phân loại phiên thử nghiệm.</p>
  </div>;
}

function utcTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Không rõ";
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="admin-metric">
    <dt>{label}</dt>
    <dd>{value}</dd>
    {note && <small>{note}</small>}
  </div>;
}

function MetricTable({ rows, heading, kind }: {
  rows: (AdminMetricTotals & ({ dateUtc: string } | { topic: string }))[];
  heading: string;
  kind: "daily" | "topic";
}) {
  const name = (row: AdminMetricTotals & ({ dateUtc: string } | { topic: string })) =>
    kind === "daily" ? (row as AdminMetricTotals & { dateUtc: string }).dateUtc : (row as AdminMetricTotals & { topic: string }).topic;
  return <section className="admin-overview-section">
    <h3>{heading}</h3>
    <div className="admin-overview-scroll" role="region" aria-label={heading} tabIndex={0}>
      <table className="admin-data-table">
        <thead><tr>
          <th>{kind === "daily" ? "Ngày UTC" : "Chủ đề"}</th>
          <th>Số phiên</th>
          <th>Thời gian học thực tế</th>
          <th>Thời gian tập trung</th>
          <th>Đạt mục tiêu</th>
          <th>Độ phủ quiz</th>
          <th>Điểm quiz</th>
        </tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={name(row)}>
          <th scope="row">{name(row)}</th>
          <td>{row.sessionCount}</td>
          <td>{formatAdminDuration(row.actualStudySeconds)}</td>
          <td>{formatAdminDuration(row.focusedSeconds)}</td>
          <td>{row.completedSessions} · {percent(row.completionPercent)}</td>
          <td>{row.gradedQuizSessions} · {percent(row.quizCoveragePercent)}</td>
          <td>{row.quizScorePercent === null ? "Chưa có dữ liệu" : `${row.quizScore}/${row.quizTotal} · ${percent(row.quizScorePercent)}`}</td>
        </tr>) : <tr><td colSpan={7}>Chưa có dữ liệu trong khoảng thời gian này.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

export function adminStudyIndicators(totals: Pick<AdminMetricTotals, "actualStudySeconds" | "focusedSeconds" | "distractions" | "sessionCount">) {
  return {
    focusPercent: totals.actualStudySeconds > 0 ? totals.focusedSeconds / totals.actualStudySeconds * 100 : null,
    distractionsPerHour: totals.actualStudySeconds > 0 ? totals.distractions / totals.actualStudySeconds * 3600 : null,
    averageStudySeconds: totals.sessionCount > 0 ? totals.actualStudySeconds / totals.sessionCount : null,
  };
}

export function adminRowsForKey<T>(result: { key: string; rows: T[]; total: number } | null, key: string) {
  return result?.key === key ? { rows: result.rows, total: result.total } : { rows: [] as T[], total: 0 };
}

export function adminReportForKey<T>(result: { key: string; value: T } | null, key: string) {
  return result?.key === key ? result.value : null;
}

export function adminTrendPath(values: readonly (number | null)[], maximum: number, width = 700, height = 160) {
  const padding = 16;
  const safeMaximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
  const horizontalRange = Math.max(0, width - padding * 2);
  const verticalRange = Math.max(0, height - padding * 2);
  let previousPoint = false;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      previousPoint = false;
      return null;
    }
    const x = values.length <= 1 ? width / 2 : padding + (index / (values.length - 1)) * horizontalRange;
    const scaledValue = Math.max(0, Math.min(safeMaximum, value));
    const y = height - padding - (scaledValue / safeMaximum) * verticalRange;
    const command = `${previousPoint ? "L" : "M"}${x},${y}`;
    previousPoint = true;
    return command;
  }).filter((command): command is string => command !== null).join(" ");
}

type DailyAdminMetrics = AdminReport["daily"][number];

function TrendChart({
  chartId,
  title,
  description,
  rows,
  value,
  maximum,
  formatValue = (item) => item.toLocaleString("vi-VN", { maximumFractionDigits: 1 }),
}: {
  chartId: string;
  title: string;
  description: string;
  rows: AdminReport["daily"];
  value: (row: DailyAdminMetrics) => number | null;
  maximum?: number;
  formatValue?: (item: number) => string;
}) {
  const values = rows.map(value);
  const chartMaximum = maximum ?? Math.max(1, ...values.filter((item): item is number => item !== null));
  const path = adminTrendPath(values, chartMaximum);
  const width = 700;
  const height = 160;
  const padding = 16;
  const verticalRange = height - padding * 2;
  const horizontalRange = width - padding * 2;
  const xFor = (index: number) => rows.length <= 1 ? width / 2 : padding + (index / (rows.length - 1)) * horizontalRange;
  const yFor = (item: number | null) => item === null ? height - padding : height - padding - (Math.max(0, Math.min(chartMaximum, item)) / chartMaximum) * verticalRange;
  return <figure className="admin-trend-chart">
    <figcaption>
      <h4>{title}</h4>
      <p>{description}</p>
    </figcaption>
    <div className="admin-chart-plot">
      <div className="admin-chart-scale" aria-hidden="true"><span>{formatValue(chartMaximum)}</span><span>{formatValue(chartMaximum / 2)}</span><span>{formatValue(0)}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`} preserveAspectRatio="none">
      <title id={`${chartId}-title`}>{title}</title>
      <desc id={`${chartId}-description`}>{description} Trục dọc từ {formatValue(0)} đến {formatValue(chartMaximum)}. Mỗi điểm đại diện cho một ngày UTC, từ {rows[0]?.dateUtc ?? "không có dữ liệu"} đến {rows.at(-1)?.dateUtc ?? "không có dữ liệu"}.</desc>
      <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="admin-chart-axis-line" />
      <line x1={padding} x2={width - padding} y1={height / 2} y2={height / 2} className="admin-chart-grid-line" />
      {path && <path d={path} className="admin-chart-line" />}
      {values.map((item, index) => item === null ? null : <circle key={`${rows[index].dateUtc}-${index}`} cx={xFor(index)} cy={yFor(item)} r="2.6" className="admin-chart-point"><title>{`${rows[index].dateUtc}: ${formatValue(item)}`}</title></circle>)}
    </svg>
    </div>
    <div className="admin-chart-dates"><span>{rows[0]?.dateUtc ?? ""}</span><span>{rows.at(-1)?.dateUtc ?? ""}</span></div>
  </figure>;
}

function MiniBar({ value, maximum, label }: { value: number; maximum: number; label: string }) {
  const width = maximum > 0 ? Math.max(0, Math.min(100, (value / maximum) * 100)) : 0;
  return <div className="admin-mini-metric">
    <div className="admin-mini-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
    <span>{label}</span>
  </div>;
}

function TopicComparison({ rows }: { rows: AdminReport["topics"] }) {
  const displayed = rows.slice(0, 8);
  const maxFocus = Math.max(1, ...displayed.map((row) => row.focusedSeconds));
  return <section className="admin-overview-section">
    <h3>So sánh chủ đề</h3>
    <p className="admin-analysis-note">Tám chủ đề đầu theo thời gian tập trung. Hoàn tất dùng số phiên hoàn tất / tổng phiên; độ phủ quiz dùng phiên đã chấm / tổng phiên; điểm quiz dùng điểm đạt / tổng điểm ở các quiz đã chấm.</p>
    <div className="admin-overview-scroll" role="region" aria-label="So sánh chủ đề theo phiên, tập trung, hoàn tất và quiz" tabIndex={0}>
      <table className="admin-data-table admin-topic-compare">
        <thead><tr><th>Chủ đề</th><th>Thời gian tập trung</th><th>Hoàn tất / phiên</th><th>Điểm quiz</th><th>Độ phủ quiz</th></tr></thead>
        <tbody>{displayed.length ? displayed.map((row) => <tr key={row.topic}>
          <th scope="row">{row.topic}<small>{row.sessionCount.toLocaleString("vi-VN")} phiên</small></th>
          <td><MiniBar value={row.focusedSeconds} maximum={maxFocus} label={formatAdminDuration(row.focusedSeconds)} /></td>
          <td><MiniBar value={row.completionPercent} maximum={100} label={`${row.completedSessions}/${row.sessionCount} · ${percent(row.completionPercent)}`} /></td>
          <td><MiniBar value={row.quizScorePercent ?? 0} maximum={100} label={row.quizScorePercent === null ? "Chưa có dữ liệu" : `${row.quizScore}/${row.quizTotal} · ${percent(row.quizScorePercent)}`} /><small>{row.gradedQuizSessions.toLocaleString("vi-VN")} phiên có quiz đã chấm</small></td>
          <td><MiniBar value={row.quizCoveragePercent} maximum={100} label={`${row.gradedQuizSessions}/${row.sessionCount} · ${percent(row.quizCoveragePercent)}`} /></td>
        </tr>) : <tr><td colSpan={5}>Chưa có dữ liệu trong khoảng thời gian này.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

export function AdminOverview({ report, scopeLabel }: { report: AdminReport; scopeLabel?: string }) {
  const totals = report.totals;
  const indicators = adminStudyIndicators(totals);
  return <div className="admin-overview">
    <p className="admin-period-note">
      {report.fromUtc.slice(0, 10)} đến {report.asOfUtc.slice(0, 10)} · Mọi mốc thời gian dùng UTC. {scopeLabel ? `Phạm vi: ${scopeLabel}.` : "Bao gồm phiên khách và phiên tài khoản đã lưu."}
    </p>
    {report.truncated && <p className="admin-truncated" role="status">
      Đã phân tích {report.recordsAnalyzed.toLocaleString("vi-VN")} trên {report.matchingSessionCount.toLocaleString("vi-VN")} phiên khớp khoảng thời gian, với giới hạn tối đa {report.analysisLimit.toLocaleString("vi-VN")} phiên. Các tổng, biểu đồ, bảng và CSV chỉ tính phần đã phân tích.
    </p>}
    <dl className="admin-metrics">
      <MetricCard label="Phiên trong báo cáo" value={totals.sessionCount.toLocaleString("vi-VN")} note={`${report.matchingSessionCount.toLocaleString("vi-VN")} phiên khớp · giới hạn phân tích ${report.analysisLimit.toLocaleString("vi-VN")} phiên`} />
      <MetricCard label="Thời lượng học dự kiến" value={formatAdminDuration(totals.plannedStudySeconds)} />
      <MetricCard label="Thời gian học thực tế" value={formatAdminDuration(totals.actualStudySeconds)} note="Đã trừ thời gian nghỉ theo lịch" />
      <MetricCard label="Thời gian tập trung" value={formatAdminDuration(totals.focusedSeconds)} note="Khoảng focus và học tài liệu đã lưu" />
      <MetricCard label="Đạt mục tiêu thời gian" value={`${totals.completedSessions} · ${percent(totals.completionPercent)}`} note="Đủ thời lượng học dự kiến" />
      <MetricCard label="Lượt xao nhãng" value={totals.distractions.toLocaleString("vi-VN")} />
      <MetricCard label="Độ phủ quiz" value={percent(totals.quizCoveragePercent)} note={`${totals.gradedQuizSessions} phiên có quiz đã chấm`} />
      <MetricCard label="Điểm quiz tổng" value={totals.quizScorePercent === null ? "Chưa có dữ liệu" : `${totals.quizScore}/${totals.quizTotal} · ${percent(totals.quizScorePercent)}`} note="Quiz chưa chấm không tính vào điểm" />
    </dl>
    <section className="admin-overview-section">
      <h3>Phân tích nhịp học</h3>
      <dl className="admin-metrics admin-study-indicators">
        <MetricCard label="Tỷ lệ tập trung" value={percent(indicators.focusPercent)} note="Thời gian tập trung / thời gian học thực tế" />
        <MetricCard label="Xao nhãng mỗi giờ học" value={indicators.distractionsPerHour === null ? "Chưa có dữ liệu" : `${indicators.distractionsPerHour.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} lượt/giờ`} note="Chuẩn hóa theo thời gian học thực tế, đã trừ nghỉ" />
        <MetricCard label="Thời lượng trung bình mỗi phiên" value={indicators.averageStudySeconds === null ? "Chưa có dữ liệu" : formatAdminDuration(indicators.averageStudySeconds)} note="Tính cả các chuyến kết thúc sớm" />
      </dl>
      <p className="admin-analysis-note">Đối chiếu số phiên và độ phủ quiz khi so sánh chủ đề. Tỷ lệ hoàn tất = phiên đạt mục tiêu / tổng phiên. Độ phủ quiz = phiên có kết quả chấm / tổng phiên. Điểm quiz = điểm đạt / tổng điểm ở quiz đã chấm; đây là mô tả số liệu, không giải thích nguyên nhân.</p>
    </section>
    <section className="admin-overview-section">
      <h3>Xu hướng hàng ngày · UTC</h3>
      <div className="admin-chart-grid">
        <TrendChart chartId="admin-focus-trend" title="Thời gian tập trung" description="Tổng thời gian focus và học tài liệu đã lưu mỗi ngày." rows={report.daily} value={(row) => row.focusedSeconds} formatValue={formatAdminDuration} />
        <TrendChart chartId="admin-session-trend" title="Số phiên mỗi ngày" description="Số phiên bắt đầu mỗi ngày UTC." rows={report.daily} value={(row) => row.sessionCount} />
        <TrendChart chartId="admin-completion-trend" title="Hoàn tất / phiên" description="Tỷ lệ phiên đạt mục tiêu trong tổng số phiên của ngày; số phiên là mẫu số." rows={report.daily} value={(row) => row.sessionCount ? row.completionPercent : null} maximum={100} formatValue={percent} />
        <TrendChart chartId="admin-quiz-coverage-trend" title="Độ phủ quiz theo ngày" description="Phiên có quiz đã chấm trên tổng phiên của ngày; số phiên là mẫu số." rows={report.daily} value={(row) => row.sessionCount ? row.quizCoveragePercent : null} maximum={100} formatValue={percent} />
        <TrendChart chartId="admin-quiz-score-trend" title="Điểm quiz theo ngày" description="Điểm đạt trên tổng điểm ở các quiz đã chấm; ngày không có quiz đã chấm được để trống." rows={report.daily} value={(row) => row.quizScorePercent} maximum={100} formatValue={percent} />
      </div>
    </section>
    <MetricTable rows={report.daily} heading="Xu hướng hàng ngày · UTC" kind="daily" />
    <TopicComparison rows={report.topics} />
    <MetricTable rows={report.topics} heading="Phân tích theo chủ đề" kind="topic" />
  </div>;
}

function Pager({ total, offset, onChange }: { total: number; offset: number; onChange: (next: number) => void }) {
  const canPrevious = offset > 0;
  const canNext = offset + pageSize < total;
  return <div className="admin-pager">
    <span>{total.toLocaleString("vi-VN")} kết quả · {total ? offset + 1 : 0}–{Math.min(offset + pageSize, total)}</span>
    <div>
      <button type="button" disabled={!canPrevious} onClick={() => onChange(Math.max(0, offset - pageSize))}>Trước</button>
      <button type="button" disabled={!canNext} onClick={() => onChange(offset + pageSize)}>Tiếp</button>
    </div>
  </div>;
}

export function AdminAccountGovernance({ account, currentUserId, onChangeRequested }: {
  account: AdminAccount;
  currentUserId?: string;
  onChangeRequested: (action: AdminMutationAction) => void;
}) {
  const blockReason = adminAccountMutationBlockReason(account, currentUserId);
  const source = account.adminSource === "bootstrap" ? "Bootstrap máy chủ"
    : account.adminSource === "persistent" ? "Cơ sở dữ liệu"
      : "Không có nguồn quản trị";
  const suspended = account.status === "suspended";
  const deleted = account.status === "deleted";
  return <section className="admin-account-governance" aria-label={"Quyền và trạng thái tài khoản " + account.name}>
    <div className="admin-detail-heading">
      <div><h3>Quyền và trạng thái tài khoản</h3><p>Thay đổi luôn được máy chủ xác thực lại và ghi vào nhật ký kiểm toán.</p></div>
    </div>
    <dl className="admin-account-facts">
      <div><dt>Mã tài khoản</dt><dd><code>{account.id}</code></dd></div>
      <div><dt>Email</dt><dd>{account.email}</dd></div>
      <div><dt>Quyền</dt><dd>{account.isAdmin ? "Quản trị viên" : "Người học"}</dd></div>
      <div><dt>Nguồn quyền quản trị</dt><dd>{source}</dd></div>
      <div><dt>Trạng thái</dt><dd>{deleted ? "Đã xóa" : suspended ? "Đang tạm ngưng" : "Đang hoạt động"}{account.deletedAt ? <small> từ {utcTime(account.deletedAt)}</small> : account.suspendedAt ? <small> từ {utcTime(account.suspendedAt)}</small> : null}</dd></div>
      <div><dt>Phiên bản trạng thái</dt><dd>{account.adminStateVersion}</dd></div>
    </dl>
    {blockReason && <p className="admin-analysis-note">{blockReason}</p>}
    <div className="admin-account-actions">
      <button type="button" disabled={Boolean(blockReason) || deleted} onClick={() => onChangeRequested({ kind: "profile" })}>Chỉnh sửa tên</button>
      <button type="button" disabled={Boolean(blockReason) || deleted} onClick={() => onChangeRequested({ kind: "role", value: !account.isAdmin })}>
        {account.isAdmin ? "Thu hồi quyền quản trị" : "Cấp quyền quản trị"}
      </button>
      <button type="button" disabled={Boolean(blockReason) || deleted} onClick={() => onChangeRequested({ kind: "suspension", value: !suspended })}>
        {suspended ? "Khôi phục tài khoản" : "Tạm ngưng tài khoản"}
      </button>
      <button type="button" className={deleted ? undefined : "admin-destructive"} disabled={Boolean(blockReason)} onClick={() => onChangeRequested({ kind: "deletion", value: !deleted })}>
        {deleted ? "Khôi phục tài khoản đã xóa" : "Xóa tài khoản"}
      </button>
    </div>
    {deleted && <p className="admin-analysis-note">Dữ liệu học được giữ lại. Khôi phục tài khoản không cấp lại quyền quản trị đã thu hồi.</p>}
  </section>;
}

export function AdminMutationConfirmation({ account, currentUserId, action, busy, error, onCancel, onConfirm }: {
  account: AdminAccount;
  currentUserId?: string;
  action: AdminMutationAction;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string, name?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [name, setName] = useState(account.name);
  const dialogRef = useRef<HTMLElement | null>(null);
  const blockReason = adminAccountMutationBlockReason(account, currentUserId, action);
  const title = adminMutationTitle(action);
  const current = action.kind === "profile" ? account.name : action.kind === "deletion" ? (account.status === "deleted" ? "Đã xóa" : "Chưa xóa")
    : action.kind === "role" ? adminRoleLabel(account.isAdmin) : adminStatusLabel(account.status === "suspended");
  const next = action.kind === "profile" ? name.trim() : action.kind === "deletion" ? (action.value ? "Đã xóa" : "Chưa xóa")
    : action.kind === "role" ? adminRoleLabel(action.value) : adminStatusLabel(action.value);
  const nameIsValid = action.kind !== "profile" || (isAdminNameValid(name) && name.trim() !== account.name);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!blockReason && !busy && nameIsValid && isAdminReasonValid(reason)) onConfirm(reason.trim(), action.kind === "profile" ? name.trim() : undefined);
  };
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.focus({ preventScroll: true });
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  const keepFocusInDialog = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled)') ?? [])];
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (!dialogRef.current?.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <div className="admin-dialog-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={keepFocusInDialog} className="admin-confirmation" role="dialog" aria-modal="true" aria-labelledby="admin-mutation-title">
    <h3 id="admin-mutation-title">Xác nhận: {title}</h3>
    <p><strong>{account.name}</strong> · {account.email}</p>
    <p>Mã tài khoản: <code>{account.id}</code></p>
    <p>Thay đổi: <strong>{current}</strong> → <strong>{next}</strong>. Phiên bản hiện tại: <strong>{account.adminStateVersion}</strong>.</p>
    {action.kind === "deletion" && <p className="admin-analysis-note">{action.value
      ? "Xóa có thể khôi phục: giữ lại dữ liệu học, thu hồi quyền quản trị và các phiên đăng nhập. Tài khoản không thể đăng nhập khi đã xóa."
      : "Giữ lại dữ liệu học. Người dùng cần đăng nhập lại; quyền quản trị đã thu hồi không tự được cấp lại. Tài khoản đang tạm ngưng vẫn cần được bỏ tạm ngưng."}</p>}
    {blockReason && <p className="admin-error" role="alert">{blockReason}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    <form onSubmit={submit}>
      {action.kind === "profile" && <><label htmlFor="admin-mutation-name">Tên hiển thị mới</label><input id="admin-mutation-name" value={name} maxLength={100} required disabled={busy || Boolean(blockReason)} onChange={(event) => setName(event.target.value)} /></>}
      <label htmlFor="admin-mutation-reason">Lý do kiểm toán</label>
      <textarea id="admin-mutation-reason" value={reason} maxLength={500} required disabled={busy || Boolean(blockReason)} onChange={(event) => setReason(event.target.value)} />
      <p className="admin-analysis-note">Không ghi nội dung học tập của người học, mục tiêu riêng, tài liệu hoặc câu trả lời quiz trong lý do.</p>
      <div className="admin-account-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Hủy</button>
        <button type="submit" className={action.kind === "deletion" && action.value ? "admin-destructive" : undefined} disabled={busy || Boolean(blockReason) || !nameIsValid || !isAdminReasonValid(reason)}>{busy ? "Đang lưu…" : "Xác nhận thay đổi"}</button>
      </div>
    </form>
  </section></div>;
}

export function AdminAuditView({ actions, loading, error, total, offset, onOffsetChange, onRetry }: {
  actions: AdminActionAudit[];
  loading: boolean;
  error: string;
  total: number;
  offset: number;
  onOffsetChange: (next: number) => void;
  onRetry: () => void;
}) {
  return <section className="admin-detail admin-audit" aria-label="Nhật ký thay đổi tài khoản" aria-live="polite">
    <div className="admin-detail-heading"><div><h3>Nhật ký thay đổi</h3><p>Ghi nhận thay đổi tên, quyền, trạng thái và việc xóa/khôi phục tài khoản.</p></div></div>
    {loading && <p role="status">Đang tải nhật ký…</p>}
    {error && <div className="admin-error" role="alert"><span>{error}</span> <button type="button" onClick={onRetry}>Thử lại</button></div>}
    {!loading && !error && actions.length === 0 && <p className="admin-empty">Chưa có thay đổi được ghi nhận.</p>}
    {!!actions.length && <>
      <ol className="admin-audit-list">
        {actions.map((item, index) => <li key={item.createdAt + "-" + item.actorId + "-" + index}>
          <div className="admin-audit-heading"><strong>{item.action === "profile" ? "Chỉnh sửa tên" : item.action === "deletion" ? "Xóa / khôi phục tài khoản" : item.action === "role" ? "Thay đổi quyền quản trị" : "Thay đổi trạng thái tài khoản"}</strong><time dateTime={item.createdAt}>{utcTime(item.createdAt)}</time></div>
          <p>Người thực hiện: <code>{item.actorId}</code></p>
          <p>Mục tiêu: <code>{item.targetId}</code></p>
          <p>Quyền: {adminRoleLabel(item.before.isAdmin)} → {adminRoleLabel(item.after.isAdmin)}</p>
          <p>Trạng thái: {item.before.deleted ? "Đã xóa" : adminStatusLabel(item.before.suspended)} → {item.after.deleted ? "Đã xóa" : adminStatusLabel(item.after.suspended)}</p>
          {item.action === "profile" && <p>Tên: {item.before.name} → {item.after.name}</p>}
          <p>{adminStateSummary(item.before)} → {adminStateSummary(item.after)}</p>
          <p>Lý do: {item.reason}</p>
        </li>)}
      </ol>
      <Pager total={total} offset={offset} onChange={onOffsetChange} />
    </>}
  </section>;
}

function adminMetricSource(source: "measured" | "corrected") {
  return source === "corrected" ? "Đã hiệu chỉnh" : "Theo dữ liệu đo";
}

function adminMetricValue(value: string | number | boolean | null) {
  if (value === null) return "Chưa có dữ liệu";
  if (typeof value === "boolean") return value ? "Đạt" : "Chưa đạt";
  return String(value);
}

export function AdminSessionEditor({
  detail,
  removed,
  loading,
  error,
  mutationBusy,
  mutationError,
  auditActions,
  auditLoading,
  auditError,
  auditTotal,
  auditOffset,
  onReload,
  onSave,
  onDelete,
  onAuditOffsetChange,
  onAuditRetry,
}: {
  detail: AdminSessionDetail | null;
  removed: boolean;
  loading: boolean;
  error: string;
  mutationBusy: boolean;
  mutationError: string;
  auditActions: AdminSessionAuditAction[];
  auditLoading: boolean;
  auditError: string;
  auditTotal: number;
  auditOffset: number;
  onReload: () => void;
  onSave: (changes: AdminSessionCorrectionChanges, reason: string) => void;
  onDelete: (reason: string) => void;
  onAuditOffsetChange: (next: number) => void;
  onAuditRetry: () => void;
}) {
  const [draft, setDraft] = useState<AdminSessionEditDraft>(() => detail ? adminSessionDraft(detail) : {
    goal: "", topic: "", targetSeconds: "", elapsedSeconds: "", actualStudySeconds: "",
    focusedSeconds: "", actualBreakSeconds: "", distractions: "", quizScore: "", quizTotal: "",
  });
  const [resetFields, setResetFields] = useState<AdminSessionCorrectionField[]>([]);
  const [reason, setReason] = useState("");
  const [confirmedRemoval, setConfirmedRemoval] = useState(false);
  const [formError, setFormError] = useState("");
  const latestDetail = useRef(detail);
  useEffect(() => {
    if (!detail || latestDetail.current?.id === detail.id && latestDetail.current.correctionVersion === detail.correctionVersion) return;
    latestDetail.current = detail;
    setDraft(adminSessionDraft(detail));
    setResetFields([]);
    setReason("");
    setConfirmedRemoval(false);
    setFormError("");
  }, [detail]);

  const updateField = (field: keyof AdminSessionEditDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    const resetField = field === "quizScore" || field === "quizTotal" ? "quizResult" : field;
    setResetFields((previous) => previous.filter((item) => item !== resetField));
    setFormError("");
  };
  const resetField = (field: AdminSessionCorrectionField) => {
    if (!detail) return;
    setResetFields((previous) => [...new Set([...previous, field])]);
    setFormError("");
    setDraft((previous) => {
      if (field === "goal") return { ...previous, goal: detail.measuredContent.goal };
      if (field === "topic") return { ...previous, topic: detail.measuredContent.topic };
      if (field === "quizResult") return { ...previous, quizScore: "", quizTotal: "" };
      const value = detail.measuredMetrics[field as keyof AdminSessionMetrics];
      return { ...previous, [field]: value == null ? "" : String(value) };
    });
  };
  const changes = detail ? buildAdminSessionChanges(detail, draft, resetFields) : {};
  const canSave = Boolean(detail && adminSessionDraftIsDirty(detail, draft, resetFields) && isAdminReasonValid(reason) && !mutationBusy && !removed);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || removed || mutationBusy) return;
    const validationError = adminSessionDraftValidationError(detail, draft, resetFields);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if ((draft.quizScore !== "") !== (draft.quizTotal !== "")) {
      setFormError("Để hiệu chỉnh quiz, hãy nhập cả điểm và tổng số câu, hoặc đặt lại cả hai giá trị.");
      return;
    }
    if (!isAdminReasonValid(reason)) {
      setFormError("Nhập lý do kiểm toán từ 1 đến 500 ký tự.");
      return;
    }
    if (Object.keys(changes).length === 0) {
      setFormError("Chưa có giá trị nào thay đổi. Hãy sửa hoặc đặt lại ít nhất một trường.");
      return;
    }
    setFormError("");
    onSave(changes, reason.trim());
  };
  const submitRemoval = () => {
    if (!isAdminReasonValid(reason)) {
      setFormError("Nhập lý do kiểm toán trước khi xác nhận gỡ phiên.");
      return;
    }
    if (!confirmedRemoval) {
      setFormError("Đánh dấu xác nhận trước khi gỡ phiên học này.");
      return;
    }
    if (!mutationBusy && !removed) onDelete(reason.trim());
  };

  return <section className="admin-session-editor admin-detail" aria-live="polite">
    {loading && <p role="status">Đang tải chi tiết phiên học…</p>}
    {error && <p className="admin-error" role="alert">{error} <button type="button" onClick={onReload}>Tải lại phiên</button></p>}
    {removed && <p className="admin-session-removed" role="status">Phiên học đã được gỡ khỏi lịch sử. Nhật ký kiểm toán vẫn có thể xem.</p>}
    {detail && !removed && <>
      <div className="admin-detail-heading"><div>
        <h3>Hiệu chỉnh phiên <code>{detail.id.slice(0, 8)}</code></h3>
        <p>{adminSessionOwnerLabel(detail)} · Phiên bản hiệu chỉnh {detail.correctionVersion}. Các giá trị đang áp dụng được so sánh với dữ liệu đo ban đầu.</p>
      </div><button type="button" disabled={mutationBusy} onClick={onReload}>Tải lại phiên</button></div>
      <p className="admin-session-timestamps">Mốc bắt đầu và kết thúc đã đo khi chốt phiên; đây là dữ kiện đo, không thể chỉnh sửa. Bắt đầu: <time dateTime={detail.startedAt}>{utcTime(detail.startedAt)}</time> · Kết thúc: <time dateTime={detail.endedAt}>{utcTime(detail.endedAt)}</time></p>
      <form className="admin-session-edit-form" noValidate onSubmit={submit}>
        <div className="admin-session-edit-grid">
          <label htmlFor="admin-session-goal">Mục tiêu riêng
            <input id="admin-session-goal" maxLength={500} value={draft.goal} disabled={mutationBusy} onChange={(event) => updateField("goal", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.goal)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredContent.goal)} · {adminMetricSource(detail.metricSources.goal)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.goal !== "corrected"} onClick={() => resetField("goal")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-topic">Chủ đề
            <input id="admin-session-topic" maxLength={100} value={draft.topic} disabled={mutationBusy} onChange={(event) => updateField("topic", event.target.value)} />
            <small>Đang áp dụng: {detail.topic} · Theo ghi nhận ban đầu: {detail.measuredContent.topic} · {adminMetricSource(detail.metricSources.topic)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.topic !== "corrected"} onClick={() => resetField("topic")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-target">Thời lượng học dự kiến (giây)
            <input id="admin-session-target" type="number" min={60} max={14400} step="1" value={draft.targetSeconds} disabled={mutationBusy} onChange={(event) => updateField("targetSeconds", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.targetSeconds)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.targetSeconds)} · {adminMetricSource(detail.metricSources.targetSeconds)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.targetSeconds !== "corrected"} onClick={() => resetField("targetSeconds")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-elapsed">Thời lượng đã trôi qua (giây)
            <input id="admin-session-elapsed" type="number" min={0} max={32400} step="any" value={draft.elapsedSeconds} disabled={mutationBusy} onChange={(event) => updateField("elapsedSeconds", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.elapsedSeconds)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.elapsedSeconds)} · {adminMetricSource(detail.metricSources.elapsedSeconds)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.elapsedSeconds !== "corrected"} onClick={() => resetField("elapsedSeconds")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-actual-study">Thời gian học thực tế (giây)
            <input id="admin-session-actual-study" type="number" min={0} max={14400} step="any" value={draft.actualStudySeconds} disabled={mutationBusy} onChange={(event) => updateField("actualStudySeconds", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.actualStudySeconds)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.actualStudySeconds)} · {adminMetricSource(detail.metricSources.actualStudySeconds)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.actualStudySeconds !== "corrected"} onClick={() => resetField("actualStudySeconds")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-focused">Thời gian tập trung (giây)
            <input id="admin-session-focused" type="number" min={0} max={14400} step="any" value={draft.focusedSeconds} disabled={mutationBusy} onChange={(event) => updateField("focusedSeconds", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.focusedSeconds)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.focusedSeconds)} · {adminMetricSource(detail.metricSources.focusedSeconds)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.focusedSeconds !== "corrected"} onClick={() => resetField("focusedSeconds")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-break">Thời gian nghỉ thực tế (giây)
            <input id="admin-session-break" type="number" min={0} max={32400} step="any" value={draft.actualBreakSeconds} disabled={mutationBusy} onChange={(event) => updateField("actualBreakSeconds", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.actualBreakSeconds)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.actualBreakSeconds)} · {adminMetricSource(detail.metricSources.actualBreakSeconds)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.actualBreakSeconds !== "corrected"} onClick={() => resetField("actualBreakSeconds")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <label htmlFor="admin-session-distractions">Số lần rời phiên
            <input id="admin-session-distractions" type="number" min={0} max={10000} step="1" value={draft.distractions} disabled={mutationBusy} onChange={(event) => updateField("distractions", event.target.value)} />
            <small>Đang áp dụng: {adminMetricValue(detail.metrics.distractions)} · Theo ghi nhận ban đầu: {adminMetricValue(detail.measuredMetrics.distractions)} · {adminMetricSource(detail.metricSources.distractions)}</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.distractions !== "corrected"} onClick={() => resetField("distractions")}>Đặt lại theo dữ liệu đo</button>
          </label>
          <fieldset className="admin-session-quiz-edit">
            <legend>Kết quả quiz trong số liệu phiên</legend>
            <label htmlFor="admin-session-quiz-score">Điểm
              <input id="admin-session-quiz-score" type="number" min={0} max={1000} step="1" value={draft.quizScore} disabled={mutationBusy} onChange={(event) => updateField("quizScore", event.target.value)} />
            </label>
            <label htmlFor="admin-session-quiz-total">Tổng số câu
              <input id="admin-session-quiz-total" type="number" min={1} max={1000} step="1" value={draft.quizTotal} disabled={mutationBusy} onChange={(event) => updateField("quizTotal", event.target.value)} />
            </label>
            <small>Điểm quiz gốc: {adminMetricValue(detail.measuredMetrics.quizScore)}/{adminMetricValue(detail.measuredMetrics.quizTotal)} · Đang áp dụng: {adminMetricValue(detail.metrics.quizScore)}/{adminMetricValue(detail.metrics.quizTotal)} · {adminMetricSource(detail.metricSources.quizResult)}. Hiệu chỉnh này không sửa phản hồi hoặc bài chấm gốc của quiz.</small>
            <button type="button" disabled={mutationBusy || detail.metricSources.quizResult !== "corrected"} onClick={() => resetField("quizResult")}>Đặt lại theo dữ liệu đo</button>
          </fieldset>
        </div>
        <p className="admin-analysis-note">Nghỉ dự kiến và trạng thái hoàn tất là số liệu suy ra, không thể chỉnh sửa trực tiếp. Mọi thời lượng đo bằng giây; số thập phân được giữ nguyên.</p>
        <label htmlFor="admin-session-reason">Lý do kiểm toán · bắt buộc</label>
        <textarea id="admin-session-reason" maxLength={500} value={reason} disabled={mutationBusy} onChange={(event) => { setReason(event.target.value); setFormError(""); }} />
        <p className="admin-analysis-note">Không ghi thông tin đăng nhập, tài liệu riêng hoặc nội dung phản hồi quiz vào lý do.</p>
        {formError && <p className="admin-error" role="alert">{formError}</p>}
        {mutationError && <p className="admin-error" role="alert">{mutationError} {mutationError.includes("tải lại phiên") && <button type="button" onClick={onReload}>Tải lại phiên</button>}</p>}
        <div className="admin-account-actions">
          <button type="submit" disabled={!canSave}>{mutationBusy ? "Đang lưu…" : "Lưu hiệu chỉnh"}</button>
          <label className="admin-session-delete-confirm"><input type="checkbox" checked={confirmedRemoval} disabled={mutationBusy} onChange={(event) => setConfirmedRemoval(event.target.checked)} />Tôi xác nhận gỡ phiên khỏi lịch sử</label>
          <button type="button" className="admin-destructive" disabled={mutationBusy || !confirmedRemoval || !isAdminReasonValid(reason)} onClick={submitRemoval}>{mutationBusy ? "Đang lưu…" : "Gỡ khỏi lịch sử"}</button>
        </div>
      </form>
    </>}
    {mutationError && !detail && <p className="admin-error" role="alert">{mutationError}</p>}
    {formError && !detail && <p className="admin-error" role="alert">{formError}</p>}
    <section className="admin-session-audit" aria-label="Nhật ký hiệu chỉnh phiên">
      <div className="admin-detail-heading"><div><h3>Nhật ký hiệu chỉnh phiên</h3><p>Nhật ký vẫn được lưu sau khi phiên được gỡ khỏi lịch sử.</p></div></div>
      {auditLoading && <p role="status">Đang tải nhật ký…</p>}
      {auditError && <p className="admin-error" role="alert">{auditError} <button type="button" onClick={onAuditRetry}>Thử lại</button></p>}
      {!auditLoading && !auditError && auditActions.length === 0 && <p className="admin-empty">Chưa có thay đổi được ghi nhận.</p>}
      {!!auditActions.length && <>
        <ol className="admin-audit-list">
          {auditActions.map((item, index) => <li key={`${item.sessionId}:${item.createdAt}:${index}`}>
            <div className="admin-audit-heading"><strong>{item.action === "removal" ? "Gỡ phiên khỏi lịch sử" : "Hiệu chỉnh phiên"}</strong><time dateTime={item.createdAt}>{utcTime(item.createdAt)}</time></div>
            <p>Người thực hiện: <code>{item.actorId}</code></p>
            <p>Chủ phiên: <code>{item.targetOwnerId}</code></p>
            <p>Phiên bản {item.beforeVersion} → {item.afterVersion}</p>
            <p>Lý do: {item.reason}</p>
            <details><summary>Giá trị trước và sau</summary><pre>{JSON.stringify({ before: item.before, after: item.after }, null, 2)}</pre></details>
          </li>)}
        </ol>
        <Pager total={auditTotal} offset={auditOffset} onChange={onAuditOffsetChange} />
      </>}
    </section>
  </section>;
}

function SessionsView({
  sessions,
  loading,
  error,
  total,
  offset,
  onOffsetChange,
  onRetry,
  onAccessDenied,
  onListChanged,
  onSessionRemoved,
  label,
  days,
  durationBasis,
  onDaysChange,
  onDurationBasisChange,
}: {
  sessions: AdminSession[];
  loading: boolean;
  error: string;
  total: number;
  offset: number;
  onOffsetChange: (next: number) => void;
  onRetry: () => void;
  onAccessDenied: () => void;
  onListChanged: () => void;
  onSessionRemoved: (sessionId: string) => void;
  label: string;
  days: AdminSessionPeriod;
  durationBasis: "planned" | "actual" | "";
  onDaysChange: (value: AdminSessionPeriod) => void;
  onDurationBasisChange: (value: "planned" | "actual" | "") => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRemoved, setDetailRemoved] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [auditResult, setAuditResult] = useState<{ key: string; actions: AdminSessionAuditAction[]; total: number } | null>(null);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditRetry, setAuditRetry] = useState(0);
  const auditKey = `${selectedSessionId}:${auditOffset}`;
  const auditValue = auditResult?.key === auditKey ? auditResult : null;

  useEffect(() => {
    if (!selectedSessionId) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError("");
    setMutationError("");
    setDetail(null);
    setDetailRemoved(false);
    fetchAdminSession(selectedSessionId, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setDetail(value); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(cause)) onAccessDenied();
        else if (cause instanceof ApiError && cause.status === 410) setDetailRemoved(true);
        else setDetailError(adminSessionMutationProblem(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [detailRetry, onAccessDenied, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const controller = new AbortController();
    setAuditLoading(true);
    setAuditError("");
    fetchAdminSessionAudit(selectedSessionId, pageSize, auditOffset, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setAuditResult({ key: auditKey, actions: value.actions, total: value.total });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(cause)) onAccessDenied();
        else setAuditError(errorMessage(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setAuditLoading(false); });
    return () => controller.abort();
  }, [auditKey, auditOffset, auditRetry, onAccessDenied, selectedSessionId]);

  const reloadDetail = () => {
    setDetail(null);
    setDetailError("");
    setDetailRemoved(false);
    setMutationError("");
    setDetailRetry((value) => value + 1);
  };

  const saveSession = async (changes: AdminSessionCorrectionChanges, reason: string) => {
    if (!detail || mutationBusy || !isAdminReasonValid(reason)) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      const updated = await updateAdminSession(detail.id, {
        expectedVersion: detail.correctionVersion, reason: reason.trim(), changes,
      });
      setDetail(updated);
      setDetailRemoved(false);
      setAuditOffset(0);
      setAuditRetry((value) => value + 1);
      onListChanged();
    } catch (cause) {
      if (isAdminAccessDenied(cause)) onAccessDenied();
      else if (cause instanceof ApiError && cause.status === 410) {
        setDetailRemoved(true);
        setMutationError(adminSessionMutationProblem(cause));
        onSessionRemoved(detail.id);
        setAuditOffset(0);
        setAuditRetry((value) => value + 1);
      } else setMutationError(adminSessionMutationProblem(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  const deleteSession = async (reason: string) => {
    if (!detail || mutationBusy || !isAdminReasonValid(reason)) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      await removeAdminSession(detail.id, { expectedVersion: detail.correctionVersion, reason: reason.trim() });
      setDetailRemoved(true);
      setAuditOffset(0);
      setAuditRetry((value) => value + 1);
      onSessionRemoved(detail.id);
    } catch (cause) {
      if (isAdminAccessDenied(cause)) onAccessDenied();
      else if (cause instanceof ApiError && cause.status === 410) {
        setDetailRemoved(true);
        setMutationError(adminSessionMutationProblem(cause));
        onSessionRemoved(detail.id);
        setAuditOffset(0);
        setAuditRetry((value) => value + 1);
      } else setMutationError(adminSessionMutationProblem(cause));
    } finally {
      setMutationBusy(false);
    }
  };

  return <section className="admin-detail" aria-live="polite">
    <div className="admin-detail-heading"><div><h3>Phiên học của {label}</h3><p>Danh sách chỉ hiển thị chỉ số phiên, không hiển thị mục tiêu riêng hoặc nội dung tài liệu.</p></div></div>
    <AdminSessionFilters days={days} durationBasis={durationBasis} onDaysChange={onDaysChange} onDurationBasisChange={onDurationBasisChange} />
    {loading && <p role="status">Đang tải phiên học…</p>}
    {error && <p className="admin-error" role="alert">{error} <button type="button" onClick={onRetry}>Thử lại</button></p>}
    {!loading && !error && sessions.length === 0 && <p className="admin-empty">Chưa có phiên học trong khoảng thời gian này.</p>}
    {!!sessions.length && <>
      <div className="admin-table-scroll" role="region" aria-label={`Phiên học của ${label}`} tabIndex={0}>
        <table className="admin-data-table admin-session-table">
          <thead><tr><th>Phiên · chủ đề</th><th>Bắt đầu · kết thúc UTC</th><th>Kế hoạch</th><th>Thực tế · tập trung</th><th>Nghỉ</th><th>Xao nhãng</th><th>Hoàn tất</th><th>Quiz</th><th>Thao tác</th></tr></thead>
          <tbody>{sessions.map((session) => <tr key={session.id}>
            <th scope="row"><code>{session.id.slice(0, 8)}</code><small>{session.topic}</small>{label === "toàn hệ thống" && <small>{adminSessionOwnerLabel(session)}</small>}</th>
            <td><time dateTime={session.startedAt}>{utcTime(session.startedAt)}</time><small><time dateTime={session.endedAt}>{utcTime(session.endedAt)}</time></small></td>
            <td>{formatAdminDuration(session.plannedStudySeconds)} học<small>{session.plannedBreakSeconds ? `${formatAdminDuration(session.plannedBreakSeconds)} nghỉ dự kiến` : "Không lên lịch nghỉ"}</small></td>
            <td>{formatAdminDuration(session.actualStudySeconds)} học<small>{formatAdminDuration(session.focusedSeconds)} tập trung</small></td>
            <td>{formatAdminDuration(session.actualBreakSeconds)} thực tế<small>{formatAdminDuration(session.plannedBreakSeconds)} dự kiến</small></td>
            <td>{session.distractions}</td>
            <td>{session.completed ? "Đạt" : "Chưa đạt"}</td>
            <td>{session.quizScore === null || session.quizTotal === null ? "Chưa chấm" : `${session.quizScore}/${session.quizTotal}`}</td>
            <td><button type="button" aria-pressed={selectedSessionId === session.id} onClick={() => {
              if (selectedSessionId === session.id) return;
              setSelectedSessionId(session.id);
              setDetail(null);
              setDetailError("");
              setDetailRemoved(false);
              setMutationError("");
              setAuditOffset(0);
            }} disabled={mutationBusy}>Xem / chỉnh sửa</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <Pager total={total} offset={offset} onChange={onOffsetChange} />
    </>}
    {selectedSessionId && <AdminSessionEditor
      key={`${selectedSessionId}:${detail?.correctionVersion ?? "loading"}`}
      detail={detail}
      removed={detailRemoved}
      loading={detailLoading}
      error={detailError}
      mutationBusy={mutationBusy}
      mutationError={mutationError}
      auditActions={auditValue?.actions ?? []}
      auditLoading={auditLoading}
      auditError={auditError}
      auditTotal={auditValue?.total ?? 0}
      auditOffset={auditOffset}
      onReload={reloadDetail}
      onSave={(changes, reason) => void saveSession(changes, reason)}
      onDelete={(reason) => void deleteSession(reason)}
      onAuditOffsetChange={setAuditOffset}
      onAuditRetry={() => setAuditRetry((value) => value + 1)}
    />}
  </section>;
}

export function AdminPanel({ onClose, onAccessDenied, currentUserId }: {
  onClose?: () => void;
  onAccessDenied?: () => void;
  currentUserId?: string;
} = {}) {
  const [days, setDays] = useState<AdminPeriod>(7);
  const [sessionDays, setSessionDays] = useState<AdminSessionPeriod>(defaultAdminSessionPeriod);
  const [sessionDurationBasis, setSessionDurationBasis] = useState<"planned" | "actual" | "">("");
  const [tab, setTab] = useState<"overview" | "accounts" | "groups" | "sessions">("overview");
  const [report, setReport] = useState<AdminReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const [reportRetry, setReportRetry] = useState(0);
  const [detailReportRetry, setDetailReportRetry] = useState(0);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [detailReportResult, setDetailReportResult] = useState<{ key: string; value: AdminReport } | null>(null);
  const [detailReportError, setDetailReportError] = useState<{ key: string; message: string } | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountTotal, setAccountTotal] = useState(0);
  const [accountOffset, setAccountOffset] = useState(0);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountRetry, setAccountRetry] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<AdminAccount | null>(null);
  const [mutationAction, setMutationAction] = useState<AdminMutationAction | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [auditResult, setAuditResult] = useState<{ key: string; actions: AdminActionAudit[]; total: number } | null>(null);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditRetry, setAuditRetry] = useState(0);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [groupTotal, setGroupTotal] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupRetry, setGroupRetry] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState<AdminGroup | null>(null);
  const [sessionResult, setSessionResult] = useState<{ key: string; rows: AdminSession[]; total: number } | null>(null);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const selectedAccountId = selectedAccount?.id;
  const selectedGroupId = selectedGroup?.id;
  const auditKey = [selectedAccountId ?? "", auditOffset].join(":");
  const auditValue = auditResult?.key === auditKey ? auditResult : null;
  const reportFilters: AdminReportFilters | null = selectedAccountId
    ? { accountId: selectedAccountId }
    : selectedGroupId ? { groupId: selectedGroupId } : null;
  const reportKey = adminReportCacheKey(days, selectedAccountId, selectedGroupId, reportRetry);
  const detailReportKey = adminReportCacheKey(days, selectedAccountId, selectedGroupId, reportRetry + detailReportRetry);
  const detailReport = reportFilters ? adminReportForKey(detailReportResult, detailReportKey) : null;
  const detailReportErrorMessage = detailReportError?.key === detailReportKey ? detailReportError.message : "";
  const detailReportLoading = Boolean(reportFilters && !detailReport && !detailReportErrorMessage);
  const sessionScope: AdminSessionScope = tab === "sessions" ? "global" : selectedAccount ? "account" : "group";
  const sessionFilterId = sessionScope === "account" ? selectedAccount?.id ?? ""
    : sessionScope === "group" ? selectedGroup?.id ?? "" : "";
  const sessionKey = `${sessionDays}:${sessionScope}:${sessionFilterId}:${sessionDurationBasis}:${sessionOffset}`;
  const { rows: sessions, total: sessionTotal } = adminRowsForKey(sessionResult, sessionKey);
  const refreshSessionList = useCallback(() => setSessionRetry((value) => value + 1), []);
  const removeSessionFromList = useCallback((sessionId: string) => {
    setSessionResult((previous) => {
      if (previous?.key !== sessionKey) return previous;
      const rows = previous.rows.filter((session) => session.id !== sessionId);
      return rows.length === previous.rows.length
        ? previous
        : { ...previous, rows, total: Math.max(0, previous.total - 1) };
    });
    setSessionRetry((value) => value + 1);
    setReport(null);
    setReportLoading(true);
    setReportError("");
    setReportRetry((value) => value + 1);
    setDetailReportResult(null);
    setDetailReportError(null);
    setDetailReportRetry((value) => value + 1);
  }, [sessionKey]);
  const refreshSessionMutationData = useCallback(() => {
    setSessionResult(null);
    setSessionLoading(true);
    setSessionRetry((value) => value + 1);
    setReport(null);
    setReportLoading(true);
    setReportError("");
    setReportRetry((value) => value + 1);
    setDetailReportResult(null);
    setDetailReportError(null);
    setDetailReportRetry((value) => value + 1);
  }, []);
  const deniedCallback = useRef(onAccessDenied);
  const exportRequest = useRef<AbortController | null>(null);

  useEffect(() => { deniedCallback.current = onAccessDenied; }, [onAccessDenied]);
  useEffect(() => () => exportRequest.current?.abort(), []);

  const clearAdminData = useCallback(() => {
    setReport(null);
    setAccounts([]);
    setGroups([]);
    setSessionResult(null);
    setDetailReportResult(null);
    setDetailReportError(null);
    setAuditResult(null);
    setAuditError("");
    setMutationAction(null);
    setMutationError("");
    setAccountTotal(0);
    setGroupTotal(0);
    setSelectedAccount(null);
    setSelectedGroup(null);
    deniedCallback.current?.();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setReportError("");
    setReportLoading(true);
    fetchAdminReport(days, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setReport(value); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setReportError(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setReportLoading(false); });
    return () => controller.abort();
  }, [days, clearAdminData, reportRetry]);

  useEffect(() => {
    const filters = selectedAccountId
      ? { accountId: selectedAccountId }
      : selectedGroupId ? { groupId: selectedGroupId } : null;
    if (!filters) {
      setDetailReportResult(null);
      setDetailReportError(null);
      return;
    }
    const controller = new AbortController();
    setDetailReportError(null);
    setDetailReportResult(null);
    fetchAdminReport(days, controller.signal, filters)
      .then((value) => { if (!controller.signal.aborted) setDetailReportResult({ key: detailReportKey, value }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setDetailReportError({ key: detailReportKey, message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [clearAdminData, days, detailReportKey, reportKey, selectedAccountId, selectedGroupId]);

  useEffect(() => {
    if (tab !== "accounts") return;
    const controller = new AbortController();
    setAccountLoading(true);
    setAccounts([]);
    setAccountError("");
    fetchAdminAccounts(accountQuery, pageSize, accountOffset, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setAccounts(value.users);
        setAccountTotal(value.total);
        setSelectedAccount((previous) => previous
          ? value.users.find((account) => account.id === previous.id) ?? previous
          : previous);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setAccountError(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setAccountLoading(false); });
    return () => controller.abort();
  }, [accountOffset, accountQuery, accountRetry, clearAdminData, tab]);

  useEffect(() => {
    if (tab !== "accounts" || !selectedAccountId) {
      setAuditResult(null);
      setAuditError("");
      setAuditLoading(false);
      return;
    }
    const controller = new AbortController();
    setAuditLoading(true);
    setAuditError("");
    fetchAdminAudit(selectedAccountId, pageSize, auditOffset, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setAuditResult({
          key: auditKey,
          actions: value.actions,
          total: value.total,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setAuditError(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setAuditLoading(false); });
    return () => controller.abort();
  }, [auditKey, auditOffset, auditRetry, clearAdminData, selectedAccountId, tab]);

  useEffect(() => {
    if (tab !== "groups") return;
    const controller = new AbortController();
    setGroupLoading(true);
    setGroups([]);
    setGroupError("");
    fetchAdminGroups(groupQuery, pageSize, groupOffset, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setGroups(value.groups);
        setGroupTotal(value.total);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setGroupError(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setGroupLoading(false); });
    return () => controller.abort();
  }, [clearAdminData, groupOffset, groupQuery, groupRetry, tab]);

  useEffect(() => {
    const filters = selectedAccount ? { accountId: selectedAccount.id } : selectedGroup ? { groupId: selectedGroup.id } : null;
    if (tab !== "sessions" && !filters) {
      setSessionResult(null);
      setSessionError("");
      setSessionLoading(false);
      return;
    }
    const controller = new AbortController();
    setSessionLoading(true);
    setSessionError("");
    fetchAdminSessions(sessionDays, adminSessionApiFilters(sessionScope, selectedAccountId, selectedGroupId, sessionDurationBasis), pageSize, sessionOffset, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSessionResult({ key: sessionKey, rows: value.sessions, total: value.total });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isAdminAccessDenied(error)) clearAdminData();
        else setSessionError(errorMessage(error));
      })
      .finally(() => { if (!controller.signal.aborted) setSessionLoading(false); });
    return () => controller.abort();
  }, [clearAdminData, selectedAccount, selectedAccountId, selectedGroup, selectedGroupId, sessionDays, sessionDurationBasis, sessionOffset, sessionKey, sessionRetry, sessionScope, tab]);

  const searchAccounts = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSelectedAccount(null);
    setSelectedGroup(null);
    setMutationAction(null);
    setAccountOffset(0);
    setAuditOffset(0);
    setAccountQuery(accountSearch.trim());
  };

  const searchGroups = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSelectedGroup(null);
    setSelectedAccount(null);
    setGroupOffset(0);
    setGroupQuery(groupSearch.trim());
  };

  const chooseAccount = (account: AdminAccount) => {
    setSessionError("");
    setMutationAction(null);
    setMutationError("");
    setSelectedAccount(account);
    setSelectedGroup(null);
    setSessionOffset(0);
    setAuditOffset(0);
  };

  const chooseGroup = (group: AdminGroup) => {
    setSessionError("");
    setMutationAction(null);
    setSelectedGroup(group);
    setSelectedAccount(null);
    setSessionOffset(0);
  };

  const submitAccountMutation = async (reason: string, name?: string) => {
    if (!selectedAccount || !mutationAction || !isAdminReasonValid(reason)) return;
    const target = selectedAccount;
    const action = mutationAction;
    setMutationBusy(true);
    setMutationError("");
    try {
      const common = { expectedVersion: target.adminStateVersion, reason: reason.trim() };
      let updated: AdminAccount;
      if (action.kind === "profile") {
        if (!name || !isAdminNameValid(name)) return;
        updated = await updateAdminAccountProfile(target.id, { ...common, name: name.trim(), expectedName: target.name });
      } else if (action.kind === "deletion") {
        updated = await updateAdminAccountDeletion(target.id, { ...common, deleted: action.value });
      } else if (action.kind === "role") {
        updated = await updateAdminAccountRole(target.id, { ...common, isAdmin: action.value });
      } else {
        updated = await updateAdminAccountSuspension(target.id, { ...common, suspended: action.value });
      }
      setAccounts((previous) => previous.map((account) => account.id === updated.id ? updated : account));
      setSelectedAccount(updated);
      setMutationAction(null);
      setMutationError("");
      setAuditOffset(0);
      setAccountRetry((value) => value + 1);
      setAuditRetry((value) => value + 1);
    } catch (error) {
      if (isAdminAccessDenied(error)) clearAdminData();
      else {
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
          setAccountRetry((value) => value + 1);
          setAuditRetry((value) => value + 1);
        }
        setMutationError(adminMutationProblem(error));
      }
    } finally {
      setMutationBusy(false);
    }
  };

  const visibleExportFilters: AdminReportFilters = tab === "accounts" && selectedAccount
    ? { accountId: selectedAccount.id }
    : tab === "groups" && selectedGroup ? { groupId: selectedGroup.id } : {};
  const exportButtonLabel = exporting
    ? "Đang xuất…"
    : visibleExportFilters.accountId ? "Tải CSV tài khoản"
      : visibleExportFilters.groupId ? "Tải CSV nhóm" : "Tải CSV tổng hợp";

  const exportCsv = async () => {
    const controller = new AbortController();
    exportRequest.current?.abort();
    exportRequest.current = controller;
    setExporting(true);
    setExportError("");
    try {
      const file = await exportAdminReport(days, controller.signal, visibleExportFilters);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAdminAccessDenied(error)) clearAdminData();
      else setExportError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  };

  return <section className="admin-panel" aria-labelledby="admin-panel-title">
    <header className="admin-panel-header">
      <div>
        <p className="admin-eyebrow">Viễn Du · Công cụ nội bộ</p>
        <h1 id="admin-panel-title">Báo cáo quản trị</h1>
        <p>Thống kê hoạt động học tập đã lưu. Mọi mốc thời gian dùng UTC.</p>
      </div>
      {onClose && <button type="button" className="admin-close" onClick={onClose}>Đóng</button>}
    </header>

    <div className="admin-toolbar">
      <label htmlFor="admin-report-period">Khoảng báo cáo
        <select id="admin-report-period" value={days} onChange={(event) => { setDays(Number(event.target.value) as AdminPeriod); }}>
          {periods.map((period) => <option value={period} key={period}>{period} ngày</option>)}
        </select>
      </label>
      <button type="button" onClick={exportCsv} disabled={exporting}>
        {exportButtonLabel}
      </button>
    </div>

    <nav className="admin-tabs" aria-label="Báo cáo quản trị">
      <button type="button" aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>Tổng quan</button>
      <button type="button" aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>Tài khoản</button>
      <button type="button" aria-pressed={tab === "groups"} onClick={() => setTab("groups")}>Nhóm học</button>
      <button type="button" aria-pressed={tab === "sessions"} onClick={() => setTab("sessions")}>Lịch sử phiên</button>
    </nav>

    {reportError && <p className="admin-error" role="alert">{reportError} <button type="button" onClick={() => setReportRetry((value) => value + 1)}>Thử tải báo cáo lại</button></p>}
    {exportError && <p className="admin-error" role="alert">{exportError} <button type="button" onClick={() => void exportCsv()}>Thử tải CSV lại</button></p>}
    {tab === "overview" && <section aria-label="Tổng quan quản trị" className="admin-panel-content">
      {reportLoading && <p role="status">Đang tải báo cáo…</p>}
      {!reportLoading && report && <AdminOverview report={report} />}
      {!reportLoading && !report && !reportError && <p className="admin-empty">Chưa có dữ liệu báo cáo.</p>}
    </section>}

    {tab === "sessions" && <section aria-label="Lịch sử phiên toàn hệ thống" className="admin-panel-content">
      <SessionsView key={sessionKey} sessions={sessions} loading={sessionLoading || (!sessionError && sessionResult?.key !== sessionKey)} error={sessionError} total={sessionTotal} offset={sessionOffset} onOffsetChange={setSessionOffset} onRetry={refreshSessionList} onAccessDenied={clearAdminData} onListChanged={refreshSessionMutationData} onSessionRemoved={removeSessionFromList} label="toàn hệ thống" days={sessionDays} durationBasis={sessionDurationBasis}
        onDaysChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDays(value); }}
        onDurationBasisChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDurationBasis(value); }} />
    </section>}

    {tab === "accounts" && <section aria-label="Tra cứu tài khoản" className="admin-panel-content">
      <form className="admin-search" onSubmit={searchAccounts}>
        <label htmlFor="admin-account-search">Tìm theo UUID, tên hoặc email</label>
        <div><input id="admin-account-search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} maxLength={100} />
          <button type="submit">Tìm tài khoản</button></div>
      </form>
      {accountLoading && <p role="status">Đang tìm tài khoản…</p>}
      {accountError && <p className="admin-error" role="alert">{accountError} <button type="button" onClick={() => setAccountRetry((value) => value + 1)}>Thử lại</button></p>}
      {!accountLoading && !accountError && accounts.length === 0 && <p className="admin-empty">Không có tài khoản phù hợp. Thử tìm bằng tên hoặc email khác.</p>}
      {!!accounts.length && <>
        <ul className="admin-result-list">
          {accounts.map((account) => <li key={account.id}>
            <button type="button" className="admin-result-button" aria-pressed={selectedAccount?.id === account.id} onClick={() => chooseAccount(account)}>
              <strong>{account.name}</strong><span>{account.email}</span><small>Tạo lúc {utcTime(account.createdAt)}</small>
            </button>
          </li>)}
        </ul>
        <Pager total={accountTotal} offset={accountOffset} onChange={(offset) => {
          setAccountOffset(offset);
          setSelectedAccount(null);
          setMutationAction(null);
          setMutationError("");
        }} />
      </>}
      {selectedAccount && <>
        <AdminAccountGovernance
          account={selectedAccount}
          currentUserId={currentUserId}
          onChangeRequested={(action) => { setMutationAction(action); setMutationError(""); }}
        />
        {mutationAction && <AdminMutationConfirmation
          key={`${selectedAccount.id}:${mutationAction.kind}`}
          account={selectedAccount}
          currentUserId={currentUserId}
          action={mutationAction}
          busy={mutationBusy}
          error={mutationError}
          onCancel={() => { if (!mutationBusy) { setMutationAction(null); setMutationError(""); } }}
          onConfirm={(reason, name) => void submitAccountMutation(reason, name)}
        />}
        <AdminAuditView
          actions={auditValue?.actions ?? []}
          loading={auditLoading}
          error={auditError}
          total={auditValue?.total ?? 0}
          offset={auditOffset}
          onOffsetChange={setAuditOffset}
          onRetry={() => setAuditRetry((value) => value + 1)}
        />
        <section className="admin-detail" aria-label={`Phân tích tài khoản ${selectedAccount.name}`} aria-live="polite">
          <div className="admin-detail-heading"><div><h3>Phân tích học tập của {selectedAccount.name}</h3><p>Tổng hợp trong khoảng {days} ngày đã chọn; biểu đồ, bảng và CSV chỉ dùng phiên của tài khoản này.</p></div></div>
          {detailReportLoading && <p role="status">Đang tải phân tích tài khoản…</p>}
          {detailReportErrorMessage && <p className="admin-error" role="alert">{detailReportErrorMessage} <button type="button" onClick={() => setDetailReportRetry((value) => value + 1)}>Thử lại</button></p>}
          {detailReport && <AdminOverview report={detailReport} scopeLabel={`Tài khoản: ${selectedAccount.name} · ${selectedAccount.email}`} />}
        </section>
        <SessionsView key={sessionKey} sessions={sessions} loading={sessionLoading || (!sessionError && sessionResult?.key !== sessionKey)} error={sessionError} total={sessionTotal} offset={sessionOffset} onOffsetChange={setSessionOffset} onRetry={refreshSessionList} onAccessDenied={clearAdminData} onListChanged={refreshSessionMutationData} onSessionRemoved={removeSessionFromList} label={`${selectedAccount.name} · ${selectedAccount.email}`} days={sessionDays} durationBasis={sessionDurationBasis}
        onDaysChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDays(value); }}
        onDurationBasisChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDurationBasis(value); }} />
      </>}
    </section>}

    {tab === "groups" && <section aria-label="Tra cứu nhóm học" className="admin-panel-content">
      <form className="admin-search" onSubmit={searchGroups}>
        <label htmlFor="admin-group-search">Tìm theo tên hoặc mã nhóm</label>
        <div><input id="admin-group-search" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} maxLength={100} />
          <button type="submit">Tìm nhóm</button></div>
      </form>
      {groupLoading && <p role="status">Đang tìm nhóm…</p>}
      {groupError && <p className="admin-error" role="alert">{groupError} <button type="button" onClick={() => setGroupRetry((value) => value + 1)}>Thử lại</button></p>}
      {!groupLoading && !groupError && groups.length === 0 && <p className="admin-empty">Không có nhóm phù hợp. Thử tên nhóm khác.</p>}
      {!!groups.length && <>
        <ul className="admin-result-list admin-group-list">
          {groups.map((group) => <li key={group.id}>
            <button type="button" className="admin-result-button" aria-pressed={selectedGroup?.id === group.id} onClick={() => chooseGroup(group)}>
              <strong>{group.name}</strong>
              <span>{group.memberCount} thành viên · {group.archived ? "Đã lưu trữ" : "Đang hoạt động"}</span>
              <small>{formatAdminDuration(group.progress.journeySeconds)} tiến độ hành trình · chặng {group.progress.station + 1} · múi giờ nhóm {group.timezone}</small>
            </button>
          </li>)}
        </ul>
        <Pager total={groupTotal} offset={groupOffset} onChange={setGroupOffset} />
      </>}
      {selectedGroup && <>
        <section className="admin-detail" aria-label={`Phân tích nhóm ${selectedGroup.name}`} aria-live="polite">
          <div className="admin-detail-heading"><div><h3>Phân tích học tập của nhóm {selectedGroup.name}</h3><p>Tổng hợp trong khoảng {days} ngày đã chọn; biểu đồ, bảng và CSV chỉ dùng phiên thuộc nhóm này.</p></div></div>
          {detailReportLoading && <p role="status">Đang tải phân tích nhóm…</p>}
          {detailReportErrorMessage && <p className="admin-error" role="alert">{detailReportErrorMessage} <button type="button" onClick={() => setDetailReportRetry((value) => value + 1)}>Thử lại</button></p>}
          {detailReport && <AdminOverview report={detailReport} scopeLabel={`Nhóm: ${selectedGroup.name}`} />}
        </section>
        <SessionsView key={sessionKey} sessions={sessions} loading={sessionLoading || (!sessionError && sessionResult?.key !== sessionKey)} error={sessionError} total={sessionTotal} offset={sessionOffset} onOffsetChange={setSessionOffset} onRetry={refreshSessionList} onAccessDenied={clearAdminData} onListChanged={refreshSessionMutationData} onSessionRemoved={removeSessionFromList} label={selectedGroup.name} days={sessionDays} durationBasis={sessionDurationBasis}
        onDaysChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDays(value); }}
        onDurationBasisChange={(value) => { setSessionError(""); setSessionOffset(0); setSessionDurationBasis(value); }} />
      </>}
    </section>}

    <footer className="admin-panel-footer">
      Thời gian tập trung là focus và học tài liệu đã lưu; thời gian học thực tế tính theo thời lượng phiên sau khi trừ nghỉ đã lên lịch. Điểm quiz chỉ tính các phiên có kết quả chấm.
    </footer>
  </section>;
}
