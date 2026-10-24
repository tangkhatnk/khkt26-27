import type { Saved } from "./storage.ts";
import type { Session } from "../../backend/src/adventure/domain.ts";
import { permanentGuestFailure, publishGuestSessions } from "./guestPublication.ts";

/** Flush guest history without adopting guest progress into a signed-in account. */
export async function syncGuestBacklog({ withGuestLock, read, write, isCurrent, send }: {
  withGuestLock: <T>(action: () => T) => Promise<T | undefined>;
  read: () => Saved;
  write: (value: Saved) => void;
  isCurrent: () => boolean;
  send: (session: Session) => Promise<{ tripCode: string }>;
}) {
  const saved = await withGuestLock(() => isCurrent() ? read() : undefined);
  if (!saved || !isCurrent()) return;
  await publishGuestSessions({
    sessions: Object.values(saved.local.sessions).filter(session => session.userId === "guest"),
    publishedIds: saved.guestPublished ?? [], isCurrent, send,
    continueAfterFailure: permanentGuestFailure,
    markPublished: async sessionId => Boolean(await withGuestLock(() => {
      if (!isCurrent()) return false;
      const fresh = read();
      write({ ...fresh, guestPublished: [...new Set([...(fresh.guestPublished ?? []), sessionId])] });
      return true;
    })),
    onStatus: () => {},
  });
}
