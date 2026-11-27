"use client";
import { useState } from "react";
import { BadgeCheck, BedDouble, Eye, EyeOff, FileUp, MapPinPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { sendJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n";
import { useAdminHospitals, type Hospital } from "@/lib/area";
import { when } from "@/lib/account";
import { Empty, PageHead, Tabs } from "@/components/auth/parts";
import { useToast } from "@/components/auth/Providers";
import { Button, Checkbox, Notice, TextField, useErrorText } from "@/components/auth/ui";
import { Skeleton } from "@/components/ui";

const TYPES = ["government", "private", "autonomous", "ngo", "military", "other"] as const;
type Form = Record<string, string | boolean>;
const EMPTY: Form = { name: "", name_bn: "", type: "government", address: "", city_corporation: "", district: "", division: "", lat: "", lon: "", phone: "", emergency_phone: "", has_emergency: false, registered_beds: "", icu_beds: "", source: "", source_ref: "" };

const toBody = (f: Form, withSource: boolean) => {
  const n = (v: string | boolean) => (v === "" ? null : Number(v));
  const s = (v: string | boolean) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name: String(f.name).trim(), name_bn: s(f.name_bn), type: f.type, address: String(f.address).trim(), city_corporation: s(f.city_corporation),
    district: String(f.district).trim(), division: String(f.division).trim(), lat: n(f.lat), lon: n(f.lon), phone: s(f.phone),
    emergency_phone: s(f.emergency_phone), has_emergency: !!f.has_emergency, registered_beds: n(f.registered_beds), icu_beds: n(f.icu_beds),
    source_ref: s(f.source_ref), ...(withSource ? { source: String(f.source).trim() } : {}),
  };
};

function HospitalForm({ initial, onSaved, onCancel, id }: { initial: Form; onSaved: () => void; onCancel: () => void; id?: number }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const L = t.area.admin.fields;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof typeof L, props: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <TextField label={L[k]} value={String(f[k] ?? "")} onChange={set(k)} {...props} />
  );
  return (
    <form
      className="panel panel-edge mb-5 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (id) await sendJson(`/api/hospitals/${id}`, toBody(f, false), "PATCH");
          else await sendJson("/api/hospitals", toBody(f, true));
          toast(t.auth.common.saved);
          onSaved();
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {field("name", { required: true, minLength: 2, className: "sm:col-span-2" })}
      <label className="block text-sm font-medium text-ink/90">
        <span className="mb-1.5 block">{L.type}</span>
        <select value={String(f.type)} onChange={set("type")} className="field h-11 w-full cursor-pointer rounded-xl px-3">
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t.area.hospitals.types[x]}
            </option>
          ))}
        </select>
      </label>
      {field("name_bn")}
      {field("address", { className: "sm:col-span-2" })}
      {field("district", { required: true })}
      {field("division", { required: true })}
      {field("city_corporation", { placeholder: "CCC, DNCC, DSCC…", maxLength: 10 })}
      {field("lat", { type: "number", step: "any", min: 20.3, max: 26.8 })}
      {field("lon", { type: "number", step: "any", min: 88, max: 92.8 })}
      {field("phone")}
      {field("emergency_phone")}
      {field("registered_beds", { type: "number", min: 0, max: 20000 })}
      {field("icu_beds", { type: "number", min: 0, max: 20000 })}
      {!id && field("source", { required: true, placeholder: "DGHS Facility Registry, hospital website…" })}
      {field("source_ref", { className: id ? "sm:col-span-2" : "" })}
      <div className="flex items-end">
        <Checkbox checked={!!f.has_emergency} onChange={(v) => setF((x) => ({ ...x, has_emergency: v }))}>
          {L.has_emergency}
        </Checkbox>
      </div>
      {id && <p className="text-xs text-medium sm:col-span-2 lg:col-span-3">{t.area.admin.editClears}</p>}
      {error && <Notice tone="error" className="sm:col-span-2 lg:col-span-3">{error}</Notice>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" busy={busy}>{t.area.admin.save}</Button>
        <Button type="button" variant="plain" onClick={onCancel}>{t.auth.common.cancel}</Button>
      </div>
    </form>
  );
}

