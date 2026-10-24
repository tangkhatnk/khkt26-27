import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  SCENE_ENGINE_CENTER_X,
  SCENE_WORLD_LAYER_VIEWPORTS,
  SCENE_WORLD_TILE_WIDTH,
  sceneMotionCanInterpolate,
  sceneMotionDistanceGapCanInterpolate,
  sceneMotionInterpolationOffsets,
  sceneMotionInterpolationDurationMs,
  sceneMotionForStudyElapsed,
  sceneStationScreenX,
  sceneStationWorldX,
  sceneTrainLayout,
  sceneTrainScale,
  sceneViewBoxForZoom,
  sceneWorldLayerOffsetPercent,
  sceneWorldSpeedForSchedule,
} from "./sceneMotion";
import { MapScenery, OverheadStationFootprint } from "./mapScenery";
import "./fog.css";
import "./travelScene.css";

type Carriage = { id: string; name: string; color: string };
type SceneArrival = { label: string; completed: boolean };
type SceneRestStop = { index: number; count: number };
type SceneUpcomingRestStop = SceneRestStop & { remainingSeconds: number };

export type SceneRestAnchor = {
  index: number;
  count: number;
  elapsedStudySeconds: number;
};

export type SceneSessionTiming = {
  elapsedSeconds: number;
  remainingSeconds: number;
  elapsedStudySeconds: number;
  targetStudySeconds: number;
  restAnchors: SceneRestAnchor[];
};

function SceneStation({
  kind,
  title,
  detail,
  accessibleLabel,
}: {
  kind: "rest" | "arrival" | "departure";
  title: string;
  detail: string;
  accessibleLabel: string;
}) {
  const className = kind === "rest"
    ? "travel-rest-stop"
    : kind === "arrival"
      ? "travel-arrival-stop"
      : "travel-departure-stop";
  return (
    <g className={className} role="img" aria-label={accessibleLabel}>
      <OverheadStationFootprint
        x={0}
        y={251}
        roofColor={kind === "arrival" ? "#d8a552" : kind === "departure" ? "#82a179" : "#d8875e"}
        title={title}
        detail={detail}
      />
    </g>
  );
}

