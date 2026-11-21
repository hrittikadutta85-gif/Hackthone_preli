"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { TIERS, TIER_COLOR, type MapData } from "@/lib/api";
import { TierPill } from "../ui";
import { colorAt, cityGroups, citySummary, type CanvasProps } from "./shared";

/*
 * Offline view: a schematic "honeycomb". Needs no internet. Each city corporation sits in its real direction from the
 * others and its wards are drawn as hexagons around it (not to scale).
 */
const S = 22; // hexagon corner radius, SVG units
const FULL = { x: 0, y: 0, w: 1000, h: 930 };
type Side = "left" | "right" | "below" | "above";
const CITIES: Record<string, { at: [number, number]; label: Side; note?: string }> = {
  Gazipur: { at: [400, 110], label: "right" },
  "Dhaka North": { at: [390, 345], label: "left" },
  "Dhaka South": { at: [380, 655], label: "left" },
  Narayanganj: { at: [640, 700], label: "below" },
  Chattogram: { at: [860, 800], label: "above", note: "≈220 km south-east of Dhaka" },
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
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
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
  };

  const hoverWard = hover ? data.wards[hover.i] : null;

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-2xl border border-line bg-[#f3eee4] shadow-sm">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
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
        aria-label="Map of wards coloured by dengue risk"
      >
        <g transform="translate(955 48)" aria-hidden>
          <circle r="20" fill="#fff" stroke="#e8e0d2" />
          <path d="M0 -13 L6 6 L0 2 L-6 6 Z" fill="#1d2a26" />
          <text y="-25" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1d2a26">N</text>
        </g>

        {cities.map((c) => {
          const sum = citySummary(data, c.idx, k);
          const conf = CITIES[c.name];
          const side = conf.label === "left" || conf.label === "right";
          const lx = conf.label === "left" ? c.cx - c.radius - 12 : conf.label === "right" ? c.cx + c.radius + 12 : c.cx;
          const ly = side ? c.cy - 8 : conf.label === "below" ? c.cy + c.radius + 22 : c.cy - c.radius - (conf.note ? 40 : 26);
          const anchor = conf.label === "left" ? "end" : conf.label === "right" ? "start" : "middle";
          return (
            <g key={c.name}>
              <circle cx={c.cx} cy={c.cy} r={c.radius} fill="#fffdf9" stroke="#e1d8c7" strokeWidth={1.5} />
              <g className="cursor-pointer" onClick={() => zoomCity(c.name)}>
                <text x={lx} y={ly} textAnchor={anchor} fontSize="17" fontWeight="650" fill="#1d2a26" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
                  {c.name}
                </text>
                {conf.note && (
                  <text x={lx} y={ly + 16} textAnchor={anchor} fontSize="11" fill="#5f6f69">
                    {conf.note} · not to scale
                  </text>
                )}
                <text x={lx} y={ly + (conf.note ? 32 : 18)} textAnchor={anchor} fontSize="12" fontWeight="600" fill={sum.worst >= 2 ? TIER_COLOR[TIERS[sum.worst]] : "#5f6f69"}>
                  {sum.text}
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
          const t = tierAt(i);
          const on = t != null && tiersOn[t];
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
              aria-label={`${w.label}: ${t == null ? "no forecast" : `${TIERS[t]} risk, about ${pred?.toFixed(0)} cases`}`}
              aria-pressed={isSel}
              onClick={() => click(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              }}
              onPointerEnter={(e) => {
                if (drag.current?.moved) return;
                const r = wrapRef.current!.getBoundingClientRect();
                setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onPointerLeave={() => setHover((h) => (h?.i === i ? null : h))}
            >
              <polygon points={HEX_POINTS} fill={colorAt(data, i, k)} stroke={isSel ? "#1d2a26" : "#fff"} strokeWidth={isSel ? 3.5 : 1.5} style={{ transition: "fill 0.35s ease" }} />
              <text textAnchor="middle" dy="4" fontSize="11" fontWeight="600" fill={t === 1 ? "#1d2a26" : "#fff"} pointerEvents="none">
                {w.num}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-sm">
        <ZoomBtn label="Zoom in" onClick={() => zoomBy(0.7)}>+</ZoomBtn>
        <ZoomBtn label="Zoom out" onClick={() => zoomBy(1.4)}>−</ZoomBtn>
        <ZoomBtn label="Show everything" onClick={() => animateTo(FULL)}>⤢</ZoomBtn>
      </div>

      {hover && hoverWard && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-lg"
          style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 236), top: Math.max(hover.y - 90, 8) }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{hoverWard.label}</span>
            {tierAt(hover.i) != null && <TierPill tier={TIERS[tierAt(hover.i)!]} />}
          </div>
          <div className="mt-1">
            About <b>{data.predicted[hover.i][k]?.toFixed(0)}</b> cases expected
          </div>
          <div className="text-xs text-muted">
            likely {data.lower[hover.i][k]}–{data.upper[hover.i][k]} · {data.cases_now[hover.i][k] ?? "?"} reported now
          </div>
          <div className="mt-1 text-xs text-accent">Click for details</div>
        </div>
      )}
    </div>
  );
}

function ZoomBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-9 w-9 place-items-center border-b border-line text-lg font-semibold transition last:border-b-0 hover:bg-paper">
      {children}
    </button>
  );
}
