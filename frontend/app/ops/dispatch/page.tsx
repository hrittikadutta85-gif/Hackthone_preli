"use client";
import { useState, type ReactNode } from "react";
import { useI18n, type Lang } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/i18n/format";
import { useDispatch, useOps, type Notice } from "@/lib/ops";
import { Card, ErrorNote, Segmented, Skeleton, TierPill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ops/parts";

function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** WhatsApp markup: *bold* and _italic_, line breaks kept. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i): ReactNode =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <b key={i}>{p.slice(1, -1)}</b>
        ) : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? (
          <i key={i} className="text-muted">{p.slice(1, -1)}</i>
        ) : (
          p
        ),
      )}
    </>
  );
}

export default function DispatchPage() {
  const { t, b, lang } = useI18n();
  const { query } = useOps();
  const [chosenLang, setMsgLang] = useState<Lang | null>(null);
  const msgLang = chosenLang ?? lang; // follows the app language until picked here
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [everyone, setEveryone] = useState(false);
  const [search, setSearch] = useState("");
  const { data, error } = useDispatch(query, msgLang, everyone);

  if (error) return <ErrorNote error={error} />;

  const q = toLatinDigits(search.trim().toLowerCase());
  const notices = (data?.notices ?? []).filter((n) => !q || `${n.ward} ${n.label} ${b(n.label)} ${n.city}`.toLowerCase().includes(q));
  const stamp = data ? `${data.target_date}_${msgLang}` : msgLang;
  const all = data?.notices ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-display text-2xl font-semibold">{t.ops.dispTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t.ops.dispDesc}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="kicker">{t.ops.channel}</span>
              <Segmented label={t.ops.channel} value={channel} onChange={setChannel} options={[{ value: "sms", label: t.ops.sms }, { value: "whatsapp", label: t.ops.whatsapp }]} />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="kicker">{t.ops.msgLang}</span>
              <Segmented label={t.ops.msgLang} value={msgLang} onChange={setMsgLang} options={[{ value: "en", label: "English" }, { value: "bn", label: "বাংলা" }]} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/85">
              <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              {t.ops.everyone}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={!all.length} className="btn" onClick={() => downloadText(`sms_${stamp}.txt`, all.map((n) => `[${n.ward}] ${n.sms}`).join("\n\n"))}>
              <Icon name="download" /> {t.ops.downloadSms}
            </button>
            <button disabled={!all.length} className="btn" onClick={() => downloadText(`whatsapp_${stamp}.txt`, all.map((n) => `----- ${n.ward} -----\n${n.whatsapp}`).join("\n\n"))}>
              <Icon name="download" /> {t.ops.downloadWa}
            </button>
            <button disabled={!data} className="btn" onClick={() => data && downloadText(`dispatch_${stamp}.json`, JSON.stringify(data, null, 1), "application/json")}>
              <Icon name="download" /> {t.ops.downloadJson}
            </button>
          </div>
        </Card>
        <Card className="flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{t.ops.brief}</h2>
            <p className="mt-1 text-sm text-muted">{t.ops.briefNote}</p>
          </div>
          <a href={query ? `/api/ops/brief?${query}&lang=${msgLang}` : undefined} target="_blank" rel="noopener" className="btn btn-primary w-full">
            <Icon name="print" /> {t.ops.brief}
          </a>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{data ? t.ops.count(all.length) : "…"}</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.ops.search}
            aria-label={t.ops.searchLabel}
            className="w-full rounded-full border border-line bg-raise px-4 py-2 text-sm outline-none focus:border-accent/60 sm:w-64"
          />
        </div>
        {!data ? (
          <Skeleton className="mt-4 h-64" />
        ) : notices.length === 0 ? (
          <p className="mt-4 text-muted">{t.ops.none}</p>
        ) : (
          <ul className={`mt-4 grid gap-3 ${channel === "sms" ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"}`}>
            {notices.map((n) => (
              <NoticeCard key={n.ward} n={n} channel={channel} lang={msgLang} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NoticeCard({ n, channel, lang: l }: { n: Notice; channel: "sms" | "whatsapp"; lang: Lang }) {
  const { t, f, b } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = channel === "sms" ? n.sms : n.whatsapp;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-raise p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">#{f.n(n.rank)}</span>
        <span className="font-semibold">{b(n.label)}</span>
        <TierPill tier={n.tier} />
        <StatusBadge status={n.status} />
        <button onClick={copy} className="btn ml-auto px-2.5 py-1 text-xs" aria-label={t.ops.copyLabel(b(n.label))}>
          <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" /> {copied ? t.ops.copied : t.ops.copy}
        </button>
      </div>
      <div
        lang={l}
        className={`rounded-xl border px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap select-text ${
          channel === "sms" ? "border-accent/25 bg-raise font-mono" : "border-[#25d366]/40 bg-[#e9f8ee]"
        }`}
      >
        {channel === "sms" ? text : <WhatsAppText text={text} />}
      </div>
      {channel === "sms" && <p className="text-[11px] text-muted">{t.ops.smsMeta(f.n(n.sms_chars), n.sms_encoding, f.n(n.sms_parts))}</p>}
    </li>
  );
}
