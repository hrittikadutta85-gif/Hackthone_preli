"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  ArrowRight,
  BedDouble,
  BellRing,
  Droplets,
  MapPin,
  Minus,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Sun,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { TIER_COLOR, TIERS, addDays, downloadCsv, useCity, useMap, type CityWard, type MapData, type Tier } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { getJson } from "@/lib/http";
import { permissionFor, useAuth } from "@/lib/auth";
import { describe, useAlertSummary, useClientId, LEVEL_COLOR } from "@/lib/alerts";
import type { BedOutlook } from "@/lib/area";
import { AnimatedNumber, Card, ErrorNote, Segmented, Skeleton, TierPill, tierGlow, useMedia } from "@/components/ui";
import { Icon, MosquitoArt } from "@/components/icons";
import { Heatmap } from "@/components/Heatmap";
import { Outlook } from "@/components/Outlook";
import { LevelPill } from "@/components/alerts/AlertCard";
import Honeycomb from "@/components/map/Honeycomb";
import type { Focus } from "@/components/map/shared";

// Leaflet needs `window`, so the street map only ever renders in the browser.
const StreetMap = dynamic(() => import("@/components/map/StreetMap"), { ssr: false, loading: () => <Skeleton className="h-[24rem] sm:h-[28rem]" /> });

/** Area Intelligence location ids of the five city corporations the forecasts cover. */
const CITY_LOCATION: Record<string, string> = {
  "Dhaka North": "cc:DNCC",
  "Dhaka South": "cc:DSCC",
  Chattogram: "cc:CCC",
  Gazipur: "cc:GCC",
  Narayanganj: "cc:NCC",
};

/** Indexes of the map's wards that belong to a city (all wards when no city is chosen). */
const wardIndexes = (m: MapData, city: string | null) => m.wards.flatMap((w, i) => (!city || w.city === city ? [i] : []));
const sumAt = (grid: (number | null)[][], idx: number[], k: number) => {
  let total = 0;
  let known = 0;
  for (const i of idx) {
    const v = grid[i]?.[k];
    if (v != null) {
      total += v;
      known++;
    }
  }
  return known ? total : null;
};

