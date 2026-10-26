import { isValidBreakPlan } from "../../backend/src/adventure/domain.ts";
import { validMaterialSources, type MaterialSource } from "./materialSources.ts";
import type { ActiveTrip } from "./focus";
import { isDeviceCategory } from "./device.ts";
import { isValidQuizAssessment, isValidQuizDraftMap, type QuizDraft } from "./quizDrafts.ts";
import {
  emptyWorld,
  type Snapshot,
  type World,
  type Session,
} from "../../backend/src/adventure/domain.ts";
type SnapshotSession = Snapshot["sessions"][number];
export type SessionHistoryEntry = Session & Partial<Pick<SnapshotSession,
  "correctionVersion" | "effectiveMetrics" | "correctionFlags">>;
export type MaterialSummaryCacheEntry = {
  sourceFingerprint: string;
  summary: string;
  generatedAt: number;
};
export type Saved = {
  active: ActiveTrip | null;
  pending: Session[];
  snapshot: Snapshot | null;
  local: World;
  notes: Record<string, string>;
  sources?: Record<string, MaterialSource[]>;
  materials?: Record<string, NonNullable<ActiveTrip["materials"]>>;
  guestPublished?: string[];
  /** Owner-local tombstone memory, including authenticated 410 responses for guest trips. */
  removedSessionIds?: string[];
  quizDrafts?: Record<string, QuizDraft>;
  summarySessionId?: string;
  materialSummaries?: Record<string, Record<string, MaterialSummaryCacheEntry>>;
};
export const MAX_MATERIAL_SUMMARY_CACHE_ENTRIES = 20;
export const MAX_MATERIAL_SUMMARY_LENGTH = 4_000;
/** A sync continuation may write only while its captured owner, auth identity, and workspace agree. */
export function isCurrentOwnerWorkspace(
  expectedOwner: string,
  currentOwner: string,
  workspaceLive: boolean,
  authenticatedOwner?: string,
): boolean {
  return expectedOwner === currentOwner && workspaceLive &&
    (expectedOwner === "guest"
      ? authenticatedOwner === undefined
      : authenticatedOwner === expectedOwner);
}
type OwnerHistorySyncErrorAction = "continue" | "stop";
export async function syncOwnerHistory<Session, Response>({
  isCurrent,
  pending,
  send,
  commitPending,
  handleSendError,
  fetchSnapshot,
  commitSnapshot,
}: {
  isCurrent: () => boolean;
  pending: () => readonly Session[];
  send: (session: Session) => Promise<Response>;
  commitPending: (session: Session, response: Response) => boolean;
  handleSendError: (
    session: Session,
    error: unknown,
  ) => OwnerHistorySyncErrorAction | undefined | Promise<OwnerHistorySyncErrorAction | undefined>;
  fetchSnapshot: () => Promise<Response>;
  commitSnapshot: (response: Response) => boolean;
}): Promise<void> {
  while (isCurrent()) {
    const session = pending()[0];
    if (!session) break;

    let response: Response;
    try {
      response = await send(session);
    } catch (error) {
      if (!isCurrent()) return;
      const action = await handleSendError(session, error);
      if (!isCurrent() || action === "stop") return;
      if (action === "continue") continue;
      throw error;
    }

    if (!isCurrent() || !commitPending(session, response)) return;
  }

  if (!isCurrent()) return;
  const response = await fetchSnapshot();
  if (!isCurrent()) return;
  commitSnapshot(response);
}
export const emptySaved = (): Saved => ({
  active: null,
  pending: [],
  snapshot: null,
  local: emptyWorld(),
  notes: {},
  materials: {},
  sources: {},
  guestPublished: [],
  quizDrafts: {},
});
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const texts = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
const correctionFlagKeys = ["goal", "topic", "targetSeconds", "elapsedSeconds", "actualStudySeconds",
  "focusedSeconds", "actualBreakSeconds", "distractions", "quizResult"] as const;
