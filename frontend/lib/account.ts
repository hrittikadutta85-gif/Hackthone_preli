"use client";
/* Data for the account and administration pages. Every call is checked again by the API. */
import useSWR from "swr";
import { getJson } from "./http";
import type { Role, User } from "./auth";

export type DeliveryStatus = "pending" | "sent" | "delivered" | "failed" | "skipped";

export interface LoginRow {
  id: number;
  user_id: number | null;
  user: string | null;
  email: string | null;
  identifier: string | null;
  at: string;
  ip: string | null;
  device: string;
  location: string | null;
  success: boolean;
  reason: string;
  method: string;
  new_device: boolean;
  suspicious: boolean;
  notifications: { event: string; channel: string; status: DeliveryStatus; detail: string | null }[];
}

export interface SessionRow {
  id: number;
  user_id?: number;
  full_name?: string;
  email?: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  remember: boolean;
  ip: string | null;
  device: string;
  current?: boolean;
}

export interface Delivery {
  id: number;
  user_id: number | null;
  user: string | null;
  event: string;
  channel: string;
  provider: string | null;
  target: string;
  status: DeliveryStatus;
  detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface Prefs {
  sms_login: boolean;
  whatsapp_login: boolean;
  new_device: boolean;
  password_change: boolean;
  security: boolean;
  channel: "sms" | "whatsapp";
  whatsapp_consent: boolean;
  whatsapp_consent_at: string | null;
  essential: string[];
  providers: { sms: boolean; whatsapp: boolean; email: boolean };
}

export interface AuditEvent {
  id: number;
  at: string;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  target_user_id: number | null;
  target_name: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
}

export type AdminUser = Omit<User, "permissions" | "home"> & { role: Role };

const opts = { revalidateOnFocus: true, keepPreviousData: true } as const;

export const useMyLogins = () => useSWR<{ logins: LoginRow[] }>("/api/account/logins?limit=200", getJson, opts);
export const useMySessions = () => useSWR<{ sessions: SessionRow[] }>("/api/account/sessions", getJson, opts);
export const useMyDeliveries = () => useSWR<{ deliveries: Delivery[] }>("/api/account/deliveries?limit=50", getJson, opts);
export const usePrefs = () => useSWR<Prefs>("/api/account/notifications", getJson, opts);

export const useAdminUsers = (query: string) => useSWR<{ users: AdminUser[] }>(`/api/admin/users${query}`, getJson, opts);
export const useAdminLogins = (query: string) => useSWR<{ logins: LoginRow[] }>(`/api/admin/logins${query}`, getJson, opts);
export const useAdminSessions = () => useSWR<{ sessions: SessionRow[] }>("/api/admin/sessions", getJson, opts);
export const useAdminDeliveries = () => useSWR<{ deliveries: Delivery[] }>("/api/admin/deliveries", getJson, opts);
export const useAudit = () => useSWR<{ events: AuditEvent[] }>("/api/admin/audit", getJson, opts);
export const useProviders = () =>
  useSWR<{
    providers: Record<"sms" | "whatsapp" | "email", { available: boolean; provider: string | null }>;
    status_callbacks: boolean;
    essential_events: string[];
    require_otp_roles: string[];
    public_registration: boolean;
  }>("/api/admin/providers", getJson, opts);

/** "2026-11-27T04:30:00Z" in the reader's local time, in the current language. */
export function when(iso: string | null | undefined, lang: "en" | "bn") {
  if (!iso) return null;
  return new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
