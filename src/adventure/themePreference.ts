export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "viendu-display-theme";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

type ThemeEventTarget = Pick<Window, "addEventListener" | "removeEventListener">;
type ThemeMediaQueryList = Pick<MediaQueryList, "matches"> & Partial<Pick<
  MediaQueryList,
  "addEventListener" | "removeEventListener" | "addListener" | "removeListener"
>>;

export function parseThemePreference(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function resolveThemePreference(preference: Theme | null, system: Theme): Theme {
  return preference ?? system;
}

export function readThemePreference(storage?: ThemeStorage | null): Theme | null {
  try {
    const source = storage ?? globalThis.localStorage;
    return parseThemePreference(source.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeThemePreference(theme: Theme, storage?: ThemeStorage | null): boolean {
  try {
    const destination = storage ?? globalThis.localStorage;
    destination.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function subscribeThemePreferenceEvents(
  target: ThemeEventTarget,
  media: ThemeMediaQueryList | null,
  onSystemChange: (event: MediaQueryListEvent) => void,
  onStorage: (event: StorageEvent) => void,
): () => void {
  let unsubscribeMedia: (() => void) | undefined;

  if (media && typeof media.addEventListener === "function" && typeof media.removeEventListener === "function") {
    try {
      media.addEventListener("change", onSystemChange);
      unsubscribeMedia = () => media.removeEventListener?.("change", onSystemChange);
    } catch {
      // Older browsers may expose a partial modern API; try the legacy listener below.
    }
  }

  if (!unsubscribeMedia && media && typeof media.addListener === "function" && typeof media.removeListener === "function") {
    try {
      media.addListener(onSystemChange);
      unsubscribeMedia = () => media.removeListener?.(onSystemChange);
    } catch {
      // System color changes are optional; storage preference updates still work.
    }
  }

  target.addEventListener("storage", onStorage);
  return () => {
    try {
      unsubscribeMedia?.();
    } finally {
      target.removeEventListener("storage", onStorage);
    }
  };
}