/** Estimated dengue beds for the chosen city (or all five), from the same estimate Area Intelligence shows. */
function useBedEstimate(cities: string[], origin: string | null) {
  const ids = cities.map((c) => CITY_LOCATION[c]).filter(Boolean);
  return useSWR(
    origin && ids.length ? ["dash-beds", origin, ids.join(",")] : null,
    async ([, o, list]: [string, string, string]) => {
      const all = await Promise.all(list.split(",").map((id) => getJson<{ estimate: BedOutlook }>(`/api/locations/${encodeURIComponent(id)}/beds?as_of=${o}`)));
      const est = all.map((a) => a.estimate).filter((e) => e.available && e.capacity != null && e.left_now != null);
      if (!est.length) return null;
      const capacity = est.reduce((s, e) => s + (e.capacity ?? 0), 0);
      const left = est.reduce((s, e) => s + (e.left_now ?? 0), 0);
      return { capacity, left };
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );
}

export default function Overview() {
  const { t, f, b } = useI18n();
  const { meta, origin, horizon } = useControls();
  const [city, setCity] = useState<string | null>("Dhaka South");
  const [tier, setTier] = useState<Tier | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus>({ city: null, n: 0 });
  const { data, error, isLoading } = useCity(origin, horizon, city);
  const { data: map } = useMap(horizon);

  const pickCity = (c: string | null) => {
    setCity(c);
    setFocus((cur) => ({ city: c, n: cur.n + 1 }));
  };

  const exportCsv = () =>
    data &&
    downloadCsv(
      `dengue-risk_${(city ?? "all-cities").replace(/\s+/g, "-").toLowerCase()}_${data.origin}_${horizon}wk.csv`,
      // column names and numbers stay machine-readable; names and risk levels follow the language
      wards.map((w) => ({
        ward_id: w.ward,
        ward: b(w.label),
        city: b(w.city),
        forecast_week: addDays(data.origin, 7 * horizon),
        expected_cases: w.predicted,
        likely_low: w.lower,
        likely_high: w.upper,
        risk_score: w.score,
        risk_level: t.common.tier[w.tier],
        cases_this_week: w.cases_now,
      })),
    );

  // ward names can be searched in either language, with either kind of digit (about 60 wards: no memo needed)
  const q = toLatinDigits(query.trim().toLowerCase());
  const wards = data
    ? data.wards.filter((w) => (!tier || w.tier === tier) && (!q || w.label.toLowerCase().includes(q) || toLatinDigits(b(w.label)).includes(q)))
    : [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <Hero wardCount={data?.wards.length ?? null} summary={data ? b(data.summary) : null} />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.common.cityGroup}>
        <span className="kicker mr-1 flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {t.common.cityGroup}
        </span>
        {[null, ...(meta?.cities ?? [])].map((c) => (
          <button key={c ?? "all"} onClick={() => pickCity(c)} aria-pressed={city === c} className="btn aria-[pressed=false]:text-muted">
            {c ? b(c) : t.common.allCities}
          </button>
        ))}
      </div>

      <StatCards data={data ?? null} map={map ?? null} city={city} />

      <div className="grid gap-6 lg:grid-cols-3">
        <RiskMapCard map={map ?? null} focus={focus} className="lg:col-span-2" />
        <AlertsPanel city={city} />
      </div>

      <ForecastCard city={city} />

      <div>
        <p className="mb-1 max-w-2xl text-sm text-muted">
          {t.overview.subtitle(data ? f.date(addDays(data.origin, 7 * horizon), true) : "…", origin ? f.date(origin, true) : "…")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TIERS.map((level) => {
          const count = data?.counts[level] ?? 0;
          const on = tier === level;
          return (
            <button
              key={level}
              onClick={() => setTier(on ? null : level)}
              aria-pressed={on}
              className="panel panel-hover min-w-0 cursor-pointer overflow-hidden p-3 text-left sm:p-4"
              style={tierGlow(level, on)}
            >
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1" style={{ background: TIER_COLOR[level] }} />
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_COLOR[level] }} />
                {t.common.tier[level]}
              </div>
              <div className="font-display mt-1 text-4xl font-semibold tabular-nums">
                <AnimatedNumber value={count} />
              </div>
              <div className="text-xs text-muted">{meta ? b(meta.tier_help[level]) : ""}</div>
            </button>
          );
        })}
      </div>

      <Outlook origin={origin} city={city} onPick={pickCity} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">
          {tier ? t.overview.tierWards(tier) : t.overview.allWards}
          <span className="ml-2 text-base font-normal text-muted">{t.overview.shown(wards.length)}</span>
        </h2>
        <div className="flex flex-wrap gap-2 max-sm:w-full">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.overview.findPlaceholder}
            aria-label={t.overview.findLabel}
            className="field w-56 rounded-xl px-4 py-2 text-sm max-sm:w-full"
          />
          <button onClick={exportCsv} disabled={!data || wards.length === 0} className="btn max-sm:w-full">
            <Icon name="download" /> {t.overview.download}
          </button>
        </div>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : isLoading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : wards.length === 0 ? (
        <Card>
          <p className="text-muted">{t.overview.noMatch}</p>
        </Card>
      ) : (
        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {wards.slice(0, 24).map((w, i) => (
            <WardTile key={w.ward} w={w} i={i} showCity={!city} horizon={horizon} />
          ))}
        </div>
      )}
      {wards.length > 24 && <p className="text-sm text-muted">{t.overview.showingTop(wards.length)}</p>}

      {data && (
        <Card>
          <h2 className="font-display text-2xl font-semibold">{t.overview.heatTitle}</h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">{t.overview.heatDesc(horizon)}</p>
          <Heatmap data={data.heatmap} />
        </Card>
      )}

      <Prevention />
    </div>
  );
}

