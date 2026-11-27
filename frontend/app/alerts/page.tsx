"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { acknowledgeAll, disablePush, enablePush, pushState, sendTestPush, useAlerts, useClientId, type Alert, type AlertLevel, type PushState } from "@/lib/alerts";
import { useControls } from "@/lib/controls";
import { useI18n, type Dict } from "@/lib/i18n";
import { Card, ErrorNote, Skeleton } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { AlertCard } from "@/components/alerts/AlertCard";
import { MethodNote } from "@/components/ops/parts";

type Tab = keyof Dict["alerts"]["tabs"];
const TABS: { key: Tab; icon: IconName; pick: (a: Alert) => boolean }[] = [
  { key: "active", icon: "bell", pick: () => true },
  { key: "critical", icon: "alert", pick: (a) => a.level === "Critical" },
  { key: "high", icon: "activity", pick: (a) => a.level === "High" },
  { key: "weather", icon: "rain", pick: (a) => a.alert_type === "rainfall" },
  { key: "surge", icon: "predict", pick: (a) => a.alert_type === "case_surge" },
  { key: "history", icon: "clock", pick: () => true },
];
const LEVELS: AlertLevel[] = ["Critical", "High", "Medium"];

export default function AlertsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Alerts />
    </Suspense>
  );
}

