"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useControls } from "@/lib/controls";
import { useI18n, useTitle, type Dict } from "@/lib/i18n";
import { Segmented } from "./ui";
import { BrandMark, Icon, type IconName } from "./icons";
import { LanguageSwitch } from "./LanguageSwitch";

// Pages where the "week of" slider has no effect
const NO_WEEK = ["/predict", "/how-it-works"];

const NAV: { href: string; key: keyof Dict["shell"]["nav"]; icon: IconName; match?: string }[] = [
  { href: "/", key: "overview", icon: "overview" },
  { href: "/map", key: "map", icon: "map" },
  { href: "/plan", key: "plan", icon: "plan" },
  { href: "/ward/DSCC_Ward_05", key: "ward", icon: "ward", match: "/ward" },
  { href: "/predict", key: "predict", icon: "predict" },
  { href: "/accuracy", key: "accuracy", icon: "shield" },
  { href: "/how-it-works", key: "how", icon: "layers" },
];

const isActive = (n: (typeof NAV)[number], path: string) => (n.match ? path.startsWith(n.match) : path === n.href);

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { t, f } = useI18n();
  const { meta, origin, setOrigin, horizon, setHorizon } = useControls();
  const idx = meta && origin ? meta.origins.indexOf(origin) : 0;
  const inSample = meta && origin ? new Date(origin) <= new Date(meta.validation_end) : false;
  const showWeek = !NO_WEEK.includes(path);

  // Ward pages name themselves after the ward; every other page takes its menu label.
  const page = NAV.find((n) => isActive(n, path));
  useTitle(path.startsWith("/ward") ? null : page ? t.shell.nav[page.key] : t.shell.notFoundTitle);

  return (
    <>
      {/* On phones the header box dissolves, so only the brand bar stays stuck to the top. */}
      <header className="top-0 z-[1000] max-md:contents md:sticky md:px-4 md:pt-3 print:hidden">
        <div className="relative mx-auto max-w-6xl max-md:contents md:rounded-2xl md:border md:border-line md:bg-[rgb(10_20_35/0.76)] md:shadow-[0_20px_50px_-24px_rgb(0_0_0/0.9)] md:backdrop-blur-xl xl:max-w-7xl">
          {/* geometric edge light and a faint dot lattice */}
          <span aria-hidden className="absolute -top-px right-10 left-10 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent max-md:hidden" />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-60 max-md:hidden"
            style={{
              backgroundImage: "radial-gradient(rgb(110 220 205 / 0.18) 1px, transparent 1.2px)",
              backgroundSize: "14px 14px",
              maskImage: "linear-gradient(255deg, #000, transparent 28%)",
            }}
          />
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 max-md:sticky max-md:top-0 max-md:z-[1000] max-md:border-b max-md:border-line max-md:bg-[rgb(8_17_30/0.96)] max-md:pt-[calc(0.5rem+env(safe-area-inset-top,0px))] sm:px-4 md:py-2.5">
            <Link href="/" className="order-1 flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none">
              <BrandMark />
              <span className="min-w-0">
                <span className="font-display block text-lg leading-tight font-semibold">{t.common.brand}</span>
                <span className="kicker brand-tagline block max-[379px]:hidden">{t.shell.tagline}</span>
              </span>
            </Link>
            <div className="order-2 lg:ml-auto xl:order-3 xl:ml-0">
              <LanguageSwitch />
            </div>
            <MobileNav path={path} />
            <div className="order-3 hidden w-full min-w-0 justify-center lg:flex xl:order-2 xl:w-auto xl:flex-1">
              <NavBar path={path} />
            </div>
          </div>
          <div className="relative max-md:mx-3 max-md:mt-3 max-md:rounded-2xl max-md:border max-md:border-line max-md:bg-[rgb(10_20_35/0.76)] md:border-t md:border-line">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-3 py-2.5 sm:px-4">
              {showWeek && (
                <label className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-3 text-sm sm:flex-nowrap">
                  <span className="kicker order-1 whitespace-nowrap">{t.shell.weekLabel}</span>
                  <input
                    type="range"
                    className="order-3 w-full sm:order-2 sm:w-auto sm:min-w-24 sm:flex-1"
                    min={0}
                    max={meta ? meta.origins.length - 1 : 0}
                    value={Math.max(idx, 0)}
                    disabled={!meta}
                    aria-label={t.shell.weekAria}
                    aria-valuetext={origin ? f.date(origin, true) : undefined}
                    onChange={(e) => meta && setOrigin(meta.origins[Number(e.target.value)])}
                  />
                  <span className="order-2 ml-auto min-w-32 text-right font-mono text-[0.82rem] font-medium whitespace-nowrap text-accent tabular-nums sm:order-3 sm:ml-0 sm:text-left">
                    {origin ? f.date(origin, true) : "…"}
                  </span>
                </label>
              )}
              <div className="flex items-center gap-2 text-sm max-sm:w-full max-[339px]:flex-wrap sm:gap-3">
                <span className="kicker shrink-0">{t.shell.warnMe}</span>
                <Segmented
                  label={t.shell.windowAria}
                  value={horizon}
                  onChange={setHorizon}
                  className="max-sm:min-w-0 max-sm:flex-1 max-[339px]:order-last max-[339px]:!basis-full max-[339px]:[&>button]:min-w-0 max-[339px]:[&>button]:px-1 max-[339px]:[&>button]:text-xs max-[339px]:[&>button]:leading-tight max-[339px]:[&>button]:whitespace-normal"
                  options={[1, 2, 3, 4].map((h) => ({ value: h, label: t.shell.window(h) }))}
                />
                <span className="kicker shrink-0">{t.shell.ahead}</span>
              </div>
            </div>
            {inSample && showWeek && (
              <p className="flex items-start gap-2 px-4 pb-2.5 text-xs text-medium">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" />
                {t.shell.inSample}
              </p>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-6xl px-3 pb-10 sm:px-4 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
          <p className="max-w-2xl">{t.shell.footer}</p>
          {meta && (
            <p className="kicker flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden />
              {t.shell.dataTo(f.date(meta.last_data_date, true))}
            </p>
          )}
        </div>
      </footer>
    </>
  );
}

/** Main navigation on wide screens, with a teal highlight that glides to the active page. */
function NavBar({ path }: { path: string }) {
  const { t } = useI18n();
  const nav = useRef<HTMLElement>(null);
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector<HTMLElement>('[aria-current="page"]');
      setMark(a ? { x: a.offsetLeft, w: a.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure); // also catches language changes and web fonts changing widths
    observer.observe(el);
    el.querySelectorAll("a").forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [path]);

  return (
    <nav ref={nav} className="relative flex max-w-full gap-0.5 overflow-x-auto py-1 text-[13px] whitespace-nowrap [scrollbar-width:none]" aria-label={t.shell.navLabel}>
      {mark && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 rounded-lg border border-accent/45 bg-accent-soft shadow-[inset_0_-10px_18px_-12px_rgb(45_212_191/0.9)] transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ transform: `translateX(${mark.x}px)`, width: mark.w }}
        />
      )}
      {NAV.map((n) => {
        const active = isActive(n, path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-1.5 rounded-lg px-2 py-2 font-medium transition-colors ${
              active ? "text-accent" : "text-muted hover:bg-raise hover:text-ink"
            }`}
          >
            <Icon name={n.icon} className="h-[15px] w-[15px]" />
            {t.shell.nav[n.key]}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phones and tablets: a menu button left of the logo that opens a drawer from the left. It sits on the left because
 * browser extensions often pin floating badges to the top-right corner, where they hid the icon. The native dialog
 * traps focus and closes on Escape.
 */
function MobileNav({ path }: { path: string }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();

  useEffect(() => close(), [path]);
  // a drawer left open while the screen grows to desktop size would hide behind the full menu
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => wide.matches && close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="order-first lg:hidden">
      <button
        type="button"
        aria-label={t.shell.openMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
        className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl border border-line bg-raise text-ink hover:border-accent/60"
      >
        <Icon name="menu" className="h-6 w-6" />
      </button>
      <dialog ref={dialog} aria-label={t.shell.navLabel} className="drawer" onClose={() => setOpen(false)} onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="flex min-h-full flex-col gap-3 p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center justify-between gap-3">
            <span className="kicker">{t.shell.navLabel}</span>
            <button type="button" onClick={close} aria-label={t.shell.closeMenu} className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl border border-line text-muted hover:text-ink">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label={t.shell.navLabel} className="flex flex-col gap-1">
            {NAV.map((n) => {
              const active = isActive(n, path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 font-medium ${
                    active ? "border-accent/50 bg-accent-soft text-accent shadow-[inset_3px_0_0_var(--accent)]" : "border-transparent text-ink/85 hover:bg-raise"
                  }`}
                >
                  <Icon name={n.icon} className="h-5 w-5" />
                  {t.shell.nav[n.key]}
                </Link>
              );
            })}
          </nav>
        </div>
      </dialog>
    </div>
  );
}
