"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TIER_COLOR, fmtDate, useWhatIf, type WardForecast } from "@/lib/api";
import { Card, Skeleton, TierPill, useDebounced } from "./ui";

const PRESETS = [
  { label: "Monsoon surge", icon: "🌧️", rain: 80, temp: 0, hum: 8 },
  { label: "Dry spell", icon: "☀️", rain: -70, temp: 1, hum: -10 },
  { label: "Heatwave", icon: "🔥", rain: 0, temp: 3, hum: -5 },
  { label: "Cool and damp", icon: "🌫️", rain: 30, temp: -2, hum: 8 },
];

export function WhatIf({ ward, data, horizon }: { ward: string; data: WardForecast; horizon: number }) {
  const recorded = useMemo(() => data.weather.slice(-8), [data.weather]);
  const [rainPct, setRainPct] = useState(0);
  const [temp, setTemp] = useState(0);
  const [hum, setHum] = useState(0);
  const [rain, setRain] = useState<number[] | null>(null);

  const body = useDebounced({ origin: data.origin, horizon, rain_pct: rainPct, temp_shift: temp, humidity_shift: hum, rain_mm: rain });
  const { data: res, isLoading } = useWhatIf(ward, body);
  const dirty = rainPct !== 0 || temp !== 0 || hum !== 0 || rain !== null;

  const reset = () => {
    setRainPct(0);
    setTemp(0);
    setHum(0);
    setRain(null);
  };
  const rainValues = rain ?? recorded.map((r) => r.rain ?? 0);
  const chart = res?.baseline.map((b, i) => ({ name: b.h === 1 ? "Next week" : `In ${b.h} wks`, recorded: b.predicted, scenario: res.scenario[i].predicted, tier: res.scenario[i].tier, h: b.h }));
  const sel = res && { b: res.baseline.find((r) => r.h === horizon)!, s: res.scenario.find((r) => r.h === horizon)! };

  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">What if the weather changes?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Change the last 8 weeks of weather and the model re-scores {data.label} straight away. It&apos;s a way to ask
            &ldquo;how bad could this get?&rdquo; before the rain arrives.
          </p>
        </div>
        <button
          onClick={reset}
          disabled={!dirty}
          className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-muted transition enabled:hover:text-ink disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Weather scenarios">
        {PRESETS.map((p) => {
          const on = rainPct === p.rain && temp === p.temp && hum === p.hum && rain === null;
          return (
            <button
              key={p.label}
              aria-pressed={on}
              onClick={() => {
                setRainPct(p.rain);
                setTemp(p.temp);
                setHum(p.hum);
                setRain(null);
              }}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line hover:border-accent/50"}`}
            >
              <span aria-hidden>{p.icon}</span> {p.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
        <Slider label="Rainfall" value={rainPct} min={-100} max={200} step={10} onChange={setRainPct} fmt={(v) => `${v > 0 ? "+" : ""}${v}%`} />
        <Slider label="Temperature" value={temp} min={-5} max={5} step={0.5} onChange={setTemp} fmt={(v) => `${v > 0 ? "+" : ""}${v}°C`} />
        <Slider label="Humidity" value={hum} min={-20} max={20} step={1} onChange={setHum} fmt={(v) => `${v > 0 ? "+" : ""}${v} pts`} />
      </div>

      <details className="rounded-xl border border-line bg-paper/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Or set each week&apos;s rainfall yourself</summary>
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-8">
          {recorded.map((r, i) => (
            <label key={r.date} className="text-xs text-muted">
              {fmtDate(r.date)}
              <input
                type="number"
                min={0}
                max={600}
                value={Math.round(rainValues[i])}
                onChange={(e) => {
                  const next = [...rainValues];
                  next[i] = Math.max(0, Number(e.target.value) || 0);
                  setRain(next);
                }}
                className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink tabular-nums"
              />
              <span className="sr-only">millimetres</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Millimetres of rain per week. The rainfall slider above scales these numbers.</p>
      </details>

      <div aria-live="polite">
        {!res ? (
          <Skeleton className="h-64" />
        ) : (
          <div className={`grid gap-6 md:grid-cols-5 transition-opacity ${isLoading ? "opacity-60" : ""}`}>
            <div className="space-y-4 md:col-span-2">
              <p className="font-display text-xl leading-snug font-medium">{res.summary}</p>
              {sel && (
                <div className="flex items-center gap-3 text-sm">
                  <TierPill tier={sel.b.tier} />
                  <span aria-hidden>→</span>
                  <TierPill tier={sel.s.tier} />
                  <span className="text-muted">
                    {sel.b.predicted.toFixed(1)} → {sel.s.predicted.toFixed(1)} cases
                  </span>
                </div>
              )}
            </div>
            <div className="h-60 md:col-span-3" role="img" aria-label="Expected cases with recorded weather versus the scenario">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="#e8e0d2" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5f6f69" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#5f6f69" }} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(1)} cases`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="recorded" name="Recorded weather" fill="#b8c4bf" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="scenario" name="Your scenario" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chart?.map((c) => (
                      <Cell key={c.h} fill={TIER_COLOR[c.tier]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="block">
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={`tabular-nums ${value === 0 ? "text-muted" : "font-semibold text-accent"}`}>{value === 0 ? "as recorded" : fmt(value)}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
