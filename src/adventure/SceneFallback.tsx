export function SceneFallback({
  color = "#398575",
  fog = false,
  fogStrength = 1,
  compact = false,
  decor = "plant",
}: {
  color?: string;
  fog?: boolean;
  fogStrength?: number;
  compact?: boolean;
  decor?: string;
}) {
  return (
    <svg
      className={`train-scene ${compact ? "compact" : ""}`}
      viewBox="0 0 960 360"
      role="img"
      aria-label={
        fog
          ? "Toa tàu giữa làn sương, đang chờ bạn quay lại"
          : "Toa tàu qua đồng cỏ và dãy núi lúc bình minh"
      }
    >
      <defs>
        <linearGradient id="sky" x2="0" y2="1">
          <stop stopColor="#dceae5" />
          <stop offset="1" stopColor="#f7f1dc" />
        </linearGradient>
        <linearGradient id="hill" x2="0" y2="1">
          <stop stopColor="#a8b8a1" />
          <stop offset="1" stopColor="#718e76" />
        </linearGradient>
      </defs>
      <rect width="960" height="360" fill="url(#sky)" />
      <circle cx="740" cy="83" r="42" fill="#f6deb0" />
      <path
        d="M0 195 135 64 255 189 399 54 591 218 736 113 960 192V360H0Z"
        fill="#b5c9bd"
      />
      <path d="m294 148 105-94 95 81-63-20-31-29-32 43Z" fill="#eff3e9" />
      <path d="M0 220Q185 116 348 211T691 195T960 189V360H0Z" fill="#8fac97" />
      <path
        d="M0 266Q205 190 410 256T780 218T960 254V360H0Z"
        fill="url(#hill)"
      />
      {[65, 115, 838, 888, 922].map((x, i) => (
        <g key={x} transform={`translate(${x} ${155 + (i % 2) * 24})`}>
          <path d="M0 0-24 61H24Z" fill="#4e7565" />
          <path d="M0 23-31 69H31Z" fill="#52796a" />
          <path d="M0 68V105" stroke="#486353" strokeWidth="5" />
        </g>
      ))}
      <path d="M0 323H960" stroke="#475c50" strokeWidth="7" />
      <path d="M0 334H960" stroke="#d2c6a5" strokeWidth="5" />
      {Array.from({ length: 32 }, (_, i) => (
        <path
          key={i}
          d={`M${i * 32} 321v19`}
          stroke="#687360"
          strokeWidth="5"
        />
      ))}
      <g transform="translate(310 133)">
        <path d="M-15 165H320" stroke="#3b4b43" strokeWidth="8" />
        <rect x="0" y="10" width="303" height="157" rx="19" fill={color} />
        <rect x="-8" width="319" height="23" rx="11" fill="#253f37" />
        <rect x="17" y="35" width="66" height="87" rx="8" fill="#d6aa70" />
        <rect x="26" y="45" width="48" height="45" rx="5" fill="#f5e7c9" />
        <rect x="100" y="35" width="85" height="70" rx="8" fill="#f5e7c9" />
        <rect x="198" y="35" width="85" height="70" rx="8" fill="#f5e7c9" />
        <path d="M142 35v70M240 35v70" stroke="#d0b789" strokeWidth="5" />
        <path d="M104 93h75M203 93h75" stroke="#c39765" strokeWidth="5" />
        <text x="120" y="87" fontSize="25">
          {decor === "plant" ? "♣" : decor === "stars" ? "✦" : "▤"}
        </text>
        <path d="M20 140h265" stroke="#bfac72" strokeWidth="3" />
        <text x="195" y="134" fill="#f4e9cb" fontSize="11" letterSpacing="4">
          VIỄN DU
        </text>
        {[55, 250].map((x) => (
          <g key={x}>
            <circle cx={x} cy="171" r="21" fill="#2a3834" />
            <circle cx={x} cy="171" r="10" fill="#99a497" />
          </g>
        ))}
      </g>
      <path d="M0 358q95-46 180 0m526 0q123-48 254-10" fill="#617d61" />
      {fog && <rect width="960" height="360" fill="#e4e9e7" opacity={.67 * fogStrength} />}
    </svg>
  );
}
