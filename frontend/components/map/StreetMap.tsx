"use client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { TIERS, TIER_COLOR, type MapData } from "@/lib/api";
import { cityGroups, citySummary, colorAt, type CanvasProps } from "./shared";

/*
 * Street map on standard OpenStreetMap tiles (muted with CSS). City corporations are at their real locations.
 * The dataset has no ward coordinates or boundaries, so each ward's bubble is placed approximately inside a circle
 * the size of its city corporation. Zoomed out, wards merge into one summary bubble per city.
 */
type LabelSide = "top" | "left" | "right";
export const CITY_GEO: Record<string, { center: [number, number]; radiusKm: number; label: LabelSide }> = {
  Gazipur: { center: [23.99, 90.415], radiusKm: 4.2, label: "top" },
  "Dhaka North": { center: [23.808, 90.4], radiusKm: 5.0, label: "left" },
  "Dhaka South": { center: [23.722, 90.41], radiusKm: 4.0, label: "left" },
  Narayanganj: { center: [23.623, 90.5], radiusKm: 2.6, label: "right" },
  Chattogram: { center: [22.345, 91.825], radiusKm: 5.0, label: "top" },
};
const WARD_ZOOM = 10; // below this, show one summary bubble per city
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const kmToLat = (km: number) => km / 110.574;
const kmToLon = (km: number, lat: number) => km / (111.32 * Math.cos((lat * Math.PI) / 180));

/** Even "sunflower" spread of n points inside a disc: looks natural and never stacks bubbles on each other. */
function sunflower(center: [number, number], radiusKm: number, n: number): L.LatLngTuple[] {
  return Array.from({ length: n }, (_, j) => {
    const r = radiusKm * 0.85 * Math.sqrt((j + 0.5) / n);
    const a = j * GOLDEN;
    return [center[0] + kmToLat(r * Math.sin(a)), center[1] + kmToLon(r * Math.cos(a), center[0])];
  });
}

const cityBounds = (name: string, pad = 1.3) => {
  const { center, radiusKm } = CITY_GEO[name];
  return L.latLng(center).toBounds(radiusKm * 2000 * pad);
};
const DHAKA_AREA = L.latLngBounds([cityBounds("Gazipur", 1).getNorthEast(), cityBounds("Narayanganj", 1).getSouthWest()]).pad(0.08);
const EVERYTHING = L.latLngBounds(Object.keys(CITY_GEO).map((c) => CITY_GEO[c].center)).pad(0.25);

const wardRadiusM = (pred: number) => 240 + Math.min(pred, 18) * 25;

function tipHtml(data: MapData, i: number, k: number) {
  const t = data.tier[i][k];
  const tier = t == null ? "" : `<span class="tip-pill" style="background:${TIER_COLOR[TIERS[t]]}">${TIERS[t]}</span>`;
  return `<div class="tip-head"><b>${data.wards[i].label}</b>${tier}</div>
    <div>About <b>${data.predicted[i][k]?.toFixed(0) ?? "?"}</b> cases expected</div>
    <div class="tip-muted">likely ${data.lower[i][k]}–${data.upper[i][k]} · ${data.cases_now[i][k] ?? "?"} reported now</div>
    <div class="tip-link">Click for details</div>`;
}

