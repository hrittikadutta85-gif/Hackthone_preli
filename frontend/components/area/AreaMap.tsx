"use client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Hospital } from "@/lib/area";
import { useI18n } from "@/lib/i18n";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TEAL = "#287f75";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Searched place, the approximate city-corporation area, and hospitals with a known position. */
export default function AreaMap({
  point,
  cityPoint,
  cityRadiusKm,
  hospitals,
  placeLabel,
}: {
  point: [number, number] | null;
  cityPoint: [number, number] | null;
  cityRadiusKm: number | null;
  hospitals: Hospital[];
  placeLabel: string;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([23.7, 90.4], 7);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (cityPoint && cityRadiusKm) {
      L.circle(cityPoint, { radius: cityRadiusKm * 1000, color: TEAL, weight: 1, opacity: 0.6, fillOpacity: 0.06, dashArray: "4 6" })
        .bindTooltip(t.area.hospitals.mapLegendCity)
        .addTo(g);
      const b = L.latLng(cityPoint).toBounds(cityRadiusKm * 2000);
      bounds.push(b.getNorthEast(), b.getSouthWest());
    }
    if (point) {
      L.circleMarker(point, { radius: 9, color: "#ffffff", weight: 2, fillColor: TEAL, fillOpacity: 1 }).bindTooltip(esc(placeLabel), { permanent: false }).addTo(g);
      L.circleMarker(point, { radius: 18, color: TEAL, weight: 1, opacity: 0.5, fill: false }).addTo(g);
      bounds.push(point);
    }
    for (const h of hospitals) {
      if (h.lat == null || h.lon == null) continue;
      const html = `<strong>${esc(h.name)}</strong><br>${esc(t.area.hospitals.types[h.type] ?? h.type)}${h.distance_km != null ? ` · ${h.distance_km} km` : ""}${h.phone ? `<br>${esc(h.phone)}` : ""}`;
      L.circleMarker([h.lat, h.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: h.type === "government" ? "#3f7fc0" : "#647571", fillOpacity: 1 })
        .bindPopup(html)
        .addTo(g);
      bounds.push([h.lat, h.lon]);
    }
    if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
    else if (bounds.length === 1) m.setView(bounds[0], 13);
  }, [point, cityPoint, cityRadiusKm, hospitals, placeLabel, t]);

  return <div ref={el} className="h-80 w-full overflow-hidden rounded-xl border border-line sm:h-96" role="region" aria-label={t.area.hospitals.map} />;
}
