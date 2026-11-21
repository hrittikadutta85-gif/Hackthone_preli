"use client";
import { useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TIER_COLOR, fmtDate, usePerformance } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { Card, ErrorNote, Skeleton } from "@/components/ui";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function Accuracy() {
  const { meta, horizon } = useControls();
  const [ward, setWard] = useState("DSCC_Ward_05");
  const { data, error } = usePerformance(ward, horizon);
  const s = data?.summary.find((r) => r.h === horizon);
  const wk = horizon === 1 ? "a week" : `${horizon} weeks`;

  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="text-sm font-medium text-accent">Can I trust it?</p>
        <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
          We tested it on a whole year it had never seen.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">
          The model learned from 2016 to 2023, was tuned on 2024, and was then scored once on 2025. Everything below is
          from that final exam, for forecasts made {wk} ahead. Change the window at the top to see the others.
        </p>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : !data || !s ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat big={`±${s.mae.toFixed(1)}`} title="cases off, on average" note={`per ward per week. Typical weeks have 2 to 13 cases.`} />
            <Stat big={`${s.improvement_pct.toFixed(0)}%`} title="better than guessing 'no change'" note="That naive guess misses more because outbreaks move." />
            <Stat big={pct(s.alert_recall)} title="of real High/Critical weeks caught" note={`${pct(s.alert_precision)} of the alerts we raised were real.`} />
            <Stat big={pct(s.coverage)} title="of the time reality fell in our range" note="We aim for 80%, so the ranges are honest." />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold">2025, forecast versus reality</h2>
                <select
                  value={ward}
                  onChange={(e) => setWard(e.target.value)}
                  aria-label="Ward to show"
                  className="rounded-full border border-line bg-card px-4 py-1.5 text-sm font-medium"
                >
                  {meta?.cities.map((c) => (
                    <optgroup key={c} label={c}>
                      {meta.wards.filter((w) => w.city === c).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label.split(",")[0]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <p className="mb-3 text-sm text-muted">
                Each point is a forecast made {wk} earlier. {data.label}.
              </p>
              <div className="h-72" role="img" aria-label="Backtest of forecast versus actual cases in 2025">
                <ResponsiveContainer>
                  <ComposedChart data={data.backtest.map((b) => ({ ...b, range: [b.lower, b.upper] }))} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke="#e8e0d2" />
                    <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={{ fontSize: 12, fill: "#5f6f69" }} minTickGap={30} />
                    <YAxis tick={{ fontSize: 12, fill: "#5f6f69" }} />
                    <Tooltip labelFormatter={(d) => `Week of ${fmtDate(String(d), true)}`} />
                    <Area dataKey="range" name="Likely range" stroke="none" fill="#c62828" fillOpacity={0.14} isAnimationActive={false} />
                    <Line dataKey="predicted" name="Forecast" stroke="#c62828" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line dataKey="actual" name="What happened" stroke="none" dot={{ r: 3.5, fill: "#1d2a26" }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <h2 className="font-display text-xl font-semibold">Did it call the right risk level?</h2>
              <p className="mb-4 text-sm text-muted">
                Right on the money {pct(s.tier_accuracy)} of the time, and within one level {pct(s.tier_within_one)} of the time.
                Rows are what happened, columns are what we said.
              </p>
              <Confusion tiers={data.confusion.tiers} m={data.confusion.matrix} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-xl font-semibold">Accuracy by how far ahead</h2>
              <p className="mb-3 text-sm text-muted">Average miss in cases. Lower is better. The grey bar is the &ldquo;nothing will change&rdquo; guess.</p>
              <div className="h-64" role="img" aria-label="Average error by forecast window, model versus naive guess">
                <ResponsiveContainer>
                  <BarChart data={data.summary.map((r) => ({ name: r.h === 1 ? "1 wk" : `${r.h} wks`, model: r.mae, naive: r.baseline_mae }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="#e8e0d2" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5f6f69" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#5f6f69" }} />
                    <Tooltip formatter={(v) => `${Number(v).toFixed(2)} cases`} />
                    <Bar dataKey="naive" name="Assume no change" fill="#c9d3cf" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="model" name="Our model" fill="#0f6b5c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="font-display text-xl font-semibold">What the model pays attention to</h2>
              <p className="mb-4 text-sm text-muted">Overall, across every ward, for the {horizon}-week forecast.</p>
              <ul className="space-y-2.5">
                {data.top_features.slice(0, 7).map((f) => (
                  <li key={f.name}>
                    <div className="flex justify-between text-sm">
                      <span>{f.name}</span>
                      <span className="tabular-nums text-muted">{(f.share * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-line/60">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(f.share / data.top_features[0].share) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <h2 className="font-display text-xl font-semibold">Good to know</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink/80">
              <li>The forecast is an expected number with a range, not a promise. Real weeks can land outside it about 1 time in 5.</li>
              <li>Longer windows are a little less accurate, because there is more time for things to change.</li>
              <li>The data is weekly and per ward, so it can&apos;t say which street or household is at risk.</li>
              <li>It never uses information from after the forecast week, so these scores are what you&apos;d have seen live.</li>
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
      <div className="font-display text-4xl font-semibold text-accent tabular-nums">{big}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </Card>
  );
}

function Confusion({ tiers, m }: { tiers: (keyof typeof TIER_COLOR)[]; m: number[][] }) {
  const rowMax = m.map((r) => Math.max(...r, 1));
  return (
    <table className="w-full border-separate border-spacing-1 text-center text-sm">
      <thead>
        <tr>
          <th />
          {tiers.map((t) => (
            <th key={t} className="text-xs font-medium text-muted">
              {t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {m.map((row, i) => (
          <tr key={tiers[i]}>
            <th scope="row" className="pr-1 text-right text-xs font-medium text-muted">
              {tiers[i]}
            </th>
            {row.map((v, j) => (
              <td
                key={j}
                className="rounded-lg py-2.5 font-medium tabular-nums"
                style={{ background: i === j ? TIER_COLOR[tiers[i]] : "#efe9dc", color: i === j ? "#fff" : "#1d2a26", opacity: i === j ? 0.4 + 0.6 * (v / rowMax[i]) : 1 }}
              >
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
