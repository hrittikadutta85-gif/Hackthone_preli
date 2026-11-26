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

type LabelSide = "top" | "left" | "right";
/** Real city-corporation locations (latitude, longitude) and the approximate size of each area. */
export const CITY_GEO: Record<string, { center: [number, number]; radiusKm: number; label: LabelSide }> = {
  Gazipur: { center: [23.99, 90.415], radiusKm: 4.2, label: "top" },
  "Dhaka North": { center: [23.808, 90.4], radiusKm: 5.0, label: "left" },
  "Dhaka South": { center: [23.722, 90.41], radiusKm: 4.0, label: "left" },
  Narayanganj: { center: [23.623, 90.5], radiusKm: 2.6, label: "right" },
  Chattogram: { center: [22.345, 91.825], radiusKm: 5.0, label: "top" },
};

/** Lines drawn between neighbouring regions, for orientation only. They do not describe how dengue spreads. */
export const CITY_LINKS: [string, string][] = [
  ["Gazipur", "Dhaka North"],
  ["Dhaka North", "Dhaka South"],
  ["Dhaka South", "Narayanganj"],
  ["Dhaka South", "Chattogram"],
];

export const NO_DATA_COLOR = "#3c5470";

export const colorAt = (data: MapData, i: number, k: number) => {
  const t = data.tier[i][k];
  return t == null ? NO_DATA_COLOR : TIER_COLOR[TIERS[t]];
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

/** How many wards a city has at each level, and its most serious level. */
export function citySummary(data: MapData, idx: number[], k: number) {
  const counts = TIERS.map((_, t) => idx.filter((i) => data.tier[i][k] === t).length);
  const worst = counts[3] ? 3 : counts[2] ? 2 : counts[1] ? 1 : 0;
  return { counts, worst, critical: counts[3], high: counts[2] };
}
