"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft, ArrowRight, Lock, Mail } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, CodePanel, Notice, PasswordField, PhoneField, TextField, errCode, joinPhone, useErrorText, type Channel } from "@/components/auth/ui";
import { useAuth, useAuthConfig, type User } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

type Ok = { status: "ok"; user: User; csrf: string; home: string };
type Challenge = { status: "otp_required"; challenge: string; channel: Channel; channels: Channel[]; sent_to?: string; expires_in: number; resend_in: number };

/** Sign in with a mobile number and a password. Staff accounts without a phone can switch to email. */
function LoginForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const next = params.get("next");
  const { signedIn } = useAuth();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();

  const [useEmail, setUseEmail] = useState(false);
  const [cc, setCc] = useState("+880");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  const identifier = useEmail ? email.trim() : joinPhone(cc, phone);
  const banner = (["expired", "signedout", "reset", "invited", "verified"] as const).find((k) => params.get(k));

  const handle = (r: Ok | Challenge) => (r.status === "ok" ? signedIn(r, next) : setChallenge(r));

  // Only shown when the account has two-step sign-in turned on.
  if (challenge) {
    return (
      <AuthLayout title={t.auth.otp.title}>
        <CodePanel
          sentText={challenge.sent_to ? t.auth.otp.sentTo(t.auth.channels.via(t.auth.channels[challenge.channel]), challenge.sent_to) : t.auth.otp.sentGeneric}
          expiresIn={challenge.expires_in}
          resendIn={challenge.resend_in}
          busy={busy}
          error={error}
          channels={challenge.channels}
          current={challenge.channel}
          onSwitch={(c) => setChallenge({ ...challenge, channel: c })}
          onVerify={async (code) => {
            setBusy(true);
            setError(null);
            try {
              handle(await sendJson<Ok>("/api/auth/login/otp/verify", { challenge: challenge.challenge, code }));
            } catch (err) {
              setError(errText(err));
              if (errCode(err) === "challenge_expired") setChallenge(null);
              throw err;
            } finally {
              setBusy(false);
            }
          }}
          onResend={async (c) => {
            setError(null);
            try {
              const r = await sendJson<Challenge>("/api/auth/login/otp/resend", { challenge: challenge.challenge, channel: c ?? challenge.channel });
              setChallenge({ ...challenge, ...r });
              return r;
            } catch (err) {
              setError(errText(err));
            }
          }}
        />
        <button type="button" onClick={() => { setChallenge(null); setError(null); }} className="tap mt-5 flex cursor-pointer items-center gap-2 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t.auth.common.back}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t.auth.login.title} subtitle={t.auth.login.subtitle}>
      {banner && (
        <Notice tone={banner === "expired" ? "warn" : "success"} className="mb-5">
          {t.auth.login.banners[banner]}
        </Notice>
      )}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            handle(await sendJson<Ok | Challenge>("/api/auth/login", { identifier, password, remember }));
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {useEmail ? (
          <TextField label={t.auth.common.email} icon={Mail} type="email" name="username" autoComplete="username" autoCapitalize="none" placeholder="you@example.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        ) : (
          <PhoneField label={t.auth.common.phone} cc={cc} onCc={setCc} value={phone} onChange={setPhone} required autoFocus />
        )}
        <div>
          <PasswordField label={t.auth.common.password} icon={Lock} name="password" autoComplete="current-password" placeholder={t.auth.login.passwordPlaceholder} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label className="tap inline-flex cursor-pointer items-center gap-2 text-sm text-muted" title={t.auth.login.rememberHint}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 cursor-pointer rounded accent-[var(--accent)]" />
              {t.auth.login.rememberShort}
            </label>
            <Link href="/forgot-password" className="tap inline-flex items-center rounded-md px-1 text-sm font-medium text-accent hover:underline">
              {t.auth.login.forgot}
            </Link>
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" busy={busy} disabled={!identifier || !password} className="group h-12 w-full text-base">
          {t.auth.login.submit}
          {!busy && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
        </Button>
      </form>

      {cfg?.public_registration !== false && (
        <p className="mt-6 text-center text-sm text-muted">
          {t.auth.login.noAccount}{" "}
          <Link href="/register" className="font-semibold text-accent hover:underline">
            {t.auth.common.register}
          </Link>
        </p>
      )}
      <p className="mt-3 text-center">
        <button type="button" onClick={() => { setUseEmail((v) => !v); setError(null); }} className="tap cursor-pointer text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {useEmail ? t.auth.login.usePhone : t.auth.login.useEmail}
        </button>
      </p>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
