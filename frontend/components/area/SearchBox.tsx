"use client";
/* Place search with autocomplete (ARIA combobox). Local results while typing; OpenStreetMap only on request. */
import { useEffect, useId, useRef, useState } from "react";
import { Globe, Loader2, MapPin, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDebounced } from "@/components/ui";
import { useLocationSearch, type Place } from "@/lib/area";
import { getJson } from "@/lib/http";
import { useErrorText } from "@/components/auth/ui";

export const placeName = (p: Pick<Place, "name" | "name_bn">, lang: string) => (lang === "bn" && p.name_bn ? p.name_bn : p.name);

export function placeContext(p: Place, lang: string) {
  const bn = lang === "bn";
  const parts = p.kind === "division" ? [] : [bn ? p.district_bn || p.district : p.district, bn ? p.division_bn || p.division : p.division];
  return parts.filter((x, i, a) => x && a.indexOf(x) === i && x !== placeName(p, lang)).join(" · ") || (p.display ?? "");
}

const EXAMPLES = ["Chattogram", "Agrabad", "Dhanmondi", "Cox's Bazar", "Gazipur", "Khulna"];

export function SearchBox({ onSelect, initial = "" }: { onSelect: (p: Place) => void; initial?: string }) {
  const { t, lang } = useI18n();
  const a = t.area;
  const errText = useErrorText();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [online, setOnline] = useState<{ q: string; results: Place[] } | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineErr, setOnlineErr] = useState<string | null>(null);
  const dq = useDebounced(q, 180);
  const { data, isLoading } = useLocationSearch(dq);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const local = dq.trim().length >= 2 ? data?.results ?? [] : [];
  const extra = online && online.q === dq ? online.results : [];
  const options = [...local, ...extra];
  const showOnlineButton = !!data?.online_available && dq.trim().length >= 3 && (!local.length || data?.partial) && online?.q !== dq;

  useEffect(() => {
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = (p: Place) => {
    setQ(placeName(p, lang));
    setOpen(false);
    onSelect(p);
  };

  const searchOnline = async () => {
    setOnlineBusy(true);
    setOnlineErr(null);
    try {
      const r = await getJson<{ results: Place[] }>(`/api/locations/geocode?q=${encodeURIComponent(dq.trim())}`);
      setOnline({ q: dq, results: r.results });
      setOpen(true);
    } catch (e) {
      setOnlineErr(errText(e));
    } finally {
      setOnlineBusy(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <label htmlFor={`${id}-input`} className="sr-only">
        {a.searchLabel}
      </label>
      <div className="auth-glass flex items-center gap-2 !rounded-2xl px-3 sm:px-4">
        <Search className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open && dq.trim().length >= 2}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={q}
          placeholder={a.placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && options[active]) {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted sm:text-lg"
        />
        {(isLoading || onlineBusy) && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
        {q && (
          <button type="button" aria-label={a.clear} onClick={() => { setQ(""); setOnline(null); input.current?.focus(); }} className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-muted hover:text-ink">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {open && dq.trim().length >= 2 && data && (
        <div className="auth-glass absolute inset-x-0 z-[1100] mt-2 max-h-[min(28rem,70vh)] overflow-y-auto !rounded-2xl p-2">
          {data.partial && (
            <p className="px-3 py-2 text-xs text-medium" role="status">
              {a.partial(data.unmatched.join(" "))}
            </p>
          )}
          {options.length > 0 && (
            <ul id={`${id}-list`} role="listbox" aria-label={a.suggestions}>
              {options.map((p, i) => (
                <li
                  key={p.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${i === active ? "bg-accent-soft" : "hover:bg-raise"}`}
                >
                  {p.kind === "osm" ? <Globe className="h-4 w-4 shrink-0 text-muted" aria-hidden /> : <MapPin className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{placeName(p, lang)}</span>
                    <span className="block truncate text-xs text-muted">{placeContext(p, lang)}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.68rem] text-muted">
                    {p.kind === "osm" ? a.onlineResults : a.kinds[p.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!options.length && (
            <div className="px-3 py-3" role="status">
              <p className="text-sm font-medium">{a.noMatch(dq.trim())}</p>
              <p className="mt-0.5 text-xs text-muted">{online?.q === dq ? a.onlineNone : a.noMatchHint}</p>
            </div>
          )}
          {showOnlineButton && (
            <div className="border-t border-line px-2 pt-2">
              <button type="button" onClick={searchOnline} disabled={onlineBusy} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-sm text-accent hover:bg-raise">
                <Globe className="h-4 w-4" aria-hidden />
                <span>
                  {onlineBusy ? a.searchingOnline : a.searchOnline}
                  <span className="block text-xs text-muted">{a.onlineNote}</span>
                </span>
              </button>
            </div>
          )}
          {onlineErr && <p className="px-3 py-2 text-xs text-critical-ink">{onlineErr}</p>}
        </div>
      )}

      {!q && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{a.examples}:</span>
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => { setQ(x); setOpen(true); input.current?.focus(); }} className="btn !min-h-9 !py-1 text-xs">
              {x}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
