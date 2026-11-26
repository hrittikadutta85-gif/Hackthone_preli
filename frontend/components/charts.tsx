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
import { TIER_COLOR, type Driver, type Meta, type WardForecast } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useMedia } from "./ui";

const GRID = "var(--line)";
const AXIS = { fontSize: 11, fill: "var(--muted)" };
const DRAW = { animationDuration: 800, animationEasing: "ease-out" } as const; // honours reduced-motion by default
export const PHONE = "(max-width: 39.99rem)";

interface Point {
  date: string;
  cases?: number | null;
  actual?: number | null;
  predicted?: number;
  range?: [number, number];
}

function ForecastTip({ active, payload, label }: { active?: boolean; payload?: { payload: Point }[]; label?: string }) {
  const { t, f } = useI18n();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="max-w-[14rem] rounded-xl border border-accent/35 bg-card/95 px-3 py-2 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.5)]">
      <div className="font-semibold">{t.common.weekOf(f.date(label!, true))}</div>
      {p.cases != null && <div>{t.charts.reported(p.cases)}</div>}
      {p.predicted != null && p.cases == null && (
        <div>
          {t.charts.forecast(f.n(p.predicted, 1))}
          {p.range && <span className="text-muted"> {t.charts.likely(f.n(p.range[0], 0), f.n(p.range[1], 0))}</span>}
        </div>
      )}
      {p.actual != null && <div className="text-muted">{t.charts.actually(p.actual)}</div>}
    </div>
  );
}

