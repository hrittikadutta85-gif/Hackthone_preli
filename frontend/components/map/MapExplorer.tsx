"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TIERS, TIER_COLOR, addDays, type MapData, type Tier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Collapsible, Segmented, Skeleton, TierPill } from "../ui";
import { Icon } from "../icons";
import Honeycomb from "./Honeycomb";
import { CITY_GEO, cityGroups, citySummary, type Focus } from "./shared";

// Leaflet needs `window`, so the street map only ever renders in the browser.
const StreetMap = dynamic(() => import("./StreetMap"), { ssr: false, loading: () => <Skeleton className="map-canvas" /> });

const SPEED_MS = 650;
const SMALL = "(max-width: 63.99rem)"; // phones and tablets: the ward panel becomes a bottom sheet
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
  const { t, f, b } = useI18n();
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
  const mapBox = useRef<HTMLDivElement>(null);

  const zoomCity = (city: string | null) => setFocus((current) => ({ city, n: current.n + 1 }));
  const toggleSelect = (i: number) => setSelected((s) => (s === i ? null : i));
  /** Chosen from a list: on small screens the map may be off screen, so bring it back. */
  const showOnMap = (city: string | null) => {
    zoomCity(city);
    if (window.matchMedia(SMALL).matches) mapBox.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // time-lapse: step one week at a time until the end
  useEffect(() => {
    if (!playing) return;
    if (k >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setOrigin(data.weeks[k + 1]), SPEED_MS);
    return () => clearTimeout(timer);
  }, [playing, k, last, data.weeks, setOrigin]);

  useEffect(() => {
    if (selected == null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const togglePlay = () => {
    if (!playing && k >= last) setOrigin(data.weeks[Math.max(0, last - 51)]); // replay the last year
    setPlaying(!playing);
  };

  const counts = TIERS.map((_, level) => data.wards.filter((_, i) => data.tier[i][k] === level).length);
  const hotspots = data.wards
    .map((w, i) => ({ i, w, p: data.predicted[i][k] ?? 0, level: data.tier[i][k] ?? 0 }))
    .filter((h) => tiersOn[h.level])
    .sort((a, b) => b.p - a.p)
    .slice(0, 8);
  const canvas = { data, k, tiersOn, selected, onSelect: toggleSelect, focus };
  const totalExpected = data.wards.reduce((sum, _, i) => sum + (data.predicted[i][k] ?? 0), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.map.levelsLabel}>
            {TIERS.map((tier, ti) => (
              <button
                key={tier}
                aria-pressed={tiersOn[ti]}
                onClick={() => setTiersOn((on) => on.map((v, j) => (j === ti ? !v : v)))}
                title={b(tierHelp[tier])}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition tap ${
                  tiersOn[ti] ? "border-line bg-raise font-medium hover:border-accent/50" : "border-dashed border-line bg-transparent text-muted line-through"
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[tier], opacity: tiersOn[ti] ? 1 : 0.35 }} />
                {t.common.tier[tier]} <span className="tabular-nums text-muted">{f.n(counts[ti])}</span>
              </button>
            ))}
            <button
              onClick={() => setTiersOn(tiersOn[0] || tiersOn[1] ? [false, false, true, true] : [true, true, true, true])}
              className="cursor-pointer rounded-full px-3 py-1 text-sm font-medium text-accent hover:underline tap"
            >
              {tiersOn[0] || tiersOn[1] ? t.map.onlyAlerts : t.map.showAll}
            </button>
          </div>
          <Segmented
            label={t.map.styleLabel}
            value={view}
            onChange={setView}
            className="max-sm:w-full"
            options={[
              { value: "street", label: t.map.street },
              { value: "offline", label: t.map.offline },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.map.timelapse}>
          <RoundBtn label={t.map.prevWeek} disabled={k === 0} onClick={() => { setPlaying(false); setOrigin(data.weeks[Math.max(0, k - 1)]); }}>‹</RoundBtn>
          <button onClick={togglePlay} aria-pressed={playing} className="btn btn-primary max-sm:flex-1">
            <Icon name={playing ? "pause" : "play"} className="h-3.5 w-3.5" /> {playing ? t.map.pause : t.map.play}
          </button>
          <RoundBtn label={t.map.nextWeek} disabled={k === last} onClick={() => { setPlaying(false); setOrigin(data.weeks[Math.min(last, k + 1)]); }}>›</RoundBtn>
          <span className="ml-1 text-sm text-muted max-sm:hidden">{t.map.watch}</span>
        </div>

        {view === "street" && tilesFailed && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-high/40 bg-high/10 px-4 py-2 text-sm">
            <span>{t.map.tilesFailed}</span>
            <button onClick={() => setView("offline")} className="cursor-pointer font-semibold text-accent hover:underline tap">
              {t.map.toOffline}
            </button>
          </div>
        )}

        {/* On phones the two information cards sit above and below the map instead of covering it. */}
        <div ref={mapBox} className="relative flex scroll-mt-20 flex-col gap-2">
          <div className="max-md:order-2">
            <div className="relative">
              {view === "street" ? <StreetMap {...canvas} onTilesFailed={() => setTilesFailed(true)} /> : <Honeycomb {...canvas} />}
              <div className="radar z-[850]" aria-hidden />
            </div>
          </div>
          <div className="panel panel-edge pointer-events-none z-[900] px-3.5 py-2.5 max-md:order-1 float-wide md:!absolute md:top-3 md:left-3 md:max-w-[60%] md:backdrop-blur">
            <div className="kicker">{t.map.forecastFor}</div>
            <div className="font-display mt-0.5 text-lg leading-tight font-semibold tabular-nums">{f.date(target, true)}</div>
            <div className="text-[11px] text-muted">{t.map.madeWith(f.date(data.weeks[k]), horizon)}</div>
          </div>
          <div className="panel pointer-events-none z-[900] px-3.5 py-2.5 max-md:order-3 float-wide md:!absolute md:bottom-10 md:left-3 md:max-w-[75%] md:backdrop-blur md:[animation-delay:-3s]">
            <div className="kicker">{t.map.radar(data.wards.length)}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                <b className="font-display text-xl tabular-nums">≈{f.int(Math.round(totalExpected))}</b>
                <span className="ml-1 text-[11px] text-muted">{t.common.casesExpected}</span>
              </span>
              {[3, 2].map((level) => (
                <span key={level} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 self-center rounded-full" style={{ background: TIER_COLOR[TIERS[level]] }} />
                  <b className="tabular-nums">{f.n(counts[level])}</b>
                  <span className="text-[11px] text-muted">{level === 3 ? t.map.critical : t.map.high}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted">{view === "street" ? t.map.streetNote : t.map.offlineNote}</p>
      </div>

      {/* a flex gap, not child margins: the fixed ward sheet must not be pushed off the bottom edge */}
      <aside className="flex min-w-0 flex-col gap-4" aria-live="polite">
        {selected != null && (
          <WardPanel data={data} i={selected} k={k} horizon={horizon} target={target} onClose={() => setSelected(null)} onCity={() => showOnMap(data.wards[selected].city)} />
        )}
        {/* The lists make way for the ward panel on wide screens; the phone sheet floats above them. */}
        <div className={`space-y-4 ${selected != null ? "lg:hidden" : ""}`}>
          <Collapsible title={t.map.hotspots} defaultOpen>
            <p className="mb-3 text-sm text-muted">{t.map.hotspotsDesc(horizon)}</p>
            <ol className="space-y-1">
              {hotspots.map((h, rank) => (
                <li key={h.w.ward}>
                  <button
                    onClick={() => {
                      setSelected(h.i);
                      showOnMap(h.w.city);
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-accent/35 hover:bg-accent-soft tap"
                  >
                    <span className="w-5 font-mono text-xs text-muted tabular-nums">{f.digits(String(rank + 1).padStart(2, "0"))}</span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_COLOR[TIERS[h.level]] }} title={t.common.tier[TIERS[h.level]]} />
                    <span className="min-w-0 flex-1 text-sm font-medium">{b(h.w.label)}</span>
                    <span className="text-sm tabular-nums">{f.n(h.p, 0)}</span>
                  </button>
                </li>
              ))}
              {hotspots.length === 0 && <li className="text-sm text-muted">{t.map.noneInFilter}</li>}
            </ol>
          </Collapsible>
          <Collapsible
            title={t.map.byCity}
            action={
              <button onClick={() => showOnMap(null)} className="cursor-pointer text-sm font-medium text-accent hover:underline tap">
                {t.map.showAll}
              </button>
            }
          >
            <ul className="mt-3 space-y-3">
              {groups.map((c) => {
                const s = citySummary(data, c.idx, k);
                const summary = t.map.summary(s.critical, s.high);
                return (
                  <li key={c.name}>
                    <button onClick={() => showOnMap(c.name)} className="-mx-2 w-[calc(100%+1rem)] cursor-pointer rounded-lg px-2 py-1 text-left transition hover:bg-accent-soft" aria-label={t.map.flyToSummary(b(c.name), summary)}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="font-medium">{b(c.name)}</span>
                        <span className="text-right text-xs" style={{ color: s.worst >= 2 ? TIER_COLOR[TIERS[s.worst]] : undefined }}>
                          {summary}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-muted">{f.latLon(...CITY_GEO[c.name].center)}</div>
                      <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-line">
                        {s.counts.map((count, level) => (
                          <div key={level} style={{ width: `${(count / c.idx.length) * 100}%`, background: TIER_COLOR[TIERS[level]] }} className="transition-all duration-300" />
                        ))}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Collapsible>
        </div>
      </aside>
    </div>
  );
}

/** Details of one ward: a side panel on wide screens, a compact sheet at the bottom of phones and tablets. */
function WardPanel({ data, i, k, horizon, target, onClose, onCity }: { data: MapData; i: number; k: number; horizon: number; target: string; onClose: () => void; onCity: () => void }) {
  const { t, f, b } = useI18n();
  const w = data.wards[i];
  const level = data.tier[i][k];
  const pred = data.predicted[i][k] ?? 0;
  const now = data.cases_now[i][k];
  const diff = now == null ? null : pred - now;
  const trend = diff == null || Math.abs(diff) < 1 ? t.map.trendSame : diff > 0 ? t.map.trendUp(now!) : t.map.trendDown(now!);

  // the last 16 weeks of the same forecast, to show whether risk is building
  const from = Math.max(0, k - 15);
  const series = data.predicted[i].slice(from, k + 1).map((v, j) => ({ v: v ?? 0, level: data.tier[i][from + j] ?? 0 }));
  const max = Math.max(...series.map((s) => s.v), 14);
  const W = 260, H = 70;
  const xy = (j: number, v: number) => [(j / Math.max(series.length - 1, 1)) * (W - 8) + 4, H - 6 - (v / max) * (H - 12)];

  return (
    <div data-testid="ward-panel" className="panel panel-edge rise ward-sheet p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:block">
          <p className="text-xs text-muted max-lg:order-2">{b(w.city)}</p>
          <h2 className="font-display text-2xl font-semibold">{t.map.ward(f.digits(w.num))}</h2>
          {level != null && <TierPill tier={TIERS[level]} className="lg:mt-2" />}
        </div>
        <button onClick={onClose} aria-label={t.map.close} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-raise hover:text-ink">
          <Icon name="close" />
        </button>
      </div>
      <div className="mt-2 flex items-baseline gap-2 lg:mt-3">
        <span className="font-display text-4xl font-semibold tabular-nums lg:text-5xl">{f.n(pred, 0)}</span>
        <span className="text-muted">{t.common.casesExpected}</span>
      </div>
      <p className="text-sm text-muted">{t.map.panelLine(f.date(target), f.n(data.lower[i][k]), f.n(data.upper[i][k]), trend)}</p>
      {data.actual[i][k] != null && <p className="mt-1 text-sm">{t.map.actually(data.actual[i][k]!)}</p>}

      <div className="mt-3 lg:mt-4">
        <p className="mb-1 text-xs text-muted">{t.map.lastWeeks(series.length)}</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-lg:h-14" role="img" aria-label={t.map.trendLabel}>
          <polyline fill="none" stroke="#b9c9c4" strokeWidth={2} points={series.map((s, j) => xy(j, s.v).join(",")).join(" ")} />
          {series.map((s, j) => {
            const [x, y] = xy(j, s.v);
            return <circle key={j} cx={x} cy={y} r={j === series.length - 1 ? 5 : 3} fill={TIER_COLOR[TIERS[s.level]]} />;
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 lg:mt-4">
        <Link href={`/ward/${w.ward}`} className="btn btn-primary">
          {t.map.fullForecast}
        </Link>
        <button onClick={onCity} className="btn">
          {t.map.flyTo(b(w.city))}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted max-lg:hidden">{t.map.aheadNote(horizon)}</p>
    </div>
  );
}

function RoundBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="btn h-8 w-8 shrink-0 !p-0 !text-lg max-lg:h-11 max-lg:w-11">
      {children}
    </button>
  );
}
