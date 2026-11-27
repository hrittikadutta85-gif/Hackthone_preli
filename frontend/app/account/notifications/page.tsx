"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { useMyDeliveries, usePrefs, when, type Prefs } from "@/lib/account";
import { ChannelIcon, DeliveryBadge, Empty, PageHead } from "@/components/auth/parts";
import { useToast } from "@/components/auth/Providers";
import { Checkbox, ChannelPicker, Notice, Switch, useErrorText, type Channel } from "@/components/auth/ui";
import { Skeleton } from "@/components/ui";

export default function NotificationSettings() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { data: prefs, mutate } = usePrefs();
  const { data: log, mutate: reloadLog } = useMyDeliveries();
  const toast = useToast();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const p = t.auth.prefs;

  const save = async (change: Partial<Prefs>) => {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    try {
      const next = await sendJson<Prefs>("/api/account/notifications", change, "PUT");
      await mutate(next, { revalidate: false });
      reloadLog();
      toast(t.auth.common.saved);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return <Skeleton className="h-96" />;
  const rows: { key: keyof Prefs; label: string; locked?: boolean; disabled?: boolean; note?: string }[] = [
    { key: "sms_login", label: p.smsLogin, disabled: !prefs.providers.sms },
    { key: "whatsapp_login", label: p.whatsappLogin, disabled: !prefs.providers.whatsapp || !prefs.whatsapp_consent, note: !prefs.whatsapp_consent ? p.needsConsent : undefined },
    { key: "new_device", label: p.newDevice },
    { key: "password_change", label: p.passwordChange, locked: prefs.essential.includes("password_change") },
    { key: "security", label: p.security },
  ];

  return (
    <>
      <PageHead title={p.title} subtitle={p.subtitle} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-5">
          {!user?.phone_verified && <Notice tone="warn">{p.phoneNeeded}</Notice>}
          <section className="panel panel-edge p-5">
            <h2 className="font-display text-lg font-semibold">{p.alerts}</h2>
            <ul className="mt-3 divide-y divide-line/70">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-4 py-2">
                  <span className="min-w-0 text-sm">
                    {r.label}
                    {r.locked && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-accent">
                        <Lock className="h-3 w-3" aria-hidden />
                        {p.alwaysOn}
                      </span>
                    )}
                    {r.note && <span className="mt-0.5 block text-xs text-medium">{r.note}</span>}
                  </span>
                  <Switch checked={!!prefs[r.key]} disabled={saving || r.locked || r.disabled} label={r.label} onChange={(v) => save({ [r.key]: v })} />
                </li>
              ))}
            </ul>
            {prefs.essential.length > 0 && <p className="mt-2 text-xs text-muted">{p.alwaysOnHint}</p>}
          </section>

          <section className="panel panel-edge space-y-4 p-5">
            <ChannelPicker
              label={p.channel}
              value={prefs.channel}
              onChange={(c: Channel) => save({ channel: c as Prefs["channel"] })}
              options={["sms", "whatsapp"]}
              available={{ sms: prefs.providers.sms, whatsapp: prefs.providers.whatsapp && prefs.whatsapp_consent }}
            />
            <p className="text-xs text-muted">{p.channelHint}</p>
            <div className="border-t border-line pt-3">
              <h3 className="text-sm font-semibold">{p.consent}</h3>
              <Checkbox checked={prefs.whatsapp_consent} disabled={saving} onChange={(v) => save({ whatsapp_consent: v })}>
                {p.consentText}
              </Checkbox>
              {prefs.whatsapp_consent_at && <p className="ml-8 text-xs text-muted">{p.consentGiven(when(prefs.whatsapp_consent_at, lang) ?? "")}</p>}
            </div>
          </section>
          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="panel panel-edge p-5">
            <h2 className="kicker">{p.providers}</h2>
            <ul className="mt-3 space-y-2">
              {(["sms", "whatsapp", "email"] as const).map((c) => (
                <li key={c} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <ChannelIcon channel={c} className="h-4 w-4 text-muted" />
                    {t.auth.channels[c]}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${prefs.providers[c] ? "border-accent/45 text-accent" : "border-line text-muted"}`}>{prefs.providers[c] ? p.available : p.unavailable}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel panel-edge p-5">
            <h2 className="font-display text-lg font-semibold">{p.deliveries}</h2>
            {log?.deliveries.length ? (
              <ul className="mt-3 space-y-3">
                {log.deliveries.slice(0, 12).map((d) => (
                  <li key={d.id} className="text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <ChannelIcon channel={d.channel} />
                        {t.auth.delivery.events[d.event] ?? d.event}
                      </span>
                      <DeliveryBadge status={d.status} detail={d.detail} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {when(d.created_at, lang)} · <span className="font-mono">{d.target || "—"}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <Empty>{p.deliveriesEmpty}</Empty>
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-muted">{p.legend}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
