"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Mail, Ticket } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Notice, PasswordField, StrengthMeter, TextField, passwordChecks, useErrorText } from "@/components/auth/ui";
import { useAuthConfig } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

export default function AcceptInvite() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = cfg?.password_min_length ?? 10;
  const checks = passwordChecks(password, min, email);
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <AuthLayout title={t.auth.invite.title} subtitle={t.auth.invite.subtitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!checks.ok || mismatch) return setError(mismatch ? t.auth.strength.mismatch : t.auth.errors.weak_password({}));
          setBusy(true);
          setError(null);
          try {
            await sendJson("/api/auth/invite/accept", { email: email.trim(), code: code.trim(), password });
            router.replace("/login?invited=1");
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label={t.auth.invite.identifier} icon={Mail} autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label={t.auth.invite.code}
          icon={Ticket}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={20}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          hint={t.auth.invite.codeHint}
          className="[&_input]:font-mono [&_input]:tracking-widest"
        />
        <div>
          <PasswordField label={t.auth.common.newPassword} icon={KeyRound} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <StrengthMeter password={password} min={min} email={email} />
        </div>
        <PasswordField label={t.auth.common.confirmPassword} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? t.auth.strength.mismatch : null} />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" busy={busy} disabled={!email || !code || !checks.ok || !confirm || mismatch} className="h-11 w-full">
          {t.auth.invite.submit}
        </Button>
        <Link href="/login" className="tap block text-center text-sm text-muted hover:text-ink">
          {t.auth.common.backToSignIn}
        </Link>
      </form>
    </AuthLayout>
  );
}
