"use client";
/* Form building blocks for the sign-in and account screens. */
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, MessageCircle, MessageSquareText, Mail, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { ApiError } from "@/lib/http";

/* ------------------------------------------------------------------ errors */
/** Turns any thrown error into one sentence in the current language. */
export function useErrorText() {
  const { t, bError } = useI18n();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      const fn = e.code ? t.auth.errors[e.code] : undefined;
      if (fn) return fn(e.data as never);
      return bError(e.message);
    }
    if (e instanceof TypeError) return t.auth.errors.network({});
    return e instanceof Error ? bError(e.message) : String(e);
  };
}

export const errCode = (e: unknown) => (e instanceof ApiError ? e.code : null);

/* ------------------------------------------------------------------ notices */
const TONES = {
  error: { Icon: AlertTriangle, cls: "border-critical/45 bg-critical/10 text-critical-ink" },
  success: { Icon: CheckCircle2, cls: "border-accent/45 bg-accent-soft text-accent" },
  info: { Icon: Info, cls: "border-line bg-raise text-ink/90" },
  warn: { Icon: AlertTriangle, cls: "border-medium/45 bg-medium/10 text-medium" },
};

export function Notice({ tone = "info", children, className = "" }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { Icon, cls } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${cls} ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ buttons */
export function Button({
  busy,
  children,
  variant = "primary",
  className = "",
  ...rest
}: { busy?: boolean; variant?: "primary" | "plain" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === "primary" ? "btn btn-primary" : variant === "danger" ? "btn border-critical/50 text-critical-ink hover:!border-critical" : "btn";
  return (
    <button {...rest} disabled={busy || rest.disabled} aria-busy={busy || undefined} className={`${v} ${className}`}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ inputs */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: LucideIcon;
  hint?: ReactNode;
  error?: string | null;
  trailing?: ReactNode;
  optionalText?: string;
}

export function TextField({ label, icon: IconC, hint, error, trailing, optionalText, className = "", id, ...rest }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = `${fid}-hint`;
  const errId = `${fid}-err`;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={fid} className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-ink/90">
        <span>{label}</span>
        {optionalText && <span className="text-xs font-normal text-muted">{optionalText}</span>}
      </label>
      <div className="relative">
        {IconC && <IconC className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />}
        <input
          id={fid}
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined}
          className={`field h-11 w-full rounded-xl px-3.5 text-[0.95rem] ${IconC ? "pl-10" : ""} ${trailing ? "pr-12" : ""} ${error ? "!border-critical/70" : ""}`}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1.5 text-xs text-critical-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, "type" | "trailing">) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? "text" : "password"}
      autoCapitalize="none"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t.auth.common.hide : t.auth.common.show}
          aria-pressed={shown}
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:text-accent"
        >
          {shown ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      }
    />
  );
}

export const COUNTRY_CODES = [
  { code: "+880", name: "Bangladesh", flag: "BD" },
  { code: "+91", name: "India", flag: "IN" },
  { code: "+977", name: "Nepal", flag: "NP" },
  { code: "+94", name: "Sri Lanka", flag: "LK" },
  { code: "+95", name: "Myanmar", flag: "MM" },
  { code: "+92", name: "Pakistan", flag: "PK" },
  { code: "+60", name: "Malaysia", flag: "MY" },
  { code: "+65", name: "Singapore", flag: "SG" },
  { code: "+971", name: "UAE", flag: "AE" },
  { code: "+966", name: "Saudi Arabia", flag: "SA" },
  { code: "+44", name: "United Kingdom", flag: "GB" },
  { code: "+1", name: "USA / Canada", flag: "US" },
];

/** "+880" + "01712 345678" -> "+8801712345678". The server validates and normalises again. */
export function joinPhone(cc: string, local: string) {
  const digits = toLatinDigits(local).replace(/[^\d]/g, "");
  if (!digits) return "";
  return `${cc}${cc === "+880" ? digits.replace(/^0/, "") : digits.replace(/^0+/, "")}`;
}

