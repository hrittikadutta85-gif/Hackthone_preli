"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { TIERS, TIER_COLOR, type MapData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { TierPill, useMedia } from "../ui";
import { CITY_LINKS, colorAt, cityGroups, citySummary, type CanvasProps } from "./shared";

/*
 * Offline view: a schematic "honeycomb". Needs no internet. Each city corporation sits in its real direction from the
 * others and its wards are drawn as hexagons around it (not to scale).
 */
const S = 22; // hexagon corner radius, SVG units
const FULL = { x: 0, y: 0, w: 1000, h: 930 };
type Side = "left" | "right" | "below" | "above";
const CITIES: Record<string, { at: [number, number]; label: Side; far?: boolean }> = {
  Gazipur: { at: [400, 110], label: "right" },
  "Dhaka North": { at: [390, 345], label: "left" },
  "Dhaka South": { at: [380, 655], label: "left" },
  Narayanganj: { at: [640, 700], label: "below" },
  Chattogram: { at: [860, 800], label: "above", far: true },
};
const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return `${((S - 1.5) * Math.cos(a)).toFixed(2)},${((S - 1.5) * Math.sin(a)).toFixed(2)}`;
}).join(" ");

type Box = typeof FULL;

/** Axial hex coordinates spiralling out from the centre: 1, then 6, then 12 ... */
function spiral(n: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let k = 1; out.length < n; k++) {
    let q = -k, r = k;
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < k; j++) {
        out.push([q, r]);
        q += dirs[i][0];
        r += dirs[i][1];
      }
  }
  return out.slice(0, n);
}

function layout(data: MapData) {
  const pos: { x: number; y: number }[] = new Array(data.wards.length);
  const cities = cityGroups(data).map(({ name, idx }) => {
    const c = CITIES[name];
    const cells = spiral(idx.length);
    let radius = 0;
    idx.forEach((wi, j) => {
      const [q, r] = cells[j];
      const x = c.at[0] + S * Math.sqrt(3) * (q + r / 2);
      const y = c.at[1] + S * 1.5 * r;
      pos[wi] = { x, y };
      radius = Math.max(radius, Math.hypot(x - c.at[0], y - c.at[1]));
    });
    return { name, idx, cx: c.at[0], cy: c.at[1], radius: radius + S + 14 };
  });
  return { pos, cities };
}