/* ------------------------------------------------------------------ hero */
function Hero({ wardCount, summary }: { wardCount: number | null; summary: string | null }) {
  const { t, f } = useI18n();
  const { origin, horizon } = useControls();
  const d = t.dash;
  return (
    <section className="panel rise overflow-hidden" style={{ background: "linear-gradient(105deg, #ffffff 50%, var(--accent-soft) 100%)" }}>
      <div className="grid items-center gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="eyebrow">{t.overview.eyebrow}</p>
          <h1 className="font-display mt-2 text-4xl font-semibold text-ink sm:text-5xl">{d.title}</h1>
          <p className="font-display mt-2 text-lg font-medium text-accent">{d.tagline}</p>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">{d.text}</p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
            {origin && <Chip icon={Activity}>{d.weekChip(f.date(origin, true))}</Chip>}
            {wardCount != null && <Chip icon={MapPin}>{d.wardsChip(wardCount)}</Chip>}
            <Chip icon={BellRing}>{d.windowChip(horizon)}</Chip>
          </ul>
          {summary ? (
            <p className="mt-5 max-w-2xl rounded-xl border border-accent/15 bg-card/80 px-4 py-3 text-[0.95rem] leading-relaxed text-ink">{summary}</p>
          ) : (
            <Skeleton className="mt-5 h-14 max-w-2xl" />
          )}
        </div>
        <div className="relative mx-auto hidden h-56 w-56 shrink-0 sm:block lg:h-64 lg:w-64" role="img" aria-label={d.artLabel}>
          <div className="absolute inset-0 rounded-full bg-accent-soft" />
          <div className="absolute inset-4 rounded-full border border-dashed border-accent-2/60" />
          <div className="absolute inset-10 rounded-full border border-accent-2/40" />
          <MosquitoArt className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] rotate-[14deg]" />
          <span className="absolute right-3 bottom-5 grid h-12 w-12 place-items-center rounded-2xl bg-card text-accent shadow-[var(--shadow)]">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
        </div>
      </div>
    </section>
  );
}