export function TopDownScene({
  carriages,
  ownId,
  running,
  fogStrength,
  exploration = 0,
  coast = false,
  restStop = null,
  upcomingRestStop = null,
  arrival = null,
  sessionTiming,
  motionAllowed = true,
}: {
  carriages: Carriage[];
  ownId: string;
  running: boolean;
  fogStrength: number;
  exploration?: number;
  coast?: boolean;
  restStop?: SceneRestStop | null;
  upcomingRestStop?: SceneUpcomingRestStop | null;
  arrival?: SceneArrival | null;
  sessionTiming?: SceneSessionTiming;
  motionAllowed?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const element = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(ownId);
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting;
          update();
        });
    if (element.current) observer?.observe(element.current);
    document.addEventListener("visibilitychange", update);
    update();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(Boolean(media?.matches));
    updateMotionPreference();
    if (media?.addEventListener) media.addEventListener("change", updateMotionPreference);
    else media?.addListener?.(updateMotionPreference);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      if (media?.removeEventListener) media.removeEventListener("change", updateMotionPreference);
      else media?.removeListener?.(updateMotionPreference);
    };
  }, []);
  const sceneMotionAllowed = motionAllowed && visible && !reducedMotion;
  const elapsedStudySeconds = Number.isFinite(sessionTiming?.elapsedStudySeconds)
    ? Math.max(0, sessionTiming?.elapsedStudySeconds ?? 0)
    : 0;
  const targetStudySeconds = Number.isFinite(sessionTiming?.targetStudySeconds)
    ? Math.max(0, sessionTiming?.targetStudySeconds ?? 0)
    : 0;
  const restAnchors = sessionTiming?.restAnchors ?? [];
  const worldSpeed = sceneWorldSpeedForSchedule(
    targetStudySeconds,
    restAnchors.map((anchor) => anchor.elapsedStudySeconds),
  );
  const viewBox = sceneViewBoxForZoom(zoom);
  const [viewBoxLeft, viewBoxTop, viewBoxWidth, viewBoxHeight] = viewBox.split(" ").map(Number);
  const worldDistance = arrival
    ? 0
    : sceneMotionForStudyElapsed(elapsedStudySeconds, worldSpeed).distance;
  const periodicOrigin = Math.floor(worldDistance / SCENE_WORLD_TILE_WIDTH) * SCENE_WORLD_TILE_WIDTH;
  const periodicOffset = arrival ? 0 : periodicOrigin - worldDistance;
  const cameraOffset = -worldDistance;
  const cameraMotionAllowed = sceneMotionAllowed && running && !arrival && Boolean(sessionTiming);
  const previousMotionSample = useRef<{
    allowed: boolean;
    elapsedStudySeconds: number;
    worldDistance: number;
    viewportWorldWidth: number;
    animationFrame: "a" | "b";
    animation: { active: boolean; fromOffset: number; toOffset: number; durationMs: number };
  } | null>(null);
  const previousSample = previousMotionSample.current;
  const hasNewElapsedSample = Boolean(
    previousSample && elapsedStudySeconds !== previousSample.elapsedStudySeconds,
  );
  const worldAnimationFrame = previousSample
    ? hasNewElapsedSample
      ? previousSample.animationFrame === "a" ? "b" : "a"
      : previousSample.animationFrame
    : "a";
  const canStartWorldAnimation = Boolean(
    previousSample &&
    hasNewElapsedSample &&
    previousSample.viewportWorldWidth === viewBoxWidth &&
    sceneMotionCanInterpolate(
      cameraMotionAllowed,
      previousSample.allowed,
      elapsedStudySeconds,
      previousSample.elapsedStudySeconds,
    ) &&
    sceneMotionDistanceGapCanInterpolate(previousSample.worldDistance, worldDistance),
  );
  const canPreserveWorldAnimation = Boolean(
    previousSample &&
    !hasNewElapsedSample &&
    cameraMotionAllowed &&
    previousSample.allowed &&
    previousSample.animation.active &&
    previousSample.viewportWorldWidth === viewBoxWidth &&
    previousSample.worldDistance === worldDistance,
  );
  const worldInterpolate = canStartWorldAnimation || canPreserveWorldAnimation;
  const animationOffsets = canStartWorldAnimation && previousSample
    ? sceneMotionInterpolationOffsets(previousSample.worldDistance, worldDistance, periodicOrigin)
    : canPreserveWorldAnimation && previousSample
      ? previousSample.animation
      : { fromOffset: periodicOffset, toOffset: periodicOffset };
  const worldAnimationDurationMs = canStartWorldAnimation && previousSample
    ? sceneMotionInterpolationDurationMs(elapsedStudySeconds, previousSample.elapsedStudySeconds)
    : canPreserveWorldAnimation && previousSample
      ? previousSample.animation.durationMs
      : 0;
  useEffect(() => {
    previousMotionSample.current = {
      allowed: cameraMotionAllowed,
      elapsedStudySeconds,
      worldDistance,
      viewportWorldWidth: viewBoxWidth,
      animationFrame: worldAnimationFrame,
      animation: {
        active: worldInterpolate,
        fromOffset: animationOffsets.fromOffset,
        toOffset: animationOffsets.toOffset,
        durationMs: worldAnimationDurationMs,
      },
    };
  }, [
    animationOffsets.fromOffset,
    animationOffsets.toOffset,
    cameraMotionAllowed,
    elapsedStudySeconds,
    viewBoxWidth,
    worldAnimationDurationMs,
    worldAnimationFrame,
    worldDistance,
    worldInterpolate,
  ]);

  const worldMotion = cameraMotionAllowed;
  const visibleX = (x: number) => x >= -150 && x <= 1100;
  const engineX = SCENE_ENGINE_CENTER_X;
  const trainLayout = sceneTrainLayout(engineX);
  const worldViewBox = `${viewBoxLeft - viewBoxWidth} ${viewBoxTop} ${viewBoxWidth * SCENE_WORLD_LAYER_VIEWPORTS} ${viewBoxHeight}`;
  const trainScale = sceneTrainScale(
    carriages.length,
    engineX,
    viewBoxLeft,
  );
  const chosen = carriages.find((car) => car.id === selected) ?? carriages[0];
  const terminalScreenX = sessionTiming && targetStudySeconds > 0
    ? sceneStationScreenX(targetStudySeconds, elapsedStudySeconds, worldSpeed)
    : null;
  const finalStationArrived = Boolean(
    !arrival && terminalScreenX !== null && elapsedStudySeconds >= targetStudySeconds,
  );
  const approachingRestAnchor = restStop === null && upcomingRestStop
    ? restAnchors.find((anchor) => {
        const x = sceneStationScreenX(anchor.elapsedStudySeconds, elapsedStudySeconds, worldSpeed);
        return x > engineX && x <= 1050;
      }) ?? null
    : null;
  const approachingTerminal = terminalScreenX !== null && terminalScreenX > engineX && terminalScreenX <= 1050;
  const moving = !arrival && running && sceneMotionAllowed && !finalStationArrived;
  const arrivalLabel = arrival?.label.trim() || (arrival?.completed ? "Đã đến ga cuối." : "Chuyến đã dừng.");
  const sceneStatus = arrival
    ? arrivalLabel
    : finalStationArrived
      ? "đã đến ga cuối"
      : approachingTerminal
        ? "ga cuối đang đến gần"
        : approachingRestAnchor
          ? "trạm nghỉ đang đến gần"
          : restStop
            ? `tàu đang dừng tại trạm nghỉ ${restStop.index} / ${restStop.count}`
            : moving
              ? "cảnh vật đang trôi quanh tàu"
              : "cảnh vật đang dừng";
  const terminalDetail = targetStudySeconds > elapsedStudySeconds
    ? `CÒN ${Math.ceil(targetStudySeconds - elapsedStudySeconds)} GIÂY HỌC`
    : "ĐÃ HOÀN THÀNH";
  const stationAnchors = arrival
    ? []
    : sessionTiming
      ? [
          { id: "start", anchor: 0, kind: "departure" as const, title: "GA KHỞI ĐẦU", detail: "ĐOÀN KHỞI HÀNH", label: "Ga khởi đầu của chuyến học" },
          ...restAnchors.map((anchor) => ({
            id: `rest-${anchor.index}`,
            anchor: anchor.elapsedStudySeconds,
            kind: "rest" as const,
            title: "TRẠM NGHỈ",
            detail: `${anchor.index}/${anchor.count}`,
            label: `Trạm nghỉ ${anchor.index} / ${anchor.count}`,
          })),
          ...(targetStudySeconds > 0 ? [{
            id: "terminal",
            anchor: targetStudySeconds,
            kind: "arrival" as const,
            title: "GA CUỐI",
            detail: terminalDetail,
            label: `Ga cuối, ${terminalDetail.toLowerCase()}`,
          }] : []),
        ].filter(({ anchor }) => visibleX(sceneStationScreenX(anchor, elapsedStudySeconds, worldSpeed)))
      : restStop
        ? [{
            id: `rest-${restStop.index}`,
            anchor: 0,
            kind: "rest" as const,
            title: "TRẠM NGHỈ",
            detail: `${restStop.index}/${restStop.count}`,
            label: `Trạm nghỉ ${restStop.index} / ${restStop.count}`,
          }]
        : [];
  const worldStyle = {
    "--world-camera-offset": `${sceneWorldLayerOffsetPercent(periodicOffset, viewBoxWidth)}%`,
    "--world-animation-from": `${sceneWorldLayerOffsetPercent(animationOffsets.fromOffset, viewBoxWidth)}%`,
    "--world-animation-duration": `${worldAnimationDurationMs}ms`,
  } as CSSProperties;
  const renderedStopPhase = restStop ? "parked" : "travelling";
  const captionStatus = arrival
    ? arrivalLabel
    : fogStrength > 0.25
      ? "☁ Toa đang chờ bạn quay lại"
      : exploration >= 1
        ? "Đã khám phá toàn tuyến"
        : approachingRestAnchor
          ? "Trạm nghỉ đang đến gần."
          : restStop
            ? "Tàu nghỉ tại trạm " + restStop.index + " / " + restStop.count + "."
            : running
              ? "Mỗi phút học mở thêm một vùng đất."
              : "Cảnh dừng · tiến độ đã học được giữ.";
  return (
    <section
      ref={element}
      className="travel-scene"
      aria-label={arrival ? `Cảnh kết thúc: ${arrivalLabel}` : "Cảnh tàu 2D nhìn thẳng từ trên xuống"}
      data-moving={moving}
      data-stop-phase={renderedStopPhase}
      data-rest-index={arrival ? undefined : restStop?.index}
      data-stop-motion={arrival ? false : sceneMotionAllowed}
      data-arrival={arrival ? "true" : undefined}
      data-arrival-complete={arrival ? arrival.completed : undefined}
      data-terminal-approaching={approachingTerminal && !finalStationArrived ? "true" : undefined}
      data-terminal-arrived={finalStationArrived ? "true" : undefined}
      data-session-elapsed={sessionTiming?.elapsedSeconds}
      data-session-remaining={sessionTiming?.remainingSeconds}
      data-session-study-elapsed={elapsedStudySeconds}
    >
      <div className="travel-toolbar">
        <span>{sceneStatus.charAt(0).toUpperCase() + sceneStatus.slice(1)}</span>
        <div className="overhead-controls">
          <button aria-label="Thu nhỏ cảnh 2D" disabled={zoom <= 1} onClick={() => setZoom((v) => Math.max(1, v - 0.25))}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="Phóng to cảnh 2D" disabled={zoom >= 1.5} onClick={() => setZoom((v) => Math.min(1.5, v + 0.25))}>
            +
          </button>
        </div>
      </div>
      <div className="travel-world">
        <div
          className="travel-world-motion"
          data-world-motion={worldMotion}
          data-world-interpolate={worldInterpolate}
          data-world-animation-frame={worldAnimationFrame}
          data-world-distance={arrival ? 0 : worldDistance}
          data-world-camera-offset={arrival ? 0 : cameraOffset}
          data-world-layer-offset={periodicOffset}
          data-world-periodic-origin={arrival ? 0 : periodicOrigin}
          style={worldStyle}
        >
          <svg
            className="travel-world-map"
            viewBox={worldViewBox}
            role="group"
            aria-label={arrival
              ? `Điểm kết thúc ${arrival.completed ? "ga cuối" : "điểm dừng"}: ${arrivalLabel}`
              : `Cảnh vật quanh tàu, ${sceneStatus}`}
          >
            <defs>
              <pattern id={`${id}-sleepers`} width="30" height="50" patternUnits="userSpaceOnUse">
                <rect x="3" y="2" width="8" height="46" rx="3" fill="#9a7654" />
              </pattern>
            </defs>
            <g
              className="travel-periodic-world"
              aria-hidden="true"
            >
              <MapScenery kind="travel" coast={coast} />
              <rect x="-900" y="183" width="2700" height="54" fill="#8b7355" opacity=".45" />
              <rect x="-900" y="188" width="2700" height="44" fill="#c19b6b" />
              <g className="travel-rail-ties">
                <rect x="-900" y="188" width="2700" height="44" fill={"url(#" + id + "-sleepers)"} />
              </g>
              <path d="M-900 194 H1800 M-900 226 H1800" stroke="#5b6260" strokeWidth="7" />
              <path d="M-900 193 H1800 M-900 227 H1800" stroke="#eee1bd" strokeWidth="2.5" />
            </g>
            {arrival ? (
              <g
                className="travel-station-position"
                transform={"translate(" + SCENE_ENGINE_CENTER_X + " 18)"}
                data-station-id="arrival"
                data-station-world-x={SCENE_ENGINE_CENTER_X}
                data-station-screen-x={SCENE_ENGINE_CENTER_X}
              >
                <SceneStation
                  kind="arrival"
                  title={arrival.completed ? "GA CUỐI" : "ĐIỂM DỪNG"}
                  detail={arrival.completed ? "ĐÃ HOÀN THÀNH" : "KẾT THÚC SỚM"}
                  accessibleLabel={(arrival.completed ? "Ga cuối" : "Điểm dừng cuối") + ": " + arrivalLabel}
                />
              </g>
            ) : stationAnchors.map((station) => {
              const screenX = sceneStationScreenX(station.anchor, elapsedStudySeconds, worldSpeed);
              const worldX = sceneStationWorldX(station.anchor, worldSpeed);
              return (
                <g
                  key={station.id}
                  className="travel-station-position"
                  transform={"translate(" + (worldX - periodicOrigin) + " 18)"}
                  data-station-id={station.id}
                  data-station-world-x={worldX}
                  data-station-screen-x={screenX}
                  data-station-anchor-study-seconds={station.anchor}
                >
                  <SceneStation
                    kind={station.kind}
                    title={station.title}
                    detail={station.detail}
                    accessibleLabel={station.label}
                  />
                </g>
              );
            })}
          </svg>
        </div>
        <svg className="travel-train-overlay" viewBox={viewBox} role="group" aria-label="Đoàn tàu nhìn từ trên xuống">
          <g className="travel-train-motion">
            <g
              className="travel-train-position"
              data-stop-phase={renderedStopPhase}
              style={{
                "--travel-shift": `${trainLayout.travelShift}px`,
                "--arrival-shift": `${trainLayout.arrivalShift}px`,
              } as CSSProperties}
            >
              <g
                className="travel-train"
                aria-label="Đoàn tàu nhìn từ trên xuống"
                transform={`translate(${engineX} 210) scale(${trainScale}) translate(${-engineX} -210)`}
                data-train-scale={trainScale}
              >
            <g transform={`translate(${engineX} 210)`} aria-label="Đầu tàu">
              <ellipse cx="3" cy="17" rx="44" ry="21" fill="#385f4b" opacity=".27" />
              <g transform="translate(-16 19)">
                <g className="travel-wheel">
                  <circle r="7" fill="#3a5148" stroke="#f1d7a0" strokeWidth="2" />
                  <path d="M-3 0h6M0-3v6" stroke="#f2e2bb" strokeWidth="1.4" />
                </g>
              </g>
              <g transform="translate(23 19)">
                <g className="travel-wheel">
                  <circle r="7" fill="#3a5148" stroke="#f1d7a0" strokeWidth="2" />
                  <path d="M-3 0h6M0-3v6" stroke="#f2e2bb" strokeWidth="1.4" />
                </g>
              </g>
              <rect x="-32" y="-22" width="68" height="42" rx="13" fill="#33564a" stroke="#fff1ca" strokeWidth="3" />
              <path d="M-27-17h56" stroke="#a5d2a6" strokeWidth="3" strokeLinecap="round" />
              <rect x="-26" y="-16" width="24" height="31" rx="7" fill="#dfb961" stroke="#fff0c8" strokeWidth="2" />
              <rect x="5" y="-15" width="23" height="30" rx="10" fill="#79b49a" stroke="#d5ebcb" strokeWidth="2" />
              <circle cx="16.5" cy="0" r="6" fill="#31493d" />
              <rect x="10" y="-27" width="13" height="8" rx="3" fill="#8f6247" stroke="#f1d5a2" strokeWidth="2" />
              <path d="M36-11 Q48 0 36 11Z" fill="#d38d52" stroke="#fff1ca" strokeWidth="2" />
              <circle cx="41" cy="0" r="3.5" fill="#fff4b9" />
              <g className="train-steam" aria-hidden="true">
                <circle className="train-steam-puff puff-one" cx="19" cy="-33" r="6" />
                <circle className="train-steam-puff puff-two" cx="24" cy="-37" r="7" />
                <circle className="train-steam-puff puff-three" cx="14" cy="-40" r="5" />
              </g>
            </g>
            {carriages.map((car, i) => (
              <g
                key={car.id}
                transform={`translate(${engineX - (i + 1) * 64} 210)`}
                role="button"
                tabIndex={0}
                aria-label={`Toa ${i + 1}: ${car.name}${car.id === ownId ? ", của bạn" : ""}`}
                aria-pressed={chosen?.id === car.id}
                onClick={() => setSelected(car.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(car.id);
                  }
                }}
                className="overhead-car"
              >
                <ellipse cx="1" cy="17" rx="35" ry="20" fill="#385f4b" opacity=".24" />
                <g transform="translate(-17 18)">
                  <g className="travel-wheel">
                    <circle r="6" fill="#3a5148" stroke="#e5cf9d" strokeWidth="1.8" />
                    <path d="M-2.5 0h5M0-2.5v5" stroke="#f2e2bb" strokeWidth="1.2" />
                  </g>
                </g>
                <g transform="translate(17 18)">
                  <g className="travel-wheel">
                    <circle r="6" fill="#3a5148" stroke="#e5cf9d" strokeWidth="1.8" />
                    <path d="M-2.5 0h5M0-2.5v5" stroke="#f2e2bb" strokeWidth="1.2" />
                  </g>
                </g>
                <rect x="-29" y="-22" width="58" height="43" rx="12" fill={car.color} stroke={chosen?.id === car.id ? "#fff2b6" : "#456557"} strokeWidth={chosen?.id === car.id ? 4 : 2.5} />
                <path d="M-22-17h44" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
                <rect x="-21" y="-14" width="42" height="28" rx="8" fill="#fff0ca" opacity=".83" />
                <path d="M-2-12v24" stroke="#d4b67b" strokeWidth="2" />
                <text y="6" textAnchor="middle" fill="#294638" fontSize="16" fontWeight="800">{i + 1}</text>
              </g>
            ))}
          </g>
          </g>
        </g>
      </svg>
      </div>
      <div className="travel-caption">
        <span>{chosen?.name} · {carriages.length} toa</span>
        <span>{captionStatus}</span>
      </div>
    </section>
  );
}
