"use client";
import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Search, UserPlus, X } from "lucide-react";
import { ROLES, useAuth, type Role } from "@/lib/auth";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { useControls } from "@/lib/controls";
import { useAdminUsers, when, type AdminUser } from "@/lib/account";
import { Avatar, displayName } from "@/components/auth/UserMenu";
import { Empty, PageHead, Tabs, VerifiedBadge } from "@/components/auth/parts";
import { useReauth, useToast } from "@/components/auth/Providers";
import { Button, Checkbox, Notice, PhoneField, TextField, joinPhone, useErrorText } from "@/components/auth/ui";
import { Skeleton, useDebounced } from "@/components/ui";

type Tab = "pending" | "active" | "deactivated" | "all";

function InviteCode({ code, days, onClose }: { code: string; days: number; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const a = t.auth.admin.users;
  return (
    <div className="rounded-2xl border border-accent/45 bg-accent-soft p-4" role="status">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-accent">
            <KeyRound className="h-4 w-4" aria-hidden />
            {a.inviteTitle}
          </p>
          <p className="mt-2 font-mono text-2xl tracking-[0.2em] text-ink">{code}</p>
          <p className="mt-2 text-xs text-muted">{a.inviteText(days)}</p>
        </div>
        <button type="button" aria-label={t.auth.common.close} onClick={onClose} className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted hover:text-ink">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <Button
        type="button"
        variant="plain"
        className="mt-3"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          } catch {
            /* clipboard blocked: the code is on screen to copy by hand */
          }
        }}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? t.auth.common.copied : t.auth.common.copy}
      </Button>
    </div>
  );
}

function CreateUser({ onDone }: { onDone: (code: string, days: number) => void }) {
  const { t, lang } = useI18n();
  const guard = useReauth();
  const errText = useErrorText();
  const [form, setForm] = useState({ full_name: "", email: "", organization: "", designation: "" });
  const [cc, setCc] = useState("+880");
  const [local, setLocal] = useState("");
  const [role, setRole] = useState<Role>("officer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = t.auth.admin.users;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="panel panel-edge mb-6 grid gap-4 p-5 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await guard(() =>
            sendJson<{ invite_code: string; invite_expires_days: number }>("/api/admin/users", { ...form, email: form.email || null, phone: joinPhone(cc, local) || null, role, lang }),
          );
          onDone(r.invite_code, r.invite_expires_days);
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="sm:col-span-2">
        <h2 className="font-display text-lg font-semibold">{a.createTitle}</h2>
        <p className="mt-1 text-sm text-muted">{a.createText}</p>
      </div>
      <TextField label={t.auth.common.fullName} required minLength={2} value={form.full_name} onChange={set("full_name")} />
      <TextField label={t.auth.common.email} optionalText={t.auth.common.optional} type="email" value={form.email} onChange={set("email")} />
      <PhoneField label={t.auth.common.phone} cc={cc} onCc={setCc} value={local} onChange={setLocal} />
      <label className="block text-sm font-medium text-ink/90">
        <span className="mb-1.5 block">{t.auth.common.role}</span>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field h-11 w-full cursor-pointer rounded-xl px-3">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.auth.roles[r]}
            </option>
          ))}
        </select>
      </label>
      <TextField label={t.auth.common.organization} value={form.organization} onChange={set("organization")} />
      <TextField label={t.auth.common.designation} value={form.designation} onChange={set("designation")} />
      {error && <Notice tone="error" className="sm:col-span-2">{error}</Notice>}
      <div className="sm:col-span-2">
        <Button type="submit" busy={busy} disabled={!form.full_name || (!form.email && !local)}>
          <UserPlus className="h-4 w-4" aria-hidden />
          {a.create}
        </Button>
      </div>
    </form>
  );
}

