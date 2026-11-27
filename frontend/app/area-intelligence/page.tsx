"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Building2,
  CloudRain,
  Database,
  Droplets,
  ExternalLink,
  Gauge,
  HeartPulse,
  Hospital as HospitalIcon,
  Info,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Thermometer,
  Users,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n, useTitle } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useBeds, useDashboard, useSources, type BedStatus, type Dashboard, type Hospital, type Place } from "@/lib/area";
import { SearchBox, placeContext, placeName } from "@/components/area/SearchBox";
import { ErrorNote, Skeleton, TierPill } from "@/components/ui";

const AreaMap = dynamic(() => import("@/components/area/AreaMap"), { ssr: false, loading: () => <Skeleton className="h-80 sm:h-96" /> });

type BadgeKind = "dataset" | "historical" | "forecast" | "derived" | "verified" | "unverified" | "live" | "reported" | "stale" | "estimated" | "unavailable";
const BADGE_STYLE: Record<BadgeKind, string> = {
  dataset: "border-line text-muted",
  historical: "border-line text-muted",
  forecast: "border-[rgb(63_127_192/0.45)] text-[var(--forecast)]",
  derived: "border-medium/50 text-medium",
  verified: "border-low/50 text-low",
  unverified: "border-medium/50 text-medium",
  live: "border-low/60 bg-low/10 text-low",
  reported: "border-accent/50 text-accent",
  stale: "border-high/50 text-high",
  estimated: "border-medium/50 text-medium",
  unavailable: "border-line text-muted",
};

