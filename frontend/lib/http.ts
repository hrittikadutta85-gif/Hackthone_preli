/*
 * One way to call the API. Adds the session's CSRF token to state-changing requests, turns error bodies into
 * ApiError (with the backend's error code, so pages can show a translated sentence), and sends the user to the
 * sign-in page when the session has ended.
 *
 * The session itself lives in an HttpOnly cookie that JavaScript cannot read; only the CSRF token is kept here.
 */

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setCsrf = (token: string | null) => {
  csrfToken = token;
};

/** Called by the auth provider so an expired session anywhere sends the user to sign in. */
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  status: number;
  code: string | null;
  data: Record<string, unknown>;
  constructor(status: number, message: string, code: string | null = null, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (UNSAFE.has(method) && csrfToken) headers.set("x-csrf-token", csrfToken);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const r = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  if (r.status === 401 && !url.startsWith("/api/auth/")) onUnauthorized?.();
  return r;
}

export async function toError(r: Response): Promise<ApiError> {
  const body = await r.json().catch(() => null);
  const d = body?.detail;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const { code, message, ...rest } = d as { code?: string; message?: string };
    return new ApiError(r.status, message ?? `Request failed (${r.status})`, code ?? null, rest);
  }
  if (Array.isArray(d)) return new ApiError(r.status, d.map((x: { msg?: string }) => x.msg).join("; "), "validation");
  return new ApiError(r.status, typeof d === "string" ? d : `Request failed (${r.status})`);
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await apiFetch(url);
  if (!r.ok) throw await toError(r);
  return r.json();
}

export async function sendJson<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const r = await apiFetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw await toError(r);
  return r.status === 204 ? (undefined as T) : r.json();
}