function validEffectiveMetrics(value: unknown) {
  return record(value) && [value.targetSeconds, value.elapsedSeconds, value.actualStudySeconds,
    value.focusedSeconds, value.plannedBreakSeconds, value.actualBreakSeconds, value.distractions].every(number) &&
    typeof value.completed === "boolean" &&
    ((value.quizScore === null && value.quizTotal === null) ||
      (count(value.quizScore) && count(value.quizTotal) && Number(value.quizTotal) >= 1 &&
        Number(value.quizScore) <= Number(value.quizTotal)));
}
function validCorrectionFlags(value: unknown) {
  return record(value) && Object.keys(value).length === correctionFlagKeys.length &&
    correctionFlagKeys.every((key) => typeof value[key] === "boolean");
}
const validRemovedSessionIds = (value: unknown) => Array.isArray(value) &&
  value.every((id) => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
function validMaterialSummaries(value: unknown): value is Saved["materialSummaries"] {
  if (!record(value)) return false;
  let entryCount = 0;
  for (const [sessionId, sources] of Object.entries(value)) {
    if (!sessionId || sessionId.length > 200 || !record(sources)) return false;
    for (const [sourceId, entry] of Object.entries(sources)) {
      entryCount++;
      if (entryCount > MAX_MATERIAL_SUMMARY_CACHE_ENTRIES || !sourceId || sourceId.length > 200 ||
          !record(entry) || typeof entry.sourceFingerprint !== "string" ||
          Object.keys(entry).length !== 3 ||
          !["sourceFingerprint", "summary", "generatedAt"].every((key) => key in entry) ||
          !/^[0-9a-f]{64}$/u.test(entry.sourceFingerprint) ||
          typeof entry.summary !== "string" || entry.summary.trim().length === 0 ||
          entry.summary.length > MAX_MATERIAL_SUMMARY_LENGTH ||
          !Number.isSafeInteger(entry.generatedAt) || Number(entry.generatedAt) < 0) return false;
    }
  }
  return true;
}
function validMaterialSummaryCacheEntry(value: unknown): value is MaterialSummaryCacheEntry {
  return validMaterialSummaries({ session: { source: value } });
}
export function cacheMaterialSummary(
  saved: Saved,
  sessionId: string,
  sourceId: string,
  entry: MaterialSummaryCacheEntry,
): Saved {
  if (!sessionId || sessionId.length > 200 || !sourceId || sourceId.length > 200 ||
      !validMaterialSummaryCacheEntry(entry)) throw new Error("Invalid private material summary cache entry.");
  const materialSummaries = Object.fromEntries(Object.entries(saved.materialSummaries ?? {})
    .map(([cachedSessionId, sources]) => [cachedSessionId, { ...sources }])) as NonNullable<Saved["materialSummaries"]>;
  materialSummaries[sessionId] = { ...materialSummaries[sessionId], [sourceId]: entry };
  const oldestFirst = Object.entries(materialSummaries).flatMap(([cachedSessionId, sources]) =>
    Object.entries(sources).map(([cachedSourceId, cachedEntry]) => ({
      sessionId: cachedSessionId, sourceId: cachedSourceId, generatedAt: cachedEntry.generatedAt,
    }))).sort((left, right) => left.generatedAt - right.generatedAt);
  while (oldestFirst.length > MAX_MATERIAL_SUMMARY_CACHE_ENTRIES) {
    const oldest = oldestFirst.shift()!;
    delete materialSummaries[oldest.sessionId][oldest.sourceId];
    if (Object.keys(materialSummaries[oldest.sessionId]).length === 0)
      delete materialSummaries[oldest.sessionId];
  }
  return { ...saved, materialSummaries };
}
export function removeMaterialSummaryCacheEntry(saved: Saved, sessionId: string, sourceId: string): Saved {
  const materialSummaries = { ...saved.materialSummaries };
  if (!materialSummaries[sessionId]?.[sourceId]) return saved;
  materialSummaries[sessionId] = { ...materialSummaries[sessionId] };
  delete materialSummaries[sessionId][sourceId];
  if (Object.keys(materialSummaries[sessionId]).length === 0) delete materialSummaries[sessionId];
  return { ...saved, materialSummaries };
}
const validMaterials = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 10 &&
  v.every((file) => record(file) && number(file.size) && (file.sourceId === undefined || typeof file.sourceId === "string") &&
    [file.name, file.type, file.status, file.message].every((field) => typeof field === "string")));
