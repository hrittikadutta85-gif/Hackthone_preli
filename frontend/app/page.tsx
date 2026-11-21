"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TIER_COLOR, TIERS, addDays, downloadCsv, fmtDate, useCity, type CityWard, type Tier } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";
import { Heatmap } from "@/components/Heatmap";
import { Outlook } from "@/components/Outlook";

export default function Overview() {
  const { meta, origin, horizon } = useControls();
  const [city, setCity] = useState<string | null>("Dhaka South");
  const [tier, setTier] = useState<Tier | null>(null);
  const [query, setQuery] = useState("");
  const { data, error, isLoading } = useCity(origin, horizon, city);

  const exportCsv = () =>
    data &&
    downloadCsv(
      `dengue-risk_${(city ?? "all-cities").replace(/\s+/g, "-").toLowerCase()}_${data.origin}_${horizon}wk.csv`,
      wards.map((w) => ({
        ward_id: w.ward,
        ward: w.label,
        city: w.city,
        forecast_week: addDays(data.origin, 7 * horizon),
        expected_cases: w.predicted,
        likely_low: w.lower,
        likely_high: w.upper,
        risk_score: w.score,
        risk_level: w.tier,
        cases_this_week: w.cases_now,
      })),
    );

  const wards = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.wards.filter((w) => (!tier || w.tier === tier) && (!q || w.label.toLowerCase().includes(q)));
  }, [data, tier, query]);

  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="text-sm font-medium text-accent">City overview</p>
        {data ? (
          <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">{data.summary}</h1>
        ) : (
          <Skeleton className="mt-2 h-24 max-w-3xl" />
        )}
        <p className="mt-3 max-w-2xl text-muted">
          Forecasts are for the week of {data ? fmtDate(addDays(data.origin, 7 * horizon), true) : "…"}, made using
          weather and cases up to {origin ? fmtDate(origin, true) : "…"}. Tap a ward to see why.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="City corporation">
        {[null, ...(meta?.cities ?? [])].map((c) => (
          <button
            key={c ?? "all"}
            onClick={() => setCity(c)}
            aria-pressed={city === c}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              city === c ? "border-accent bg-accent text-white" : "border-line bg-card text-muted hover:text-ink"
            }`}
          >
            {c ?? "All cities"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TIERS.map((t) => {
          const n = data?.counts[t] ?? 0;
          const on = tier === t;
          return (
            <button
              key={t}
              onClick={() => setTier(on ? null : t)}
              aria-pressed={on}
              className="rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: on ? TIER_COLOR[t] : "var(--line)", boxShadow: on ? `0 0 0 2px ${TIER_COLOR[t]}` : undefined }}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLOR[t] }} />
                {t}
              </div>
              <div className="font-display mt-1 text-4xl font-semibold tabular-nums">
                <AnimatedNumber value={n} />
              </div>
              <div className="text-xs text-muted">{meta?.tier_help[t]}</div>
            </button>
          );
        })}
      </div>

      <Outlook origin={origin} city={city} onPick={setCity} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">
          {tier ? `${tier}-risk wards` : "Wards, most at risk first"}
          <span className="ml-2 text-base font-normal text-muted">{wards.length} shown</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a ward…"
            aria-label="Find a ward"
            className="w-56 rounded-full border border-line bg-card px-4 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={exportCsv}
            disabled={!data || wards.length === 0}
            className="rounded-full border border-line bg-card px-4 py-2 text-sm font-medium transition hover:border-accent/50 disabled:opacity-40"
          >
            ⬇ Download CSV
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
          <p className="text-muted">No wards match. Try clearing the filter or search.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {wards.slice(0, 24).map((w, i) => (
            <WardTile key={w.ward} w={w} i={i} showCity={!city} horizon={horizon} />
          ))}
        </div>
      )}
      {wards.length > 24 && <p className="text-sm text-muted">Showing the 24 highest of {wards.length}. Narrow the list with a city or search.</p>}

      {data && (
        <Card>
          <h2 className="font-display text-2xl font-semibold">How risk has moved, week by week</h2>
          <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">
            Each row is a ward and each column is a week. The colour is the risk for {horizon} week{horizon > 1 ? "s" : ""}
            {" "}after that week. Click a row to open the ward.
          </p>
          <Heatmap data={data.heatmap} />
        </Card>
      )}
    </div>
  );
}


function WardTile({ w, i, showCity, horizon }: { w: CityWard; i: number; showCity: boolean; horizon: number }) {
  const diff = w.cases_now == null ? null : w.predicted - w.cases_now;
  const trend = diff == null || Math.abs(diff) < 1 ? "holding steady" : diff > 0 ? "rising" : "easing";
  return (
    <Link
      href={`/ward/${w.ward}`}
      className="rise group relative block overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent"
      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: TIER_COLOR[w.tier] }} />
      <div className="flex items-start justify-between pl-2">
        <div>
          <div className="font-semibold">{w.label.split(",")[0]}</div>
          {showCity && <div className="text-xs text-muted">{w.city}</div>}
        </div>
        <TierPill tier={w.tier} />
      </div>
      <div className="mt-3 flex items-baseline gap-2 pl-2">
        <span className="font-display text-4xl font-semibold tabular-nums">{w.predicted.toFixed(0)}</span>
        <span className="text-sm text-muted">cases expected</span>
      </div>
      <div className="mt-1 pl-2 text-xs text-muted">
        likely {w.lower.toFixed(0)}–{w.upper.toFixed(0)} · {w.cases_now != null ? `${w.cases_now.toFixed(0)} now, ` : ""}
        {trend}
      </div>
      <div className="mt-3 ml-2 h-1.5 overflow-hidden rounded-full bg-line" aria-label={`Risk score ${w.score.toFixed(0)} out of 100`}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w.score}%`, background: TIER_COLOR[w.tier] }} />
      </div>
      <span className="sr-only">Forecast {horizon} weeks ahead</span>
    </Link>
  );
}