function Alerts() {
  const { t, f, b } = useI18n();
  const client = useClientId();
  const { meta, origin, setOrigin } = useControls();
  const params = useSearchParams();
  const focusId = Number(params.get("id")) || null;
  const [tab, setTab] = useState<Tab>("active");
  const [city, setCity] = useState<string | null>(null);
  const [ward, setWard] = useState<string | null>(null);
  const [level, setLevel] = useState<AlertLevel | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // a push notification opens /alerts?week=...: jump to that week once
  const week = params.get("week");
  useEffect(() => {
    if (week && meta?.origins.includes(week)) setOrigin(week);
  }, [week, meta, setOrigin]);

  const filters = { city, ward, level, from: from || null, to: to || null };
  const active = useAlerts(client, origin, { scope: "active", ...filters });
  const history = useAlerts(tab === "history" ? client : null, origin, { scope: "history", ...filters });
  const current = tab === "history" ? history : active;
  const def = TABS.find((x) => x.key === tab)!;
  const rows = useMemo(() => (current.data?.alerts ?? []).filter(def.pick), [current.data, def]);
  const wards = (meta?.wards ?? []).filter((w) => !city || w.city === city);
  const fresh = rows.filter((a) => a.status === "new");

  const { data: cfg } = useSWR<{ thresholds: Record<string, number> }>("/api/alerts/config", (u: string) => fetch(u).then((r) => r.json()), { revalidateOnFocus: false });
  const c = cfg?.thresholds;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rise">
        <p className="eyebrow">{t.alerts.eyebrow(origin ? f.date(origin, true) : "…")}</p>
        <h1 className="font-display mt-1 max-w-3xl text-2xl leading-tight font-semibold sm:text-4xl">{t.alerts.headline}</h1>
        <p className="mt-3 max-w-3xl text-base text-ink/80 sm:text-lg">{t.alerts.intro}</p>
      </div>

      <PushCard client={client} />

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="kicker">{t.alerts.filters}</h2>
          <button
            onClick={() => {
              setCity(null);
              setWard(null);
              setLevel(null);
              setFrom("");
              setTo("");
            }}
            className="btn px-3 py-1 text-xs text-muted"
          >
            {t.alerts.clearFilters}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t.alerts.city}>
            <select value={city ?? ""} onChange={(e) => (setCity(e.target.value || null), setWard(null))} className="field">
              <option value="">{t.common.allCities}</option>
              {(meta?.cities ?? []).map((x) => (
                <option key={x} value={x}>
                  {b(x)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.alerts.ward}>
            <select value={ward ?? ""} onChange={(e) => setWard(e.target.value || null)} className="field">
              <option value="">{t.alerts.anyWard}</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {b(w.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.alerts.riskLevel}>
            <select value={level ?? ""} onChange={(e) => setLevel((e.target.value || null) as AlertLevel | null)} className="field">
              <option value="">{t.alerts.anyLevel}</option>
              {LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  {t.alerts.level[lv]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.alerts.from}>
            <input type="date" value={from} max={origin ?? undefined} onChange={(e) => setFrom(e.target.value)} className="field" />
          </Field>
          <Field label={t.alerts.to}>
            <input type="date" value={to} max={origin ?? undefined} onChange={(e) => setTo(e.target.value)} className="field" />
          </Field>
        </div>
      </Card>

      <nav aria-label={t.alerts.tabsLabel} className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {TABS.map((x) => {
          const n = x.key === "history" ? null : (active.data?.alerts ?? []).filter(x.pick).length;
          const on = tab === x.key;
          return (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              aria-pressed={on}
              className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                on ? "border-accent/60 bg-accent-soft text-accent shadow-[0_0_22px_-10px_var(--accent)]" : "border-line bg-raise text-ink/80 hover:border-accent/40"
              }`}
            >
              <Icon name={x.icon} />
              {t.alerts.tabs[x.key]}
              {n != null && <span className={`rounded-md px-1.5 font-mono text-[11px] ${on ? "bg-accent text-on-accent" : "bg-line text-muted"}`}>{f.n(n)}</span>}
            </button>
          );
        })}
      </nav>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold">{t.alerts.tabs[tab]}</h2>
            <p className="mt-1 text-sm text-muted">{t.alerts.tabNote[tab]}</p>
            {current.data && <p className="mt-1 text-xs text-muted">{t.alerts.counts(rows.length, fresh.length)}</p>}
          </div>
          <button disabled={!fresh.length || !client} onClick={() => client && acknowledgeAll(client, fresh.map((a) => a.id))} className="btn text-sm">
            <Icon name="check" /> {t.alerts.ackShown}
          </button>
        </div>
        {current.error ? (
          <div className="mt-4">
            <ErrorNote error={current.error} />
          </div>
        ) : !current.data || !client ? (
          <Skeleton className="mt-4 h-64" />
        ) : rows.length === 0 ? (
          <p className="mt-4 text-muted">{current.data.scanning ? t.alerts.scanning : t.alerts.empty}</p>
        ) : (
          <div className={`mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 transition-opacity ${current.isValidating && !current.data ? "opacity-60" : ""}`}>
            {rows.map((a) => (
              <AlertCard key={a.id} a={a} client={client} highlight={a.id === focusId} />
            ))}
          </div>
        )}
      </Card>

      {c && (
        <MethodNote
          title={t.alerts.how}
          items={t.alerts.rules({
            h: c.ALERT_HORIZON, pct: c.ALERT_SURGE_PCT, min: c.ALERT_SURGE_MIN_CASES, pctile: c.ALERT_RAIN_PERCENTILE,
            abs: c.ALERT_RAIN_ABS_MM, floor: c.ALERT_RAIN_MIN_MM, cool: c.ALERT_COOLDOWN_WEEKS,
          })}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function PushCard({ client }: { client: string | null }) {
  const { t, lang } = useI18n();
  const { origin } = useControls();
  const { data: initial, mutate } = useSWR("push-state", pushState, { revalidateOnFocus: true });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const state: PushState = initial ?? "unknown";

  const act = async (fn: () => Promise<PushState | string>) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      if (r === "on" || r === "off" || r === "denied" || r === "unsupported" || r === "unconfigured") await mutate(r as PushState, { revalidate: false });
      else setNote(r);
    } catch (e) {
      setNote(`${t.alerts.push.failed} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const message =
    state === "on" ? t.alerts.push.on : state === "unsupported" ? t.alerts.push.unsupported : state === "unconfigured" ? t.alerts.push.unconfigured : state === "denied" ? t.alerts.push.denied : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 max-w-2xl items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${state === "on" ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-raise text-muted"}`}>
          <Icon name="bell" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold">{t.alerts.push.title}</h2>
          <p className="text-sm text-muted">{t.alerts.push.desc}</p>
          {message && <p className={`mt-1 text-sm ${state === "on" ? "text-accent" : "text-medium"}`}>{message}</p>}
          {note && <p className="mt-1 text-sm text-ink/85">{note}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(state === "off" || state === "unknown") && (
          <button disabled={busy || !client} onClick={() => act(() => enablePush(client!, lang))} className="btn btn-primary">
            <Icon name="bell" /> {busy ? t.alerts.push.busy : t.alerts.push.enable}
          </button>
        )}
        {state === "on" && (
          <>
            <button disabled={busy || !client} onClick={() => act(async () => t.alerts.push.testSent((await sendTestPush(client!, origin)).delivered))} className="btn">
              {busy ? t.alerts.push.busy : t.alerts.push.test}
            </button>
            <button disabled={busy} onClick={() => act(disablePush)} className="btn text-muted">
              {t.alerts.push.disable}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
