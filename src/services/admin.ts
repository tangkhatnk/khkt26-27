import { API_URL, ApiError, getAccessToken, request } from "./api";
import type {
  AdminAccountUpdateResponse,
  AdminAccess,
  AdminAuditPage,
  AdminAccountsPage,
  AdminGroupsPage,
  AdminPeriod,
  AdminReportFilters,
  AdminReport,
  AdminReportCsv,
  AdminRoleUpdateRequest,
  AdminProfileUpdateRequest,
  AdminDeletionUpdateRequest,
  AdminSuspensionUpdateRequest,
  AdminSessionsPage,
  AdminSessionAuditPage,
  AdminSessionCorrectionRequest,
  AdminSessionDetail,
  AdminSessionPeriod,
  AdminSessionRemovalRequest,
  AdminSessionRemovalResponse,
} from "./adminContracts";

function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

export const fetchAdminAccess = () => request<AdminAccess>("/admin/access", { cache: "no-store" });

export const fetchAdminReport = (days: AdminPeriod, signal?: AbortSignal, filters: AdminReportFilters = {}) =>
  request<AdminReport>(`/admin/report?${query({ days, ...filters })}`, { signal, cache: "no-store" });

export const fetchAdminAccounts = (
  search: string,
  limit = 25,
  offset = 0,
  signal?: AbortSignal,
) => request<AdminAccountsPage>(`/admin/accounts?${query({ q: search.trim(), limit, offset })}`, {
  signal,
  cache: "no-store",
});

export const updateAdminAccountRole = (accountId: string, update: AdminRoleUpdateRequest) =>
  request<AdminAccountUpdateResponse>(`/admin/accounts/${encodeURIComponent(accountId)}/role`, {
    method: "PUT",
    body: JSON.stringify(update),
    cache: "no-store",
  });

export const updateAdminAccountSuspension = (accountId: string, update: AdminSuspensionUpdateRequest) =>
  request<AdminAccountUpdateResponse>(`/admin/accounts/${encodeURIComponent(accountId)}/suspension`, {
    method: "PUT",
    body: JSON.stringify(update),
    cache: "no-store",
  });

export const updateAdminAccountProfile = (accountId: string, update: AdminProfileUpdateRequest) =>
  request<AdminAccountUpdateResponse>(`/admin/accounts/${encodeURIComponent(accountId)}/profile`, {
    method: "PUT", body: JSON.stringify(update), cache: "no-store",
  });

export const updateAdminAccountDeletion = (accountId: string, update: AdminDeletionUpdateRequest) =>
  request<AdminAccountUpdateResponse>(`/admin/accounts/${encodeURIComponent(accountId)}/deletion`, {
    method: "PUT", body: JSON.stringify(update), cache: "no-store",
  });

export const fetchAdminAudit = (
  targetId: string,
  limit = 25,
  offset = 0,
  signal?: AbortSignal,
) => request<AdminAuditPage>(`/admin/audit?${query({ targetId, limit, offset })}`, {
  signal,
  cache: "no-store",
});

export const fetchAdminGroups = (
  search: string,
  limit = 25,
  offset = 0,
  signal?: AbortSignal,
) => request<AdminGroupsPage>(`/admin/groups?${query({ q: search.trim(), limit, offset })}`, {
  signal,
  cache: "no-store",
});

export const fetchAdminSessions = (
  days: AdminSessionPeriod,
  filters: { accountId?: string; groupId?: string; durationBasis?: "planned" | "actual" },
  limit = 25,
  offset = 0,
  signal?: AbortSignal,
) => request<AdminSessionsPage>(`/admin/sessions?${query({ days, ...filters, limit, offset })}`, {
  signal,
  cache: "no-store",
});

export const fetchAdminSession = (sessionId: string, signal?: AbortSignal) =>
  request<AdminSessionDetail>(`/admin/sessions/${encodeURIComponent(sessionId)}`, {
    signal,
    cache: "no-store",
  });

export const updateAdminSession = (sessionId: string, update: AdminSessionCorrectionRequest) =>
  request<AdminSessionDetail>(`/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(update),
    cache: "no-store",
  });

export const removeAdminSession = (sessionId: string, update: AdminSessionRemovalRequest) =>
  request<AdminSessionRemovalResponse>(`/admin/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    body: JSON.stringify(update),
    cache: "no-store",
  });

export const fetchAdminSessionAudit = (
  sessionId: string,
  limit = 25,
  offset = 0,
  signal?: AbortSignal,
) => request<AdminSessionAuditPage>(
  `/admin/sessions/${encodeURIComponent(sessionId)}/audit?${query({ limit, offset })}`,
  { signal, cache: "no-store" },
);

function csvFilename(header: string | null, days: AdminPeriod) {
  const match = header?.match(/filename="([a-zA-Z0-9._-]+)"/);
  return match?.[1] ?? `viendu-admin-report-${days}d-UTC.csv`;
}

export async function exportAdminReport(
  days: AdminPeriod,
  signal?: AbortSignal,
  filters: AdminReportFilters = {},
): Promise<AdminReportCsv> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    controller.signal.throwIfAborted();
    const token = await getAccessToken();
    controller.signal.throwIfAborted();
    const response = await fetch(`${API_URL}/admin/report/export.csv?${query({ days, ...filters })}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new ApiError(response.status, problem.detail ?? "Không xuất được báo cáo.");
    }
    const blob = await response.blob();
    if (await getAccessToken() !== token)
      throw new ApiError(409, "Tài khoản đã thay đổi. Vui lòng thử lại.");
    controller.signal.throwIfAborted();
    return { blob, filename: csvFilename(response.headers.get("content-disposition"), days) };
  } catch (error) {
    if (timedOut) throw new ApiError(408, "Xuất báo cáo quá thời gian chờ. Hãy thử lại.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
