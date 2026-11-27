"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { acknowledgeAll, LEVEL_COLOR, useAlertSummary, useClientId, type AlertLevel } from "@/lib/alerts";
import { useControls } from "@/lib/controls";
import { useI18n } from "@/lib/i18n";
import { Icon } from "@/components/icons";
import { AlertCard } from "./AlertCard";

const LEVELS: AlertLevel[] = ["Critical", "High", "Medium"];

/** Notification bell for the top bar: unread count, and a panel with this week's most urgent alerts. */
export function Bell() {
  const { t, f } = useI18n();
  const client = useClientId();
  const { origin } = useControls();
  const { data } = useAlertSummary(client, origin);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
  const fresh = data?.counts.new ?? 0;
  const urgent = (data?.latest ?? []).some((a) => a.status === "new" && a.level === "Critical");

  // close on navigation, outside click and Escape
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t.alerts.bellLabel(fresh)}
        className={`relative grid h-10 w-10 cursor-pointer place-items-center rounded-xl border transition ${
          urgent ? "border-critical/30 bg-card text-critical-ink hover:bg-critical/5" : "border-line bg-card text-ink hover:border-accent/50 hover:text-accent"
        }`}
      >
        <Icon name="bell" className="h-5 w-5" />
        {fresh > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-critical px-1 text-[10.5px] font-bold text-white ring-2 ring-white">
            {fresh > 99 ? "99+" : f.n(fresh)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.alerts.bell}
          className="panel fixed inset-x-3 top-[4.5rem] z-[1100] flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden shadow-[0_24px_48px_-20px_rgb(25_59_56/0.3)] sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-[26rem]"
        >
          <div className="border-b border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">{origin ? t.alerts.panelTitle(f.date(origin, true)) : t.alerts.bell}</h2>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{t.alerts.newCount(fresh)}</span>
            </div>
            {data && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LEVELS.map((lv) => (
                  <span key={lv} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR[lv] }} aria-hidden />
                    {t.alerts.level[lv]} <b className="tabular-nums">{f.n(data.counts.by_level[lv])}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {!data || !client ? (
              <p className="p-2 text-sm text-muted">{t.alerts.scanning}</p>
            ) : data.latest.length === 0 ? (
              <p className="p-2 text-sm text-muted">{data.scanning ? t.alerts.scanning : t.alerts.noneActive}</p>
            ) : (
              data.latest.slice(0, 8).map((a) => <AlertCard key={a.id} a={a} client={client} compact />)
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3">
            <button
              disabled={!fresh || !client}
              onClick={() => client && data && acknowledgeAll(client, data.latest.filter((a) => a.status === "new").map((a) => a.id))}
              className="btn px-3 py-1 text-xs text-muted"
            >
              {t.alerts.markAllRead}
            </button>
            <Link href="/alerts" className="btn btn-primary px-3 py-1 text-xs">
              {t.alerts.openPage} <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
