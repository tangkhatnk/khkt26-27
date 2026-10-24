import type { Journey } from "../../backend/src/adventure/domain";
import { TopDownMap } from "./TopDownMap";
import { TopDownScene } from "./TopDownScene";
import type { SceneSessionTiming } from "./TopDownScene";
import type { ActiveTrip } from "./focus";
import { journeyExplorationFraction, sceneryShouldMove } from "./exploration";

export function JourneyView({
  journey,
  carriages,
  ownId,
  fog = false,
  draftSeconds = 0,
  focusState,
  reconnect = 0,
  targetSeconds,
  restStop,
  upcomingRestStop,
  sessionTiming,
  motionAllowed,
}: {
  journey?: Journey;
  carriages: { id: string; name: string; color: string }[];
  ownId: string;
  fog?: boolean;
  draftSeconds?: number;
  focusState?: ActiveTrip["state"] | "break";
  reconnect?: number;
  targetSeconds?: number;
  restStop?: { index: number; count: number } | null;
  upcomingRestStop?: { index: number; count: number; remainingSeconds: number } | null;
  sessionTiming?: SceneSessionTiming;
  motionAllowed?: boolean;
}) {
  const exploration = journeyExplorationFraction(
    journey,
    draftSeconds,
    targetSeconds,
  );
  const running = sceneryShouldMove(focusState);
  const coast = journey?.branch === "coast";
  return (
    <div className="journey-view">
      {focusState ? (
        <TopDownScene
          carriages={carriages}
          ownId={ownId}
          running={running}
          fogStrength={fog ? 1 : Math.min(1, Math.max(0, reconnect / 120))}
          exploration={exploration}
          coast={coast}
          restStop={restStop}
          upcomingRestStop={upcomingRestStop}
          sessionTiming={sessionTiming}
          motionAllowed={motionAllowed}
        />
      ) : (
        <TopDownMap
          journey={journey}
          carriages={carriages}
          ownId={ownId}
          draftSeconds={draftSeconds}
          targetSeconds={targetSeconds}
        />
      )}
    </div>
  );
}
