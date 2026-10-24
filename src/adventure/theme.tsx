import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  readThemePreference,
  resolveThemePreference,
  subscribeThemePreferenceEvents,
  THEME_STORAGE_KEY,
  writeThemePreference,
  type Theme,
} from "./themePreference";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function bootstrapThemePreference(): void {
  const preference = readThemePreference();
  applyTheme(resolveThemePreference(preference, systemTheme()));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState(() => {
    const preference = readThemePreference();
    return { preference, theme: resolveThemePreference(preference, systemTheme()) };
  });

  useEffect(() => {
    applyTheme(current.theme);
  }, [current.theme]);

  useEffect(() => {
    let media: MediaQueryList | null = null;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch { /* Keep storage synchronization available when matchMedia is missing. */ }

    const currentSystemTheme = () => media ? (media.matches ? "dark" : "light") : systemTheme();

    const followSystem = () => {
      const system = currentSystemTheme();
      setCurrent((value) => value.preference === null ? { ...value, theme: system } : value);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const preference = event.key === null ? null : event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
      setCurrent({ preference, theme: resolveThemePreference(preference, currentSystemTheme()) });
    };

    return subscribeThemePreferenceEvents(window, media, followSystem, onStorage);
  }, []);

  const setTheme = (theme: Theme) => {
    writeThemePreference(theme);
    setCurrent({ preference: theme, theme });
  };
  const toggleTheme = () => setTheme(current.theme === "dark" ? "light" : "dark");

  return <ThemeContext.Provider value={{ theme: current.theme, setTheme, toggleTheme }}>
    {children}
  </ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = nextTheme === "dark" ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng";

  return <button
    className="theme-toggle"
    type="button"
    onClick={toggleTheme}
    aria-label={label}
    aria-pressed={theme === "dark"}
    title={label}
  >
    <span className="theme-toggle__icon" aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    <span>{theme === "dark" ? "Sáng" : "Tối"}</span>
  </button>;
}

export { THEME_STORAGE_KEY } from "./themePreference";
export type { Theme } from "./themePreference";
