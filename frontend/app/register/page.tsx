"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, KeyRound, UserPlus } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Notice, PasswordField, PhoneField, StrengthMeter, joinPhone, passwordChecks, useErrorText } from "@/components/auth/ui";
import { useAuth, useAuthConfig, type User } from "@/lib/auth";
import { ApiError, sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

type Ok = { status: "ok"; user: User; csrf: string; home: string };

/** Sign-up with only a mobile number and a password. The new account is signed in straight away. */
export default function Register() {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();
  const min = cfg?.password_min_length ?? 8;
  const [cc, setCc] = useState("+880");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const full = joinPhone(cc, phone);
  const ok = passwordChecks(password, min, "", "", full).ok;

  if (cfg && !cfg.public_registration) {
    return (
      <AuthLayout title={t.auth.register.closedTitle} subtitle={t.auth.register.closedText}>
        <div className="flex flex-col gap-3">
          <Link href="/invite" className="btn btn-primary h-11">{t.auth.login.acceptInvite}</Link>
          <Link href="/login" className="btn h-11">{t.auth.common.backToSignIn}</Link>
        </div>
      </AuthLayout>
    );
  }

  if (pending) {
    return (
      <AuthLayout title={t.auth.register.pendingTitle}>
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-accent/40 bg-accent-soft text-accent">
            <Clock className="h-7 w-7" aria-hidden />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-muted">{t.auth.register.pendingText}</p>
          <Link href="/login" className="btn btn-primary mt-6 h-11 w-full">{t.auth.common.backToSignIn}</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t.auth.register.title} subtitle={t.auth.register.subtitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPhoneError(null);
          setBusy(true);
          try {
            const r = await sendJson<Ok | { status: "pending" }>("/api/auth/register", { phone: full, password, lang, accept_terms: true });
            if (r.status === "ok") signedIn(r, null);
            else setPending(true);
          } catch (err) {
            const code = err instanceof ApiError ? err.code : null;
            if (code === "phone_taken" || code === "invalid_phone") setPhoneError(errText(err));
            else setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <PhoneField label={t.auth.common.phone} cc={cc} onCc={setCc} value={phone} onChange={setPhone} required autoFocus hint={t.auth.register.phoneHint} error={phoneError} />
        <div>
          <PasswordField label={t.auth.common.password} icon={KeyRound} autoComplete="new-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
          {password && <StrengthMeter password={password} min={min} phone={full} />}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" busy={busy} disabled={!phone || !ok} className="h-12 w-full text-base">
          <UserPlus className="h-4 w-4" aria-hidden />
          {t.auth.register.submit}
        </Button>
        <div className="text-center text-xs leading-relaxed text-muted">
          {t.auth.register.termsNote}{" "}
          <details className="inline">
            <summary className="inline cursor-pointer text-accent">{t.auth.register.privacyLink}</summary>
            <span className="mt-1 block text-left">{t.auth.privacy.text}</span>
          </details>
        </div>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t.auth.register.haveAccount}{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">{t.auth.common.signIn}</Link>
      </p>
    </AuthLayout>
  );
}
