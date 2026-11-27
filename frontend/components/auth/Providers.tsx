"use client";
/* App-wide helpers for account screens: toast messages and the "confirm it's you" password check. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Lock, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ApiError, sendJson } from "@/lib/http";
import { Button, Notice, PasswordField, useErrorText } from "./ui";

/* ------------------------------------------------------------------ toasts */
type Toast = { id: number; tone: "success" | "error"; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = ++seq.current;
    setToasts((ts) => [...ts.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[3000] flex flex-col items-center gap-2 sm:right-5 sm:left-auto sm:items-end">
        {toasts.map((x) => (
          <div key={x.id} role={x.tone === "error" ? "alert" : "status"} className="auth-glass rise pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 text-sm">
            {x.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical-ink" aria-hidden />}
            <span className="min-w-0 flex-1">{x.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((ts) => ts.filter((y) => y.id !== x.id))} className="-m-1 grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ re-authentication */
type Guard = <T>(action: () => Promise<T>) => Promise<T>;
const ReauthCtx = createContext<Guard>((a) => a());

/** Wrap a sensitive action: if the server answers "reauth_required", ask for the password once and try again. */
export const useReauth = () => useContext(ReauthCtx);

export function ReauthProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPassword("");
        setError(null);
        dialog.current?.showModal();
      }),
    [],
  );

  const guard = useCallback<Guard>(
    async (action) => {
      try {
        return await action();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "reauth_required") throw e;
        if (!(await ask())) throw e;
        return action();
      }
    },
    [ask],
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    dialog.current?.close();
  };

  return (
    <ReauthCtx.Provider value={guard}>
      {children}
      <dialog ref={dialog} aria-labelledby="reauth-title" onCancel={() => finish(false)} className="auth-glass m-auto w-[min(26rem,calc(100vw-2rem))] p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <form
          className="space-y-4 p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await sendJson("/api/auth/reauth", { password });
              finish(true);
            } catch (err) {
              setError(errText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <h2 id="reauth-title" className="font-display text-xl font-semibold">
              {t.auth.reauth.title}
            </h2>
          </div>
          <p className="text-sm text-muted">{t.auth.reauth.text}</p>
          <PasswordField label={t.auth.common.password} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="plain" onClick={() => finish(false)}>
              {t.auth.common.cancel}
            </Button>
            <Button type="submit" busy={busy} disabled={!password}>
              {t.auth.reauth.submit}
            </Button>
          </div>
        </form>
      </dialog>
    </ReauthCtx.Provider>
  );
}
