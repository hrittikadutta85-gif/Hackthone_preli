"use client";
/*
 * Language state for the whole app. Components call `useI18n()`:
 *   t  – fixed strings (en.tsx / bn.tsx)
 *   f  – numbers and dates in the current language
 *   b  – sentences written by the backend
 * Switching only re-renders; nothing is remounted or refetched, so selections and typed input survive.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { en, type Dict } from "./en";
import { bn } from "./bn";
import { translate, translateError } from "./backend";
import { makeFormat, type Format, type Lang } from "./format";
import { LANG_KEY } from "./boot";

export type { Lang, Dict, Format };

const listeners = new Set<() => void>();
let chosen: Lang | null = null; // keeps the choice when storage is blocked

function readLang(): Lang {
  if (chosen) return chosen;
  try {
    return localStorage.getItem(LANG_KEY) === "bn" ? "bn" : "en";
  } catch {
    return "en";
  }
}

function subscribe(listener: () => void) {
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== LANG_KEY) return;
    chosen = null;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromOtherTab);
  };
}

export function setLang(lang: Lang) {
  chosen = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  listeners.forEach((l) => l());
}

interface I18n {
  lang: Lang;
  t: Dict;
  f: Format;
  b: (backendText: string) => string;
  bError: (message: string) => string;
}

const make = (lang: Lang): I18n => ({
  lang,
  t: lang === "bn" ? bn : en,
  f: makeFormat(lang),
  b: lang === "bn" ? translate : (s) => s,
  bError: lang === "bn" ? translateError : (s) => s,
});
const BOTH = { en: make("en"), bn: make("bn") };

const Ctx = createContext<I18n>(BOTH.en);
export const useI18n = () => useContext(Ctx);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // the server always renders English; the browser then switches to the saved choice
  const lang = useSyncExternalStore(subscribe, readLang, () => "en" as Lang);

  useLayoutEffect(() => {
    if (readLang() !== lang) return; // still the server's first render
    document.documentElement.lang = lang;
    delete document.documentElement.dataset.langPending; // reveal the page (see boot.ts)
  }, [lang]);

  const value = useMemo(() => BOTH[lang], [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Sets the browser tab title and keeps it, even when the framework rewrites it during navigation. */
export function useTitle(title: string | null | undefined) {
  const { t } = useI18n();
  useEffect(() => {
    if (!title) return;
    const full = `${title} · ${t.common.brand}`;
    const apply = () => {
      if (document.title !== full) document.title = full;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title, t]);
}
