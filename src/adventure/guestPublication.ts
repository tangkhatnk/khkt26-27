export type GuestPublicationStatus = {
  sessionId: string;
  status: "sending" | "published" | "failed" | "save-failed" | "removed" | "suppression-failed";
  tripCode?: string;
  message?: string;
};

/** Keep removed and failed-suppression explanations available outside the trip summary. */
export function guestPublicationNotice(status: GuestPublicationStatus): string | null {
  if (status.status === "removed")
    return status.message ?? "Phiên này đã được gỡ khỏi lịch sử máy chủ; thiết bị đã ngừng gửi lại.";
  if (status.status === "suppression-failed")
    return status.message ?? "Máy chủ đã gỡ chuyến này nhưng thiết bị chưa lưu trạng thái. Hãy thử lại.";
  return null;
}

type GuestPublishAcknowledgement = { tripCode: string };

export async function publishGuestSessions<
  Session extends { id: string },
  Acknowledgement extends GuestPublishAcknowledgement,
>({
  sessions,
  publishedIds,
  removedIds = [],
  isCurrent,
  send,
  markPublished,
  markRemoved = () => false,
  onStatus,
  continueAfterFailure = () => false,
}: {
  sessions: Session[];
  publishedIds: readonly string[];
  removedIds?: readonly string[];
  isCurrent: () => boolean;
  send: (session: Session) => Promise<Acknowledgement>;
  markPublished: (
    sessionId: string,
    acknowledgement: Acknowledgement,
  ) => boolean | Promise<boolean>;
  markRemoved?: (sessionId: string) => boolean | Promise<boolean>;
  onStatus: (status: GuestPublicationStatus) => void;
  continueAfterFailure?: (error: unknown) => boolean;
}): Promise<void> {
  const published = new Set(publishedIds);
  const removed = new Set(removedIds);

  for (const session of sessions) {
    if (published.has(session.id) || removed.has(session.id)) continue;
    if (!isCurrent()) return;

    onStatus({ sessionId: session.id, status: "sending" });
    let acknowledgement: Acknowledgement;
    try {
      acknowledgement = await send(session);
    } catch (error) {
      if (isRemovedSession(error)) {
        let suppressed = false;
        try {
          if (isCurrent()) suppressed = await markRemoved(session.id);
        } catch {
          suppressed = false;
        }
        if (!isCurrent()) return;
        if (!suppressed) {
          onStatus({
            sessionId: session.id,
            status: "suppression-failed",
            message: "Máy chủ đã gỡ chuyến này nhưng thiết bị chưa lưu trạng thái. Hãy thử lại.",
          });
          return;
        }
        removed.add(session.id);
        onStatus({
          sessionId: session.id,
          status: "removed",
          message: "Phiên này đã được gỡ khỏi lịch sử máy chủ; thiết bị đã ngừng gửi lại.",
        });
        continue;
      }
      if (isCurrent()) {
        onStatus({
          sessionId: session.id,
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Chưa gửi được chuyến đi.",
        });
      }
      if (isCurrent() && continueAfterFailure(error)) continue;
      return;
    }

    if (!isCurrent()) return;

    let committed = false;
    try {
      committed = await markPublished(session.id, acknowledgement);
    } catch {
      committed = false;
    }
    if (!isCurrent()) return;
    if (!committed) {
      onStatus({
        sessionId: session.id,
        status: "save-failed",
        tripCode: acknowledgement.tripCode,
      });
      return;
    }

    published.add(session.id);
    onStatus({
      sessionId: session.id,
      status: "published",
      tripCode: acknowledgement.tripCode,
    });
  }
}

function isRemovedSession(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    Number(error.status) === 410;
}

export function permanentGuestFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    [400, 409, 413].includes(Number(error.status));
}