export function ForecastChart({ data, meta, activeH }: { data: WardForecast; meta: Meta; activeH: number }) {
  const { t, f, b } = useI18n();
  const phone = useMedia(PHONE);
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
    <div role="img" aria-label={t.charts.forecastLabel(b(data.label))} className="h-72 w-full sm:h-80">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 20, right: phone ? 6 : 16, bottom: 0, left: phone ? -26 : -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => f.date(d)} tick={AXIS} minTickGap={24} />
          <YAxis tick={AXIS} allowDecimals={false} tickFormatter={(v) => f.n(v)} />
          <Tooltip content={<ForecastTip />} />
          {(["Medium", "High", "Critical"] as const).map((level) => (
            <ReferenceLine
              key={level}
              y={meta.thresholds[level]}
              stroke={TIER_COLOR[level]}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              // on a phone the names sit on the left, clear of the forecast points
              label={{ value: t.common.tier[level], position: phone ? "insideTopLeft" : "insideTopRight", fill: TIER_COLOR[level], fontSize: 11 }}
            />
          ))}
          <ReferenceLine x={data.origin} stroke="var(--accent)" strokeDasharray="2 3" label={{ value: t.charts.now, position: "top", fontSize: 11, fill: "var(--accent)" }} />
          {focus && <ReferenceLine x={focus.target_date} stroke={TIER_COLOR[focus.tier]} strokeWidth={2} strokeOpacity={0.35} />}
          <Bar dataKey="cases" fill="#526d8c" radius={[4, 4, 0, 0]} {...DRAW} />
          <Area dataKey="range" stroke="none" fill="var(--forecast)" fillOpacity={0.17} {...DRAW} />
          <Line
            dataKey="predicted"
            stroke="var(--forecast)"
            strokeWidth={2.5}
            connectNulls
            {...DRAW}
            dot={(p: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
              const h = data.horizons.find((x) => x.target_date === p.payload?.date);
              if (!h || p.cx == null || p.cy == null) return <g key={p.index} />;
              const r = h.h === activeH ? 8 : 5.5;
              return <circle key={p.index} cx={p.cx} cy={p.cy} r={phone ? r - 1.5 : r} fill={TIER_COLOR[h.tier]} stroke="var(--card)" strokeWidth={2} />;
            }}
          />
          <Line dataKey="actual" stroke="none" isAnimationActive={false} dot={{ r: phone ? 3.5 : 4.5, fill: "var(--card)", stroke: "var(--ink)", strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeatherChart({ weather }: { weather: WardForecast["weather"] }) {
  const { t, f } = useI18n();
  const phone = useMedia(PHONE);
  const n = weather.length;
  // Lags 2 to 4 weeks before the forecast week: the stretch of rain that matters most for mosquito breeding.
  const win = n >= 5 ? { x1: weather[n - 5].date, x2: weather[n - 3].date } : null;
  const series = [
    { key: "rain", name: t.charts.rain, color: "#3f8fe0", unit: ` ${t.charts.mm}` },
    { key: "temp", name: t.charts.temperature, color: "#d9782a", unit: ` ${t.charts.celsius}` },
    { key: "humidity", name: t.charts.humidity, color: "#16a693", unit: "%" },
  ] as const;
  return (
    <div>
      <div role="img" aria-label={t.charts.weatherLabel} className="h-64 w-full">
        <ResponsiveContainer>
          <ComposedChart data={weather} margin={{ top: 16, right: phone ? -8 : 8, bottom: 0, left: phone ? -16 : -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => f.date(d)} tick={AXIS} minTickGap={20} />
            {/* phones drop the unit from each tick; the legend below names it */}
            <YAxis yAxisId="rain" tick={AXIS} tickFormatter={(v) => (phone ? f.n(v) : `${f.n(v)} ${t.charts.mm}`)} width={phone ? 48 : 68} />
            <YAxis yAxisId="other" orientation="right" tick={AXIS} width={36} tickFormatter={(v) => f.n(v)} />
            <Tooltip
              labelFormatter={(d) => t.common.weekOf(f.date(String(d), true))}
              formatter={(v, name, item) => [`${f.n(String(v))}${series.find((s) => s.key === item.dataKey)?.unit ?? ""}`, name]}
            />
            {win && (
              <ReferenceArea
                yAxisId="rain"
                x1={win.x1}
                x2={win.x2}
                fill="var(--accent)"
                fillOpacity={0.09}
                label={{ value: t.charts.breeding, position: "insideTop", fontSize: 11, fill: "var(--accent)" }}
              />
            )}
            <Bar yAxisId="rain" dataKey="rain" name={t.charts.rain} fill={series[0].color} radius={[4, 4, 0, 0]} {...DRAW} />
            <Line yAxisId="other" dataKey="temp" name={t.charts.temperature} stroke={series[1].color} strokeWidth={2} dot={false} {...DRAW} />
            <Line yAxisId="other" dataKey="humidity" name={t.charts.humidity} stroke={series[2].color} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={s.key === "rain" ? "h-2.5 w-2.5 rounded-[3px]" : "h-0.5 w-4"} style={{ background: s.color }} />
            {s.name} ({s.unit.trim()})
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Diverging bars: how many cases each factor adds or removes compared with a typical week at this time of year. */
export function DriverBars({ drivers }: { drivers: Driver[] }) {
  const { t, f, b } = useI18n();
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
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">
                {b(d.group.replace(" (multi-week lags)", "").replace(" (surveillance)", ""))}
                {d.weather && <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-accent uppercase">{t.charts.weather}</span>}
              </span>
              <span className={`ml-auto tabular-nums ${small ? "text-muted" : up ? "text-critical-ink" : "text-low"}`}>
                {small ? t.charts.aboutNormal : t.charts.effect(up ? "+" : "−", f.n(Math.abs(d.effect_cases), 1))}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-raise">
              <div className="absolute -inset-y-0.5 left-1/2 w-px bg-ink/40" />
              <div
                className="absolute inset-y-0 rounded-full transition-all duration-500"
                style={{
                  width: `${w}%`,
                  left: up ? "50%" : `${50 - w}%`,
                  background: up ? "var(--critical)" : "var(--low)",
                  boxShadow: small ? undefined : `0 0 10px -2px ${up ? "var(--critical)" : "var(--low)"}`,
                  opacity: small ? 0.3 : 0.95,
                }}
              />
            </div>
            {!small && <div className="mt-1 text-xs text-muted">{t.charts.mostly(b(d.top_feature))}</div>}
          </li>
        );
      })}
    </ul>
  );
}