function HospitalRow({ h, onChanged }: { h: Hospital; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [mode, setMode] = useState<null | "edit" | "verify" | "beds">(null);
  const [ref, setRef] = useState(h.source_ref ?? "");
  const [beds, setBeds] = useState({ available_beds: "", occupied_beds: "", icu_available: "", source_ref: "", verified: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const A = t.area.admin;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(t.auth.common.saved);
      setMode(null);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  if (mode === "edit") {
    const init: Form = { ...EMPTY, ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v == null ? "" : typeof v === "boolean" ? v : String(v)])) };
    return <HospitalForm id={h.id} initial={init} onSaved={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />;
  }
  const n = (v: string) => (v === "" ? null : Number(v));
  return (
    <li className={`panel p-4 ${h.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {h.name}
            {h.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-low/50 px-2 py-px text-[0.68rem] text-low"><BadgeCheck className="h-3 w-3" aria-hidden />{t.area.badges.verified}</span>
            ) : (
              <span className="rounded-full border border-medium/50 px-2 py-px text-[0.68rem] text-medium">{t.area.badges.unverified}</span>
            )}
            {!h.active && <span className="rounded-full border border-line px-2 py-px text-[0.68rem] text-muted">{A.hidden}</span>}
          </p>
          <p className="text-sm text-muted">
            {t.area.hospitals.types[h.type]} · {[h.city_corporation, h.district, h.division].filter(Boolean).join(", ")}
            {h.lat != null && <> · <span className="font-mono text-xs">{h.lat}, {h.lon}</span></>}
          </p>
          <p className="text-xs text-muted">
            {t.area.hospitals.registered}: {h.registered_beds ?? "—"} · {t.area.hospitals.icu}: {h.icu_beds ?? "—"} · {h.source ?? "—"}
            {h.verified_at && <> · {A.verifiedBy(when(h.verified_at, lang) ?? "")}</>}
          </p>
          <p className="mt-1 text-xs">
            {h.availability.status === "unavailable" ? (
              <span className="text-muted">{t.area.hospitals.noAvailability}</span>
            ) : (
              <span className={h.availability.status === "stale" ? "text-high" : "text-accent"}>
                {t.area.badges[h.availability.status === "stale" ? "stale" : h.availability.status === "live" ? "live" : "reported"]}: {h.availability.available_beds ?? "—"} {t.area.hospitals.available.toLowerCase()} · {when(h.availability.reported_at!, lang)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="plain" className="!min-h-9 !py-1 text-xs" onClick={() => setMode("edit")}><Pencil className="h-3.5 w-3.5" aria-hidden />{t.auth.account.profile.edit}</Button>
          {!h.verified && <Button type="button" variant="plain" className="!min-h-9 !py-1 text-xs" onClick={() => setMode(mode === "verify" ? null : "verify")}><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{A.verify}</Button>}
          <Button type="button" variant="plain" className="!min-h-9 !py-1 text-xs" onClick={() => setMode(mode === "beds" ? null : "beds")}><BedDouble className="h-3.5 w-3.5" aria-hidden />{A.beds}</Button>
          <Button type="button" variant="plain" className="!min-h-9 !py-1 text-xs" busy={busy && !mode} onClick={() => run(() => sendJson(`/api/hospitals/${h.id}`, { active: !h.active }, "PATCH"))}>
            {h.active ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            {h.active ? A.deactivate : A.reactivate}
          </Button>
        </div>
      </div>
      {mode === "verify" && (
        <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); run(() => sendJson(`/api/hospitals/${h.id}/verify`, { source_ref: ref })); }}>
          <TextField label={A.verifyPrompt} value={ref} onChange={(e) => setRef(e.target.value)} required minLength={3} className="min-w-64 flex-1" />
          <Button type="submit" busy={busy}>{A.verify}</Button>
        </form>
      )}
      {mode === "beds" && (
        <form
          className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => sendJson(`/api/hospitals/${h.id}/beds`, { available_beds: n(beds.available_beds), occupied_beds: n(beds.occupied_beds), icu_available: n(beds.icu_available), source_ref: beds.source_ref, verified: beds.verified }));
          }}
        >
          <TextField label={t.area.hospitals.available} type="number" min={0} value={beds.available_beds} onChange={(e) => setBeds((b) => ({ ...b, available_beds: e.target.value }))} />
          <TextField label={t.area.hospitals.occupied} type="number" min={0} value={beds.occupied_beds} onChange={(e) => setBeds((b) => ({ ...b, occupied_beds: e.target.value }))} />
          <TextField label={t.area.hospitals.icuAvailable} type="number" min={0} value={beds.icu_available} onChange={(e) => setBeds((b) => ({ ...b, icu_available: e.target.value }))} />
          <TextField label={A.bedsSource} required minLength={3} value={beds.source_ref} onChange={(e) => setBeds((b) => ({ ...b, source_ref: e.target.value }))} className="sm:col-span-2" />
          <div className="flex items-end">
            <Checkbox checked={beds.verified} onChange={(v) => setBeds((b) => ({ ...b, verified: v }))}>{A.bedsVerified}</Checkbox>
          </div>
          <div className="sm:col-span-3"><Button type="submit" busy={busy}>{A.save}</Button></div>
        </form>
      )}
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </li>
  );
}

function ImportCsv({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; errors: { line: number; error: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const A = t.area.admin;
  return (
    <form
      className="panel panel-edge mb-5 space-y-3 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await sendJson<{ added: number; errors: { line: number; error: string }[] }>("/api/hospitals/import", { csv_text: text, source });
          setResult(r);
          toast(A.importDone(r.added, r.errors.length));
          onDone();
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-muted">{A.importHint}</p>
      <input type="file" accept=".csv,text/csv" aria-label={A.import} onChange={async (e) => { const file = e.target.files?.[0]; if (file) setText(await file.text()); }} className="block text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-line file:bg-raise file:px-4 file:py-2 file:text-ink" />
      <textarea aria-label="CSV" value={text} onChange={(e) => setText(e.target.value)} rows={5} className="field w-full rounded-xl p-3 font-mono text-xs" />
      <TextField label={A.importSource} required minLength={2} value={source} onChange={(e) => setSource(e.target.value)} />
      {result?.errors.length ? (
        <Notice tone="warn">
          {result.errors.slice(0, 8).map((x) => `#${x.line}: ${x.error}`).join(" · ")}
        </Notice>
      ) : null}
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" busy={busy} disabled={!text.trim() || !source.trim()}><FileUp className="h-4 w-4" aria-hidden />{A.import}</Button>
    </form>
  );
}

