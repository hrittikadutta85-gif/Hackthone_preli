"use client";
import { useEffect, useRef, useState } from "react";
import { addDays, runPrediction, useTemplate, type Observation, type PredictResult } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n, type Dict } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill, tierGlow } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DriverBars } from "@/components/charts";

type Column = { key: "rain" | "temp" | "humidity" | "cases"; label: "rainfall" | "temperature" | "humidity" | "cases"; unit: (t: Dict) => string; min: number; max: number; step: number };
const COLS: Column[] = [
  { key: "rain", label: "rainfall", unit: (t) => t.predict.mm, min: 0, max: 1000, step: 1 },
  { key: "temp", label: "temperature", unit: (t) => t.predict.celsius, min: 5, max: 45, step: 0.1 },
  { key: "humidity", label: "humidity", unit: () => "%", min: 1, max: 100, step: 1 },
  { key: "cases", label: "cases", unit: () => "", min: 0, max: 10000, step: 1 },
];

/** Reads date,rain,temp,humidity,cases (header row optional, extra columns ignored, Bengali digits accepted). */
function parseCsv(text: string): Observation[] {
  const lines = toLatinDigits(text.replace(/^\uFEFF/, "")).trim().split(/\r?\n/).filter(Boolean);
  const num = (v?: string) => (v == null || v.trim() === "" || isNaN(Number(v)) ? null : Number(v));
  const rows = lines.map((l) => l.split(",").map((c) => c.trim()));
  if (rows.length === 0) return [];
  const body = /^\d{4}-\d{2}-\d{2}/.test(rows[0][0]) ? rows : rows.slice(1);
  return body.map((c) => ({ date: c[0], rain: num(c[1]), temp: num(c[2]), humidity: num(c[3]), cases: num(c[4]) }));
}

