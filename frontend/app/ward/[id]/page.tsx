"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWard, type WardForecast } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { useI18n, useTitle } from "@/lib/i18n";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill, tierGlow } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DriverBars, ForecastChart, WeatherChart } from "@/components/charts";
import { WhatIf } from "@/components/WhatIf";

export default function WardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, f, b } = useI18n();
  const { meta, origin, horizon, setHorizon } = useControls();
  const { data, error } = useWard(id, origin, horizon);
  useTitle(data ? b(data.label) : t.shell.nav.ward);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/" className="inline-flex items-center text-sm font-medium text-accent hover:underline tap">
          {t.ward.allWards}
        </Link>
        <div className="grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-3">
          <Link href={`/predict?ward=${id}`} className="btn">
            <Icon name="edit" /> {t.ward.enter}
          </Link>
          <button onClick={() => window.print()} disabled={!data} className="btn">
            <Icon name="print" /> {t.ward.print}
          </button>
          <label className="flex items-center gap-2 text-sm min-[480px]:col-span-2">
            <span className="shrink-0 text-muted">{t.ward.switch}</span>
            <select value={id} onChange={(e) => router.push(`/ward/${e.target.value}`)} className="field min-w-0 flex-1 rounded-full px-4 py-1.5 font-medium">
              {meta?.cities.map((c) => (
                <optgroup key={c} label={b(c)}>
                  {meta.wards.filter((w) => w.city === c).map((w) => (
                    <option key={w.id} value={w.id}>
                      {b(w.label).split(",")[0]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <ErrorNote error={error} />
      ) : !data || !meta ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <Header data={data} />
          <HorizonCards data={data} active={horizon} onPick={setHorizon} />
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <h2 className="font-display text-xl font-semibold">{t.ward.casesTitle}</h2>
              <p className="mb-3 text-sm text-muted">{t.ward.casesDesc}</p>
              <ForecastChart data={data} meta={meta} activeH={horizon} />
            </Card>
            <Card className="lg:col-span-2">
              <h2 className="font-display text-xl font-semibold">{t.ward.behindTitle(horizon)}</h2>
              <p className="mb-4 text-sm text-muted">{t.ward.behindDesc}</p>
              <DriverBars drivers={data.drivers[String(horizon)]} />
            </Card>
          </div>
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <h2 className="font-display text-xl font-semibold">{t.ward.weatherTitle}</h2>
              <p className="mb-3 text-sm text-muted">{t.ward.weatherDesc}</p>
              <WeatherChart weather={data.weather} />
            </Card>
            <Actions data={data} horizon={horizon} />
          </div>
          <div className="print:hidden">
            <WhatIf key={`${id}-${data.origin}`} ward={id} data={data} horizon={horizon} />
          </div>
          <p className="hidden text-xs text-muted print:block">{t.ward.printFooter(f.date(data.origin, true))}</p>
        </>
      )}
    </div>
  );
}

function Header({ data }: { data: WardForecast }) {
  const { t, b } = useI18n();
  const p = data.profile;
  const c = t.ward.chips;
  const chips = [
    p.density_vs_city > 0.15 ? c.crowdedMore : p.density_vs_city < -0.15 ? c.crowdedLess : c.crowdedTypical,
    p.waterlogging_vs_city > 0.05 ? c.waterProne : p.waterlogging_vs_city < -0.05 ? c.waterGood : c.waterTypical,
    p.sanitation_vs_city > 0.05 ? c.sanitationBetter : p.sanitation_vs_city < -0.05 ? c.sanitationWeaker : c.sanitationTypical,
  ];
  return (
    <div className="rise">
      <p className="eyebrow">{b(data.label)}</p>
      <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{b(data.headline)}</h1>
      <div className="mt-4 max-w-2xl space-y-2 text-base text-ink/80 sm:text-lg">
        {data.story.map((s, i) => (
          <p key={i}>{b(s)}</p>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full border border-line bg-raise px-3 py-1 text-xs text-muted">
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function HorizonCards({ data, active, onPick }: { data: WardForecast; active: number; onPick: (h: number) => void }) {
  const { t, f } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label={t.ward.pickWeek}>
      {data.horizons.map((r) => {
        const on = r.h === active;
        return (
          <button key={r.h} role="radio" aria-checked={on} onClick={() => onPick(r.h)} className="panel panel-hover min-w-0 cursor-pointer p-3 text-left sm:p-4" style={tierGlow(r.tier, on)}>
            <div className="flex flex-wrap items-center justify-between gap-1 text-sm">
              <span className="font-semibold">{t.common.weekName(r.h)}</span>
              <TierPill tier={r.tier} />
            </div>
            <div className="font-display mt-2 text-3xl font-semibold tabular-nums sm:text-4xl">
              <AnimatedNumber value={r.predicted} digits={1} />
            </div>
            <div className="text-xs text-muted">{t.ward.casesLikely(f.n(r.lower, 0), f.n(r.upper, 0))}</div>
            <div className="mt-1 text-xs text-muted">
              {t.common.weekOf(f.date(r.target_date))}
              {r.actual != null && <span className="font-medium text-ink"> · {t.ward.actually(f.n(r.actual))}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Actions({ data, horizon }: { data: WardForecast; horizon: number }) {
  const { t, b } = useI18n();
  const tier = data.horizons.find((h) => h.h === horizon)!.tier;
  const key = `done:${data.ward}:${data.origin}:${horizon}`;
  const [done, setDone] = useState<boolean[]>([]);

  useEffect(() => {
    let saved: boolean[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      /* storage unavailable */
    }
    setDone(data.actions.map((_, i) => !!saved[i]));
  }, [key, data.actions]);

  const toggle = (i: number) => {
    const next = data.actions.map((_, j) => (j === i ? !done[j] : !!done[j]));
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const n = done.filter(Boolean).length;

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{t.ward.actionsTitle}</h2>
        <TierPill tier={tier} />
      </div>
      <p className="mt-1 mb-4 text-sm text-muted">{t.ward.actionsDesc(tier)}</p>
      <ul className="space-y-2">
        {data.actions.map((a, i) => (
          <li key={a}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 transition hover:bg-raise">
              <input type="checkbox" checked={!!done[i]} onChange={() => toggle(i)} className="mt-1 h-5 w-5 shrink-0 accent-accent lg:h-4 lg:w-4" />
              <span className={done[i] ? "text-muted line-through" : ""}>{b(a)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(n / data.actions.length) * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {n === data.actions.length ? t.ward.allDone : t.ward.progress(n, data.actions.length)}
      </p>
    </Card>
  );
}
