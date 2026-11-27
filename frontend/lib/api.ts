"use client";
import useSWR from "swr";

export const TIERS = ["Low", "Medium", "High", "Critical"] as const;
export type Tier = (typeof TIERS)[number];

// One meaning per colour everywhere: green, amber, orange, red.
export const TIER_COLOR: Record<Tier, string> = {
  Low: "#34bd72",
  Medium: "#f4ce45",
  High: "#f8871c",
  Critical: "#e02a3c",
};

export interface Meta {
  cities: string[];
  wards: { id: string; label: string; city: string }[];
  horizons: number[];
  origins: string[];
  default_origin: string;
  thresholds: Record<"Medium" | "High" | "Critical", number>;
  tier_help: Record<Tier, string>;
  tier_actions: Record<Tier, string[]>;
  last_data_date: string;
  validation_end: string;
}

export interface HorizonRow {
  h: number;
  target_date: string;
  predicted: number;
  lower: number;
  upper: number;
  score: number;
  tier: Tier;
  actual: number | null;
}

export interface Driver {
  group: string;
  plain: string;
  effect_cases: number;
  effect_pct: number;
  top_feature: string;
  weather: boolean;
  value: number | null;
}

export interface WardForecast {
  ward: string;
  label: string;
  city: string;
  origin: string;
  focus_h: number;
  in_sample: boolean;
  horizons: HorizonRow[];
  drivers: Record<string, Driver[]>;
  headline: string;
  story: string[];
  actions: string[];
  cases_now: number | null;
  history: { date: string; cases: number | null; future: boolean }[];
  weather: { date: string; rain: number | null; temp: number | null; humidity: number | null }[];
  profile: {
    density: number;
    waterlogging: number;
    sanitation: number;
    density_vs_city: number;
    waterlogging_vs_city: number;
    sanitation_vs_city: number;
  };
}

export interface CityWard {
  ward: string;
  label: string;
  city: string;
  predicted: number;
  lower: number;
  upper: number;
  score: number;
  tier: Tier;
  cases_now: number | null;
  actual: number | null;
}

export interface CityView {
  origin: string;
  horizon: number;
  city: string | null;
  wards: CityWard[];
  counts: Record<Tier, number>;
  summary: string;
  in_sample: boolean;
  heatmap: { weeks: string[]; rows: { ward: string; label: string; scores: (number | null)[] }[] };
}

export interface WhatIfBody {
  origin: string;
  horizon: number;
  rain_pct: number;
  temp_shift: number;
  humidity_shift: number;
  rain_mm: number[] | null;
}

export interface WhatIfResult {
  baseline: HorizonRow[];
  scenario: HorizonRow[];
  summary: string;
  recorded_weather: { date: string; rain: number; temp: number; humidity: number }[];
}

export interface Performance {
  horizon: number;
  label: string;
  summary: {
    h: number;
    mae: number;
    rmse: number;
    r2: number;
    baseline_rmse: number;
    baseline_mae: number;
    improvement_pct: number;
    coverage: number;
    tier_accuracy: number;
    tier_within_one: number;
    alert_recall: number;
    alert_precision: number;
  }[];
  backtest: { date: string; predicted: number; lower: number; upper: number; actual: number | null }[];
  confusion: { tiers: Tier[]; matrix: number[][] };
  top_features: { name: string; share: number }[];
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `Request failed (${r.status})`);
  return r.json();
}

const opts = { revalidateOnFocus: false, keepPreviousData: true } as const;

export const useMeta = () => useSWR<Meta>("/api/meta", get, opts);

export const useCity = (origin: string | null, horizon: number, city: string | null) =>
  useSWR<CityView>(
    origin ? `/api/city?origin=${origin}&horizon=${horizon}${city ? `&city=${encodeURIComponent(city)}` : ""}` : null,
    get,
    opts,
  );

export const useWard = (id: string, origin: string | null, horizon: number) =>
  useSWR<WardForecast>(origin ? `/api/ward/${id}?origin=${origin}&horizon=${horizon}` : null, get, opts);

