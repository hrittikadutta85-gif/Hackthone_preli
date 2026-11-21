"""Multi-week, ward-level lag pipeline.

Every feature for forecast-origin week t uses data from week t or earlier, computed
within each ward_id (groupby + shift), so nothing leaks across wards or from the future.
"lag k" means "k weeks before the origin week".
"""
import numpy as np
import pandas as pd

from .config import TARGET

RAIN_LAGS = range(1, 9)    # Aedes breeding (7-14 days) + incubation -> effect 2-4+ weeks later
TEMP_HUM_LAGS = range(1, 5)

FEATURE_GROUPS = {
    "Rainfall (multi-week lags)": ["rainfall_mm", *[f"rain_lag{k}" for k in RAIN_LAGS],
                                   "rain_sum_lag2_4", "rain_sum_4w", "rain_sum_8w", "heavy_rain_weeks_4w"],
    "Temperature": ["avg_temp_c", "temp_range_c", *[f"temp_lag{k}" for k in TEMP_HUM_LAGS],
                    "temp_mean_4w", "aedes_optimal_weeks_4w"],
    "Humidity": ["relative_humidity_pct", "dew_point_c", *[f"hum_lag{k}" for k in TEMP_HUM_LAGS],
                 "hum_mean_4w", "humid_weeks_4w"],
    "Recent cases (surveillance)": ["cases_now", "cases_lag1", "cases_lag2", "cases_lag3", "cases_mean_4w",
                                    "cases_trend_2w", "city_cases_now", "cases_last_year_target"],
    "Ward vulnerability": ["log_pop_density", "water_logging_risk_index", "sanitation_score",
                           "vulnerability_index"],
    "Seasonality": ["woy_sin", "woy_cos"],
}
FEATURES = [f for group in FEATURE_GROUPS.values() for f in group]
FEATURE_TO_GROUP = {f: g for g, fs in FEATURE_GROUPS.items() for f in fs}
WEATHER_GROUPS = ["Rainfall (multi-week lags)", "Temperature", "Humidity"]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Horizon-independent features for every ward-week of a cleaned frame."""
    f = df.sort_values(["ward_id", "date"]).reset_index(drop=True).copy()
    g = f.groupby("ward_id", sort=False)

    def past(col, fn, window):  # rolling window ending at the origin week (inclusive), within ward
        return g[col].transform(lambda s: getattr(s.rolling(window, min_periods=window), fn)())

    # Rainfall: individual weekly lags + cumulative windows aligned to the breeding clock
    for k in RAIN_LAGS:
        f[f"rain_lag{k}"] = g["rainfall_mm"].shift(k)
    f["rain_sum_lag2_4"] = f[["rain_lag2", "rain_lag3", "rain_lag4"]].sum(axis=1, min_count=3)
    f["rain_sum_4w"] = past("rainfall_mm", "sum", 4)
    f["rain_sum_8w"] = past("rainfall_mm", "sum", 8)
    f["_heavy"] = (f["rainfall_mm"] > 50).astype(float)
    f["heavy_rain_weeks_4w"] = past("_heavy", "sum", 4)

    # Temperature: Aedes development/viral replication is fastest around 25-32 C
    f["temp_range_c"] = f["max_temp_c"] - f["min_temp_c"]
    for k in TEMP_HUM_LAGS:
        f[f"temp_lag{k}"] = g["avg_temp_c"].shift(k)
    f["temp_mean_4w"] = past("avg_temp_c", "mean", 4)
    f["_optimal"] = f["avg_temp_c"].between(25, 32).astype(float)
    f["aedes_optimal_weeks_4w"] = past("_optimal", "sum", 4)

    # Humidity: adult mosquito survival
    a, b = 17.62, 243.12  # Magnus formula
    gamma = np.log(f["relative_humidity_pct"] / 100) + a * f["avg_temp_c"] / (b + f["avg_temp_c"])
    f["dew_point_c"] = b * gamma / (a - gamma)
    for k in TEMP_HUM_LAGS:
        f[f"hum_lag{k}"] = g["relative_humidity_pct"].shift(k)
    f["hum_mean_4w"] = past("relative_humidity_pct", "mean", 4)
    f["_humid"] = (f["relative_humidity_pct"] > 80).astype(float)
    f["humid_weeks_4w"] = past("_humid", "sum", 4)

    # Surveillance: cases reported up to and including the origin week
    f["cases_now"] = f[TARGET]
    for k in (1, 2, 3):
        f[f"cases_lag{k}"] = g[TARGET].shift(k)
    f["cases_mean_4w"] = past(TARGET, "mean", 4)
    f["cases_trend_2w"] = f["cases_now"] - f["cases_lag2"]
    f["city_cases_now"] = f.groupby(["city", "date"])[TARGET].transform("mean")

    # Ward vulnerability (static)
    f["log_pop_density"] = np.log(f["population_density_sqkm"])
    f["vulnerability_index"] = f["water_logging_risk_index"] * (1 - f["sanitation_score"])

    woy = f["date"].dt.isocalendar().week.astype(int)
    f["woy_sin"] = np.sin(2 * np.pi * woy / 52.18)
    f["woy_cos"] = np.cos(2 * np.pi * woy / 52.18)
    return f.drop(columns=["_heavy", "_optimal", "_humid"])


def add_horizon(feat: pd.DataFrame, h: int) -> pd.DataFrame:
    """Attach horizon-specific columns: target week, target cases (if known) and last year's same week."""
    out = feat.copy()
    g = out.groupby("ward_id", sort=False)[TARGET]
    out["horizon"] = h
    out["target_date"] = out["date"] + pd.Timedelta(weeks=h)
    out["target"] = g.shift(-h)
    out["cases_last_year_target"] = g.shift(52 - h)
    return out
