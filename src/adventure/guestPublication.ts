export type GuestPublicationStatus = {
  sessionId: string;
  status: "sending" | "published" | "failed" | "save-failed";
  tripCode?: string;
  message?: string;
};

type GuestPublishAcknowledgement = { tripCode: string };

export async function publishGuestSessions<
  Session extends { id: string },
  Acknowledgement extends GuestPublishAcknowledgement,
>({
  sessions,
  publishedIds,
  isCurrent,
  send,
  markPublished,
  onStatus,
  continueAfterFailure = () => false,
}: {
  sessions: Session[];
  publishedIds: readonly string[];
  isCurrent: () => boolean;
  send: (session: Session) => Promise<Acknowledgement>;
  markPublished: (
    sessionId: string,
    acknowledgement: Acknowledgement,
  ) => boolean | Promise<boolean>;
  onStatus: (status: GuestPublicationStatus) => void;
  continueAfterFailure?: (error: unknown) => boolean;
}): Promise<void> {
  const published = new Set(publishedIds);

  for (const session of sessions) {
    if (published.has(session.id)) continue;
    if (!isCurrent()) return;

    onStatus({ sessionId: session.id, status: "sending" });
    let acknowledgement: Acknowledgement;
    try {
      acknowledgement = await send(session);
    } catch (error) {
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

export function permanentGuestFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    [400, 409, 413].includes(Number(error.status));
}
