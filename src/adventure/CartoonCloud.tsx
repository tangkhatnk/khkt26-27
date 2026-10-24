const silhouettes = [
  "M-126 35 C-139 25 -137 8 -125 -3 C-117 -13 -106 -17 -93 -16 C-91 -37 -73 -52 -51 -51 C-32 -50 -24 -39 -17 -27 C-5 -54 22 -67 46 -56 C67 -46 73 -31 72 -17 C96 -29 122 -18 130 2 C141 21 129 42 109 51 C99 56 90 58 77 58 L-96 58 C-118 58 -132 50 -136 40 C-138 37 -133 34 -126 35 Z",
  "M-127 36 C-140 23 -134 5 -120 -5 C-111 -12 -103 -15 -91 -15 C-88 -34 -72 -50 -50 -50 C-31 -50 -22 -39 -14 -25 C2 -56 29 -65 51 -53 C67 -44 73 -31 72 -16 C95 -27 120 -17 129 3 C140 23 127 43 109 51 C99 56 91 58 78 58 L-96 58 C-117 58 -131 51 -136 41 C-139 38 -134 35 -127 36 Z",
  "M-124 34 C-138 26 -139 10 -128 -2 C-119 -13 -107 -17 -95 -17 C-93 -36 -76 -52 -55 -51 C-37 -51 -26 -42 -19 -29 C-6 -51 18 -66 43 -59 C64 -52 73 -36 74 -20 C96 -28 119 -16 128 3 C139 23 126 43 108 51 C98 56 89 58 76 58 L-94 58 C-116 58 -132 50 -136 40 C-139 36 -133 33 -124 34 Z",
];

export function CartoonCloud({
  scale,
  variant = 0,
  className = "cartoon-cloud-shape",
}: {
  scale: number;
  variant?: number;
  className?: string;
}) {
  const path = silhouettes[((variant % silhouettes.length) + silhouettes.length) % silhouettes.length];
  return (
    <g className={className} style={{ transform: `scale(${scale})` }}>
      <path className="cartoon-cloud-shadow" d={path} transform="translate(0 9)" />
      <path className="cartoon-cloud-depth" d={path} transform="translate(0 4)" />
      <path className="cartoon-cloud-body" d={path} fill="#eef4ef" fillOpacity={1} />
      <path
        className="cartoon-cloud-highlight"
        d="M-99 25 C-116 16 -112 0 -99 -7 C-91 -15 -80 -17 -69 -14 C-62 -30 -48 -38 -34 -37 C-17 -36 -9 -27 -3 -16 C10 -32 29 -40 44 -34 C60 -27 65 -14 64 -3 C78 -10 94 -4 100 8 C106 19 97 28 81 32 L-88 32Z"
      />
    </g>
  );
}
