"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMeta, type Meta } from "./api";

interface Controls {
  meta: Meta | undefined;
  origin: string | null;
  horizon: number;
  setOrigin: (o: string) => void;
  setHorizon: (h: number) => void;
}

const Ctx = createContext<Controls | null>(null);
const KEY = "dengue-controls-v1";

/** The week being looked at and the early-warning window. Shared by every page and remembered between visits. */
export function ControlsProvider({ children }: { children: ReactNode }) {
  const { data: meta } = useMeta();
  const [saved, setSaved] = useState<{ origin?: string; horizon?: number }>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch {
      /* private mode or blocked storage: fall back to defaults */
    }
  }, []);

  const persist = useCallback((next: { origin?: string; horizon?: number }) => {
    setSaved((s) => {
      const merged = { ...s, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      return merged;
    });
  }, []);

  const origin = meta ? (saved.origin && meta.origins.includes(saved.origin) ? saved.origin : meta.default_origin) : null;
  const horizon = saved.horizon ?? 2;

  const value = useMemo<Controls>(
    () => ({
      meta,
      origin,
      horizon,
      setOrigin: (o) => persist({ origin: o }),
      setHorizon: (h) => persist({ horizon: h }),
    }),
    [meta, origin, horizon, persist],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControls() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControls must be used inside ControlsProvider");
  return c;
}