export default function StreetMap({ data, k, tiersOn, selected, onSelect, focus, onTilesFailed }: CanvasProps & { onTilesFailed: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{
    wards: L.Circle[];
    rings: (L.Circle | null)[];
    wardGroup: L.LayerGroup;
    cityGroup: L.LayerGroup;
    labels: Record<string, L.Tooltip>;
    bubbles: Record<string, L.CircleMarker>;
  } | null>(null);
  const cb = useRef({ onSelect, onTilesFailed });
  useEffect(() => {
    cb.current = { onSelect, onTilesFailed };
  });

  const wardKey = data.wards.map((w) => w.ward).join();
  const groups = useMemo(() => cityGroups(data), [wardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- build the map once per ward list
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const m = L.map(el.current!, { zoomControl: false, minZoom: 6, maxZoom: 17, zoomSnap: 0.5, zoomAnimation: !reduce, fadeAnimation: !reduce });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(m);
    let failed = 0;
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION })
      .on("tileerror", () => {
        if (++failed === 4) cb.current.onTilesFailed();
      })
      .addTo(m);

    const wardGroup = L.layerGroup();
    const cityGroup = L.layerGroup();
    const wards: L.Circle[] = [];
    const labels: Record<string, L.Tooltip> = {};
    const bubbles: Record<string, L.CircleMarker> = {};

    for (const { name, idx } of groups) {
      const { center, radiusKm, label } = CITY_GEO[name];
      // approximate city area + its label on the chosen side (zoomed in)
      L.circle(center, { radius: radiusKm * 1000, color: "#0f6b5c", weight: 1.5, dashArray: "6 6", fillColor: "#0f6b5c", fillOpacity: 0.03, interactive: false }).addTo(wardGroup);
      const edge: L.LatLngTuple =
        label === "top" ? [center[0] + kmToLat(radiusKm), center[1]] : [center[0], center[1] + (label === "left" ? -1 : 1) * kmToLon(radiusKm, center[0])];
      labels[name] = L.tooltip({ permanent: true, direction: label, className: `city-label side-${label}`, offset: label === "top" ? [0, -2] : [label === "left" ? -6 : 6, 0] })
        .setLatLng(edge)
        .addTo(wardGroup);
      // one summary bubble per city (zoomed out)
      bubbles[name] = L.circleMarker(center, { radius: 14, color: "#fff", weight: 2, fillOpacity: 0.9 })
        .bindTooltip("", { permanent: true, direction: "right", className: "city-label", offset: [10, 0] })
        .on("click", () => m.flyToBounds(cityBounds(name), { duration: reduce ? 0 : 0.8 }))
        .addTo(cityGroup);
      // wards
      sunflower(center, radiusKm, idx.length).forEach((ll, j) => {
        const i = idx[j];
        wards[i] = L.circle(ll, { radius: 300, color: "#fff", weight: 1.5, fillOpacity: 0.85 })
          .bindTooltip("", { direction: "top", className: "map-tip", offset: [0, -6] })
          .on("click", () => cb.current.onSelect(i))
          .addTo(wardGroup);
      });
    }

    const sync = () => {
      if (m.getZoom() >= WARD_ZOOM) {
        cityGroup.remove();
        wardGroup.addTo(m);
      } else {
        wardGroup.remove();
        cityGroup.addTo(m);
      }
    };
    m.on("zoomend", sync);
    m.fitBounds(DHAKA_AREA);
    sync();
    map.current = m;
    layers.current = { wards, rings: new Array(wards.length).fill(null), wardGroup, cityGroup, labels, bubbles };
    return () => {
      m.remove();
      map.current = null;
      layers.current = null;
    };
  }, [groups]);

  // ---------------------------------------------------------------- restyle for the current week / filters / selection
  useEffect(() => {
    const ly = layers.current;
    if (!ly) return;
    data.wards.forEach((_, i) => {
      const t = data.tier[i][k];
      const on = t != null && tiersOn[t];
      const c = ly.wards[i];
      const isSel = selected === i;
      c.setRadius(wardRadiusM(data.predicted[i][k] ?? 0));
      c.setStyle({ fillColor: colorAt(data, i, k), fillOpacity: on ? 0.85 : 0.1, opacity: on ? 1 : 0.2, color: isSel ? "#1d2a26" : "#fff", weight: isSel ? 3.5 : 1.5 });
      c.setTooltipContent(tipHtml(data, i, k));
      if (isSel) c.bringToFront();

      const wantRing = t === 3 && tiersOn[3];
      if (wantRing && !ly.rings[i]) {
        ly.rings[i] = L.circle(c.getLatLng(), { radius: c.getRadius(), className: "pulse", color: TIER_COLOR.Critical, weight: 3, fill: false, interactive: false }).addTo(ly.wardGroup);
      } else if (!wantRing && ly.rings[i]) {
        ly.rings[i]!.remove();
        ly.rings[i] = null;
      }
      ly.rings[i]?.setRadius(c.getRadius());
    });
    for (const { name, idx } of groups) {
      const s = citySummary(data, idx, k);
      const color = s.worst >= 2 ? TIER_COLOR[TIERS[s.worst]] : "#5f6f69";
      ly.labels[name].setContent(`${name}<span style="color:${color}">${s.text}</span>`);
      ly.bubbles[name]
        .setStyle({ fillColor: TIER_COLOR[TIERS[s.worst]] })
        .setRadius(12 + Math.min(s.counts[2] + s.counts[3], 20))
        .setTooltipContent(`${name}<span style="color:${color}">${s.text}</span>`);
    }
  }, [data, k, tiersOn, selected, groups]);

  // ---------------------------------------------------------------- camera requests from the explorer
  useEffect(() => {
    const m = map.current;
    if (!m || focus.n === 0) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.9;
    m.flyToBounds(focus.city ? cityBounds(focus.city) : EVERYTHING, { duration });
  }, [focus]);

  return (
    <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-line shadow-sm">
      <div ref={el} className="h-[460px] w-full sm:h-[620px]" role="region" aria-label="Street map of wards coloured by dengue risk" />
      <button
        onClick={() => map.current?.flyToBounds(DHAKA_AREA, { duration: 0.8 })}
        className="absolute top-3 right-3 z-[800] rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-paper"
      >
        Dhaka area
      </button>
    </div>
  );
}
