"""Area Intelligence API.

Reading is public (anyone can look up an area, as the feature is meant for citizens too; set AREA_PUBLIC=false to
require sign-in). Changing the hospital directory or adding localities needs the `hospitals.manage` permission.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query, Request
from pydantic import BaseModel, Field

from ..auth.deps import client_ip, optional_principal, require
from ..auth.service import AuthError, Principal
from . import geocode, hospitals as hz
from .db import AreaDB
from .intel import CITY_RADIUS_KM, bed_outlook, coverage, dengue, environment
from .search import find, gazetteer, search

router = APIRouter()
store_ref: dict = {"get": None, "planner": None}  # main.py points these at its forecasting store and planner


@lru_cache(maxsize=1)
def adb() -> AreaDB:
    return AreaDB()


def store():
    return store_ref["get"]()


def planner():
    get = store_ref.get("planner")
    return get() if get else None


def reader(p: Principal | None = Depends(optional_principal)):
    if os.environ.get("AREA_PUBLIC", "true").lower() == "false" and p is None:
        raise AuthError(401, "not_authenticated", "Please sign in.")
    return p


Reader = Annotated[Principal | None, Depends(reader)]
Manager = Annotated[Principal, Depends(require("hospitals.manage"))]


def wrap(fn, *a, **k):
    try:
        return fn(*a, **k)
    except hz.HospitalError as e:
        raise AuthError(422 if e.code != "not_found" else 404, e.code, str(e))
    except geocode.GeocodeError as e:
        raise AuthError(503 if e.code != "rate_limited" else 429, e.code, str(e))


def resolve(place_id: str) -> dict:
    place = geocode.cached_place(adb(), place_id) if place_id.startswith("osm:") else find(store(), adb(), place_id)
    if not place:
        raise AuthError(404, "location_not_found", "No such location.")
    return place


def overview(place: dict) -> dict:
    cov = coverage(store(), place)
    hs, how = hz.in_area(adb(), place)
    out = {k: place.get(k) for k in ("id", "kind", "name", "name_bn", "district", "district_bn", "division", "division_bn",
                                     "city_corporation", "dataset_city", "ward", "ward_number", "point", "display",
                                     "source", "verified")}
    cc = next((p for p in gazetteer()["places"] if p["kind"] == "city_corporation"
               and p["city_corporation"] == place.get("city_corporation")), None)
    out["city_corporation_name"] = cc["name"] if cc else None
    out["city_corporation_name_bn"] = cc["name_bn"] if cc else None
    out["city_point"] = cc["point"] if cc else None
    out["city_radius_km"] = CITY_RADIUS_KM.get(place.get("city_corporation") or "")
    out["coverage"] = cov
    out["population"] = None  # no verified population source is connected
    out["hospital_count"] = len(hs)
    out["hospital_scope"] = how
    return out


@router.get("/api/locations/search")
def location_search(_: Reader, q: Annotated[str, Query(min_length=1, max_length=100)],
                    limit: Annotated[int, Query(ge=1, le=20)] = 8):
    res = search(store(), adb(), q, limit)
    res["online_available"] = geocode.enabled()
    return res


@router.get("/api/locations/geocode")
def location_geocode(_: Reader, request: Request, q: Annotated[str, Query(min_length=3, max_length=100)]):
    return {"query": q, "results": wrap(geocode.lookup, adb(), q, client_ip(request)),
            "attribution": "© OpenStreetMap contributors (ODbL)"}


@router.get("/api/locations/sources")
def location_sources(_: Reader):
    g = gazetteer()
    return {"gazetteer": {"source": g["source"], "retrieved": g["retrieved"], "note": g["note"]},
            "dengue": {"source": "Dengue Watch dataset (data/dengue_weekly.csv) and its forecasting models",
                       "data_to": str(store().df["date"].max().date())},
            "hospitals": [dict(r) for r in adb().all("SELECT name, kind, url, notes FROM data_sources ORDER BY name")]}


@router.get("/api/locations/{place_id}")
def location_dashboard(_: Reader, place_id: str, beds_as_of: Annotated[str | None, Query(max_length=10)] = None):
    place = resolve(place_id)
    cov = coverage(store(), place)
    hs, how = hz.in_area(adb(), place)
    return {"overview": overview(place), "dengue": dengue(store(), place, cov), "environment": environment(store(), cov),
            "beds": bed_outlook(store(), planner(), cov, beds_as_of),
            "hospitals": {"scope": how, "summary": hz.summary(hs), "items": sorted(hs, key=hz.beds_left_key)}}


@router.get("/api/locations/{place_id}/beds")
def location_beds(_: Reader, place_id: str, as_of: Annotated[str | None, Query(max_length=10)] = None):
    """Beds left: verified hospital reports (when any) and the planning model's estimate for the area."""
    place = resolve(place_id)
    cov = coverage(store(), place)
    hs, how = hz.in_area(adb(), place)
    return {"estimate": bed_outlook(store(), planner(), cov, as_of), "reported": hz.summary(hs),
            "hospitals": sorted(hs, key=hz.beds_left_key)}


