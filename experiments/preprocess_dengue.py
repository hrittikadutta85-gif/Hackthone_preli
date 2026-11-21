"""End-to-end preprocessing for the Bangladesh dengue ward-level weekly dataset.

Usage:  python preprocess_dengue.py [input_csv] [output_dir]

Outputs (in output_dir, default ./processed):
  dengue_clean.csv        validated, typed, deduplicated, sorted data + quality flags (human-readable)
  dengue_features.csv     clean data + engineered features (unscaled, rows with incomplete lags dropped)
  train.csv / val.csv / test.csv   model-ready: encoded + scaled, chronological split
  scaler_params.json      per-feature mean/std fitted on train only (to transform new data)
  preprocessing_report.md data-quality findings and every step applied
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "data/dengue_weekly.csv")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "experiments/processed")
OUT.mkdir(exist_ok=True)

KEY = ["ward_id", "date"]
STATIC = ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]
WEATHER = ["avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm", "relative_humidity_pct"]
TARGET = "dengue_cases"
CITY_PREFIX = {"CCC": "Chattogram", "DNCC": "Dhaka North", "DSCC": "Dhaka South",
               "GCC": "Gazipur", "NCC": "Narayanganj"}
# Physically plausible bounds for Bangladesh; values outside become NaN and are imputed.
BOUNDS = {"avg_temp_c": (5, 45), "max_temp_c": (5, 48), "min_temp_c": (0, 40),
          "rainfall_mm": (0, 1000), "relative_humidity_pct": (0, 100),
          "water_logging_risk_index": (0, 1), "sanitation_score": (0, 1),
          "population_density_sqkm": (1, 200_000), TARGET: (0, 10_000)}

log = []
def note(msg):
    log.append(msg)
    print(msg)

# ---------------------------------------------------------------- 1. load & standardise
raw = pd.read_csv(SRC, dtype=str, keep_default_na=False)
note(f"Loaded {len(raw):,} rows x {raw.shape[1]} columns from '{SRC.name}'")
df = raw.copy()
df.columns = df.columns.str.strip().str.lower().str.replace(r"\W+", "_", regex=True)
for c in df.columns:
    df[c] = df[c].str.strip()
df = df.replace({"": np.nan, "na": np.nan, "NA": np.nan, "N/A": np.nan, "null": np.nan,
                 "None": np.nan, "nan": np.nan, "NaN": np.nan, "?": np.nan, "-": np.nan})
df["city"] = df["city"].str.title().str.replace(r"\s+", " ", regex=True)
df["ward_id"] = df["ward_id"].str.upper().str.replace("WARD", "Ward")

# ---------------------------------------------------------------- 2. type conversion
df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
for c in STATIC + WEATHER + [TARGET]:
    df[c] = pd.to_numeric(df[c].str.replace(",", ""), errors="coerce")
note(f"Type coercion: {int(df['date'].isna().sum())} unparseable dates, "
     f"{int(df[STATIC + WEATHER + [TARGET]].isna().sum().sum())} missing/non-numeric numeric cells")

# ---------------------------------------------------------------- 3. structural integrity
n = len(df)
df = df.dropna(subset=["date", "ward_id"])
note(f"Dropped {n - len(df)} rows with no date or ward_id (unrecoverable keys)")
n = len(df)
df = df.drop_duplicates()
note(f"Removed {n - len(df)} exact duplicate rows")
n = len(df)
df = df.groupby(KEY, as_index=False).first()  # conflicting duplicates on key: keep first non-null
note(f"Collapsed {n - len(df)} duplicate (ward_id, date) keys")

prefix_city = df["ward_id"].str.split("_").str[0].map(CITY_PREFIX)
mismatch = prefix_city.notna() & (df["city"] != prefix_city)
df.loc[prefix_city.notna(), "city"] = prefix_city
note(f"City repaired from ward_id prefix in {int(mismatch.sum())} rows (ward->city mapping is 1:1)")

# Snap to the weekly (Monday) grid and reindex so every ward has every week.
off_grid = int((df["date"].dt.dayofweek != 0).sum())
df["date"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="D")
weeks = pd.date_range(df["date"].min(), df["date"].max(), freq="W-MON")
full = pd.MultiIndex.from_product([sorted(df["ward_id"].unique()), weeks], names=KEY)
df = df.set_index(KEY).reindex(full).reset_index()
added = int(df["city"].isna().sum())
note(f"Weekly grid: {off_grid} off-Monday dates snapped, {added} missing ward-weeks inserted "
     f"({df['ward_id'].nunique()} wards x {len(weeks)} weeks, {weeks.min().date()} to {weeks.max().date()})")

# ---------------------------------------------------------------- 4. validity rules
for c, (lo, hi) in BOUNDS.items():
    bad = (df[c] < lo) | (df[c] > hi)
    if bad.any():
        df.loc[bad, c] = np.nan
    note(f"Range check {c} in [{lo}, {hi}]: {int(bad.sum())} violations set to NaN")
df[TARGET] = df[TARGET].round()

swap = df["min_temp_c"] > df["max_temp_c"]
df.loc[swap, ["min_temp_c", "max_temp_c"]] = df.loc[swap, ["max_temp_c", "min_temp_c"]].values
bad_avg = (df["avg_temp_c"] < df["min_temp_c"]) | (df["avg_temp_c"] > df["max_temp_c"])
df.loc[bad_avg, "avg_temp_c"] = np.nan
note(f"Temperature logic: {int(swap.sum())} min/max swaps, {int(bad_avg.sum())} avg outside [min,max] -> NaN")

# ---------------------------------------------------------------- 5. imputation
df["was_imputed"] = df[STATIC + WEATHER + [TARGET, "city"]].isna().any(axis=1).astype(int)
df["city"] = df.groupby("ward_id")["city"].transform(lambda s: s.ffill().bfill())
for c in STATIC:  # constant per ward -> ward mode
    df[c] = df.groupby("ward_id")[c].transform(lambda s: s.fillna(s.mode().iloc[0]) if s.notna().any() else s)
df = df.sort_values(KEY).reset_index(drop=True)
for c in WEATHER:  # time-interpolate within ward, then city-week median, then ward-month median
    df[c] = df.groupby("ward_id")[c].transform(lambda s: s.interpolate(limit=3, limit_direction="both"))
    df[c] = df[c].fillna(df.groupby(["city", "date"])[c].transform("median"))
    df[c] = df[c].fillna(df.groupby(["ward_id", df["date"].dt.month])[c].transform("median"))
df[TARGET] = df[TARGET].fillna(
    df.groupby("ward_id")[TARGET].transform(lambda s: s.interpolate(limit=2, limit_direction="both")).round())
n = len(df)
df = df.dropna(subset=[TARGET]).reset_index(drop=True)  # never fabricate long runs of target
note(f"Imputation: {int(df['was_imputed'].sum())} rows had a filled value; "
     f"{n - len(df)} rows dropped for unrecoverable target")
df[TARGET] = df[TARGET].astype(int)
df["population_density_sqkm"] = df["population_density_sqkm"].astype(int)

# ---------------------------------------------------------------- 6. outlier flagging (kept, not removed)
month = df["date"].dt.month
for c in ["avg_temp_c", "rainfall_mm", "relative_humidity_pct", TARGET]:
    g = df.groupby(["ward_id", month])[c]
    q1, q3 = g.transform(lambda s: s.quantile(.25)), g.transform(lambda s: s.quantile(.75))
    iqr = q3 - q1
    df[f"outlier_{c}"] = ((df[c] < q1 - 3 * iqr) | (df[c] > q3 + 3 * iqr)).astype(int)
    note(f"Seasonal 3xIQR outliers in {c} (ward x month): {int(df[f'outlier_{c}'].sum())} flagged, retained")
df["humidity_capped"] = (df["relative_humidity_pct"] >= 99).astype(int)
note(f"Humidity sensor ceiling (>=99%): {int(df['humidity_capped'].sum())} rows flagged")

clean_cols = ["date", "city", "ward_id"] + STATIC + WEATHER + [TARGET, "was_imputed", "humidity_capped"] \
             + [c for c in df.columns if c.startswith("outlier_")]
clean = df[clean_cols].sort_values(KEY).reset_index(drop=True)
clean.to_csv(OUT / "dengue_clean.csv", index=False, date_format="%Y-%m-%d")
note(f"Saved dengue_clean.csv: {clean.shape}")

# ---------------------------------------------------------------- 7. feature engineering
f = clean.copy()
d = f["date"]
f["year"], f["month"], f["quarter"] = d.dt.year, d.dt.month, d.dt.quarter
f["week_of_year"] = d.dt.isocalendar().week.astype(int)
f["week_sin"] = np.sin(2 * np.pi * f["week_of_year"] / 52.18)
f["week_cos"] = np.cos(2 * np.pi * f["week_of_year"] / 52.18)
f["month_sin"] = np.sin(2 * np.pi * f["month"] / 12)
f["month_cos"] = np.cos(2 * np.pi * f["month"] / 12)
f["season"] = f["month"].map({12: "winter", 1: "winter", 2: "winter", 3: "pre_monsoon", 4: "pre_monsoon",
                              5: "pre_monsoon", 6: "monsoon", 7: "monsoon", 8: "monsoon", 9: "monsoon",
                              10: "post_monsoon", 11: "post_monsoon"})
f["is_monsoon"] = (f["season"] == "monsoon").astype(int)
f["time_index"] = ((d - d.min()).dt.days // 7).astype(int)

# Climate-derived
f["temp_range_c"] = f["max_temp_c"] - f["min_temp_c"]
a, b = 17.62, 243.12  # Magnus formula
gamma = np.log(f["relative_humidity_pct"] / 100) + a * f["avg_temp_c"] / (b + f["avg_temp_c"])
f["dew_point_c"] = b * gamma / (a - gamma)
f["rain_day"] = (f["rainfall_mm"] > 0).astype(int)
f["log_rainfall"] = np.log1p(f["rainfall_mm"])
f["aedes_temp_optimal"] = f["avg_temp_c"].between(25, 32).astype(int)  # Aedes aegypti optimum
# Ward-level risk composites
f["log_pop_density"] = np.log(f["population_density_sqkm"])
f["vulnerability_index"] = f["water_logging_risk_index"] * (1 - f["sanitation_score"])
f["density_x_waterlog"] = f["log_pop_density"] * f["water_logging_risk_index"]

# Lagged / rolling weather (mosquito breeding + incubation -> 1-8 week delay). All per ward, past only.
g = f.groupby("ward_id")
for c in ["rainfall_mm", "avg_temp_c", "relative_humidity_pct"]:
    for L in (1, 2, 4, 6, 8):
        f[f"{c}_lag{L}"] = g[c].shift(L)
    f[f"{c}_roll4_mean"] = g[c].transform(lambda s: s.shift(1).rolling(4).mean())
    f[f"{c}_roll8_mean"] = g[c].transform(lambda s: s.shift(1).rolling(8).mean())
f["rainfall_roll4_sum"] = g["rainfall_mm"].transform(lambda s: s.shift(1).rolling(4).sum())
f["humid_weeks_4"] = g["relative_humidity_pct"].transform(lambda s: (s.shift(1) > 80).rolling(4).sum())

# Autoregressive target features (shifted -> no leakage)
for L in (1, 2, 3, 4, 52):
    f[f"cases_lag{L}"] = g[TARGET].shift(L)
f["cases_roll4_mean"] = g[TARGET].transform(lambda s: s.shift(1).rolling(4).mean())
f["cases_roll4_std"] = g[TARGET].transform(lambda s: s.shift(1).rolling(4).std())
f["cases_growth_1w"] = f["cases_lag1"] - f["cases_lag2"]
f["city_cases_lag1"] = f.groupby(["city", "date"])["cases_lag1"].transform("mean")
f["log_cases"] = np.log1p(f[TARGET])  # transformed target option for skewed counts

n = len(f)
f = f.dropna().reset_index(drop=True)  # rows lacking full lag history (first 52 weeks per ward)
note(f"Feature engineering: {f.shape[1] - clean.shape[1]} features added; "
     f"{n - len(f)} warm-up rows without full lag history dropped")
f.to_csv(OUT / "dengue_features.csv", index=False, date_format="%Y-%m-%d")
note(f"Saved dengue_features.csv: {f.shape}")

# ---------------------------------------------------------------- 8. encoding
m = pd.get_dummies(f, columns=["city", "season"], prefix=["city", "season"], dtype=int)
m["ward_code"] = m["ward_id"].astype("category").cat.codes  # for tree models / embeddings

# ---------------------------------------------------------------- 9. redundancy check
num = m.select_dtypes("number").drop(columns=[TARGET, "log_cases"])
const = [c for c in num if num[c].nunique() <= 1]
m = m.drop(columns=const)
note(f"Removed {len(const)} constant columns: {const}")
corr = num.drop(columns=const).corr().abs()
upper = corr.where(np.triu(np.ones(corr.shape, dtype=bool), 1))
pairs = upper.stack()
note("Highly collinear pairs (|r|>0.95, kept; drop for linear models): "
     + ", ".join(f"{a}~{b} ({r:.2f})" for (a, b), r in pairs[pairs > 0.95].items()))

# ---------------------------------------------------------------- 10. chronological split + scaling
train = m[m["year"] <= 2023].copy()
val = m[m["year"] == 2024].copy()
test = m[m["year"] == 2025].copy()
binary = [c for c in m.select_dtypes("number") if set(m[c].unique()) <= {0, 1}]
skip = set(binary) | {TARGET, "log_cases", "ward_code", "year", "month", "quarter", "week_of_year", "time_index"}
scale_cols = [c for c in m.select_dtypes("number") if c not in skip]
mu, sd = train[scale_cols].mean(), train[scale_cols].std().replace(0, 1)
for part in (train, val, test):
    part[scale_cols] = (part[scale_cols] - mu) / sd
for name, part in [("train", train), ("val", val), ("test", test)]:
    part.to_csv(OUT / f"{name}.csv", index=False, date_format="%Y-%m-%d")
json.dump({"scaled_columns": scale_cols, "mean": mu.round(8).to_dict(), "std": sd.round(8).to_dict(),
           "target": TARGET, "alt_target": "log_cases"}, open(OUT / "scaler_params.json", "w"), indent=2)
note(f"Split (chronological, no shuffling): train<=2023 {train.shape}, val=2024 {val.shape}, "
     f"test=2025 {test.shape}; StandardScaler on {len(scale_cols)} continuous columns fitted on train only")

# ---------------------------------------------------------------- 11. report
desc = clean[STATIC + WEATHER + [TARGET]].describe().T.round(2)
table = ["| column | " + " | ".join(desc.columns) + " |", "|---" * (len(desc.columns) + 1) + "|"]
table += [f"| {i} | " + " | ".join(f"{v:g}" for v in r) + " |" for i, r in desc.iterrows()]
report = ["# Preprocessing report", "", f"Source: `{SRC.name}`", "", "## Steps and results", ""]
report += [f"{i}. {s}" for i, s in enumerate(log, 1)]
report += ["", "## Clean data summary", ""] + table + ["",
           "## Column guide", "",
           "- `was_imputed`: 1 if any value in the row was filled in",
           "- `outlier_*`: extreme for that ward in that calendar month (3xIQR); real events, kept",
           "- `humidity_capped`: humidity at the 99% sensor ceiling",
           "- `*_lagN` / `*_rollN_*`: past values only, safe for forecasting",
           "- `log_cases`: log1p(dengue_cases), an alternative target for skewed counts",
           "- Train/val/test are already scaled; `scaler_params.json` holds the mean/std to apply to new data"]
(OUT / "preprocessing_report.md").write_text("\n".join(report), encoding="utf-8")
print(f"\nDone. Outputs in {OUT.resolve()}")
