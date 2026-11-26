"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TIER_COLOR, TIERS, addDays, downloadCsv, useCity, type CityWard, type Tier } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill, tierGlow } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Heatmap } from "@/components/Heatmap";
import { Outlook } from "@/components/Outlook";

export default function Overview() {
  const { t, f, b } = useI18n();
  const { meta, origin, horizon } = useControls();
  const [city, setCity] = useState<string | null>("Dhaka South");
  const [tier, setTier] = useState<Tier | null>(null);
  const [query, setQuery] = useState("");
  const { data, error, isLoading } = useCity(origin, horizon, city);

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

  const wards = useMemo(() => {
    if (!data) return [];
    // ward names can be searched in either language, with either kind of digit
    const q = toLatinDigits(query.trim().toLowerCase());
    return data.wards.filter(
      (w) => (!tier || w.tier === tier) && (!q || w.label.toLowerCase().includes(q) || toLatinDigits(b(w.label)).includes(q)),
    );
  }, [data, tier, query, b]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.overview.eyebrow}</p>
        {data ? (
          <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{b(data.summary)}</h1>
        ) : (
          <Skeleton className="mt-2 h-24 max-w-3xl" />
        )}
        <p className="mt-3 max-w-2xl text-muted">
          {t.overview.subtitle(data ? f.date(addDays(data.origin, 7 * horizon), true) : "…", origin ? f.date(origin, true) : "…")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.common.cityGroup}>
        {[null, ...(meta?.cities ?? [])].map((c) => (
          <button key={c ?? "all"} onClick={() => setCity(c)} aria-pressed={city === c} className="btn aria-[pressed=false]:text-muted">
            {c ? b(c) : t.common.allCities}
          </button>
        ))}
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
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: `linear-gradient(90deg, ${TIER_COLOR[level]}, transparent 75%)` }} />
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TIER_COLOR[level], boxShadow: `0 0 10px ${TIER_COLOR[level]}` }} />
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

      <Outlook origin={origin} city={city} onPick={setCity} />

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
            className="field w-56 rounded-full px-4 py-2 text-sm max-sm:w-full"
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
    </div>
  );
}

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
      <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: TIER_COLOR[w.tier], boxShadow: `0 0 12px ${TIER_COLOR[w.tier]}` }} />
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
