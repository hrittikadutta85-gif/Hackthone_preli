"""Phase 2: supply rules, constrained allocation, overflow routing, vector-control simulator, dispatch, offline."""
import numpy as np
import pandas as pd
import pytest

from backend import dispatch
from backend.offline import NetworkBlocked, no_network, self_test
from backend.planner import Planner
from backend.service import Store
from dengue_ews import operations as ops
from dengue_ews.config import DATA_PATH, MODEL_PATH, SIM_HORIZONS, SIM_MAX_CREWS, SUPPLIES

ORIGINS = ["2025-06-23", "2025-07-07", "2025-09-01"]


# ------------------------------------------------------------------ pure arithmetic (no model needed)
def test_supply_rule_reproduces_every_row_of_the_dataset():
    df = pd.read_csv(DATA_PATH)
    need = ops.supply_need(df["dengue_cases"])
    for col in SUPPLIES:
        assert (need[col] == df[col]).all(), col


def test_supply_need_is_monotone_and_safe():
    c = np.linspace(0, 60, 601)
    for v in ops.supply_need(c).values():
        assert (np.diff(v) >= 0).all()
    assert all(int(v[0]) == 0 for v in ops.supply_need([np.nan]).values())
    assert all(int(v[0]) == 0 for v in ops.supply_need([-3]).values())


@pytest.mark.parametrize("seed", range(20))
def test_water_fill_respects_stock_demand_and_priority(seed):
    rng = np.random.default_rng(seed)
    d = rng.integers(0, 60, 40)
    w = ops.allocation_weight(rng.uniform(0, 100, 40))
    for share in (0.0, 0.3, 0.55, 0.8, 1.0, 1.4):
        stock = int(d.sum() * share)
        x = ops.water_fill(d, w, stock)
        assert x.sum() == min(stock, d.sum())
        assert (x >= 0).all() and (x <= d).all()
        # a ward with higher priority never has a lower fill rate, beyond whole-unit rounding (1/demand per ward)
        has = d > 0
        fill, wt, dd = x[has] / d[has], w[has], d[has]
        for i in range(len(fill)):
            for j in range(len(fill)):
                if wt[i] > wt[j]:
                    assert fill[i] >= fill[j] - 1 / dd[i] - 1 / dd[j] - 1e-9


def test_water_fill_is_deterministic():
    d, w = np.array([10, 10, 10]), np.array([50.0, 50.0, 50.0])
    assert ops.water_fill(d, w, 16).tolist() == ops.water_fill(d, w, 16).tolist()
    assert ops.water_fill(d, w, 16).sum() == 16


def test_routing_stays_inside_each_city_and_conserves_patients():
    wards = pd.DataFrame({
        "ward_id": ["A1", "A2", "A3", "B1", "B2"], "city": ["A", "A", "A", "B", "B"],
        "demand": [9, 1, 2, 7, 6], "capacity": [4, 4, 4, 3, 3], "priority": [90, 10, 20, 80, 70]})
    w, transfers, pools = ops.route_overflow(wards)
    city = dict(zip(wards["ward_id"], wards["city"]))
    assert all(city[t["from"]] == city[t["to"]] == t["city"] for t in transfers)
    assert (w["local"] + w["sent"] + w["unplaced"] == w["demand"]).all()
    assert (w["occupied"] <= w["capacity"]).all()
    a = next(p for p in pools if p["city"] == "A")
    assert a["transferred"] == 5 and a["unplaced"] == 0 and a["headroom"] == 0  # 12 beds, 12 patients
    b = next(p for p in pools if p["city"] == "B")  # both B wards overflow: nowhere to send anyone
    assert b["transferred"] == 0 and b["unplaced"] == 7 and b["headroom"] == 0


def test_routing_prefers_the_least_burdened_ward():
    wards = pd.DataFrame({"ward_id": ["S", "Busy", "Quiet"], "city": "X", "demand": [6, 3, 0],
                          "capacity": [4, 4, 4], "priority": [90, 50, 50]})
    _, transfers, _ = ops.route_overflow(wards)
    assert transfers == [{"city": "X", "from": "S", "to": "Quiet", "patients": 2}]


def test_crew_efficacy_saturates_and_dense_wards_need_more():
    k = np.arange(0, 20)
    e = ops.crew_efficacy(k, 40000, 40000)
    assert e[0] == 0 and (np.diff(e) > 0).all() and (np.diff(e, 2) < 0).all() and e[-1] < 0.6
    assert ops.crew_efficacy(2, 70000, 40000) < ops.crew_efficacy(2, 20000, 40000)


# ------------------------------------------------------------------ with the trained model
needs_model = pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")


@pytest.fixture(scope="module")
def planner():
    return Planner(Store())


@needs_model
@pytest.mark.parametrize("origin", ORIGINS)
def test_full_stock_has_no_supply_deficits(planner, origin):
    p = planner.plan(origin, 2, stock_pct=100, crews=300, basis="expected")
    for k in ("saline", "kits"):
        assert p["totals"][k]["shortfall"] == 0
    assert p["totals"]["crews"]["wards_short"] == 0


