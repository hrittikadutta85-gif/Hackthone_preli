"""Hospital directory: administrator-managed, separate from the dengue dataset.

Rules this module keeps:
* Registered capacity (registered_beds, icu_beds) and current availability (bed_updates) are separate things.
  Capacity never implies availability.
* Availability counts only from verified updates. An update is "live" only when it came from a connected API in the
  last AREA_LIVE_MINUTES; a manual update is "last reported" with its time; older than AREA_FRESH_HOURS it is stale and
  not added to totals. With nothing usable, the answer is "Live bed availability unavailable".
* Nothing is invented: unknown values stay null and are shown as "Data unavailable".
"""
from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone

from .db import AreaDB, iso, parse
from .intel import km

TYPES = ("government", "private", "autonomous", "ngo", "military", "other")
FRESH_HOURS = int(os.environ.get("AREA_FRESH_HOURS", "24"))
LIVE_MINUTES = int(os.environ.get("AREA_LIVE_MINUTES", "30"))
EDITABLE = ("name", "name_bn", "type", "address", "city_corporation", "district", "division", "lat", "lon", "phone",
            "emergency_phone", "has_emergency", "registered_beds", "icu_beds", "source_ref")


class HospitalError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def now() -> datetime:
    return datetime.now(timezone.utc)


def availability(db: AreaDB, hospital_id: int) -> dict:
    u = db.one("SELECT * FROM bed_updates WHERE hospital_id = ? AND verified = 1 ORDER BY reported_at DESC, id DESC LIMIT 1",
               (hospital_id,))
    if not u:
        return {"status": "unavailable"}
    age_h = (now() - parse(u["reported_at"])).total_seconds() / 3600
    if u["method"] == "api" and age_h * 60 <= LIVE_MINUTES:
        status = "live"
    elif age_h <= FRESH_HOURS:
        status = "reported"
    else:
        status = "stale"
    return {"status": status, "available_beds": u["available_beds"], "occupied_beds": u["occupied_beds"],
            "icu_available": u["icu_available"], "reported_at": u["reported_at"], "method": u["method"],
            "source_ref": u["source_ref"], "age_hours": round(age_h, 1)}


def view(db: AreaDB, h: dict, origin: list[float] | None = None) -> dict:
    out = {k: h[k] for k in ("id", "name", "name_bn", "type", "address", "city_corporation", "district", "division",
                             "lat", "lon", "phone", "emergency_phone", "registered_beds", "icu_beds", "source_ref",
                             "verified_at", "updated_at")}
    out["has_emergency"] = None if h["has_emergency"] is None else bool(h["has_emergency"])
    out["verified"] = bool(h["verified"])
    out["active"] = bool(h["active"])
    out["source"] = h.get("source")
    out["availability"] = availability(db, h["id"])
    out["distance_km"] = round(km(origin, (h["lat"], h["lon"])), 2) if origin and h["lat"] is not None else None
    if h["lat"] is not None:
        out["directions"] = f"https://www.openstreetmap.org/directions?to={h['lat']}%2C{h['lon']}"
    return out


BASE = "SELECT h.*, s.name AS source FROM hospitals h LEFT JOIN data_sources s ON s.id = h.source_id"


def in_area(db: AreaDB, place: dict, radius_km: float = 10.0) -> tuple[list[dict], str]:
    """Hospitals for a place, and how they were chosen (area | nearby)."""
    kind = place["kind"]
    point = place.get("point")
    if kind in ("neighbourhood", "locality", "osm") and point:
        return nearby(db, point[0], point[1], radius_km), "nearby"
    if kind in ("ward", "city_corporation"):
        rows = db.all(BASE + " WHERE h.active = 1 AND h.city_corporation = ?", (place["city_corporation"],))
    elif kind == "district":
        rows = db.all(BASE + " WHERE h.active = 1 AND h.district = ?", (place["name"],))
    elif kind == "division":
        rows = db.all(BASE + " WHERE h.active = 1 AND h.division = ?", (place["name"],))
    else:
        rows = []
    out = [view(db, r, point) for r in rows]
    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0, x["name"]))
    return out, "area"


