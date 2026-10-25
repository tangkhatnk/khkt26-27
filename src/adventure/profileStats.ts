import type { SessionMetrics } from "../../backend/src/adventure/domain.ts";

export type ProfileStudySummary = {
  id: string;
  goal: string;
  topic: string;
  studiedAt: number;
  focusedSeconds: number;
};

export type ProfileSessionRecord = {
  id: string;
  userId: string;
  goal: string;
  topic: string;
  ended: number;
  seconds: number;
  effectiveMetrics?: Pick<SessionMetrics, "focusedSeconds">;
};

export type ProfileStats = {
  sessionCount: number;
  focusedSeconds: number;
  recentStudies: ProfileStudySummary[];
};

/** Builds a current-owner summary, preferring saved snapshot rows over pending duplicates. */
export function profileStats(
  ownerId: string,
  snapshotSessions: readonly ProfileSessionRecord[],
  pendingSessions: readonly ProfileSessionRecord[],
  removedSessionIds: readonly string[] = [],
): ProfileStats {
  const byId = new Map<string, ProfileSessionRecord>();
  const removed = new Set(removedSessionIds);
  for (const session of [...snapshotSessions, ...pendingSessions]) {
    if (session.userId !== ownerId || removed.has(session.id) || byId.has(session.id)) continue;
    byId.set(session.id, session);
  }

  const ownSessions = [...byId.values()];
  const focusedSeconds = ownSessions.reduce((total, session) => {
    const measured = session.effectiveMetrics?.focusedSeconds ?? session.seconds;
    const seconds = Number.isFinite(measured) ? Math.max(0, measured) : 0;
    return total + seconds;
  }, 0);
  const recentStudies = ownSessions
    .sort((first, second) => second.ended - first.ended)
    .slice(0, 4)
    .map((session) => ({
      id: session.id,
      goal: session.goal,
      topic: session.topic,
      studiedAt: session.ended,
      focusedSeconds: session.effectiveMetrics?.focusedSeconds ?? session.seconds,
    }));

  return { sessionCount: ownSessions.length, focusedSeconds, recentStudies };
}
