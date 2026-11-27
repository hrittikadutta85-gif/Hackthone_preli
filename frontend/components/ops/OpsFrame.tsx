"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { addDays } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n, type Dict } from "@/lib/i18n";
import { OpsProvider, RESOURCES, useOps, useOpsPlan, type OpsPlan } from "@/lib/ops";
import { Card, Segmented } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { Slider } from "./parts";

const TABS: { href: string; key: keyof Dict["ops"]["tabs"]; icon: IconName }[] = [
  { href: "/ops", key: "supplies", icon: "box" },
  { href: "/ops/beds", key: "beds", icon: "bed" },
  { href: "/ops/vector", key: "vector", icon: "spray" },
  { href: "/ops/dispatch", key: "dispatch", icon: "message" },
  { href: "/ops/offline", key: "offline", icon: "wifiOff" },
];

export function OpsFrame({ children }: { children: ReactNode }) {
  return (
    <OpsProvider>
      <Frame>{children}</Frame>
    </OpsProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { t, f } = useI18n();
  const { origin, horizon } = useControls();
  const { query } = useOps();
  const { data: plan } = useOpsPlan(query);
  const target = origin ? addDays(origin, 7 * horizon) : null;
  const withSettings = path !== "/ops/offline";

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.ops.eyebrow(target ? f.date(target, true) : "…")}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.ops.title}</h1>
        <p className="mt-3 max-w-3xl text-base text-ink/80 sm:text-lg">{t.ops.intro}</p>
      </div>

      <nav aria-label={t.ops.tabsLabel} className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 print:hidden">
        {TABS.map((tab, i) => {
          const active = path === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                active ? "border-accent/60 bg-accent-soft text-accent shadow-[0_0_22px_-10px_var(--accent)]" : "border-line bg-raise text-ink/80 hover:border-accent/40 hover:text-ink"
              }`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-md font-mono text-[11px] ${active ? "bg-accent text-on-accent" : "bg-line text-muted"}`}>{f.n(i + 1)}</span>
              <Icon name={tab.icon} />
              {t.ops.tabs[tab.key]}
            </Link>
          );
        })}
      </nav>

      {withSettings && <Settings />}
      {withSettings && plan && <AlertStrip plan={plan} />}
      {children}
    </div>
  );
}

function Settings() {
  const { t, f, b } = useI18n();
  const { meta } = useControls();
  const { settings: s, set, reset } = useOps();
  const pct = (v: number) => f.n(`${v}%`);

  return (
    <Card className="space-y-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="kicker">{t.ops.settings}</h2>
        <button onClick={reset} className="btn text-xs text-muted">
          {t.ops.reset}
        </button>
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-3">
          <Slider
            label={t.ops.stock}
            value={s.stock}
            min={30}
            max={100}
            step={5}
            onChange={(v) => set({ stock: v, saline: v, kits: v, beds: v })}
            format={pct}
            note={t.ops.stockNote}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/85">
            <input type="checkbox" checked={s.split} onChange={(e) => set({ split: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
            {t.ops.split}
          </label>
          {s.split && (
            <div className="space-y-3 rounded-xl border border-line p-3">
              {RESOURCES.map((r) => (
                <Slider key={r} label={t.ops.res[r]} value={s[r]} min={30} max={100} step={5} onChange={(v) => set({ [r]: v })} format={pct} />
              ))}
            </div>
          )}
        </div>
        <Slider label={t.ops.crews} value={s.crews} min={0} max={80} onChange={(v) => set({ crews: v })} format={(v) => f.n(v)} note={t.ops.crewsNote} />
        <div>
          <div className="mb-2 text-sm font-medium">{t.ops.basis}</div>
          <Segmented
            label={t.ops.basis}
            value={s.basis}
            onChange={(v) => set({ basis: v })}
            options={[
              { value: "expected", label: t.ops.basisExpected },
              { value: "upper", label: t.ops.basisUpper },
            ]}
            className="w-full"
          />
          <p className="mt-2 text-xs text-muted">{t.ops.basisNote[s.basis]}</p>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">{t.ops.area}</div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.common.cityGroup}>
            {[null, ...(meta?.cities ?? [])].map((c) => (
              <button key={c ?? "all"} onClick={() => set({ city: c })} aria-pressed={s.city === c} className="btn px-3 py-1 text-xs aria-[pressed=false]:text-muted">
                {c ? b(c) : t.common.allCities}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Live warning line: changes the moment a slider moves. */
function AlertStrip({ plan }: { plan: OpsPlan }) {
  const { t } = useI18n();
  const { critical, deficit } = plan.alerts;
  if (!critical && !deficit) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-low/40 bg-low/10 px-4 py-2.5 text-sm font-medium text-low">
        <Icon name="check" /> {t.ops.alertNone}
      </p>
    );
  }
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-critical/45 bg-critical/10 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 font-semibold text-critical-ink">
        <Icon name="alert" className="halo h-4 w-4" /> {t.ops.alertCritical(critical)}
      </span>
      {deficit > 0 && <span className="text-muted">· {t.ops.alertDeficit(deficit)}</span>}
    </p>
  );
}
