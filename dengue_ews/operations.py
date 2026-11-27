"""Phase 2 operations: turn forecasts into supplies, crews, hospital beds and vector-control impact.

Everything here is plain NumPy/pandas arithmetic: deterministic, offline, no randomness and no external calls.
The forecasting model is only touched by the vector-control simulator (in backend/service.py), which re-runs it on
modified inputs.

Building blocks
* supply_need      forecast cases -> saline bags, test kits, hospital beds (the dataset's own rule)
* bed_capacity     dengue beds per ward, sized from the ward's own history
* priority_index   who gets scarce stock first: 70% model risk score, 30% population density
* water_fill       integer allocation of a limited stock, filling high-priority wards first
* crews_needed     vector-control crews a ward needs
* route_overflow   move patients a ward cannot bed to the least-burdened wards of the same city
* crew_efficacy    share of breeding habitat that k crews remove
"""
import numpy as np
import pandas as pd

from .config import (BED_CAPACITY_MIN, CASES_PER_CREW, CREW_SCALE, MAX_CREWS_PER_WARD,
                     MAX_EFFICACY, PRIORITY_FLOOR, PRIORITY_RISK_WEIGHT, SUPPLY_RULES, TARGET, TRAIN_END)

SALINE, KITS, BEDS = "saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required"


# ------------------------------------------------------------------ supplies
def supply_need(cases) -> dict[str, np.ndarray]:
    """Supplies needed for a week with `cases` patients: floor(rate * cases + offset), the rule in the dataset.

    Works on forecasts too (fractional expected cases). Never negative; NaN cases give 0.
    """
    c = np.nan_to_num(np.clip(np.asarray(cases, dtype=float), 0, None))
    return {k: np.floor(rate * c + offset).astype(int) for k, (rate, offset) in SUPPLY_RULES.items()}


def bed_capacity(df: pd.DataFrame) -> pd.Series:
    """Dengue beds each ward's hospitals can hold in a week.

    The data has no capacity figures, so we use what each ward has actually coped with: the beds it needed in the
    busiest week of a typical year (median of its annual peaks over the training years 2016-2023), rounded up, and
    never fewer than BED_CAPACITY_MIN. A normal season fits; an unusually sharp peak overflows.
    """
    hist = df[df["date"] <= TRAIN_END]
    beds = hist[BEDS] if BEDS in hist.columns else pd.Series(supply_need(hist[TARGET])[BEDS], index=hist.index)
    peaks = beds.groupby([hist["ward_id"], hist["date"].dt.year]).max()
    cap = peaks.groupby(level=0).median()
    return np.maximum(np.ceil(cap), BED_CAPACITY_MIN).astype(int).rename("bed_capacity")


# ------------------------------------------------------------------ priority
def density_percentile(density: pd.Series) -> pd.Series:
    """0-100: how crowded a ward is compared with all wards (100 = densest)."""
    return (density.rank(pct=True, method="average") * 100).round(1)


def allocation_weight(priority) -> np.ndarray:
    """Weight used by water_fill: fill rates are proportional to it, so priority 80 fills 2x faster than priority 30."""
    return np.asarray(priority, dtype=float) + PRIORITY_FLOOR


def priority_index(risk_score, density_pct) -> np.ndarray:
    """0-100 priority for scarce resources: mostly forecast risk, partly crowding (dense wards spread dengue faster)."""
    r = np.asarray(risk_score, dtype=float)
    d = np.asarray(density_pct, dtype=float)
    return np.round(PRIORITY_RISK_WEIGHT * r + (1 - PRIORITY_RISK_WEIGHT) * d, 1)


# ------------------------------------------------------------------ constrained allocation
def water_fill(demand, weight, stock: int) -> np.ndarray:
    """Share `stock` units among wards, never giving a ward more than it needs.

    Each ward's fill rate is proportional to its priority weight, capped at 100%:
        allocated_i = demand_i * min(1, lam * weight_i),   lam chosen so the total equals the stock.
    So the highest-priority wards are filled completely first, and lower-priority wards share what is left in
    proportion to their priority. Whole units are handed out by largest remainder (ties: higher weight, then order),
    so the result is deterministic and sums exactly to min(stock, total demand).
    """
    d = np.maximum(np.asarray(demand, dtype=float).round(), 0).astype(int)
    w = np.maximum(np.asarray(weight, dtype=float), 1e-3)
    stock = int(max(stock, 0))
    total = int(d.sum())
    if stock >= total:
        return d.copy()
    if stock == 0:
        return np.zeros_like(d)

    def filled(lam):
        return (d * np.minimum(1.0, lam * w)).sum()

    lo, hi = 0.0, 1.0 / w[d > 0].min()  # at `hi` every ward is full
    for _ in range(100):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if filled(mid) < stock else (lo, mid)
    exact = d * np.minimum(1.0, hi * w)
    out = np.minimum(np.floor(exact + 1e-9).astype(int), d)
    left = stock - int(out.sum())
    if left > 0:
        frac = exact - out
        order = np.lexsort((np.arange(len(d)), -w, -frac))  # biggest remainder, then priority, then position
        for i in order:
            if left == 0:
                break
            if out[i] < d[i]:
                out[i] += 1
                left -= 1
    elif left < 0:  # floating-point overshoot; take back from the lowest priority
        for i in np.argsort(w, kind="stable"):
            take = min(out[i], -left)
            out[i] -= take
            left += take
            if left == 0:
                break
    return out


