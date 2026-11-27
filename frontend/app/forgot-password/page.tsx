"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, ChannelPicker, Notice, TextField, useErrorText, type Channel } from "@/components/auth/ui";
import { useAuthConfig } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";

export default function ForgotPassword() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data: cfg } = useAuthConfig();
  const errText = useErrorText();
  const [identifier, setIdentifier] = useState("");
  const [picked, setPicked] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avail = cfg?.channels ?? { sms: false, whatsapp: false, email: false };
  const channel: Channel = picked ?? ((["email", "sms", "whatsapp"] as Channel[]).find((c) => avail[c]) ?? "email");
  const none = cfg && !avail.email && !avail.sms && !avail.whatsapp;

  return (
    <AuthLayout title={t.auth.forgot.title} subtitle={t.auth.forgot.subtitle}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await sendJson<{ expires_in: number; resend_in: number }>("/api/auth/password/forgot", { identifier: identifier.trim(), channel, lang });
            // the next page needs these; kept for this tab only and cleared after sign-in
            sessionStorage.setItem("dw-reset", JSON.stringify({ identifier: identifier.trim(), channel, ...r, at: Date.now() }));
            router.push("/reset-password");
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label={t.auth.common.identifier} icon={Mail} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        <ChannelPicker label={t.auth.forgot.sendBy} value={channel} onChange={setPicked} options={["email", "sms", "whatsapp"]} available={avail} />
        <p className="text-xs text-muted">{t.auth.forgot.phoneNote}</p>
        {none && <Notice tone="warn">{t.auth.channels.noneAvailable}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" busy={busy} disabled={!identifier || !!none} className="h-11 w-full">
          <Send className="h-4 w-4" aria-hidden />
          {t.auth.forgot.submit}
        </Button>
        <Link href="/login" className="tap block text-center text-sm text-muted hover:text-ink">
          {t.auth.common.backToSignIn}
        </Link>
      </form>
    </AuthLayout>
  );
}
