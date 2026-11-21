"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TIERS, TIER_COLOR, addDays, fmtDate, type MapData, type Tier } from "@/lib/api";
import { Segmented, Skeleton, TierPill } from "../ui";
import Honeycomb from "./Honeycomb";
import { cityGroups, citySummary, type Focus } from "./shared";

// Leaflet needs `window`, so the street map only ever renders in the browser.
const StreetMap = dynamic(() => import("./StreetMap"), { ssr: false, loading: () => <Skeleton className="h-[460px] sm:h-[620px]" /> });

const SPEED_MS = 650;
type View = "street" | "offline";

export function MapExplorer({
  data,
  origin,
  setOrigin,
  horizon,
  tierHelp,
}: {
  data: MapData;
  origin: string;
  setOrigin: (o: string) => void;
  horizon: number;
  tierHelp: Record<Tier, string>;
}) {
  const k = Math.max(0, data.weeks.indexOf(origin));
  const last = data.weeks.length - 1;
  const target = addDays(data.weeks[k], 7 * horizon);
  const groups = useMemo(() => cityGroups(data), [data]);

  const [view, setView] = useState<View>("street");
  const [tilesFailed, setTilesFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [tiersOn, setTiersOn] = useState<boolean[]>([true, true, true, true]);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<Focus>({ city: null, n: 0 });

  const zoomCity = (city: string | null) => setFocus((f) => ({ city, n: f.n + 1 }));
  const toggleSelect = (i: number) => setSelected((s) => (s === i ? null : i));

  // time-lapse: step one week at a time until the end
  useEffect(() => {
    if (!playing) return;
    if (k >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setOrigin(data.weeks[k + 1]), SPEED_MS);
    return () => clearTimeout(t);
  }, [playing, k, last, data.weeks, setOrigin]);

  const togglePlay = () => {
    if (!playing && k >= last) setOrigin(data.weeks[Math.max(0, last - 51)]); // replay the last year
    setPlaying(!playing);
  };

  const counts = TIERS.map((_, t) => data.wards.filter((_, i) => data.tier[i][k] === t).length);
  const hotspots = data.wards
    .map((w, i) => ({ i, w, p: data.predicted[i][k] ?? 0, t: data.tier[i][k] ?? 0 }))
    .filter((h) => tiersOn[h.t])
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  const canvas = { data, k, tiersOn, selected, onSelect: toggleSelect, focus };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show risk levels">
            {TIERS.map((t, ti) => (
              <button
                key={t}
                aria-pressed={tiersOn[ti]}
                onClick={() => setTiersOn((on) => on.map((v, j) => (j === ti ? !v : v)))}
                title={tierHelp[t]}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                  tiersOn[ti] ? "border-line bg-card font-medium" : "border-dashed border-line bg-transparent text-muted line-through"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[t], opacity: tiersOn[ti] ? 1 : 0.35 }} />
                {t} <span className="tabular-nums text-muted">{counts[ti]}</span>
              </button>
            ))}
            <button
              onClick={() => setTiersOn(tiersOn[0] || tiersOn[1] ? [false, false, true, true] : [true, true, true, true])}
              className="rounded-full px-3 py-1 text-sm font-medium text-accent hover:underline"
            >
              {tiersOn[0] || tiersOn[1] ? "Only High & Critical" : "Show all"}
            </button>
          </div>
          <Segmented
            label="Map style"
            value={view}
            onChange={setView}
            options={[
              { value: "street", label: "Street map" },
              { value: "offline", label: "Offline view" },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time-lapse">
          <RoundBtn label="Previous week" disabled={k === 0} onClick={() => { setPlaying(false); setOrigin(data.weeks[Math.max(0, k - 1)]); }}>‹</RoundBtn>
          <button onClick={togglePlay} aria-pressed={playing} className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow transition hover:shadow-md">
            <span aria-hidden>{playing ? "❚❚" : "▶"}</span> {playing ? "Pause" : "Play weeks"}
          </button>
          <RoundBtn label="Next week" disabled={k === last} onClick={() => { setPlaying(false); setOrigin(data.weeks[Math.min(last, k + 1)]); }}>›</RoundBtn>
          <span className="ml-1 text-sm text-muted">Watch the season build and fade, one week at a time.</span>
        </div>

        {view === "street" && tilesFailed && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-high/40 bg-high/5 px-4 py-2 text-sm">
            <span>The street map background needs internet and isn&apos;t loading.</span>
            <button onClick={() => setView("offline")} className="font-semibold text-accent hover:underline">
              Switch to the offline view
            </button>
          </div>
        )}

        <div className="relative">
          {view === "street" ? <StreetMap {...canvas} onTilesFailed={() => setTilesFailed(true)} /> : <Honeycomb {...canvas} />}
          <div className="pointer-events-none absolute top-3 left-3 z-[900] rounded-xl bg-card/90 px-3 py-2 shadow-sm backdrop-blur">
            <div className="text-[11px] tracking-wide text-muted uppercase">Forecast for week of</div>
            <div className="font-display text-lg leading-tight font-semibold tabular-nums">{fmtDate(target, true)}</div>
            <div className="text-[11px] text-muted">
              made with data up to {fmtDate(data.weeks[k])} · {horizon} wk ahead
            </div>
          </div>
        </div>

        <p className="text-xs text-muted">
          {view === "street" ? (
            <>
              Cities are at their real locations on an OpenStreetMap base map. The dataset has no ward boundaries or
              coordinates, so each ward&apos;s bubble is placed approximately inside its city (dashed circle). Bigger
              bubble = more expected cases. Zoom out to see one summary per city.
            </>
          ) : (
            <>
              Works without internet. Drag to move · double-click or + / − to zoom · click a city name to fly to it.
              Wards are drawn as a honeycomb around each city; cities are in their real direction from each other but
              not to scale.
            </>
          )}
        </p>
      </div>

      <aside className="space-y-4" aria-live="polite">
        {selected != null ? (
          <WardPanel data={data} i={selected} k={k} horizon={horizon} target={target} onClose={() => setSelected(null)} onCity={() => zoomCity(data.wards[selected].city)} />
        ) : (
          <>
            <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold">Hotspots this week</h2>
              <p className="mb-3 text-sm text-muted">Highest expected cases {horizon === 1 ? "next week" : `in ${horizon} weeks`}. Click one to find it on the map.</p>
              <ol className="space-y-1">
                {hotspots.map((h, n) => (
                  <li key={h.w.ward}>
                    <button
                      onClick={() => {
                        setSelected(h.i);
                        zoomCity(h.w.city);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-paper"
                    >
                      <span className="w-4 text-xs text-muted tabular-nums">{n + 1}</span>
                      <span className="h-3 w-3 rounded-sm" style={{ background: TIER_COLOR[TIERS[h.t]] }} />
                      <span className="flex-1 text-sm font-medium">{h.w.label}</span>
                      <span className="text-sm tabular-nums">{h.p.toFixed(0)}</span>
                    </button>
                  </li>
                ))}
                {hotspots.length === 0 && <li className="text-sm text-muted">No wards match the filter.</li>}
              </ol>
            </div>
            <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl font-semibold">By city</h2>
                <button onClick={() => zoomCity(null)} className="text-sm font-medium text-accent hover:underline">
                  Show all
                </button>
              </div>
              <ul className="mt-3 space-y-3">
                {groups.map((c) => {
                  const s = citySummary(data, c.idx, k);
                  return (
                    <li key={c.name}>
                      <button onClick={() => zoomCity(c.name)} className="w-full text-left" aria-label={`Fly to ${c.name}: ${s.text}`}>
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs" style={{ color: s.worst >= 2 ? TIER_COLOR[TIERS[s.worst]] : undefined }}>
                            {s.text}
                          </span>
                        </div>
                        <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-line">
                          {s.counts.map((n, t) => (
                            <div key={t} style={{ width: `${(n / c.idx.length) * 100}%`, background: TIER_COLOR[TIERS[t]] }} className="transition-all duration-300" />
                          ))}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function WardPanel({ data, i, k, horizon, target, onClose, onCity }: { data: MapData; i: number; k: number; horizon: number; target: string; onClose: () => void; onCity: () => void }) {
  const w = data.wards[i];
  const t = data.tier[i][k];
  const pred = data.predicted[i][k] ?? 0;
  const now = data.cases_now[i][k];
  const diff = now == null ? null : pred - now;
  const trend = diff == null || Math.abs(diff) < 1 ? "about the same as now" : diff > 0 ? `up from ${now} now` : `down from ${now} now`;

  // the last 16 weeks of the same forecast, to show whether risk is building
  const from = Math.max(0, k - 15);
  const series = data.predicted[i].slice(from, k + 1).map((v, j) => ({ v: v ?? 0, t: data.tier[i][from + j] ?? 0 }));
  const max = Math.max(...series.map((s) => s.v), 14);
  const W = 260, H = 70;
  const xy = (j: number, v: number) => [(j / Math.max(series.length - 1, 1)) * (W - 8) + 4, H - 6 - (v / max) * (H - 12)];

  return (
    <div className="rise rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{w.city}</p>
          <h2 className="font-display text-2xl font-semibold">Ward {w.num}</h2>
        </div>
        <button onClick={onClose} aria-label="Close ward details" className="rounded-full px-2 text-lg text-muted hover:text-ink">
          ✕
        </button>
      </div>
      {t != null && <TierPill tier={TIERS[t]} className="mt-2" />}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl font-semibold tabular-nums">{pred.toFixed(0)}</span>
        <span className="text-muted">cases expected</span>
      </div>
      <p className="text-sm text-muted">
        Week of {fmtDate(target)} · likely {data.lower[i][k]}–{data.upper[i][k]} · {trend}
      </p>
      {data.actual[i][k] != null && (
        <p className="mt-1 text-sm">
          What actually happened: <b>{data.actual[i][k]}</b> {data.actual[i][k] === 1 ? "case" : "cases"}
        </p>
      )}

      <div className="mt-4">
        <p className="mb-1 text-xs text-muted">Expected cases over the last {series.length} weeks</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Recent trend of expected cases">
          <polyline fill="none" stroke="#c9d3cf" strokeWidth={2} points={series.map((s, j) => xy(j, s.v).join(",")).join(" ")} />
          {series.map((s, j) => {
            const [x, y] = xy(j, s.v);
            return <circle key={j} cx={x} cy={y} r={j === series.length - 1 ? 5 : 3} fill={TIER_COLOR[TIERS[s.t]]} />;
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/ward/${w.ward}`} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow hover:shadow-md">
          Full forecast & actions →
        </Link>
        <button onClick={onCity} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-accent/50">
          Fly to {w.city}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">Forecast {horizon} week{horizon > 1 ? "s" : ""} ahead. Change it with “Warn me” at the top.</p>
    </div>
  );
}

function RoundBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-card text-lg font-semibold transition hover:bg-paper disabled:opacity-30">
      {children}
    </button>
  );
}