function Chip({ icon: Ic, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-ink/85">
      <Ic className="h-3.5 w-3.5 text-accent" aria-hidden />
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ statistics */
type Trend = { dir: "up" | "down" | "same"; text: string; vs: string } | null;

function trendOf(now: number | null, before: number | null, vs: string, d: ReturnType<typeof useI18n>["t"]["dash"]["stats"], pct: (v: number) => string): Trend {
  if (now == null || before == null) return null;
  if (Math.round(now) === Math.round(before)) return { dir: "same", text: d.same, vs };
  if (before <= 0) return null; // a percentage change from zero means nothing
  const change = ((now - before) / before) * 100;
  return { dir: change > 0 ? "up" : "down", text: change > 0 ? d.up(pct(Math.abs(change))) : d.down(pct(Math.abs(change))), vs };
}

function StatCards({ data, map, city }: { data: import("@/lib/api").CityView | null; map: MapData | null; city: string | null }) {
  const { t, f } = useI18n();
  const { meta, origin, horizon } = useControls();
  const d = t.dash.stats;
  const beds = useBedEstimate(city ? [city] : (meta?.cities ?? []), origin);
  const pct = (v: number) => `${f.n(v, 0)}%`;

  const casesNow = data ? data.wards.reduce((s, w) => s + (w.cases_now ?? 0), 0) : null;
  const predicted = data ? data.wards.reduce((s, w) => s + w.predicted, 0) : null;
  let casesBefore: number | null = null;
  if (map && origin) {
    const k = map.weeks.indexOf(origin);
    if (k > 0) casesBefore = sumAt(map.cases_now, wardIndexes(map, city), k - 1);
  }
  const worst = data ? ([...TIERS].reverse().find((lvl) => data.counts[lvl] > 0) ?? "Low") : null;
  const alertWards = data ? data.counts.High + data.counts.Critical : 0;
  const target = origin ? addDays(origin, 7 * horizon) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={Activity}
        label={d.cases}
        value={casesNow == null ? null : f.int(casesNow)}
        note={origin ? d.casesNote(f.date(origin, true)) : ""}
        trend={trendOf(casesNow, casesBefore, d.vsLastWeek, d, pct)}
      />
      <StatCard
        icon={ShieldAlert}
        label={d.risk}
        value={worst ? t.common.tier[worst] : null}
        valueColor={worst ? `color-mix(in srgb, ${TIER_COLOR[worst]} 70%, var(--ink))` : undefined}
        note={d.riskNote(alertWards)}
        extra={
          data && (
            <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full bg-line" aria-hidden>
              {TIERS.map((lvl) => (
                <div key={lvl} style={{ width: `${(data.counts[lvl] / Math.max(data.wards.length, 1)) * 100}%`, background: TIER_COLOR[lvl] }} />
              ))}
            </div>
          )
        }
      />
      <StatCard
        icon={TrendingUp}
        label={d.predicted}
        value={predicted == null ? null : f.int(Math.round(predicted))}
        note={target ? d.predictedNote(f.date(target, true)) : ""}
        trend={trendOf(predicted, casesNow, d.vsThisWeek, d, pct)}
      />
      <StatCard
        icon={BedDouble}
        label={d.beds}
        value={beds.data ? f.int(beds.data.left) : beds.data === null ? "—" : null}
        unit={beds.data ? d.bedsOf(f.int(beds.data.capacity)) : undefined}
        note={beds.data === null ? d.bedsNone : d.bedsNote}
        extra={
          beds.data && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (beds.data.left / Math.max(beds.data.capacity, 1)) * 100)}%`,
                  background: beds.data.left <= 0 ? "var(--critical)" : beds.data.left / Math.max(beds.data.capacity, 1) < 0.25 ? "var(--medium)" : "var(--low)",
                }}
              />
            </div>
          )
        }
      />
    </div>
  );
}

function StatCard({
  icon: Ic,
  label,
  value,
  unit,
  note,
  trend,
  valueColor,
  extra,
}: {
  icon: LucideIcon;
  label: string;
  value: string | null;
  unit?: string;
  note: string;
  trend?: Trend;
  valueColor?: string;
  extra?: React.ReactNode;
}) {
  // more cases is bad news, so "up" is shown in the risk colour and "down" in green
  const tone = trend?.dir === "up" ? "bg-critical/10 text-critical-ink" : trend?.dir === "down" ? "bg-low/15 text-low" : "bg-raise text-muted";
  const TrendIcon = trend?.dir === "up" ? TrendingUp : trend?.dir === "down" ? TrendingDown : Minus;
  return (
    <div className="panel panel-hover rise min-w-0 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Ic className="h-5 w-5" aria-hidden />
        </span>
      </div>
      {value == null ? (
        <Skeleton className="mt-1 h-9 w-28" />
      ) : (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-3xl font-semibold tabular-nums" style={valueColor ? { color: valueColor } : undefined}>
            {value}
          </span>
          {unit && <span className="text-xs text-muted">{unit}</span>}
        </p>
      )}
      <p className="mt-1 text-xs leading-snug text-muted">{note}</p>
      {trend && (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${tone}`}>
            <TrendIcon className="h-3.5 w-3.5" aria-hidden />
            {trend.text}
          </span>
          <span className="text-muted">{trend.vs}</span>
        </p>
      )}
      {extra}
    </div>
  );
}

