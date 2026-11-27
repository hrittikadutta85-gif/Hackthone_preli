"""Optional online place lookup (OpenStreetMap Nominatim) for places the bundled gazetteer does not have.

Only used when a person explicitly asks to search online, never on every keystroke: Nominatim's usage policy forbids
autocomplete use. At most one request a second for the whole server, results cached, a generic client name (no
personal details). Turn off with GEOCODER=off; point NOMINATIM_URL at your own instance for heavy use.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone

import requests

from .db import AreaDB, iso
from .search import gazetteer, normalise

_lock = threading.Lock()
_last = [0.0]
_per_ip: dict[str, list[float]] = {}


class GeocodeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def enabled() -> bool:
    return os.environ.get("GEOCODER", "nominatim").lower() != "off"


def _district_of(addr: dict) -> tuple[str | None, str | None]:
    """Match Nominatim's address parts to gazetteer district/division names."""
    text = " ".join(str(v) for v in addr.values()).lower()
    places = gazetteer()["places"]
    district = next((p for p in places if p["kind"] == "district" and (p["name"].lower() in text or p["name_bn"] in text
                                                                     or any(a.lower() in text for a in p["aliases"]))), None)
    if district:
        return district["name"], district["division"]
    division = next((p for p in places if p["kind"] == "division" and (p["name"].lower() in text or p["name_bn"] in text)), None)
    return None, division["name"] if division else None


def lookup(db: AreaDB, query: str, ip: str | None) -> list[dict]:
    if not enabled():
        raise GeocodeError("geocoder_off", "Online place search is turned off on this server.")
    key = normalise(query)
    if len(key) < 3:
        return []
    cached = db.one("SELECT results FROM geocode_cache WHERE query = ?", (key,))
    if cached:
        return json.loads(cached["results"])
    now = time.time()
    hits = [t for t in _per_ip.get(ip or "", []) if now - t < 3600]
    if len(hits) >= 30:
        raise GeocodeError("rate_limited", "Too many online searches. Try again later.")
    _per_ip[ip or ""] = hits + [now]
    base = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org").rstrip("/")
    with _lock:
        wait = 1.1 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = requests.get(f"{base}/search", timeout=12, headers={"User-Agent": os.environ.get("GEOCODER_USER_AGENT", "DengueWatch-Server/2.0")},
                             params={"q": query, "format": "jsonv2", "countrycodes": "bd", "addressdetails": 1, "limit": 6,
                                     "accept-language": "en"})
            r.raise_for_status()
            raw = r.json()
        except requests.RequestException as e:
            raise GeocodeError("geocoder_unreachable", f"Online place search is unreachable ({type(e).__name__}).")
    out = []
    t = iso(datetime.now(timezone.utc))
    for x in raw:
        addr = x.get("address") or {}
        district, division = _district_of(addr)
        pid = f"osm:{x.get('osm_type', 'x')[:1].upper()}{x.get('osm_id')}"
        place = {"id": pid, "kind": "osm", "name": x.get("name") or x["display_name"].split(",")[0],
                 "name_bn": None, "display": x["display_name"], "osm_type": x.get("addresstype") or x.get("type"),
                 "district": district, "division": division, "city_corporation": None,
                 "point": [round(float(x["lat"]), 5), round(float(x["lon"]), 5)],
                 "source": "OpenStreetMap Nominatim (© OpenStreetMap contributors, ODbL)", "fetched_at": t}
        db.run("INSERT OR REPLACE INTO osm_places(id, data, fetched_at) VALUES (?,?,?)", (pid, json.dumps(place, ensure_ascii=False), t))
        out.append(place)
    db.run("INSERT OR REPLACE INTO geocode_cache(query, results, fetched_at) VALUES (?,?,?)", (key, json.dumps(out, ensure_ascii=False), t))
    return out


def cached_place(db: AreaDB, pid: str) -> dict | None:
    row = db.one("SELECT data FROM osm_places WHERE id = ?", (pid,))
    return json.loads(row["data"]) if row else None
