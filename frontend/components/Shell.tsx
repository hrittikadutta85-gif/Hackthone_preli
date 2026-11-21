"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useControls } from "@/lib/controls";
import { fmtDate } from "@/lib/api";
import { Segmented } from "./ui";

// Pages where the "week of" slider has no effect
const NO_WEEK = ["/predict", "/how-it-works"];

const NAV = [
  { href: "/", label: "City overview" },
  { href: "/map", label: "Risk map" },
  { href: "/plan", label: "Action plan" },
  { href: "/ward/DSCC_Ward_05", label: "Ward forecast", match: "/ward" },
  { href: "/predict", label: "Prediction portal" },
  { href: "/accuracy", label: "Can I trust it?" },
  { href: "/how-it-works", label: "How it works" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { meta, origin, setOrigin, horizon, setHorizon } = useControls();
  const idx = meta && origin ? meta.origins.indexOf(origin) : 0;
  const inSample = meta && origin ? new Date(origin) <= new Date(meta.validation_end) : false;

  return (
    <>
      <header className="sticky top-0 z-[1000] border-b print:hidden border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-lg text-white" aria-hidden>
              🦟
            </span>
            <span className="font-display text-xl font-semibold leading-none">Dengue Watch</span>
          </Link>
          <nav className="flex max-w-full gap-1 overflow-x-auto text-sm whitespace-nowrap" aria-label="Main">
            {NAV.map((n) => {
              const active = n.match ? path.startsWith(n.match) : path === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 font-medium transition ${
                    active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-line/70 bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
            {!NO_WEEK.includes(path) && (
            <label className="flex min-w-64 flex-1 items-center gap-3 text-sm">
              <span className="whitespace-nowrap text-muted">Looking at week of</span>
              <input
                type="range"
                className="min-w-24 flex-1"
                min={0}
                max={meta ? meta.origins.length - 1 : 0}
                value={Math.max(idx, 0)}
                disabled={!meta}
                aria-label="Week to forecast from"
                aria-valuetext={origin ? fmtDate(origin, true) : undefined}
                onChange={(e) => meta && setOrigin(meta.origins[Number(e.target.value)])}
              />
              <span className="w-28 whitespace-nowrap font-semibold tabular-nums">{origin ? fmtDate(origin, true) : "…"}</span>
            </label>
            )}
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted">Warn me</span>
              <Segmented
                label="Early-warning window"
                value={horizon}
                onChange={setHorizon}
                options={[1, 2, 3, 4].map((h) => ({ value: h, label: `${h} wk` }))}
              />
              <span className="text-muted">ahead</span>
            </div>
          </div>
          {inSample && !NO_WEEK.includes(path) && (
            <p className="mx-auto max-w-6xl px-4 pb-2 text-xs text-muted">
              Heads up: weeks up to 2024 were used to teach the model, so they flatter its accuracy. Slide into 2025 for a
              fair test.
            </p>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted print:hidden">
        Team CodeNova · Forecasts run entirely on this machine, with no paid APIs or AI services. Only the street-map
        background loads from OpenStreetMap.
      </footer>
    </>
  );
}
