import { Profiler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TopDownMap } from "../../src/adventure/TopDownMap";
import { TopDownScene } from "../../src/adventure/TopDownScene";
import type { SceneSessionTiming } from "../../src/adventure/TopDownScene";
import "../../src/adventure/theme.css";
import "../../src/adventure/adventure.css";

type Profile = {
  commits: number;
  actualMs: number;
  baseMs: number;
};

const cars = [{ id: "guest", name: "Toa Mây", color: "#398575" }];

function useProfileReporter() {
  const profiles = useRef<Record<string, Profile>>({});
  return useCallback((id: string, _phase: string, actualDuration: number, baseDuration: number) => {
    const current = profiles.current[id] ?? { commits: 0, actualMs: 0, baseMs: 0 };
    profiles.current[id] = {
      commits: current.commits + 1,
      actualMs: current.actualMs + actualDuration,
      baseMs: current.baseMs + baseDuration,
    };
    const report = document.getElementById(`${id}-profile`);
    if (report) {
      const profile = profiles.current[id];
      report.textContent = `${profile.commits} commits · ${profile.actualMs.toFixed(1)} ms actual · ${profile.baseMs.toFixed(1)} ms base`;
    }
  }, []);
}

function OverviewProbe({ onRender }: { onRender: (id: string, phase: string, actual: number, base: number) => void }) {
  const [goal, setGoal] = useState("");
  const carriages = useMemo(() => cars, []);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2>Home goal typing</h2>
      <p>Type a sentence below. The goal stays immediate while the overview map should do almost no rendering work.</p>
      <label style={{ display: "grid", gap: 8 }}>
        Learning goal
        <textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <p>Latest goal: <strong>{goal}</strong></p>
      <p id="overview-profile" aria-live="polite">Waiting for first render…</p>
      <Profiler id="overview" onRender={onRender}>
        <TopDownMap journey={undefined} carriages={carriages} ownId="guest" />
      </Profiler>
    </section>
  );
}

function ActiveSceneProbe({ onRender }: { onRender: (id: string, phase: string, actual: number, base: number) => void }) {
  const [elapsedStudySeconds, setElapsedStudySeconds] = useState(1);
  useEffect(() => {
    const interval = window.setInterval(() => setElapsedStudySeconds((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const sessionTiming = useMemo<SceneSessionTiming>(() => ({
    elapsedSeconds: elapsedStudySeconds,
    remainingSeconds: 1500 - elapsedStudySeconds,
    elapsedStudySeconds,
    targetStudySeconds: 1500,
    restAnchors: [],
  }), [elapsedStudySeconds]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2>Active journey scene</h2>
      <p>Elapsed study time advances once a second. Camera timing stays at one second; compare scene actual duration per update.</p>
      <p>Elapsed: {elapsedStudySeconds}s</p>
      <p id="active-profile" aria-live="polite">Waiting for first render…</p>
      <Profiler id="active" onRender={onRender}>
        <TopDownScene
          carriages={cars}
          ownId="guest"
          running
          fogStrength={0}
          sessionTiming={sessionTiming}
        />
      </Profiler>
    </section>
  );
}

function Harness() {
  const onRender = useProfileReporter();
  return (
    <main className="adventure" style={{ padding: 24, display: "grid", gap: 24 }}>
      <header>
        <h1>Viễn Du render profile</h1>
        <p>Compare actual duration while typing and while the clock advances. Profiler callback counts can include parent commits even when a memoized child skips its work.</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 480px), 1fr))", gap: 20 }}>
        <OverviewProbe onRender={onRender} />
        <ActiveSceneProbe onRender={onRender} />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