export const usePerformance = (ward: string | null, horizon: number) =>
  useSWR<Performance>(ward ? `/api/performance?ward=${ward}&horizon=${horizon}` : null, get, opts);

export const useWhatIf = (id: string, body: WhatIfBody | null) =>
  useSWR<WhatIfResult>(
    body ? ["whatif", id, JSON.stringify(body)] : null,
    async ([, ward, payload]: [string, string, string]) => {
      const r = await fetch(`/api/ward/${ward}/whatif`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (!r.ok) throw new Error("The what-if run failed.");
      return r.json();
    },
    opts,
  );

export interface Observation {
  date: string;
  rain: number | null;
  temp: number | null;
  humidity: number | null;
  cases: number | null;
}

export interface PredictResult {
  ward: string;
  label: string;
  origin: string;
  horizons: HorizonRow[];
  drivers: Record<string, Driver[]>;
  headline: string;
  story: string[];
  actions: string[];
  cases_now: number | null;
  warnings: string[];
  resources: ResourceOutlook;
  alerts: PortalAlert[];
}

export type Supplies = Record<"saline" | "kits" | "beds", number>;

export interface ResourceOutlook {
  bed_capacity: number;
  peak_beds: number;
  weeks: { h: number; target_date: string; tier: Tier; expected: Supplies; upper: Supplies; crews: number; over_capacity: boolean; over_capacity_expected: boolean }[];
  totals: { expected: Supplies; upper: Supplies };
}

/** An alert the portal's forecast would raise (same rules as the alert system; not stored). */
export interface PortalAlert {
  alert_type: "risk_increase" | "case_surge" | "rainfall" | "upcoming_high";
  level: "Medium" | "High" | "Critical";
  prev_tier: Tier | null;
  new_tier: Tier;
  horizon: number;
  predicted_cases: number;
  baseline: number | null;
  change_pct: number | null;
  rain_mm: number | null;
  rain_threshold: number | null;
  target_week: string;
  action: string;
}

export interface Template {
  label: string;
  city: string;
  profile: { density: number; waterlogging: number; sanitation: number };
  rules: Record<"saline" | "kits" | "beds", { per_case: number; offset: number }>;
  weeks: Observation[];
}

export const useTemplate = (ward: string) =>
  useSWR<Template>(`/api/predict/template?ward=${ward}&weeks=8`, get, { revalidateOnFocus: false });

export async function runPrediction(ward: string, horizon: number, weeks: Observation[]): Promise<PredictResult> {
  const r = await fetch(`/api/predict/${ward}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ horizon, weeks }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const d = j?.detail;
    // FastAPI validation errors come back as a list; turn them into one readable line.
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? "Some values are out of range. Check rainfall (0–1000 mm), temperature (5–45 °C) and humidity (1–100%)." : `Request failed (${r.status})`);
  }
  return r.json();
}

export interface MapData {
  horizon: number;
  weeks: string[];
  wards: { ward: string; label: string; city: string; num: string }[];
  predicted: (number | null)[][];
  lower: (number | null)[][];
  upper: (number | null)[][];
  tier: (number | null)[][];
  actual: (number | null)[][];
  cases_now: (number | null)[][];
}

export const useMap = (horizon: number) => useSWR<MapData>(`/api/map?horizon=${horizon}`, get, opts);

/** Date arithmetic in UTC so local time zones (e.g. UTC+6) never shift a week-start date by a day. */
export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export interface OutlookBlock {
  cases_now: number | null;
  wards: number;
  horizons: { h: number; target_date: string; expected: number; alert_wards: number }[];
}
export interface Outlook {
  origin: string;
  summary: string;
  total: OutlookBlock;
  cities: (OutlookBlock & { city: string })[];
}

export const useOutlook = (origin: string | null) => useSWR<Outlook>(origin ? `/api/outlook?origin=${origin}` : null, get, opts);

/** Turns rows into a CSV file and hands it to the browser as a download. */
export function downloadCsv(filename: string, rows: Record<string, string | number | null>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number | null) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  // the byte-order mark lets spreadsheet apps read Bangla text correctly
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); // some mobile browsers ignore clicks on detached links
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
