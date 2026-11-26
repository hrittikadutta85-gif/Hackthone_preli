"""The what-if scenario must start from the stored forecast and move only because of the weather the user changes."""
import numpy as np
import pandas as pd
import pytest

from backend.service import PRECOMPUTE_FROM, WHATIF_WEEKS, Store
from dengue_ews.config import HORIZONS, MODEL_PATH
from dengue_ews.features import build_features

pytestmark = pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")

WARDS = ["DSCC_Ward_05", "DNCC_Ward_02", "CCC_Ward_01", "GCC_Ward_03", "NCC_Ward_01"]  # one per city
# validation year, the weeks around which a year of history first becomes available, test year, last week of data
ORIGINS = ["2024-01-01", "2024-07-08", "2024-12-09", "2025-01-06", "2025-07-07", "2025-09-01", "2025-12-29"]
NO_CHANGE = dict(rain_pct=0, temp_shift=0, hum_shift=0, rain_mm=None, focus_h=2)


@pytest.fixture(scope="module")
def store():
    return Store()


def values(rows):
    return [(r["h"], r["predicted"], r["lower"], r["upper"], r["score"], r["tier"]) for r in rows]


@pytest.mark.parametrize("origin", ORIGINS)
@pytest.mark.parametrize("ward", WARDS)
def test_unchanged_scenario_equals_forecast(store, ward, origin):
    forecast = store.forecast(ward, origin, 2)["horizons"]
    result = store.whatif(ward, origin, **NO_CHANGE)
    assert [r["h"] for r in result["scenario"]] == HORIZONS
    assert values(result["baseline"]) == values(forecast)
    assert values(result["scenario"]) == values(forecast)


@pytest.mark.parametrize("ward", WARDS)
def test_resending_the_displayed_rainfall_changes_nothing(store, ward):
    """The web app receives rainfall rounded to 0.1 mm and sends all eight weeks back once any box is edited."""
    shown = [w["rain"] for w in store.forecast(ward, "2025-07-07", 2)["weather"][-WHATIF_WEEKS:]]
    result = store.whatif(ward, "2025-07-07", **{**NO_CHANGE, "rain_mm": shown})
    assert values(result["scenario"]) == values(result["baseline"])
    assert result["summary"].startswith("Nothing changed")


def reference(store, ward, origin, rain_pct=0.0, temp_shift=0.0, hum_shift=0.0, rain_mm=None):
    """Independent calculation: edit the full dataset, rebuild every feature and score it like the stored forecasts."""
    df = store.df.copy()
    o = pd.Timestamp(origin)
    m = (df["ward_id"] == ward) & (df["date"] > o - pd.Timedelta(weeks=WHATIF_WEEKS)) & (df["date"] <= o)
    if rain_mm is not None:
        df.loc[m, "rainfall_mm"] = rain_mm
    df.loc[m, "rainfall_mm"] = np.clip(df.loc[m, "rainfall_mm"] * (1 + rain_pct / 100), 0, None)
    for c in ("avg_temp_c", "max_temp_c", "min_temp_c"):
        df.loc[m, c] += temp_shift
    df.loc[m, "relative_humidity_pct"] = np.clip(df.loc[m, "relative_humidity_pct"] + hum_shift, 1, 100)
    feat = build_features(df)
    p = store.predictor.predict(feat[feat["date"] >= PRECOMPUTE_FROM])
    return store.horizon_rows(p[(p["ward_id"] == ward) & (p["origin_date"] == o)])


@pytest.mark.parametrize("change", [
    dict(rain_pct=80, hum_shift=8),          # "Monsoon surge"
    dict(rain_pct=-70, temp_shift=1, hum_shift=-10),  # "Dry spell"
    dict(temp_shift=3, hum_shift=-5),        # "Heatwave"
    dict(rain_pct=30, temp_shift=-2, hum_shift=8),    # "Cool and damp"
    dict(rain_pct=50),
    dict(temp_shift=-1.5),
    dict(hum_shift=6),
    dict(rain_mm=[0, 0, 10, 20, 300, 250, 40, 5]),
])
@pytest.mark.parametrize("ward,origin", [("DSCC_Ward_05", "2025-07-07"), ("CCC_Ward_01", "2024-07-08")])
def test_changed_weather_is_rescored_correctly(store, ward, origin, change):
    result = store.whatif(ward, origin, **{**NO_CHANGE, **change})
    assert values(result["scenario"]) == values(reference(store, ward, origin, **change))
    assert values(result["scenario"]) != values(result["baseline"])
    assert values(result["baseline"]) == values(store.forecast(ward, origin, 2)["horizons"])


def test_scenarios_leave_stored_data_untouched(store):
    before_data, before_preds = store.df.copy(), store.preds.copy()
    store.whatif("DSCC_Ward_05", "2025-07-07", **{**NO_CHANGE, "rain_pct": 200, "temp_shift": 5})
    pd.testing.assert_frame_equal(store.df, before_data)
    pd.testing.assert_frame_equal(store.preds, before_preds)
    result = store.whatif("DSCC_Ward_05", "2025-07-07", **NO_CHANGE)
    assert values(result["scenario"]) == values(result["baseline"])
