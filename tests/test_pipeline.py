"""Checks that lag features are computed per ward, look only backwards, and that inference is well-formed.

    python -m pytest -q
"""
import numpy as np
import pandas as pd
import pytest

from dengue_ews.config import DATA_PATH, MODEL_PATH, TIERS
from dengue_ews.data import clean, load_raw
from dengue_ews.features import FEATURES, RAIN_LAGS, add_horizon, build_features


@pytest.fixture(scope="module")
def data():
    df, report = clean(load_raw(DATA_PATH))
    return df, build_features(df), report


def test_clean_grid_is_complete(data):
    df, _, report = data
    assert df.duplicated(["ward_id", "date"]).sum() == 0
    assert report["rows_out"] == report["wards"] * report["weeks"]
    assert (df["date"].dt.dayofweek == 0).all()


@pytest.mark.parametrize("k", list(RAIN_LAGS))
def test_rain_lags_are_grouped_by_ward(data, k):
    df, feat, _ = data
    ward = df["ward_id"].iloc[0]
    raw = df[df["ward_id"] == ward].sort_values("date")["rainfall_mm"].to_numpy()
    lag = feat[feat["ward_id"] == ward].sort_values("date")[f"rain_lag{k}"].to_numpy()
    assert np.isnan(lag[:k]).all(), "first k weeks of each ward must have no lag (no bleed from previous ward)"
    np.testing.assert_allclose(lag[k:], raw[:-k])


def test_breeding_window_sum(data):
    _, feat, _ = data
    row = feat.dropna(subset=["rain_sum_lag2_4"]).iloc[100]
    assert row["rain_sum_lag2_4"] == pytest.approx(row["rain_lag2"] + row["rain_lag3"] + row["rain_lag4"])


def test_no_future_information(data):
    """Changing weather/cases after the origin week must not change that week's features."""
    df, feat, _ = data
    ward, origin = df["ward_id"].iloc[0], pd.Timestamp("2020-06-01")
    future = df.copy()
    mask = (future["ward_id"] == ward) & (future["date"] > origin)
    future.loc[mask, ["rainfall_mm", "dengue_cases"]] = 999
    a = feat[(feat["ward_id"] == ward) & (feat["date"] == origin)][[f for f in FEATURES if f != "cases_last_year_target"]].reset_index(drop=True)
    b = build_features(future)
    b = b[(b["ward_id"] == ward) & (b["date"] == origin)][[f for f in FEATURES if f != "cases_last_year_target"]].reset_index(drop=True)
    pd.testing.assert_frame_equal(a, b)


def test_target_is_shifted_forward(data):
    _, feat, _ = data
    fh = add_horizon(feat, 3)
    w = fh[fh["ward_id"] == fh["ward_id"].iloc[0]].reset_index(drop=True)
    assert w.loc[10, "target"] == w.loc[13, "dengue_cases"]


@pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")
def test_predictions_and_drivers(data):
    from dengue_ews.model import load_predictor
    _, feat, _ = data
    pred = load_predictor(str(MODEL_PATH))
    rows = feat[feat["date"] == pd.Timestamp("2025-07-07")]
    out = pred.predict(rows)
    assert len(out) == len(rows) * len(pred.horizons)
    assert (out["predicted"] >= 0).all() and out["tier"].isin(TIERS).all()
    assert (out["lower_80"] <= out["predicted"]).all() and (out["predicted"] <= out["upper_80"]).all()
    contrib, base = pred.explain(rows.iloc[[0]], 2)
    p2 = out[(out["horizon"] == 2)]["predicted"].iloc[0]
    assert np.exp(base + contrib.iloc[0].sum()) == pytest.approx(p2, abs=0.01)
