import { useEffect } from "react";
import { post } from "../services/api";
import { readSaved, writeSaved } from "./storage";
import { syncGuestBacklog } from "./guestBacklog";

export function GuestHistorySync({ accountId }: { accountId?: string }) {
  useEffect(() => {
    if (!accountId || !navigator.locks) return;
    let cancelled = false, running = false;
    const isCurrent = () => !cancelled && navigator.onLine;
    const flush = async () => {
      if (running || !isCurrent()) return;
      running = true;
      try {
        await syncGuestBacklog({
          withGuestLock: action => navigator.locks.request("train-adventure:guest", { ifAvailable: true },
            lock => lock ? action() : undefined),
          read: () => readSaved("guest"), write: value => writeSaved("guest", value), isCurrent,
          send: session => post<{ tripCode: string }>("/adventure/guest-sessions", session, false),
        });
      } catch { /* Preserve the queue on network or local-storage failure. */ }
      finally { running = false; }
    };
    void flush();
    const retry = () => { void flush(); };
    const interval = setInterval(retry, 60000);
    window.addEventListener("online", retry);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener("online", retry); };
  }, [accountId]);
  return null;
}
