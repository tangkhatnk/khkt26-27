export type AdminPeriod = 7 | 30 | 90;

export type AdminReportFilters = {
  accountId?: string;
  groupId?: string;
};

export type AdminAccess = { allowed: boolean };

export type AdminAccountStatus = "active" | "suspended" | "deleted";
export type AdminSource = "bootstrap" | "persistent" | null;
export type AdminAction = "role" | "suspension" | "profile" | "deletion";

export type AdminStateVersion = {
  isAdmin: boolean;
  suspended: boolean;
  deleted: boolean;
  version: number;
};

export type AdminRoleUpdateRequest = {
  isAdmin: boolean;
  expectedVersion: number;
  reason: string;
};

export type AdminSuspensionUpdateRequest = {
  suspended: boolean;
  expectedVersion: number;
  reason: string;
};

export type AdminProfileUpdateRequest = {
  name: string;
  expectedName: string;
  expectedVersion: number;
  reason: string;
};

export type AdminDeletionUpdateRequest = {
  deleted: boolean;
  expectedVersion: number;
  reason: string;
};

type AdminActionAuditBase = {
  actorId: string;
  targetId: string;
  reason: string;
  createdAt: string;
};

export type AdminActionAudit =
  | (AdminActionAuditBase & {
      action: "profile";
      before: AdminStateVersion & { name: string };
      after: AdminStateVersion & { name: string };
    })
  | (AdminActionAuditBase & {
      action: Exclude<AdminAction, "profile">;
      before: AdminStateVersion;
      after: AdminStateVersion;
    });

export type AdminProfileUpdateResponse = AdminAccountDto;
export type AdminDeletionUpdateResponse = AdminAccountDto;

export type AdminAuditPage = AdminPage<{ actions: AdminActionAudit[] }>;

export type AdminProblem = {
  status: 400 | 401 | 403 | 404 | 409;
  detail: string;
  title?: string;
  type?: string;
};

export type AdminMetricTotals = {
  sessionCount: number;
  plannedStudySeconds: number;
  actualStudySeconds: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  distractions: number;
  completedSessions: number;
  completionPercent: number;
  gradedQuizSessions: number;
  quizCoveragePercent: number;
  quizScore: number;
  quizTotal: number;
  quizScorePercent: number | null;
};

export type AdminReport = {
  days: AdminPeriod;
  timezone: "UTC";
  analysisLimit: number;
  fromUtc: string;
  asOfUtc: string;
  matchingSessionCount: number;
  recordsAnalyzed: number;
  truncated: boolean;
  totals: AdminMetricTotals;
  daily: (AdminMetricTotals & { dateUtc: string })[];
  topics: (AdminMetricTotals & { topic: string })[];
};

export type AdminPage<T> = {
  total: number;
  limit: number;
  offset: number;
  [key: string]: unknown;
} & T;

export type AdminAccountDto = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isAdmin: boolean;
  adminSource: AdminSource;
  status: AdminAccountStatus;
  suspendedAt: string | null;
  deletedAt: string | null;
  adminStateVersion: number;
};

export type AdminAccount = AdminAccountDto;
export type AdminAccountUpdateResponse = AdminAccountDto;

export type AdminAccountsPage = AdminPage<{ users: AdminAccount[] }>;

export type AdminGroup = {
  id: string;
  name: string;
  timezone: string;
  archived: boolean;
  memberCount: number;
  progress: {
    journeySeconds: number;
    station: number;
    remainingSeconds: number;
    thresholdSeconds: number;
  };
};

export type AdminGroupsPage = AdminPage<{ groups: AdminGroup[] }>;

export type AdminSession = {
  id: string;
  accountId: string;
  groupId: string | null;
  topic: string;
  startedAt: string;
  endedAt: string;
  plannedStudySeconds: number;
  actualStudySeconds: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  distractions: number;
  completed: boolean;
  quizScore: number | null;
  quizTotal: number | null;
};

export type AdminSessionsPage = AdminPage<{
  days: AdminPeriod;
  timezone: "UTC";
  fromUtc: string;
  asOfUtc: string;
  sessions: AdminSession[];
}>;

export type AdminReportCsv = { blob: Blob; filename: string };
