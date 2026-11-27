"use client";
/*
 * Decides what wraps a page: sign-in screens stand alone; everything else waits for a confirmed session, then gets
 * the dashboard shell. A page the role cannot open shows an explanation instead (the API refuses its data anyway).
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { ControlsProvider } from "@/lib/controls";
import { isOpenRoute, isPublicRoute, permissionFor, useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { BrandMark } from "@/components/icons";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ReauthProvider } from "./Providers";

function Checking() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <span className="relative">
          <BrandMark />
          <span className="absolute -inset-2 animate-ping rounded-2xl border border-accent/30" aria-hidden />
        </span>
        <p className="kicker">{t.auth.gate.checking}</p>
      </div>
    </div>
  );
}

function Forbidden({ home }: { home: string }) {
  const { t } = useI18n();
  return (
    <div className="panel panel-edge mx-auto mt-6 max-w-lg p-8 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-high/40 bg-high/10 text-high">
        <ShieldAlert className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="font-display mt-4 text-2xl font-semibold">{t.auth.forbidden.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.auth.forbidden.text}</p>
      <Link href={home} className="btn btn-primary mt-6">
        {t.auth.forbidden.home}
      </Link>
    </div>
  );
}

/** Header for open pages seen by someone who is not signed in: brand, language and a sign-in link. */
function PublicFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <header className="sticky top-0 z-[1000] border-b border-line bg-card/90 px-3 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2 backdrop-blur-xl sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link href="/area-intelligence" className="flex min-w-0 flex-1 items-center gap-2.5">
            <BrandMark />
            <span className="min-w-0 max-[379px]:sr-only">
              <span className="font-display block text-lg leading-tight font-semibold whitespace-nowrap">{t.common.brand}</span>
              <span className="kicker brand-tagline block">{t.shell.tagline}</span>
            </span>
          </Link>
          <LanguageSwitch />
          <Link href="/login?next=%2Farea-intelligence" className="btn btn-primary">
            {t.area.signIn}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-10">{children}</main>
    </>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, me, loading } = useAuth();
  const isPublic = isPublicRoute(path);
  const isOpen = isOpenRoute(path);

  // Signed-out visitors go to sign-in (proxy.ts usually does this before the page loads; this covers a session
  // that ended while the page was open). Signed-in visitors skip the sign-in screens.
  useEffect(() => {
    if (loading || me === undefined) return;
    if (!isPublic && !isOpen && me === null) router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    if (isPublic && me && path === "/login") router.replace(me.user.home);
  }, [isPublic, isOpen, me, loading, path, router]);

  if (isPublic) return <>{children}</>;
  if (isOpen && !user) return me === undefined || loading ? <Checking /> : <PublicFrame>{children}</PublicFrame>;
  if (!user) return <Checking />;
  const perm = permissionFor(path);
  const allowed = !perm || user.permissions.includes(perm);
  return (
    <ReauthProvider>
      <ControlsProvider>
        <Shell>{allowed ? children : <Forbidden home={user.home} />}</Shell>
      </ControlsProvider>
    </ReauthProvider>
  );
}
