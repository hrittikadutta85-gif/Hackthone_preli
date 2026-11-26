"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TIERS, TIER_COLOR, addDays, downloadCsv, useMap, type MapData, type Tier } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";
import { Icon } from "@/components/icons";

const RISING = 3; // expected cases above this week's count to call a ward "rising fast"

interface Row {
  i: number;
  ward: string;
  label: string;
  city: string;
  tier: number;
  prevTier: number | null;
  predicted: number;
  lower: number | null;
  upper: number | null;
  now: number | null;
  isNew: boolean;
  rising: boolean;
}

/** Every ward for one forecast week, most urgent first: risk level, then expected cases. */
function rank(data: MapData, k: number, city: string | null): Row[] {
  return data.wards
    .map((w, i) => {
      const tier = data.tier[i][k] ?? 0;
      const prevTier = k > 0 ? data.tier[i][k - 1] : null;
      const predicted = data.predicted[i][k] ?? 0;
      const now = data.cases_now[i][k];
      return {
        i, ward: w.ward, label: w.label, city: w.city, tier, prevTier, predicted, now,
        lower: data.lower[i][k], upper: data.upper[i][k],
        isNew: tier >= 2 && prevTier != null && prevTier < 2,
        rising: predicted - (now ?? 0) >= RISING,
      };
    })
    .filter((r) => !city || r.city === city)
    .sort((a, b) => b.tier - a.tier || b.predicted - a.predicted);
}

