import { useSyncExternalStore } from "react";

export function isStudyWorkspaceView(view: string): boolean {
  return view === "station" || view === "ticket";
}

const supportedViews = new Set([
  "station", "lesson", "map", "carriage", "group", "library", "journal", "experiments",
  "report", "ticket", "focus", "summary", "account", "admin",
]);

export function canonicalStudyView(
  requestedView: string,
  options: { active: boolean; firstUseNeedsWorkspace: boolean },
): string {
  const alias = requestedView === "group" ? "library" : requestedView;
  const route = alias === "lesson" || alias === "ticket"
    ? options.active ? "focus" : "station"
    : supportedViews.has(alias) ? alias : "station";
  return options.firstUseNeedsWorkspace ? "station" : route;
}

/** Correct a bookmark or forced route without adding another Back entry. */
export function replaceBrowserView(next: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("view", next);
  if (url.href === window.location.href) return;
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
