/*
 * Decorative background only: navy-to-charcoal gradient, teal ambient light and the visual language of disease
 * surveillance (a medical grid, contour lines, microscope-like cell lattices, radar rings, an outbreak wave, district
 * outlines and linked data points). It carries no data, and the outlines are not real boundaries. Everything is
 * deterministic so server and browser render the same markup. Phones get a still, lighter version (see globals.css).
 */

/** One closed, slightly irregular contour ring around (cx, cy), drawn as a smooth path. */
function ring(cx: number, cy: number, r: number, phase: number) {
  const N = 28;
  const pts = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2;
    const wobble = 1 + 0.13 * Math.sin(3 * a + phase) + 0.07 * Math.sin(5 * a - phase * 1.7);
    return [cx + Math.cos(a) * r * 1.35 * wobble, cy + Math.sin(a) * r * wobble];
  });
  const mid = (i: number) => {
    const [p, q] = [pts[i % N], pts[(i + 1) % N]];
    return `${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`;
  };
  return `M${mid(N - 1)}${pts.map((p, i) => `Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mid(i)}`).join("")}Z`;
}

const HILLS = [
  { x: 1390, y: 150, rings: 8, step: 42, phase: 0.6 },
  { x: 130, y: 760, rings: 9, step: 40, phase: 2.4 },
  { x: 900, y: 1010, rings: 5, step: 46, phase: 4.1 },
];
const CONTOURS = HILLS.flatMap((h) =>
  Array.from({ length: h.rings }, (_, i) => ({ d: ring(h.x, h.y, 40 + i * h.step, h.phase + i * 0.16), major: i % 4 === 3 })),
);

const hexagon = (x: number, y: number, r: number) =>
  `M${Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(x + r * Math.cos(a)).toFixed(1)} ${(y + r * Math.sin(a)).toFixed(1)}`;
  }).join("L")}Z`;

/** Microscope-inspired clusters: a few cells of a hexagonal lattice, some with a nucleus ring. */
const CELLS = [
  { x: 1180, y: 560, r: 26 },
  { x: 250, y: 300, r: 18 },
].flatMap(({ x, y, r }) =>
  [[0, 0], [1, 0], [-1, 0], [0.5, 1], [-0.5, 1], [0.5, -1], [1.5, 1], [-1.5, -1]].map(([q, row], i) => ({
    d: hexagon(x + q * r * Math.sqrt(3), y + row * r * 1.5, r),
    cx: x + q * r * Math.sqrt(3),
    cy: y + row * r * 1.5,
    r,
    nucleus: i % 3 === 0,
  })),
);

/** Irregular district outlines, purely ornamental. */
const OUTLINES = [
  "M620 120l70-34 66 22 24 58-44 40-72-6-52-34zM756 108l62-26 58 34-6 62-66 26-24-38zM666 200l72 6 20 58-52 36-62-30z",
  "M60 470l54-40 70 14 12 58-46 38-74-12zM184 444l66-14 40 46-30 52-64-26zM150 520l46 60-34 52-68-28 6-72z",
];

/** The shape of an outbreak season: a slow rise, a sharp peak and a longer tail. */
const WAVE = Array.from({ length: 81 }, (_, i) => {
  const x = i * 20;
  const bump = (centre: number, width: number, height: number) => height * Math.exp(-(((i - centre) / width) ** 2));
  const y = 975 - bump(24, 8, 70) - bump(58, 6, 105) - bump(66, 10, 40);
  return `${x} ${y.toFixed(1)}`;
});

/** Data points joined by short links. */
const NODES = [[980, 250], [1065, 330], [1180, 300], [1255, 405], [1120, 430], [420, 640], [505, 575], [610, 655], [545, 740]];
const LINKS = [[0, 1], [1, 2], [2, 3], [1, 4], [4, 3], [5, 6], [6, 7], [7, 8], [8, 5]];

const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 389 + 97) % 1600,
  y: (i * 233 + 41) % 1000,
  r: i % 5 === 0 ? 2 : 1.2,
  delay: -((i * 1.7) % 14),
}));

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 12% -5%, rgb(45 212 191 / 0.13), transparent 70%)," +
            "radial-gradient(ellipse 45% 55% at 105% 35%, rgb(40 110 175 / 0.14), transparent 70%)," +
            "radial-gradient(ellipse 55% 40% at 45% 115%, rgb(45 212 191 / 0.07), transparent 70%)," +
            "linear-gradient(165deg, #0a1628 0%, #070d17 48%, #0c0f15 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgb(140 188 212 / 0.055) 1px, transparent 1px), linear-gradient(90deg, rgb(140 188 212 / 0.055) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 90% 75% at 50% 20%, #000 25%, transparent 85%)",
        }}
      />
      {/* medical crosses on every second grid point */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='144' height='144'%3E%3Cpath d='M72 67v10M67 72h10' stroke='%235fd8c9' stroke-opacity='.28'/%3E%3C/svg%3E\")",
          maskImage: "radial-gradient(ellipse 80% 70% at 85% 60%, #000 20%, transparent 80%)",
        }}
      />
      {/* radar rings with a slow sweep, tucked into the top-right corner */}
      <div className="backdrop-radar" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <g fill="none" stroke="#5fd8c9" strokeWidth={1}>
          {CONTOURS.map((c, i) => (
            <path key={i} d={c.d} opacity={c.major ? 0.14 : 0.065} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g className="backdrop-detail" fill="none" stroke="#5fd8c9">
          {OUTLINES.map((d, i) => (
            <path key={i} d={d} strokeOpacity={0.09} vectorEffect="non-scaling-stroke" />
          ))}
          {CELLS.map((c, i) => (
            <g key={i}>
              <path d={c.d} strokeOpacity={0.1} />
              {c.nucleus && <circle cx={c.cx} cy={c.cy} r={c.r * 0.38} strokeOpacity={0.16} strokeDasharray="3 4" />}
            </g>
          ))}
          {LINKS.map(([a, b], i) => (
            <line key={i} className={i % 3 === 0 ? "flow" : undefined} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} strokeOpacity={0.14} />
          ))}
          {NODES.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2.4} fill="#6ff0de" stroke="none" opacity={0.35} />
          ))}
        </g>
        <path d={`M${WAVE.join("L")}`} fill="none" stroke="#5fd8c9" strokeOpacity={0.22} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <path d={`M${WAVE.join("L")}L1600 1000L0 1000Z`} fill="#2dd4bf" opacity={0.035} />
        <g className="backdrop-detail" fill="#6ff0de">
          {PARTICLES.map((p, i) => (
            <circle key={i} className="drift" cx={p.x} cy={p.y} r={p.r} opacity={0.35} style={{ animationDelay: `${p.delay}s` }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
