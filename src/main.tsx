import { createRoot } from "react-dom/client";
import AdventureApp from "./adventure/AdventureApp";
import { bootstrapThemePreference, ThemeProvider } from "./adventure/theme";
import "./adventure/theme.css";

bootstrapThemePreference();

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD &&
      (location.protocol === "https:" || location.hostname === "localhost")) {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // The local workspace still works when service workers are unavailable.
    });
  } else if (import.meta.env.DEV) {
    // Retire our production shell on this dev origin. Otherwise an old cached
    // bundle can intercept Vite requests and keep opening the previous app.
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      const own = registrations.filter((registration) =>
        [registration.active, registration.waiting, registration.installing]
          .some((worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js"));
      await Promise.all(own.map((registration) => registration.unregister()));
      if (navigator.serviceWorker.controller && own.length > 0) location.reload();
    }).catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider><AdventureApp /></ThemeProvider>,
);
