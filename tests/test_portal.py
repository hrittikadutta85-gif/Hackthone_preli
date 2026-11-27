"""Prediction portal: supply outlook and warnings for a forecast typed in by a user."""
import pandas as pd
import pytest

from backend import alerts as al
from backend.planner import Planner
from backend.service import Store
from dengue_ews import operations as ops
from dengue_ews.config import DATA_PATH, MODEL_PATH

pytestmark = pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")
WARD = "DSCC_Ward_04"


@pytest.fixture(scope="module")
def planner():
    return Planner(Store())


def recorded(until: str, n: int = 8) -> list[dict]:
    d = pd.read_csv(DATA_PATH)
    w = d[(d["ward_id"] == WARD) & (d["date"] <= until)].tail(n)
    return [{"date": r.date, "rain": r.rainfall_mm, "temp": r.avg_temp_c, "humidity": r.relative_humidity_pct,
             "cases": float(r.dengue_cases)} for r in w.itertuples()]


def test_template_carries_profile_and_supply_rules(planner):
    t = planner.s.template(WARD, 8)
    assert t["profile"]["density"] == int(planner.density[WARD])
    assert t["rules"]["saline"] == {"per_case": 2.385, "offset": 0.49}


def test_outlook_follows_the_supply_rule_and_capacity(planner):
    res = planner.s.predict_custom(WARD, recorded("2025-06-30"), 2)
    out = planner.resource_outlook(WARD, res["horizons"])
    assert out["bed_capacity"] == int(planner.capacity[WARD])
    for w, h in zip(out["weeks"], res["horizons"]):
        assert w["expected"]["saline"] == int(ops.supply_need([h["predicted"]])[ops.SALINE][0])
        assert w["upper"]["beds"] >= w["expected"]["beds"]
        assert w["over_capacity"] == (w["upper"]["beds"] > out["bed_capacity"])
    assert out["totals"]["expected"]["kits"] == sum(w["expected"]["kits"] for w in out["weeks"])


def test_portal_warnings_follow_the_forecast(planner):
    week = "2025-06-30"
    res = planner.s.predict_custom(WARD, recorded(week), 2)
    found = al.evaluate(planner.s, WARD, res["origin"], res["horizons"], recorded(week))
    assert found, "this ward-week is known to be rising"
    tiers = {h["h"]: h["tier"] for h in res["horizons"]}
    for a in found:
        assert a["alert_type"] in al.TYPES and a["new_tier"] == a["level"]
        assert tiers[a["horizon"]] == a["new_tier"] or a["alert_type"] in ("rainfall", "upcoming_high")
        assert a["target_week"] == str((pd.Timestamp(res["origin"]) + pd.Timedelta(weeks=a["horizon"])).date())
        if a["alert_type"] == "rainfall":
            assert a["rain_mm"] >= a["rain_threshold"]


def test_quiet_week_raises_nothing(planner):
    res = planner.s.predict_custom(WARD, recorded("2025-12-29"), 2)
    assert al.evaluate(planner.s, WARD, res["origin"], res["horizons"], recorded("2025-12-29")) == []