function validJourney(v: unknown) {
  return record(v) && [v.seconds, v.station, v.threshold, v.remaining].every(number) &&
    (v.branch === "mountain" || v.branch === "coast") && record(v.votes) &&
    (v.voteUntil === null || number(v.voteUntil)) && Array.isArray(v.journal) &&
    v.journal.every((item) => record(item) && number(item.at) && typeof item.text === "string");
}
function validPerson(v: unknown) {
  return record(v) && typeof v.name === "string" && typeof v.color === "string" &&
    typeof v.decor === "string" && number(v.seconds) && validJourney(v.journey);
}
function validSegments(v: unknown) {
  return Array.isArray(v) && v.every((s) => record(s) && number(s.start) &&
    number(s.end) && Number(s.end) > Number(s.start) &&
    ["focus", "material", "break", "distraction"].includes(String(s.kind)));
}
function validSession(v: unknown) {
  return record(v) && typeof v.id === "string" && typeof v.userId === "string" &&
    typeof v.goal === "string" && typeof v.topic === "string" &&
    (v.breakPlan === undefined || isValidBreakPlan(v.breakPlan,v.target)) &&
    (v.deviceCategory === undefined || isDeviceCategory(v.deviceCategory)) &&
    (v.distractions === undefined || count(v.distractions)) &&
    (v.quiz === undefined || isValidQuizAssessment(v.quiz)) &&
    (v.correctionVersion === undefined || count(v.correctionVersion)) &&
    (v.effectiveMetrics === undefined || validEffectiveMetrics(v.effectiveMetrics)) &&
    (v.correctionFlags === undefined || validCorrectionFlags(v.correctionFlags)) &&
    [v.started, v.ended, v.target, v.seconds, v.contribution].every(number) && validSegments(v.segments);
}
function validSaved(v: unknown): v is Saved {
  if (!record(v) || !record(v.local) || !record(v.notes) ||
      (v.sources !== undefined && (!record(v.sources) || !Object.values(v.sources).every(validMaterialSources))) ||
      (v.materials !== undefined && (!record(v.materials) || !Object.values(v.materials).every(validMaterials))) ||
      (v.guestPublished !== undefined && (!Array.isArray(v.guestPublished) ||
        !v.guestPublished.every((id) => typeof id === "string" && id.length > 0) ||
        new Set(v.guestPublished).size !== v.guestPublished.length)) ||
      (v.removedSessionIds !== undefined && !validRemovedSessionIds(v.removedSessionIds)) ||
      (v.quizDrafts !== undefined && !isValidQuizDraftMap(v.quizDrafts)) ||
      (v.materialSummaries !== undefined && !validMaterialSummaries(v.materialSummaries)) ||
      (v.summarySessionId !== undefined &&
        (typeof v.summarySessionId !== "string" || v.summarySessionId.length === 0)) ||
      !Object.values(v.notes).every((note) => typeof note === "string") ||
      !Array.isArray(v.pending) || !v.pending.every(validSession)) return false;
  const w = v.local;
  if (![w.people, w.groups, w.sessions, w.invites].every(record) ||
      !Object.values(w.people as Record<string, unknown>).every(validPerson) ||
      !Object.values(w.sessions as Record<string, unknown>).every(validSession)) return false;
  if (v.active !== null) {
    const a = v.active;
    if (!record(a) || ![a.started, a.lastAt, a.target, a.reconnect].every(number) ||
        Number(a.target) <= 0 || ![a.id, a.owner, a.goal, a.topic, a.document].every((s) => typeof s === "string") ||
        !["focus", "away", "reconnecting", "paused", "pending"].includes(String(a.state)) ||
        (a.deviceCategory !== undefined && !isDeviceCategory(a.deviceCategory)) ||
        (a.distractions !== undefined && !count(a.distractions)) ||
        (a.breakPlan !== undefined && !isValidBreakPlan(a.breakPlan,a.target)) ||
        (a.awayCounted !== undefined && typeof a.awayCounted !== "boolean") ||
        (a.sources !== undefined && !validMaterialSources(a.sources)) ||
        !validSegments(a.segments) || !validMaterials(a.materials)) return false;
  }
  if (v.snapshot !== null) {
    const s = v.snapshot;
    if (!record(s) || !validPerson(s.person) || !Array.isArray(s.sessions) || !s.sessions.every(validSession) ||
        (s.removedSessionIds !== undefined && !validRemovedSessionIds(s.removedSessionIds))) return false;
    if (s.group !== null && (!record(s.group) || !validJourney(s.group.journey) ||
        !Array.isArray(s.group.members) || !s.group.members.every((m) => record(m) &&
          [m.id, m.name, m.color, m.decor].every((x) => typeof x === "string")))) return false;
  }
  return Object.values(w.groups as Record<string, unknown>).every((g) => record(g) && validJourney(g.journey) && texts(g.members));
}