@router.get("/api/locations/{place_id}/overview")
def location_overview(_: Reader, place_id: str):
    return overview(resolve(place_id))


@router.get("/api/locations/{place_id}/dengue")
def location_dengue(_: Reader, place_id: str):
    place = resolve(place_id)
    return dengue(store(), place, coverage(store(), place))


@router.get("/api/locations/{place_id}/environment")
def location_environment(_: Reader, place_id: str):
    return environment(store(), coverage(store(), resolve(place_id)))


@router.get("/api/locations/{place_id}/hospitals")
def location_hospitals(_: Reader, place_id: str):
    hs, how = hz.in_area(adb(), resolve(place_id))
    return {"scope": how, "summary": hz.summary(hs), "items": hs}


@router.get("/api/hospitals/nearby")
def hospitals_nearby(_: Reader, lat: Annotated[float, Query(ge=20.3, le=26.8)], lon: Annotated[float, Query(ge=88.0, le=92.8)],
                     radius_km: Annotated[float, Query(gt=0, le=50)] = 10,
                     type: Literal["government", "private", "autonomous", "ngo", "military", "other"] | None = None,
                     emergency: bool = False, available: bool = False):
    hs = hz.nearby(adb(), lat, lon, radius_km)
    if type:
        hs = [h for h in hs if h["type"] == type]
    if emergency:
        hs = [h for h in hs if h["has_emergency"]]
    if available:  # only verified, recent reports count, never registered capacity
        hs = [h for h in hs if h["availability"]["status"] in ("live", "reported") and (h["availability"]["available_beds"] or 0) > 0]
    return {"summary": hz.summary(hs), "items": hs}


@router.get("/api/hospitals/{hospital_id}")
def hospital_detail(_: Reader, hospital_id: int):
    h = hz.get(adb(), hospital_id)
    if not h:
        raise AuthError(404, "not_found", "No such hospital.")
    return h


# ------------------------------------------------------------------------------------------------ administration
class HospitalIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=200)]
    name_bn: Annotated[str, Field(max_length=200)] | None = None
    type: Literal["government", "private", "autonomous", "ngo", "military", "other"]
    address: Annotated[str, Field(max_length=300)] = ""
    city_corporation: Annotated[str, Field(max_length=10)] | None = None
    district: Annotated[str, Field(min_length=2, max_length=60)]
    division: Annotated[str, Field(min_length=2, max_length=60)]
    lat: float | None = None
    lon: float | None = None
    phone: Annotated[str, Field(max_length=60)] | None = None
    emergency_phone: Annotated[str, Field(max_length=60)] | None = None
    has_emergency: bool | None = None
    registered_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    icu_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    source: Annotated[str, Field(min_length=2, max_length=120)] = Field(description="Where these facts come from")
    source_ref: Annotated[str, Field(max_length=300)] | None = None


