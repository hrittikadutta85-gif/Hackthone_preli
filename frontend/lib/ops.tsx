"use client";
/*
 * Phase 2 operations: API types, data hooks and the shared plan settings (stock %, crews, basis, city).
 * Every Operations tab reads the same settings, so the supplies, beds and dispatch notices always describe one plan.
 */
import useSWR from "swr";
import { getJson, sendJson } from "./http";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Tier } from "./api";
import { useControls } from "./controls";

export type Resource = "saline" | "kits" | "beds";
export const RESOURCES: Resource[] = ["saline", "kits", "beds"];
export type Status = "ok" | "deficit" | "critical";
export type Basis = "expected" | "upper";

export interface OpsWard {
  ward: string;
  label: string;
  city: string;
  tier: Tier;
  score: number;
  predicted: number;
  lower: number;
  upper: number;
  planning_cases: number;
  density: number;
  density_pct: number;
  priority: number;
  rank: number;
  required: Record<Resource, number>;
  allocated: Record<Resource, number>;
  shortfall: Record<Resource, number>;
  fill: Record<Resource, number>;
  crews_needed: number;
  crews: number;
  beds: {
    capacity: number;
    normal_capacity: number;
    local: number;
    sent: number;
    received: number;
    unplaced: number;
    occupied: number;
    utilization: number;
    net_balance: number;
  };
  transfers_out: { ward: string; label: string; patients: number }[];
  transfers_in: { ward: string; label: string; patients: number }[];
  deficits: Resource[];
  status: Status;
}

export interface Pool {
  city: string;
  wards: number;
  capacity: number;
  demand: number;
  occupied: number;
  headroom: number;
  unplaced: number;
  overflow_wards: number;
  transferred: number;
  utilization_before: number;
  utilization_after: number;
}

export interface Transfer {
  city: string;
  from: string;
  to: string;
  from_label: string;
  to_label: string;
  patients: number;
}

export interface ResourceTotal {
  required: number;
  available: number;
  allocated: number;
  shortfall: number;
  pct: number;
  wards_short: number;
  fill: number;
}

export interface OpsPlan {
  origin: string;
  horizon: number;
  target_date: string;
  city: string | null;
  basis: Basis;
  wards: OpsWard[];
  totals: Record<Resource, ResourceTotal> & {
    crews: { available: number; needed: number; assigned: number; spare: number; wards_needing: number; wards_short: number };
  };
  transfers: Transfer[];
  pools: Pool[];
  alerts: { critical: number; deficit: number };
  rules: Record<Resource, { per_case: number; offset: number }>;
  in_sample: boolean;
}

export interface SimWeek {
  h: number;
  target_date: string;
  baseline: number;
  scenario: number;
  beds_baseline: number;
  beds_scenario: number;
  saline_baseline: number;
  saline_scenario: number;
}

export interface SimWard {
  ward: string;
  label: string;
  city: string;
  tier: Tier;
  priority: number;
  density: number;
  crews: number;
  coverage: number;
  baseline_cases: number;
  scenario_cases: number;
  prevented: number;
  beds_saved: number;
  saline_saved: number;
  roi: number | null;
  next_crew_roi: number | null;
  first_crew_roi: number;
  roi_rank?: number;
  weeks: SimWeek[];
}

export interface Simulation {
  origin: string;
  city: string | null;
  mode: "auto" | "manual";
  crews_available: number;
  crews_used: number;
  max_per_ward: number;
  horizons: number[];
  totals: { baseline: number; scenario: number; prevented: number; beds_saved: number; saline_saved: number; roi: number | null };
  weeks: SimWeek[];
  ranking: SimWard[];
  opportunities: SimWard[];
  wards: SimWard[];
}

export interface Notice {
  ward: string;
  label: string;
  city: string;
  tier: Tier;
  rank: number;
  status: Status;
  sms: string;
  sms_chars: number;
  sms_encoding: "GSM-7" | "UCS-2";
  sms_parts: number;
  whatsapp: string;
}

