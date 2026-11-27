"use client";
import { useState } from "react";
import { AtSign, Building2, KeyRound, Phone, ShieldCheck, User as UserIcon } from "lucide-react";
import { useAuth, useAuthConfig } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { when } from "@/lib/account";
import { Avatar, displayName } from "@/components/auth/UserMenu";
import { PageHead, VerifiedBadge } from "@/components/auth/parts";
import { useReauth, useToast } from "@/components/auth/Providers";
import { Button, ChannelPicker, CodePanel, Notice, PasswordField, PhoneField, StrengthMeter, Switch, TextField, joinPhone, passwordChecks, useErrorText, type Channel } from "@/components/auth/ui";

function Section({ title, icon: Ic, children, text }: { title: string; icon: typeof UserIcon; children: React.ReactNode; text?: string }) {
  return (
    <section className="panel panel-edge p-5">
      <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
        <Ic className="h-[18px] w-[18px] text-accent" aria-hidden />
        {title}
      </h2>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProfileForm() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const errText = useErrorText();
  const [form, setForm] = useState({ full_name: user!.full_name, organization: user!.organization, designation: user!.designation, username: user!.username ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await sendJson("/api/account/profile", { ...form, username: form.username.trim() || undefined }, "PATCH");
          await refresh();
          toast(t.auth.common.saved);
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label={t.auth.common.fullName} icon={UserIcon} required maxLength={120} value={form.full_name} onChange={set("full_name")} autoComplete="name" />
      <TextField label={t.auth.common.username} optionalText={t.auth.common.optional} icon={AtSign} maxLength={32} value={form.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" />
      <TextField label={t.auth.common.organization} icon={Building2} maxLength={200} value={form.organization} onChange={set("organization")} autoComplete="organization" />
      <TextField label={t.auth.common.designation} maxLength={200} value={form.designation} onChange={set("designation")} autoComplete="organization-title" />
      {error && <Notice tone="error" className="sm:col-span-2">{error}</Notice>}
      <div className="sm:col-span-2">
        <Button type="submit" busy={busy}>
          {busy ? t.auth.common.saving : t.auth.common.save}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: cfg } = useAuthConfig();
  const toast = useToast();
  const errText = useErrorText();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = cfg?.password_min_length ?? 10;
  const ok = passwordChecks(next, min, user!.email ?? "", user!.full_name, user!.phone ?? "").ok;
  const mismatch = confirm.length > 0 && confirm !== next;
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await sendJson<{ other_sessions_ended: number }>("/api/account/password", { current_password: cur, new_password: next });
          setCur("");
          setNext("");
          setConfirm("");
          toast(t.auth.account.password.done(r.other_sessions_ended));
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <PasswordField label={t.auth.common.currentPassword} autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} className="sm:col-span-2 sm:max-w-sm" />
      <div>
        <PasswordField label={t.auth.common.newPassword} autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        <StrengthMeter password={next} min={min} email={user!.email ?? ""} name={user!.full_name} phone={user!.phone ?? ""} />
      </div>
      <PasswordField label={t.auth.common.confirmPassword} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? t.auth.strength.mismatch : null} />
      {error && <Notice tone="error" className="sm:col-span-2">{error}</Notice>}
      <div className="sm:col-span-2">
        <Button type="submit" busy={busy} disabled={!cur || !ok || !confirm || mismatch}>
          {t.auth.account.password.submit}
        </Button>
      </div>
    </form>
  );
}

