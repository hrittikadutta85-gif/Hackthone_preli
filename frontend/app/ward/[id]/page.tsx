"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TIER_COLOR, fmtDate, useWard, type WardForecast } from "@/lib/api";
import { useControls } from "@/lib/controls";
import { AnimatedNumber, Card, ErrorNote, Skeleton, TierPill, useTitle } from "@/components/ui";
import { DriverBars, ForecastChart, WeatherChart } from "@/components/charts";
import { WhatIf } from "@/components/WhatIf";

export default function WardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { meta, origin, horizon, setHorizon } = useControls();
  const { data, error } = useWard(id, origin, horizon);
  useTitle(data?.label);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          ← All wards
        </Link>
        <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/predict?ward=${id}`}
          className="rounded-full border border-line bg-card px-4 py-1.5 text-sm font-medium transition hover:border-accent/50"
        >
          ✏️ Enter this week&apos;s numbers
        </Link>
        <button
          onClick={() => window.print()}
          disabled={!data}
          className="rounded-full border border-line bg-card px-4 py-1.5 text-sm font-medium transition hover:border-accent/50 disabled:opacity-40"
        >
          🖨 Print / save as PDF
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Switch ward</span>
          <select
            value={id}
            onChange={(e) => router.push(`/ward/${e.target.value}`)}
            className="rounded-full border border-line bg-card px-4 py-1.5 font-medium"
          >
            {meta?.cities.map((c) => (
              <optgroup key={c} label={c}>
                {meta.wards.filter((w) => w.city === c).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label.split(",")[0]}
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
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <h2 className="font-display text-xl font-semibold">Cases so far and where they&apos;re heading</h2>
              <p className="mb-3 text-sm text-muted">
                Grey bars are reported cases. The red line is the forecast with its likely range. Dark dots show what really
                happened, where we know it.
              </p>
              <ForecastChart data={data} meta={meta} activeH={horizon} />
            </Card>
            <Card className="lg:col-span-2">
              <h2 className="font-display text-xl font-semibold">What&apos;s behind the {horizon}-week forecast</h2>
              <p className="mb-4 text-sm text-muted">Compared with a typical week at this time of year, how many cases each factor adds or removes.</p>
              <DriverBars drivers={data.drivers[String(horizon)]} />
            </Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <h2 className="font-display text-xl font-semibold">Recent weather</h2>
              <p className="mb-3 text-sm text-muted">
                Rain that fell 2 to 4 weeks ago (the shaded stretch) matters most. Mosquito eggs need that long to become
                adults, and the virus needs a bit longer to show up as fever.
              </p>
              <WeatherChart weather={data.weather} />
            </Card>
            <Actions data={data} horizon={horizon} />
          </div>
          <div className="print:hidden">
            <WhatIf key={`${id}-${data.origin}`} ward={id} data={data} horizon={horizon} />
          </div>
          <p className="hidden text-xs text-muted print:block">
            Dengue Watch · Team CodeNova · forecast made with data up to the week of {fmtDate(data.origin, true)}. Expected
            cases are estimates with an 80% likely range, not guarantees.
          </p>
        </>
      )}
    </div>
  );
}

function Header({ data }: { data: WardForecast }) {
  const p = data.profile;
  const chips = [
    p.density_vs_city > 0.15 ? "More crowded than most wards nearby" : p.density_vs_city < -0.15 ? "Less crowded than most wards nearby" : "Typical crowding",
    p.waterlogging_vs_city > 0.05 ? "Prone to waterlogging" : p.waterlogging_vs_city < -0.05 ? "Drains well" : "Typical drainage",
    p.sanitation_vs_city > 0.05 ? "Better sanitation than nearby wards" : p.sanitation_vs_city < -0.05 ? "Weaker sanitation than nearby wards" : "Typical sanitation",
  ];
  return (
    <div className="rise">
      <p className="text-sm font-medium text-accent">{data.label}</p>
      <h1 className="font-display mt-1 max-w-3xl text-3xl leading-tight font-semibold sm:text-4xl">{data.headline}</h1>
      <div className="mt-4 max-w-2xl space-y-2 text-lg text-ink/80">
        {data.story.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-line bg-card px-3 py-1 text-xs text-muted">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function HorizonCards({ data, active, onPick }: { data: WardForecast; active: number; onPick: (h: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label="Pick a forecast week">
      {data.horizons.map((r) => {
        const on = r.h === active;
        return (
          <button
            key={r.h}
            role="radio"
            aria-checked={on}
            onClick={() => onPick(r.h)}
            className="rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            style={{ borderColor: on ? TIER_COLOR[r.tier] : "var(--line)", boxShadow: on ? `0 0 0 2px ${TIER_COLOR[r.tier]}` : undefined }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{r.h === 1 ? "Next week" : `In ${r.h} weeks`}</span>
              <TierPill tier={r.tier} />
            </div>
            <div className="font-display mt-2 text-4xl font-semibold tabular-nums">
              <AnimatedNumber value={r.predicted} digits={1} />
            </div>
            <div className="text-xs text-muted">
              cases · likely {r.lower.toFixed(0)}–{r.upper.toFixed(0)}
            </div>
            <div className="mt-1 text-xs text-muted">
              Week of {fmtDate(r.target_date)}
              {r.actual != null && <span className="font-medium text-ink"> · actually {r.actual}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Actions({ data, horizon }: { data: WardForecast; horizon: number }) {
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
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">What to do about it</h2>
        <TierPill tier={tier} />
      </div>
      <p className="mt-1 mb-4 text-sm text-muted">Suggested steps for a {tier.toLowerCase()}-risk week. Tick them off as your team goes.</p>
      <ul className="space-y-2">
        {data.actions.map((a, i) => (
          <li key={a}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 transition hover:bg-paper">
              <input type="checkbox" checked={!!done[i]} onChange={() => toggle(i)} className="mt-1 h-4 w-4 accent-[#0f6b5c]" />
              <span className={done[i] ? "text-muted line-through" : ""}>{a}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(n / data.actions.length) * 100}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {n === data.actions.length ? "All done. Nice work." : `${n} of ${data.actions.length} done`}
      </p>
    </Card>
  );
}
