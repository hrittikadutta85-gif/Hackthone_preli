import { TIERS, TIER_COLOR, type MapData } from "@/lib/api";

/** A request to move the camera. `n` increments on every request so the same city can be asked for twice. */
export interface Focus {
  city: string | null; // null = show everything
  n: number;
}

/** What both map views (street map and offline honeycomb) receive from the explorer. */
export interface CanvasProps {
  data: MapData;
  k: number; // index of the forecast-origin week
  tiersOn: boolean[];
  selected: number | null;
  onSelect: (i: number) => void;
  focus: Focus;
}

export const CITY_ORDER = ["Gazipur", "Dhaka North", "Dhaka South", "Narayanganj", "Chattogram"];

export const colorAt = (data: MapData, i: number, k: number) => {
  const t = data.tier[i][k];
  return t == null ? "#c9d3cf" : TIER_COLOR[TIERS[t]];
};

/** Ward indices per city, ordered by ward number. */
export function cityGroups(data: MapData) {
  return CITY_ORDER.map((name) => ({
    name,
    idx: data.wards
      .map((w, i) => (w.city === name ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => data.wards[a].num.localeCompare(data.wards[b].num)),
  }));
}

export function citySummary(data: MapData, idx: number[], k: number) {
  const c = TIERS.map((_, t) => idx.filter((i) => data.tier[i][k] === t).length);
  const text = [c[3] && `${c[3]} critical`, c[2] && `${c[2]} high`].filter(Boolean).join(" · ") || "no high-risk wards";
  const worst = c[3] ? 3 : c[2] ? 2 : c[1] ? 1 : 0;
  return { counts: c, text, worst };
}