def nearby(db: AreaDB, lat: float, lon: float, radius_km: float = 10.0) -> list[dict]:
    # bounding box first, exact distance after
    dlat, dlon = radius_km / 110.6, radius_km / (111.3 * max(0.2, abs(__import__("math").cos(__import__("math").radians(lat)))))
    rows = db.all(BASE + " WHERE h.active = 1 AND h.lat BETWEEN ? AND ? AND h.lon BETWEEN ? AND ?",
                  (lat - dlat, lat + dlat, lon - dlon, lon + dlon))
    out = [view(db, r, [lat, lon]) for r in rows]
    out = [h for h in out if h["distance_km"] is not None and h["distance_km"] <= radius_km]
    return sorted(out, key=lambda h: h["distance_km"])


def beds_left_key(h: dict):
    """Most verified free beds first, then nearest; hospitals without a usable report after them."""
    a = h["availability"]
    usable = a["status"] in ("live", "reported") and a.get("available_beds") is not None
    return (not usable, -(a.get("available_beds") or 0) if usable else 0,
            h["distance_km"] if h["distance_km"] is not None else 1e9, h["name"])


def summary(hospitals: list[dict]) -> dict:
    def total(key, src=None):
        vals = [(h if src is None else h[src]).get(key) for h in hospitals]
        known = [v for v in vals if v is not None]
        return {"value": sum(known) if known else None, "reported_by": len(known), "of": len(hospitals)}

    usable = [h for h in hospitals if h["availability"]["status"] in ("live", "reported")]
    avail = {k: {"value": sum(v for v in (h["availability"].get(k) for h in usable) if v is not None) if any(
        h["availability"].get(k) is not None for h in usable) else None,
        "reported_by": sum(h["availability"].get(k) is not None for h in usable), "of": len(hospitals)}
        for k in ("available_beds", "occupied_beds", "icu_available")}
    latest = max((h["availability"]["reported_at"] for h in usable), default=None)
    return {"total": len(hospitals), "government": sum(h["type"] == "government" for h in hospitals),
            "private": sum(h["type"] == "private" for h in hospitals),
            "other": sum(h["type"] not in ("government", "private") for h in hospitals),
            "verified": sum(h["verified"] for h in hospitals), "with_emergency": sum(bool(h["has_emergency"]) for h in hospitals),
            "registered_beds": total("registered_beds"), "icu_beds": total("icu_beds"), "availability": avail,
            "live": any(h["availability"]["status"] == "live" for h in usable), "latest_report": latest,
            "closest_with_beds": next(({"id": h["id"], "name": h["name"], "distance_km": h["distance_km"],
                                        "available_beds": h["availability"]["available_beds"],
                                        "reported_at": h["availability"]["reported_at"]}
                                       for h in sorted(usable, key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0))
                                       if (h["availability"].get("available_beds") or 0) > 0), None)}


# ------------------------------------------------------------------------------------------------- editing
def clean(data: dict, partial: bool = False) -> dict:
    out = {}
    for k in EDITABLE:
        if k not in data:
            continue
        v = data[k]
        if isinstance(v, str):
            v = v.strip() or None
        if k == "type" and v not in TYPES:
            raise HospitalError("invalid_type", f"Type must be one of {', '.join(TYPES)}.")
        if k in ("registered_beds", "icu_beds") and v is not None and (int(v) < 0 or int(v) > 20000):
            raise HospitalError("invalid_beds", "Bed counts must be between 0 and 20000.")
        if k == "lat" and v is not None and not 20.3 <= float(v) <= 26.8:
            raise HospitalError("invalid_location", "Latitude must be inside Bangladesh (20.3 to 26.8).")
        if k == "lon" and v is not None and not 88.0 <= float(v) <= 92.8:
            raise HospitalError("invalid_location", "Longitude must be inside Bangladesh (88.0 to 92.8).")
        if k == "has_emergency" and v is not None:
            v = int(bool(v))
        out[k] = v
    if not partial:
        for k in ("name", "type", "district", "division"):
            if not out.get(k):
                raise HospitalError("missing_field", f"{k} is required.")
        if (out.get("lat") is None) != (out.get("lon") is None):
            raise HospitalError("invalid_location", "Give both latitude and longitude, or neither.")
    return out


def create(db: AreaDB, data: dict, actor: int | None, source: str, source_kind: str = "admin_entry",
           external_id: str | None = None) -> int:
    fields = clean(data)
    t = iso(now())
    fields.update(source_id=db.source_id(source, source_kind), created_by=actor, created_at=t, updated_at=t,
                  external_id=external_id)
    cols = ", ".join(fields)
    return db.run(f"INSERT INTO hospitals({cols}) VALUES ({', '.join('?' * len(fields))})", tuple(fields.values())).lastrowid


