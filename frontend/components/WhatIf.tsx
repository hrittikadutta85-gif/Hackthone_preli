"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TIERS, TIER_COLOR, useWhatIf, type WardForecast } from "@/lib/api";
import { useI18n, type Dict } from "@/lib/i18n";
import { Card, Skeleton, TierPill, useDebounced, useMedia } from "./ui";
import { Icon, type IconName } from "./icons";
import { PHONE } from "./charts";

const PRESETS: { key: keyof Dict["whatif"]["presets"]; icon: IconName; rain: number; temp: number; hum: number }[] = [
  { key: "monsoon", icon: "rain", rain: 80, temp: 0, hum: 8 },
  { key: "dry", icon: "sun", rain: -70, temp: 1, hum: -10 },
  { key: "heat", icon: "heat", rain: 0, temp: 3, hum: -5 },
  { key: "damp", icon: "mist", rain: 30, temp: -2, hum: 8 },
];

export function WhatIf({ ward, data, horizon }: { ward: string; data: WardForecast; horizon: number }) {
  const { t, f, b } = useI18n();
  const phone = useMedia(PHONE);
  const recorded = useMemo(() => data.weather.slice(-8), [data.weather]);
  const [rainPct, setRainPct] = useState(0);
  const [temp, setTemp] = useState(0);
  const [hum, setHum] = useState(0);
  const [rain, setRain] = useState<number[] | null>(null);

  // a stable object, so the debounce settles instead of re-rendering every quarter second
  const request = useMemo(
    () => ({ origin: data.origin, horizon, rain_pct: rainPct, temp_shift: temp, humidity_shift: hum, rain_mm: rain }),
    [data.origin, horizon, rainPct, temp, hum, rain],
  );
  const body = useDebounced(request);
  const { data: res, isLoading } = useWhatIf(ward, body);
  const dirty = rainPct !== 0 || temp !== 0 || hum !== 0 || rain !== null;

  const reset = () => {
    setRainPct(0);
    setTemp(0);
    setHum(0);
    setRain(null);
  };
  const rainValues = rain ?? recorded.map((r) => r.rain ?? 0);
  const chart = res?.baseline.map((base, i) => ({ name: t.common.weekShort(base.h), recorded: base.predicted, scenario: res.scenario[i].predicted, tier: res.scenario[i].tier, h: base.h }));
  const sel = res && { b: res.baseline.find((r) => r.h === horizon)!, s: res.scenario.find((r) => r.h === horizon)! };
  const comparison = sel && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <TierPill tier={sel.b.tier} />
      <span aria-hidden>→</span>
      <TierPill tier={sel.s.tier} />
      <span className="text-muted">{t.whatif.change(f.n(sel.b.predicted, 1), f.n(sel.s.predicted, 1))}</span>
    </div>
  );

  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold">{t.whatif.title}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">{t.whatif.desc(b(data.label))}</p>
        </div>
        <button onClick={reset} disabled={!dirty} className="btn text-muted">
          {t.whatif.reset}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap" role="group" aria-label={t.whatif.scenarios}>
        {PRESETS.map((p) => {
          const on = rainPct === p.rain && temp === p.temp && hum === p.hum && rain === null;
          return (
            <button
              key={p.key}
              aria-pressed={on}
              onClick={() => {
                setRainPct(p.rain);
                setTemp(p.temp);
                setHum(p.hum);
                setRain(null);
              }}
              className="btn"
            >
              <Icon name={p.icon} /> {t.whatif.presets[p.key]}
            </button>
          );
        })}
      </div>

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
        <Slider label={t.whatif.rainfall} value={rainPct} min={-100} max={200} step={10} onChange={setRainPct} fmt={(v) => f.digits(`${v > 0 ? "+" : ""}${v}%`)} />
        <Slider label={t.whatif.temperature} value={temp} min={-5} max={5} step={0.5} onChange={setTemp} fmt={(v) => `${f.digits(`${v > 0 ? "+" : ""}${v}`)}${t.charts.celsius}`} />
        <Slider label={t.whatif.humidity} value={hum} min={-20} max={20} step={1} onChange={setHum} fmt={(v) => t.whatif.points(f.digits(`${v > 0 ? "+" : ""}${v}`))} />
      </div>

      <details className="rounded-xl border border-line bg-raise p-4">
        <summary className="cursor-pointer text-sm font-medium max-lg:py-3 pointer-coarse:py-3">{t.whatif.manual}</summary>
        <div className="mt-4 grid grid-cols-2 gap-3 min-[400px]:grid-cols-4 lg:grid-cols-8">
          {recorded.map((r, i) => (
            <label key={r.date} className="text-xs text-muted">
              {f.date(r.date)}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                value={Math.round(rainValues[i])}
                onChange={(e) => {
                  const next = [...rainValues];
                  next[i] = Math.max(0, Number(e.target.value) || 0);
                  setRain(next);
                }}
                className="field mt-1 w-full rounded-lg px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="sr-only">{t.whatif.millimetres}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t.whatif.manualNote}</p>
      </details>

      <div aria-live="polite">
        {!res ? (
          <Skeleton className="h-64" />
        ) : (
          <div className={`grid gap-6 transition-opacity md:grid-cols-5 ${isLoading ? "opacity-60" : ""}`}>
            <div className="space-y-4 md:col-span-2">
              <p className="font-display text-lg leading-snug font-medium sm:text-xl">{b(res.summary)}</p>
              {comparison}
            </div>
            <div className="min-w-0 md:col-span-3">
              <div className="h-60" role="img" aria-label={t.whatif.chartLabel}>
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: phone ? -28 : -16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => f.n(v)} />
                  <Tooltip formatter={(v) => t.common.cases(f.n(Number(v), 1))} />
                  <Bar dataKey="recorded" name={t.whatif.recorded} fill="#a9bcb6" radius={[4, 4, 0, 0]} animationDuration={600} />
                  <Bar dataKey="scenario" name={t.whatif.scenario} fill="var(--ink)" radius={[4, 4, 0, 0]} animationDuration={600}>
                    {chart?.map((c) => (
                      <Cell key={c.h} fill={TIER_COLOR[c.tier]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#a9bcb6]" />
                  {t.whatif.recorded}
                </li>
                <li className="flex items-center gap-1.5">
                  {/* the scenario bars take the colour of their risk level */}
                  <span aria-hidden className="flex h-2.5 w-5 overflow-hidden rounded-[3px]">
                    {TIERS.map((tier) => (
                      <span key={tier} className="flex-1" style={{ background: TIER_COLOR[tier] }} />
                    ))}
                  </span>
                  {t.whatif.scenario}
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* phones: the result and Reset stay in view while the sliders are being moved */}
      {dirty && comparison && (
        <div data-testid="whatif-bar" className="sticky bottom-2 z-10 flex items-center justify-between gap-2 rounded-xl border border-accent/45 bg-card/95 px-3 py-2 shadow-[0_8px_28px_rgb(25_59_56/0.2)] md:hidden">
          {comparison}
          <button onClick={reset} className="btn shrink-0">
            {t.whatif.reset}
          </button>
        </div>
      )}
    </Card>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  const { t } = useI18n();
  return (
    <label className="block">
      <div className="mb-2 flex justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={`tabular-nums ${value === 0 ? "text-muted" : "font-semibold text-accent"}`}>{value === 0 ? t.whatif.asRecorded : fmt(value)}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