export default function Portal() {
  const { t, f, b } = useI18n();
  const { meta, horizon } = useControls();
  const [ward, setWard] = useState("DSCC_Ward_05");
  const { data: tpl, error: tplError } = useTemplate(ward);
  const [rows, setRows] = useState<Observation[]>([]);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [unreadable, setUnreadable] = useState(false);
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
      setUnreadable(false);
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
    setUnreadable(false);
    try {
      setResult(await runPrediction(ward, horizon, rows));
    } catch (e) {
      setResult(null);
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (upload?: File) => {
    if (!upload) return;
    const parsed = parseCsv(await upload.text());
    if (parsed.length === 0 || parsed.some((r) => isNaN(Date.parse(r.date)))) {
      setUnreadable(true);
    } else {
      setRows(parsed);
      setResult(null);
      setError(null);
      setUnreadable(false);
    }
    if (file.current) file.current.value = "";
  };

  const focus = result?.horizons.find((h) => h.h === horizon);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.predict.eyebrow}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.predict.title}</h1>
        <p className="mt-3 max-w-2xl text-base text-ink/80 sm:text-lg">{t.predict.intro}</p>
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm max-sm:w-full">
            <span className="font-medium">{t.predict.ward}</span>
            <select value={ward} onChange={(e) => setWard(e.target.value)} className="field min-w-0 rounded-full px-4 py-1.5 font-medium max-sm:flex-1">
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
          </label>
          <div className="flex flex-wrap gap-2 text-sm max-sm:w-full max-sm:[&>button]:flex-1">
            {/* Android file pickers report CSV files under several types */}
            <input ref={file} type="file" accept=".csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button onClick={() => file.current?.click()} className="btn">
              <Icon name="upload" /> {t.predict.upload}
            </button>
            <button
              onClick={() => {
                if (tpl) setRows(tpl.weeks);
                setUnreadable(false);
              }}
              className="btn text-muted"
            >
              {t.predict.reset}
            </button>
          </div>
        </div>

        {tplError ? (
          <ErrorNote error={tplError} />
        ) : rows.length === 0 ? (
          <Skeleton className="h-64" />
        ) : (
          // a table on wide screens; one card per week on phones
          <div className="md:overflow-x-auto">
            <table className="w-full text-sm max-md:block">
              <thead className="max-md:hidden">
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-medium">{t.predict.weekOf}</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="pb-2 font-medium">
                      {t.predict[c.label]} {c.unit(t) && <span className="font-normal">({c.unit(t)})</span>}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="max-md:block max-md:space-y-3">
                {rows.map((r, i) => (
                  <tr key={r.date + i} className="border-t border-line/70 max-md:relative max-md:grid max-md:grid-cols-2 max-md:gap-3 max-md:rounded-xl max-md:border max-md:border-line max-md:bg-raise max-md:p-3">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap max-md:col-span-2 max-md:flex max-md:min-h-8 max-md:items-center max-md:py-0">
                      <span className="mr-1.5 text-muted md:hidden">{t.predict.weekOf}:</span>
                      {f.date(r.date, true)}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="py-1.5 pr-3 max-md:flex max-md:min-w-0 max-md:flex-col max-md:justify-end max-md:p-0">
                        <span className="mb-1 text-xs text-muted md:hidden" aria-hidden>
                          {t.predict[c.label]} {c.unit(t) && `(${c.unit(t)})`}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={c.min}
                          max={c.max}
                          step={c.step}
                          value={r[c.key] ?? ""}
                          placeholder={c.key === "cases" ? t.predict.optional : ""}
                          aria-label={t.predict.cellLabel(t.predict[c.label], f.date(r.date, true))}
                          onChange={(e) => set(i, c.key, e.target.value)}
                          className="field w-24 rounded-lg px-2 py-1.5 font-mono text-[13px] tabular-nums max-md:w-full"
                        />
                      </td>
                    ))}
                    <td className="py-1.5 text-right max-md:absolute max-md:top-1 max-md:right-1 max-md:p-0">
                      {i === rows.length - 1 && rows.length > 4 && (
                        <button onClick={() => setRows(rows.slice(0, -1))} aria-label={t.predict.removeWeek} className="cursor-pointer p-1 text-muted hover:text-critical-ink max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center pointer-coarse:grid pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:place-items-center">
                          <Icon name="close" />
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
          <button onClick={addWeek} disabled={rows.length === 0 || rows.length >= 26} className="cursor-pointer text-sm font-medium text-accent hover:underline disabled:opacity-40 tap max-md:w-full max-md:rounded-full max-md:border max-md:border-dashed max-md:border-accent/50">
            {t.predict.addWeek}
          </button>
          <button onClick={submit} disabled={busy || missing || rows.length === 0} className="btn btn-primary !px-7 !py-2.5 !text-base max-md:w-full">
            <Icon name="activity" /> {busy ? t.predict.working : t.predict.predict}
          </button>
        </div>
        {missing && rows.length > 0 && (
          <p role="status" className="text-xs text-medium">
            {t.predict.missing}
          </p>
        )}
      </Card>

      {unreadable && <ErrorNote error={new Error(t.predict.unreadable)} />}
      {error && <ErrorNote error={error} />}

      {result && (
        <div className="space-y-4 sm:space-y-6" aria-live="polite" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>
          <div className="rise">
            <p className="eyebrow">{t.predict.from(b(result.label), f.date(result.origin, true))}</p>
            <h2 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-3xl">{b(result.headline)}</h2>
            <div className="mt-3 max-w-2xl space-y-2 text-base text-ink/80 sm:text-lg">
              {result.story.map((s, i) => (
                <p key={i}>{b(s)}</p>
              ))}
            </div>
            {result.warnings.map((w) => (
              <p key={w} className="mt-2 flex items-start gap-2 text-sm text-muted">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 text-medium" /> {b(w)}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {result.horizons.map((r) => (
              <div key={r.h} className="panel min-w-0 p-3 sm:p-4" style={tierGlow(r.tier, r.h === horizon)}>
                <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
                  <span className="font-semibold">{t.common.weekName(r.h)}</span>
                  <TierPill tier={r.tier} />
                </div>
                <div className="font-display mt-2 text-3xl font-semibold tabular-nums sm:text-4xl">
                  <AnimatedNumber value={r.predicted} digits={1} />
                </div>
                <div className="text-xs text-muted">{t.ward.casesLikely(f.n(r.lower, 0), f.n(r.upper, 0))}</div>
                <div className="mt-1 text-xs text-muted">{t.common.weekOf(f.date(r.target_date))}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="font-display text-xl font-semibold">{t.ward.behindTitle(horizon)}</h3>
              <p className="mb-4 text-sm text-muted">{t.ward.behindDesc}</p>
              <DriverBars drivers={result.drivers[String(horizon)]} />
            </Card>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold">{t.ward.actionsTitle}</h3>
                {focus && <TierPill tier={focus.tier} />}
              </div>
              <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-accent">
                {result.actions.map((a) => (
                  <li key={a}>{b(a)}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