class HospitalPatch(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    name_bn: Annotated[str, Field(max_length=200)] | None = None
    type: Literal["government", "private", "autonomous", "ngo", "military", "other"] | None = None
    address: Annotated[str, Field(max_length=300)] | None = None
    city_corporation: Annotated[str, Field(max_length=10)] | None = None
    district: Annotated[str, Field(max_length=60)] | None = None
    division: Annotated[str, Field(max_length=60)] | None = None
    lat: float | None = None
    lon: float | None = None
    phone: Annotated[str, Field(max_length=60)] | None = None
    emergency_phone: Annotated[str, Field(max_length=60)] | None = None
    has_emergency: bool | None = None
    registered_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    icu_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    source_ref: Annotated[str, Field(max_length=300)] | None = None
    active: bool | None = None


@router.get("/api/admin/hospitals")
def admin_hospitals(_: Manager):
    return {"items": hz.admin_list(adb()), "sources": adb().all("SELECT * FROM data_sources ORDER BY name"),
            "localities": adb().all("SELECT * FROM localities ORDER BY name")}


@router.post("/api/hospitals", status_code=201)
def hospital_create(body: HospitalIn, p: Manager):
    data = body.model_dump()
    hid = wrap(hz.create, adb(), data, p.id, data.pop("source"))
    return hz.get(adb(), hid, include_inactive=True)


@router.patch("/api/hospitals/{hospital_id}")
def hospital_update(hospital_id: int, body: HospitalPatch, _: Manager):
    if not hz.get(adb(), hospital_id, include_inactive=True):
        raise AuthError(404, "not_found", "No such hospital.")
    wrap(hz.update, adb(), hospital_id, body.model_dump(exclude_unset=True))
    return hz.get(adb(), hospital_id, include_inactive=True)


class VerifyIn(BaseModel):
    source_ref: Annotated[str, Field(min_length=3, max_length=300)] = Field(description="What you checked it against")


@router.post("/api/hospitals/{hospital_id}/verify")
def hospital_verify(hospital_id: int, body: VerifyIn, p: Manager):
    if not hz.get(adb(), hospital_id, include_inactive=True):
        raise AuthError(404, "not_found", "No such hospital.")
    hz.verify(adb(), hospital_id, p.id, body.source_ref)
    return hz.get(adb(), hospital_id, include_inactive=True)


class BedsIn(BaseModel):
    available_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    occupied_beds: Annotated[int, Field(ge=0, le=20000)] | None = None
    icu_available: Annotated[int, Field(ge=0, le=20000)] | None = None
    reported_at: Annotated[str, Field(max_length=40)] | None = None
    source_ref: Annotated[str, Field(min_length=3, max_length=200)]
    verified: bool = False


@router.post("/api/hospitals/{hospital_id}/beds", status_code=201)
def hospital_beds(hospital_id: int, body: BedsIn, p: Manager):
    wrap(hz.record_beds, adb(), hospital_id, body.model_dump(), p.id)
    return hz.get(adb(), hospital_id, include_inactive=True)


@router.post("/api/hospitals/import")
def hospital_import(p: Manager, csv_text: Annotated[str, Body(embed=True, max_length=2_000_000)],
                    source: Annotated[str, Body(embed=True, min_length=2, max_length=120)]):
    return wrap(hz.import_csv, adb(), csv_text, source, p.id)


class LocalityIn(BaseModel):
    name: Annotated[str, Field(min_length=2, max_length=120)]
    name_bn: Annotated[str, Field(max_length=120)] | None = None
    aliases: list[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=20)
    city_corporation: Literal["DNCC", "DSCC", "CCC", "GCC", "NCC", "KCC", "RCC", "SCC", "BCC", "RpCC", "CuCC", "MCC"] | None = None
    district: Annotated[str, Field(min_length=2, max_length=60)]
    division: Annotated[str, Field(min_length=2, max_length=60)]
    lat: float
    lon: float
    source: Annotated[str, Field(min_length=2, max_length=120)]
    verified: bool = False


@router.post("/api/locations", status_code=201)
def locality_add(body: LocalityIn, p: Manager):
    lid = wrap(hz.add_locality, adb(), body.model_dump(), p.id)
    return {"id": f"loc:{lid}"}


@router.delete("/api/locations/{place_id}")
def locality_delete(place_id: str, _: Manager):
    if not place_id.startswith("loc:"):
        raise AuthError(422, "not_deletable", "Only administrator-added localities can be removed.")
    adb().run("DELETE FROM localities WHERE id = ?", (int(place_id[4:]),))
    return {"ok": True}
