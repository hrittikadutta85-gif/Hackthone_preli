"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addDays, downloadCsv, runPrediction, useTemplate, type Observation, type PredictResult, type Template } from "@/lib/api";
import { describe } from "@/lib/alerts";
import { useControls } from "@/lib/controls";
import { useI18n, type Dict } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill, tierGlow } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DriverBars } from "@/components/charts";
import { LevelPill } from "@/components/alerts/AlertCard";

type Column = { key: "rain" | "temp" | "humidity" | "cases"; label: "rainfall" | "temperature" | "humidity" | "cases"; unit: (t: Dict) => string; min: number; max: number; step: number };
const COLS: Column[] = [
  { key: "rain", label: "rainfall", unit: (t) => t.predict.mm, min: 0, max: 1000, step: 1 },
  { key: "temp", label: "temperature", unit: (t) => t.predict.celsius, min: 5, max: 45, step: 0.1 },
  { key: "humidity", label: "humidity", unit: () => "%", min: 1, max: 100, step: 1 },
  { key: "cases", label: "cases", unit: () => "", min: 0, max: 10000, step: 1 },
];

// Column names accepted in an uploaded header row, including the official dataset's own names.
const ALIASES: Record<"date" | "rain" | "temp" | "humidity" | "cases" | "ward", string[]> = {
  date: ["date", "week", "week_of", "week_start"],
  rain: ["rain", "rainfall", "rainfall_mm"],
  temp: ["temp", "temperature", "avg_temp", "avg_temp_c"],
  humidity: ["humidity", "relative_humidity", "relative_humidity_pct", "rh"],
  cases: ["cases", "dengue_cases", "cases_reported"],
  ward: ["ward_id", "ward"],
};
const MAX_WEEKS = 26;

/**
 * Reads an uploaded CSV. Either five columns in order (date, rain, temp, humidity, cases; header optional) or any
 * file with a header row using the names above, such as rows copied from the official dataset. A ward_id column is
 * filtered to the chosen ward (or, if the file holds a single ward, that ward is used). Bengali digits are accepted.
 */
