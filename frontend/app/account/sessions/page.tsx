"use client";
import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { useMySessions, when } from "@/lib/account";
import { Empty, PageHead } from "@/components/auth/parts";
import { useToast } from "@/components/auth/Providers";
import { Button, Notice, useErrorText } from "@/components/auth/ui";
import { Skeleton } from "@/components/ui";

export default function Sessions() {
  const { t, lang, f } = useI18n();
  const { logout } = useAuth();
  const { data, mutate } = useMySessions();
  const toast = useToast();
  const errText = useErrorText();
  const [busy, setBusy] = useState<number | "others" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = t.auth.sessions;

  const end = async (id: number, current: boolean) => {
    if (current) return logout();
    setBusy(id);
    setError(null);
    try {
      await sendJson(`/api/account/sessions/${id}`, undefined, "DELETE");
      await mutate();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        title={s.title}
        subtitle={s.subtitle}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="plain"
              busy={busy === "others"}
              onClick={async () => {
                setBusy("others");
                setError(null);
                try {
                  const r = await sendJson<{ ended: number }>("/api/account/sessions/revoke-all", { include_current: false });
                  await mutate();
                  toast(s.endedOthers(r.ended));
                } catch (err) {
                  setError(errText(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {s.signOutOthers}
            </Button>
            <Button type="button" variant="danger" onClick={() => logout({ everywhere: true })}>
              <LogOut className="h-4 w-4" aria-hidden />
              {s.signOutAll}
            </Button>
          </div>
        }
      />
      {error && <Notice tone="error" className="mb-4">{error}</Notice>}
      {!data ? (
        <Skeleton className="h-60" />
      ) : data.sessions.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.sessions.map((x) => (
            <li key={x.id} className={`panel p-4 ${x.current ? "border-accent/45 shadow-[0_0_0_1px_rgb(40_127_117/0.2)]" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-raise text-accent">
                    <MonitorSmartphone className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{x.device}</p>
                    <p className="font-mono text-xs text-muted">{x.ip ? f.digits(x.ip) : "—"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {x.current && <span className="rounded-full border border-accent/45 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{s.thisDevice}</span>}
                  {x.remember && <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{s.remembered}</span>}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {[[s.started, x.created_at], [s.lastActive, x.last_seen_at], [s.expires, x.expires_at]].map(([k, v]) => (
                  <div key={k}>
                    <dt className="kicker">{k}</dt>
                    <dd className="mt-0.5">{when(v, lang)}</dd>
                  </div>
                ))}
              </dl>
              <Button type="button" variant={x.current ? "danger" : "plain"} busy={busy === x.id} onClick={() => end(x.id, !!x.current)} className="mt-3 w-full">
                {s.signOut}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{s.empty}</Empty>
      )}
    </>
  );
}
