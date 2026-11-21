"use client";
import { useEffect, useRef, useState } from "react";
import { TIER_COLOR, addDays, fmtDate, runPrediction, useTemplate, type Observation, type PredictResult } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill } from "@/components/ui";
import { DriverBars } from "@/components/charts";

const COLS: { key: "rain" | "temp" | "humidity" | "cases"; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "rain", label: "Rainfall", unit: "mm", min: 0, max: 1000, step: 1 },
  { key: "temp", label: "Avg temp", unit: "°C", min: 5, max: 45, step: 0.1 },
  { key: "humidity", label: "Humidity", unit: "%", min: 1, max: 100, step: 1 },
  { key: "cases", label: "Cases reported", unit: "", min: 0, max: 10000, step: 1 },
];


/** Reads date,rain,temp,humidity,cases (header row optional, extra columns ignored). */
function parseCsv(text: string): Observation[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const num = (v?: string) => (v == null || v.trim() === "" || isNaN(Number(v)) ? null : Number(v));
  const rows = lines.map((l) => l.split(",").map((c) => c.trim()));
  const body = /^\d{4}-\d{2}-\d{2}/.test(rows[0][0]) ? rows : rows.slice(1);
  return body.map((c) => ({ date: c[0], rain: num(c[1]), temp: num(c[2]), humidity: num(c[3]), cases: num(c[4]) }));
}

export default function Portal() {
  const { meta, horizon } = useControls();
  const [ward, setWard] = useState("DSCC_Ward_05");
  const { data: tpl, error: tplError } = useTemplate(ward);
  const [rows, setRows] = useState<Observation[]>([]);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // Opened from a ward page (/predict?ward=...): start on that ward.
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("ward");
    if (w) setWard(w);
  }, []);

  useEffect(() => {
    if (tpl) {
      setRows(tpl.weeks);
      setResult(null);
      setError(null);
    }
  }, [tpl]);

  const set = (i: number, key: keyof Observation, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: v === "" ? null : Number(v) } : r)));

  const addWeek = () =>
    setRows((rs) => {
      const last = rs[rs.length - 1];
      return [...rs, { ...last, date: addDays(last.date, 7), cases: null }];
    });

  const missing = rows.some((r) => r.rain == null || r.temp == null || r.humidity == null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await runPrediction(ward, horizon, rows));
    } catch (e) {
      setResult(null);
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    const parsed = parseCsv(await f.text());
    if (parsed.length === 0 || parsed.some((r) => isNaN(Date.parse(r.date)))) {
      setError(new Error("I couldn't read that file. Use columns: date, rainfall, temperature, humidity, cases, one row per week."));
    } else {
      setRows(parsed);
      setResult(null);
      setError(null);
    }
    if (file.current) file.current.value = "";
  };

  const focus = result?.horizons.find((h) => h.h === horizon);

  return (
    <div className="space-y-8">
      <div className="rise">
        <p className="text-sm font-medium text-accent">Prediction portal</p>
        <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">
          Got this week&apos;s numbers? Find out where dengue is heading.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink/80">
          Pick a ward, enter the weather and case counts you&apos;ve recorded, and get a forecast for the next four weeks.
          The table starts with the latest weeks on file. Edit them, add a new week, or upload a spreadsheet.
        </p>
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Ward</span>
            <select value={ward} onChange={(e) => setWard(e.target.value)} className="rounded-full border border-line bg-card px-4 py-1.5 font-medium">
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
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button onClick={() => file.current?.click()} className="rounded-full border border-line px-4 py-1.5 font-medium hover:border-accent/50">
              Upload CSV
            </button>
            <button onClick={() => tpl && setRows(tpl.weeks)} className="rounded-full border border-line px-4 py-1.5 font-medium text-muted hover:text-ink">
              Reset to recorded data
            </button>
          </div>
        </div>

        {tplError ? (
          <ErrorNote error={tplError} />
        ) : rows.length === 0 ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">Week of</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="pb-2 font-medium">
                      {c.label} {c.unit && <span className="font-normal">({c.unit})</span>}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.date + i} className="border-t border-line/70">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{fmtDate(r.date, true)}</td>
                    {COLS.map((c) => (
                      <td key={c.key} className="py-1.5 pr-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={c.min}
                          max={c.max}
                          step={c.step}
                          value={r[c.key] ?? ""}
                          placeholder={c.key === "cases" ? "optional" : ""}
                          aria-label={`${c.label} for week of ${r.date}`}
                          onChange={(e) => set(i, c.key, e.target.value)}
                          className="w-24 rounded-lg border border-line bg-card px-2 py-1.5 tabular-nums outline-none focus:border-accent"
                        />
                      </td>
                    ))}
                    <td className="py-1.5 text-right">
                      {i === rows.length - 1 && rows.length > 4 && (
                        <button onClick={() => setRows(rows.slice(0, -1))} aria-label="Remove last week" className="text-muted hover:text-critical">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={addWeek} disabled={rows.length === 0 || rows.length >= 26} className="text-sm font-medium text-accent hover:underline disabled:opacity-40">
            + Add the next week
          </button>
          <button
            onClick={submit}
            disabled={busy || missing || rows.length === 0}
            className="rounded-full bg-accent px-6 py-2.5 font-semibold text-white shadow transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:opacity-50"
          >
            {busy ? "Working it out…" : "Predict"}
          </button>
        </div>
        {missing && rows.length > 0 && <p className="text-xs text-muted">Fill in rainfall, temperature and humidity for every week to continue. Cases can be left blank.</p>}
      </Card>

      {error && <ErrorNote error={error} />}

      {result && (
        <div className="space-y-6" aria-live="polite">
          <div className="rise">
            <p className="text-sm font-medium text-accent">
              {result.label} · forecast from the week of {fmtDate(result.origin, true)}
            </p>
            <h2 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold">{result.headline}</h2>
            <div className="mt-3 max-w-2xl space-y-2 text-lg text-ink/80">
              {result.story.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </div>
            {result.warnings.map((w) => (
              <p key={w} className="mt-2 text-sm text-muted">
                ⚠ {w}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {result.horizons.map((r) => (
              <div
                key={r.h}
                className="rounded-2xl border bg-card p-4 shadow-sm"
                style={{ borderColor: r.h === horizon ? TIER_COLOR[r.tier] : "var(--line)", boxShadow: r.h === horizon ? `0 0 0 2px ${TIER_COLOR[r.tier]}` : undefined }}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{r.h === 1 ? "Next week" : `In ${r.h} weeks`}</span>
                  <TierPill tier={r.tier} />
                </div>
                <div className="font-display mt-2 text-4xl font-semibold tabular-nums">
                  <AnimatedNumber value={r.predicted} digits={1} />
                </div>
                <div className="text-xs text-muted">
                  cases · likely {r.lower.toFixed(0)}–{r.upper.toFixed(0)}
                </div>
                <div className="mt-1 text-xs text-muted">Week of {fmtDate(r.target_date)}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="font-display text-xl font-semibold">What&apos;s behind the {horizon}-week forecast</h3>
              <p className="mb-4 text-sm text-muted">Compared with a typical week at this time of year, how many cases each factor adds or removes.</p>
              <DriverBars drivers={result.drivers[String(horizon)]} />
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold">What to do about it</h3>
                {focus && <TierPill tier={focus.tier} />}
              </div>
              <ul className="mt-4 list-disc space-y-2 pl-5">
                {result.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
