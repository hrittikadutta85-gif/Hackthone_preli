"""Ingestion and cleaning of weekly ward-level weather + dengue surveillance data.

Works on the bundled CSV or any upload with the same columns, so new weeks can be appended
without code changes. Every repair is counted and returned in a report.
"""
import numpy as np
import pandas as pd

from .config import BOUNDS, CITY_PREFIX, KEY, REQUIRED, STATIC, TARGET, WEATHER

NA_TOKENS = ["", "na", "n/a", "null", "none", "nan", "?", "-"]


def load_raw(source) -> pd.DataFrame:
    """Read a CSV path or file-like object with every column as text (types are enforced in clean)."""
    return pd.read_csv(source, dtype=str, keep_default_na=False)


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Validate, repair and regularise the data onto a complete ward x week grid."""
    rep = {"rows_in": len(raw)}
    df = raw.copy()
    df.columns = df.columns.str.strip().str.lower().str.replace(r"\W+", "_", regex=True)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df = df[REQUIRED]
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
        df.loc[df[c].str.lower().isin(NA_TOKENS), c] = np.nan

    df["ward_id"] = df["ward_id"].str.upper().str.replace("WARD", "Ward")
    df["date"] = pd.to_datetime(df["date"], errors="coerce", format="mixed")
    for c in STATIC + WEATHER + [TARGET]:
        df[c] = pd.to_numeric(df[c].str.replace(",", ""), errors="coerce")

    n = len(df)
    df = df.dropna(subset=["date", "ward_id"])
    rep["dropped_missing_key"] = n - len(df)
    n = len(df)
    df = df.drop_duplicates(subset=KEY, keep="last")
    rep["dropped_duplicates"] = n - len(df)

    prefix_city = df["ward_id"].str.split("_").str[0].map(CITY_PREFIX)
    rep["city_repaired"] = int((prefix_city.notna() & (df["city"] != prefix_city)).sum())
    df["city"] = prefix_city.fillna(df["city"].str.title())

    # Weekly grid anchored on Mondays; insert any missing ward-weeks.
    rep["dates_snapped"] = int((df["date"].dt.dayofweek != 0).sum())
    df["date"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="D")
    df = df.groupby(KEY, as_index=False).last()
    weeks = pd.date_range(df["date"].min(), df["date"].max(), freq="W-MON")
    grid = pd.MultiIndex.from_product([sorted(df["ward_id"].unique()), weeks], names=KEY)
    df = df.set_index(KEY).reindex(grid).reset_index()
    rep["weeks_inserted"] = int(df["city"].isna().sum())

    out_of_range = 0
    for c, (lo, hi) in BOUNDS.items():
        bad = (df[c] < lo) | (df[c] > hi)
        out_of_range += int(bad.sum())
        df.loc[bad, c] = np.nan
    rep["out_of_range_values"] = out_of_range
    swap = df["min_temp_c"] > df["max_temp_c"]
    df.loc[swap, ["min_temp_c", "max_temp_c"]] = df.loc[swap, ["max_temp_c", "min_temp_c"]].values
    rep["temp_min_max_swapped"] = int(swap.sum())

    df = df.sort_values(KEY).reset_index(drop=True)
    rep["cells_imputed"] = int(df[STATIC + WEATHER + ["city"]].isna().sum().sum())
    g = df.groupby("ward_id")
    df["city"] = g["city"].transform(lambda s: s.ffill().bfill())
    for c in STATIC:  # ward attributes are constant over time
        df[c] = g[c].transform(lambda s: s.ffill().bfill())
    for c in WEATHER:  # short gaps: interpolate in time; longer gaps: same-week city median
        df[c] = g[c].transform(lambda s: s.interpolate(limit=3, limit_direction="both"))
        df[c] = df[c].fillna(df.groupby(["city", "date"])[c].transform("median"))
        df[c] = df[c].fillna(df.groupby(["ward_id", df["date"].dt.month])[c].transform("median"))
    # Case counts: only bridge 1-2 week reporting gaps; longer gaps stay NaN (never fabricated).
    df[TARGET] = g[TARGET].transform(lambda s: s.interpolate(limit=2, limit_area="inside")).round()
    rep["case_weeks_missing"] = int(df[TARGET].isna().sum())

    rep["rows_out"] = len(df)
    rep["wards"] = int(df["ward_id"].nunique())
    rep["weeks"] = len(weeks)
    rep["date_min"], rep["date_max"] = str(weeks.min().date()), str(weeks.max().date())
    return df, rep
