"""Area Intelligence: location search, coverage honesty, and the hospital directory's data rules."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.area import hospitals as hz
from backend.area import routes as area_routes
from backend.area.db import AreaDB
from backend.area.intel import bed_outlook, coverage, dengue, environment
from backend.planner import Planner
from dengue_ews import operations as ops
from backend.area.search import find, search
from backend.service import Store
from dengue_ews.config import MODEL_PATH

pytestmark = pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")


@pytest.fixture(scope="module")
def store():
    return Store()


@pytest.fixture
def db(tmp_path):
    return AreaDB(tmp_path / "area.sqlite3")


def ids(res):
    return [r["id"] for r in res["results"]]


# ------------------------------------------------------------------------------------------------ search
@pytest.mark.parametrize("q, expected", [
    ("Chittagong", "dist:chattogram"), ("Comilla", "dist:cumilla"), ("Jessore", "dist:jashore"),
    ("coxs bazar", "dist:cox-s-bazar"), ("চট্টগ্রাম", "dist:chattogram"), ("Agrabad", "nb:agrabad"),
    ("Dhanmondhi", "nb:dhanmondi"), ("chatt", "dist:chattogram"), ("Barisal", "div:barishal"),
    ("Dhaka North", "cc:DNCC"), ("CCC ward 3", "ward:CCC_Ward_03"),
])
def test_search_handles_partial_names_and_spelling_variants(store, db, q, expected):
    assert expected in ids(search(store, db, q, limit=10)), (q, ids(search(store, db, q, limit=10)))


def test_unknown_neighbourhood_is_reported_not_guessed(store, db):
    res = search(store, db, "Mojjafor Nogor, Chattogram")
    assert res["partial"] and set(res["unmatched"]) == {"mojjafor", "nogor"}
    assert res["results"] and all("Chattogram" in (r.get("district") or "") + (r.get("division") or "") for r in res["results"])
    assert search(store, db, "qzxwv")["results"] == []


def test_admin_added_locality_becomes_searchable(store, db):
    hz.add_locality(db, {"name": "Test Para", "aliases": ["Test Nagar"], "city_corporation": "CCC", "district": "Chattogram",
                         "division": "Chattogram", "lat": 22.36, "lon": 91.82, "source": "field survey"}, None)
    hit = search(store, db, "test nogor")["results"][0]
    assert hit["kind"] == "locality" and hit["point"] == [22.36, 91.82]


# ------------------------------------------------------------------------------------------------ coverage
def test_coverage_never_borrows_another_places_forecast(store, db):
    get = lambda pid: find(store, db, pid)  # noqa: E731
    assert coverage(store, get("ward:CCC_Ward_03")) == {"level": "ward", "cities": ["CCC"], "wards": ["CCC_Ward_03"]}
    city = coverage(store, get("cc:CCC"))
    assert city["level"] == "city" and len(city["wards"]) == 10
    assert coverage(store, get("cc:KCC"))["level"] == "none"              # Khulna is not in the dataset
    assert coverage(store, get("dist:cox-s-bazar"))["level"] == "none"
    assert coverage(store, get("nb:agrabad"))["level"] == "city_context"   # city totals, labelled as such
    assert coverage(store, get("dist:chattogram")) == {"level": "district_partial", "cities": ["CCC"], "wards": city["wards"]}
    inside = {"kind": "osm", "point": [22.35, 91.82], "city_corporation": None}
    outside = {"kind": "osm", "point": [21.44, 91.98], "city_corporation": None}
    assert coverage(store, inside)["level"] == "city_context"
    far = coverage(store, outside)
    assert far["level"] == "none" and far["nearest"]["city_corporation"] == "CCC"
    assert dengue(store, outside, far) == {"available": False} and environment(store, far) == {"available": False}


def test_ward_dengue_matches_the_existing_forecasts(store, db):
    place = find(store, db, "ward:DSCC_Ward_04")
    d = dengue(store, place, coverage(store, place))
    o = store.origins[-1]
    p = store.preds[(store.preds["ward_id"] == "DSCC_Ward_04") & (store.preds["origin_date"] == o)].sort_values("horizon")
    assert [h["predicted"] for h in d["horizons"]] == [round(float(v), 1) for v in p["predicted"]]
    assert [h["tier"] for h in d["horizons"]] == list(p["tier"])
    assert d["risk_factors"] and d["actions"] and len(d["trend"]) == 52


def test_city_totals_add_up_over_its_wards(store, db):
    place = find(store, db, "cc:GCC")
    d = dengue(store, place, coverage(store, place))
    o = store.origins[-1]
    p = store.preds[(store.preds["city"] == "Gazipur") & (store.preds["origin_date"] == o) & (store.preds["horizon"] == 1)]
    assert d["horizons"][0]["predicted"] == round(float(p["predicted"].sum()), 1)
    assert sum(d["horizons"][0]["tier_counts"].values()) == 5 and d["interval_note"] == "summed"
    env = environment(store, coverage(store, place))
    assert 0 <= env["sanitation_score"] <= 1 and env["facility_counts"] is None and 0 <= env["vulnerability_index"] <= 100


# ------------------------------------------------------------------------------------------------ hospitals
HOSP = {"name": "Example General Hospital", "type": "government", "district": "Chattogram", "division": "Chattogram",
        "city_corporation": "CCC", "lat": 22.34, "lon": 91.83, "registered_beds": 120, "icu_beds": 10}


def test_capacity_never_implies_availability(db):
    hid = hz.create(db, HOSP, None, "test entry")
    h = hz.get(db, hid)
    assert h["registered_beds"] == 120 and h["availability"] == {"status": "unavailable"} and not h["verified"]
    s = hz.summary([h])
    assert s["registered_beds"]["value"] == 120 and s["availability"]["available_beds"]["value"] is None and not s["live"]
    hz.record_beds(db, hid, {"available_beds": 30, "source_ref": "phone call"}, None)  # not verified: ignored
    assert hz.get(db, hid)["availability"]["status"] == "unavailable"
    hz.record_beds(db, hid, {"available_beds": 25, "occupied_beds": 95, "source_ref": "duty manager", "verified": True}, None)
    a = hz.get(db, hid)["availability"]
    assert a["status"] == "reported" and a["available_beds"] == 25        # manual report: never called "live"
    assert hz.summary([hz.get(db, hid)])["availability"]["available_beds"]["value"] == 25


def test_old_reports_are_stale_and_not_counted(db):
    hid = hz.create(db, HOSP, None, "test entry")
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    hz.record_beds(db, hid, {"available_beds": 40, "source_ref": "bulletin", "verified": True, "reported_at": old}, None)
    h = hz.get(db, hid)
    assert h["availability"]["status"] == "stale"
    assert hz.summary([h])["availability"]["available_beds"]["value"] is None


def test_editing_clears_verification_and_rules_are_enforced(db):
    hid = hz.create(db, HOSP, None, "test entry")
    hz.verify(db, hid, 1, "DGHS facility list")
    assert hz.get(db, hid)["verified"]
    hz.update(db, hid, {"registered_beds": 150})
    assert not hz.get(db, hid)["verified"]
    with pytest.raises(hz.HospitalError):
        hz.create(db, {**HOSP, "type": "clinic"}, None, "x")
    with pytest.raises(hz.HospitalError):
        hz.create(db, {**HOSP, "lat": 40.0}, None, "x")
    with pytest.raises(hz.HospitalError):
        hz.record_beds(db, hid, {"available_beds": 5}, None)  # who reported it is required
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    with pytest.raises(hz.HospitalError):
        hz.record_beds(db, hid, {"available_beds": 5, "source_ref": "x", "reported_at": future}, None)


def test_nearby_and_csv_import(db):
    csv_text = ("name,type,district,division,lat,lon,registered_beds\n"
                "Near Clinic,private,Chattogram,Chattogram,22.335,91.832,40\n"
                "Far Hospital,government,Cox's Bazar,Chattogram,21.44,91.98,250\n"
                "Broken Row,clinic,Chattogram,Chattogram,,,\n")
    res = hz.import_csv(db, csv_text, "CSV test", None)
    assert res["added"] == 2 and res["errors"][0]["line"] == 4
    near = hz.nearby(db, 22.33378, 91.83443, 5)
    assert [h["name"] for h in near] == ["Near Clinic"] and near[0]["distance_km"] < 1
    assert near[0]["directions"].startswith("https://www.openstreetmap.org/directions")


def test_area_api_is_public_to_read_and_admin_only_to_write(store, tmp_path, monkeypatch):
    main.state["store"] = store
    area_routes.adb.cache_clear()
    monkeypatch.setenv("AREA_DB", str(tmp_path / "api.sqlite3"))
    try:
        tc = TestClient(main.app)
        r = tc.get("/api/locations/search", params={"q": "Chittagong"})
        assert r.status_code == 200 and r.json()["results"]
        d = tc.get("/api/locations/nb:agrabad").json()
        assert d["overview"]["coverage"]["level"] == "city_context" and d["overview"]["population"] is None
        assert d["hospitals"]["summary"]["total"] == 0 and d["dengue"]["available"]
        assert tc.get("/api/locations/dist:cox-s-bazar").json()["dengue"] == {"available": False}
        assert tc.get("/api/locations/nope:1").status_code == 404
        assert tc.post("/api/hospitals", json={**HOSP, "source": "x"}).status_code == 401
    finally:
        area_routes.adb.cache_clear()
        main.state.pop("store", None)


# ------------------------------------------------------------------------------------------------ beds left
@pytest.fixture(scope="module")
def planner(store):
    return Planner(store)


def test_bed_outlook_is_capacity_minus_the_supply_rule(store, planner, db):
    place = find(store, db, "cc:DSCC")
    cov = coverage(store, place)
    b = bed_outlook(store, planner, cov, "2025-08-04")
    assert b["available"] and b["week"] == "2025-08-04" and b["wards_counted"] == 20
    assert b["capacity"] == sum(int(planner.capacity[w]) for w in cov["wards"])
    rows = store.df[(store.df["date"] == "2025-08-04") & store.df["ward_id"].isin(cov["wards"])]
    assert b["in_use"] == int(rows["hospital_beds_required"].sum()) and b["left_now"] == b["capacity"] - b["in_use"]
    o = store.snap("2025-08-04")
    p = store.preds[(store.preds["origin_date"] == o) & (store.preds["horizon"] == 2) & store.preds["ward_id"].isin(cov["wards"])]
    need = int(sum(ops.supply_need(p["predicted"].to_numpy())[ops.BEDS]))
    w2 = b["weeks"][1]
    assert w2["needed_expected"] == need and w2["left_expected"] == b["capacity"] - need
    assert w2["left_worst"] <= w2["left_expected"]
    expected_status = "short" if w2["left_expected"] < 0 else "tight" if w2["left_worst"] < 0 else "enough"
    assert w2["status"] == expected_status
    lows = [t["min_left_expected"] for t in b["tightest"]]
    assert lows == sorted(lows)                       # wards running out first come first
    assert len(b["history"]) == 12 and b["history"][-1]["date"] == "2025-08-04" and not b["latest"]


def test_bed_outlook_for_a_ward_offers_city_overflow_and_none_for_uncovered(store, planner, db):
    ward = find(store, db, "ward:DSCC_Ward_04")
    b = bed_outlook(store, planner, coverage(store, ward))
    assert b["capacity"] == int(planner.capacity["DSCC_Ward_04"]) and b["city_spare_2w"] >= 0 and b["latest"]
    far = find(store, db, "dist:cox-s-bazar")
    assert bed_outlook(store, planner, coverage(store, far)) == {"available": False}


def test_hospitals_with_most_verified_free_beds_come_first(db):
    a = hz.create(db, {**HOSP, "name": "A"}, None, "t")
    b = hz.create(db, {**HOSP, "name": "B", "lat": 22.35}, None, "t")
    c = hz.create(db, {**HOSP, "name": "C"}, None, "t")
    hz.record_beds(db, a, {"available_beds": 3, "source_ref": "x", "verified": True}, None)
    hz.record_beds(db, b, {"available_beds": 9, "source_ref": "x", "verified": True}, None)
    hz.record_beds(db, c, {"available_beds": 50, "source_ref": "x"}, None)          # unverified: does not count
    items = hz.nearby(db, 22.34, 91.83, 10)
    assert [h["name"] for h in sorted(items, key=hz.beds_left_key)] == ["B", "A", "C"]
    s = hz.summary(items)
    assert s["availability"]["available_beds"]["value"] == 12 and s["closest_with_beds"]["name"] in ("A", "B")


def test_beds_endpoint_accepts_a_week(store, tmp_path, monkeypatch):
    main.state["store"], main.state["planner"] = store, Planner(store)
    area_routes.adb.cache_clear()
    monkeypatch.setenv("AREA_DB", str(tmp_path / "beds.sqlite3"))
    try:
        tc = TestClient(main.app)
        r = tc.get("/api/locations/cc:CCC/beds", params={"as_of": "2025-08-04"}).json()
        assert r["estimate"]["week"] == "2025-08-04" and r["reported"]["total"] == 0 and r["hospitals"] == []
        d = tc.get("/api/locations/nb:agrabad").json()
        assert d["beds"]["available"] and d["beds"]["level"] == "city_context"
    finally:
        area_routes.adb.cache_clear()
        main.state.pop("store", None)
        main.state.pop("planner", None)
