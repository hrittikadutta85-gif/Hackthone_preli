"use client";
/*
 * Who is signed in, and what their role allows. The server decides both (GET /api/auth/me); this context only
 * mirrors them so pages can hide what a role cannot open. Every API route checks permissions again on the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { ApiError, apiFetch, sendJson, setCsrf, setUnauthorizedHandler, toError } from "./http";

export const ROLES = ["admin", "officer", "analyst", "field", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const SELF_SERVICE_ROLES: Role[] = ["officer", "analyst", "field", "viewer"];

export type Permission =
  | "dashboard.view"
  | "ward.view"
  | "plan.view"
  | "forecast.whatif"
  | "model.view"
  | "predict.use"
  | "ops.view"
  | "ops.dispatch"
  | "ops.selftest"
  | "alerts.view"
  | "alerts.manage"
  | "alerts.admin"
  | "users.manage"
  | "security.view"
  | "hospitals.manage";

export interface User {
  id: number;
  email: string | null;
  username: string | null;
  full_name: string;
  phone: string | null;
  organization: string;
  designation: string;
  role: Role;
  requested_role: Role | null;
  status: "pending" | "active" | "deactivated";
  email_verified: boolean;
  phone_verified: boolean;
  otp_login: boolean;
  assigned_wards: string[];
  lang: "en" | "bn";
  created_at: string;
  last_login_at: string | null;
  locked: boolean;
  permissions: Permission[];
  home: string;
}

export interface Me {
  user: User;
  csrf: string;
  session: { id: number; expires_at: string; absolute_expires_at: string; remember: boolean };
}

export interface AuthConfig {
  public_registration: boolean;
  allow_otp_login: boolean;
  channels: { sms: boolean; whatsapp: boolean; email: boolean };
  password_min_length: number;
  otp_expiry_seconds: number;
  otp_resend_seconds: number;
  self_service_roles: Role[];
  require_email_verification: boolean;
}

/** Pages anyone can open. Everything else needs a session. Keep in sync with proxy.ts. */
export const PUBLIC_ROUTES = ["/login", "/register", "/verify", "/forgot-password", "/reset-password", "/invite"];
export const isPublicRoute = (path: string) => PUBLIC_ROUTES.some((p) => path === p || path.startsWith(`${p}/`));
/** Pages anyone can open, shown inside the dashboard for signed-in users. Keep in sync with proxy.ts. */
export const OPEN_ROUTES = ["/area-intelligence"];
export const isOpenRoute = (path: string) => OPEN_ROUTES.some((p) => path === p || path.startsWith(`${p}/`));

/** The permission each page needs; the longest matching prefix wins. Pages not listed only need a session. */
const ROUTE_PERMS: [string, Permission][] = [
  ["/", "dashboard.view"],
  ["/map", "dashboard.view"],
  ["/how-it-works", "dashboard.view"],
  ["/plan", "plan.view"],
  ["/ward", "ward.view"],
  ["/predict", "predict.use"],
  ["/accuracy", "model.view"],
  ["/ops", "ops.view"],
  ["/ops/dispatch", "ops.dispatch"],
  ["/ops/offline", "ops.selftest"],
  ["/alerts", "alerts.view"],
  ["/admin/users", "users.manage"],
  ["/admin/security", "security.view"],
  ["/admin/hospitals", "hospitals.manage"],
];

export function permissionFor(path: string): Permission | null {
  if (path.startsWith("/account")) return null;
  let best: [string, Permission] | null = null;
  for (const r of ROUTE_PERMS) {
    const hit = r[0] === "/" ? path === "/" : path === r[0] || path.startsWith(`${r[0]}/`);
    if (hit && (!best || r[0].length > best[0].length)) best = r;
  }
  return best ? best[1] : path.startsWith("/admin") ? "users.manage" : null;
}

/** Only same-site paths that are not sign-in pages are accepted as a place to return to after login. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || isPublicRoute(next.split("?")[0])) return null;
  return next;
}

async function loadMe(url: string): Promise<Me | null> {
  const r = await apiFetch(url);
  if (r.status === 401) return null;
  if (!r.ok) throw await toError(r);
  return r.json();
}

interface AuthCtx {
  me: Me | null | undefined; // undefined while loading
  user: User | null;
  loading: boolean;
  can: (p: Permission) => boolean;
  refresh: () => Promise<unknown>;
  signedIn: (r: { user: User; csrf: string; home: string }, next?: string | null) => void;
  logout: (opts?: { everywhere?: boolean }) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const FLOW_KEYS = ["dw-verify-email", "dw-reset", "dw-login-challenge"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const isPublic = isPublicRoute(path);
  const { data, error, isLoading, mutate } = useSWR<Me | null>("/api/auth/me", loadMe, {
    revalidateOnFocus: true,
    focusThrottleInterval: 30_000,
    refreshInterval: isPublic ? 0 : 120_000, // notices an expired or revoked session within two minutes
    shouldRetryOnError: false,
  });

  useEffect(() => setCsrf(data?.csrf ?? null), [data]);

  // Any API call that comes back 401 means the session ended: go to sign-in and come back here afterwards.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (isPublicRoute(window.location.pathname) || isOpenRoute(window.location.pathname)) return;
      mutate(null, { revalidate: false });
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?expired=1&next=${next}`);
    });
    return () => setUnauthorizedHandler(null);
  }, [router, mutate]);

  // A page restored from the back/forward cache after logout must check the session again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) mutate();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [mutate]);

  const signedIn = useCallback<AuthCtx["signedIn"]>(
    (r, next) => {
      setCsrf(r.csrf);
      mutate({ user: r.user, csrf: r.csrf, session: { id: 0, expires_at: "", absolute_expires_at: "", remember: false } }, { revalidate: true });
      try {
        FLOW_KEYS.forEach((k) => sessionStorage.removeItem(k));
      } catch {
        /* storage blocked */
      }
      const target = safeNext(next);
      const allowed = target && (() => {
        const perm = permissionFor(target.split("?")[0]);
        return !perm || r.user.permissions.includes(perm);
      })();
      router.replace(allowed ? target! : r.user.home);
    },
    [mutate, router],
  );

  const logout = useCallback<AuthCtx["logout"]>(
    async (opts) => {
      try {
        if (opts?.everywhere) await sendJson("/api/account/sessions/revoke-all", { include_current: true });
        else await sendJson("/api/auth/logout");
      } catch {
        /* the cookie is cleared by the server; if the call failed, the session expires on its own */
      }
      setCsrf(null);
      // forget every cached response so nothing from this account is shown to the next person
      await globalMutate(() => true, undefined, { revalidate: false });
      await mutate(null, { revalidate: false });
      try {
        FLOW_KEYS.forEach((k) => sessionStorage.removeItem(k));
      } catch {
        /* storage blocked */
      }
      router.replace("/login?signedout=1");
    },
    [mutate, router],
  );

  const value = useMemo<AuthCtx>(() => {
    const user = data?.user ?? null;
    return {
      me: error ? null : data,
      user,
      loading: isLoading && data === undefined,
      can: (p) => !!user && user.permissions.includes(p),
      refresh: () => mutate(),
      signedIn,
      logout,
    };
  }, [data, error, isLoading, mutate, signedIn, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

export const useAuthConfig = () =>
  useSWR<AuthConfig>("/api/auth/config", async (u: string) => {
    const r = await apiFetch(u);
    if (!r.ok) throw await toError(r);
    return r.json();
  }, { revalidateOnFocus: false });

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
