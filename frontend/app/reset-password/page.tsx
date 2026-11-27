"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { KeyRound } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, CodePanel, Notice, PasswordField, StrengthMeter, passwordChecks, useErrorText, type Channel } from "@/components/auth/ui";
import { useAuthConfig } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

type Pending = { identifier: string; channel: Channel; expires_in: number; resend_in: number; at: number };

const RAW = () => {
  try {
    return sessionStorage.getItem("dw-reset");
  } catch {
    return null;
  }
};

export default function ResetPassword() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();
  const raw = useSyncExternalStore(() => () => {}, RAW, () => null);
  const pending: Pending | null = raw ? JSON.parse(raw) : null;
  const [token, setToken] = useState<string | null>(null); // short-lived reset token, kept in memory only
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = cfg?.password_min_length ?? 10;
  const [openedAt] = useState(() => Date.now());

  if (!pending) {
    return (
      <AuthLayout title={t.auth.reset.title}>
        <Notice>{t.auth.errors.reset_expired({})}</Notice>
        <Link href="/forgot-password" className="btn btn-primary mt-5 h-11 w-full">
          {t.auth.reset.startOver}
        </Link>
      </AuthLayout>
    );
  }

  const elapsed = Math.max(0, Math.floor((openedAt - pending.at) / 1000));
  const checks = passwordChecks(password, min, pending.identifier.includes("@") ? pending.identifier : "");
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <AuthLayout title={t.auth.reset.title} subtitle={token ? t.auth.reset.passwordStep : t.auth.reset.codeStep}>
      {!token ? (
        <CodePanel
          sentText={t.auth.reset.sentGeneric}
          expiresIn={Math.max(0, pending.expires_in - elapsed)}
          resendIn={Math.max(0, pending.resend_in - elapsed)}
          busy={busy}
          error={error}
          submitLabel={t.auth.common.continue}
          onVerify={async (code) => {
            setBusy(true);
            setError(null);
            try {
              const r = await sendJson<{ reset_token: string }>("/api/auth/password/verify", { identifier: pending.identifier, code });
              setToken(r.reset_token);
            } catch (err) {
              setError(errText(err));
              throw err;
            } finally {
              setBusy(false);
            }
          }}
          onResend={async () => {
            setError(null);
            try {
              const r = await sendJson<{ expires_in: number; resend_in: number }>("/api/auth/password/forgot", { identifier: pending.identifier, channel: pending.channel, lang });
              sessionStorage.setItem("dw-reset", JSON.stringify({ ...pending, ...r, at: Date.now() }));
              return r;
            } catch (err) {
              setError(errText(err));
            }
          }}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!checks.ok || mismatch) return setError(mismatch ? t.auth.strength.mismatch : t.auth.errors.weak_password({}));
            setBusy(true);
            setError(null);
            try {
              await sendJson("/api/auth/password/reset", { reset_token: token, password });
              sessionStorage.removeItem("dw-reset");
              router.replace("/login?reset=1");
            } catch (err) {
              setError(errText(err));
              if ((err as { code?: string }).code === "reset_expired") setToken(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <PasswordField label={t.auth.common.newPassword} icon={KeyRound} autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <StrengthMeter password={password} min={min} email={pending.identifier} />
          </div>
          <PasswordField label={t.auth.common.confirmPassword} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? t.auth.strength.mismatch : null} />
          <Notice>{t.auth.reset.signedOutEverywhere}</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" busy={busy} disabled={!checks.ok || !confirm || mismatch} className="h-11 w-full">
            {t.auth.reset.submit}
          </Button>
        </form>
      )}
      <Link href="/forgot-password" className="tap mt-5 block text-center text-sm text-muted hover:text-ink">
        {t.auth.reset.startOver}
      </Link>
    </AuthLayout>
  );
}
