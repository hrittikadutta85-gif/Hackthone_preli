"use client";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TIER_COLOR, fmtDate, type Driver, type Meta, type WardForecast } from "@/lib/api";

const GRID = "#e8e0d2";
const AXIS = { fontSize: 12, fill: "#5f6f69" };

interface Point {
  date: string;
  cases?: number | null;
  actual?: number | null;
  predicted?: number;
  range?: [number, number];
}

function ForecastTip({ active, payload, label }: { active?: boolean; payload?: { payload: Point }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-lg">
      <div className="font-semibold">Week of {fmtDate(label!, true)}</div>
      {p.cases != null && <div>Reported: {p.cases} cases</div>}
      {p.predicted != null && p.cases == null && (
        <div>
          Forecast: {p.predicted.toFixed(1)} cases
          {p.range && <span className="text-muted"> (likely {p.range[0].toFixed(0)}–{p.range[1].toFixed(0)})</span>}
        </div>
      )}
      {p.actual != null && <div className="text-muted">What actually happened: {p.actual}</div>}
    </div>
  );
}

export function ForecastChart({ data, meta, activeH }: { data: WardForecast; meta: Meta; activeH: number }) {
  const byDate = new Map<string, Point>();
  for (const r of data.history) byDate.set(r.date, r.future ? { date: r.date, actual: r.cases } : { date: r.date, cases: r.cases });
  const now = byDate.get(data.origin);
  if (now) Object.assign(now, { predicted: data.cases_now ?? undefined, range: [data.cases_now ?? 0, data.cases_now ?? 0] });
  for (const h of data.horizons) {
    const p = byDate.get(h.target_date) ?? { date: h.target_date };
    Object.assign(p, { predicted: h.predicted, range: [h.lower, h.upper] as [number, number] });
    byDate.set(h.target_date, p);
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const focus = data.horizons.find((h) => h.h === activeH);

  return (
    <div role="img" aria-label={`Weekly dengue cases with a forecast for ${data.label}`} className="h-80 w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={AXIS} minTickGap={24} />
          <YAxis tick={AXIS} allowDecimals={false} />
          <Tooltip content={<ForecastTip />} />
          {(["Medium", "High", "Critical"] as const).map((t) => (
            <ReferenceLine
              key={t}
              y={meta.thresholds[t]}
              stroke={TIER_COLOR[t]}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{ value: t, position: "insideTopRight", fill: TIER_COLOR[t], fontSize: 11 }}
            />
          ))}
          <ReferenceLine x={data.origin} stroke="#1d2a26" strokeDasharray="2 3" label={{ value: "now", position: "top", fontSize: 11, fill: "#1d2a26" }} />
          {focus && <ReferenceLine x={focus.target_date} stroke={TIER_COLOR[focus.tier]} strokeWidth={2} strokeOpacity={0.35} />}
          <Bar dataKey="cases" fill="#9fb3ab" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Area dataKey="range" stroke="none" fill="#c62828" fillOpacity={0.14} isAnimationActive={false} />
          <Line
            dataKey="predicted"
            stroke="#c62828"
            strokeWidth={3}
            connectNulls
            isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
              const h = data.horizons.find((x) => x.target_date === p.payload?.date);
              if (!h || p.cx == null || p.cy == null) return <g key={p.index} />;
              return <circle key={p.index} cx={p.cx} cy={p.cy} r={h.h === activeH ? 9 : 6} fill={TIER_COLOR[h.tier]} stroke="#fff" strokeWidth={2} />;
            }}
          />
          <Line dataKey="actual" stroke="none" isAnimationActive={false} dot={{ r: 5, fill: "#1d2a26", stroke: "#fff", strokeWidth: 1.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeatherChart({ weather }: { weather: WardForecast["weather"] }) {
  const n = weather.length;
  // Lags 2 to 4 weeks before the forecast week: the stretch of rain that matters most for mosquito breeding.
  const win = n >= 5 ? { x1: weather[n - 5].date, x2: weather[n - 3].date } : null;
  return (
    <div role="img" aria-label="Recent weekly rainfall, temperature and humidity" className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={weather} margin={{ top: 16, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={AXIS} minTickGap={20} />
          <YAxis yAxisId="rain" tick={AXIS} unit=" mm" width={52} />
          <YAxis yAxisId="other" orientation="right" tick={AXIS} width={36} />
          <Tooltip
            labelFormatter={(d) => `Week of ${fmtDate(String(d), true)}`}
            formatter={(v, name) => [name === "Rain" ? `${v} mm` : name === "Temperature" ? `${v} °C` : `${v}%`, name]}
          />
          {win && (
            <ReferenceArea
              yAxisId="rain"
              x1={win.x1}
              x2={win.x2}
              fill="#0f6b5c"
              fillOpacity={0.1}
              label={{ value: "breeding window", position: "insideTop", fontSize: 11, fill: "#0f6b5c" }}
            />
          )}
          <Bar yAxisId="rain" dataKey="rain" name="Rain" fill="#3b82c4" radius={[4, 4, 0, 0]} />
          <Line yAxisId="other" dataKey="temp" name="Temperature" stroke="#e8711a" strokeWidth={2} dot={false} />
          <Line yAxisId="other" dataKey="humidity" name="Humidity" stroke="#2e9e5b" strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Diverging bars: how many cases each factor adds or removes compared with a typical week at this time of year. */
export function DriverBars({ drivers }: { drivers: Driver[] }) {
  const max = Math.max(...drivers.map((d) => Math.abs(d.effect_cases)), 0.5);
  const ordered = [...drivers].sort((a, b) => Math.abs(b.effect_cases) - Math.abs(a.effect_cases));
  return (
    <ul className="space-y-3">
      {ordered.map((d) => {
        const up = d.effect_cases >= 0;
        const w = (Math.abs(d.effect_cases) / max) * 50;
        const small = Math.abs(d.effect_cases) < 0.15;
        return (
          <li key={d.group}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {d.group.replace(" (multi-week lags)", "").replace(" (surveillance)", "")}
                {d.weather && <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent uppercase">weather</span>}
              </span>
              <span className={`tabular-nums ${small ? "text-muted" : up ? "text-critical" : "text-low"}`}>
                {small ? "about normal" : `${up ? "+" : "−"}${Math.abs(d.effect_cases).toFixed(1)} cases`}
              </span>
            </div>
            <div className="relative mt-1.5 h-3 rounded-full bg-line/60">
              <div className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
              <div
                className="absolute inset-y-0 rounded-full transition-all duration-500"
                style={{
                  width: `${w}%`,
                  left: up ? "50%" : `${50 - w}%`,
                  background: up ? "#c62828" : "#2e9e5b",
                  opacity: small ? 0.3 : 0.85,
                }}
              />
            </div>
            {!small && <div className="mt-1 text-xs text-muted">Mostly {d.top_feature}</div>}
          </li>
        );
      })}
    </ul>
  );
}
