"""Area dashboard: what the forecasting data says about a place, and how directly it applies.

Coverage levels, from most to least direct:
    ward              the dataset ward itself
    city              a city corporation: totals over its dataset wards
    city_context      a neighbourhood or point inside a covered city corporation. The dataset's wards are not mapped
                      to neighbourhoods, so only city-corporation totals are shown, labelled as such
    district_partial  a district or division that contains covered city corporations (only those are counted)
    none              not covered: "Dengue forecasting data is not available for this location."
No ward's forecast is ever shown as if it belonged to another place.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from dengue_ews.config import HORIZONS, TIERS

from ..narrative import ACTIONS
from .search import CITY_KEY, gazetteer

DATASET_CITY = {v: k for k, v in CITY_KEY.items()}  # CCC -> Chattogram
# Rough extent of each covered city corporation, for deciding whether a map point lies inside it.
CITY_RADIUS_KM = {"DNCC": 9.0, "DSCC": 7.0, "CCC": 10.0, "GCC": 14.0, "NCC": 6.0}
DIVISION_CITIES = {"Dhaka": ["DNCC", "DSCC", "GCC", "NCC"], "Chattogram": ["CCC"]}
DISTRICT_CITIES = {"Dhaka": ["DNCC", "DSCC"], "Gazipur": ["GCC"], "Narayanganj": ["NCC"], "Chattogram": ["CCC"]}
TIER_INDEX = {t: i for i, t in enumerate(TIERS)}


def km(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p1, p2, dl, dn = map(math.radians, (la1, la2, la2 - la1, lo2 - lo1))
    h = math.sin(dl / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dn / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def num(v, d=1):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), d)


def city_points() -> dict[str, list[float]]:
    return {p["city_corporation"]: p["point"] for p in gazetteer()["places"]
            if p["kind"] == "city_corporation" and p.get("point")}


def coverage(store, place: dict) -> dict:
    kind = place["kind"]
    wards_of = lambda cc: sorted(w for w, c in store.city_of.items() if c == DATASET_CITY[cc])  # noqa: E731
    if kind == "ward":
        return {"level": "ward", "cities": [place["city_corporation"]], "wards": [place["ward"]]}
    if kind == "city_corporation":
        cc = place["city_corporation"]
        return {"level": "city", "cities": [cc], "wards": wards_of(cc)} if cc in DATASET_CITY else {"level": "none"}
    if kind in ("neighbourhood", "locality", "osm"):
        cc = place.get("city_corporation")
        if not cc and place.get("point"):  # a geocoded point: is it inside a covered city corporation?
            pts = city_points()
            near = sorted(((km(place["point"], pts[c]), c) for c in CITY_RADIUS_KM if c in pts))
            if near and near[0][0] <= CITY_RADIUS_KM[near[0][1]]:
                cc = near[0][1]
            elif near:
                return {"level": "none", "nearest": {"city_corporation": near[0][1], "km": round(near[0][0], 1)}}
        if cc in DATASET_CITY:
            return {"level": "city_context", "cities": [cc], "wards": wards_of(cc)}
        return {"level": "none"}
    if kind == "district":
        cities = DISTRICT_CITIES.get(place["name"], [])
    elif kind == "division":
        cities = DIVISION_CITIES.get(place["name"], [])
    else:
        cities = []
    if not cities:
        return {"level": "none"}
    return {"level": "district_partial", "cities": cities, "wards": [w for c in cities for w in wards_of(c)]}


def latest_origin(store) -> pd.Timestamp:
    return store.origins[-1]


def dengue(store, place: dict, cov: dict) -> dict:
    if cov["level"] == "none":
        return {"available": False}
    o = latest_origin(store)
    wards = cov["wards"]
    p = store.preds[(store.preds["origin_date"] == o) & store.preds["ward_id"].isin(wards)]
    hist = store.df[store.df["ward_id"].isin(wards)]
    weekly = hist.groupby("date")["dengue_cases"].sum().sort_index()
    trend = [{"date": str(d.date()), "cases": int(v)} for d, v in weekly.iloc[-52:].items()]
    last_week = weekly.index[-1]
    horizons = []
    for h in HORIZONS:
        ph = p[p["horizon"] == h]
        counts = ph["tier"].value_counts().reindex(TIERS, fill_value=0)
        worst = next((t for t in reversed(TIERS) if counts[t]), "Low")
        horizons.append({"h": h, "target_date": str((o + pd.Timedelta(weeks=h)).date()),
                         "predicted": num(ph["predicted"].sum()), "lower": num(ph["lower_80"].sum(), 0),
                         "upper": num(ph["upper_80"].sum(), 0), "tier": worst if len(wards) > 1 else ph["tier"].iloc[0],
                         "tier_counts": {t: int(counts[t]) for t in TIERS}})
    out = {"available": True, "level": cov["level"], "origin": str(o.date()), "data_to": str(last_week.date()),
           "wards_counted": len(wards), "current": {"week": str(last_week.date()), "cases": int(weekly.iloc[-1]),
                                                     "last_4_weeks": int(weekly.iloc[-4:].sum())},
           "horizons": horizons, "trend": trend, "interval_note": "summed" if len(wards) > 1 else "model"}
    focus = horizons[1]
    if cov["level"] == "ward":
        f = store.forecast(wards[0], str(o.date()), 2)
        out["risk_factors"] = [{"text": d["plain"], "effect_pct": d["effect_pct"], "weather": d["weather"]}
                               for d in f["drivers"][2][:4]]
        out["headline"] = f["headline"]
        out["actions"] = f["actions"]
    else:
        ranked = p[p["horizon"] == 2].sort_values("predicted", ascending=False).head(5)
        out["top_wards"] = [{"ward": r.ward_id, "label": store.label(r.ward_id), "predicted": num(r.predicted),
                             "tier": r.tier} for r in ranked.itertuples()]
        out["actions"] = ACTIONS[focus["tier"]]
    out["risk_tier"] = focus["tier"]
    return out


def environment(store, cov: dict) -> dict:
    if cov["level"] == "none":
        return {"available": False}
    wards = cov["wards"]
    df = store.df
    last = df["date"].max()
    recent = df[(df["ward_id"].isin(wards)) & (df["date"] > last - pd.Timedelta(weeks=4))]
    latest = recent[recent["date"] == last]
    st = store.static
    # Derived vulnerability index: mean percentile (among all 60 dataset wards) of waterlogging, poor sanitation
    # and density, 0-100. A Dengue Watch composite for comparison only, not an official index.
    pct = pd.DataFrame({"wl": st["water_logging_risk_index"].rank(pct=True),
                        "san": (1 - st["sanitation_score"]).rank(pct=True),
                        "den": st["population_density_sqkm"].rank(pct=True)})
    vuln = pct.loc[wards].mean(axis=1).mean() * 100
    s = st.loc[wards]
    return {"available": True, "level": cov["level"], "week": str(last.date()), "wards_counted": len(wards),
            "sanitation_score": num(s["sanitation_score"].mean(), 2),
            "waterlogging_index": num(s["water_logging_risk_index"].mean(), 2),
            "vulnerability_index": num(vuln, 0),
            "population_density": int(round(s["population_density_sqkm"].mean())),
            "rain_week_mm": num(latest["rainfall_mm"].mean()),
            "rain_4w_mm": num(recent.groupby("ward_id")["rainfall_mm"].sum().mean()),
            "avg_temp_c": num(latest["avg_temp_c"].mean()), "humidity_pct": num(latest["relative_humidity_pct"].mean(), 0),
            "recent_cases_4w": int(recent["dengue_cases"].sum()),
            "dataset_range": {"sanitation": [num(st["sanitation_score"].min(), 2), num(st["sanitation_score"].max(), 2)],
                              "waterlogging": [num(st["water_logging_risk_index"].min(), 2),
                                               num(st["water_logging_risk_index"].max(), 2)]},
            "facility_counts": None}  # toilets, waste points, drains: no verified source connected


def bed_outlook(store, planner, cov: dict, as_of: str | None = None) -> dict:
    """Estimated dengue beds left: the planning model's ward capacity minus the beds the dataset and the forecast
    say are needed. Capacity is what each ward coped with in its busiest week of a typical year (2016-2023,
    dengue_ews.operations.bed_capacity); beds needed follow the dataset's own rule (0.30 x cases + 0.45). An
    estimate for planning, labelled as such, never presented as hospital-reported availability."""
    if cov["level"] == "none" or planner is None:
        return {"available": False}
    from dengue_ews import operations as ops
    wards = cov["wards"]
    cap = {w: int(planner.capacity[w]) for w in wards}
    total_cap = sum(cap.values())
    df = store.df
    o = store.snap(as_of) if as_of else latest_origin(store)  # the week looked at (default: latest data week)
    last = o
    recent = df[(df["ward_id"].isin(wards)) & (df["date"] > last - pd.Timedelta(weeks=12)) & (df["date"] <= last)]
    if "hospital_beds_required" in df.columns:
        used_by_week = recent.groupby("date")["hospital_beds_required"].sum().sort_index()
        used_now = {r.ward_id: int(r.hospital_beds_required) for r in recent[recent["date"] == last].itertuples()}
    else:
        used_by_week = recent.groupby("date")["dengue_cases"].sum().map(lambda c: int(ops.supply_need([c])[ops.BEDS][0]))
        used_now = {r.ward_id: int(ops.supply_need([r.dengue_cases])[ops.BEDS][0])
                    for r in recent[recent["date"] == last].itertuples()}
    p = store.preds[(store.preds["origin_date"] == o) & store.preds["ward_id"].isin(wards)]
    beds = lambda v: int(ops.supply_need([v])[ops.BEDS][0])  # noqa: E731

    def status(left_exp, left_worst):
        return "short" if left_exp < 0 else "tight" if left_worst < 0 else "enough"

    weeks, per_ward = [], {w: [] for w in wards}
    for h in HORIZONS:
        ph = p[p["horizon"] == h].set_index("ward_id")
        exp = {w: beds(ph.loc[w, "predicted"]) for w in wards if w in ph.index}
        up = {w: beds(ph.loc[w, "upper_80"]) for w in wards if w in ph.index}
        need_e, need_u = sum(exp.values()), sum(up.values())
        short = [w for w in exp if exp[w] > cap[w]]
        weeks.append({"h": h, "target_date": str((o + pd.Timedelta(weeks=h)).date()), "capacity": total_cap,
                      "needed_expected": need_e, "needed_worst": need_u, "left_expected": total_cap - need_e,
                      "left_worst": total_cap - need_u, "status": status(total_cap - need_e, total_cap - need_u),
                      "wards_short": len(short), "beds_short": sum(exp[w] - cap[w] for w in short)})
        for w in exp:
            per_ward[w].append({"h": h, "left_expected": cap[w] - exp[w], "left_worst": cap[w] - up[w]})
    used_total = sum(used_now.values())
    lowest = lambda w, k: min((x[k] for x in per_ward[w]), default=cap[w])  # noqa: E731
    ranked = sorted(wards, key=lambda w: (lowest(w, "left_expected"), lowest(w, "left_worst"), w))
    tightest = [{"ward": w, "label": store.label(w), "capacity": cap[w], "in_use": used_now.get(w, 0),
                 "left_now": cap[w] - used_now.get(w, 0), "min_left_expected": lowest(w, "left_expected"),
                 "min_left_worst": lowest(w, "left_worst")} for w in ranked[:6]]
    city_spare = None
    if cov["level"] == "ward":  # Module 2 routes overflow to other wards of the same city corporation
        city = store.city_of[wards[0]]
        others = [w for w, c in store.city_of.items() if c == city and w != wards[0]]
        p2 = store.preds[(store.preds["origin_date"] == o) & (store.preds["horizon"] == 2)
                         & store.preds["ward_id"].isin(others)].set_index("ward_id")
        city_spare = int(sum(max(0, int(planner.capacity[w]) - beds(p2.loc[w, "predicted"])) for w in others if w in p2.index))
    return {"available": True, "level": cov["level"], "wards_counted": len(wards), "capacity": total_cap,
            "week": str(last.date()), "in_use": used_total, "left_now": total_cap - used_total,
            "status_now": "short" if used_total > total_cap else "tight" if used_total >= 0.85 * total_cap else "enough",
            "weeks": weeks, "tightest": tightest, "city_spare_2w": city_spare, "latest": o == latest_origin(store),
            "choices": [str(d.date()) for d in store.origins[-52:]],
            "history": [{"date": str(d.date()), "in_use": int(v)} for d, v in used_by_week.items()]}
