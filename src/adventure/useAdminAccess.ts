import { useCallback, useEffect, useState } from "react";
import { request } from "../services/api";

/** Capability only controls presentation; each admin API request checks authority again. */
export function useAdminAccess(owner: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; allowed: boolean } | null>(null);
  const key = `${owner}:${enabled}:${attempt}`;
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!enabled || owner === "guest") return;
    const controller = new AbortController();
    void request<{ allowed: boolean }>("/admin/access", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setResult({ key, allowed: value.allowed === true });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, allowed: false });
    });
    return () => {
      controller.abort();
      // An offline/login interruption must not restore an earlier capability.
      setResult(null);
    };
  }, [key, owner, enabled]);
  return {
    allowed: enabled && result?.key === key && result.allowed,
    checking: enabled && result?.key !== key,
    refresh,
  };
}
