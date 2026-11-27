"use client";
import Link from "next/link";
import { useState } from "react";
import { downloadCsv } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { RESOURCES, useOps, useOpsPlan, type OpsPlan, type OpsWard } from "@/lib/ops";
import { Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Kpi, Meter, MethodNote, Ratio, StatusBadge } from "@/components/ops/parts";

export default function Supplies() {
  const { t, f, b } = useI18n();
  const { query, settings } = useOps();
  const { data: plan, error } = useOpsPlan(query);
  const [onlyShort, setOnlyShort] = useState(false);

  if (error) return <ErrorNote error={error} />;
  if (!plan) return <Skeleton className="h-96" />;

  const pct = (v: number) => f.n(`${Math.round(v * 100)}%`);
  const scope = plan.city ? b(plan.city) : t.plan.allFive;
  const critical = plan.wards.filter((w) => w.status === "critical");
  const rows = onlyShort ? plan.wards.filter((w) => w.status !== "ok") : plan.wards;
  const c = plan.totals.crews;

  const exportCsv = () =>
    downloadCsv(`allocation_${plan.target_date}_${settings.stock}pct.csv`, plan.wards.map((w) => ({
      rank: w.rank, ward_id: w.ward, ward: b(w.label), city: b(w.city), risk: t.common.tier[w.tier], priority: w.priority,
      expected_cases: w.predicted, planned_cases: w.planning_cases,
      saline_required: w.required.saline, saline_allocated: w.allocated.saline,
      kits_required: w.required.kits, kits_allocated: w.allocated.kits,
      beds_required: w.required.beds, beds_secured: w.allocated.beds,
      crews_needed: w.crews_needed, crews_assigned: w.crews, status: t.ops.status[w.status],
    })));

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {RESOURCES.map((r) => {
          const tot = plan.totals[r];
          return (
            <Kpi key={r} big={t.ops.ofNeed(f.int(tot.allocated), f.int(tot.required))} title={t.ops.res[r]} tone={tot.shortfall ? (tot.fill < 0.5 ? "bad" : "warn") : "accent"}
              note={r === "beds" ? t.ops.bedsLine(f.int(tot.available), f.n(`${tot.pct}%`)) : t.ops.stockLine(f.int(tot.available), f.n(`${tot.pct}%`))}>
              <Meter value={tot.fill} className="mt-3" />
              <div className="mt-1.5 flex justify-between gap-2 text-xs">
                <span className="text-muted">{t.ops.fillPct(pct(tot.fill))}</span>
                <span className={tot.wards_short ? "font-medium text-critical-ink" : "text-low"}>{t.ops.wardsShort(tot.wards_short)}</span>
              </div>
            </Kpi>
          );
        })}
        <Kpi big={t.ops.ofNeed(f.n(c.assigned), f.n(c.needed))} title={t.ops.crewsCard} tone={c.wards_short ? "warn" : "accent"} note={t.ops.crewsLine(f.n(c.needed))}>
          <Meter value={c.needed ? c.assigned / c.needed : 1} className="mt-3" />
          <div className="mt-1.5 flex justify-between gap-2 text-xs">
            <span className="text-muted">{c.spare > 0 ? t.ops.crewsSpare(f.n(c.spare)) : ""}</span>
            <span className={c.wards_short ? "font-medium text-high" : "text-low"}>{t.ops.crewsWardsShort(c.wards_short)}</span>
          </div>
        </Kpi>
      </div>

      {critical.length > 0 && (
        <Card className="border-critical/40">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-critical-ink">
            <Icon name="alert" className="h-5 w-5" /> {t.ops.deficitTitle}
          </h2>
          <p className="mt-1 text-sm text-ink/80">{t.ops.deficitText(critical.length, scope)}</p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {critical.slice(0, 12).map((w) => (
              <li key={w.ward}>
                <Link href={`/ward/${w.ward}`} className="inline-flex items-center gap-1.5 rounded-full border border-critical/40 px-2.5 py-1 text-xs font-medium hover:border-critical tap">
                  {b(w.label)}
                  <span className="text-critical-ink">−{w.deficits.map((r) => t.ops.resShort[r]).join(", ")}</span>
                </Link>
              </li>
            ))}
            {critical.length > 12 && <li className="px-2 py-1 text-xs text-muted">+{f.n(critical.length - 12)}</li>}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold">{t.ops.tableTitle}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t.ops.tableDesc}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/85">
              <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              {t.ops.onlyShort}
            </label>
            <button onClick={exportCsv} className="btn">
              <Icon name="download" /> CSV
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="mt-4 text-muted">{t.ops.noRows}</p>
        ) : (
          <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <WardTable plan={plan} rows={rows} />
          </div>
        )}
      </Card>

      <MethodNote title={t.ops.methodTitle} items={t.ops.method(plan.rules)} />
    </div>
  );
}

function WardTable({ plan, rows }: { plan: OpsPlan; rows: OpsWard[] }) {
  const { t, f, b } = useI18n();
  const max = Math.max(...plan.wards.map((w) => w.priority), 1);
  return (
    <table className="w-full min-w-[56rem] text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          {(["rank", "ward", "risk", "priority", "cases", "saline", "kits", "beds", "crews", "status"] as const).map((k) => (
            <th key={k} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
              {t.ops.col[k]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => (
          <tr key={w.ward} className={`border-b border-line/60 ${w.status === "critical" ? "bg-critical/[0.06]" : ""}`}>
            <td className="px-2 py-2 font-mono text-xs text-muted tabular-nums">{f.n(w.rank)}</td>
            <td className="px-2 py-2">
              <Link href={`/ward/${w.ward}`} className="font-medium whitespace-nowrap hover:text-accent">
                {b(w.label)}
              </Link>
            </td>
            <td className="px-2 py-2">
              <TierPill tier={w.tier} />
            </td>
            <td className="px-2 py-2" title={t.ops.densityTip(f.n(Math.round(w.density_pct)))}>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(w.priority / max) * 100}%` }} />
                </div>
                <span className="tabular-nums">{f.n(w.priority, 0)}</span>
              </div>
            </td>
            <td className="px-2 py-2 text-xs whitespace-nowrap text-muted tabular-nums">{t.ops.casesCell(f.n(w.predicted, 0), f.n(w.planning_cases, 0))}</td>
            <td className="px-2 py-2"><Ratio got={w.allocated.saline} need={w.required.saline} /></td>
            <td className="px-2 py-2"><Ratio got={w.allocated.kits} need={w.required.kits} /></td>
            <td className="px-2 py-2"><Ratio got={w.allocated.beds} need={w.required.beds} /></td>
            <td className="px-2 py-2"><Ratio got={w.crews} need={w.crews_needed} /></td>
            <td className="px-2 py-2">
              <StatusBadge status={w.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