function parseCsv(text: string, ward: string): { rows: Observation[]; ward: string | null } {
  const lines = toLatinDigits(text.replace(/^\uFEFF/, "")).trim().split(/\r?\n/).filter(Boolean);
  const num = (v?: string) => (v == null || v.trim() === "" || isNaN(Number(v)) ? null : Number(v));
  const cells = lines.map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  if (cells.length === 0) return { rows: [], ward: null };
  if (/^\d{4}-\d{2}-\d{2}/.test(cells[0][0])) {
    const rows = cells.map((c) => ({ date: c[0], rain: num(c[1]), temp: num(c[2]), humidity: num(c[3]), cases: num(c[4]) }));
    return { rows: rows.slice(-MAX_WEEKS), ward: null };
  }
  const head = cells[0].map((h) => h.toLowerCase().replace(/\W+/g, "_"));
  const col = (k: keyof typeof ALIASES) => head.findIndex((h) => ALIASES[k].includes(h));
  const idx = { date: col("date"), rain: col("rain"), temp: col("temp"), humidity: col("humidity"), cases: col("cases"), ward: col("ward") };
  if (idx.date < 0 || idx.rain < 0 || idx.temp < 0 || idx.humidity < 0) {
    // a header without recognised names: fall back to the column order
    const rows = cells.slice(1).map((c) => ({ date: c[0], rain: num(c[1]), temp: num(c[2]), humidity: num(c[3]), cases: num(c[4]) }));
    return { rows: rows.slice(-MAX_WEEKS), ward: null };
  }
  let body = cells.slice(1);
  let picked: string | null = null;
  if (idx.ward >= 0) {
    const ids = new Set(body.map((c) => c[idx.ward].toUpperCase().replace("WARD", "Ward")));
    picked = ids.has(ward) ? ward : ids.size === 1 ? [...ids][0] : null;
    body = picked ? body.filter((c) => c[idx.ward].toUpperCase().replace("WARD", "Ward") === picked) : [];
  }
  const rows = body
    .map((c) => ({ date: c[idx.date], rain: num(c[idx.rain]), temp: num(c[idx.temp]), humidity: num(c[idx.humidity]), cases: idx.cases >= 0 ? num(c[idx.cases]) : null }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { rows: rows.slice(-MAX_WEEKS), ward: picked };
}

/** Supplies for a week with this many cases: the dataset's own rule, floor(rate x cases + offset). */
const supplies = (rules: Template["rules"] | undefined, cases: number | null) =>
  rules && cases != null
    ? { saline: Math.floor(rules.saline.per_case * cases + rules.saline.offset), kits: Math.floor(rules.kits.per_case * cases + rules.kits.offset), beds: Math.floor(rules.beds.per_case * cases + rules.beds.offset) }
    : null;

export default function Portal() {
  const { t, f, b } = useI18n();
  const { meta, horizon } = useControls();
  const [ward, setWard] = useState("DSCC_Ward_05");
  const { data: tpl, error: tplError } = useTemplate(ward);
  const [rows, setRows] = useState<Observation[]>([]);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [unreadable, setUnreadable] = useState<string | false>(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const skipTemplate = useRef(false);

  // Opened from a ward page (/predict?ward=...): start on that ward.
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("ward");
    if (w) setWard(w);
  }, []);

  useEffect(() => {
    if (tpl && skipTemplate.current) {
      skipTemplate.current = false;
      return;
    }
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
    const { rows: parsed, ward: inFile } = parseCsv(await upload.text(), ward);
    const label = (id: string) => b(meta?.wards.find((w) => w.id === id)?.label ?? id);
    setLoaded(null);
    if (parsed.length === 0 && inFile === null && /ward/i.test((await upload.text()).split(/\r?\n/)[0] ?? "")) {
      setUnreadable(t.predict.unreadableWard(label(ward)));
    } else if (parsed.length === 0 || parsed.some((r) => isNaN(Date.parse(r.date)))) {
      setUnreadable(t.predict.unreadable);
    } else {
      if (inFile && inFile !== ward && meta?.wards.some((w) => w.id === inFile)) setWard(inFile);
      skipTemplate.current = Boolean(inFile && inFile !== ward);
      setRows(parsed);
      setResult(null);
      setError(null);
      setUnreadable(false);
      setLoaded(t.predict.loaded(parsed.length, label(inFile ?? ward)));
    }
    if (file.current) file.current.value = "";
  };

  const exportCsv = () =>
    result &&
    downloadCsv(`forecast_${result.ward}_${result.origin}.csv`, result.horizons.map((h, i) => {
      const r = result.resources.weeks[i];
      return {
        ward_id: result.ward, forecast_from: result.origin, week_of: h.target_date, weeks_ahead: h.h,
        risk_level: t.common.tier[h.tier], expected_cases: h.predicted, likely_low: h.lower, likely_high: h.upper,
        saline_bags_expected: r.expected.saline, saline_bags_high: r.upper.saline, test_kits_expected: r.expected.kits,
        test_kits_high: r.upper.kits, beds_expected: r.expected.beds, beds_high: r.upper.beds,
        ward_bed_capacity: result.resources.bed_capacity, crews_needed: r.crews,
      };
    }));

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

        {tpl && (
          <p className="-mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <Icon name="ward" className="h-3.5 w-3.5 text-accent" />
            {t.predict.profile(f.int(tpl.profile.density), f.n(tpl.profile.waterlogging), f.n(tpl.profile.sanitation))}
          </p>
        )}
        <p className="text-xs text-muted">{t.predict.uploadHint}</p>
        {loaded && (
          <p role="status" className="flex items-center gap-2 text-sm text-accent">
            <Icon name="check" /> {loaded}
          </p>
        )}

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
                  <th className="pb-2 font-medium max-lg:hidden">{t.predict.suppliesCol}</th>
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
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap text-muted tabular-nums max-lg:hidden">
                      {(() => {
                        const sup = supplies(tpl?.rules, r.cases);
                        return sup ? t.predict.suppliesCell(f.n(sup.saline), f.n(sup.kits), f.n(sup.beds)) : "–";
                      })()}
                    </td>
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

      {unreadable && <ErrorNote error={new Error(unreadable)} />}
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
                {result.resources && (
                  <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink/75 tabular-nums">
                    {(() => {
                      const e = result.resources.weeks.find((w) => w.h === r.h)!.expected;
                      return t.predict.cardSupplies(f.n(e.saline), f.n(e.kits), f.n(e.beds));
                    })()}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.resources && <Resources result={result} onDownload={exportCsv} />}

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

          {result.alerts && (
            <Card>
              <h3 className="font-display text-xl font-semibold">{t.predict.alertsTitle}</h3>
              <p className="mt-1 text-sm text-muted">{t.predict.alertsDesc}</p>
              {result.alerts.length === 0 ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-low">
                  <Icon name="check" /> {t.predict.alertsNone}
                </p>
              ) : (
                <ul className="mt-4 grid gap-3 md:grid-cols-2">
                  {result.alerts.map((a) => (
                    <li key={a.alert_type} className="rounded-xl border border-line bg-raise p-3" style={{ borderLeft: `3px solid var(--${a.level.toLowerCase()})` }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <LevelPill level={a.level} />
                        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{t.alerts.type[a.alert_type]}</span>
                      </div>
                      <p className="mt-1.5 text-sm">{describe(a, t, f)}</p>
                      <p className="mt-1 text-xs text-muted">{t.alerts.expected(f.date(a.target_week, true))}</p>
                      <p className="mt-2 text-sm">
                        <span className="text-muted">{t.alerts.action}: </span>
                        {b(a.action)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Resources({ result, onDownload }: { result: PredictResult; onDownload: () => void }) {
  const { t, f } = useI18n();
  const r = result.resources;
  const cap = f.n(r.bed_capacity);
  const over = r.weeks.some((w) => w.over_capacity);
  const cell = (e: number, u: number) => (e === u ? f.n(e) : t.predict.range(f.n(e), f.n(u)));
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="font-display text-xl font-semibold">{t.predict.resTitle}</h3>
          <p className="mt-1 text-sm text-muted">{t.predict.resDesc(cap)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onDownload} className="btn">
            <Icon name="download" /> {t.predict.download}
          </button>
          <Link href="/ops" className="btn">
            <Icon name="ops" /> {t.predict.openOps}
          </Link>
        </div>
      </div>
      <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              {(["week", "cases", "saline", "kits", "beds", "crews"] as const).map((k) => (
                <th key={k} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                  {t.predict.resCol[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.weeks.map((w, i) => {
              const h = result.horizons[i];
              return (
                <tr key={w.h} className="border-b border-line/60">
                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="font-medium">{t.common.weekShort(w.h)}</span> <span className="text-xs text-muted">{f.date(w.target_date)}</span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{t.predict.range(f.n(h.predicted, 0), f.n(h.upper, 0))}</td>
                  <td className="px-2 py-2 tabular-nums">{cell(w.expected.saline, w.upper.saline)}</td>
                  <td className="px-2 py-2 tabular-nums">{cell(w.expected.kits, w.upper.kits)}</td>
                  <td className={`px-2 py-2 tabular-nums ${w.over_capacity ? "font-semibold text-critical-ink" : ""}`}>
                    {cell(w.expected.beds, w.upper.beds)}
                    {w.over_capacity && <span className="ml-1 text-[11px] font-normal">({t.predict.overCap(cap)})</span>}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{f.n(w.crews)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="px-2 py-2">{t.predict.total}</td>
              <td />
              <td className="px-2 py-2 tabular-nums">{cell(r.totals.expected.saline, r.totals.upper.saline)}</td>
              <td className="px-2 py-2 tabular-nums">{cell(r.totals.expected.kits, r.totals.upper.kits)}</td>
              <td className="px-2 py-2 tabular-nums">{cell(r.totals.expected.beds, r.totals.upper.beds)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`mt-3 flex items-start gap-2 text-sm ${over ? "text-critical-ink" : "text-low"}`}>
        <Icon name={over ? "alert" : "check"} className="mt-0.5 h-4 w-4" />
        {over ? t.predict.overCapNote(f.n(r.peak_beds), cap) : t.predict.capOk}
      </p>
    </Card>
  );
}
