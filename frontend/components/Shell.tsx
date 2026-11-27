"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useControls } from "@/lib/controls";
import { useI18n, useTitle, type Dict } from "@/lib/i18n";
import { Segmented } from "./ui";
import { BrandMark, Icon, type IconName } from "./icons";
import { LanguageSwitch } from "./LanguageSwitch";
import { Bell } from "./alerts/Bell";
import { UserMenu } from "./auth/UserMenu";
import { permissionFor, useAuth } from "@/lib/auth";

// Pages where the "week of" slider has no effect
const NO_WEEK = ["/predict", "/how-it-works"];
// Account and administration pages have no forecast controls at all
const noControls = (path: string) => path.startsWith("/account") || path.startsWith("/admin") || path.startsWith("/area-intelligence");

const NAV: { href: string; key: keyof Dict["shell"]["nav"]; icon: IconName; match?: string }[] = [
  { href: "/", key: "overview", icon: "overview" },
  { href: "/map", key: "map", icon: "map" },
  { href: "/#forecast", key: "forecast", icon: "activity" }, // the forecast chart on the dashboard
  { href: "/plan", key: "plan", icon: "plan" },
  { href: "/ops", key: "ops", icon: "ops", match: "/ops" },
  { href: "/ward/DSCC_Ward_05", key: "ward", icon: "ward", match: "/ward" },
  { href: "/area-intelligence", key: "area", icon: "compass" },
  { href: "/predict", key: "predict", icon: "predict" },
  { href: "/accuracy", key: "accuracy", icon: "shield" },
  { href: "/how-it-works", key: "how", icon: "layers" },
];

const isActive = (n: (typeof NAV)[number], path: string) => (n.match ? path.startsWith(n.match) : path === n.href);

/** Menu items this user's role can open (the API enforces the same rules). */
function useNav() {
  const { user } = useAuth();
  const ownWard = user?.role === "field" ? user.assigned_wards[0] : null; // field officers open their own ward
  return NAV.filter((n) => {
    const perm = permissionFor(n.href.split("#")[0]);
    return !perm || !!user?.permissions.includes(perm);
  }).map((n) => (n.key === "ward" && ownWard ? { ...n, href: `/ward/${ownWard}` } : n));
}

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <BrandMark className={compact ? "h-9 w-9" : "h-10 w-10"} />
      {/* narrow phones keep only the mark; the name stays available to screen readers */}
      <span className={`min-w-0 ${compact ? "max-[459px]:sr-only" : ""}`}>
        <span className="font-display block text-[1.05rem] leading-tight font-semibold whitespace-nowrap text-ink">{t.common.brand}</span>
        <span className="kicker brand-tagline block whitespace-nowrap">{t.shell.tagline}</span>
      </span>
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { t, f } = useI18n();
  const { meta, origin, setOrigin, horizon, setHorizon } = useControls();
  const idx = meta && origin ? meta.origins.indexOf(origin) : 0;
  const inSample = meta && origin ? new Date(origin) <= new Date(meta.validation_end) : false;
  const showWeek = !NO_WEEK.includes(path);
  const showControls = !noControls(path);

  // Ward, account and admin pages name themselves; every other page takes its menu label.
  const page = NAV.find((n) => isActive(n, path));
  useTitle(path.startsWith("/ward") || noControls(path) ? null : path.startsWith("/alerts") ? t.alerts.title : page ? t.shell.nav[page.key] : t.shell.notFoundTitle);
  const online = useOnline();

  return (
    <>
      {/* wide screens: a fixed sidebar with the brand and the main menu */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-[1001] hidden w-64 flex-col border-r border-line bg-card lg:flex print:hidden">
        <div className="px-5 pt-5 pb-4">
          <Brand />
        </div>
        <SideNav path={path} />
        {meta && (
          <div className="m-3 rounded-xl border border-line bg-accent-soft/60 p-3">
            <p className="kicker flex items-center gap-2 !text-accent">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              {t.shell.tagline}
            </p>
            <p className="mt-1 text-xs leading-snug text-muted">{t.shell.dataTo(f.date(meta.last_data_date, true))}</p>
          </div>
        )}
      </aside>

      <div className="app-content lg:pl-64">
        <header className="sticky top-0 z-[1000] border-b border-line bg-card/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md print:hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
            <MobileNav path={path} />
            <div className="min-w-0 flex-1 lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="font-display truncate text-lg leading-tight font-semibold">{page ? t.shell.nav[page.key] : t.common.brand}</p>
              <Clock />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Bell />
              <LanguageSwitch />
              <UserMenu />
            </div>
          </div>
        </header>

        {showControls && (
          <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-6 print:hidden">
            <div className="panel">
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
                    <span className="order-2 ml-auto min-w-32 rounded-lg bg-accent-soft px-2 py-0.5 text-right text-[0.82rem] font-semibold whitespace-nowrap text-accent tabular-nums sm:order-3 sm:ml-0 sm:text-center">
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
                <p className="flex items-start gap-2 border-t border-line px-4 py-2 text-xs text-medium">
                  <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" />
                  {t.shell.inSample}
                </p>
              )}
              {!online && (
                <p role="status" className="flex items-start gap-2 border-t border-line px-4 py-2 text-xs font-medium text-accent">
                  <Icon name="wifiOff" className="mt-0.5 h-3.5 w-3.5" />
                  {t.shell.offlineBanner}
                </p>
              )}
            </div>
          </div>
        )}

        <main className="mx-auto max-w-7xl px-3 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-3 pb-10 sm:px-6 print:hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
            <p className="max-w-2xl">{t.shell.footer}</p>
            {meta && (
              <p className="kicker flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {t.shell.dataTo(f.date(meta.last_data_date, true))}
              </p>
            )}
          </div>
        </footer>
      </div>
    </>
  );
}

