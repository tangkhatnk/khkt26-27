import type { Snapshot } from "../../backend/src/adventure/domain.ts";

type GroupSnapshot = NonNullable<Snapshot["group"]>;
type TripSnapshot = NonNullable<GroupSnapshot["trip"]>;
type SynchronizedTripSnapshot = Extract<TripSnapshot, { mode: "synchronized" }>;

export function isSynchronizedTrip(
  trip: TripSnapshot | null | undefined,
): trip is SynchronizedTripSnapshot {
  return Boolean(trip && "mode" in trip && trip.mode === "synchronized");
}

/** State gates shared by the lobby and the private trip ticket. */
export function synchronizedTripControls(
  group: GroupSnapshot | null,
  userId: string | undefined,
  serverClockSupported = true,
) {
  const trip = group?.trip;
  if (!group || !isSynchronizedTrip(trip))
    return { ownStatus: undefined, canLaunch: false, canPrepare: false, canUnready: false, canResume: false, privateDraftLocked: true };

  const ownStatus = group.members.find((member) => member.id === userId)?.tripStatus;
  const allJoinedReady = group.members.length >= 2 && group.members.length <= 6 &&
    group.members.every((member) => member.tripStatus === "ready");
  return {
    ownStatus,
    canLaunch: serverClockSupported && group.owner === userId && trip.status === "waiting" && allJoinedReady,
    canPrepare: trip.status === "waiting" && ownStatus === "not-ready",
    canUnready: trip.status === "waiting" && ownStatus === "ready",
    canResume: serverClockSupported && trip.status === "departed" && ownStatus === "bound",
    privateDraftLocked: trip.status !== "waiting" || ownStatus !== "not-ready",
  };
}

/** Do not create a bound local session from a background poll or an incomplete local history. */
export function shouldAutoResumeSynchronizedTrip(input: {
  mode?: string;
  tripStatus?: string;
  ownStatus?: string;
  ownSessionId?: string;
  clockSupported: boolean;
  foreground: boolean;
  activeSessionId?: string | null;
  pendingSessionIds?: readonly string[];
  savedSessionIds?: readonly string[];
  inFlight?: boolean;
}): boolean {
  const sessionId = input.ownSessionId;
  return input.mode === "synchronized" && input.tripStatus === "departed" &&
    input.ownStatus === "bound" && Boolean(sessionId) && input.clockSupported && input.foreground &&
    !input.activeSessionId && !input.inFlight &&
    !input.pendingSessionIds?.includes(sessionId!) && !input.savedSessionIds?.includes(sessionId!);
}
