"use client";
/*
 * Frame for every screen a signed-out person sees. Wide screens get a split layout: a deep-teal brand panel on the
 * left (headline, description, an educational Aedes mosquito illustration and three figures taken from this project's
 * own data) and the form on a light background on the right. Phones show the brand bar and the form only.
 * Decorative parts are hidden from screen readers.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { BrandMark, MosquitoArt } from "@/components/icons";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useI18n, useTitle } from "@/lib/i18n";

const MINT = "#9fdcc8";

function PlatformPanel() {
  const { t } = useI18n();
  const p = t.auth.platform;
  return (
    <aside
      className="relative hidden min-h-dvh flex-col overflow-hidden p-10 text-white lg:flex xl:p-14"
      style={{ background: "linear-gradient(155deg, #23786e 0%, #1a5c55 50%, #133f3b 100%)" }}
      aria-label={p.kicker}
    >
      {/* background visual: soft light, surveillance rings and the mosquito, kept faint so the text stays readable */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at 85% 35%, rgb(159 220 200 / 0.18), transparent 70%)" }} />
        <svg viewBox="0 0 600 600" className="absolute top-[4%] -right-[26%] h-[min(78vh,40rem)] w-[min(78vh,40rem)]">
          {[90, 150, 210, 270].map((r, i) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="#ffffff" strokeOpacity={0.09 - i * 0.015} strokeDasharray={i % 2 ? "2 8" : undefined} />
          ))}
        </svg>
        <MosquitoArt tone="light" className="absolute top-[10%] right-[-14%] h-[min(58vh,29rem)] w-[min(58vh,29rem)] rotate-[18deg] opacity-[0.2]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#133f3b]/70 via-transparent to-transparent" />
      </div>
      <span className="sr-only">{p.visualLabel}</span>

      <Link href="/login" className="relative flex items-center gap-3">
        <BrandMark tone="light" className="h-11 w-11" />
        <span>
          <span className="font-display block text-xl font-semibold">{t.common.brand}</span>
          <span className="block text-[0.68rem] font-semibold tracking-[0.1em] uppercase" style={{ color: MINT }}>
            {t.shell.tagline}
          </span>
        </span>
      </Link>

      <div className="relative flex flex-1 flex-col justify-center py-10">
        <h2 className="font-display max-w-xl text-4xl leading-[1.15] font-semibold xl:text-[2.9rem]">
          {p.headline.before}
          <span style={{ color: MINT }}>{p.headline.highlight}</span>
          {p.headline.after}
        </h2>
        <p className="mt-5 max-w-lg text-[0.98rem] leading-relaxed text-white/75">{p.description}</p>
        <ul className="mt-7 flex max-w-xl flex-wrap gap-2">
          {p.facts.map((fact) => (
            <li key={fact.title} title={fact.text} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/90">
              <CheckCircle2 className="h-3.5 w-3.5" style={{ color: MINT }} aria-hidden />
              {fact.title}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        <dl className="grid grid-cols-3 gap-3">
          {p.stats.map((s) => (
            <div key={s.label} className="min-w-0 rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-sm">
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-display text-2xl font-semibold tabular-nums xl:text-[1.7rem]">{s.value}</dd>
              <dd className="mt-0.5 text-sm font-medium text-white/90">{s.label}</dd>
              <dd className="mt-1 text-[0.72rem] leading-snug text-white/60">{s.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: MINT }} aria-hidden />
          {p.secure}
        </p>
      </div>
    </aside>
  );
}

export function AuthLayout({ title, subtitle, children, wide = false }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useTitle(title);
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      <PlatformPanel />
      <main className="relative flex min-h-dvh min-w-0 flex-col bg-paper px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-8 sm:px-8">
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <Link href="/login" className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="min-w-0">
              <span className="font-display block text-lg leading-tight font-semibold">{t.common.brand}</span>
              <span className="kicker brand-tagline block max-[379px]:hidden">{t.shell.tagline}</span>
            </span>
          </Link>
          <LanguageSwitch />
        </div>
        <p className="font-display mx-auto mt-6 max-w-md text-center text-sm font-medium text-accent lg:hidden">{t.auth.tagline}</p>
        <div className="flex flex-1 items-center justify-center py-6 lg:py-10">
          <div className={`auth-glass rise w-full min-w-0 p-6 sm:p-9 ${wide ? "max-w-2xl" : "max-w-[27rem]"}`}>
            <h1 className="font-display text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>}
            <div className="mt-7">{children}</div>
          </div>
        </div>
        <p className="flex items-center justify-center gap-2 text-xs text-muted lg:hidden">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
          {t.auth.platform.secure}
        </p>
      </main>
    </div>
  );
}