function PhoneCard() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const { data: cfg } = useAuthConfig();
  const guard = useReauth();
  const toast = useToast();
  const errText = useErrorText();
  const [mode, setMode] = useState<"idle" | "change" | "code">("idle");
  const [cc, setCc] = useState("+880");
  const [local, setLocal] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [target, setTarget] = useState<string>("");
  const [sent, setSent] = useState<{ expires_in: number; resend_in: number; sent_to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = { sms: !!cfg?.channels.sms, whatsapp: !!cfg?.channels.whatsapp };

  const send = async (phone: string, ch: Channel = channel) => {
    setBusy(true);
    setError(null);
    try {
      const r = await guard(() => sendJson<{ expires_in: number; resend_in: number; sent_to: string }>("/api/account/phone/request", { phone, channel: ch }));
      setTarget(phone);
      setSent(r);
      setMode("code");
      return r;
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.auth.account.phone.title} icon={Phone}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[0.95rem]">{user!.phone ?? t.auth.account.profile.noPhone}</span>
        {user!.phone && <VerifiedBadge ok={user!.phone_verified} />}
      </div>
      {mode !== "code" && (available.sms || available.whatsapp) && (
        <div className="mt-4 space-y-4">
          <ChannelPicker label={t.auth.forgot.sendBy} value={channel} onChange={setChannel} options={["sms", "whatsapp"]} available={available} />
          {mode === "change" && <PhoneField label={t.auth.account.phone.newNumber} cc={cc} onCc={setCc} value={local} onChange={setLocal} autoFocus />}
          <div className="flex flex-wrap gap-2">
            {user!.phone && !user!.phone_verified && mode === "idle" && (
              <Button type="button" busy={busy} onClick={() => send(user!.phone!)}>
                {t.auth.account.phone.verifyNow}
              </Button>
            )}
            {mode === "change" ? (
              <>
                <Button type="button" busy={busy} disabled={!local} onClick={() => send(joinPhone(cc, local))}>
                  {t.auth.account.phone.sendCode}
                </Button>
                <Button type="button" variant="plain" onClick={() => setMode("idle")}>
                  {t.auth.common.cancel}
                </Button>
              </>
            ) : (
              <Button type="button" variant="plain" onClick={() => setMode("change")}>
                {t.auth.account.phone.change}
              </Button>
            )}
          </div>
        </div>
      )}
      {!available.sms && !available.whatsapp && <Notice className="mt-4">{t.auth.register.unavailablePhone}</Notice>}
      {mode === "code" && sent && (
        <div className="mt-4 max-w-sm">
          <CodePanel
            sentText={t.auth.otp.sentTo(t.auth.channels.via(t.auth.channels[channel]), sent.sent_to)}
            expiresIn={sent.expires_in}
            resendIn={sent.resend_in}
            busy={busy}
            error={error}
            onVerify={async (code) => {
              setBusy(true);
              setError(null);
              try {
                await sendJson("/api/account/phone/confirm", { phone: target, code });
                await refresh();
                setMode("idle");
                setLocal("");
                toast(t.auth.account.phone.done);
              } catch (err) {
                setError(errText(err));
                throw err;
              } finally {
                setBusy(false);
              }
            }}
            onResend={() => send(target)}
          />
          <button type="button" onClick={() => setMode("idle")} className="tap mt-3 cursor-pointer text-sm text-muted hover:text-ink">
            {t.auth.common.cancel}
          </button>
        </div>
      )}
      {error && mode !== "code" && <Notice tone="error" className="mt-4">{error}</Notice>}
    </Section>
  );
}

function TwoStep() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const guard = useReauth();
  const toast = useToast();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = user!.otp_login;
  return (
    <Section title={t.auth.account.twoStep.title} icon={ShieldCheck}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{on ? t.auth.account.twoStep.on : t.auth.account.twoStep.off}</p>
        <Switch
          checked={on}
          disabled={busy}
          label={t.auth.account.twoStep.title}
          onChange={async (v) => {
            setBusy(true);
            setError(null);
            try {
              await guard(() => sendJson("/api/account/otp-login", { enabled: v }, "PUT"));
              await refresh();
              toast(t.auth.common.saved);
            } catch (err) {
              setError(errText(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {!user!.phone_verified && !on && <p className="mt-3 text-xs text-muted">{t.auth.account.twoStep.needsPhone}</p>}
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </Section>
  );
}

export default function Profile() {
  const { t, lang, f } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  const p = t.auth.account.profile;
  const facts: [string, React.ReactNode][] = [
    [t.auth.common.email, user.email ? <span key="e" className="flex flex-wrap items-center gap-2 break-all">{user.email} <VerifiedBadge ok={user.email_verified} /></span> : "—"],
    [t.auth.common.phone, <span key="p" className="flex flex-wrap items-center gap-2 font-mono">{user.phone ?? "—"} {user.phone && <VerifiedBadge ok={user.phone_verified} />}</span>],
    [t.auth.common.organization, user.organization || "—"],
    [t.auth.common.designation, user.designation || "—"],
    [t.auth.common.role, t.auth.roles[user.role]],
    [p.created, when(user.created_at, lang)],
    [p.lastLogin, when(user.last_login_at, lang) ?? t.auth.common.never],
  ];
  return (
    <>
      <PageHead title={p.title} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="panel panel-edge h-fit p-5">
          <div className="flex items-center gap-4">
            <Avatar name={displayName(user)} size="lg" />
            <div className="min-w-0">
              <p className="font-display truncate text-xl font-semibold">{displayName(user)}</p>
              <p className="mt-1 inline-flex rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{t.auth.roles[user.role]}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="kicker">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
            {user.role === "field" && (
              <div>
                <dt className="kicker">{p.wards}</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {user.assigned_wards.length ? user.assigned_wards.map((w) => <span key={w} className="rounded-full border border-line px-2 py-0.5 font-mono text-xs">{f.digits(w.replace(/_/g, " "))}</span>) : <span className="text-muted">{p.noWards}</span>}
                </dd>
              </div>
            )}
          </dl>
        </section>
        <div className="min-w-0 space-y-5">
          <Section title={p.edit} icon={UserIcon}>
            <ProfileForm />
          </Section>
          <PhoneCard />
          <TwoStep />
          <Section title={t.auth.account.password.title} icon={KeyRound} text={t.auth.account.password.text}>
            <PasswordForm />
          </Section>
        </div>
      </div>
    </>
  );
}
