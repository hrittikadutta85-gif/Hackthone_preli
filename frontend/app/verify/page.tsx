"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Mail, Send } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, ChannelPicker, CodePanel, Notice, TextField, useErrorText, type Channel } from "@/components/auth/ui";
import { useAuthConfig } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

const savedEmail = () => {
  try {
    return sessionStorage.getItem("dw-verify-email") ?? "";
  } catch {
    return "";
  }
};

export default function Verify() {
  const { t, lang } = useI18n();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();
  const initial = useSyncExternalStore(() => () => {}, savedEmail, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? initial;
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [channel, setChannel] = useState<Channel>("sms");
  const [sent, setSent] = useState<{ expires_in: number; resend_in: number } | null>(null);
  const [result, setResult] = useState<{ status: string; email_verified: boolean; phone_verified: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const via: Channel = kind === "email" ? "email" : channel;
  const available = cfg ? cfg.channels[via] : true;
  const nothingToSend = cfg && !cfg.channels.email && !cfg.channels.sms && !cfg.channels.whatsapp;

  // With no email, SMS or WhatsApp set up, accounts never need verifying to sign in (the server skips the step).
  if (nothingToSend) {
    return (
      <AuthLayout title={t.auth.verify.title}>
        <Notice tone="success">{t.auth.verify.notNeeded}</Notice>
        <Link href="/login" className="btn btn-primary mt-5 h-12 w-full text-base">
          {t.auth.common.signIn}
        </Link>
      </AuthLayout>
    );
  }

  const request = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await sendJson<{ expires_in: number; resend_in: number }>("/api/auth/verify/request", { email: email.trim(), kind, channel: via, lang });
      setSent(r);
      return r;
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t.auth.verify.title} subtitle={t.auth.verify.subtitle}>
      {result ? (
        <div className="space-y-4">
          <Notice tone="success">{kind === "email" ? t.auth.verify.emailDone : t.auth.verify.phoneDone}</Notice>
          <p className="text-sm text-muted">{result.status === "active" ? t.auth.verify.ready : t.auth.verify.pending}</p>
          <Link href={result.status === "active" ? "/login?verified=1" : "/login"} className="btn btn-primary h-11 w-full">
            {t.auth.common.backToSignIn}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label={t.auth.verify.title} className="grid grid-cols-2 gap-1 rounded-full border border-line bg-raise p-1">
            {(["email", "phone"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={kind === k}
                onClick={() => { setKind(k); setSent(null); setError(null); }}
                className={`min-h-10 cursor-pointer rounded-full text-sm font-medium transition-colors ${kind === k ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}
              >
                {k === "email" ? t.auth.verify.emailTab : t.auth.verify.phoneTab}
              </button>
            ))}
          </div>
          <TextField label={t.auth.common.email} icon={Mail} type="email" autoComplete="email" required value={email} onChange={(e) => { setTyped(e.target.value); setSent(null); }} />
          {kind === "phone" && <ChannelPicker label={t.auth.forgot.sendBy} value={channel} onChange={setChannel} options={["sms", "whatsapp"]} available={cfg?.channels ?? {}} />}
          {!available && <Notice>{kind === "email" ? t.auth.register.unavailableEmail : t.auth.register.unavailablePhone}</Notice>}
          {sent ? (
            <CodePanel
              key={`${kind}-${via}`}
              sentText={t.auth.verify.sentGeneric}
              expiresIn={sent.expires_in}
              resendIn={sent.resend_in}
              busy={busy}
              error={error}
              onVerify={async (code) => {
                setBusy(true);
                setError(null);
                try {
                  setResult(await sendJson("/api/auth/verify/confirm", { email: email.trim(), kind, code }));
                } catch (err) {
                  setError(errText(err));
                  throw err;
                } finally {
                  setBusy(false);
                }
              }}
              onResend={request}
            />
          ) : (
            <>
              {error && <Notice tone="error">{error}</Notice>}
              <Button type="button" busy={busy} disabled={!email.includes("@") || !available} onClick={request} className="h-11 w-full">
                <Send className="h-4 w-4" aria-hidden />
                {t.auth.verify.send}
              </Button>
            </>
          )}
          <Link href="/login" className="tap block text-center text-sm text-muted hover:text-ink">
            {t.auth.common.backToSignIn}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
