"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { useOps, useSimulation, type SimRequest, type SimWard, type Simulation } from "@/lib/ops";
import { Card, ErrorNote, Segmented, Skeleton, TierPill, useDebounced } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Kpi, MethodNote } from "@/components/ops/parts";

const AXIS = { fontSize: 11, fill: "var(--muted)" };

export default function VectorControl() {
  const { t, f } = useI18n();
  const { origin } = useControls();
  const { settings } = useOps();
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [picks, setPicks] = useState<Record<string, number>>({});

  const request = useMemo<SimRequest | null>(
    () => (origin ? { origin, city: settings.city, crews: settings.crews, deployments: mode === "manual" ? picks : null } : null),
    [origin, settings.city, settings.crews, mode, picks],
  );
  const body = useDebounced(request, 200);
  const { data: sim, error, isLoading } = useSimulation(body);
  // the automatic plan, kept to offer "copy the automatic plan" while choosing by hand
  const autoReq = useMemo<SimRequest | null>(() => (origin ? { origin, city: settings.city, crews: settings.crews, deployments: null } : null), [origin, settings.city, settings.crews]);
  const { data: auto } = useSimulation(mode === "manual" ? autoReq : null);

  const used = Object.values(picks).reduce((s, k) => s + k, 0);
  const budgetLeft = settings.crews - used;
  const change = (ward: string, d: number) =>
    setPicks((p) => {
      const k = Math.max(0, Math.min((p[ward] ?? 0) + d, sim?.max_per_ward ?? 8));
      const next = { ...p, [ward]: k };
      if (!k) delete next[ward];
      return next;
    });
  const copyAuto = () => auto && setPicks(Object.fromEntries(auto.ranking.map((w) => [w.ward, w.crews])));

  if (error) return <ErrorNote error={error} />;

  return (
    <div className="space-y-6 sm:space-y-8">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h2 className="font-display text-2xl font-semibold">{t.ops.vecTitle}</h2>
            <p className="mt-1 text-sm text-muted">{t.ops.vecDesc}</p>
          </div>
          <Segmented
            label={t.ops.modeLabel}
            value={mode}
            onChange={setMode}
            options={[
              { value: "auto", label: t.ops.modeAuto },
              { value: "manual", label: t.ops.modeManual },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-display text-lg font-semibold text-accent tabular-nums">
            {t.ops.budget(f.n(mode === "manual" ? used : (sim?.crews_used ?? 0)), f.n(settings.crews))}
          </span>
          <span className="text-xs text-muted">{t.ops.budgetNote}</span>
          {mode === "manual" && (
            <span className="ml-auto flex gap-2">
              <button onClick={copyAuto} disabled={!auto} className="btn text-xs">
                {t.ops.fromAuto}
              </button>
              <button onClick={() => setPicks({})} disabled={!used} className="btn text-xs text-muted">
                {t.ops.clear}
              </button>
            </span>
          )}
        </div>
      </Card>

      {!sim ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={`space-y-6 transition-opacity sm:space-y-8 ${isLoading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi big={f.n(sim.totals.prevented, 0)} title={t.ops.kPrevented} note={t.ops.kPreventedNote} />
            <Kpi big={f.n(sim.totals.beds_saved)} title={t.ops.kBeds} />
            <Kpi big={f.int(sim.totals.saline_saved)} title={t.ops.kSaline} />
            <Kpi big={sim.totals.roi == null ? "–" : f.n(sim.totals.roi, 1)} title={t.ops.kRoi} />
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <h3 className="font-display text-xl font-semibold">{t.ops.chartTitle}</h3>
              <WeekChart sim={sim} />
              <ul className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] text-muted">
                {sim.weeks.map((w) => (
                  <li key={w.h}>
                    {t.ops.weekLine(`${f.n(w.beds_baseline)}→${f.n(w.beds_scenario)}`, `${f.n(w.saline_baseline)}→${f.n(w.saline_scenario)}`)}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="lg:col-span-3">
              <h3 className="font-display text-xl font-semibold">{t.ops.rankTitle}</h3>
              <p className="mt-1 text-sm text-muted">{t.ops.rankDesc}</p>
              {sim.ranking.length === 0 ? <p className="mt-4 text-sm text-muted">{t.ops.noDeploy}</p> : <RankTable rows={sim.ranking} />}
            </Card>
          </div>

          {mode === "manual" && <Picker sim={sim} picks={picks} change={change} budgetLeft={budgetLeft} />}
        </div>
      )}
      <MethodNote title={t.ops.methodTitle} items={t.ops.methodVec} />
    </div>
  );
}

function WeekChart({ sim }: { sim: Simulation }) {
  const { t, f } = useI18n();
  const data = sim.weeks.map((w) => ({ name: t.ops.weekAhead(w.h), without: w.baseline, with: w.scenario }));
  return (
    <div className="mt-3 h-60" role="img" aria-label={t.ops.chartLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barGap={4}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => f.n(v)} width={44} />
          <Tooltip
            cursor={{ fill: "var(--raise)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 13 }}
            formatter={(v) => f.n(Number(v), 0)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="without" name={t.ops.without} fill="var(--series-quiet)" radius={[4, 4, 0, 0]} animationDuration={600} />
          <Bar dataKey="with" name={t.ops.with} fill="var(--accent)" radius={[4, 4, 0, 0]} animationDuration={600} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankTable({ rows }: { rows: SimWard[] }) {
  const { t, f, b } = useI18n();
  return (
    <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {(["rank", "ward", "crews", "habitat", "cases", "prevented", "roi", "beds", "saline"] as const).map((k) => (
              <th key={k} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {t.ops.rcol[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.ward} className="border-b border-line/60">
              <td className="px-2 py-2 font-mono text-xs text-muted">{f.n(w.roi_rank ?? 0)}</td>
              <td className="px-2 py-2">
                <Link href={`/ward/${w.ward}`} className="font-medium whitespace-nowrap hover:text-accent">
                  {b(w.label)}
                </Link>
              </td>
              <td className="px-2 py-2 tabular-nums">{f.n(w.crews)}</td>
              <td className="px-2 py-2 tabular-nums">{f.n(`${Math.round(w.coverage * 100)}%`)}</td>
              <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                {f.n(w.baseline_cases, 0)} → <b>{f.n(w.scenario_cases, 0)}</b>
              </td>
              <td className="px-2 py-2 font-semibold text-accent tabular-nums">{f.n(w.prevented, 1)}</td>
              <td className="px-2 py-2 font-semibold tabular-nums">{w.roi == null ? "–" : f.n(w.roi, 1)}</td>
              <td className="px-2 py-2 tabular-nums">{f.n(w.beds_saved)}</td>
              <td className="px-2 py-2 tabular-nums">{f.n(w.saline_saved)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Picker({ sim, picks, change, budgetLeft }: { sim: Simulation; picks: Record<string, number>; change: (w: string, d: number) => void; budgetLeft: number }) {
  const { t, f, b } = useI18n();
  const [all, setAll] = useState(false);
  const order = [...sim.wards].sort((a, b) => (b.next_crew_roi ?? -1) - (a.next_crew_roi ?? -1) || a.ward.localeCompare(b.ward));
  const shown = all ? order : order.slice(0, 12);
  return (
    <Card>
      <h3 className="font-display text-xl font-semibold">{t.ops.pickTitle}</h3>
      <p className="mt-1 text-sm text-muted">{t.ops.pickDesc}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((w) => {
          const k = picks[w.ward] ?? 0;
          const atMax = k >= sim.max_per_ward;
          return (
            <li key={w.ward} className={`flex items-center gap-3 rounded-xl border p-2.5 ${k ? "border-accent/50 bg-accent-soft" : "border-line bg-raise"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{b(w.label)}</span>
                  <TierPill tier={w.tier} className="!px-2 !text-[10px]" />
                </div>
                <div className="text-xs text-muted tabular-nums">{atMax ? t.ops.full : t.ops.perNext(f.n(w.next_crew_roi ?? 0, 1))}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => change(w.ward, -1)} disabled={!k} aria-label={t.ops.removeCrew(b(w.label))} className="btn h-9 w-9 !p-0 text-lg">
                  −
                </button>
                <span className="w-6 text-center font-display text-lg font-semibold tabular-nums">{f.n(k)}</span>
                <button onClick={() => change(w.ward, 1)} disabled={atMax || budgetLeft <= 0} aria-label={t.ops.addCrew(b(w.label))} className="btn h-9 w-9 !p-0 text-lg">
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {order.length > 12 && (
        <button onClick={() => setAll(!all)} className="btn mt-3 text-sm">
          <Icon name={all ? "close" : "plan"} /> {all ? t.ops.showFewer : t.ops.showAll(order.length)}
        </button>
      )}
    </Card>
  );
}
