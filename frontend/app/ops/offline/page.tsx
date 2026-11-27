"use client";
import { useState } from "react";
import useSWR from "swr";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { runSelfTest, type SelfTest } from "@/lib/ops";
import { Card, ErrorNote } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useOnline } from "@/components/Shell";

const health = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<{ ok: boolean; rows: number; wards: number }>;
};

export default function Offline() {
  const { t, f } = useI18n();
  const { origin } = useControls();
  const online = useOnline();
  const { data: server, error: serverDown, isLoading } = useSWR("/api/health", health, { refreshInterval: 5000 });
  const [result, setResult] = useState<SelfTest | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await runSelfTest(origin));
    } catch (e) {
      setError(e as Error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h2 className="font-display text-2xl font-semibold">{t.ops.offTitle}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t.ops.offDesc}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatusTile icon={online ? "radar" : "wifiOff"} label={t.ops.browser} value={online ? t.ops.online : t.ops.offline} good />
        <StatusTile
          icon="data"
          label={t.ops.server}
          value={isLoading && !server ? t.ops.checking : serverDown ? t.ops.unreachable : t.ops.reachable}
          good={!serverDown}
          note={server ? `${f.int(server.rows)} · ${f.n(server.wards)}` : undefined}
        />
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-ink/80">{t.ops.runDesc}</p>
          <button onClick={run} disabled={running} className="btn btn-primary">
            <Icon name="wifiOff" /> {running ? t.ops.running : t.ops.run}
          </button>
        </div>
        {error && <ErrorNote error={error} />}
        {result && (
          <div className="space-y-3">
            <p className={`flex items-center gap-2 font-semibold ${result.ok ? "text-low" : "text-critical-ink"}`}>
              <Icon name={result.ok ? "check" : "alert"} className="h-5 w-5" />
              {result.ok ? t.ops.passed : t.ops.failed}
            </p>
            {result.network_blocked && (
              <p className="flex items-center gap-2 text-sm text-accent">
                <Icon name="wifiOff" /> {t.ops.netBlocked}
              </p>
            )}
            <ol className="space-y-2">
              {result.steps.map((s, i) => (
                <li key={s.step} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-line bg-raise px-3 py-2.5">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.ok ? "bg-low/20 text-low" : "bg-critical/20 text-critical-ink"}`}>
                    {s.ok ? <Icon name="check" className="h-3.5 w-3.5" /> : "!"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {f.n(i + 1)}. {t.ops.steps[s.step]}
                    </div>
                    <div className="mt-0.5 font-mono text-xs break-words text-muted">
                      {typeof s.detail === "string"
                        ? s.detail
                        : Object.entries(s.detail)
                            .map(([k, v]) => `${k}: ${f.digits(String(v))}`)
                            .join(" · ")}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-accent tabular-nums">{t.ops.ms(f.n(s.ms, 0))}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <Card>
          <h3 className="font-display text-xl font-semibold">{t.ops.worksTitle}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {t.ops.worksOffline.map((w) => (
              <li key={w} className="flex items-start gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 text-low" /> {w}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-3 text-sm text-ink/85">
          <p className="flex items-start gap-2">
            <Icon name="map" className="mt-0.5 h-4 w-4 text-medium" /> {t.ops.needsNet}
          </p>
          <p className="flex items-start gap-2">
            <Icon name="shield" className="mt-0.5 h-4 w-4 text-accent" /> {t.ops.noAI}
          </p>
        </Card>
      </div>
    </div>
  );
}

function StatusTile({ icon, label, value, good, note }: { icon: "radar" | "wifiOff" | "data"; label: string; value: string; good: boolean; note?: string }) {
  return (
    <section className="panel panel-edge flex items-center gap-4 p-4">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${good ? "border-low/40 bg-low/10 text-low" : "border-critical/40 bg-critical/10 text-critical-ink"}`}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <div className="kicker">{label}</div>
        <div className={`font-display text-lg font-semibold ${good ? "" : "text-critical-ink"}`}>{value}</div>
        {note && <div className="text-xs text-muted">{note}</div>}
      </div>
    </section>
  );
}
