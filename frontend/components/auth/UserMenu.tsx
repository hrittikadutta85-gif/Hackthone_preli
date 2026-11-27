"use client";
/* Avatar button in the top bar: who is signed in, links to their account pages and administration, and sign-out. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, History, Hospital, LogOut, MonitorSmartphone, ScrollText, User as UserIcon, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth, type Permission } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

/** What to call a user: their name, or their phone number / email when they have not added a name. */
export const displayName = (u: { full_name: string; phone: string | null; email: string | null }) => u.full_name || u.phone || u.email || "?";

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full border border-accent/25 bg-accent-soft font-display font-semibold text-accent ${
        size === "lg" ? "h-16 w-16 text-xl" : "h-9 w-9 text-sm"
      }`}
    >
      {/^[+\d]/.test(name) ? name.slice(-2) : initials(name)}
    </span>
  );
}

export function UserMenu() {
  const { t } = useI18n();
  const { user, can, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const links: [string, string, LucideIcon][] = [
    ["/account", t.auth.menu.profile, UserIcon],
    ["/account/notifications", t.auth.menu.notifications, Bell],
    ["/account/security", t.auth.menu.history, History],
    ["/account/sessions", t.auth.menu.sessions, MonitorSmartphone],
  ];
  const admin: [string, string, LucideIcon, Permission][] = [
    ["/admin/users", t.auth.menu.users, Users, "users.manage"],
    ["/admin/security", t.auth.menu.security, ScrollText, "security.view"],
    ["/admin/hospitals", t.area.admin.title, Hospital, "hospitals.manage"],
  ];
  const adminLinks = admin.filter((a) => can(a[3]));
  const item = (href: string, label: string, Ic: LucideIcon) => (
    <Link
      key={href}
      href={href}
      role="menuitem"
      onClick={() => setOpen(false)}
      aria-current={path === href ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${path === href ? "bg-accent-soft text-accent" : "text-ink/90 hover:bg-raise"}`}
    >
      <Ic className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </Link>
  );

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t.auth.menu.open}: ${displayName(user)}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-card p-1 pr-1 transition-colors hover:border-accent/55 md:pr-3"
      >
        <Avatar name={displayName(user)} />
        <span className="hidden max-w-36 truncate text-left text-sm leading-tight md:block">
          <span className="block truncate font-medium">{user.full_name ? user.full_name.split(" ")[0] : displayName(user)}</span>
          <span className="block truncate text-[0.7rem] text-muted">{t.auth.roles[user.role]}</span>
        </span>
      </button>
      {open && (
        <div role="menu" aria-label={t.auth.menu.open} className="auth-glass rise absolute right-0 z-[1200] mt-2 w-[min(18rem,calc(100vw-1.5rem))] p-2">
          <div className="flex items-center gap-3 border-b border-line px-2 pt-1 pb-3">
            <Avatar name={displayName(user)} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName(user)}</p>
              <p className="truncate text-xs text-muted">{user.full_name ? user.phone || user.email : user.email}</p>
              <p className="mt-1 inline-flex rounded-full border border-accent/40 bg-accent-soft px-2 py-px text-[0.68rem] font-medium text-accent">{t.auth.roles[user.role]}</p>
            </div>
          </div>
          <div className="py-1.5">{links.map(([h, l, I]) => item(h, l, I))}</div>
          {adminLinks.length > 0 && (
            <div className="border-t border-line py-1.5">
              <p className="kicker px-3 pt-1 pb-1">{t.auth.menu.adminGroup}</p>
              {adminLinks.map(([h, l, I]) => item(h, l, I))}
            </div>
          )}
          <div className="border-t border-line pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-critical-ink hover:bg-critical/10"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {t.auth.menu.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
