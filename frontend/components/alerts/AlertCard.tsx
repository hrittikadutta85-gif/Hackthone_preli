"use client";
import Link from "next/link";
import { useState } from "react";
import { describe, LEVEL_COLOR, setAlertStatus, type Alert, type AlertStatus } from "@/lib/alerts";
import { useI18n } from "@/lib/i18n";
import { Icon } from "@/components/icons";

export function LevelPill({ level }: { level: Alert["level"] }) {
  const { t } = useI18n();
  const c = LEVEL_COLOR[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
      style={{ color: `color-mix(in srgb, ${c} 60%, var(--ink))`, borderColor: `color-mix(in srgb, ${c} 55%, transparent)`, background: `color-mix(in srgb, ${c} 15%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} aria-hidden />
      {t.alerts.level[level]}
    </span>
  );
}

function StatusChip({ status }: { status: AlertStatus }) {
  const { t } = useI18n();
  const tone = status === "new" ? "bg-accent text-on-accent" : status === "acknowledged" ? "border border-accent/40 text-accent" : "border border-line text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>{t.alerts.status[status]}</span>;
}

/** One alert: what, where, when, how bad, what to do, and its status for this browser. */
export function AlertCard({ a, client, compact = false, highlight = false }: { a: Alert; client: string; compact?: boolean; highlight?: boolean }) {
  const { t, f, b, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const c = LEVEL_COLOR[a.level];
  const set = async (s: AlertStatus) => {
    setBusy(true);
    try {
      await setAlertStatus(client, a.id, s);
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <article
      className={`relative min-w-0 rounded-xl border p-3 transition ${a.status === "new" ? "bg-raise" : "bg-transparent opacity-85"} ${highlight ? "ring-2 ring-accent" : ""}`}
      style={{ borderColor: `color-mix(in srgb, ${c} 40%, var(--line))`, borderLeft: `3px solid ${c}` }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LevelPill level={a.level} />
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{t.alerts.type[a.alert_type]}</span>
        <span className="ml-auto">
          <StatusChip status={a.status} />
        </span>
      </div>
      <Link href={`/ward/${a.ward_id}`} className="mt-1.5 block font-semibold hover:text-accent">
        {b(a.label)}
      </Link>
      <p className="mt-0.5 text-sm text-ink/85">{describe(a, t, f)}</p>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted">
        <dd>{t.alerts.raised(f.date(a.alert_week, true))}</dd>
        <dd>{t.alerts.expected(f.date(a.target_week, true))}</dd>
        {!compact && <dd>{t.alerts.predicted(t.common.tier[a.new_tier])}</dd>}
      </dl>
      {!compact && (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <Icon name="shield" className="mt-0.5 h-4 w-4 text-accent" />
          <span>
            <span className="text-muted">{t.alerts.action}: </span>
            {b(a.action)}
          </span>
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {a.status === "new" && (
          <button disabled={busy} onClick={() => set("acknowledged")} className="btn px-3 py-1 text-xs" aria-label={t.alerts.ackLabel(b(a.label))}>
            <Icon name="check" className="h-3.5 w-3.5" /> {t.alerts.acknowledge}
          </button>
        )}
        {a.status !== "resolved" && !compact && (
          <button disabled={busy} onClick={() => set("resolved")} className="btn px-3 py-1 text-xs text-muted">
            {t.alerts.resolve}
          </button>
        )}
        {a.status !== "new" && !compact && (
          <button disabled={busy} onClick={() => set("new")} className="btn px-3 py-1 text-xs text-muted">
            {t.alerts.reopen}
          </button>
        )}
        {!compact && a.resolved_at && <span className="text-[11px] text-muted">{t.alerts.resolvedAt(when(a.resolved_at))}</span>}
        {!compact && !a.resolved_at && a.acknowledged_at && <span className="text-[11px] text-muted">{t.alerts.ackedAt(when(a.acknowledged_at))}</span>}
      </div>
    </article>
  );
}
