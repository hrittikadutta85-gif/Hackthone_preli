"use client";
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { useAdminDeliveries, useAdminLogins, useAdminSessions, useAudit, useProviders, when } from "@/lib/account";
import { ChannelIcon, DeliveryBadge, Empty, LoginTable, PageHead, Tabs } from "@/components/auth/parts";
import { useToast } from "@/components/auth/Providers";
import { Button, Notice, useErrorText } from "@/components/auth/ui";
import { Skeleton } from "@/components/ui";

type Tab = "logins" | "sessions" | "deliveries" | "audit" | "providers";

function Logins() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "failed" | "suspicious">("all");
  const q = filter === "failed" ? "?outcome=failed" : filter === "suspicious" ? "?suspicious=true" : "";
  const { data } = useAdminLogins(q);
  return (
    <>
      <div role="group" aria-label={t.auth.history.title} className="mb-4 flex flex-wrap gap-2">
        {(["all", "failed", "suspicious"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className="btn">
            {t.auth.history.filters[k]}
          </button>
        ))}
      </div>
      {data ? <LoginTable rows={data.logins} showUser /> : <Skeleton className="h-72" />}
    </>
  );
}

function AllSessions() {
  const { t, lang, f } = useI18n();
  const { data, mutate } = useAdminSessions();
  const toast = useToast();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-60" />;
  if (!data.sessions.length) return <Empty>{t.auth.sessions.empty}</Empty>;
  return (
    <>
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="kicker border-b border-line">
            <tr>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.user}</th>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.device}</th>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.ip}</th>
              <th className="px-4 py-3 font-medium">{t.auth.sessions.started}</th>
              <th className="px-4 py-3 font-medium">{t.auth.sessions.lastActive}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3">
                  {s.full_name}
                  <span className="block text-xs text-muted">{s.email}</span>
                </td>
                <td className="px-4 py-3">{s.device}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.ip ? f.digits(s.ip) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{when(s.created_at, lang)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{when(s.last_seen_at, lang)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    variant="plain"
                    onClick={async () => {
                      setError(null);
                      try {
                        await sendJson(`/api/admin/sessions/${s.id}`, undefined, "DELETE");
                        await mutate();
                        toast(t.auth.admin.users.done);
                      } catch (err) {
                        setError(errText(err));
                      }
                    }}
                  >
                    {t.auth.admin.security.endSession}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Deliveries() {
  const { t, lang } = useI18n();
  const { data } = useAdminDeliveries();
  const s = t.auth.admin.security;
  if (!data) return <Skeleton className="h-60" />;
  if (!data.deliveries.length) return <Empty>{t.auth.prefs.deliveriesEmpty}</Empty>;
  return (
    <>
      <p className="mb-3 text-xs text-muted">{t.auth.prefs.legend}</p>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="kicker border-b border-line">
            <tr>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.when}</th>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.user}</th>
              <th className="px-4 py-3 font-medium">{s.event}</th>
              <th className="px-4 py-3 font-medium">{s.channel}</th>
              <th className="px-4 py-3 font-medium">{s.to}</th>
              <th className="px-4 py-3 font-medium">{t.auth.history.cols.status}</th>
            </tr>
          </thead>
          <tbody>
            {data.deliveries.map((d) => (
              <tr key={d.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 whitespace-nowrap">{when(d.created_at, lang)}</td>
                <td className="px-4 py-3">{d.user ?? "—"}</td>
                <td className="px-4 py-3">{t.auth.delivery.events[d.event] ?? d.event}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <ChannelIcon channel={d.channel} />
                    {t.auth.channels[d.channel as "sms"] ?? d.channel}
                    {d.provider && <span className="text-xs text-muted">({d.provider})</span>}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{d.target || "—"}</td>
                <td className="px-4 py-3">
                  <DeliveryBadge status={d.status} detail={d.detail} />
                  {d.detail && !t.auth.delivery.reason[d.detail] && <span className="mt-0.5 block text-xs text-muted">{d.detail}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AuditLog() {
  const { t, lang } = useI18n();
  const { data } = useAudit();
  const s = t.auth.admin.security;
  if (!data) return <Skeleton className="h-60" />;
  if (!data.events.length) return <Empty>{t.auth.history.empty}</Empty>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="kicker border-b border-line">
          <tr>
            <th className="px-4 py-3 font-medium">{t.auth.history.cols.when}</th>
            <th className="px-4 py-3 font-medium">{s.action}</th>
            <th className="px-4 py-3 font-medium">{s.actor}</th>
            <th className="px-4 py-3 font-medium">{s.target}</th>
            <th className="px-4 py-3 font-medium">{t.auth.history.cols.ip}</th>
            <th className="px-4 py-3 font-medium">{s.detail}</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={e.id} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-3 whitespace-nowrap">{when(e.at, lang)}</td>
              <td className="px-4 py-3 font-medium">{t.auth.audit[e.action] ?? e.action}</td>
              <td className="px-4 py-3">{e.actor_name ?? "—"}</td>
              <td className="px-4 py-3">{e.target_name ?? "—"}</td>
              <td className="px-4 py-3 font-mono text-xs">{e.ip ?? "—"}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted">
                {Object.entries(e.detail)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                  .join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Providers() {
  const { t } = useI18n();
  const { data } = useProviders();
  const s = t.auth.admin.security;
  if (!data) return <Skeleton className="h-60" />;
  const ok = (v: boolean, text: string) => (
    <span className={`inline-flex items-center gap-1.5 text-sm ${v ? "text-accent" : "text-muted"}`}>
      {v ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
      {text}
    </span>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="panel panel-edge p-5">
        <h2 className="kicker">{s.provider}</h2>
        <ul className="mt-3 space-y-3">
          {(["sms", "whatsapp", "email"] as const).map((c) => (
            <li key={c} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-medium">
                <ChannelIcon channel={c} className="h-4 w-4 text-muted" />
                {t.auth.channels[c]}
              </span>
              {ok(data.providers[c].available, data.providers[c].available ? `${s.configured} · ${data.providers[c].provider}` : s.notConfigured)}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted">{s.howTo}</p>
      </section>
      <section className="panel panel-edge space-y-4 p-5">
        <div>
          <h2 className="kicker">{s.callbacks}</h2>
          <p className="mt-1 text-sm">{data.status_callbacks ? s.callbacksOn : s.callbacksOff}</p>
        </div>
        <div>
          <h2 className="kicker">{s.registration}</h2>
          <p className="mt-1">{ok(data.public_registration, data.public_registration ? t.auth.common.yes : t.auth.common.no)}</p>
        </div>
        <div>
          <h2 className="kicker">{s.essential}</h2>
          <p className="mt-1 text-sm">{data.essential_events.map((e) => t.auth.delivery.events[e] ?? e).join(", ") || s.none}</p>
        </div>
        <div>
          <h2 className="kicker">{s.requireOtp}</h2>
          <p className="mt-1 text-sm">{data.require_otp_roles.map((r) => t.auth.roles[r as "admin"] ?? r).join(", ") || s.none}</p>
        </div>
      </section>
    </div>
  );
}

export default function SecurityLog() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("logins");
  const s = t.auth.admin.security;
  return (
    <div className="rise">
      <PageHead title={s.title} subtitle={s.subtitle} />
      <Tabs items={[{ href: "/admin/users", label: t.auth.menu.users }, { href: "/admin/security", label: t.auth.menu.security }, { href: "/admin/hospitals", label: t.area.admin.title }]} />
      <div role="tablist" aria-label={s.title} className="mb-5 flex gap-1 overflow-x-auto rounded-full border border-line bg-raise p-1 [scrollbar-width:none]">
        {(Object.keys(s.tabs) as Tab[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 shrink-0 cursor-pointer rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors ${tab === k ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}>
            {s.tabs[k]}
          </button>
        ))}
      </div>
      {tab === "logins" && <Logins />}
      {tab === "sessions" && <AllSessions />}
      {tab === "deliveries" && <Deliveries />}
      {tab === "audit" && <AuditLog />}
      {tab === "providers" && <Providers />}
    </div>
  );
}