def update(db: AreaDB, hospital_id: int, data: dict) -> None:
    fields = clean(data, partial=True)
    if "active" in data:
        fields["active"] = int(bool(data["active"]))
    if not fields:
        return
    # editing facts invalidates an earlier verification: someone must check the new values
    sets = ", ".join(f"{k} = ?" for k in fields)
    db.run(f"UPDATE hospitals SET {sets}, verified = 0, verified_by = NULL, verified_at = NULL, updated_at = ? WHERE id = ?",
           (*fields.values(), iso(now()), hospital_id))


def verify(db: AreaDB, hospital_id: int, actor: int, source_ref: str | None) -> None:
    db.run("UPDATE hospitals SET verified = 1, verified_by = ?, verified_at = ?, source_ref = COALESCE(?, source_ref), "
           "updated_at = ? WHERE id = ?", (actor, iso(now()), source_ref, iso(now()), hospital_id))


def record_beds(db: AreaDB, hospital_id: int, data: dict, actor: int | None, method: str = "manual") -> int:
    h = db.one("SELECT registered_beds, icu_beds FROM hospitals WHERE id = ?", (hospital_id,))
    if not h:
        raise HospitalError("not_found", "No such hospital.")
    for k in ("available_beds", "occupied_beds", "icu_available"):
        v = data.get(k)
        if v is not None and (int(v) < 0 or int(v) > 20000):
            raise HospitalError("invalid_beds", "Bed counts must be between 0 and 20000.")
    if data.get("available_beds") is None and data.get("occupied_beds") is None and data.get("icu_available") is None:
        raise HospitalError("missing_field", "Give at least one number.")
    if not data.get("source_ref"):
        raise HospitalError("missing_field", "Say who reported these numbers (e.g. 'phone call to duty manager').")
    reported = data.get("reported_at")
    try:
        reported_dt = datetime.fromisoformat(reported.replace("Z", "+00:00")) if reported else now()
    except ValueError:
        raise HospitalError("invalid_time", "reported_at must be an ISO date-time.")
    if reported_dt.tzinfo is None:
        reported_dt = reported_dt.replace(tzinfo=timezone(timedelta(hours=6)))  # Bangladesh time when not given
    if reported_dt > now() + timedelta(minutes=5):
        raise HospitalError("invalid_time", "reported_at cannot be in the future.")
    return db.run("INSERT INTO bed_updates(hospital_id, available_beds, occupied_beds, icu_available, reported_at, recorded_at, "
                  "method, source_ref, verified, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (hospital_id, data.get("available_beds"), data.get("occupied_beds"), data.get("icu_available"),
                   iso(reported_dt), iso(now()), method, data["source_ref"], int(bool(data.get("verified"))), actor)).lastrowid


CSV_COLUMNS = ["name", "name_bn", "type", "address", "city_corporation", "district", "division", "lat", "lon", "phone",
               "emergency_phone", "has_emergency", "registered_beds", "icu_beds", "source_ref"]


def import_csv(db: AreaDB, text: str, source: str, actor: int | None) -> dict:
    """Bulk-load hospitals (e.g. an export from the DGHS Facility Registry). Rows arrive unverified."""
    reader = csv.DictReader(io.StringIO(text))
    missing = {"name", "type", "district", "division"} - set(reader.fieldnames or [])
    if missing:
        raise HospitalError("bad_csv", f"Missing columns: {', '.join(sorted(missing))}.")
    added, errors = 0, []
    for i, row in enumerate(reader, start=2):
        data = {k: row.get(k) for k in CSV_COLUMNS if k in row}
        for k in ("lat", "lon"):
            data[k] = float(data[k]) if data.get(k) else None
        for k in ("registered_beds", "icu_beds"):
            data[k] = int(float(data[k])) if data.get(k) else None
        if data.get("has_emergency") not in (None, ""):
            data["has_emergency"] = str(data["has_emergency"]).strip().lower() in ("1", "yes", "true", "y")
        else:
            data["has_emergency"] = None
        data["type"] = (data.get("type") or "").strip().lower()
        try:
            create(db, data, actor, source, "csv_import")
            added += 1
        except (HospitalError, ValueError) as e:
            errors.append({"line": i, "error": str(e)})
    return {"added": added, "errors": errors[:50]}


