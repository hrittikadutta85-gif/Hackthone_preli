"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TIER_COLOR, type Tier } from "@/lib/api";

export function TierPill({ tier, className = "" }: { tier: Tier; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${className}`}
      style={{ background: TIER_COLOR[tier] }}
    >
      {tier}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-line/70 ${className}`} />;
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <div role="alert" className="rounded-xl border border-critical/30 bg-critical/5 p-4 text-sm">
      <p className="font-semibold text-critical">Something went wrong.</p>
      <p className="mt-1 text-muted">
        {error.message}
        {/fetch|network|failed \(5/i.test(error.message) && (
          <>
            {" "}
            The forecasting service may not be running. Start it with{" "}
            <code className="rounded bg-line px-1">uvicorn backend.main:app --port 8000</code>.
          </>
        )}
      </p>
    </div>
  );
}

/** Counts smoothly to its target so changes in a forecast are noticed rather than missed. */
export function AnimatedNumber({ value, digits = 0 }: { value: number; digits?: number }) {
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
  return <>{shown.toFixed(digits)}</>;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-card p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
            o.value === value ? "bg-accent text-white shadow" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
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

/** Sets the browser tab title for client-rendered pages. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · Dengue Watch`;
  }, [title]);
}
