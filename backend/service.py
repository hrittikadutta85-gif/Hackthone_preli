"""Data + model service behind the API. Everything is loaded once at startup; requests are lookups or a single-ward re-score."""
import json
from functools import cached_property

import numpy as np
import pandas as pd

from dengue_ews.config import BACKTEST_PATH, DATA_PATH, HORIZONS, METRICS_PATH, MODEL_PATH, TIER_COLORS, TIERS, VAL_END
from dengue_ews.data import clean, load_raw
from dengue_ews.features import FEATURE_GROUPS, FEATURE_TO_GROUP, FEATURES, WEATHER_GROUPS, add_horizon, build_features
from dengue_ews.model import load_predictor, tier_of

from . import narrative as nl

PRECOMPUTE_FROM = "2024-01-01"  # forecasts are precomputed for origins from here on (validation + test years)
HEATMAP_WEEKS = 12
WHATIF_WEEKS = 8


def num(x, digits=2):
    """JSON-safe number: NaN/NaT become None."""
    return None if x is None or pd.isna(x) else round(float(x), digits)


def day(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


class Store:
    def __init__(self):
        self.predictor = load_predictor(str(MODEL_PATH))
        self.thr = self.predictor.thresholds
        self.df, self.report = clean(load_raw(DATA_PATH))
        self.feat = build_features(self.df)
        train = self.feat[self.feat["date"] <= "2023-12-31"].assign(woy=lambda d: d["date"].dt.isocalendar().week.astype(int))
        cols = [f for f in FEATURES if f in train.columns]
        self.clim = train.groupby(["ward_id", "woy"])[cols].median().to_dict("index")
        self.city_median = train.groupby("city")[cols].median().to_dict("index")
        self.dates = sorted(self.df["date"].unique())
        self.origins = [pd.Timestamp(d) for d in self.dates if d >= np.datetime64(PRECOMPUTE_FROM)]
        self.preds = self.predictor.predict(self.feat[self.feat["date"] >= PRECOMPUTE_FROM])
        self.metrics = json.load(open(METRICS_PATH))
        self._map_cache: dict[int, dict] = {}
        self.backtest = pd.read_csv(BACKTEST_PATH, parse_dates=["origin_date", "target_date"])
        self.city_of = self.df.drop_duplicates("ward_id").set_index("ward_id")["city"].to_dict()
        self.static = self.df.drop_duplicates("ward_id").set_index("ward_id")[
            ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]]

    # ------------------------------------------------------------------ helpers
    def snap(self, origin: str | None) -> pd.Timestamp:
        """Nearest forecast-origin week that exists (the UI sends week-start dates, but be forgiving)."""
        if not origin:
            return pd.Timestamp("2025-07-07") if pd.Timestamp("2025-07-07") in self.origins else self.origins[-1]
        t = pd.Timestamp(origin)
        return min(self.origins, key=lambda o: abs(o - t))

    def label(self, ward: str) -> str:
        return nl.ward_label(ward, self.city_of[ward])

    def horizon_rows(self, p: pd.DataFrame) -> list[dict]:
        return [{"h": int(r.horizon), "target_date": day(r.target_date), "predicted": float(r.predicted),
                 "lower": float(r.lower_80), "upper": float(r.upper_80), "score": float(r.risk_score),
                 "tier": r.tier, "actual": num(r.actual, 0)} for r in p.sort_values("horizon").itertuples()]

    def typical(self, ward: str, city: str, woy: int, f: str, group: str):
        """What a normal value of feature `f` looks like: this ward in this week of the year (2016-2023),
        or the city median for the ward's own static attributes."""
        if group == "Ward vulnerability":
            return self.city_median.get(city, {}).get(f)
        return self.clim.get((ward, woy), {}).get(f)

    def drivers(self, feat_row: pd.DataFrame, h: int) -> list[dict]:
        """How much each factor adds to (or removes from) the forecast compared with a typical week.

        Counterfactual, not a coefficient readout: re-score the ward with a group's features set to their typical
        values and report the difference in expected cases. Interactions between features are respected.
        """
        m = self.predictor.models[h]
        fh = add_horizon(feat_row, h)
        row = fh.iloc[0]
        woy = int(row["date"].isocalendar().week)
        base = row[m["features"]].astype(float)
        groups = {g: fs for g, fs in FEATURE_GROUPS.items() if g != "Seasonality"}

        def swapped(features):
            r = base.copy()
            for f in features:
                if f in r.index:
                    g = FEATURE_TO_GROUP[f]
                    v = self.typical(row["ward_id"], row["city"], woy, f, g)
                    if v is not None and pd.notna(v):
                        r[f] = v
            return r

        singles = [f for fs in groups.values() for f in fs if f in base.index]
        X = pd.DataFrame([base, *[swapped(fs) for fs in groups.values()], *[swapped([f]) for f in singles]]).astype(float)
        pred = np.clip(m["model"].predict(X.reset_index(drop=True)), 0, None)
        actual, by_group, by_feature = pred[0], pred[1:1 + len(groups)], dict(zip(singles, pred[1 + len(groups):]))
        out = []
        for g, fs in groups.items():
            cf = by_group[list(groups).index(g)]
            top = max((f for f in fs if f in by_feature), key=lambda f: abs(actual - by_feature[f]))
            out.append({"group": g, "plain": nl.GROUP_PLAIN[g], "effect_cases": round(float(actual - cf), 2),
                        "effect_pct": round(float(min(actual / max(cf, 0.5) - 1, 9.99)) * 100, 0),
                        "top_feature": nl.plain_feature(top), "weather": g in WEATHER_GROUPS,
                        "value": num(base[top])})
        return sorted(out, key=lambda d: d["effect_cases"])

    # ------------------------------------------------------------------ endpoints
    def meta(self) -> dict:
        wards = [{"id": w, "label": self.label(w), "city": c} for w, c in sorted(self.city_of.items())]
        return {"cities": sorted(set(self.city_of.values())), "wards": wards, "horizons": HORIZONS,
                "origins": [day(o) for o in self.origins], "default_origin": day(self.snap(None)),
                "thresholds": self.thr, "tiers": TIERS, "tier_colors": TIER_COLORS,
                "last_data_date": day(self.dates[-1]), "validation_end": VAL_END,
                "tier_help": {"Low": f"under {self.thr['Medium']:g} cases a week",
                              "Medium": f"{self.thr['Medium']:g} to {self.thr['High']:g} cases a week",
                              "High": f"{self.thr['High']:g} to {self.thr['Critical']:g} cases a week",
                              "Critical": f"{self.thr['Critical']:g}+ cases a week"},
                "tier_actions": {t: nl.ACTIONS[t] for t in TIERS}}

    def forecast(self, ward: str, origin: str | None, focus_h: int) -> dict:
        o = self.snap(origin)
        p = self.preds[(self.preds["ward_id"] == ward) & (self.preds["origin_date"] == o)]
        rows = self.horizon_rows(p)
        feat_row = self.feat[(self.feat["ward_id"] == ward) & (self.feat["date"] == o)]
        drivers = {h: self.drivers(feat_row, h) for h in HORIZONS}
        cases_now = feat_row["cases_now"].iloc[0]
        story = nl.forecast_story(self.label(ward), rows, drivers, cases_now, focus_h)

        w = self.df[self.df["ward_id"] == ward]
        hist = w[(w["date"] > o - pd.Timedelta(weeks=20)) & (w["date"] <= o + pd.Timedelta(weeks=4))]
        weather = w[(w["date"] > o - pd.Timedelta(weeks=12)) & (w["date"] <= o)]
        st = self.static.loc[ward]
        city_avg = self.static[self.static.index.map(self.city_of) == self.city_of[ward]].mean()
        return {
            "ward": ward, "label": self.label(ward), "city": self.city_of[ward], "origin": day(o),
            "focus_h": focus_h, "in_sample": bool(o + pd.Timedelta(weeks=focus_h) <= pd.Timestamp(VAL_END)),
            "horizons": rows, "drivers": drivers, **story, "cases_now": num(cases_now, 0),
            "history": [{"date": day(r.date), "cases": num(r.dengue_cases, 0), "future": bool(r.date > o)}
                        for r in hist.itertuples()],
            "weather": [{"date": day(r.date), "rain": num(r.rainfall_mm, 1), "temp": num(r.avg_temp_c, 1),
                         "humidity": num(r.relative_humidity_pct, 0)} for r in weather.itertuples()],
            "profile": {"density": int(st.population_density_sqkm), "waterlogging": num(st.water_logging_risk_index),
                        "sanitation": num(st.sanitation_score),
                        "density_vs_city": num(st.population_density_sqkm / city_avg.population_density_sqkm - 1, 2),
                        "waterlogging_vs_city": num(st.water_logging_risk_index - city_avg.water_logging_risk_index),
                        "sanitation_vs_city": num(st.sanitation_score - city_avg.sanitation_score)},
        }

    def whatif(self, ward: str, origin: str | None, rain_pct: float, temp_shift: float, hum_shift: float,
               rain_mm: list[float] | None, focus_h: int) -> dict:
        o = self.snap(origin)
        hist = self.df[(self.df["ward_id"] == ward) & (self.df["date"] <= o)].copy()
        idx = hist.index[hist["date"] > o - pd.Timedelta(weeks=WHATIF_WEEKS)]
        recorded = hist.loc[idx, ["date", "rainfall_mm", "avg_temp_c", "relative_humidity_pct"]]

        rain = np.array(rain_mm if rain_mm and len(rain_mm) == len(idx) else recorded["rainfall_mm"].values, float)
        hist.loc[idx, "rainfall_mm"] = np.clip(rain * (1 + rain_pct / 100), 0, None)
        hist.loc[idx, "avg_temp_c"] += temp_shift
        hist.loc[idx, ["max_temp_c", "min_temp_c"]] += temp_shift  # keep the day-night swing
        hist.loc[idx, "relative_humidity_pct"] = np.clip(hist.loc[idx, "relative_humidity_pct"] + hum_shift, 1, 100)

        sf = build_features(hist)
        # A single-ward rebuild cannot see other wards; reuse the recorded city-wide signal.
        city_sig = self.feat[self.feat["ward_id"] == ward].set_index("date")["city_cases_now"]
        sf["city_cases_now"] = sf["date"].map(city_sig)
        row = sf[sf["date"] == o]
        scen = self.horizon_rows(self.predictor.predict(row))
        base = self.horizon_rows(self.preds[(self.preds["ward_id"] == ward) & (self.preds["origin_date"] == o)])

        parts = []
        if rain_mm is not None and not np.allclose(rain_mm, recorded["rainfall_mm"].values, atol=0.05):
            parts.append("Your edited rainfall")
        if rain_pct:
            parts.append(f"{abs(rain_pct):.0f}% {'more' if rain_pct > 0 else 'less'} rain")
        if temp_shift:
            parts.append(f"{abs(temp_shift):g}°C {'warmer' if temp_shift > 0 else 'cooler'} weather")
        if hum_shift:
            parts.append(f"{abs(hum_shift):g} points {'more' if hum_shift > 0 else 'less'} humidity")
        changes = ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1] if parts else ""

        return {"ward": ward, "origin": day(o), "baseline": base, "scenario": scen,
                "summary": nl.whatif_story(self.label(ward), base, scen, changes, focus_h),
                "recorded_weather": [{"date": day(r.date), "rain": num(r.rainfall_mm, 1), "temp": num(r.avg_temp_c, 1),
                                      "humidity": num(r.relative_humidity_pct, 0)} for r in recorded.itertuples()]}

    def template(self, ward: str, weeks: int) -> dict:
        """The latest recorded weeks for a ward, used to pre-fill the prediction portal."""
        w = self.df[self.df["ward_id"] == ward].tail(weeks)
        return {"ward": ward, "label": self.label(ward), "weeks": [
            {"date": day(r.date), "rain": num(r.rainfall_mm, 1), "temp": num(r.avg_temp_c, 1),
             "humidity": num(r.relative_humidity_pct, 0), "cases": num(r.dengue_cases, 0)} for r in w.itertuples()]}

    def predict_custom(self, ward: str, weeks: list[dict], horizon: int) -> dict:
        """Forecast from weather and cases the user typed in (new weeks allowed), on top of the ward's earlier history."""
        dates = [pd.Timestamp(w["date"]) for w in weeks]
        dates = [d - pd.Timedelta(days=d.dayofweek) for d in dates]  # snap to the Monday grid
        if any((b - a).days != 7 for a, b in zip(dates, dates[1:])):
            raise ValueError("Weeks must be consecutive, one row per week with no gaps.")
        hist = self.df[(self.df["ward_id"] == ward) & (self.df["date"] < dates[0])].copy()
        if hist.empty or (dates[0] - hist["date"].max()).days > 7:
            last = day(hist["date"].max()) if len(hist) else "n/a"
            raise ValueError(f"Your first week must follow the recorded data (last recorded week: {last}) or overlap it.")
        if len(dates) + len(hist) < 9:
            raise ValueError("Not enough history to compute the lag features.")

        static = self.df[self.df["ward_id"] == ward].iloc[0]
        half_swing = float((hist["max_temp_c"] - hist["min_temp_c"]).tail(52).median()) / 2
        warnings, rows, prev = [], [], hist["dengue_cases"].iloc[-1]
        for d, w in zip(dates, weeks):
            cases = w.get("cases")
            if cases is None:
                cases = prev
                warnings.append(f"No case count for {day(d)}, so last week's {prev:.0f} was carried forward.")
            prev = cases
            rows.append({"date": d, "city": static["city"], "ward_id": ward,
                         "population_density_sqkm": static["population_density_sqkm"],
                         "water_logging_risk_index": static["water_logging_risk_index"],
                         "sanitation_score": static["sanitation_score"], "avg_temp_c": w["temp"],
                         "max_temp_c": w["temp"] + half_swing, "min_temp_c": w["temp"] - half_swing,
                         "rainfall_mm": w["rain"], "relative_humidity_pct": w["humidity"], "dengue_cases": cases})
        full = pd.concat([hist, pd.DataFrame(rows)], ignore_index=True)
        sf = build_features(full)
        # A one-ward frame cannot see the rest of the city: use recorded city signal where it exists, else this ward.
        city_sig = self.feat[self.feat["ward_id"] == ward].set_index("date")["city_cases_now"]
        sf["city_cases_now"] = sf["date"].map(city_sig).fillna(sf["cases_now"])
        origin = dates[-1]
        row = sf[sf["date"] == origin]
        out = self.horizon_rows(self.predictor.predict(row))
        drivers = {h: self.drivers(row, h) for h in HORIZONS}
        cases_now = row["cases_now"].iloc[0]
        story = nl.forecast_story(self.label(ward), out, drivers, cases_now, horizon)
        return {"ward": ward, "label": self.label(ward), "origin": day(origin), "horizons": out, "drivers": drivers,
                **story, "cases_now": num(cases_now, 0), "warnings": warnings}

    def outlook(self, origin: str | None) -> dict:
        """Expected cases per city for each of the next 4 weeks, plus how many wards reach High or Critical."""
        o = self.snap(origin)
        p = self.preds[self.preds["origin_date"] == o]
        now = self.feat[self.feat["date"] == o].groupby("city")["cases_now"].sum()

        def block(frame, cases_now):
            return {"cases_now": num(cases_now, 0), "wards": int(frame["ward_id"].nunique()), "horizons": [
                {"h": int(h), "target_date": day(g["target_date"].iloc[0]), "expected": round(float(g["predicted"].sum())),
                 "alert_wards": int(g["tier"].isin(["High", "Critical"]).sum())} for h, g in frame.groupby("horizon")]}

        cities = [{"city": c, **block(g, now.get(c))} for c, g in p.groupby("city")]
        total = block(p, now.sum())
        exp2 = next(h["expected"] for h in total["horizons"] if h["h"] == 2)
        diff = exp2 - (total["cases_now"] or 0)
        trend = "about the same as" if abs(diff) < 0.05 * max(exp2, 1) else ("up from" if diff > 0 else "down from")
        summary = (f"Across all {total['wards']} wards, about {exp2:,} cases are expected in 2 weeks, "
                   f"{trend} {total['cases_now']:,.0f} reported this week.")
        return {"origin": day(o), "cities": cities, "total": total, "summary": summary}

    def map_view(self, horizon: int) -> dict:
        """Every ward x every forecast week for one horizon, so the map's time-lapse runs without further requests."""
        if horizon in self._map_cache:
            return self._map_cache[horizon]
        p = self.preds[self.preds["horizon"] == horizon]
        wards = sorted(self.city_of)

        def grid(frame, col, digits):
            m = frame.pivot_table(index="ward_id", columns=frame.columns[1], values=col).reindex(index=wards, columns=self.origins)
            return [[num(v, digits) for v in row] for row in m.values]

        pv = p[["ward_id", "origin_date", "predicted", "lower_80", "upper_80", "actual"]].assign(
            tier=p["tier"].map({t: i for i, t in enumerate(TIERS)}))
        now = self.feat[self.feat["date"] >= PRECOMPUTE_FROM][["ward_id", "date", "cases_now"]]
        out = {"horizon": horizon, "weeks": [day(o) for o in self.origins],
               "wards": [{"ward": w, "label": self.label(w), "city": self.city_of[w], "num": w.split("_")[-1]} for w in wards],
               "predicted": grid(pv, "predicted", 1), "lower": grid(pv, "lower_80", 0), "upper": grid(pv, "upper_80", 0),
               "tier": [[None if v is None else int(v) for v in row] for row in grid(pv, "tier", 0)], "actual": grid(pv, "actual", 0), "cases_now": grid(now, "cases_now", 0)}
        self._map_cache[horizon] = out
        return out

    def city(self, origin: str | None, horizon: int, city: str | None) -> dict:
        o = self.snap(origin)
        p = self.preds[self.preds["horizon"] == horizon]
        if city:
            p = p[p["city"] == city]
        now = p[p["origin_date"] == o].copy()
        now_cases = self.feat[self.feat["date"] == o].set_index("ward_id")["cases_now"]
        now["cases_now"] = now["ward_id"].map(now_cases)
        now = now.sort_values("risk_score", ascending=False)
        wards = [{"ward": r.ward_id, "label": self.label(r.ward_id), "city": r.city, "predicted": float(r.predicted),
                  "lower": float(r.lower_80), "upper": float(r.upper_80), "score": float(r.risk_score), "tier": r.tier,
                  "cases_now": num(r.cases_now, 0), "actual": num(r.actual, 0)} for r in now.itertuples()]
        counts = now["tier"].value_counts().reindex(TIERS, fill_value=0)

        weeks = [t for t in self.origins if t <= o][-HEATMAP_WEEKS:]
        order = list(now["ward_id"])
        mat = (p[p["origin_date"].isin(weeks) & p["ward_id"].isin(order)]
               .pivot_table(index="ward_id", columns="origin_date", values="risk_score").reindex(order))
        heat = {"weeks": [day(w) for w in mat.columns],
                "rows": [{"ward": w, "label": self.label(w), "scores": [num(v, 0) for v in mat.loc[w]]} for w in order]}

        n_alert = int(counts["High"] + counts["Critical"])
        top = wards[0] if wards else None
        scope = city or "all five city corporations"
        if n_alert == 0:
            summary = f"No ward in {scope} is at High risk {nl.week_phrase(horizon)}. That's a good week to prepare."
        else:
            summary = (f"{n_alert} of {len(wards)} wards in {scope} could reach High or Critical risk "
                       f"{nl.week_phrase(horizon)}. {top['label']} needs attention first.")
        return {"origin": day(o), "horizon": horizon, "city": city, "wards": wards, "counts": counts.to_dict(),
                "heatmap": heat, "summary": summary, "in_sample": bool(o + pd.Timedelta(weeks=horizon) <= pd.Timestamp(VAL_END))}

    def performance(self, ward: str, horizon: int) -> dict:
        rows = []
        for h, m in self.metrics["horizons"].items():
            t, base = m["test_2025"], m["test_2025_baselines"]["persistence (cases now)"]
            rows.append({"h": int(h), "mae": t["MAE"], "rmse": t["RMSE"], "r2": t["R2"],
                         "baseline_rmse": base["RMSE"], "baseline_mae": base["MAE"],
                         "improvement_pct": round((1 - t["RMSE"] / base["RMSE"]) * 100, 0),
                         "coverage": t["interval80_coverage"], "tier_accuracy": t["tier_accuracy"],
                         "tier_within_one": t["tier_within_one"], "alert_recall": t["alert_recall"],
                         "alert_precision": t["alert_precision"]})
        bt = self.backtest[(self.backtest["split"] == "test") & (self.backtest["horizon"] == horizon)]
        bw = bt[bt["ward_id"] == ward].sort_values("target_date")
        cm = pd.crosstab(pd.Categorical(tier_of(bt["actual"], self.thr), TIERS),
                         pd.Categorical(tier_of(bt["predicted"], self.thr), TIERS), dropna=False)
        imp = pd.Series(self.metrics["horizons"][str(horizon)]["top_features"]).head(10)
        return {"horizon": horizon, "ward": ward, "label": self.label(ward), "summary": rows,
                "backtest": [{"date": day(r.target_date), "predicted": float(r.predicted), "lower": float(r.lower_80),
                              "upper": float(r.upper_80), "actual": num(r.actual, 0)} for r in bw.itertuples()],
                "confusion": {"tiers": TIERS, "matrix": cm.values.tolist()},
                "top_features": [{"name": nl.plain_feature(f), "share": round(float(v), 4)} for f, v in imp.items()],
                "split": {"train": "2016 to 2023", "validation": "2024", "test": "2025"}}
