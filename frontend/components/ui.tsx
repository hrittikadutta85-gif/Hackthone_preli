"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TIER_COLOR, type Tier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function TierPill({ tier, className = "" }: { tier: Tier; className?: string }) {
  const { t } = useI18n();
  const c = TIER_COLOR[tier];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${className}`}
      style={{
        color: `color-mix(in srgb, ${c} 55%, var(--ink))`,
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 55%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} aria-hidden />
      {t.common.tier[tier]}
    </span>
  );
}

/** Border and glow for the selected card in a set of risk cards. */
export const tierGlow = (tier: Tier, on: boolean) =>
  on ? { borderColor: TIER_COLOR[tier], boxShadow: `0 0 0 1px ${TIER_COLOR[tier]}, 0 0 34px -10px ${TIER_COLOR[tier]}` } : undefined;

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel panel-edge min-w-0 p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
}

export function ErrorNote({ error }: { error: Error }) {
  const { t, bError } = useI18n();
  return (
    <div role="alert" className="rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm break-words">
      <p className="font-semibold text-critical-ink">{t.errors.title}</p>
      <p className="mt-1 text-muted">
        {bError(error.message)}
        {/fetch|network|failed \(5/i.test(error.message) && (
          <>
            {" "}
            {t.errors.serviceHint(<code className="rounded bg-line px-1 break-all">uvicorn backend.main:app --port 8000</code>)}
          </>
        )}
      </p>
    </div>
  );
}

/** Counts smoothly to its target so changes in a forecast are noticed rather than missed. */
export function AnimatedNumber({ value, digits = 0 }: { value: number; digits?: number }) {
  const { f } = useI18n();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / 450, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{f.n(shown, digits)}</>;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-full border border-line bg-[rgb(5_11_20/0.6)] p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 cursor-pointer rounded-full px-3.5 py-1 text-sm font-medium whitespace-nowrap transition-all duration-300 max-md:px-2 ${
            o.value === value
              ? "bg-accent text-on-accent shadow-[0_0_18px_-4px_rgb(45_212_191/0.85)]"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A panel that folds away on phones and tablets, and is always open on wide screens. */
export function Collapsible({ title, action, defaultOpen = false, children }: { title: string; action?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel panel-edge p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display min-w-0 flex-1 text-xl font-semibold">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-left lg:hidden">
            {title}
            <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-accent transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <span className="max-lg:hidden">{title}</span>
        </h2>
        {action}
      </div>
      <div className={open ? "" : "max-lg:hidden"}>{children}</div>
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** True while the media query matches. False during the server render. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setMatches(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return matches;
}