/** Today's date and the current time in the reader's language; rendered after mount so server and browser agree. */
function Clock() {
  const { lang } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  const loc = lang === "bn" ? "bn-BD" : "en-GB";
  return (
    <p className="flex min-h-4 items-center gap-1.5 text-xs text-muted" suppressHydrationWarning>
      <Icon name="clock" className="h-3.5 w-3.5" />
      {now && (
        <>
          <span>{now.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          <span aria-hidden>·</span>
          <time dateTime={now.toISOString()} className="tabular-nums">
            {now.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}
          </time>
        </>
      )}
    </p>
  );
}

/** False while the browser reports no network. Starts true so the server render and first paint agree. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** The vertical main menu in the sidebar, with a clear active state. */
function SideNav({ path }: { path: string }) {
  const { t } = useI18n();
  const nav = useNav();
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-2" aria-label={t.shell.navLabel}>
      <p className="kicker px-3 pb-2">{t.shell.navLabel}</p>
      <ul className="space-y-0.5">
        {nav.map((n) => {
          const active = isActive(n, path);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  active ? "bg-accent-soft font-semibold text-accent" : "font-medium text-muted hover:bg-raise hover:text-ink"
                }`}
              >
                {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                <Icon name={n.icon} className="h-[18px] w-[18px]" />
                {t.shell.nav[n.key]}
              </Link>
            </li>
          );
        })}
      </ul>
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
  const nav = useNav();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();

  useEffect(() => close(), [path]);
  // a drawer left open while the screen grows to desktop size would hide behind the sidebar
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => wide.matches && close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="shrink-0 lg:hidden">
      <button
        type="button"
        aria-label={t.shell.openMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
        className="grid h-11 w-11 cursor-pointer place-items-center rounded-xl border border-line bg-card text-ink hover:border-accent/50 hover:text-accent"
      >
        <Icon name="menu" className="h-6 w-6" />
      </button>
      <dialog ref={dialog} aria-label={t.shell.navLabel} className="drawer" onClose={() => setOpen(false)} onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="flex min-h-full flex-col gap-4 p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center justify-between gap-3">
            <Brand />
            <button type="button" onClick={close} aria-label={t.shell.closeMenu} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line text-muted hover:text-ink">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <nav aria-label={t.shell.navLabel} className="flex flex-col gap-1">
            {nav.map((n) => {
              const active = isActive(n, path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 font-medium ${
                    active ? "bg-accent-soft font-semibold text-accent" : "text-ink/85 hover:bg-raise"
                  }`}
                >
                  {active && <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-accent" />}
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
