"use client";
import Link from "next/link";
import { TIER_COLOR, TIERS, usePerformance } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

// in the same order as `how.steps` and `how.timeline` in the dictionaries
const STEP_ICONS: IconName[] = ["data", "filter", "clock", "predict", "compass"];
const TIMELINE_ICONS: IconName[] = ["rain", "incubate", "activity", "hospital"];

// product names are the same in every language
const STACK = {
  frontend: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS", "Recharts", "Leaflet + OpenStreetMap"],
  backend: ["FastAPI", "Uvicorn", "Pydantic", "pandas", "NumPy"],
  ml: ["LightGBM", "scikit-learn (Poisson GLM)", "joblib"],
} as const;

export default function HowItWorks() {
  const { t, f, b } = useI18n();
  const { meta, horizon } = useControls();
  const { data: perf } = usePerformance("DSCC_Ward_05", horizon);

  return (
    <div className="space-y-6 sm:space-y-10">
      <div className="rise">
        <p className="eyebrow">{t.how.eyebrow}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.how.title}</h1>
        <p className="mt-3 max-w-2xl text-base text-ink/80 sm:text-lg">{t.how.intro}</p>
      </div>

      {/* why the delay */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">{t.how.delayTitle}</h2>
        <ol className="mt-5 grid gap-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {t.how.timeline.map((step, i) => (
            <li key={step.week} className="relative rounded-xl border border-line bg-raise p-4">
              <div className="grid h-10 w-10 place-items-center rounded-lg border border-accent/35 bg-accent-soft text-accent">
                <Icon name={TIMELINE_ICONS[i]} className="h-5 w-5" />
              </div>
              <div className="mt-3 font-mono text-xs font-medium tracking-wider text-accent uppercase">{step.week}</div>
              <p className="mt-1 text-sm">{step.text}</p>
              {i < t.how.timeline.length - 1 && (
                <>
                  {/* the connector runs sideways on wide screens and downwards when the steps are stacked */}
                  <svg className="absolute top-1/2 -right-4 hidden h-2 w-4 -translate-y-1/2 lg:block" viewBox="0 0 16 8" aria-hidden>
                    <line className="flow" x1="0" y1="4" x2="16" y2="4" stroke="var(--accent)" strokeWidth="2" />
                  </svg>
                  <svg className="absolute -bottom-5 left-9 h-5 w-2 sm:hidden" viewBox="0 0 8 20" aria-hidden>
                    <line className="flow" x1="4" y1="0" x2="4" y2="20" stroke="var(--accent)" strokeWidth="2" />
                  </svg>
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">{t.how.delayNote}</p>
      </Card>

      {/* the five steps */}
      <section>
        <h2 className="font-display text-2xl font-semibold">{t.how.stepsTitle}</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {t.how.steps.map((step, i) => (
            <li key={step.title} className="rise panel panel-edge min-w-0 p-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-bold text-on-accent shadow-[0_0_14px_-3px_rgb(45_212_191/0.9)]">{f.n(i + 1)}</span>
                <Icon name={STEP_ICONS[i]} className="h-5 w-5 text-accent" />
              </div>
              <h3 className="mt-2 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* data split */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">{t.how.splitTitle}</h2>
        <p className="mt-1 max-w-2xl text-muted">{t.how.splitDesc}</p>
        <div className="mt-5 flex flex-col gap-0.5 overflow-hidden rounded-xl text-center text-sm font-semibold sm:flex-row" role="img" aria-label={t.how.splitLabel}>
          <div className="flex min-h-14 items-center justify-center bg-[#13605a] px-2 py-2 sm:flex-[8]">{t.how.learn}</div>
          <div className="flex min-h-12 items-center justify-center bg-[#2b6390] px-2 py-2 sm:min-h-14 sm:flex-[1.4]">{t.how.tune}</div>
          <div className="flex min-h-12 items-center justify-center bg-accent px-2 py-2 text-on-accent sm:min-h-14 sm:flex-[1.4]">{t.how.test}</div>
        </div>
        <p className="mt-3 text-sm text-muted">{t.how.splitNote}</p>
      </Card>

      {/* model + results */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-2xl font-semibold">{t.how.modelTitle}</h2>
          <ul className="mt-3 space-y-3 text-ink/85 [&_b]:text-ink">
            {t.how.modelPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
          {meta && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIERS.map((tier) => (
                <div key={tier} className="min-w-0 rounded-xl border p-3" style={{ borderColor: TIER_COLOR[tier], background: `color-mix(in srgb, ${TIER_COLOR[tier]} 14%, transparent)` }}>
                  <div className="text-sm font-semibold">{t.common.tier[tier]}</div>
                  <div className="text-xs opacity-90">{b(meta.tier_help[tier])}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="font-display text-2xl font-semibold">{t.how.resultsTitle}</h2>
          {perf ? (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left align-bottom text-xs text-muted">
                    <th className="pr-2 pb-2 font-medium">{t.how.colWindow}</th>
                    <th className="pr-2 pb-2 font-medium">{t.how.colMiss}</th>
                    <th className="pr-2 pb-2 font-medium">{t.how.colBetter}</th>
                    <th className="pb-2 font-medium">{t.how.colLevel}</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.summary.map((r) => (
                    <tr key={r.h} className={`border-t border-line ${r.h === horizon ? "font-semibold" : ""}`}>
                      <td className="py-2 pr-2">{t.how.weeks(r.h)}</td>
                      <td className="py-2 pr-2 tabular-nums">{t.how.miss(f.n(r.mae, 1))}</td>
                      <td className="py-2 pr-2 tabular-nums">{f.digits(`${r.improvement_pct.toFixed(0)}%`)}</td>
                      <td className="py-2 tabular-nums">{f.digits(`${Math.round(r.tier_accuracy * 100)}%`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="skeleton mt-3 h-40 rounded-xl" />
          )}
          <p className="mt-3 text-sm text-muted">
            {t.how.honest}{" "}
            <Link href="/accuracy" className="font-medium text-accent hover:underline max-lg:inline-block max-lg:py-2">
              {t.how.fullTest}
            </Link>
          </p>
        </Card>
      </div>

      {/* architecture */}
      <Card>
        <h2 className="font-display text-2xl font-semibold">{t.how.systemTitle}</h2>
        <div className="mt-5 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1.4fr_auto_1.2fr]">
          <Block title={t.how.dataTitle} tone="bg-raise" items={t.how.dataItems} />
          <Arrow />
          <Block title={t.how.backendTitle} tone="bg-accent-soft !border-accent/45" items={t.how.backendItems} />
          <Arrow />
          <Block title={t.how.frontendTitle} tone="bg-raise" items={t.how.frontendItems} />
        </div>
        <p className="mt-4 text-sm text-muted">{t.how.systemNote(<code className="rounded bg-line px-1">/api</code>)}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {(Object.keys(STACK) as (keyof typeof STACK)[]).map((group) => (
            <div key={group}>
              <h3 className="text-sm font-semibold">{t.how.stack[group]}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STACK[group].map((name) => (
                  <span key={name} lang="en" className="rounded-full border border-line bg-raise px-2.5 py-1 text-xs">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl font-semibold">{t.how.limitsTitle}</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink/85 marker:text-accent">
          {t.how.limits.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t.how.builtBy}</p>
      </Card>
    </div>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-line p-4 ${tone}`}>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-ink/80">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Arrow() {
  return (
    <div className="grid place-items-center" aria-hidden>
      <svg className="hidden h-3 w-10 lg:block" viewBox="0 0 40 12">
        <line className="flow" x1="2" y1="6" x2="32" y2="6" stroke="var(--accent)" strokeWidth="2" />
        <path d="M31 2 37 6 31 10" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      </svg>
      <svg className="h-8 w-3 lg:hidden" viewBox="0 0 12 32">
        <line className="flow" x1="6" y1="2" x2="6" y2="24" stroke="var(--accent)" strokeWidth="2" />
        <path d="M2 23 6 29 10 23" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      </svg>
    </div>
  );
}
