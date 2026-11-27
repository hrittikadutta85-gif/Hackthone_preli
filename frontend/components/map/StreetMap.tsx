"use client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { TIERS, TIER_COLOR, type MapData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { CITY_GEO, CITY_LINKS, cityGroups, citySummary, colorAt, type CanvasProps } from "./shared";

/*
 * Street map on standard OpenStreetMap tiles (darkened with CSS). City corporations are at their real locations.
 * The dataset has no ward coordinates or boundaries, so each ward's bubble is placed approximately inside a circle
 * the size of its city corporation. Zoomed out, wards merge into one summary bubble per city.
 */
const WARD_ZOOM = 10; // below this, show one summary bubble per city
const TAP_RADIUS_PX = 24; // a tap this close to a ward's centre selects it, however small the bubble is drawn
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

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
/** On narrow maps the area is shifted right so the names beside the Dhaka circles are not cut off. */
const fitOptions = (m: L.Map): L.FitBoundsOptions => (m.getSize().x < 520 ? { paddingTopLeft: [96, 24], paddingBottomRight: [8, 8] } : {});
const TEAL = "#287f75";
const EDGE = "#ffffff"; // white ring that separates neighbouring bubbles

/** The point on a city's circle that faces another city, so links start at the outline instead of under the wards. */
function edgeToward(from: string, to: string): L.LatLngTuple {
  const { center: a, radiusKm } = CITY_GEO[from];
  const b = CITY_GEO[to].center;
  const dy = (b[0] - a[0]) * 110.574;
  const dx = (b[1] - a[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  const f = radiusKm / Math.hypot(dx, dy);
  return [a[0] + kmToLat(dy * f), a[1] + kmToLon(dx * f, a[0])];
}

type I18n = ReturnType<typeof useI18n>;

function tipHtml({ t, f, b }: I18n, data: MapData, i: number, k: number) {
  const level = data.tier[i][k];
  const c = level == null ? "" : TIER_COLOR[TIERS[level]];
  const pill = level == null ? "" : `<span class="tip-pill" style="border-color:${c};background:${c}26">${t.common.tier[TIERS[level]]}</span>`;
  const [before, after] = t.map.about;
  return `<div class="tip-head"><b>${b(data.wards[i].label)}</b>${pill}</div>
    <div>${before}<b>${f.n(data.predicted[i][k], 0)}</b>${after}</div>
    <div class="tip-muted">${t.map.tipLikely(f.n(data.lower[i][k]), f.n(data.upper[i][k]), f.n(data.cases_now[i][k]))}</div>
    <div class="tip-link">${t.map.details}</div>`;
}

/** A scale bar whose unit is written in the current language. */
function scaleBar({ t, f }: I18n) {
  const Scale = L.Control.Scale.extend({
    _updateScale(this: { _mScale: HTMLElement; options: { maxWidth: number } }, el: HTMLElement, text: string, ratio: number) {
      el.style.width = `${Math.round(this.options.maxWidth * ratio)}px`;
      const [value, unit] = text.split(" ");
      el.textContent = `${f.digits(value)} ${unit === "km" ? t.map.km : t.map.metre}`;
    },
  });
  const options: L.Control.ScaleOptions = { position: "bottomleft", imperial: false };
  return new Scale(options);
}

export default function StreetMap({ data, k, tiersOn, selected, onSelect, focus, onTilesFailed }: CanvasProps & { onTilesFailed: () => void }) {
  const i18n = useI18n();
  const { t, f, b } = i18n;
  const el = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLSpanElement>(null);
  const cursorAt = useRef<L.LatLng | null>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{
    wards: L.Circle[];
    rings: (L.Circle | null)[];
    halos: (L.Circle | null)[];
    wardGroup: L.LayerGroup;
    cityGroup: L.LayerGroup;
    labels: Record<string, L.Tooltip>;
    bubbles: Record<string, L.CircleMarker>;
  } | null>(null);
  const cb = useRef({ onSelect, onTilesFailed, latLon: f.latLon });
  useEffect(() => {
    cb.current = { onSelect, onTilesFailed, latLon: f.latLon };
  });

  const wardKey = data.wards.map((w) => w.ward).join();
  const groups = useMemo(() => cityGroups(data), [wardKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- build the map once per ward list
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const m = L.map(el.current!, { zoomControl: false, minZoom: 6, maxZoom: 17, zoomSnap: 0.5, zoomAnimation: !reduce, fadeAnimation: !reduce });
    m.fitBounds(DHAKA_AREA, fitOptions(m)); // set the view first: vector layers need it to draw
    let failed = 0;
    L.tileLayer(TILE_URL, { maxZoom: 19 })
      .on("tileerror", () => {
        if (++failed === 4) cb.current.onTilesFailed();
      })
      .addTo(m);

    const wardGroup = L.layerGroup();
    const cityGroup = L.layerGroup();
    const wards: L.Circle[] = [];
    const labels: Record<string, L.Tooltip> = {};
    const bubbles: Record<string, L.CircleMarker> = {};

    // connecting lines and glowing connection points between regions (visible at every zoom level)
    for (const [from, to] of CITY_LINKS) {
      const ends = [edgeToward(from, to), edgeToward(to, from)];
      L.polyline(ends, { color: TEAL, weight: 1, opacity: 0.25, interactive: false }).addTo(m);
      L.polyline(ends, { color: TEAL, weight: 1.6, opacity: 0.85, className: "flow", interactive: false }).addTo(m);
      for (const end of ends)
        L.circleMarker(end, { radius: 2.5, stroke: false, fillColor: "#75b8a5", fillOpacity: 1, className: "map-node", interactive: false }).addTo(m);
    }
    // live cursor position
    m.on("mousemove", (e: L.LeafletMouseEvent) => {
      cursorAt.current = e.latlng;
      if (cursor.current) cursor.current.textContent = cb.current.latLon(e.latlng.lat, e.latlng.lng, 4);
    });
    m.on("mouseout", () => {
      cursorAt.current = null;
      if (cursor.current) cursor.current.textContent = "—";
    });

    for (const { name, idx } of groups) {
      const { center, radiusKm, label } = CITY_GEO[name];
      // approximate city area + its label on the chosen side (zoomed in)
      L.circle(center, { radius: radiusKm * 1000, color: TEAL, weight: 7, opacity: 0.08, fill: false, interactive: false }).addTo(wardGroup);
      L.circle(center, { radius: radiusKm * 1000, color: TEAL, weight: 1.2, opacity: 0.85, fillColor: TEAL, fillOpacity: 0.04, className: "city-ring", interactive: false }).addTo(wardGroup);
      const edge: L.LatLngTuple =
        label === "top" ? [center[0] + kmToLat(radiusKm), center[1]] : [center[0], center[1] + (label === "left" ? -1 : 1) * kmToLon(radiusKm, center[0])];
      labels[name] = L.tooltip({ permanent: true, direction: label, className: `city-label side-${label}`, offset: label === "top" ? [0, -2] : [label === "left" ? -6 : 6, 0] })
        .setLatLng(edge)
        .addTo(wardGroup);
      // one summary bubble per city (zoomed out)
      bubbles[name] = L.circleMarker(center, { radius: 14, color: "#ffffff", weight: 2, fillOpacity: 0.9, className: "ward-marker" })
        .bindTooltip("", { permanent: true, direction: "right", className: "city-label", offset: [10, 0] })
        .on("click", () => m.flyToBounds(cityBounds(name), { duration: reduce ? 0 : 0.8 }))
        .addTo(cityGroup);
      // wards
      sunflower(center, radiusKm, idx.length).forEach((ll, j) => {
        wards[idx[j]] = L.circle(ll, { radius: 300, color: EDGE, weight: 1.5, fillOpacity: 0.9, className: "ward-marker" })
          .bindTooltip("", { direction: "top", className: "map-tip", offset: [0, -6] })
          .addTo(wardGroup);
      });
    }

    // Clicks and taps pick the nearest ward, so small bubbles are still easy to hit with a finger.
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (m.getZoom() < WARD_ZOOM) return;
      let best = -1;
      let bestDistance = Infinity;
      wards.forEach((w, i) => {
        const distance = m.latLngToContainerPoint(w.getLatLng()).distanceTo(e.containerPoint);
        if (distance < bestDistance) [best, bestDistance] = [i, distance];
      });
      if (best < 0) return;
      const metresPerPixel = m.distance(m.containerPointToLatLng([0, 0]), m.containerPointToLatLng([100, 0])) / 100;
      if (bestDistance <= Math.max(wards[best].getRadius() / metresPerPixel, TAP_RADIUS_PX)) cb.current.onSelect(best);
    });

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
    sync();
    map.current = m;
    const empty = () => new Array<L.Circle | null>(wards.length).fill(null);
    layers.current = { wards, rings: empty(), halos: empty(), wardGroup, cityGroup, labels, bubbles };
    return () => {
      m.remove();
      map.current = null;
      layers.current = null;
    };
  }, [groups]);

  // ---------------------------------------------------------------- map controls follow the language (view is kept)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const zoom = L.control.zoom({ position: "bottomright", zoomInTitle: t.map.zoomIn, zoomOutTitle: t.map.zoomOut }).addTo(m);
    const scale = scaleBar(i18n).addTo(m);
    const credit = `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ${t.map.contributors}`;
    m.attributionControl.setPrefix(`<a href="https://leafletjs.com" title="${t.map.leafletTitle}">Leaflet</a>`);
    m.attributionControl.addAttribution(credit);
    if (cursor.current && cursorAt.current) cursor.current.textContent = i18n.f.latLon(cursorAt.current.lat, cursorAt.current.lng, 4);
    return () => {
      if (map.current !== m) return; // the whole map has already been removed
      zoom.remove();
      scale.remove();
      m.attributionControl.removeAttribution(credit);
    };
  }, [i18n, t, groups]);

  // ---------------------------------------------------------------- restyle for the current week / filters / selection
  useEffect(() => {
    const ly = layers.current;
    const m = map.current;
    if (!ly || !m) return;
    data.wards.forEach((_, i) => {
      const level = data.tier[i][k];
      const on = level != null && tiersOn[level];
      const c = ly.wards[i];
      const isSel = selected === i;
      c.setRadius(wardRadiusM(data.predicted[i][k] ?? 0));
      c.setStyle({ fillColor: colorAt(data, i, k), fillOpacity: on ? 0.9 : 0.1, opacity: on ? 1 : 0.2, color: isSel ? "#193b38" : EDGE, weight: isSel ? 3.5 : 1.5 });
      c.setTooltipContent(tipHtml(i18n, data, i, k));
      if (isSel) c.bringToFront();

      // soft glow around High and Critical wards, kept behind every bubble
      const wantHalo = level != null && level >= 2 && tiersOn[level];
      if (wantHalo && !ly.halos[i]) {
        ly.halos[i] = L.circle(c.getLatLng(), { radius: c.getRadius(), className: "halo", stroke: false, fillOpacity: 0.26, interactive: false }).addTo(ly.wardGroup);
      } else if (!wantHalo && ly.halos[i]) {
        ly.halos[i]!.remove();
        ly.halos[i] = null;
      }
      const halo = ly.halos[i];
      if (halo) {
        halo.setRadius(c.getRadius() * 1.6);
        halo.setStyle({ fillColor: TIER_COLOR[TIERS[level!]] });
        if (m.hasLayer(ly.wardGroup)) halo.bringToBack();
      }

      const wantRing = level === 3 && tiersOn[3];
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
      const color = s.worst >= 2 ? TIER_COLOR[TIERS[s.worst]] : "#647571";
      const html = `${b(name)}<span style="color:${color}">${t.map.summary(s.critical, s.high)}</span>`;
      ly.labels[name].setContent(html);
      ly.bubbles[name]
        .setStyle({ fillColor: TIER_COLOR[TIERS[s.worst]] })
        .setRadius(12 + Math.min(s.high + s.critical, 20))
        .setTooltipContent(html);
    }
  }, [data, k, tiersOn, selected, groups, i18n, t, b]);

  // ---------------------------------------------------------------- camera requests from the explorer
  useEffect(() => {
    const m = map.current;
    if (!m || focus.n === 0) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.9;
    m.flyToBounds(focus.city ? cityBounds(focus.city) : EVERYTHING, { duration });
  }, [focus]);

  return (
    <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-line shadow-[var(--shadow)]">
      <div ref={el} className="map-canvas w-full" role="region" aria-label={t.map.streetLabel} />
      <div className="pointer-events-none absolute top-3 right-3 z-[800] flex flex-col items-end gap-2">
        <button onClick={() => map.current?.flyToBounds(DHAKA_AREA, { ...fitOptions(map.current), duration: 0.8 })} className="btn pointer-events-auto !bg-card/90 !px-3 !py-1.5 !text-xs">
          {t.map.dhakaArea}
        </button>
        <span className="kicker rounded-md bg-paper/80 px-2 py-1 !normal-case tabular-nums max-lg:hidden" aria-hidden>
          {t.map.cursor} <span ref={cursor}>—</span>
        </span>
      </div>
    </div>
  );
}
