"use client";
/* Small display pieces shared by the account and administration pages. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock, MessageCircle, MessageSquareText, Mail, MonitorSmartphone, XCircle } from "lucide-react";
import { useI18n, useTitle } from "@/lib/i18n";
import type { DeliveryStatus, LoginRow } from "@/lib/account";
import { when } from "@/lib/account";

export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  useTitle(title);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]" aria-label="Sections">
      {items.map((i) => {
        const active = path === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors ${active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

const STATUS_STYLE: Record<DeliveryStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
  delivered: { cls: "border-low/50 bg-low/10 text-low", Icon: CheckCircle2 },
  sent: { cls: "border-accent/45 bg-accent-soft text-accent", Icon: CheckCircle2 },
  pending: { cls: "border-line bg-raise text-muted", Icon: Clock },
  failed: { cls: "border-critical/50 bg-critical/10 text-critical-ink", Icon: XCircle },
  skipped: { cls: "border-line bg-raise text-muted", Icon: AlertTriangle },
};

export function DeliveryBadge({ status, detail }: { status: DeliveryStatus; detail?: string | null }) {
  const { t } = useI18n();
  const s = STATUS_STYLE[status];
  const reason = detail ? t.auth.delivery.reason[detail] : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`} title={detail ?? undefined}>
      <s.Icon className="h-3 w-3" aria-hidden />
      {t.auth.delivery.status[status]}
      {reason && <span className="font-normal opacity-80">· {reason}</span>}
    </span>
  );
}

export const ChannelIcon = ({ channel, className = "h-3.5 w-3.5" }: { channel: string; className?: string }) =>
  channel === "whatsapp" ? <MessageCircle className={className} aria-hidden /> : channel === "email" ? <Mail className={className} aria-hidden /> : <MessageSquareText className={className} aria-hidden />;

export function VerifiedBadge({ ok }: { ok: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${ok ? "border-accent/45 bg-accent-soft text-accent" : "border-medium/45 bg-medium/10 text-medium"}`}>
      {ok ? <BadgeCheck className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
      {ok ? t.auth.common.verified : t.auth.common.unverified}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/** Login history as cards on phones and a table on wide screens. */
export function LoginTable({ rows, showUser = false }: { rows: LoginRow[]; showUser?: boolean }) {
  const { t, lang, f } = useI18n();
  const h = t.auth.history;
  const status = (r: LoginRow) => (
    <span className="flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${r.success ? "border-low/50 bg-low/10 text-low" : "border-critical/50 bg-critical/10 text-critical-ink"}`}>
        {r.success ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
        {r.success ? h.success : `${h.failed} · ${t.auth.loginReason[r.reason] ?? r.reason}`}
      </span>
      {r.new_device && <span className="rounded-full border border-[rgb(63_127_192/0.45)] px-2 py-0.5 text-xs text-[var(--forecast)]">{h.newDevice}</span>}
      {r.suspicious && <span className="rounded-full border border-high/60 bg-high/10 px-2 py-0.5 text-xs font-medium text-high">{h.suspicious}</span>}
    </span>
  );
  const notes = (r: LoginRow) =>
    r.notifications.length ? (
      <span className="flex flex-wrap gap-1">
        {r.notifications.map((n, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <ChannelIcon channel={n.channel} />
            <DeliveryBadge status={n.status} detail={n.detail} />
          </span>
        ))}
      </span>
    ) : (
      <span className="text-xs text-muted">{h.noNotification}</span>
    );
  const who = (r: LoginRow) => r.user ?? r.identifier ?? "—";
  if (!rows.length) return <Empty>{h.empty}</Empty>;
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="panel space-y-2 p-3.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{when(r.at, lang)}</span>
              {status(r)}
            </div>
            {showUser && <p className="text-muted">{who(r)}</p>}
            <p className="flex items-center gap-1.5 text-muted">
              <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden />
              {r.device} · <span className="font-mono text-xs">{r.ip ?? "—"}</span>
            </p>
            <p className="text-xs text-muted">
              {t.auth.methods[r.method] ?? r.method} · {r.location ?? t.auth.common.notAvailable}
            </p>
            {notes(r)}
          </li>
        ))}
      </ul>
      <div className="panel hidden overflow-x-auto md:block">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="kicker border-b border-line">
            <tr>
              <th className="px-4 py-3 font-medium">{h.cols.when}</th>
              {showUser && <th className="px-4 py-3 font-medium">{h.cols.user}</th>}
              <th className="px-4 py-3 font-medium">{h.cols.device}</th>
              <th className="px-4 py-3 font-medium">{h.cols.ip}</th>
              <th className="px-4 py-3 font-medium">{h.cols.location}</th>
              <th className="px-4 py-3 font-medium">{h.cols.status}</th>
              <th className="px-4 py-3 font-medium">{h.cols.notification}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-line/60 last:border-0 ${r.suspicious ? "bg-high/[0.05]" : ""}`}>
                <td className="px-4 py-3 whitespace-nowrap">
                  {when(r.at, lang)}
                  <span className="block text-xs text-muted">{t.auth.methods[r.method] ?? r.method}</span>
                </td>
                {showUser && <td className="px-4 py-3">{who(r)}</td>}
                <td className="px-4 py-3">{r.device}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.ip ? f.digits(r.ip) : "—"}</td>
                <td className="px-4 py-3 text-muted">{r.location ?? t.auth.common.notAvailable}</td>
                <td className="px-4 py-3">{status(r)}</td>
                <td className="px-4 py-3">{notes(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