function UserCard({ u, onChanged, onInvite }: { u: AdminUser; onChanged: () => void; onInvite: (code: string, days: number) => void }) {
  const { t, lang, f } = useI18n();
  const { user: me } = useAuth();
  const { meta } = useControls();
  const guard = useReauth();
  const toast = useToast();
  const errText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [addWard, setAddWard] = useState("");
  const a = t.auth.admin.users;
  const self = me?.id === u.id;

  const act = async (key: string, fn: () => Promise<unknown>, message = a.done) => {
    setBusy(key);
    setError(null);
    try {
      await guard(fn);
      onChanged();
      toast(message);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };
  const patch = (key: string, body: Record<string, unknown>) => act(key, () => sendJson(`/api/admin/users/${u.id}`, body, "PATCH"));
  const wardLabel = (id: string) => meta?.wards.find((w) => w.id === id)?.label ?? id.replace(/_/g, " ");

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={displayName(u)} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {displayName(u)}
            {self && <span className="rounded-full border border-accent/40 px-2 py-px text-[0.68rem] text-accent">{a.you}</span>}
            {u.locked && <span className="rounded-full border border-critical/50 bg-critical/10 px-2 py-px text-[0.68rem] text-critical-ink">{a.locked}</span>}
          </p>
          <p className="truncate text-sm text-muted">{u.email ?? "—"}</p>
          <p className="text-xs text-muted">
            {[u.organization, u.designation].filter(Boolean).join(" · ") || "—"} · <span className="font-mono">{u.phone || "—"}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{t.auth.account.profile.emailStatus}</span> <VerifiedBadge ok={u.email_verified} />
            <span className="ml-1 text-muted">{t.auth.account.profile.phoneStatus}</span> <VerifiedBadge ok={u.phone_verified} />
            <span className="ml-1 text-muted">· {t.auth.account.profile.lastLogin}: {when(u.last_login_at, lang) ?? t.auth.common.never}</span>
          </div>
          {u.status === "pending" && u.requested_role && <p className="mt-2 text-sm text-medium">{a.requested(t.auth.roles[u.requested_role])}</p>}
        </div>
        <label className="w-full sm:w-48">
          <span className="sr-only">{t.auth.common.role}</span>
          <select
            value={u.status === "pending" ? u.requested_role ?? u.role : u.role}
            disabled={self || !!busy || u.status === "deactivated"}
            onChange={(e) => (u.status === "pending" ? patch("role", { role: e.target.value, status: "active", confirm_email: confirmEmail }) : patch("role", { role: e.target.value }))}
            className="field h-11 w-full cursor-pointer rounded-xl px-3 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.auth.roles[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {u.role === "field" && u.status !== "pending" && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="kicker mb-2">{a.wards}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {u.assigned_wards.map((w) => (
              <span key={w} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pr-1 pl-2.5 text-xs">
                {f.digits(wardLabel(w))}
                <button type="button" aria-label={`${t.auth.common.close}: ${wardLabel(w)}`} disabled={!!busy} onClick={() => patch("wards", { assigned_wards: u.assigned_wards.filter((x) => x !== w) })} className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-muted hover:text-critical-ink">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <span className="flex items-center gap-1">
              <select aria-label={a.addWard} value={addWard} onChange={(e) => setAddWard(e.target.value)} className="field h-9 max-w-52 cursor-pointer rounded-lg px-2 text-xs">
                <option value="">{a.addWard}</option>
                {meta?.wards.filter((w) => !u.assigned_wards.includes(w.id)).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} · {w.city}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={a.addWard} disabled={!addWard || !!busy} onClick={() => { patch("wards", { assigned_wards: [...u.assigned_wards, addWard] }); setAddWard(""); }} className="btn h-9 w-9 !p-0">
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {u.status === "pending" && (
          <>
            {!u.email_verified && (
              <Checkbox checked={confirmEmail} onChange={setConfirmEmail}>
                <span className="text-xs">{a.confirmEmail}</span>
              </Checkbox>
            )}
            <Button type="button" busy={busy === "approve"} onClick={() => patch("approve", { status: "active", role: u.requested_role ?? u.role, confirm_email: confirmEmail })}>
              <Check className="h-4 w-4" aria-hidden />
              {a.approve}
            </Button>
            <Button type="button" variant="danger" busy={busy === "deactivate"} onClick={() => patch("deactivate", { status: "deactivated" })}>
              {a.deactivate}
            </Button>
          </>
        )}
        {u.status === "active" && !self && (
          <Button type="button" variant="danger" busy={busy === "deactivate"} onClick={() => patch("deactivate", { status: "deactivated" })}>
            {a.deactivate}
          </Button>
        )}
        {u.status === "deactivated" && (
          <Button type="button" busy={busy === "reactivate"} onClick={() => patch("reactivate", { status: "active" })}>
            {a.reactivate}
          </Button>
        )}
        {u.status === "active" && !u.email_verified && (
          <Button type="button" variant="plain" busy={busy === "confirm"} onClick={() => patch("confirm", { confirm_email: true })}>
            {a.confirmEmail.split(" (")[0]}
          </Button>
        )}
        {u.locked && (
          <Button type="button" variant="plain" busy={busy === "unlock"} onClick={() => act("unlock", () => sendJson(`/api/admin/users/${u.id}/unlock`))}>
            {a.unlock}
          </Button>
        )}
        {u.status === "active" && (
          <>
            <Button
              type="button"
              variant="plain"
              busy={busy === "sessions"}
              onClick={async () => {
                setBusy("sessions");
                setError(null);
                try {
                  const r = await sendJson<{ ended: number }>(`/api/admin/users/${u.id}/revoke-sessions`);
                  toast(a.endedSessions(r.ended));
                } catch (err) {
                  setError(errText(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {a.endSessions}
            </Button>
            <Button
              type="button"
              variant="plain"
              busy={busy === "invite"}
              onClick={async () => {
                setBusy("invite");
                setError(null);
                try {
                  const r = await guard(() => sendJson<{ invite_code: string; invite_expires_days: number }>(`/api/admin/users/${u.id}/invite`));
                  onInvite(r.invite_code, r.invite_expires_days);
                } catch (err) {
                  setError(errText(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {a.newInvite}
            </Button>
          </>
        )}
      </div>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </li>
  );
}

export default function AdminUsers() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("pending");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [invite, setInvite] = useState<{ code: string; days: number } | null>(null);
  const dq = useDebounced(q, 300);
  const a = t.auth.admin.users;
  const query = new URLSearchParams({ ...(tab !== "all" && { status: tab }), ...(role && { role }), ...(dq.trim() && { q: dq.trim() }) }).toString();
  const { data, mutate } = useAdminUsers(query ? `?${query}` : "");
  const { data: pending } = useAdminUsers("?status=pending");

  return (
    <div className="rise">
      <PageHead
        title={a.title}
        subtitle={a.subtitle}
        action={
          <Button type="button" onClick={() => { setAdding((v) => !v); setInvite(null); }}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {a.add}
          </Button>
        }
      />
      <Tabs items={[{ href: "/admin/users", label: t.auth.menu.users }, { href: "/admin/security", label: t.auth.menu.security }, { href: "/admin/hospitals", label: t.area.admin.title }]} />
      {invite && (
        <div className="mb-6">
          <InviteCode code={invite.code} days={invite.days} onClose={() => setInvite(null)} />
        </div>
      )}
      {adding && !invite && (
        <CreateUser
          onDone={(code, days) => {
            setInvite({ code, days });
            setAdding(false);
            setTab("active");
            mutate();
          }}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={a.title} className="flex flex-wrap gap-2">
          {(["pending", "active", "deactivated", "all"] as Tab[]).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className="btn">
              {a.tabs[k]}
              {k === "pending" && !!pending?.users.length && <span className="rounded-full bg-high px-1.5 text-xs font-semibold text-black">{pending.users.length}</span>}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <select aria-label={t.auth.common.role} value={role} onChange={(e) => setRole(e.target.value)} className="field h-11 cursor-pointer rounded-xl px-3 text-sm">
            <option value="">{a.anyRole}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.auth.roles[r]}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" aria-label={a.search} placeholder={a.search} value={q} onChange={(e) => setQ(e.target.value)} className="field h-11 w-full rounded-xl pr-3 pl-9 text-sm" />
          </div>
        </div>
      </div>
      {!data ? (
        <Skeleton className="h-72" />
      ) : data.users.length ? (
        <ul className="space-y-3">
          {data.users.map((u) => (
            <UserCard key={u.id} u={u} onChanged={() => mutate()} onInvite={(code, days) => setInvite({ code, days })} />
          ))}
        </ul>
      ) : (
        <Empty>{a.noUsers}</Empty>
      )}
    </div>
  );
}