function uniqueIds(...values: (readonly string[] | undefined)[]): string[] {
  return [...new Set(values.flatMap((ids) => ids ?? []))];
}

/** Remember tombstones locally and remove only history/queue records, not session materials. */
export function suppressRemovedSessions(saved: Saved, sessionIds: readonly string[]): Saved {
  const removedSessionIds = uniqueIds(saved.removedSessionIds, saved.snapshot?.removedSessionIds, sessionIds);
  const removed = new Set(removedSessionIds);
  const localSessions = Object.fromEntries(Object.entries(saved.local.sessions)
    .filter(([key, session]) => !removed.has(key) && !removed.has(session.id)));
  const quizDrafts = { ...saved.quizDrafts };
  for (const id of removed) delete quizDrafts[id];
  const materialSummaries = saved.materialSummaries
    ? Object.fromEntries(Object.entries(saved.materialSummaries).filter(([sessionId]) => !removed.has(sessionId)))
    : undefined;
  const snapshot = saved.snapshot
    ? {
        ...saved.snapshot,
        sessions: saved.snapshot.sessions.filter((session) => !removed.has(session.id)),
        removedSessionIds,
      }
    : null;
  return {
    ...saved,
    pending: saved.pending.filter((session) => !removed.has(session.id)),
    local: { ...saved.local, sessions: localSessions },
    snapshot,
    removedSessionIds,
    quizDrafts,
    ...(materialSummaries === undefined ? {} : { materialSummaries }),
    ...(saved.summarySessionId && removed.has(saved.summarySessionId) ? { summarySessionId: undefined } : {}),
  };
}

/** Apply an authoritative owner snapshot, preferring it over local pending duplicates. */
export function reconcileOwnerSnapshot(saved: Saved, snapshot: Snapshot): Saved {
  const withTombstones = suppressRemovedSessions(saved, snapshot.removedSessionIds ?? []);
  const removed = new Set(withTombstones.removedSessionIds ?? []);
  const sessions = snapshot.sessions.filter((session) => !removed.has(session.id));
  const authoritativeIds = new Set(sessions.map((session) => session.id));
  return {
    ...withTombstones,
    snapshot: { ...snapshot, sessions, removedSessionIds: [...removed] },
    pending: withTombstones.pending.filter((session) => !authoritativeIds.has(session.id)),
  };
}

/** Owner snapshot rows come first so a corrected server projection beats a pending copy. */
export function historySessions(saved: Saved, ownerId: string): SessionHistoryEntry[] {
  const removed = new Set(uniqueIds(saved.removedSessionIds, saved.snapshot?.removedSessionIds));
  const byId = new Map<string, SessionHistoryEntry>();
  for (const session of saved.snapshot?.sessions ?? []) {
    if (session.userId === ownerId && !removed.has(session.id) && !byId.has(session.id))
      byId.set(session.id, session);
  }
  for (const session of saved.pending) {
    if (session.userId === ownerId && !removed.has(session.id) && !byId.has(session.id))
      byId.set(session.id, session);
  }
  return [...byId.values()];
}
export function readSaved(owner: string): Saved {
  const raw = localStorage.getItem(`train-adventure:v1:${owner}`);
  if (!raw) return emptySaved();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  if (!validSaved(value))
    throw new Error(
      "Dữ liệu đã lưu không hợp lệ. Hãy xuất bản sao trước khi xóa dữ liệu trình duyệt.",
    );
  return value;
}
export function writeSaved(owner: string, value: Saved) {
  localStorage.setItem(`train-adventure:v1:${owner}`, JSON.stringify(value));
}
