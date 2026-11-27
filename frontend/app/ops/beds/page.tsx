"use client";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { loadColor, useOps, useOpsPlan, type OpsWard, type Pool } from "@/lib/ops";
import { Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function Beds() {
  const { t, f, b } = useI18n();
  const { query } = useOps();
  const { data: plan, error } = useOpsPlan(query);
  const [onlyPressure, setOnlyPressure] = useState(true);

  if (error) return <ErrorNote error={error} />;
  if (!plan) return <Skeleton className="h-96" />;

  const pressured = (w: OpsWard) => w.beds.sent > 0 || w.beds.received > 0 || w.beds.unplaced > 0 || w.beds.net_balance < 0;
  const wards = [...plan.wards]
    .filter((w) => !onlyPressure || pressured(w))
    .sort((a, b) => a.city.localeCompare(b.city) || a.beds.net_balance - b.beds.net_balance || b.priority - a.priority);

  return (
    <div className="space-y-6 sm:space-y-8">
      <section>
        <h2 className="font-display text-2xl font-semibold">{t.ops.bedsTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t.ops.bedsDesc}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {plan.pools.map((p) => (
            <PoolCard key={p.city} p={p} normal={plan.wards.filter((w) => w.city === p.city).reduce((s, w) => s + w.beds.normal_capacity, 0)} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="font-display text-xl font-semibold">{t.ops.transfersTitle}</h2>
          <p className="mt-1 text-sm text-muted">{t.ops.transfersDesc}</p>
          {plan.transfers.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t.ops.noTransfers}</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {plan.transfers.map((x) => (
                <li key={`${x.from}-${x.to}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-raise px-3 py-2 text-sm">
                  <Link href={`/ward/${x.from}`} className="font-medium text-critical-ink hover:underline">
                    {b(x.from_label)}
                  </Link>
                  <Icon name="arrow" className="h-4 w-4 text-muted" />
                  <Link href={`/ward/${x.to}`} className="font-medium text-low hover:underline">
                    {b(x.to_label)}
                  </Link>
                  <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent tabular-nums">{t.ops.patients(x.patients)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold">{t.ops.wardBedsTitle}</h2>
              <p className="mt-1 text-sm text-muted">{t.ops.wardBedsDesc}</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/85">
              <input type="checkbox" checked={onlyPressure} onChange={(e) => setOnlyPressure(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              {t.ops.onlyPressure}
            </label>
          </div>
          <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  {(["ward", "open", "need", "net", "sent", "received", "unplaced", "load"] as const).map((k) => (
                    <th key={k} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                      {t.ops.bcol[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wards.map((w) => (
                  <tr key={w.ward} className="border-b border-line/60">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/ward/${w.ward}`} className="font-medium whitespace-nowrap hover:text-accent">
                          {b(w.label)}
                        </Link>
                        <TierPill tier={w.tier} className="max-sm:hidden" />
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{f.n(w.beds.capacity)}</td>
                    <td className="px-2 py-2 tabular-nums">{f.n(w.required.beds)}</td>
                    <td className={`px-2 py-2 font-semibold tabular-nums ${w.beds.net_balance < 0 ? "text-critical-ink" : "text-low"}`}>
                      {w.beds.net_balance > 0 ? "+" : ""}
                      {f.n(w.beds.net_balance)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{w.beds.sent ? f.n(w.beds.sent) : "–"}</td>
                    <td className="px-2 py-2 tabular-nums">{w.beds.received ? f.n(w.beds.received) : "–"}</td>
                    <td className={`px-2 py-2 tabular-nums ${w.beds.unplaced ? "font-semibold text-critical-ink" : ""}`}>{w.beds.unplaced ? f.n(w.beds.unplaced) : "–"}</td>
                    <td className="px-2 py-2">
                      <LoadBar value={w.required.beds && w.beds.capacity ? w.required.beds / w.beds.capacity : w.required.beds ? 2 : 0} after={w.beds.utilization} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="text-xs text-muted">{t.ops.capacityNote}</p>
    </div>
  );
}

function PoolCard({ p, normal }: { p: Pool; normal: number }) {
  const { t, f, b } = useI18n();
  const pct = (v: number) => f.n(`${Math.round(v * 100)}%`);
  const full = p.headroom === 0 && p.unplaced > 0;
  return (
    <section className="panel panel-edge rise min-w-0 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{b(p.city)}</h3>
        {full && <span className="rounded-full bg-critical/15 px-2 py-0.5 text-[11px] font-semibold text-critical-ink">{t.ops.cityFull}</span>}
      </div>
      <p className="text-xs text-muted">
        {t.ops.poolOpen(f.n(p.capacity), f.n(normal))} · {t.ops.need(f.n(p.demand))}
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <Bar label={t.ops.before} value={p.utilization_before} text={pct(p.utilization_before)} />
        <Bar label={t.ops.after} value={p.utilization_after} text={pct(p.utilization_after)} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Fig n={f.n(p.transferred)} label={t.ops.moved} tone="text-accent" />
        <Fig n={f.n(p.unplaced)} label={t.ops.unplaced} tone={p.unplaced ? "text-critical-ink" : "text-low"} />
        <Fig n={f.n(p.headroom)} label={t.ops.headroom} tone="text-ink" />
      </dl>
    </section>
  );
}

function Bar({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color: loadColor(value) }}>{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(value, 1) * 100}%`, background: loadColor(value) }} />
      </div>
    </div>
  );
}

function Fig({ n, label, tone }: { n: string; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line px-1 py-1.5">
      <dd className={`font-display text-lg font-semibold tabular-nums ${tone}`}>{n}</dd>
      <dt className="text-[10.5px] leading-tight text-muted">{label}</dt>
    </div>
  );
}

/** Before routing (outline) vs after routing (fill). */
function LoadBar({ value, after }: { value: number; after: number }) {
  const { f } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-20 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${Math.min(value, 1) * 100}%`, background: loadColor(value) }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(after, 1) * 100}%`, background: loadColor(after) }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{f.n(`${Math.round(after * 100)}%`)}</span>
    </div>
  );
}