def sync_fred(db: AreaDB) -> dict:
    """Pull facilities from a FRED-compatible registry (the DGHS Facility Registry follows the Facility Registry 1.0
    spec). Needs FACILITY_REGISTRY_URL and credentials from DGHS; written against the published spec and not tested
    against the live server. Imported rows are unverified and carry no bed availability."""
    import requests
    base = os.environ.get("FACILITY_REGISTRY_URL", "").rstrip("/")
    token = os.environ.get("FACILITY_REGISTRY_TOKEN", "")
    header = os.environ.get("FACILITY_REGISTRY_AUTH_HEADER", "X-Auth-Token")
    if not base or not token:
        raise HospitalError("not_configured", "Set FACILITY_REGISTRY_URL and FACILITY_REGISTRY_TOKEN first.")
    src = db.source_id("DGHS Facility Registry", "official_registry", base)
    added = updated = 0
    offset = 0
    while True:
        r = requests.get(f"{base}/facilities/list", params={"limit": 100, "offset": offset}, headers={header: token}, timeout=30)
        r.raise_for_status()
        items = r.json() if isinstance(r.json(), list) else r.json().get("facilities", [])
        if not items:
            break
        for f in items:
            props = f.get("properties") or {}
            coords = f.get("coordinates") or [None, None]
            ext = f"fred:{f.get('id')}"
            data = {"name": f.get("name"), "type": "government" if "gov" in str(props.get("ownership", "")).lower() else "other",
                    "district": props.get("district") or props.get("zilla") or "", "division": props.get("division") or "",
                    "address": props.get("address") or "", "lat": coords[1], "lon": coords[0]}
            row = db.one("SELECT id FROM hospitals WHERE external_id = ?", (ext,))
            try:
                if row:
                    update(db, row["id"], data)
                    updated += 1
                else:
                    hid = create(db, data, None, "DGHS Facility Registry", "official_registry", external_id=ext)
                    db.run("UPDATE hospitals SET source_id = ? WHERE id = ?", (src, hid))
                    added += 1
            except HospitalError:
                continue
        offset += len(items)
    return {"added": added, "updated": updated}


def get(db: AreaDB, hospital_id: int, include_inactive: bool = False) -> dict | None:
    row = db.one(BASE + " WHERE h.id = ?" + ("" if include_inactive else " AND h.active = 1"), (hospital_id,))
    if not row:
        return None
    out = view(db, row)
    out["history"] = db.all("SELECT available_beds, occupied_beds, icu_available, reported_at, method, source_ref, verified "
                            "FROM bed_updates WHERE hospital_id = ? ORDER BY reported_at DESC LIMIT 20", (hospital_id,))
    for u in out["history"]:
        u["verified"] = bool(u["verified"])
    return out


def admin_list(db: AreaDB) -> list[dict]:
    return [view(db, r) for r in db.all(BASE + " ORDER BY h.active DESC, h.verified, h.name")]


def add_locality(db: AreaDB, data: dict, actor: int | None) -> int:
    for k in ("name", "district", "division"):
        if not (data.get(k) or "").strip():
            raise HospitalError("missing_field", f"{k} is required.")
    lat, lon = data.get("lat"), data.get("lon")
    if lat is None or lon is None or not (20.3 <= float(lat) <= 26.8 and 88.0 <= float(lon) <= 92.8):
        raise HospitalError("invalid_location", "Give a latitude and longitude inside Bangladesh.")
    if not (data.get("source") or "").strip():
        raise HospitalError("missing_field", "Say where the location came from (survey, map, official list).")
    t = iso(now())
    return db.run("INSERT INTO localities(name, name_bn, aliases, city_corporation, district, division, lat, lon, source_id, "
                  "verified, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (data["name"].strip(), (data.get("name_bn") or "").strip() or None,
                   json.dumps([a.strip() for a in data.get("aliases", []) if a.strip()], ensure_ascii=False),
                   data.get("city_corporation") or None, data["district"].strip(), data["division"].strip(), float(lat),
                   float(lon), db.source_id(data["source"].strip(), "admin_entry"), int(bool(data.get("verified"))), actor,
                   t, t)).lastrowid