/** View box that frames a city's circle plus its label, stretched to the map's aspect ratio. */
function fit(cx: number, cy: number, r: number, label: Side): Box {
  const pad = 24;
  const x0 = cx - r - (label === "left" ? 140 : 0) - pad;
  const x1 = cx + r + (label === "right" ? 140 : 0) + pad;
  const y0 = cy - r - (label === "above" ? 50 : 0) - pad;
  const y1 = cy + r + (label === "below" ? 45 : 0) + pad;
  const aspect = FULL.w / FULL.h;
  let w = Math.max(x1 - x0, 300);
  let h = Math.max(y1 - y0, 300 / aspect);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

export default function Honeycomb({ data, k, tiersOn, selected, onSelect, focus }: CanvasProps) {
  const { t, f, b } = useI18n();
  const narrow = useMedia("(max-width: 39.99rem)");
  const { pos, cities } = useMemo(() => layout(data), [data]);
  const [vb, setVb] = useState<Box>(FULL);
  const vbRef = useRef<Box>(FULL);
  const raf = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vb: Box; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const tierAt = (i: number) => data.tier[i][k];

  // ---------------------------------------------------------------- view box: animate, zoom, pan
  const jump = (b: Box) => {
    vbRef.current = b;
    setVb(b);
  };
  const animateTo = useCallback((to: Box) => {
    cancelAnimationFrame(raf.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return jump(to);
    const from = vbRef.current;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min((t - t0) / 550, 1);
      const e = 1 - Math.pow(1 - p, 3);
      jump({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const zoomBy = (f: number, cx?: number, cy?: number) => {
    const b = vbRef.current;
    const w = Math.min(Math.max(b.w * f, 180), FULL.w * 1.3);
    const h = (w * FULL.h) / FULL.w;
    const px = cx ?? b.x + b.w / 2;
    const py = cy ?? b.y + b.h / 2;
    animateTo({ x: px - ((px - b.x) * w) / b.w, y: py - ((py - b.y) * h) / b.h, w, h });
  };

  const zoomCity = useCallback(
    (name: string) => {
      const c = cities.find((c) => c.name === name)!;
      animateTo(fit(c.cx, c.cy, c.radius, CITIES[name].label));
    },
    [cities, animateTo],
  );

  useEffect(() => {
    if (focus.n === 0) return;
    if (focus.city) zoomCity(focus.city);
    else animateTo(FULL);
  }, [focus, zoomCity, animateTo]);

  const toSvg = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const b = vbRef.current;
    return { x: b.x + ((clientX - r.left) / r.width) * b.w, y: b.y + ((clientY - r.top) / r.height) * b.h };
  };

  // Ctrl/Cmd + wheel zooms around the cursor; plain scrolling keeps scrolling the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomBy(e.deltaY > 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, vb: vbRef.current, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > (e.pointerType === "touch" ? 10 : 4)) {
      d.moved = true;
      cancelAnimationFrame(raf.current);
      svgRef.current!.setPointerCapture(e.pointerId); // only once it is really a drag, so clicks still reach hexagons
      setHover(null);
    }
    if (d.moved) {
      const r = svgRef.current!.getBoundingClientRect();
      const scale = d.vb.w / r.width;
      jump({ ...d.vb, x: d.vb.x - dx * scale, y: d.vb.y - dy * scale });
    }
  };
  const onPointerUp = () => {
    justDragged.current = !!drag.current?.moved;
    drag.current = null;
  };

  const click = (i: number) => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    onSelect(i);
    // on a phone the full view is too small to read, so a tap also flies to that city
    if (narrow && vbRef.current.w > FULL.w * 0.8) zoomCity(data.wards[i].city);
  };

  // Text is drawn in map units, so it is enlarged on small screens (less so once zoomed in).
  const textScale = narrow ? Math.max(1, Math.min(1.9, (vb.w / FULL.w) * 1.9)) : 1;
  const hoverWard = hover ? data.wards[hover.i] : null;
  const displayFont = { fontFamily: "var(--font-space), var(--font-bengali), system-ui, sans-serif" };

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-2xl border border-accent/25 bg-[#08111f] shadow-[0_0_48px_-24px_rgb(45_212_191/0.6)]"
      style={{
        backgroundImage: "linear-gradient(rgb(140 188 212 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(140 188 212 / 0.06) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing max-sm:min-h-[420px]"
        style={{ aspectRatio: `${FULL.w} / ${FULL.h}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          onPointerUp();
          setHover(null);
        }}
        onDoubleClick={(e) => {
          const p = toSvg(e.clientX, e.clientY);
          zoomBy(0.6, p.x, p.y);
        }}
        role="group"
        aria-label={t.map.honeycombLabel}
      >
        <g transform="translate(955 48)" aria-hidden>
          <circle r="20" fill="#0e1a2b" stroke="#2dd4bf" strokeOpacity="0.45" />
          <path d="M0 -13 L6 6 L0 2 L-6 6 Z" fill="#2dd4bf" />
          <text y="-25" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e6eef7">{t.map.north}</text>
        </g>

        {/* orientation links between neighbouring regions, drawn from outline to outline */}
        {CITY_LINKS.map(([from, to]) => {
          const a = cities.find((c) => c.name === from)!;
          const b = cities.find((c) => c.name === to)!;
          const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
          // neighbouring circles may overlap; there is then no gap to bridge
          if (d <= a.radius + b.radius) return null;
          const ux = (b.cx - a.cx) / d;
          const uy = (b.cy - a.cy) / d;
          const line = { x1: a.cx + ux * a.radius, y1: a.cy + uy * a.radius, x2: b.cx - ux * b.radius, y2: b.cy - uy * b.radius };
          return (
            <g key={`${from}-${to}`} aria-hidden>
              <line {...line} stroke="#2dd4bf" strokeOpacity={0.25} />
              <line {...line} className="flow" stroke="#2dd4bf" strokeWidth={2} />
              <circle className="map-node" cx={line.x1} cy={line.y1} r={3.5} fill="#a8fff0" />
              <circle className="map-node" cx={line.x2} cy={line.y2} r={3.5} fill="#a8fff0" />
            </g>
          );
        })}

        {cities.map((c) => {
          const sum = citySummary(data, c.idx, k);
          const conf = CITIES[c.name];
          const note = conf.far && !narrow ? `${t.map.farNote} · ${t.map.notToScale}` : null;
          const side = conf.label === "left" || conf.label === "right";
          // on a phone the far-corner label is anchored to the right edge so it cannot run off the map
          const edge = narrow && conf.far;
          const lx = edge ? 995 : conf.label === "left" ? c.cx - c.radius - 12 : conf.label === "right" ? c.cx + c.radius + 12 : c.cx;
          const ly = side ? c.cy - 8 : conf.label === "below" ? c.cy + c.radius + 22 * textScale : c.cy - c.radius - (note ? 40 : 26 * textScale);
          const anchor = edge || conf.label === "left" ? "end" : conf.label === "right" ? "start" : "middle";
          return (
            <g key={c.name}>
              <circle className="city-ring" cx={c.cx} cy={c.cy} r={c.radius} fill="#0d2233" stroke="#2dd4bf" strokeOpacity={0.65} strokeWidth={1.3} />
              <circle cx={c.cx} cy={c.cy} r={c.radius - 7} fill="none" stroke="#2dd4bf" strokeOpacity={0.2} strokeDasharray="2 6" />
              <g className="cursor-pointer" onClick={() => zoomCity(c.name)}>
                <text x={lx} y={ly} textAnchor={anchor} fontSize={17 * textScale} fontWeight="600" fill="#e6eef7" style={displayFont}>
                  {b(c.name)}
                </text>
                {note && (
                  <text x={lx} y={ly + 16} textAnchor={anchor} fontSize="11" fill="#8ea3ba">
                    {note}
                  </text>
                )}
                <text x={lx} y={ly + (note ? 32 : 18 * textScale)} textAnchor={anchor} fontSize={12 * textScale} fontWeight="600" fill={sum.worst >= 2 ? TIER_COLOR[TIERS[sum.worst]] : "#8ea3ba"}>
                  {t.map.summary(sum.critical, sum.high)}
                </text>
              </g>
            </g>
          );
        })}

        {/* ripple under Critical wards; the SVG translate sits on a wrapper so the CSS scale animation can't override it */}
        {data.wards.map((_, i) =>
          tierAt(i) === 3 && tiersOn[3] ? (
            <g key={`p${i}`} transform={`translate(${pos[i].x} ${pos[i].y})`}>
              <polygon className="pulse" points={HEX_POINTS} fill="none" stroke={TIER_COLOR.Critical} strokeWidth={3} />
            </g>
          ) : null,
        )}

        {data.wards.map((w, i) => {
          const level = tierAt(i);
          const on = level != null && tiersOn[level];
          const isSel = selected === i;
          const pred = data.predicted[i][k];
          return (
            <g
              key={w.ward}
              className="hex cursor-pointer"
              transform={`translate(${pos[i].x} ${pos[i].y})`}
              opacity={on ? 1 : 0.13}
              role="button"
              tabIndex={0}
              aria-label={level == null ? t.map.hexNone(b(w.label)) : t.map.hex(b(w.label), TIERS[level], f.n(pred, 0))}
              aria-pressed={isSel}
              onClick={() => click(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === "touch" || drag.current?.moved) return; // touch screens use the ward sheet instead
                const r = wrapRef.current!.getBoundingClientRect();
                setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onPointerLeave={() => setHover((h) => (h?.i === i ? null : h))}
            >
              <polygon points={HEX_POINTS} fill={colorAt(data, i, k)} stroke={isSel ? "#fff" : "#06101c"} strokeWidth={isSel ? 3.5 : 1.5} />
              <text textAnchor="middle" dy="4" fontSize="11" fontWeight="700" fill={level === 3 || level == null ? "#fff" : "#06101c"} pointerEvents="none">
                {f.digits(w.num)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute right-3 bottom-3 z-[860] flex flex-col overflow-hidden rounded-xl border border-line bg-card/95">
        <ZoomBtn label={t.map.zoomIn} onClick={() => zoomBy(0.7)}>+</ZoomBtn>
        <ZoomBtn label={t.map.zoomOut} onClick={() => zoomBy(1.4)}>−</ZoomBtn>
        <ZoomBtn label={t.map.showEverything} onClick={() => animateTo(FULL)}>⤢</ZoomBtn>
      </div>

      {hover && hoverWard && (
        <div
          className="pointer-events-none absolute z-[880] w-56 rounded-xl border border-accent/40 bg-card/95 px-3 py-2 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.55)]"
          style={{ left: Math.max(8, Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 236)), top: Math.max(hover.y - 90, 8) }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{b(hoverWard.label)}</span>
            {tierAt(hover.i) != null && <TierPill tier={TIERS[tierAt(hover.i)!]} />}
          </div>
          <div className="mt-1">
            {t.map.about[0]}
            <b>{f.n(data.predicted[hover.i][k], 0)}</b>
            {t.map.about[1]}
          </div>
          <div className="text-xs text-muted">
            {t.map.tipLikely(f.n(data.lower[hover.i][k]), f.n(data.upper[hover.i][k]), f.n(data.cases_now[hover.i][k]))}
          </div>
          <div className="mt-1 text-xs text-accent">{t.map.details}</div>
        </div>
      )}
    </div>
  );
}

function ZoomBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-11 w-11 cursor-pointer place-items-center border-b border-line text-lg font-semibold transition last:border-b-0 hover:bg-accent-soft hover:text-accent lg:h-9 lg:w-9">
      {children}
    </button>
  );
}
