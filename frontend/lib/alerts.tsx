"use client";
/*
 * Smart early warning: alert types, data hooks, anonymous acknowledgement and browser push.
 * Every browser gets a random id (kept in localStorage); the server stores alert statuses per id. No login.
 */
import useSWR, { mutate } from "swr";
import { useSyncExternalStore } from "react";
import type { Dict } from "./i18n";
import type { Format } from "./i18n/format";

export type AlertLevel = "Medium" | "High" | "Critical";
export type AlertType = "risk_increase" | "case_surge" | "rainfall" | "upcoming_high";
export type AlertStatus = "new" | "acknowledged" | "resolved";
type Tier = "Low" | AlertLevel;

export interface Alert {
  id: number;
  alert_type: AlertType;
  city: string;
  ward_id: string;
  label: string;
  alert_week: string;
  horizon: number;
  target_week: string;
  expires_week: string;
  prev_tier: Tier | null;
  new_tier: Tier;
  level: AlertLevel;
  predicted_cases: number;
  baseline: number | null;
  change_pct: number | null;
  rain_mm: number | null;
  rain_threshold: number | null;
  message: string;
  created_at: string;
  action: string;
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface AlertCounts {
  total: number;
  new: number;
  by_level: Record<AlertLevel, number>;
  by_type: Record<AlertType, number>;
}

export interface AlertList {
  as_of: string;
  alerts: Alert[];
  counts: AlertCounts;
  scanning: boolean;
}

export const LEVEL_COLOR: Record<AlertLevel, string> = { Medium: "var(--medium)", High: "var(--high)", Critical: "var(--critical)" };

// ------------------------------------------------------------------ anonymous browser id
const KEY = "dengue-client-id";
let clientId: string | null = null;

function readClient(): string {
  if (clientId) return clientId;
  try {
    clientId = localStorage.getItem(KEY);
  } catch {
    /* blocked storage: an id for this visit only */
  }
  if (!clientId) {
    const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    clientId = rnd.replace(/[^A-Za-z0-9-]/g, "");
    try {
      localStorage.setItem(KEY, clientId);
    } catch {
      /* ignore */
    }
  }
  return clientId;
}

/** This browser's anonymous id; null during the server render. */
export const useClientId = () => useSyncExternalStore(() => () => {}, readClient, () => null);

// ------------------------------------------------------------------ data
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `Request failed (${r.status})`);
  return r.json();
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `Request failed (${r.status})`);
  return r.json();
}

const live = { revalidateOnFocus: true, keepPreviousData: true, refreshInterval: 60_000 } as const;

export const useAlertSummary = (client: string | null, asOf: string | null) =>
  useSWR<AlertList & { latest: Alert[] }>(client && asOf ? `/api/alerts/summary?client=${client}&as_of=${asOf}&limit=50` : null, get, live);

export interface AlertQuery {
  scope: "active" | "history";
  city?: string | null;
  ward?: string | null;
  level?: AlertLevel | null;
  from?: string | null;
  to?: string | null;
}

export function alertsUrl(client: string, asOf: string, q: AlertQuery) {
  const p = new URLSearchParams({ client, as_of: asOf, scope: q.scope });
  if (q.city) p.set("city", q.city);
  if (q.ward) p.set("ward", q.ward);
  if (q.level) p.set("level", q.level);
  if (q.from) p.set("date_from", q.from);
  if (q.to) p.set("date_to", q.to);
  return `/api/alerts?${p}`;
}

export const useAlerts = (client: string | null, asOf: string | null, q: AlertQuery) =>
  useSWR<AlertList>(client && asOf ? alertsUrl(client, asOf, q) : null, get, live);

/** Re-fetch every alert list (bell and page) after a status change. */
const refreshAll = () => mutate((key) => typeof key === "string" && key.startsWith("/api/alerts"));

export async function setAlertStatus(client: string, id: number, status: AlertStatus) {
  await post(`/api/alerts/${id}/status`, { client, status });
  await refreshAll();
}

export async function acknowledgeAll(client: string, ids: number[]) {
  if (!ids.length) return;
  await post("/api/alerts/acknowledge", { client, ids });
  await refreshAll();
}

// ------------------------------------------------------------------ text, composed in the reader's language
type Describable = Pick<Alert, "alert_type" | "level" | "prev_tier" | "new_tier" | "horizon" | "predicted_cases" | "baseline" | "change_pct" | "rain_mm" | "rain_threshold">;

export function describe(a: Describable, t: Dict, f: Format): string {
  const d = t.alerts.describe;
  const tier = (x: Tier | null) => (x ? t.common.tier[x] : "?");
  const cases = f.n(Math.round(a.predicted_cases));
  switch (a.alert_type) {
    case "risk_increase":
      return d.risk_increase(tier(a.prev_tier), tier(a.new_tier), a.horizon, cases);
    case "case_surge":
      return (a.baseline ?? 0) < 1
        ? d.case_surge_none(cases, a.horizon)
        : d.case_surge(cases, a.horizon, f.n(Math.round(a.change_pct ?? 0)), f.n(Math.round(a.baseline ?? 0)));
    case "rainfall":
      return d.rainfall(f.n(Math.round(a.rain_mm ?? 0)), f.n(Math.round(a.rain_threshold ?? 0)), tier(a.level));
    default:
      return d.upcoming_high(tier(a.level), a.horizon);
  }
}

// ------------------------------------------------------------------ browser push
export type PushState = "unknown" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const { public_key } = await get<{ public_key: string | null }>("/api/push/key").catch(() => ({ public_key: null }));
  if (!public_key) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(client: string, lang: string): Promise<PushState> {
  if (!supported()) return "unsupported";
  const { public_key } = await get<{ public_key: string | null }>("/api/push/key");
  if (!public_key) return "unconfigured";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) }));
  await post("/api/push/subscribe", { client, lang, subscription: sub.toJSON() });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => null);
    await sub.unsubscribe();
  }
  return "off";
}

export const sendTestPush = (client: string, asOf: string | null) => post<{ delivered: number }>("/api/push/test", { client, as_of: asOf });
