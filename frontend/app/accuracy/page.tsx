"use client";
import { useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TIER_COLOR, usePerformance } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { Card, ErrorNote, Skeleton, useMedia } from "@/components/ui";
import { PHONE } from "@/components/charts";

export default function Accuracy() {
  const { t, f, b } = useI18n();
  const phone = useMedia(PHONE);
  const { meta, horizon } = useControls();
  const [ward, setWard] = useState("DSCC_Ward_05");
  const { data, error } = usePerformance(ward, horizon);
  const s = data?.summary.find((r) => r.h === horizon);
  const pct = (x: number) => f.digits(`${Math.round(x * 100)}%`);
  const series = [
    { name: t.accuracy.range, swatch: "h-2.5 w-4 rounded-[3px] opacity-40", color: "var(--forecast)" },
    { name: t.accuracy.forecast, swatch: "h-0.5 w-4", color: "var(--forecast)" },
    { name: t.accuracy.actual, swatch: "h-2 w-2 rounded-full", color: "var(--ink)" },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.accuracy.eyebrow}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.accuracy.title}</h1>
        <p className="mt-3 max-w-2xl text-base text-ink/80 sm:text-lg">{t.accuracy.intro(horizon)}</p>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : !data || !s ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <div className="grid gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <Stat big={`±${f.n(s.mae, 1)}`} title={t.accuracy.maeTitle} note={t.accuracy.maeNote} />
            <Stat big={f.digits(`${s.improvement_pct.toFixed(0)}%`)} title={t.accuracy.betterTitle} note={t.accuracy.betterNote} />
            <Stat big={pct(s.alert_recall)} title={t.accuracy.recallTitle} note={t.accuracy.recallNote(pct(s.alert_precision))} />
            <Stat big={pct(s.coverage)} title={t.accuracy.coverageTitle} note={t.accuracy.coverageNote} />
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">{t.accuracy.backtestTitle}</h2>
                <select value={ward} onChange={(e) => setWard(e.target.value)} aria-label={t.accuracy.wardToShow} className="field rounded-full px-4 py-1.5 text-sm font-medium max-sm:w-full">
                  {meta?.cities.map((c) => (
                    <optgroup key={c} label={b(c)}>
                      {meta.wards.filter((w) => w.city === c).map((w) => (
                        <option key={w.id} value={w.id}>
                          {b(w.label).split(",")[0]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <p className="mb-3 text-sm text-muted">{t.accuracy.backtestDesc(horizon, b(data.label))}</p>
              <div className="h-64 sm:h-72" role="img" aria-label={t.accuracy.backtestLabel}>
                <ResponsiveContainer>
                  <ComposedChart data={data.backtest.map((p) => ({ ...p, range: [p.lower, p.upper] }))} margin={{ top: 8, right: phone ? 4 : 12, bottom: 0, left: phone ? -28 : -12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d) => f.date(d)} tick={{ fontSize: 11 }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => f.n(v)} />
                    <Tooltip
                      labelFormatter={(d) => t.common.weekOf(f.date(String(d), true))}
                      formatter={(v) => (Array.isArray(v) ? f.digits(`${v[0]} – ${v[1]}`) : f.n(String(v)))}
                    />
                    <Area dataKey="range" name={t.accuracy.range} stroke="none" fill="var(--forecast)" fillOpacity={0.17} animationDuration={800} />
                    <Line dataKey="predicted" name={t.accuracy.forecast} stroke="var(--forecast)" strokeWidth={2} dot={false} animationDuration={800} />
                    <Line dataKey="actual" name={t.accuracy.actual} stroke="none" dot={{ r: phone ? 2 : 3, fill: "var(--ink)" }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {series.map((item) => (
                  <li key={item.name} className="flex items-center gap-1.5">
                    <span aria-hidden className={item.swatch} style={{ background: item.color }} />
                    {item.name}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="lg:col-span-2">
              <h2 className="font-display text-xl font-semibold">{t.accuracy.levelTitle}</h2>
              <p className="mb-4 text-sm text-muted">{t.accuracy.levelDesc(pct(s.tier_accuracy), pct(s.tier_within_one))}</p>
              <div className="overflow-x-auto">
                <Confusion tiers={data.confusion.tiers} m={data.confusion.matrix} />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-xl font-semibold">{t.accuracy.byWindowTitle}</h2>
              <p className="mb-3 text-sm text-muted">{t.accuracy.byWindowDesc}</p>
              <div className="h-64" role="img" aria-label={t.accuracy.byWindowLabel}>
                <ResponsiveContainer>
                  <BarChart data={data.summary.map((r) => ({ name: t.accuracy.windowTick(r.h), model: r.mae, naive: r.baseline_mae }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => f.n(v)} />
                    <Tooltip formatter={(v) => t.common.cases(f.n(Number(v), 2))} />
                    <Bar dataKey="naive" name={t.accuracy.naive} fill="#526d8c" radius={[4, 4, 0, 0]} animationDuration={700} />
                    <Bar dataKey="model" name={t.accuracy.model} fill="#22bfac" radius={[4, 4, 0, 0]} animationDuration={700} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {[
                  { name: t.accuracy.naive, color: "#526d8c" },
                  { name: t.accuracy.model, color: "#22bfac" },
                ].map((item) => (
                  <li key={item.name} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} />
                    {item.name}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="font-display text-xl font-semibold">{t.accuracy.featuresTitle}</h2>
              <p className="mb-4 text-sm text-muted">{t.accuracy.featuresDesc(horizon)}</p>
              <ul className="space-y-2.5">
                {data.top_features.slice(0, 7).map((feature, i) => (
                  // two model inputs (sine and cosine of the week) share the name "time of year", so key by rank too
                  <li key={`${i}-${feature.name}`}>
                    <div className="flex justify-between gap-3 text-sm">
                      <span>{b(feature.name)}</span>
                      <span className="tabular-nums text-muted">{f.digits(`${(feature.share * 100).toFixed(0)}%`)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-raise">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent/35 to-accent transition-all duration-700" style={{ width: `${(feature.share / data.top_features[0].share) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <h2 className="font-display text-xl font-semibold">{t.accuracy.knowTitle}</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink/80 marker:text-accent">
              {t.accuracy.know.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ big, title, note }: { big: string; title: string; note: string }) {
  return (
    <Card className="rise">
      <div className="font-display text-3xl font-semibold text-accent tabular-nums [text-shadow:0_0_24px_rgb(45_212_191/0.35)] sm:text-4xl">{big}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </Card>
  );
}

function Confusion({ tiers, m }: { tiers: (keyof typeof TIER_COLOR)[]; m: number[][] }) {
  const { t, f } = useI18n();
  const rowMax = m.map((r) => Math.max(...r, 1));
  return (
    <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs sm:text-sm">
      <thead>
        <tr>
          <th className="w-[24%]" />
          {tiers.map((tier) => (
            <th key={tier} className="text-[11px] font-medium break-words text-muted sm:text-xs">
              {t.common.tier[tier]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {m.map((row, i) => (
          <tr key={tiers[i]}>
            <th scope="row" className="pr-1 text-right text-[11px] font-medium break-words text-muted sm:text-xs">
              {t.common.tier[tiers[i]]}
            </th>
            {row.map((v, j) => (
              <td
                key={j}
                className="rounded-lg py-2.5 font-medium tabular-nums"
                style={
                  i === j
                    ? {
                        // stronger fill = more of that row's weeks were called correctly
                        background: `color-mix(in srgb, ${TIER_COLOR[tiers[i]]} ${Math.round(14 + 36 * (v / rowMax[i]))}%, transparent)`,
                        boxShadow: `inset 0 0 0 1px ${TIER_COLOR[tiers[i]]}`,
                      }
                    : { background: "var(--raise)" }
                }
              >
                {f.n(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