function AddLocality({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errText = useErrorText();
  const [f, setF] = useState({ name: "", name_bn: "", aliases: "", city_corporation: "", district: "", division: "", lat: "", lon: "", source: "", verified: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const L = t.area.admin.fields;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="panel panel-edge mb-5 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await sendJson("/api/locations", { ...f, lat: Number(f.lat), lon: Number(f.lon), city_corporation: f.city_corporation || null, aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean) });
          toast(t.auth.common.saved);
          onDone();
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">{t.area.admin.localityHint}</p>
      <TextField label={L.name} required value={f.name} onChange={set("name")} />
      <TextField label={L.name_bn} value={f.name_bn} onChange={set("name_bn")} />
      <TextField label={L.aliases} value={f.aliases} onChange={set("aliases")} />
      <TextField label={L.district} required value={f.district} onChange={set("district")} />
      <TextField label={L.division} required value={f.division} onChange={set("division")} />
      <TextField label={L.city_corporation} value={f.city_corporation} onChange={set("city_corporation")} placeholder="CCC, DNCC…" />
      <TextField label={L.lat} type="number" step="any" required value={f.lat} onChange={set("lat")} />
      <TextField label={L.lon} type="number" step="any" required value={f.lon} onChange={set("lon")} />
      <TextField label={L.source} required value={f.source} onChange={set("source")} />
      {error && <Notice tone="error" className="sm:col-span-2 lg:col-span-3">{error}</Notice>}
      <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" busy={busy}><MapPinPlus className="h-4 w-4" aria-hidden />{t.area.admin.addLocality}</Button></div>
    </form>
  );
}

export default function HospitalDirectory() {
  const { t } = useI18n();
  const { data, mutate } = useAdminHospitals();
  const [panel, setPanel] = useState<null | "add" | "import" | "locality">(null);
  const A = t.area.admin;
  const done = () => { setPanel(null); mutate(); };
  return (
    <div className="rise">
      <PageHead
        title={A.title}
        subtitle={A.subtitle}
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setPanel(panel === "add" ? null : "add")}><Plus className="h-4 w-4" aria-hidden />{A.add}</Button>
            <Button type="button" variant="plain" onClick={() => setPanel(panel === "import" ? null : "import")}><FileUp className="h-4 w-4" aria-hidden />{A.import}</Button>
            <Button type="button" variant="plain" onClick={() => setPanel(panel === "locality" ? null : "locality")}><MapPinPlus className="h-4 w-4" aria-hidden />{A.addLocality}</Button>
          </div>
        }
      />
      <Tabs items={[{ href: "/admin/users", label: t.auth.menu.users }, { href: "/admin/security", label: t.auth.menu.security }, { href: "/admin/hospitals", label: A.title }]} />
      {panel === "add" && <HospitalForm initial={EMPTY} onSaved={done} onCancel={() => setPanel(null)} />}
      {panel === "import" && <ImportCsv onDone={() => mutate()} />}
      {panel === "locality" && <AddLocality onDone={done} />}
      {!data ? (
        <Skeleton className="h-60" />
      ) : data.items.length ? (
        <ul className="space-y-3">{data.items.map((h) => <HospitalRow key={h.id} h={h} onChanged={() => mutate()} />)}</ul>
      ) : (
        <Empty>{A.empty}</Empty>
      )}
      {data && data.localities.length > 0 && (
        <section className="mt-8">
          <h2 className="kicker mb-3">{A.localities}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.localities.map((l) => (
              <li key={l.id} className="panel flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{l.name}</span>
                  <span className="block text-xs text-muted">{[l.city_corporation, l.district, l.division].filter(Boolean).join(", ")} · <span className="font-mono">{l.lat}, {l.lon}</span></span>
                </span>
                <button type="button" aria-label={`${t.auth.common.close}: ${l.name}`} onClick={async () => { await sendJson(`/api/locations/loc:${l.id}`, undefined, "DELETE"); mutate(); }} className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted hover:text-critical-ink">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
