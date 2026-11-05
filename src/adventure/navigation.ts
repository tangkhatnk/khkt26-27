import { useSyncExternalStore } from "react";

export function isStudyWorkspaceView(view: string): boolean {
  return view === "station" || view === "ticket";
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

// Only URL state changes; the workspace stays mounted so active trips and
// unsaved ticket fields survive navigation, including browser Back/Forward.
export function useBrowserView(): [string, (view: string) => void] {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  const view = new URLSearchParams(search).get("view") ?? "station";
  return [view, (next) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (url.href === window.location.href) return;
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }];
}