export interface SelfTest {
  ok: boolean;
  network_blocked: boolean;
  origin: string;
  external_services: string[];
  steps: { step: "forecast" | "allocation" | "routing" | "simulator" | "dispatch"; ok: boolean; ms: number; detail: Record<string, string | number | null> | string }[];
}

// ------------------------------------------------------------------ settings shared by every Operations tab
export interface OpsSettings {
  stock: number; // 30-100 % of need (beds: % of normal capacity)
  split: boolean; // set saline / kits / beds separately
  saline: number;
  kits: number;
  beds: number;
  crews: number;
  basis: Basis;
  city: string | null;
}

const DEFAULTS: OpsSettings = { stock: 70, split: false, saline: 70, kits: 70, beds: 70, crews: 20, basis: "upper", city: null };
const KEY = "dengue-ops-v1";

interface Ctx {
  settings: OpsSettings;
  set: (next: Partial<OpsSettings>) => void;
  reset: () => void;
  query: string | null; // query string for the plan-based endpoints, null until the week is known
}
const OpsCtx = createContext<Ctx | null>(null);

// Settings live outside React so every tab shares them and they survive navigation; saved per browser.
const listeners = new Set<() => void>();
let current: OpsSettings | null = null;

function readSettings(): OpsSettings {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    current = DEFAULTS; // blocked storage: defaults for this visit
  }
  return current!;
}

function writeSettings(next: OpsSettings) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const { origin, horizon } = useControls();
  const settings = useSyncExternalStore(subscribe, readSettings, () => DEFAULTS);
  const set = useCallback((next: Partial<OpsSettings>) => writeSettings({ ...readSettings(), ...next }), []);
  const reset = useCallback(() => writeSettings(DEFAULTS), []);

  const query = useMemo(() => {
    if (!origin) return null;
    const q = new URLSearchParams({ origin, horizon: String(horizon), stock: String(settings.stock), crews: String(settings.crews), basis: settings.basis });
    if (settings.split) {
      q.set("saline_pct", String(settings.saline));
      q.set("kits_pct", String(settings.kits));
      q.set("beds_pct", String(settings.beds));
    }
    if (settings.city) q.set("city", settings.city);
    return q.toString();
  }, [origin, horizon, settings]);

  const value = useMemo(() => ({ settings, set, reset, query }), [settings, set, reset, query]);
  return <OpsCtx.Provider value={value}>{children}</OpsCtx.Provider>;
}

export function useOps() {
  const c = useContext(OpsCtx);
  if (!c) throw new Error("useOps must be used inside OpsProvider");
  return c;
}

// ------------------------------------------------------------------ data
const get = getJson;
const opts = { revalidateOnFocus: false, keepPreviousData: true } as const;

export const useOpsPlan = (query: string | null) => useSWR<OpsPlan>(query ? `/api/ops/plan?${query}` : null, get, opts);

export const useDispatch = (query: string | null, lang: string, everyone: boolean) =>
  useSWR<{ origin: string; target_date: string; notices: Notice[] }>(
    query ? `/api/ops/dispatch?${query}&lang=${lang}${everyone ? "&everyone=true" : ""}` : null,
    get,
    opts,
  );

export interface SimRequest {
  origin: string;
  city: string | null;
  crews: number;
  deployments: Record<string, number> | null;
}

export const useSimulation = (req: SimRequest | null) =>
  useSWR<Simulation>(
    req ? ["simulate", JSON.stringify(req)] : null,
    ([, payload]: [string, string]) => sendJson<Simulation>("/api/ops/simulate", JSON.parse(payload)),
    opts,
  );

export async function runSelfTest(origin: string | null): Promise<SelfTest> {
  return get<SelfTest>(`/api/ops/selftest${origin ? `?origin=${origin}` : ""}`);
}

/** Bed occupancy colour: green below 85%, amber to 100%, red when over capacity. */
export const loadColor = (u: number) => (u > 1 ? "var(--critical)" : u >= 0.85 ? "var(--medium)" : "var(--low)");
export const STATUS_COLOR: Record<Status, string> = { ok: "var(--low)", deficit: "var(--high)", critical: "var(--critical)" };