function Badge({ kind }: { kind: BadgeKind }) {
  const { t } = useI18n();
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-px text-[0.68rem] font-medium whitespace-nowrap ${BADGE_STYLE[kind]}`}>{t.area.badges[kind]}</span>;
}

function Section({ title, icon: Ic, badges, children, className = "" }: { title: string; icon: LucideIcon; badges?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel panel-edge rise min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
          <Ic className="h-5 w-5 text-accent" aria-hidden />
          {title}
        </h2>
        {badges && <div className="flex flex-wrap gap-1.5">{badges}</div>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, note, icon: Ic, badge, tone }: { label: string; value: ReactNode; note?: ReactNode; icon?: LucideIcon; badge?: BadgeKind; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-raise p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="kicker flex items-center gap-1.5">
          {Ic && <Ic className="h-3.5 w-3.5" aria-hidden />}
          {label}
        </p>
        {badge && <Badge kind={badge} />}
      </div>
      <p className={`font-display mt-1.5 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      {note && <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-dashed border-line px-4 py-4 text-sm text-muted">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ sections
function Overview({ d }: { d: Dashboard }) {
  const { t, lang, f } = useI18n();
  const o = d.overview;
  const a = t.area;
  const bn = lang === "bn";
  const cityName = bn ? o.city_corporation_name_bn || o.city_corporation_name : o.city_corporation_name;
  const rows: [string, ReactNode][] = [
    ...(o.kind !== "division" && o.district ? [[a.overview.district, bn ? o.district_bn || o.district : o.district] as [string, ReactNode]] : []),
    ...(o.division ? [[a.overview.division, bn ? o.division_bn || o.division : o.division] as [string, ReactNode]] : []),
    ...(cityName && o.kind !== "city_corporation" ? [[a.overview.cityCorp, cityName] as [string, ReactNode]] : []),
    ...(o.ward_number ? [[a.overview.ward, <span key="w">{f.digits(o.ward_number)} <span className="block text-xs text-muted">{a.overview.wardNote}</span></span>] as [string, ReactNode]] : []),
    [a.overview.population, <span key="p" className="text-sm text-muted">{a.overview.populationNone}</span>],
    [a.overview.density, d.environment.available ? <span key="d">{f.int(d.environment.population_density!)} <span className="text-xs text-muted">{a.env.perKm}</span></span> : <span key="d" className="text-sm text-muted">{a.badges.unavailable}</span>],
    [a.overview.hospitals, f.int(o.hospital_count)],
  ];
  const cov = o.coverage;
  const covCity = (cov.cities ?? []).map((c) => c).join(", ");
  const covText =
    cov.level === "ward" ? a.coverage.ward
      : cov.level === "city" ? a.coverage.city(cov.wards?.length ?? 0)
      : cov.level === "city_context" ? a.coverage.city_context(cityName ?? covCity, cov.wards?.length ?? 0)
      : cov.level === "district_partial" ? a.coverage.district_partial(covCity, cov.wards?.length ?? 0)
      : a.coverage.none;
  return (
    <Section title={a.overview.title} icon={MapPin}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-2xl leading-tight font-semibold sm:text-3xl">{placeName(o, lang)}</p>
          {o.display && <p className="mt-1 text-xs text-muted">{o.display}</p>}
        </div>
        <span className="rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{o.kind === "osm" ? a.onlineResults : a.kinds[o.kind]}</span>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="kicker">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      <div className={`mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${cov.level === "none" ? "border-high/45 bg-high/10" : cov.level === "ward" ? "border-accent/40 bg-accent-soft" : "border-medium/40 bg-medium/10"}`} role="note">
        {cov.level === "none" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-high" aria-hidden /> : <Database className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />}
        <div>
          <p>{covText}</p>
          {cov.nearest && <p className="mt-1 text-xs text-muted">{a.coverage.nearest(cov.nearest.city_corporation, f.n(cov.nearest.km, 1))}</p>}
        </div>
      </div>
      {o.point && (
        <p className="mt-3 text-xs text-muted">
          {a.overview.point}: <span className="font-mono">{f.latLon(o.point[0], o.point[1], 3)}</span>
          {o.source && <> · {o.source}</>}
        </p>
      )}
    </Section>
  );
}

function DengueSection({ d }: { d: Dashboard }) {
  const { t, f, b } = useI18n();
  const a = t.area;
  const g = d.dengue;
  if (!g.available) {
    return (
      <Section title={a.dengue.title} icon={Activity}>
        <Unavailable>{a.coverage.none}</Unavailable>
      </Section>
    );
  }
  const many = (g.wards_counted ?? 1) > 1;
  return (
    <Section title={a.dengue.title} icon={Activity} badges={<><Badge kind="historical" /><Badge kind="forecast" /></>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Stat label={a.dengue.current} value={a.dengue.cases(f.int(g.current!.cases))} note={<>{t.common.weekOf(f.date(g.current!.week, true))} · {a.dengue.last4(f.int(g.current!.last_4_weeks))}</>} badge="historical" />
        <Stat
          label={a.dengue.risk}
          value={<TierPill tier={g.risk_tier!} className="!text-sm" />}
          note={many ? <>{a.dengue.worstNote}: {(["Critical", "High", "Medium", "Low"] as const).filter((x) => g.horizons![1].tier_counts[x]).map((x) => `${a.dengue.wardsAt(g.horizons![1].tier_counts[x])} ${t.common.tier[x]}`).join(" · ")}</> : undefined}
          badge="forecast"
        />
        <div className="rounded-xl border border-line bg-raise p-3.5 sm:col-span-2 lg:col-span-1">
          <p className="kicker">{a.dengue.forecast}</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            {g.horizons!.map((h) => (
              <li key={h.h} className="rounded-lg border border-line/70 p-2">
                <p className="text-[0.7rem] text-muted">{a.dengue.week(h.h)}</p>
                <p className="font-display text-lg font-semibold">{f.n(h.predicted, 0)}</p>
                <p className="text-[0.68rem] text-muted">{a.dengue.range(f.n(h.lower, 0), f.n(h.upper, 0))}</p>
                <TierPill tier={h.tier} className="mt-1 !px-2 !text-[0.65rem]" />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <p className="kicker mb-2">{a.dengue.trend}</p>
        <div className="h-44 w-full" role="img" aria-label={a.dengue.trend}>
          <ResponsiveContainer>
            <AreaChart data={g.trend} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity={0.45} />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(x) => f.date(x)} tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => f.n(v)} width={44} />
              <Tooltip labelFormatter={(x) => t.common.weekOf(f.date(String(x), true))} formatter={(v) => [a.dengue.cases(f.int(Number(v))), ""]} />
              <Area dataKey="cases" stroke="var(--accent)" strokeWidth={2} fill="url(#trend-fill)" animationDuration={700} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {g.risk_factors ? (
          <div>
            <p className="kicker mb-2">{a.dengue.factors}</p>
            <ul className="space-y-1.5 text-sm">
              {g.risk_factors.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.effect_pct >= 0 ? "bg-high" : "bg-low"}`} aria-hidden />
                  {b(r.text)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          g.top_wards && (
            <div>
              <p className="kicker mb-2">{a.dengue.topWards}</p>
              <ul className="space-y-1.5 text-sm">
                {g.top_wards.map((w) => (
                  <li key={w.ward} className="flex items-center justify-between gap-2">
                    <Link href={`/ward/${w.ward}`} className="truncate text-accent hover:underline">{b(w.label)}</Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs">{f.n(w.predicted, 1)}</span>
                      <TierPill tier={w.tier} className="!px-2 !text-[0.65rem]" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
        <div>
          <p className="kicker mb-2">{a.dengue.actions}</p>
          <ul className="space-y-1.5 text-sm">
            {(g.actions ?? []).map((x, i) => (
              <li key={i} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                {b(x)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
        <p>{a.dengue.asOf(f.date(g.data_to!, true))} {a.dengue.staleData(f.date(g.data_to!, true))}</p>
        {g.interval_note === "summed" && <p>{a.dengue.summedNote}</p>}
      </div>
    </Section>
  );
}

function EnvironmentSection({ d }: { d: Dashboard }) {
  const { t, f } = useI18n();
  const a = t.area;
  const e = d.environment;
  if (!e.available) {
    return (
      <Section title={a.env.title} icon={Droplets}>
        <Unavailable>{a.env.none}</Unavailable>
      </Section>
    );
  }
  const many = (e.wards_counted ?? 1) > 1;
  const avg = many ? a.env.average(e.wards_counted!) : undefined;
  return (
    <Section title={a.env.title} icon={Droplets} badges={<><Badge kind="dataset" /><Badge kind="historical" /></>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={a.env.sanitation} icon={Gauge} value={f.n(e.sanitation_score!, 2)} note={<>{a.env.sanitationNote} {a.env.datasetRange(f.n(e.dataset_range!.sanitation[0], 2), f.n(e.dataset_range!.sanitation[1], 2))}{avg && <> · {avg}</>}</>} badge="dataset" />
        <Stat label={a.env.waterlogging} icon={Waves} value={f.n(e.waterlogging_index!, 2)} note={<>{a.env.waterloggingNote} {a.env.datasetRange(f.n(e.dataset_range!.waterlogging[0], 2), f.n(e.dataset_range!.waterlogging[1], 2))}</>} badge="dataset" />
        <Stat label={a.env.vulnerability} icon={AlertTriangle} value={`${f.n(e.vulnerability_index!, 0)}/${f.n(100)}`} note={a.env.vulnerabilityNote} badge="derived" tone={e.vulnerability_index! >= 66 ? "text-high" : e.vulnerability_index! >= 40 ? "text-medium" : ""} />
        <Stat label={a.env.density} icon={Users} value={f.int(e.population_density!)} note={<>{a.env.perKm}{avg && <> · {avg}</>}</>} badge="dataset" />
        <Stat label={a.env.rain} icon={CloudRain} value={a.env.rainWeek(f.n(e.rain_week_mm!, 0))} note={<>{a.env.rain4w(f.n(e.rain_4w_mm!, 0))} · {a.env.week(f.date(e.week!, true))}</>} badge="historical" />
        <Stat label={a.env.temp} icon={Thermometer} value={`${f.n(e.avg_temp_c!, 1)} °C`} note={a.env.week(f.date(e.week!, true))} badge="historical" />
        <Stat label={a.env.humidity} icon={Droplets} value={`${f.n(e.humidity_pct!, 0)}%`} note={a.env.week(f.date(e.week!, true))} badge="historical" />
        <Stat label={a.env.recent} icon={HeartPulse} value={f.int(e.recent_cases_4w!)} badge="historical" />
      </div>
      <div className="mt-3">
        <p className="kicker mb-1">{a.env.facilities}</p>
        <Unavailable>{a.env.facilitiesNone}</Unavailable>
      </div>
    </Section>
  );
}

function availabilityLine(h: Hospital, t: ReturnType<typeof useI18n>["t"], when: (iso: string) => string) {
  const av = h.availability;
  if (av.status === "unavailable") return <span className="text-muted">{t.area.hospitals.noAvailability}</span>;
  if (av.status === "stale") return <span className="text-high">{t.area.hospitals.staleReport(when(av.reported_at!))}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge kind={av.status === "live" ? "live" : "reported"} />
      {av.available_beds != null && <span className="font-semibold text-accent">{av.available_beds} {t.area.hospitals.available.toLowerCase()}</span>}
      {av.icu_available != null && <span className="text-muted">· {av.icu_available} ICU</span>}
      <span className="text-xs text-muted">· {t.area.hospitals.lastReported(when(av.reported_at!))}</span>
    </span>
  );
}

function HospitalsSection({ d }: { d: Dashboard }) {
  const { t, lang, f } = useI18n();
  const { can } = useAuth();
  const a = t.area;
  const h = d.hospitals;
  const s = h.summary;
  const [filters, setFilters] = useState({ government: false, private: false, emergency: false, available: false });
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const anyAvailability = s.availability.available_beds.value != null || s.availability.icu_available.value != null || s.availability.occupied_beds.value != null;
  const items = h.items.filter(
    (x) =>
      (!filters.government || x.type === "government") &&
      (!filters.private || x.type === "private") &&
      (!filters.emergency || x.has_emergency) &&
      (!filters.available || ((x.availability.status === "live" || x.availability.status === "reported") && (x.availability.available_beds ?? 0) > 0)),
  );
  const total = (v: { value: number | null; reported_by: number; of: number }) =>
    v.value == null ? <span className="text-base text-muted">{a.badges.unavailable}</span> : f.int(v.value);
  const by = (v: { value: number | null; reported_by: number; of: number }) => (v.value != null && v.reported_by < v.of ? a.hospitals.reportedBy(v.reported_by, v.of) : undefined);
  return (
    <>
      <Section title={a.hospitals.title} icon={HospitalIcon} className="lg:col-span-2" badges={s.total ? <Badge kind={s.verified === s.total ? "verified" : "unverified"} /> : undefined}>
        {!s.total ? (
          <div className="space-y-2">
            <Unavailable>
              {a.hospitals.none} {a.hospitals.noneHint}
            </Unavailable>
            {can("hospitals.manage") && (
              <Link href="/admin/hospitals" className="btn">
                {a.hospitals.manage}
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">{h.scope === "nearby" ? a.hospitals.scopeNearby(10) : a.hospitals.scopeArea}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={a.hospitals.total} icon={Building2} value={f.int(s.total)} note={`${a.hospitals.government} ${f.int(s.government)} · ${a.hospitals.private} ${f.int(s.private)}${s.other ? ` · ${a.hospitals.other} ${f.int(s.other)}` : ""}`} />
              <Stat label={a.hospitals.registered} icon={BedDouble} value={total(s.registered_beds)} note={by(s.registered_beds)} />
              <Stat label={a.hospitals.icu} icon={HeartPulse} value={total(s.icu_beds)} note={by(s.icu_beds)} />
              <Stat label={a.hospitals.emergencyYes} icon={Phone} value={f.int(s.with_emergency)} />
            </div>
            <div className="mt-3 rounded-xl border border-line p-3.5">
              {!anyAvailability ? (
                <p className="flex items-center gap-2 font-medium text-medium">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  {a.hospitals.liveUnavailable}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label={a.hospitals.available} value={total(s.availability.available_beds)} note={by(s.availability.available_beds)} badge={s.live ? "live" : "reported"} tone="text-accent" />
                  <Stat label={a.hospitals.occupied} value={total(s.availability.occupied_beds)} note={by(s.availability.occupied_beds)} badge={s.live ? "live" : "reported"} />
                  <Stat label={a.hospitals.icuAvailable} value={total(s.availability.icu_available)} note={by(s.availability.icu_available)} badge={s.live ? "live" : "reported"} />
                </div>
              )}
              {!s.live && anyAvailability && <p className="mt-2 text-xs text-medium">{a.hospitals.liveUnavailable}. {s.latest_report && a.hospitals.lastReported(when(s.latest_report))}</p>}
              <p className="mt-2 text-xs text-muted">{a.hospitals.capacityNote}</p>
            </div>
          </>
        )}
      </Section>

      <Section title={a.hospitals.map} icon={Navigation} className="lg:col-span-2">
        <AreaMap point={d.overview.point} cityPoint={d.overview.city_point} cityRadiusKm={d.overview.city_radius_km} hospitals={h.items} placeLabel={placeName(d.overview, lang)} />
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />{a.hospitals.mapLegendPlace}</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#3f7fc0]" aria-hidden />{a.hospitals.mapLegendHospital} ({a.hospitals.types.government})</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" aria-hidden />{a.hospitals.mapLegendHospital}</li>
          {d.overview.city_radius_km && <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-dashed border-accent" aria-hidden />{a.hospitals.mapLegendCity}</li>}
        </ul>
        {!d.overview.point && <p className="mt-1 text-xs text-muted">{a.hospitals.mapNoPoint}</p>}
        {h.items.length > 0 && (
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-semibold">{a.hospitals.list}</h3>
                <p className="text-xs text-muted">{a.beds.sorted}</p>
              </div>
              <div role="group" aria-label={a.hospitals.list} className="flex flex-wrap gap-1.5">
                {(Object.keys(filters) as (keyof typeof filters)[]).map((k) => (
                  <button key={k} type="button" aria-pressed={filters[k]} onClick={() => setFilters((x) => ({ ...x, [k]: !x[k] }))} className="btn !min-h-9 !py-1 text-xs">
                    {a.hospitals.filters[k]}
                  </button>
                ))}
              </div>
            </div>
            {items.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {items.map((x) => (
                  <li key={x.id} className="rounded-xl border border-line p-3.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{lang === "bn" && x.name_bn ? x.name_bn : x.name}</p>
                        <p className="text-xs text-muted">
                          {a.hospitals.types[x.type]}
                          {x.distance_km != null && <> · {a.hospitals.distance(f.n(x.distance_km, 1))}</>}
                        </p>
                      </div>
                      <Badge kind={x.verified ? "verified" : "unverified"} />
                    </div>
                    {x.address && <p className="mt-1.5 text-muted">{x.address}</p>}
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="kicker">{a.hospitals.registered}</dt>
                        <dd className="mt-0.5 text-sm">{x.registered_beds != null ? f.int(x.registered_beds) : a.badges.unavailable}</dd>
                      </div>
                      <div>
                        <dt className="kicker">{a.hospitals.icu}</dt>
                        <dd className="mt-0.5 text-sm">{x.icu_beds != null ? f.int(x.icu_beds) : a.badges.unavailable}</dd>
                      </div>
                    </dl>
                    <div className="mt-2 text-xs">{availabilityLine(x, t, when)}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {x.phone && (
                        <a href={`tel:${x.phone.replace(/[^\d+]/g, "")}`} className="btn !min-h-9 !py-1 text-xs">
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {x.phone}
                        </a>
                      )}
                      {x.emergency_phone && (
                        <a href={`tel:${x.emergency_phone.replace(/[^\d+]/g, "")}`} className="btn !min-h-9 border-critical/50 !py-1 text-xs text-critical-ink">
                          {a.hospitals.emergency}: {x.emergency_phone}
                        </a>
                      )}
                      {x.directions && (
                        <a href={x.directions} target="_blank" rel="noopener noreferrer" className="btn !min-h-9 !py-1 text-xs">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          {a.hospitals.directions}
                        </a>
                      )}
                    </div>
                    <p className="mt-2 text-[0.7rem] text-muted">
                      {a.hospitals.updated(when(x.updated_at))}
                      {x.source && <> · {x.source}</>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Unavailable>{a.hospitals.filterNone}</Unavailable>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

const BED_TONE: Record<BedStatus, { text: string; bar: string; chip: string }> = {
  enough: { text: "text-low", bar: "var(--low)", chip: "border-low/50 bg-low/10 text-low" },
  tight: { text: "text-medium", bar: "var(--medium)", chip: "border-medium/50 bg-medium/10 text-medium" },
  short: { text: "text-critical-ink", bar: "var(--critical)", chip: "border-critical/50 bg-critical/10 text-critical-ink" },
};

function BedChip({ status }: { status: BedStatus }) {
  const { t } = useI18n();
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${BED_TONE[status].chip}`} title={t.area.beds.statusHelp[status]}>{t.area.beds.status[status]}</span>;
}

/** Beds left: verified hospital reports first, then the planning model's estimate for the next 4 weeks. */
function BedsSection({ d, id }: { d: Dashboard; id: string }) {
  const { t, f, lang, b } = useI18n();
  const { can } = useAuth();
  const a = t.area;
  const B = a.beds;
  const [asOf, setAsOf] = useState<string | null>(null);
  const { data: alt, isLoading } = useBeds(id, asOf);
  const est = asOf && alt ? alt.estimate : d.beds;
  const rep = d.hospitals.summary;
  const free = rep.availability.available_beds;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const chart = est.available
    ? [
        ...est.history!.map((x) => ({ date: x.date, used: x.in_use })),
        ...est.weeks!.map((w) => ({ date: w.target_date, forecast: w.needed_expected, worst: w.needed_worst })),
      ]
    : [];
  const pct = est.available && est.capacity ? Math.min(100, Math.round((est.in_use! / est.capacity) * 100)) : 0;

  return (
    <Section title={B.title} icon={BedDouble} className="lg:col-span-2" badges={<><Badge kind={rep.live ? "live" : free.value != null ? "reported" : "unavailable"} /><Badge kind="estimated" /></>}>
      <p className="-mt-2 mb-4 text-sm text-muted">{B.lead}</p>

      {/* 1. what hospitals have reported (verified, recent) */}
      <div className="rounded-xl border border-line p-3.5">
        <p className="kicker mb-1.5">{B.reported}</p>
        {free.value != null ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-display text-3xl font-semibold text-accent">{B.reportedFree(f.int(free.value))}</p>
              <p className="text-xs text-muted">
                {B.reportedBy(free.reported_by, free.of)}
                {rep.latest_report && <> · {a.hospitals.lastReported(when(rep.latest_report))}</>}
              </p>
            </div>
            {rep.closest_with_beds && (
              <p className="max-w-md text-sm">
                <Navigation className="mr-1 inline h-4 w-4 text-accent" aria-hidden />
                {B.closest(rep.closest_with_beds.name, rep.closest_with_beds.distance_km != null ? f.n(rep.closest_with_beds.distance_km, 1) : "", f.int(rep.closest_with_beds.available_beds))}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-start gap-2 text-sm text-medium">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span><strong>{a.hospitals.liveUnavailable}.</strong> <span className="text-muted">{B.noneReported}</span></span>
            </p>
            {can("hospitals.manage") && <Link href="/admin/hospitals" className="btn !min-h-9 !py-1 text-xs">{B.manage}</Link>}
          </div>
        )}
      </div>

      {/* 2. the planning model's estimate */}
      {!est.available ? (
        <div className="mt-3">
          <Unavailable>{a.coverage.none}</Unavailable>
        </div>
      ) : (
        <div className={`mt-4 transition-opacity ${isLoading ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-display text-lg font-semibold">{B.estimate}</p>
              <p className="text-xs text-muted">{B.estimateNote}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="kicker">{B.weekOf}</span>
              <select value={asOf ?? est.week} onChange={(e) => setAsOf(e.target.value === d.beds.week ? null : e.target.value)} className="field h-10 cursor-pointer rounded-xl px-2 text-sm">
                {[...(est.choices ?? [])].reverse().map((c) => (
                  <option key={c} value={c}>
                    {f.date(c, true)}{c === d.beds.week ? ` (${B.latest})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-line bg-raise p-3.5 sm:col-span-1">
              <div className="flex items-start justify-between gap-2">
                <p className="kicker">{B.leftNow}</p>
                <BedChip status={est.status_now!} />
              </div>
              <p className={`font-display mt-1 text-4xl font-semibold ${BED_TONE[est.status_now!].text}`}>{f.int(est.left_now!)}</p>
              <p className="text-xs text-muted">{B.ofCapacity(f.int(est.capacity!))} · {t.common.weekOf(f.date(est.week!, true))}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}%`}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: BED_TONE[est.status_now!].bar }} />
              </div>
            </div>
            <Stat label={B.capacity} icon={BedDouble} value={f.int(est.capacity!)} note={est.wards_counted! > 1 ? B.totalOver(est.wards_counted!) : undefined} badge="estimated" />
            <Stat label={B.inUse} icon={HeartPulse} value={f.int(est.in_use!)} note={B.inUseNote} badge="historical" />
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {est.weeks!.map((w) => (
              <li key={w.h} className="rounded-xl border border-line p-3" title={B.statusHelp[w.status]}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-muted">{a.dengue.week(w.h)}<span className="block">{f.date(w.target_date)}</span></p>
                  <BedChip status={w.status} />
                </div>
                <p className={`font-display mt-1 text-2xl font-semibold ${w.left_expected < 0 ? "text-critical-ink" : ""}`}>
                  {f.int(w.left_expected)} <span className="text-xs font-normal text-muted">{B.left}</span>
                </p>
                <p className="text-[0.7rem] text-muted">{B.needed(f.int(w.needed_expected))} · {B.worst(f.int(w.left_worst))}</p>
                {w.wards_short > 0 && <p className="mt-1 text-[0.7rem] font-medium text-critical-ink">{B.wardsShort(w.wards_short)}</p>}
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <p className="kicker mb-2">{B.chart}</p>
            <div className="h-48 w-full" role="img" aria-label={B.chart}>
              <ResponsiveContainer>
                <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(x) => f.date(x)} tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => f.n(v)} width={44} allowDecimals={false} />
                  <Tooltip labelFormatter={(x) => t.common.weekOf(f.date(String(x), true))} formatter={(v, name) => [f.int(Number(v)), String(name)]} />
                  <ReferenceLine y={est.capacity} stroke="var(--critical)" strokeDasharray="5 4" label={{ value: B.chartCapacity, position: "insideTopRight", fontSize: 11, fill: "var(--critical-ink)" }} />
                  <Bar dataKey="used" name={B.chartUsed} fill="#b9c9c4" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="forecast" name={B.chartForecast} fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  <Line dataKey="worst" name={B.chartWorst} stroke="var(--high)" strokeDasharray="4 3" dot={{ r: 2.5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#b9c9c4]" aria-hidden />{B.chartUsed}</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-accent" aria-hidden />{B.chartForecast}</li>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-high" aria-hidden />{B.chartWorst}</li>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-critical" aria-hidden />{B.chartCapacity}</li>
            </ul>
          </div>

          {est.tightest && est.tightest.length > 1 && (
            <div className="mt-4">
              <p className="kicker mb-2">{B.tightest}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-sm">
                  <thead className="kicker border-b border-line">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{B.cols.ward}</th>
                      <th className="py-2 pr-3 font-medium">{B.cols.capacity}</th>
                      <th className="py-2 pr-3 font-medium">{B.cols.leftNow}</th>
                      <th className="py-2 font-medium">{B.cols.lowest}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {est.tightest.map((w) => (
                      <tr key={w.ward} className="border-b border-line/50 last:border-0">
                        <td className="py-2 pr-3"><Link href={`/ward/${w.ward}`} className="text-accent hover:underline">{b(w.label)}</Link></td>
                        <td className="py-2 pr-3 font-mono">{f.int(w.capacity)}</td>
                        <td className="py-2 pr-3 font-mono">{f.int(w.left_now)}</td>
                        <td className={`py-2 font-mono ${w.min_left_expected < 0 ? "text-critical-ink" : w.min_left_worst < 0 ? "text-medium" : ""}`}>
                          {f.int(w.min_left_expected)} <span className="text-xs text-muted">({f.int(w.min_left_worst)})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {est.city_spare_2w != null && <p className="mt-3 text-sm text-muted">{B.citySpare(f.int(est.city_spare_2w))}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="max-w-3xl text-xs text-muted">{B.method}</p>
            {can("ops.view") && <Link href="/ops/beds" className="btn !min-h-9 !py-1 text-xs">{B.planRouting}</Link>}
          </div>
        </div>
      )}
    </Section>
  );
}

function SourcesFooter() {
  const { t, f } = useI18n();
  const { data } = useSources();
  const a = t.area.sources;
  if (!data) return null;
  return (
    <section className="panel p-4 text-xs text-muted sm:p-5 lg:col-span-2">
      <h2 className="kicker mb-3">{a.title}</h2>
      <dl className="grid gap-3 md:grid-cols-3">
        <div>
          <dt className="font-semibold text-ink/90">{a.dengue}</dt>
          <dd className="mt-0.5">{data.dengue.source}. {a.dataTo(f.date(data.dengue.data_to, true))}.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink/90">{a.gazetteer}</dt>
          <dd className="mt-0.5">{data.gazetteer.source} {a.retrieved(f.date(data.gazetteer.retrieved, true))}. {data.gazetteer.note}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink/90">{a.hospitals}</dt>
          <dd className="mt-0.5">{data.hospitals.length ? data.hospitals.map((s) => s.name).join(", ") : a.noHospitalSources}</dd>
        </div>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ page
function AreaIntelligence() {
  const { t, lang } = useI18n();
  const a = t.area;
  useTitle(a.title);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = params.get("id");
  const { data, error, isLoading } = useDashboard(id);
  const initial = useMemo(() => (data ? placeName(data.overview, lang) : ""), [data, lang]);

  const select = (p: Place) => router.replace(`${path}?id=${encodeURIComponent(p.id)}`, { scroll: false });

  return (
    <div className="space-y-6">
      <header className="rise">
        <p className="eyebrow">{a.nav}</p>
        <h1 className="font-display mt-3 text-3xl font-semibold sm:text-4xl">{a.title}</h1>
        <p className="mt-2 max-w-3xl text-muted">{a.lead}</p>
        <div className="mt-5 max-w-3xl">
          <SearchBox key={initial} onSelect={select} initial={initial} />
        </div>
      </header>

      {!id && (
        <section className="panel panel-edge rise p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{a.emptyTitle}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {a.emptyPoints.map((x, i) => {
              const Ic = [Activity, Droplets, HospitalIcon][i];
              return (
                <li key={x} className="flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm">
                  <Ic className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  {x}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {id && isLoading && !data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      )}
      {id && error && <ErrorNote error={error} />}

      {data && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <BedsSection key={id} d={data} id={id!} />
          <Overview d={data} />
          <DengueSection d={data} />
          <div className="lg:col-span-2">
            <EnvironmentSection d={data} />
          </div>
          <HospitalsSection d={data} />
          <SourcesFooter />
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {a.disclaimer}
        {data && <span className="sr-only">{placeContext(data.overview, lang)}</span>}
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AreaIntelligence />
    </Suspense>
  );
}
