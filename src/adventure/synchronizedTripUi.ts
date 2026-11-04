import type { Snapshot } from "../../backend/src/adventure/domain.ts";
import { canStartSessionWithQuizReview, isQuizCount } from "./quizDrafts.ts";
import type { SynchronizedTripDraft } from "./storage.ts";

type GroupSnapshot = NonNullable<Snapshot["group"]>;
type TripSnapshot = NonNullable<GroupSnapshot["trip"]>;
type SynchronizedTripSnapshot = Extract<TripSnapshot, { mode: "synchronized" }>;

export function isSynchronizedTrip(
  trip: TripSnapshot | null | undefined,
): trip is SynchronizedTripSnapshot {
  return Boolean(trip && "mode" in trip && trip.mode === "synchronized");
}

export function synchronizedTripDraftForSession(
  drafts: Record<string, SynchronizedTripDraft> | undefined,
  sessionId: string | undefined,
  groupId: string,
): SynchronizedTripDraft | undefined {
  if (!sessionId) return undefined;
  const draft = drafts?.[sessionId];
  return draft?.groupId === groupId && draft.goal.trim().length >= 3 && draft.topic.length > 0
    ? draft
    : undefined;
}

export function synchronizedTripQuizPreferences(draft: Pick<SynchronizedTripDraft, "quizCount" | "skipQuizReview">): {
  quizCount: string;
  skipQuizReview: boolean;
} {
  const skipQuizReview = draft.skipQuizReview ?? false;
  const quizCount = draft.quizCount ?? "3";
  return {
    quizCount: isQuizCount(Number(quizCount)) ? quizCount : "3",
    skipQuizReview,
  };
}

export function tripDraftLocks(
  trip: TripSnapshot | null | undefined,
  synchronizedPrivateInputsLocked: boolean,
): { privateInputsLocked: boolean; sharedPlanLocked: boolean } {
  const synchronized = isSynchronizedTrip(trip);
  return {
    privateInputsLocked: synchronized && synchronizedPrivateInputsLocked,
    sharedPlanLocked: Boolean(trip) && (!synchronized || synchronizedPrivateInputsLocked),
  };
}

export function shouldOfferSynchronizedTripReprepare(input: {
  tripStatus?: string;
  ownStatus?: string;
  localDraftReady: boolean;
}): boolean {
  return input.tripStatus === "waiting" && input.ownStatus === "ready" && !input.localDraftReady;
}

export function canMarkSynchronizedTripReady(input: {
  goal: string;
  quizCount: string;
  skipQuizReview: boolean;
  studyGuideNeedsConfirmation: boolean;
  materialRequestPending: boolean;
  exerciseGenerationPending: boolean;
  loaded: boolean;
  exclusive: boolean;
  hasActiveSession: boolean;
}): boolean {
  return input.goal.trim().length >= 3 && canStartSessionWithQuizReview(input.quizCount, input.skipQuizReview) &&
    !input.studyGuideNeedsConfirmation && !input.materialRequestPending && !input.exerciseGenerationPending &&
    input.loaded && input.exclusive && !input.hasActiveSession;
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
  localDraftReady?: boolean;
  inFlight?: boolean;
}): boolean {
  const sessionId = input.ownSessionId;
  return input.mode === "synchronized" && input.tripStatus === "departed" &&
    input.ownStatus === "bound" && Boolean(sessionId) && input.clockSupported && input.foreground && input.localDraftReady === true &&
    !input.activeSessionId && !input.inFlight &&
    !input.pendingSessionIds?.includes(sessionId!) && !input.savedSessionIds?.includes(sessionId!);
}