export function PhoneField({
  label,
  cc,
  onCc,
  value,
  onChange,
  hint,
  error,
  required,
  autoFocus,
}: {
  label: string;
  cc: string;
  onCc: (v: string) => void;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink/90">
        {label}
      </label>
      <div className="flex gap-2">
        <select aria-label={t.auth.common.countryCode} value={cc} onChange={(e) => onCc(e.target.value)} className="field h-11 w-[7.6rem] shrink-0 cursor-pointer rounded-xl px-2 font-mono text-sm">
          {COUNTRY_CODES.map((c) => (
            <option key={c.code + c.flag} value={c.code}>
              {c.flag} {c.code}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={cc === "+880" ? "01712 345678" : ""}
          aria-invalid={error ? true : undefined}
          className={`field h-11 w-0 min-w-0 flex-1 rounded-xl px-3.5 font-mono text-[0.95rem] ${error ? "!border-critical/70" : ""}`}
        />
      </div>
      {hint && !error && <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-critical-ink">{error}</p>}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 items-start gap-3 py-1.5 text-sm leading-relaxed ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[var(--accent)]" />
      <span className="min-w-0 text-ink/90">{children}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="switch" />;
}

/* ------------------------------------------------------------------ password strength */
// Same rule as the server (backend/auth/security.py): long enough, and not a common or personal password.
const COMMON = ["password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou", "admin123", "letmein", "welcome1",
  "dengue123", "dhaka1234", "bangladesh", "abc12345", "11111111", "qwertyui", "asdfghjk", "87654321", "00000000", "12341234", "passw0rd", "bangladesh1"];

export function passwordChecks(pw: string, min: number, email = "", name = "", phone = "") {
  const low = pw.toLowerCase();
  const personal = [email.split("@")[0].toLowerCase(), ...name.toLowerCase().split(/\s+/).filter((w) => w.length >= 4)].filter((p) => p.length >= 4);
  const digits = phone.replace(/\D/g, "");
  const length = pw.length >= min;
  const common =
    pw.length > 0 &&
    !COMMON.includes(low) &&
    new Set(low).size > 2 &&
    !personal.some((p) => low.includes(p)) &&
    !(digits.length >= 6 && (low.includes(digits.slice(-8)) || digits.includes(low)));
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const ok = length && common;
  const score = !pw ? 0 : !ok ? 1 : pw.length >= 14 || (pw.length >= 10 && classes >= 3) ? 4 : pw.length >= 10 || classes >= 3 ? 3 : 2;
  return { length, common, ok, score };
}

export function StrengthMeter({ password, min, email, name, phone }: { password: string; min: number; email?: string; name?: string; phone?: string }) {
  const { t } = useI18n();
  const c = passwordChecks(password, min, email, name, phone);
  const colors = ["var(--critical)", "var(--critical)", "var(--high)", "var(--medium)", "var(--low)"];
  const rules: [boolean, string][] = [
    [c.length, t.auth.strength.rules.length(min)],
    [c.common, t.auth.strength.rules.common],
  ];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="h-1.5 rounded-full transition-colors" style={{ background: c.score >= i ? colors[c.score] : "var(--line)" }} />
          ))}
        </div>
        <span className="min-w-20 text-right text-xs font-medium" style={{ color: password ? colors[c.score] : "var(--muted)" }}>
          <span className="sr-only">{t.auth.strength.label}: </span>
          {password ? t.auth.strength.levels[c.score] : ""}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {rules.map(([ok, text]) => (
          <li key={text} className={`flex items-start gap-2 text-xs ${ok ? "text-accent" : "text-muted"}`}>
            {ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : <X className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ one-time code */
export function OtpInput({ onComplete, disabled, invalid, autoFocus = true }: { onComplete: (code: string) => void; disabled?: boolean; invalid?: boolean; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const update = (next: string[], focus: number) => {
    setDigits(next);
    refs.current[Math.max(0, Math.min(5, focus))]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };

  const fill = (start: number, text: string) => {
    const incoming = toLatinDigits(text).replace(/\D/g, "").slice(0, 6 - start).split("");
    if (!incoming.length) return;
    const next = [...digits];
    incoming.forEach((d, i) => (next[start + i] = d));
    update(next, start + incoming.length);
  };

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{t.auth.otp.label}</legend>
      <div className="grid grid-cols-6 justify-items-center gap-2 sm:gap-2.5" onPaste={(e) => {
        e.preventDefault();
        const i = refs.current.findIndex((r) => r === document.activeElement);
        fill(Math.max(0, i), e.clipboardData.getData("text"));
      }}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={d}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={6}
            placeholder=" "
            aria-label={t.auth.otp.digit(i + 1)}
            aria-invalid={invalid || undefined}
            className={`field otp-cell ${invalid ? "!border-critical/70" : ""}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v.length > 1) return fill(i, v); // autofill from the SMS puts the whole code in one box
              const digit = toLatinDigits(v).replace(/\D/g, "");
              const next = [...digits];
              next[i] = digit;
              update(next, digit ? i + 1 : i);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) {
                e.preventDefault();
                const next = [...digits];
                next[i - 1] = "";
                update(next, i - 1);
              } else if (e.key === "ArrowLeft") refs.current[i - 1]?.focus();
              else if (e.key === "ArrowRight") refs.current[i + 1]?.focus();
            }}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Seconds left until `until` (a timestamp in ms), ticking every second. */
export function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ------------------------------------------------------------------ channels */
export type Channel = "sms" | "whatsapp" | "email";
const CH_ICON: Record<Channel, LucideIcon> = { sms: MessageSquareText, whatsapp: MessageCircle, email: Mail };

export function ChannelPicker({
  value,
  onChange,
  options,
  available,
  label,
}: {
  value: Channel;
  onChange: (c: Channel) => void;
  options: Channel[];
  available: Partial<Record<Channel, boolean>>;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink/90" id="channel-label">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby="channel-label" className={`grid gap-2 ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {options.map((c) => {
          const Ic = CH_ICON[c];
          const on = available[c];
          const active = value === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!on}
              onClick={() => onChange(c)}
              className={`flex min-h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1.5 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                active && on ? "border-accent/70 bg-accent-soft text-accent shadow-sm" : "border-line text-ink/85 hover:border-accent/40"
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Ic className="h-4 w-4" aria-hidden />
                {t.auth.channels[c]}
              </span>
              {!on && <span className="text-[0.68rem] text-muted">{t.auth.channels.notSetUp}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Code entry with expiry countdown, resend cooldown and optional channel switch. */
export function CodePanel({
  sentText,
  expiresIn,
  resendIn,
  onVerify,
  onResend,
  busy,
  error,
  channels,
  current,
  onSwitch,
  submitLabel,
}: {
  sentText: ReactNode;
  expiresIn: number;
  resendIn: number;
  onVerify: (code: string) => Promise<void>;
  onResend: (channel?: Channel) => Promise<{ expires_in: number; resend_in: number } | void>;
  busy?: boolean;
  error?: string | null;
  channels?: Channel[];
  current?: Channel;
  onSwitch?: (c: Channel) => void;
  submitLabel?: string;
}) {
  const { t, f } = useI18n();
  const [code, setCode] = useState("");
  const [expiry, setExpiry] = useState(() => Date.now() + expiresIn * 1000);
  const [resendAt, setResendAt] = useState(() => Date.now() + resendIn * 1000);
  const [wrong, setWrong] = useState(0);
  const [sending, setSending] = useState(false);
  const left = useCountdown(expiry);
  const wait = useCountdown(resendAt);

  const verify = async (c: string) => {
    if (c.length !== 6) return;
    try {
      await onVerify(c);
    } catch {
      setWrong((w) => w + 1);
      setCode("");
    }
  };
  const resend = async (ch?: Channel) => {
    setSending(true);
    try {
      const r = await onResend(ch);
      setExpiry(Date.now() + (r?.expires_in ?? expiresIn) * 1000);
      setResendAt(Date.now() + (r?.resend_in ?? resendIn) * 1000);
      setWrong(0);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">{sentText}</p>
      <OtpInput key={wrong} onComplete={(c) => { setCode(c); verify(c); }} disabled={busy} invalid={wrong > 0} />
      <p className={`text-center font-mono text-xs ${left ? "text-muted" : "text-critical-ink"}`} aria-live="polite">
        {left ? t.auth.otp.expiresIn(f.digits(mmss(left))) : t.auth.otp.expired}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="button" busy={busy} disabled={code.length !== 6 || !left} onClick={() => verify(code)} className="h-11 w-full">
        {submitLabel ?? t.auth.otp.submit}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" disabled={wait > 0 || sending} onClick={() => resend(current)} className="tap cursor-pointer rounded-lg px-1 font-medium text-accent disabled:cursor-default disabled:text-muted">
          {wait > 0 ? t.auth.otp.resendIn(wait) : t.auth.otp.resend}
        </button>
        {channels && current && onSwitch &&
          channels
            .filter((c) => c !== current)
            .map((c) => (
              <button key={c} type="button" disabled={wait > 0 || sending} onClick={() => { onSwitch(c); resend(c); }} className="tap cursor-pointer rounded-lg px-1 text-muted hover:text-ink disabled:cursor-default">
                {t.auth.otp.sendBy(t.auth.channels[c])}
              </button>
            ))}
      </div>
      <p className="text-center text-xs text-muted">{t.auth.otp.pasteHint}</p>
    </div>
  );
}