/* ------------------------------------------------------------------ risk map */
function RiskMapCard({ map, focus, className = "" }: { map: MapData | null; focus: Focus; className?: string }) {
  const { t, f, b } = useI18n();
  const { origin, horizon } = useControls();
  const [selected, setSelected] = useState<number | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const k = map && origin ? Math.max(0, map.weeks.indexOf(origin)) : 0;
  const canvas = map ? { data: map, k, tiersOn: [true, true, true, true], selected, onSelect: (i: number) => setSelected((s) => (s === i ? null : i)), focus } : null;
  const sel = map && selected != null ? map.wards[selected] : null;
  const selLevel = map && selected != null ? map.tier[selected][k] : null;

  return (
    <section className={`panel min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold">{t.dash.map.title}</h2>
          <p className="mt-0.5 text-sm text-muted">{origin ? t.dash.map.desc(f.date(addDays(origin, 7 * horizon), true), horizon) : ""}</p>
        </div>
        <Link href="/map" className="btn shrink-0 text-xs">
          {t.dash.map.open}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label={t.dash.map.legend}>
        <li className="kicker">{t.dash.map.legend}</li>
        {TIERS.map((lvl) => (
          <li key={lvl} className="flex items-center gap-1.5 font-medium">
            <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: TIER_COLOR[lvl] }} aria-hidden />
            {t.common.tier[lvl]}
          </li>
        ))}
      </ul>
      <div className="mt-3 [&_.map-canvas]:h-[24rem] [&_.map-canvas]:min-h-0 sm:[&_.map-canvas]:h-[28rem]">
        {!canvas ? (
          <Skeleton className="h-[24rem] sm:h-[28rem]" />
        ) : tilesFailed ? (
          <>
            <p role="status" className="mb-2 text-xs text-muted">{t.dash.map.tilesFailed}</p>
            <Honeycomb {...canvas} />
          </>
        ) : (
          <StreetMap {...canvas} onTilesFailed={() => setTilesFailed(true)} />
        )}
      </div>
      {sel && map && selected != null && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raise px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="kicker">{t.dash.map.selected}</p>
            <p className="font-semibold">{b(sel.label)}</p>
            <p className="text-xs text-muted">
              ≈{f.n(map.predicted[selected][k], 0)} {t.common.casesExpected}
            </p>
          </div>
          {selLevel != null && <TierPill tier={TIERS[selLevel]} />}
          <Link href={`/ward/${sel.ward}`} className="btn btn-primary text-xs">
            {t.dash.map.openWard}
          </Link>
          <button onClick={() => setSelected(null)} className="btn text-xs text-muted">
            {t.dash.map.clear}
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ alerts */
function AlertsPanel({ city }: { city: string | null }) {
  const { t, f, b } = useI18n();
  const { origin } = useControls();
  const client = useClientId();
  const { data, isLoading } = useAlertSummary(client, origin);
  const all = data?.latest ?? data?.alerts ?? [];
  const list = all.filter((a) => a.status !== "resolved" && (!city || a.city === city)).slice(0, 5);

  return (
    <section className="panel flex min-w-0 flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
          <BellRing className="h-5 w-5 text-accent" aria-hidden />
          {t.dash.alerts.title}
        </h2>
        {data && data.counts.new > 0 && <span className="rounded-full bg-critical/10 px-2 py-0.5 text-xs font-semibold text-critical-ink">{f.n(data.counts.new)}</span>}
      </div>
      <div className="mt-3 flex-1 space-y-2.5">
        {isLoading && !data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)
        ) : list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t.dash.alerts.none}</p>
        ) : (
          list.map((a) => (
            <article key={a.id} className="relative rounded-xl border border-line bg-card p-3 pl-4 transition hover:border-accent/30 hover:bg-raise">
              <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: LEVEL_COLOR[a.level] }} />
              <div className="flex flex-wrap items-center gap-2">
                <LevelPill level={a.level} />
                <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">{t.alerts.type[a.alert_type]}</span>
              </div>
              <Link href={`/ward/${a.ward_id}`} className="mt-1 block text-sm font-semibold hover:text-accent">
                {b(a.label)}
              </Link>
              <p className="mt-0.5 line-clamp-2 text-xs text-ink/80">{describe(a, t, f)}</p>
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                <span>{t.dash.alerts.raised(f.date(a.alert_week, true))}</span>
                <span>{t.alerts.expected(f.date(a.target_week, true))}</span>
              </p>
            </article>
          ))
        )}
      </div>
      <Link href="/alerts" className="btn mt-4 w-full text-sm">
        {t.dash.alerts.viewAll}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ forecast chart */
type FPoint = { date: string; actual?: number | null; predicted?: number | null };

function ForecastTip({ active, payload, label }: { active?: boolean; payload?: { payload: FPoint }[]; label?: string }) {
  const { t, f } = useI18n();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-[var(--shadow-lg)]">
      <div className="font-semibold">{t.common.weekOf(f.date(label!, true))}</div>
      {p.actual != null && (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent-2" aria-hidden />
          {t.dash.forecast.actual}: <b className="tabular-nums">{f.int(p.actual)}</b>
        </div>
      )}
      {p.predicted != null && (
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded bg-accent" aria-hidden />
          {t.dash.forecast.predicted}: <b className="tabular-nums">{f.n(p.predicted, 0)}</b>
        </div>
      )}
    </div>
  );
}

function ForecastCard({ city }: { city: string | null }) {
  const { t, f, b } = useI18n();
  const { origin, horizon } = useControls();
  const phone = useMedia("(max-width: 39.99rem)");
  const [fh, setFh] = useState<number>([1, 2, 4].includes(horizon) ? horizon : 2);
  const { data: m } = useMap(fh);

  const rows = useMemo(() => {
    if (!m || !origin) return [];
    const k = m.weeks.indexOf(origin);
    if (k < 0) return [];
    const idx = wardIndexes(m, city);
    const from = Math.max(0, k - 25);
    const byDate = new Map<string, FPoint>();
    const row = (date: string) => byDate.get(date) ?? byDate.set(date, { date }).get(date)!;
    // recorded cases up to this week; nothing after it is known yet
    for (let j = from; j <= k; j++) row(m.weeks[j]).actual = sumAt(m.cases_now, idx, j);
    // each forecast is plotted at the week it is for
    for (let j = Math.max(0, from - fh); j <= k; j++) {
      const target = addDays(m.weeks[j], 7 * fh);
      if (target < m.weeks[from]) continue;
      const v = sumAt(m.predicted, idx, j);
      if (v != null) row(target).predicted = Math.round(v * 10) / 10;
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [m, origin, city, fh]);

  const area = city ? b(city) : t.common.allCities;
  return (
    <section id="forecast" className="panel scroll-mt-24 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold">
            {t.dash.forecast.title} <span className="text-base font-normal text-muted">· {area}</span>
          </h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted">{t.dash.forecast.desc}</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="kicker">{t.dash.forecast.windowLabel}</span>
          <Segmented label={t.dash.forecast.windowLabel} value={fh} onChange={setFh} options={[1, 2, 4].map((h) => ({ value: h, label: t.dash.forecast.days(h * 7) }))} />
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent-2" aria-hidden />
          {t.dash.forecast.actual}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-[3px] w-4 rounded bg-accent" aria-hidden />
          {t.dash.forecast.predicted}
        </li>
      </ul>
      {!m ? (
        <Skeleton className="mt-3 h-72" />
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{t.dash.forecast.empty}</p>
      ) : (
        <div role="img" aria-label={t.dash.forecast.chartLabel(area)} className="mt-3 h-72 w-full sm:h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 18, right: phone ? 6 : 16, bottom: 0, left: phone ? -24 : -10 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => f.date(d)} tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} allowDecimals={false} tickFormatter={(v) => f.n(v)} />
              <Tooltip content={<ForecastTip />} />
              {origin && <ReferenceLine x={origin} stroke="var(--accent)" strokeDasharray="3 3" label={{ value: t.dash.forecast.now, position: "top", fontSize: 11, fill: "var(--accent)" }} />}
              <Bar dataKey="actual" fill="var(--accent-2)" fillOpacity={0.75} radius={[4, 4, 0, 0]} animationDuration={600} />
              <Line dataKey="predicted" stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls animationDuration={600} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{t.dash.forecast.note}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ prevention */
const TIP_ICONS: LucideIcon[] = [Droplets, Sun, ShieldCheck, Stethoscope];

function Prevention() {
  const { t } = useI18n();
  const { user } = useAuth();
  const p = t.dash.prevention;
  const planPerm = permissionFor("/plan");
  const canPlan = !planPerm || !!user?.permissions.includes(planPerm);
  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div className="panel relative overflow-hidden p-5 sm:p-6">
          <p className="eyebrow">{p.eyebrow}</p>
          <h2 className="font-display mt-2 text-2xl font-semibold">{p.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{p.intro}</p>
          <div className="relative mx-auto mt-4 h-40 w-40" aria-hidden>
            <div className="absolute inset-0 rounded-full bg-accent-soft" />
            <MosquitoArt className="absolute inset-2 h-36 w-36 -rotate-12" />
            <span className="absolute -right-1 top-3 grid h-10 w-10 place-items-center rounded-full bg-card text-critical-ink shadow-[var(--shadow)]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="8" />
                <path d="M6.5 6.5l11 11" />
              </svg>
            </span>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {p.tips.map((tip, i) => {
            const Ic = TIP_ICONS[i % TIP_ICONS.length];
            return (
              <li key={tip.title} className="panel panel-hover p-4 sm:p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Ic className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{tip.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{tip.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-5 text-white sm:px-7" style={{ background: "linear-gradient(120deg, #287f75, #1f6a61)" }}>
        <div className="min-w-0 max-w-2xl">
          <h3 className="font-display text-lg font-semibold">{p.ctaTitle}</h3>
          <p className="mt-1 text-sm text-white/80">{p.ctaText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPlan && (
            <Link href="/plan" className="btn border-transparent bg-white font-semibold text-accent hover:!bg-accent-soft">
              {p.ctaPlan}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link href="/how-it-works" className="btn border-white/30 bg-transparent text-white hover:!border-white/60 hover:!bg-white/10">
            {p.ctaHow}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ ward tile (unchanged behaviour) */
function WardTile({ w, i, showCity, horizon }: { w: CityWard; i: number; showCity: boolean; horizon: number }) {
  const { t, f, b } = useI18n();
  const diff = w.cases_now == null ? null : w.predicted - w.cases_now;
  const trend = diff == null || Math.abs(diff) < 1 ? t.overview.trend.steady : diff > 0 ? t.overview.trend.rising : t.overview.trend.easing;
  return (
    <Link
      href={`/ward/${w.ward}`}
      className="rise panel panel-hover group block min-w-0 overflow-hidden p-4 focus-visible:outline-2 focus-visible:outline-accent"
      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
    >
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: TIER_COLOR[w.tier] }} />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <div className="font-semibold">{b(w.label).split(",")[0]}</div>
          {showCity && <div className="text-xs text-muted">{b(w.city)}</div>}
        </div>
        <TierPill tier={w.tier} />
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 pl-2">
        <span className="font-display text-4xl font-semibold tabular-nums">{f.n(w.predicted, 0)}</span>
        <span className="text-sm text-muted">{t.common.casesExpected}</span>
      </div>
      <div className="mt-1 pl-2 text-xs text-muted">
        {t.overview.likelyNow(f.n(w.lower, 0), f.n(w.upper, 0), w.cases_now != null ? f.n(w.cases_now, 0) : null, trend)}
      </div>
      <div className="mt-3 ml-2 h-1 overflow-hidden rounded-full bg-line" role="img" aria-label={t.overview.riskScore(f.n(w.score, 0))}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w.score}%`, background: TIER_COLOR[w.tier] }} />
      </div>
      <span className="sr-only">{t.overview.forecastAhead(horizon)}</span>
    </Link>
  );
}