def crews_needed(predicted, density, median_density: float, tier) -> np.ndarray:
    """Vector-control crews a ward needs this week (0 for Low-risk wards, at least 1 from Medium up)."""
    p = np.asarray(predicted, dtype=float)
    scale = np.sqrt(np.asarray(density, dtype=float) / median_density)
    need = np.ceil(p * scale / CASES_PER_CREW)
    need = np.clip(need, 1, MAX_CREWS_PER_WARD)
    return np.where(np.asarray(tier) == "Low", 0, need).astype(int)


# ------------------------------------------------------------------ hospital overflow
def route_overflow(wards: pd.DataFrame) -> tuple[pd.DataFrame, list[dict], list[dict]]:
    """Place patients a ward cannot bed in other wards **of the same city**.

    `wards` needs: ward_id, city, demand (beds), capacity (beds), priority.
    Each ward first fills its own beds. Overflow from the highest-priority wards is placed first, one patient at a
    time, in whichever ward of the same city currently has the lowest bed occupancy (ties: lower priority, then
    ward id). That spreads the extra load evenly instead of swamping one neighbour. Patients who cannot be placed
    anywhere in the city are the net deficit.

    Returns (per-ward table, transfers [{city, from, to, patients}], per-city pools).
    """
    w = wards.copy().reset_index(drop=True)
    w["demand"] = w["demand"].astype(int)
    w["capacity"] = w["capacity"].astype(int)
    w["local"] = np.minimum(w["demand"], w["capacity"])
    w["overflow"] = w["demand"] - w["local"]
    w["sent"] = 0
    w["received"] = 0
    moves: dict[tuple, int] = {}

    for city, idx in w.groupby("city").groups.items():
        idx = list(idx)
        senders = sorted((i for i in idx if w.at[i, "overflow"] > 0),
                         key=lambda i: (-w.at[i, "priority"], -w.at[i, "overflow"], w.at[i, "ward_id"]))
        for s in senders:
            while w.at[s, "sent"] < w.at[s, "overflow"]:
                spare = [i for i in idx if i != s and w.at[i, "overflow"] == 0
                         and w.at[i, "local"] + w.at[i, "received"] < w.at[i, "capacity"]]
                if not spare:
                    break
                r = min(spare, key=lambda i: ((w.at[i, "local"] + w.at[i, "received"]) / w.at[i, "capacity"],
                                              w.at[i, "priority"], w.at[i, "ward_id"]))
                w.at[s, "sent"] += 1
                w.at[r, "received"] += 1
                key = (city, w.at[s, "ward_id"], w.at[r, "ward_id"])
                moves[key] = moves.get(key, 0) + 1

    w["unplaced"] = w["overflow"] - w["sent"]
    w["occupied"] = w["local"] + w["received"]
    w["utilization"] = np.where(w["capacity"] > 0, w["occupied"] / w["capacity"], 0.0).round(3)
    w["net_balance"] = w["capacity"] - w["demand"]  # before routing: negative = the ward is short of beds
    w["beds_secured"] = w["local"] + w["sent"]     # this ward's patients who have a bed somewhere in the city

    transfers = [{"city": c, "from": a, "to": b, "patients": n} for (c, a, b), n in sorted(moves.items())]
    cities = []
    for city, g in w.groupby("city"):
        cap, dem, occ = int(g["capacity"].sum()), int(g["demand"].sum()), int(g["occupied"].sum())
        cities.append({"city": city, "wards": len(g), "capacity": cap, "demand": dem, "occupied": occ,
                       "headroom": cap - occ, "unplaced": int(g["unplaced"].sum()),
                       "overflow_wards": int((g["overflow"] > 0).sum()), "transferred": int(g["sent"].sum()),
                       "utilization_before": round(dem / cap, 3) if cap else 0.0,
                       "utilization_after": round(occ / cap, 3) if cap else 0.0})
    return w, transfers, cities


# ------------------------------------------------------------------ vector control
def crew_efficacy(crews, density, median_density: float) -> np.ndarray:
    """Share of a ward's breeding habitat that `crews` larvicide/fogging crews remove (0 .. MAX_EFFICACY).

    Saturating: the first crew helps most, and a denser ward needs more crews for the same coverage.
    """
    k = np.asarray(crews, dtype=float)
    scale = CREW_SCALE * np.sqrt(np.asarray(density, dtype=float) / median_density)
    return MAX_EFFICACY * (1 - np.exp(-k / scale))
