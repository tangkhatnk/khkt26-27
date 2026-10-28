import { API_URL, request } from "./api";

export type PublicReportTotals = {
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

export type PublicReportPeriod = 7 | 30 | 90;

export type PublicReport = {
  days: PublicReportPeriod;
  analysisLimit: number;
  matchingSessionCount: number;
  recordsAnalyzed: number;
  truncated: boolean;
  totals: PublicReportTotals;
  daily: (PublicReportTotals & { dateUtc: string })[];
  topics: (PublicReportTotals & { topic: string })[];
};

export function publicReportCsvUrl(days: PublicReportPeriod): string {
  return `${API_URL}/public/report/export.csv?days=${days}`;
}

export function getPublicReport(days: PublicReportPeriod, signal?: AbortSignal) {
  return request<PublicReport>(`/public/report?days=${days}`, { cache: "no-store", signal }, false);
}
