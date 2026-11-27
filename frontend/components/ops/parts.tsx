"use client";
import type { ReactNode } from "react";
import { STATUS_COLOR, type Status } from "@/lib/ops";
import { useI18n } from "@/lib/i18n";

/** A labelled range slider with its value shown large. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  note?: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-display text-2xl font-semibold text-accent tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" aria-label={label} />
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </label>
  );
}

/** Horizontal bar: how much of a need is met. Turns amber below 100% and red below 50%. */
export function Meter({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(value, 1));
  const color = value >= 1 ? "var(--low)" : value >= 0.5 ? "var(--high)" : "var(--critical)";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`} aria-hidden>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useI18n();
  const c = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: `color-mix(in srgb, ${c} 60%, var(--ink))`, borderColor: `color-mix(in srgb, ${c} 55%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} aria-hidden />
      {t.ops.status[status]}
    </span>
  );
}

/** Big number tile used across the operations pages. */
export function Kpi({ big, title, note, tone = "accent", children }: { big: ReactNode; title: string; note?: ReactNode; tone?: "accent" | "warn" | "bad"; children?: ReactNode }) {
  const color = tone === "bad" ? "text-critical-ink" : tone === "warn" ? "text-high" : "text-accent";
  return (
    <section className="panel panel-edge rise min-w-0 p-4 sm:p-5">
      <div className={`font-display text-2xl font-semibold tabular-nums sm:text-3xl ${color}`}>{big}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
      {children}
    </section>
  );
}

/** "allocated / required" with the shortfall in red. */
export function Ratio({ got, need }: { got: number; need: number }) {
  const { f } = useI18n();
  const short = got < need;
  return (
    <span className={`tabular-nums whitespace-nowrap ${short ? "font-semibold text-critical-ink" : ""}`}>
      {f.n(got)}
      <span className="text-muted">/{f.n(need)}</span>
    </span>
  );
}

export function MethodNote({ title, items }: { title: string; items: string[] }) {
  return (
    <details className="panel p-4 text-sm sm:p-5">
      <summary className="cursor-pointer font-display text-lg font-semibold">{title}</summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-ink/80">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </details>
  );
}
