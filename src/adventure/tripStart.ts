export async function startAfterTripReservation<Reservation>(input: {
  sessionId: string;
  reserve: (sessionId: string) => Promise<Reservation>;
  isCurrent: () => boolean;
  start: (reservation: Reservation, started: number) => void;
  now?: () => number;
}): Promise<boolean> {
  const reservation = await input.reserve(input.sessionId);
  if (!input.isCurrent()) return false;
  input.start(reservation, (input.now ?? Date.now)());
  return true;
}

export function isTripStartCurrent(input: {
  expectedOwnerId: string;
  ownerId: string;
  workspaceLive: boolean;
  exclusiveLease: boolean;
  activeSessionId: string | null;
  expectedSessionId: string;
  draftSessionId: string;
  expectedAuthGeneration: number;
  authGeneration: number;
  authenticatedUserId?: string;
  needsLogin: boolean;
  currentView: string;
}): boolean {
  return input.expectedOwnerId === input.ownerId && input.workspaceLive && input.exclusiveLease &&
    input.activeSessionId === null && input.expectedSessionId === input.draftSessionId &&
    input.expectedAuthGeneration === input.authGeneration &&
    input.authenticatedUserId === input.expectedOwnerId && !input.needsLogin &&
    input.currentView === "ticket";
}

export function recoverBoundTripSessionId(input: {
  ownSessionId?: string;
  activeSessionId?: string | null;
  pendingSessionIds: readonly string[];
  savedSessionIds: readonly string[];
}): string | null {
  const sessionId = input.ownSessionId;
  if (!sessionId || input.activeSessionId ||
      input.pendingSessionIds.includes(sessionId) || input.savedSessionIds.includes(sessionId))
    return null;
  return sessionId;
}

export type TripDraftSessionIds = {
  solo: string;
  groups: Map<string, string>;
};

export function groupDraftSessionId(
  sessions: TripDraftSessionIds,
  groupId: string,
  reservationId?: string,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const id = reservationId ?? sessions.groups.get(groupId) ?? createId();
  sessions.groups.set(groupId, id);
  return id;
}

export function rotateDraftSessionId(
  sessions: TripDraftSessionIds,
  mode: "solo" | "group",
  groupId: string | null,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const id = createId();
  if (mode === "solo") sessions.solo = id;
  else if (groupId) sessions.groups.set(groupId, id);
  else throw new Error("A shared trip draft needs a group ID.");
  return id;
}
