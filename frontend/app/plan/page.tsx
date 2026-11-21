"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TIERS, TIER_COLOR, addDays, downloadCsv, fmtDate, useMap, type MapData, type Tier } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";

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
  const scope = city ?? "all five city corporations";

  const newAlerts = rows.filter((r) => r.isNew);
  const improved = rows.filter((r) => r.prevTier != null && r.prevTier >= 2 && r.tier < 2);
  const risers = [...rows].filter((r) => r.rising).sort((a, b) => b.predicted - (b.now ?? 0) - (a.predicted - (a.now ?? 0))).slice(0, 5);

  const headline =
    urgent.length === 0
      ? `No ward in ${scope} reaches High risk ${horizon === 1 ? "next week" : `in ${horizon} weeks`}. A good week for prevention work.`
      : waiting.length === 0
        ? `${plan.length} team${plan.length > 1 ? "s" : ""} can cover every high-risk ward in ${scope}.`
        : `${urgent.length} wards need help, but you have ${teams} team${teams > 1 ? "s" : ""}. Start with these ${plan.length}.`;

  const exportCsv = () =>
    downloadCsv(`action-plan_${(city ?? "all-cities").replace(/\s+/g, "-").toLowerCase()}_${target}.csv`, [
      ...plan.map((r, n) => planRow(r, `Team ${n + 1}`, meta.tier_actions)),
      ...waiting.map((r) => planRow(r, "Waiting list", meta.tier_actions)),
    ]);

  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="text-sm font-medium text-accent">Action plan · week of {fmtDate(target, true)}</p>
        <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">{headline}</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">
          Tell us how many field teams you have. We rank the wards by risk and expected cases, so spraying and
          inspection reach the right places before hospitals fill up.
        </p>
      </div>

      <Card className="space-y-5 print:hidden">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="block">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">Field teams available this week</span>
              <span className="font-display text-2xl font-semibold text-accent tabular-nums">{teams}</span>
            </div>
            <input type="range" min={1} max={30} value={teams} onChange={(e) => setTeams(Number(e.target.value))} className="w-full" aria-label="Number of field teams" />
            <p className="mt-1 text-xs text-muted">One team covers one ward for the week.</p>
          </label>
          <div>
            <div className="mb-2 text-sm font-medium">Area</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="City corporation">
              {[null, ...meta.cities].map((c) => (
                <button
                  key={c ?? "all"}
                  onClick={() => setCity(c)}
                  aria-pressed={city === c}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${city === c ? "border-accent bg-accent text-white" : "border-line bg-card text-muted hover:text-ink"}`}
                >
                  {c ?? "All cities"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat big={String(urgent.length)} title="wards at High or Critical" note={`${scope}, ${horizon} wk ahead`} />
        <Stat big={String(plan.length)} title="wards in this plan" note={plan.some((r) => r.tier < 2) ? "includes Medium wards, since teams are free" : "most urgent first"} />
        <Stat big={`${coverage}%`} title="of high-risk cases covered" note={`≈${Math.round(coveredCases)} of ${Math.round(urgentCases)} expected cases`} />
        <Stat big={String(waiting.length)} title="high-risk wards not covered" note={waiting.length ? "borrow teams or plan for next week" : "nobody left out"} warn={waiting.length > 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">Where to send each team</h2>
            <div className="flex gap-2 print:hidden">
              <button onClick={exportCsv} className="rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:border-accent/50">
                ⬇ CSV
              </button>
              <button onClick={() => window.print()} className="rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:border-accent/50">
                🖨 Print
              </button>
            </div>
          </div>
          {plan.length === 0 ? (
            <p className="mt-4 text-muted">Every ward is Low risk. Keep routine surveillance going.</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {plan.map((r, n) => (
                <PlanItem key={r.ward} r={r} label={`Team ${n + 1}`} action={meta.tier_actions[TIERS[r.tier] as Tier][0]} />
              ))}
            </ol>
          )}
          {waiting.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-high">Waiting list: high-risk wards without a team</h3>
              <ol className="mt-2 space-y-2 opacity-75">
                {waiting.map((r) => (
                  <PlanItem key={r.ward} r={r} label="—" action={meta.tier_actions[TIERS[r.tier] as Tier][0]} />
                ))}
              </ol>
            </>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-xl font-semibold">What changed since last week</h2>
            <p className="mb-3 text-sm text-muted">Compared with the forecast made one week earlier.</p>
            <Change title="Newly High or Critical" tone="text-critical" rows={newAlerts} empty="No new alerts this week." />
            <Change title="Improved below High" tone="text-low" rows={improved} empty="None yet." />
          </Card>
          <Card>
            <h2 className="font-display text-xl font-semibold">Rising fastest</h2>
            <p className="mb-3 text-sm text-muted">Biggest jump from this week&apos;s reported cases.</p>
            {risers.length === 0 ? (
              <p className="text-sm text-muted">No ward is expected to jump by {RISING}+ cases.</p>
            ) : (
              <ul className="space-y-2">
                {risers.map((r) => (
                  <li key={r.ward} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/ward/${r.ward}`} className="font-medium hover:text-accent">
                      {r.label}
                    </Link>
                    <span className="tabular-nums text-muted">
                      {r.now ?? "?"} → <b className="text-ink">{r.predicted.toFixed(0)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted">
        The plan ranks wards by risk level, then by expected cases. It is a starting point: local knowledge (blocked roads,
        recent spraying, events) should adjust it.
      </p>
    </div>
  );
}

function planRow(r: Row, team: string, actions: Record<Tier, string[]>) {
  return {
    team,
    ward_id: r.ward,
    ward: r.label,
    city: r.city,
    risk_level: TIERS[r.tier],
    expected_cases: r.predicted,
    likely_low: r.lower,
    likely_high: r.upper,
    cases_this_week: r.now,
    new_alert: r.isNew ? "yes" : "",
    rising_fast: r.rising ? "yes" : "",
    suggested_action: actions[TIERS[r.tier] as Tier][0],
  };
}

function PlanItem({ r, label, action }: { r: Row; label: string; action: string }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-xl border border-line p-3" style={{ borderLeft: `5px solid ${TIER_COLOR[TIERS[r.tier]]}` }}>
      <span className="w-16 shrink-0 text-xs font-semibold text-muted uppercase">{label}</span>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/ward/${r.ward}`} className="font-semibold hover:text-accent">
            {r.label}
          </Link>
          <TierPill tier={TIERS[r.tier]} />
          {r.isNew && <span className="rounded-full bg-critical/10 px-2 py-0.5 text-[11px] font-semibold text-critical">new this week</span>}
          {r.rising && <span className="rounded-full bg-high/10 px-2 py-0.5 text-[11px] font-semibold text-high">rising fast</span>}
        </div>
        <p className="mt-1 text-sm text-ink/80">{action}</p>
      </div>
      <div className="text-right text-sm tabular-nums">
        <div>
          <b className="text-base">{r.predicted.toFixed(0)}</b> expected
        </div>
        <div className="text-xs text-muted">
          likely {r.lower}–{r.upper} · {r.now ?? "?"} now
        </div>
      </div>
    </li>
  );
}

function Change({ title, tone, rows, empty }: { title: string; tone: string; rows: Row[]; empty: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className={`text-sm font-semibold ${tone}`}>
        {title} <span className="font-normal text-muted">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <li key={r.ward}>
              <Link href={`/ward/${r.ward}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium hover:border-accent/50">
                <span className="h-2 w-2 rounded-full" style={{ background: TIER_COLOR[TIERS[r.tier]] }} />
                {r.label}
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
      <div className={`font-display text-4xl font-semibold tabular-nums ${warn ? "text-high" : "text-accent"}`}>{big}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </Card>
  );
}
