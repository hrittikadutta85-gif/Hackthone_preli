"use client";
import { setLang, useI18n, type Lang } from "@/lib/i18n";

// The two options are written the same way in both languages, so either reader can find their own.
const OPTIONS: { lang: Lang; short: string; name: string }[] = [
  { lang: "en", short: "ENG", name: "English" },
  { lang: "bn", short: "BD", name: "বাংলা" },
];

export function LanguageSwitch() {
  const { lang, t } = useI18n();
  return (
    <div role="group" aria-label={t.shell.language} className="relative grid shrink-0 grid-cols-2 rounded-full border border-line bg-[rgb(5_11_20/0.65)] p-1">
      <span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-accent shadow-[0_0_18px_-4px_rgb(45_212_191/0.9)] transition-transform duration-300 ${
          lang === "bn" ? "translate-x-full" : ""
        }`}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          lang={o.lang}
          title={o.name}
          aria-label={o.name}
          aria-pressed={lang === o.lang}
          onClick={() => setLang(o.lang)}
          className={`relative cursor-pointer rounded-full px-3 py-1 font-mono text-xs font-medium transition-colors max-lg:min-w-12 max-lg:min-h-11 pointer-coarse:min-h-11 pointer-coarse:min-w-12 ${
            lang === o.lang ? "text-on-accent" : "text-muted hover:text-ink"
          }`}
        >
          {o.short}
        </button>
      ))}
    </div>
  );
}