export default function ActionPlan() {
  const { t, f, b } = useI18n();
  const { meta, origin, horizon } = useControls();
  const { data, error } = useMap(horizon);
  const [teams, setTeams] = useState(8);
  const [city, setCity] = useState<string | null>(null);

  const k = data && origin ? Math.max(0, data.weeks.indexOf(origin)) : 0;
  const rows = useMemo(() => (data ? rank(data, k, city) : []), [data, k, city]);

  if (error) return <ErrorNote error={error} />;
  if (!data || !meta || !origin) return <Skeleton className="h-96" />;

  const target = addDays(data.weeks[k], 7 * horizon);
  const urgent = rows.filter((r) => r.tier >= 2);
  const plan = rows.filter((r) => r.tier >= 1).slice(0, teams); // High/Critical first; Medium only if teams are free
  const waiting = urgent.slice(plan.length);
  const urgentCases = urgent.reduce((s, r) => s + r.predicted, 0);
  const coveredCases = plan.filter((r) => r.tier >= 2).reduce((s, r) => s + r.predicted, 0);
  const coverage = urgentCases ? Math.round((coveredCases / urgentCases) * 100) : 100;
  const scope = city ? b(city) : t.plan.allFive;

  const newAlerts = rows.filter((r) => r.isNew);
  const improved = rows.filter((r) => r.prevTier != null && r.prevTier >= 2 && r.tier < 2);
  const risers = [...rows].filter((r) => r.rising).sort((a, b) => b.predicted - (b.now ?? 0) - (a.predicted - (a.now ?? 0))).slice(0, 5);

  const headline =
    urgent.length === 0
      ? t.plan.headlineNone(scope, horizon)
      : waiting.length === 0
        ? t.plan.headlineCovered(plan.length, scope)
        : t.plan.headlineShort(urgent.length, teams, plan.length);

  const firstAction = (r: Row) => b(meta.tier_actions[TIERS[r.tier] as Tier][0]);
  const planRow = (r: Row, team: string) => ({
    team,
    ward_id: r.ward,
    ward: b(r.label),
    city: b(r.city),
    risk_level: t.common.tier[TIERS[r.tier]],
    expected_cases: r.predicted,
    likely_low: r.lower,
    likely_high: r.upper,
    cases_this_week: r.now,
    new_alert: r.isNew ? t.plan.yes : "",
    rising_fast: r.rising ? t.plan.yes : "",
    suggested_action: firstAction(r),
  });
  const exportCsv = () =>
    downloadCsv(`action-plan_${(city ?? "all-cities").replace(/\s+/g, "-").toLowerCase()}_${target}.csv`, [
      ...plan.map((r, n) => planRow(r, t.plan.team(n + 1))),
      ...waiting.map((r) => planRow(r, t.plan.waitingList)),
    ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.plan.eyebrow(f.date(target, true))}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{headline}</h1>
        <p className="mt-3 max-w-2xl text-base text-ink/80 sm:text-lg">{t.plan.intro}</p>
      </div>

      <Card className="space-y-5 print:hidden">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="block">
            <div className="mb-2 flex justify-between gap-2 text-sm">
              <span className="font-medium">{t.plan.teams}</span>
              <span className="font-display text-2xl font-semibold text-accent tabular-nums">{f.n(teams)}</span>
            </div>
            <input type="range" min={1} max={30} value={teams} onChange={(e) => setTeams(Number(e.target.value))} className="w-full" aria-label={t.plan.teamsLabel} />
            <p className="mt-1 text-xs text-muted">{t.plan.teamsNote}</p>
          </label>
          <div>
            <div className="mb-2 text-sm font-medium">{t.plan.area}</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t.common.cityGroup}>
              {[null, ...meta.cities].map((c) => (
                <button key={c ?? "all"} onClick={() => setCity(c)} aria-pressed={city === c} className="btn aria-[pressed=false]:text-muted">
                  {c ? b(c) : t.common.allCities}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat big={f.n(urgent.length)} title={t.plan.statUrgent} note={t.plan.statUrgentNote(scope, horizon)} />
        <Stat big={f.n(plan.length)} title={t.plan.statPlan} note={plan.some((r) => r.tier < 2) ? t.plan.statPlanMedium : t.plan.statPlanUrgent} />
        <Stat big={`${f.n(coverage)}%`} title={t.plan.statCovered} note={t.plan.statCoveredNote(f.n(Math.round(coveredCases)), f.n(Math.round(urgentCases)))} />
        <Stat big={f.n(waiting.length)} title={t.plan.statUncovered} note={waiting.length ? t.plan.statUncoveredSome : t.plan.statUncoveredNone} warn={waiting.length > 0} />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">{t.plan.where}</h2>
            <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1 print:hidden">
              <button onClick={exportCsv} className="btn">
                <Icon name="download" /> CSV
              </button>
              <button onClick={() => window.print()} className="btn">
                <Icon name="print" /> {t.plan.print}
              </button>
            </div>
          </div>
          {plan.length === 0 ? (
            <p className="mt-4 text-muted">{t.plan.allLow}</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {plan.map((r, n) => (
                <PlanItem key={r.ward} r={r} label={t.plan.team(n + 1)} action={firstAction(r)} />
              ))}
            </ol>
          )}
          {waiting.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-high">{t.plan.waiting}</h3>
              <ol className="mt-2 space-y-2 opacity-80">
                {waiting.map((r) => (
                  <PlanItem key={r.ward} r={r} label="—" action={firstAction(r)} />
                ))}
              </ol>
            </>
          )}
        </Card>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <h2 className="font-display text-xl font-semibold">{t.plan.changed}</h2>
            <p className="mb-3 text-sm text-muted">{t.plan.changedDesc}</p>
            <Change title={t.plan.newAlerts} tone="text-critical-ink" rows={newAlerts} empty={t.plan.noNewAlerts} />
            <Change title={t.plan.improved} tone="text-low" rows={improved} empty={t.plan.noneYet} />
          </Card>
          <Card>
            <h2 className="font-display text-xl font-semibold">{t.plan.risers}</h2>
            <p className="mb-3 text-sm text-muted">{t.plan.risersDesc}</p>
            {risers.length === 0 ? (
              <p className="text-sm text-muted">{t.plan.noRisers(RISING)}</p>
            ) : (
              <ul className="space-y-2 max-lg:space-y-0">
                {risers.map((r) => (
                  <li key={r.ward} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/ward/${r.ward}`} className="flex items-center font-medium hover:text-accent tap">
                      {b(r.label)}
                    </Link>
                    <span className="whitespace-nowrap tabular-nums text-muted">
                      {f.n(r.now)} → <b className="text-ink">{f.n(r.predicted, 0)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted">{t.plan.footnote}</p>
    </div>
  );
}

function PlanItem({ r, label, action }: { r: Row; label: string; action: string }) {
  const { t, f, b } = useI18n();
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-xl border border-line bg-raise p-3 transition hover:border-accent/40" style={{ borderLeft: `3px solid ${TIER_COLOR[TIERS[r.tier]]}` }}>
      <span className="w-16 shrink-0 font-mono text-xs font-medium text-muted uppercase max-sm:w-full">{label}</span>
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/ward/${r.ward}`} className="flex items-center font-semibold hover:text-accent tap">
            {b(r.label)}
          </Link>
          <TierPill tier={TIERS[r.tier]} />
          {r.isNew && <span className="rounded-full bg-critical/15 px-2 py-0.5 text-[11px] font-semibold text-critical-ink">{t.plan.newThisWeek}</span>}
          {r.rising && <span className="rounded-full bg-high/15 px-2 py-0.5 text-[11px] font-semibold text-high">{t.plan.risingFast}</span>}
        </div>
        <p className="mt-1 text-sm break-words text-ink/80">{action}</p>
      </div>
      <div className="text-right text-sm tabular-nums max-sm:flex max-sm:w-full max-sm:flex-wrap max-sm:items-baseline max-sm:justify-between max-sm:gap-x-3 max-sm:border-t max-sm:border-line max-sm:pt-2 max-sm:text-left">
        <div>{t.plan.expected(<b className="text-base">{f.n(r.predicted, 0)}</b>)}</div>
        <div className="text-xs text-muted">{t.plan.likelyNow(f.n(r.lower), f.n(r.upper), f.n(r.now))}</div>
      </div>
    </li>
  );
}

function Change({ title, tone, rows, empty }: { title: string; tone: string; rows: Row[]; empty: string }) {
  const { f, b } = useI18n();
  return (
    <div className="mb-4 last:mb-0">
      <h3 className={`text-sm font-semibold ${tone}`}>
        {title} <span className="font-normal text-muted">({f.n(rows.length)})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li key={r.ward}>
              <Link href={`/ward/${r.ward}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium hover:border-accent/50 tap">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TIER_COLOR[TIERS[r.tier]] }} />
                {b(r.label)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ big, title, note, warn }: { big: string; title: string; note: string; warn?: boolean }) {
  return (
    <Card className="rise">
      <div className={`font-display text-3xl font-semibold tabular-nums sm:text-4xl ${warn ? "text-high" : "text-accent"}`}>{big}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </Card>
  );
}