@needs_model
@pytest.mark.parametrize("origin", ORIGINS)
@pytest.mark.parametrize("stock", [30, 55, 80])
def test_scarce_stock_is_allocated_exactly_and_flagged(planner, origin, stock):
    p = planner.plan(origin, 2, stock_pct=stock, crews=10)
    for k in ("saline", "kits"):
        t = p["totals"][k]
        assert t["allocated"] == min(t["available"], t["required"])
        assert all(0 <= w["allocated"][k] <= w["required"][k] for w in p["wards"])
    short = [w for w in p["wards"] if any(w["shortfall"].values())]
    assert all(w["status"] != "ok" and w["deficits"] for w in short)
    assert p["totals"]["crews"]["assigned"] == min(10, p["totals"]["crews"]["needed"])
    # the top of the priority list is filled at least as well as the bottom
    top, bottom = p["wards"][:5], p["wards"][-5:]
    rate = lambda ws: sum(w["allocated"]["saline"] for w in ws) / max(sum(w["required"]["saline"] for w in ws), 1)  # noqa: E731
    if sum(w["required"]["saline"] for w in bottom):
        assert rate(top) >= rate(bottom)


@needs_model
def test_plan_beds_match_routing(planner):
    p = planner.plan("2025-07-07", 2, stock_pct=70, crews=20, basis="upper")
    assert p["transfers"], "this scenario is known to need transfers"
    city = {w["ward"]: w["city"] for w in p["wards"]}
    for t in p["transfers"]:
        assert city[t["from"]] == city[t["to"]]
    for w in p["wards"]:
        b = w["beds"]
        assert w["allocated"]["beds"] == b["local"] + b["sent"]
        assert w["required"]["beds"] == b["local"] + b["sent"] + b["unplaced"]
    assert sum(c["unplaced"] for c in p["pools"]) == p["totals"]["beds"]["shortfall"]


@needs_model
@pytest.mark.parametrize("origin", ORIGINS)
def test_simulator_baseline_is_the_stored_forecast(planner, origin):
    sim = planner.simulate(origin, {}, 0)
    o = pd.Timestamp(origin)
    stored = planner.s.preds[(planner.s.preds["origin_date"] == o) & planner.s.preds["horizon"].isin(SIM_HORIZONS)]
    assert sim["totals"]["prevented"] == 0
    assert abs(sim["totals"]["baseline"] - stored["predicted"].sum()) < 0.05 * len(stored)


@needs_model
@pytest.mark.parametrize("origin", ORIGINS)
def test_more_crews_never_prevent_fewer_cases(planner, origin):
    prev = -1.0
    for crews in (0, 1, 3, 6, 12, 25):
        sim = planner.simulate(origin, None, crews)
        assert sim["totals"]["prevented"] >= prev - 1e-6
        assert sim["crews_used"] <= crews
        prev = sim["totals"]["prevented"]
    ward = planner.s.preds["ward_id"].iloc[0]
    per = [planner.simulate(origin, {ward: k})["wards"][0]["prevented"] for k in range(SIM_MAX_CREWS + 1)]
    assert all(b >= a - 1e-9 for a, b in zip(per, per[1:]))


@needs_model
def test_auto_placement_beats_any_single_ward(planner):
    sim = planner.simulate("2025-07-07", None, 8)
    best = sim["totals"]["prevented"]
    for w in sim["wards"][:10]:
        alt = planner.simulate("2025-07-07", {w["ward"]: 8})["totals"]["prevented"]
        assert best >= alt - 1e-6
    ranks = [x["roi"] for x in sim["ranking"]]
    assert ranks == sorted(ranks, reverse=True)


@needs_model
@pytest.mark.parametrize("lang", ["en", "bn"])
def test_dispatch_notices(planner, lang):
    p = planner.plan("2025-07-07", 2, stock_pct=60, crews=15)
    notes = dispatch.notices(p, lang)
    assert notes
    for n in notes:
        w = next(x for x in p["wards"] if x["ward"] == n["ward"])
        if lang == "en":
            assert n["sms_chars"] <= 160 and n["sms_encoding"] == "GSM-7"
            assert f"Saline {w['allocated']['saline']}/{w['required']['saline']}" in n["sms"]
            assert ("SHORT" in n["sms"]) == bool(w["deficits"])
        else:
            assert n["sms_parts"] <= 3
        assert dispatch.digits(w["crews_needed"], lang) in n["whatsapp"]
    html = dispatch.brief_html(p, lang)
    assert html.startswith("<!doctype html>") and "http" not in html.split("<body>")[0]


@needs_model
def test_everything_runs_with_the_network_cut(planner):
    with no_network():
        import socket
        with pytest.raises(NetworkBlocked):
            socket.create_connection(("example.com", 443), timeout=1)
        store = Store()  # the full startup too: data, features, models
        Planner(store).plan(None, 2)
    report = self_test(planner.s, planner)
    assert report["ok"] and report["network_blocked"]
    assert [s["step"] for s in report["steps"]] == ["forecast", "allocation", "routing", "simulator", "dispatch"]
