import { memo, useEffect, useId, useRef, useState } from "react";
import { mapGeometry, stopIndices as stops } from "./mapGeometry";
import { MapScenery, OverheadStationFootprint } from "./mapScenery";
import { explorationProgress } from "./exploration";
import { MapFog } from "./MapFog";
import type { Journey } from "../../backend/src/adventure/domain";
import "./fog.css";

type Carriage = { id: string; name: string; color: string };
const names = [
  "Ga Khởi đầu",
  "Đồng cỏ Gió",
  "Rừng Sương mù",
  "Đèo Ánh sao",
  "Thành phố Bình minh",
];
const stationRoofColors = ["#82a179", "#d8a552", "#718f9c", "#d8875e", "#d57064"];

export const TopDownMap = memo(function TopDownMap({
  journey,
  carriages,
  ownId,
  draftSeconds = 0,
  targetSeconds,
}: {
  journey?: Journey;
  carriages: Carriage[];
  ownId: string;
  draftSeconds?: number;
  targetSeconds?: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const { route, distances, total, path, position } = mapGeometry(
    journey?.branch,
  );
  const progress = explorationProgress(journey, draftSeconds, targetSeconds);
  const stage = progress.station;
  const fraction = progress.fraction;
  const distance =
    distances[stops[stage]] +
    (stage < 4
      ? fraction * (distances[stops[stage + 1]] - distances[stops[stage]])
      : 0);
  const futureStations = stops.slice(1).map((stop) => ({
    x: route[stop][0],
    y: route[stop][1],
    distance: distances[stop],
  }));
  const exploration = Math.min(
    1,
    Math.max(
      0,
      (distance - distances[stops[0]]) /
        (distances[stops[4]] - distances[stops[0]]),
    ),
  );
  const engine = position(distance);
  const initialTrain = useRef(engine);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      element.scrollTo({
        left: initialTrain.current.x / 1100 * element.scrollWidth - element.clientWidth / 2,
        top: initialTrain.current.y / 650 * (element.querySelector("svg")?.clientHeight ?? 0) - element.clientHeight / 2,
        behavior: "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const current =
    carriages.find((car) => car.id === selected) ??
    carriages.find((car) => car.id === ownId) ??
    carriages[0];
  const coast = journey?.branch === "coast";
  function locate() {
    const element = viewport.current;
    if (!element) return;
    element.scrollTo({
      left: (engine.x / 1100) * element.scrollWidth - element.clientWidth / 2,
      top:
        (engine.y / 650) * (element.querySelector("svg")?.clientHeight ?? 0) -
        element.clientHeight / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  return (
    <section
      className="overhead-map panel"
      aria-label="Bản đồ tiến trình từ trên xuống"
    >
      <div className="overhead-toolbar">
        <div>
          <small>GÓC NHÌN TỪ TRÊN XUỐNG</small>
          <h2>Một đoàn tàu, một hành trình</h2>
        </div>
        <div className="overhead-controls" aria-label="Điều khiển bản đồ">
          <button
            aria-label="Thu nhỏ bản đồ"
            disabled={zoom <= 1}
            onClick={() => setZoom((v) => Math.max(1, v - 0.25))}
          >
            −
          </button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Phóng to bản đồ"
            disabled={zoom >= 2}
            onClick={() => setZoom((v) => Math.min(2, v + 0.25))}
          >
            +
          </button>
          <button onClick={locate}>⌖ Tìm tàu</button>
        </div>
      </div>
      <p className="overhead-hint">
        {carriages.length} toa · 1 đầu tàu · Kéo thanh cuộn để khám phá, chọn
        toa để xem tên.
      </p>
      <div
        className="overhead-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label="Vùng bản đồ có thể cuộn ngang"
      >
        <svg
          className="overhead-world"
          style={{ width: `${zoom * 100}%`, minWidth: 760 * zoom }}
          viewBox="0 0 1100 650"
          role="group"
          aria-label={`Bản đồ khám phá: tàu có ${carriages.length} toa, đang ở ${names[stage]}; vùng chưa tới được phủ sương`}
        >
          <defs>
            <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fbf2d9" />
              <stop offset="1" stopColor="#ecdfbb" />
            </linearGradient>
            <linearGradient id={`${id}-meadow`} x1="0" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor="#d8edb8" />
              <stop offset="1" stopColor="#b7d895" />
            </linearGradient>
            <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor="#8ccbd0" />
              <stop offset="1" stopColor="#68adb8" />
            </linearGradient>
            <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor="#a7cb78" />
              <stop offset="1" stopColor="#4d8d6a" />
            </linearGradient>
            <linearGradient id={`${id}-engine`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#65977d" />
              <stop offset="1" stopColor="#284e43" />
            </linearGradient>
            <pattern id={`${id}-paper-grain`} width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M5 11h2M27 31h2M34 8h1" stroke="#8f9e6e" strokeWidth="1.2" strokeLinecap="round" opacity=".24" />
              <circle cx="17" cy="24" r=".8" fill="#ab9368" opacity=".25" />
            </pattern>
          </defs>
          <rect
            className="map-paper"
            width="1100"
            height="650"
            rx="24"
            fill={`url(#${id}-paper)`}
          />
          <path
            d="M-20 62 Q150 -24 324 45 T657 38 Q845 5 1120 52 V650 H-20Z"
            fill={`url(#${id}-meadow)`}
          />
          <path d="M-20 155 Q172 92 339 143 T682 130 Q894 95 1120 156 V650 H-20Z" fill="#c6e2a3" opacity=".48" />
          <path d="M-20 462 Q197 398 367 458 T718 438 Q930 393 1120 450 V650 H-20Z" fill="#a9cf8e" opacity=".32" />
          {coast ? (
            <g className="map-coast" aria-hidden="true">
              <path d="M930 -15 Q820 71 884 154 Q922 204 984 234 Q1040 266 1003 352 Q966 441 1029 510 Q1058 545 1120 554 V-15Z" fill={`url(#${id}-water)`} />
              <path d="M920 -12 Q811 73 875 158 Q915 210 976 239 Q1028 267 992 355 Q956 443 1019 515" fill="none" stroke="#f1dfb2" strokeWidth="29" strokeLinecap="round" />
              <path d="M930 -12 Q821 72 886 154 Q926 205 986 232 Q1037 262 1002 352 Q965 439 1027 511" fill="none" stroke="#d7f0dc" strokeWidth="6" strokeLinecap="round" />
              <path d="M1034 112q24 10 46 0M1033 126q17 7 34 0M1036 417q24 10 47 0M1043 433q17 7 34 0" fill="none" stroke="#c4ece2" strokeWidth="4" strokeLinecap="round" opacity=".72" />
              <path d="M978 514q25-12 43-2t32 2v24q-35 17-77-2Z" fill="#efdda8" opacity=".9" />
            </g>
          ) : (
            <g className="map-lakes" aria-hidden="true">
              <path d="M394 399 Q424 354 491 367 Q545 351 592 389 Q622 417 574 438 Q521 459 453 439 Q398 433 394 399Z" fill="#70b7c0" opacity=".83" />
              <path d="M410 394 Q441 367 494 377 Q545 364 579 391 Q601 409 564 425 Q514 441 460 426 Q421 423 410 394Z" fill="#a8d9d0" />
              <path d="M432 392q36-13 69-4M483 418q30 7 52 0" fill="none" stroke="#e4f2d8" strokeWidth="4" strokeLinecap="round" opacity=".8" />
              <path d="M287 426 Q337 402 384 413 T431 404" fill="none" stroke="#80c2c1" strokeWidth="13" strokeLinecap="round" opacity=".63" />
              <path d="M287 423 Q337 399 384 410 T431 401" fill="none" stroke="#c6e8d1" strokeWidth="3" strokeLinecap="round" opacity=".85" />
            </g>
          )}
          <MapScenery kind="overview" coast={coast} />
          <rect width="1100" height="650" rx="24" fill={`url(#${id}-paper-grain)`} opacity=".28" pointerEvents="none" />
          <g aria-hidden="true">
            {stage >= 4 && (
              <text x="40" y="58" className="overhead-region">
                VIỄN DU · MIỀN BÌNH MINH
              </text>
            )}
            {stage >= 1 && (
              <text x="85" y="375" className="overhead-region">
                NÚI MÂY
              </text>
            )}
            {stage >= 2 && (
              <text x="470" y="465" className="overhead-region">
                HỒ ÊM
              </text>
            )}
            {coast && stage >= 3 && (
              <text
                x="977"
                y="98"
                className="overhead-region"
                transform="rotate(12 977 98)"
              >
                BỜ BIỂN
              </text>
            )}
          </g>
          <path
            className="map-rail-layer map-rail-bed"
            d={path}
            pathLength={total}
            fill="none"
            stroke="#6f7257"
            strokeWidth="34"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="map-rail-layer map-rail-sleepers"
            d={path}
            pathLength={total}
            fill="none"
            stroke="#a67d52"
            strokeWidth="28"
            strokeDasharray="2 13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="map-rail-layer map-rail-runner"
            d={path}
            pathLength={total}
            fill="none"
            stroke="#f2d9a7"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="map-rail-layer map-rail-progress"
            d={path}
            pathLength={total}
            fill="none"
            stroke="#dc8050"
            strokeWidth="7"
            strokeDasharray={`${Math.min(total, distance)} ${total}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <MapFog
            id={id}
            path={path}
            distance={distance}
            total={total}
            stations={futureStations}
            progress={exploration}
          />
          {stops.slice(0, stage + 1).map((stop, i) => {
            const [x, y] = route[stop];
            return (
              <g key={stop} className="map-station-marker" aria-label={`${names[i]}: đã khám phá`}>
                <OverheadStationFootprint
                  x={x + 55}
                  y={y - 35}
                  scale={0.52}
                  roofColor={stationRoofColors[i]}
                />
                <circle
                  cx={x}
                  cy={y}
                  r="23"
                  fill="#fff0c7"
                  stroke="#9e6e48"
                  strokeWidth="4"
                />
                <circle cx={x} cy={y} r="17" fill="#e4a45a" stroke="#fff7df" strokeWidth="2" />
                <text
                  x={x}
                  y={y + 5}
                  textAnchor="middle"
                  fill="#fff8df"
                  fontSize="15"
                  fontWeight="800"
                >
                  {i + 1}
                </text>
                <rect
                  x={x - 86}
                  y={y + 27}
                  width="178"
                  height="32"
                  rx="15"
                  fill="#fff8e5"
                  stroke="#c8a975"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 47}
                  textAnchor="middle"
                  fill="#42564a"
                  fontSize="13"
                  fontWeight="700"
                >{names[i]}</text>
              </g>
            );
          })}
          <g
            className="map-engine"
            transform={`translate(${engine.x} ${engine.y}) rotate(${engine.angle})`}
            aria-label="Đầu tàu"
          >
            <ellipse cx="3" cy="15" rx="30" ry="18" fill="#345847" opacity=".24" />
            <circle cx="-15" cy="12" r="7" fill="#3d4c42" stroke="#e4c888" strokeWidth="2" />
            <circle cx="15" cy="12" r="7" fill="#3d4c42" stroke="#e4c888" strokeWidth="2" />
            <rect x="-27" y="-18" width="54" height="34" rx="12" fill={`url(#${id}-engine)`} stroke="#fff1c7" strokeWidth="3" />
            <rect x="-21" y="-12" width="23" height="22" rx="7" fill="#f1c868" stroke="#fff0c5" strokeWidth="2" />
            <rect x="7" y="-11" width="13" height="21" rx="6" fill="#7fbaa1" stroke="#d8efd2" strokeWidth="2" />
            <circle cx="13.5" cy="-1" r="4" fill="#274a42" />
            <path d="M26-9 Q37 0 26 9Z" fill="#dc8050" stroke="#fff1c7" strokeWidth="2" />
            <circle cx="29" cy="0" r="3" fill="#fff2aa" />
            <path d="M-18-15h32" stroke="#a8d0a0" strokeWidth="3" strokeLinecap="round" opacity=".85" />
          </g>
          {carriages.map((car, i) => {
            const p = position(distance - (i + 1) * 49);
            return (
              <g
                key={car.id}
                transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`}
                role="button"
                tabIndex={0}
                aria-label={`Toa ${i + 1}: ${car.name}${car.id === ownId ? ", của bạn" : ""}`}
                aria-pressed={current?.id === car.id}
                onClick={() => setSelected(car.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(car.id);
                  }
                }}
                className="overhead-car"
              >
                <ellipse cx="1" cy="14" rx="27" ry="15" fill="#345847" opacity=".23" />
                <circle cx="-14" cy="12" r="6" fill="#3d4c42" stroke="#e4c888" strokeWidth="2" />
                <circle cx="14" cy="12" r="6" fill="#3d4c42" stroke="#e4c888" strokeWidth="2" />
                <rect
                  x="-22"
                  y="-17"
                  width="44"
                  height="33"
                  rx="11"
                  fill={car.color}
                  stroke={current?.id === car.id ? "#fff3b4" : "#36594a"}
                  strokeWidth={current?.id === car.id ? 4 : 3}
                />
                <rect
                  x="-15"
                  y="-11"
                  width="30"
                  height="22"
                  rx="7"
                  fill="#fff2cc"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  opacity=".82"
                />
                <path d="M-13-7h26" stroke="#fffefa" strokeWidth="2" strokeLinecap="round" opacity=".76" />
                <text
                  y="5"
                  textAnchor="middle"
                  fill="#263f35"
                  fontWeight="800"
                  fontSize="14"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
          <g transform="translate(1034 555)" aria-hidden="true">
            <circle r="29" fill="#f7f6e9" />
            <path d="M0 -18 L8 10 L0 5 L-8 10Z" fill="#496b59" />
            <text y="-34" textAnchor="middle" fontSize="13" fill="#496b59">
              BẮC
            </text>
          </g>
        </svg>
      </div>
      <div className="overhead-status" aria-live="polite">
        <strong>{names[stage]}</strong>
        <span>
          {stage === 4
            ? "Đã đến đích"
            : `${Math.round(fraction * 100)}% đến trạm kế tiếp`}
        </span>
        <span>Ngã rẽ: {coast ? "Bờ biển" : "Qua núi"}</span>
      </div>
      <div className="overhead-exploration-progress">
        <div>
          <strong>Tiến độ khám phá</strong>
          <span>Đã mở {stage + 1}/5 trạm</span>
        </div>
        <progress
          value={Math.min(4, stage + fraction)}
          max={4}
          aria-label="Tiến độ khám phá hành trình"
          aria-valuetext={`${stage + 1} trên 5 trạm đã mở${stage < 4 ? `, ${Math.round(fraction * 100)} phần trăm tới trạm kế tiếp` : ""}`}
        />
        <small>{stage === 4 ? "Toàn bộ tuyến đường đã được khám phá." : "Tuyến và cảnh quan phía trước vẫn được che bởi sương."}</small>
      </div>
      <div className="overhead-carriages" aria-label="Danh sách toa tàu">
        {carriages.map((car, i) => (
          <button
            key={car.id}
            aria-pressed={current?.id === car.id}
            onClick={() => setSelected(car.id)}
          >
            <i style={{ background: car.color }} />
            Toa {i + 1}
            {car.id === ownId ? " · Bạn" : ""}
          </button>
        ))}
      </div>
      {current && (
        <p className="overhead-selected">
          ▣ <strong>{current.name}</strong>
          {current.id === ownId ? " · Toa của bạn" : " · Thành viên đoàn"}
          <span>
            Vị trí toa {carriages.indexOf(current) + 1} / {carriages.length}
          </span>
        </p>
      )}
      {draftSeconds > 0 && (
        <p className="overhead-hint">
          Vị trí gồm thời gian học của phiên này; tiến độ chính thức được lưu
          khi kết thúc phiên.
        </p>
      )}
      <div className="overhead-legend">
        <span><i className="fog-legend-known" /> Vùng đã khám phá</span>
        <span><i className="fog-legend-hidden" /> Sương che vùng chưa tới</span>
        <span><i className="fog-legend-route" /> Tuyến đã đi</span>
      </div>
    </section>
  );
});
