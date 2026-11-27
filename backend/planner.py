"""Phase 2 operations service: constrained allocation, hospital overflow, vector-control simulation.

Sits on top of the forecasting Store (backend/service.py) and reuses its stored forecasts, so every number on the
operations pages comes from the same forecast the rest of the app shows. All arithmetic lives in
dengue_ews/operations.py; this module wires it to the forecasts and shapes the API responses.
"""
import heapq

import numpy as np
import pandas as pd

from dengue_ews import operations as ops
from dengue_ews.config import BREEDING_FEATURES, SIM_HORIZONS, SIM_MAX_CREWS, SUPPLY_RULES, VAL_END
from dengue_ews.features import add_horizon

from .service import PRECOMPUTE_FROM, Store, day

RES = {"saline": ops.SALINE, "kits": ops.KITS, "beds": ops.BEDS}
BASES = ("expected", "upper")


class Planner:
    def __init__(self, store: Store):
        self.s = store
        self.capacity = ops.bed_capacity(store.df)
        self.density = store.static["population_density_sqkm"]
        self.median_density = float(self.density.median())
        self.density_pct = ops.density_percentile(self.density)
        self._curves: dict[pd.Timestamp, dict] = {}

    def label(self, ward: str) -> str:
        return self.s.label(ward)

    def week(self, origin: pd.Timestamp, horizon: int) -> pd.DataFrame:
        p = self.s.preds
        return p[(p["origin_date"] == origin) & (p["horizon"] == horizon)]

    # ------------------------------------------------------------------ module 1 + 2: allocation and beds
    def plan(self, origin: str | None, horizon: int, stock_pct: float = 70, crews: int = 20, basis: str = "upper",
             city: str | None = None, saline_pct: float | None = None, kits_pct: float | None = None,
             beds_pct: float | None = None) -> dict:
        """Constrained allocation of saline, test kits, beds and vector-control crews for one forecast week.

        * Saline and kits: the regional store holds `pct`% of what the forecast says the wards need. It is shared out
          by priority (ops.water_fill): the riskiest, densest wards are filled first.
        * Beds: each ward has `pct`% of its normal dengue beds open. Patients that do not fit are routed to the
          least-burdened wards of the same city (ops.route_overflow). A ward's allocated beds = beds secured anywhere
          in its city; the rest is its net deficit.
        * Crews: `crews` teams shared out by priority against what each ward needs (ops.crews_needed).
        """
        o = self.s.snap(origin)
        pcts = {"saline": saline_pct or stock_pct, "kits": kits_pct or stock_pct, "beds": beds_pct or stock_pct}
        p = self.week(o, horizon)
        if city:
            p = p[p["city"] == city]
        p = p.sort_values("ward_id").reset_index(drop=True)
        cases = (p["upper_80"] if basis == "upper" else p["predicted"]).to_numpy(float)
        need = ops.supply_need(cases)
        dens = p["ward_id"].map(self.density).to_numpy(float)
        prio = ops.priority_index(p["risk_score"], p["ward_id"].map(self.density_pct))

        alloc, stock = {}, {}
        for key in ("saline", "kits"):
            d = need[RES[key]]
            stock[key] = int(round(d.sum() * pcts[key] / 100))
            alloc[key] = ops.water_fill(d, ops.allocation_weight(prio), stock[key])

        cap_full = p["ward_id"].map(self.capacity).to_numpy(int)
        cap = np.floor(cap_full * pcts["beds"] / 100 + 0.5).astype(int)
        routed, transfers, pools = ops.route_overflow(pd.DataFrame({
            "ward_id": p["ward_id"], "city": p["city"], "demand": need[ops.BEDS], "capacity": cap, "priority": prio}))
        routed = routed.set_index("ward_id")
        stock["beds"] = int(cap.sum())
        alloc["beds"] = routed.loc[p["ward_id"], "beds_secured"].to_numpy(int)

        crew_need = ops.crews_needed(p["predicted"], dens, self.median_density, p["tier"])
        crew_alloc = ops.water_fill(crew_need, ops.allocation_weight(prio), crews)

        out_of: dict[str, list] = {w: [] for w in p["ward_id"]}
        in_of: dict[str, list] = {w: [] for w in p["ward_id"]}
        for t in transfers:
            t["from_label"], t["to_label"] = self.label(t["from"]), self.label(t["to"])
            out_of[t["from"]].append({"ward": t["to"], "label": t["to_label"], "patients": t["patients"]})
            in_of[t["to"]].append({"ward": t["from"], "label": t["from_label"], "patients": t["patients"]})

        wards = []
        for i, r in p.iterrows():
            rw = routed.loc[r.ward_id]
            req = {k: int(need[v][i]) for k, v in RES.items()}
            got = {k: int(alloc[k][i]) for k in RES}
            short = {k: req[k] - got[k] for k in RES}
            fill = {k: (round(got[k] / req[k], 3) if req[k] else 1.0) for k in RES}
            deficits = [k for k in RES if short[k] > 0]
            urgent = r.tier in ("High", "Critical")
            status = ("critical" if deficits and (urgent or min(fill.values()) < 0.5)
                      else "deficit" if deficits else "ok")
            wards.append({
                "ward": r.ward_id, "label": self.label(r.ward_id), "city": r.city, "tier": r.tier,
                "score": float(r.risk_score), "predicted": float(r.predicted), "lower": float(r.lower_80),
                "upper": float(r.upper_80), "planning_cases": round(float(cases[i]), 2),
                "density": int(dens[i]), "density_pct": float(self.density_pct[r.ward_id]),
                "priority": float(prio[i]), "required": req, "allocated": got, "shortfall": short, "fill": fill,
                "crews_needed": int(crew_need[i]), "crews": int(crew_alloc[i]),
                "beds": {"capacity": int(cap[i]), "normal_capacity": int(cap_full[i]), "local": int(rw.local),
                         "sent": int(rw.sent), "received": int(rw.received), "unplaced": int(rw.unplaced),
                         "occupied": int(rw.occupied), "utilization": float(rw.utilization),
                         "net_balance": int(rw.net_balance)},
                "transfers_out": out_of[r.ward_id], "transfers_in": in_of[r.ward_id],
                "deficits": deficits, "status": status})
        wards.sort(key=lambda w: (-w["priority"], w["ward"]))
        for n, w in enumerate(wards, 1):
            w["rank"] = n

        totals = {}
        for k in RES:
            req = sum(w["required"][k] for w in wards)
            got = sum(w["allocated"][k] for w in wards)
            totals[k] = {"required": req, "available": stock[k], "allocated": got, "shortfall": req - got,
                         "pct": pcts[k], "wards_short": sum(w["shortfall"][k] > 0 for w in wards),
                         "fill": round(got / req, 3) if req else 1.0}
        used = int(crew_alloc.sum())
        totals["crews"] = {"available": int(crews), "needed": int(crew_need.sum()), "assigned": used,
                           "spare": int(crews) - used, "wards_needing": int((crew_need > 0).sum()),
                           "wards_short": int(((crew_need - crew_alloc) > 0).sum())}
        return {"origin": day(o), "horizon": horizon, "target_date": day(o + pd.Timedelta(weeks=horizon)),
                "city": city, "basis": basis,
                "params": {"stock_pct": stock_pct, "crews": crews, **{f"{k}_pct": v for k, v in pcts.items()}},
                "wards": wards, "totals": totals, "transfers": transfers, "pools": pools,
                "alerts": {"critical": sum(w["status"] == "critical" for w in wards),
                           "deficit": sum(w["status"] == "deficit" for w in wards)},
                "rules": {k: {"per_case": SUPPLY_RULES[v][0], "offset": SUPPLY_RULES[v][1]} for k, v in RES.items()},
                "in_sample": bool(o + pd.Timedelta(weeks=horizon) <= pd.Timestamp(VAL_END))}

    # ------------------------------------------------------------------ prediction portal
    def resource_outlook(self, ward: str, horizons: list[dict]) -> dict:
        """Supplies, beds and crews a forecast implies for one ward: per week, for expected cases and the upper 80%
        bound, against the ward's normal dengue bed capacity."""
        cap = int(self.capacity[ward])
        dens = float(self.density[ward])
        weeks = []
        for r in horizons:
            exp, up = ops.supply_need([r["predicted"]]), ops.supply_need([r["upper"]])
            crews = int(ops.crews_needed([r["predicted"]], [dens], self.median_density, [r["tier"]])[0])
            weeks.append({"h": r["h"], "target_date": r["target_date"], "tier": r["tier"],
                          "expected": {k: int(exp[v][0]) for k, v in RES.items()},
                          "upper": {k: int(up[v][0]) for k, v in RES.items()},
                          "crews": crews, "over_capacity": int(up[ops.BEDS][0]) > cap,
                          "over_capacity_expected": int(exp[ops.BEDS][0]) > cap})
        totals = {basis: {k: sum(w[basis][k] for w in weeks) for k in RES} for basis in ("expected", "upper")}
        return {"bed_capacity": cap, "weeks": weeks, "totals": totals,
                "peak_beds": max(w["upper"]["beds"] for w in weeks) if weeks else 0}

    # ------------------------------------------------------------------ module 3: vector-control simulator
    def curves(self, origin: pd.Timestamp) -> dict:
        """Model forecasts for every ward with 0..SIM_MAX_CREWS crews, for weeks 2-4 ahead. Cached per origin week.

        A crew removes breeding habitat (larviciding, source reduction, fogging around it), so the model is re-run
        with the ward's standing-water inputs (this week's and the last four weeks' rain, heavy-rain weeks,
        water-logging and the vulnerability index) scaled down by the crews' coverage (ops.crew_efficacy). Everything
        else the model sees (temperature, humidity, recent cases, season) is left as recorded.
        """
        if origin in self._curves:
            return self._curves[origin]
        wards = sorted(self.s.city_of)
        dens = self.density.reindex(wards).to_numpy(float)
        feat = self.s.feat
        window = feat[(feat["date"] >= PRECOMPUTE_FROM) & (feat["date"] <= origin)]
        ks = range(SIM_MAX_CREWS + 1)
        eff = np.array([ops.crew_efficacy(k, dens, self.median_density) for k in ks])  # (crews, wards)
        pred = {}
        for h in SIM_HORIZONS:
            m = self.s.predictor.models[h]
            fh = add_horizon(window, h)
            X = fh[fh["date"] == origin].set_index("ward_id").reindex(wards)[m["features"]].astype(float)
            cols = [c for c in BREEDING_FEATURES if c in X.columns]
            blocks = []
            for k in ks:
                Xk = X.copy()
                Xk[cols] = Xk[cols].mul(1 - eff[k], axis=0)
                blocks.append(Xk)
            y = np.clip(m["model"].predict(pd.concat(blocks).reset_index(drop=True)), 0, None)
            y = y.reshape(len(ks), len(wards)).T        # (wards, crews)
            pred[h] = np.minimum.accumulate(y, axis=1)  # adding a crew never raises the forecast
        out = {"wards": wards, "index": {w: i for i, w in enumerate(wards)}, "pred": pred, "efficacy": eff.T,
               "targets": {h: day(origin + pd.Timedelta(weeks=h)) for h in SIM_HORIZONS}}
        if len(self._curves) >= 64:
            self._curves.pop(next(iter(self._curves)))
        self._curves[origin] = out
        return out

    @staticmethod
    def best_deployment(gain: np.ndarray, budget: int, prio: np.ndarray) -> np.ndarray:
        """Greedy: each crew goes to the ward where it prevents the most extra cases (gain[i, k] = cases prevented
        by the (k+1)-th crew in ward i). With diminishing returns this gives the best split of the budget."""
        k = np.zeros(gain.shape[0], dtype=int)
        heap = [(-gain[i, 0], -prio[i], i) for i in range(gain.shape[0])]
        heapq.heapify(heap)
        for _ in range(int(budget)):
            if not heap:
                break
            g, _, i = heapq.heappop(heap)
            if -g < 0.01:  # nowhere left where a crew still prevents a meaningful number of cases
                break
            k[i] += 1
            if k[i] < gain.shape[1]:
                heapq.heappush(heap, (-gain[i, k[i]], -prio[i], i))
        return k

    def simulate(self, origin: str | None, deployments: dict[str, int] | None = None, crews: int = 10,
                 city: str | None = None) -> dict:
        """Counterfactual forecast of weeks 2-4 with and without crews, for every ward in scope.

        `deployments` maps ward -> crews (the officer's choice). Without it, `crews` crews are placed automatically
        where they prevent the most cases. Cases come from the model; beds and saline from the dataset's supply rule
        applied to those cases.
        """
        o = self.s.snap(origin)
        c = self.curves(o)
        scope = [w for w in c["wards"] if not city or self.s.city_of[w] == city]
        rows = [c["index"][w] for w in scope]
        now = self.week(o, 2).set_index("ward_id")
        prio = ops.priority_index(now.loc[scope, "risk_score"], [self.density_pct[w] for w in scope])
        total = sum(c["pred"][h][rows] for h in SIM_HORIZONS)  # (scope, crews): cases over weeks 2-4
        gain = -np.diff(total, axis=1)                          # cases prevented by one more crew
        if deployments is None:
            k, mode = self.best_deployment(gain, crews, prio), "auto"
        else:
            k = np.array([int(min(max(deployments.get(w, 0), 0), SIM_MAX_CREWS)) for w in scope])
            mode = "manual"

        by_week = {h: {"h": h, "target_date": c["targets"][h], "baseline": 0.0, "scenario": 0.0, "beds_baseline": 0,
                       "beds_scenario": 0, "saline_baseline": 0, "saline_scenario": 0} for h in SIM_HORIZONS}
        wards = []
        for j, (w, i) in enumerate(zip(scope, rows)):
            weeks = []
            for h in SIM_HORIZONS:
                b, sc = float(c["pred"][h][i, 0]), float(c["pred"][h][i, k[j]])
                need = ops.supply_need([b, sc])
                row = {"h": h, "target_date": c["targets"][h], "baseline": round(b, 2), "scenario": round(sc, 2),
                       "beds_baseline": int(need[ops.BEDS][0]), "beds_scenario": int(need[ops.BEDS][1]),
                       "saline_baseline": int(need[ops.SALINE][0]), "saline_scenario": int(need[ops.SALINE][1])}
                weeks.append(row)
                for key in by_week[h]:
                    if key not in ("h", "target_date"):
                        by_week[h][key] += row[key] if key.startswith(("beds", "saline")) else (b if key == "baseline" else sc)
            prevented = float(total[j, 0] - total[j, k[j]])
            wards.append({
                "ward": w, "label": self.label(w), "city": self.s.city_of[w], "tier": now.at[w, "tier"],
                "priority": float(prio[j]), "density": int(self.density[w]), "crews": int(k[j]),
                "coverage": round(float(c["efficacy"][i, k[j]]), 3),
                "baseline_cases": round(float(total[j, 0]), 2), "scenario_cases": round(float(total[j, k[j]]), 2),
                "prevented": round(prevented, 2),
                "beds_saved": sum(x["beds_baseline"] - x["beds_scenario"] for x in weeks),
                "saline_saved": sum(x["saline_baseline"] - x["saline_scenario"] for x in weeks),
                "roi": round(prevented / int(k[j]), 2) if k[j] else None,
                "next_crew_roi": round(float(gain[j, k[j]]), 2) if k[j] < SIM_MAX_CREWS else None,
                "first_crew_roi": round(float(gain[j, 0]), 2), "weeks": weeks})

        ranking = sorted((x for x in wards if x["crews"]), key=lambda x: (-x["roi"], x["ward"]))
        for n, x in enumerate(ranking, 1):
            x["roi_rank"] = n
        opportunities = sorted((x for x in wards if x["next_crew_roi"]), key=lambda x: (-x["next_crew_roi"], x["ward"]))[:10]
        used = int(k.sum())
        prevented = float(sum(x["prevented"] for x in wards))
        weeks = [{**v, "baseline": round(v["baseline"], 1), "scenario": round(v["scenario"], 1)} for v in by_week.values()]
        return {"origin": day(o), "city": city, "mode": mode, "crews_available": int(crews), "crews_used": used,
                "max_per_ward": SIM_MAX_CREWS, "horizons": SIM_HORIZONS,
                "totals": {"baseline": round(float(total[:, 0].sum()), 1),
                           "scenario": round(float(total[np.arange(len(scope)), k].sum()), 1),
                           "prevented": round(prevented, 1),
                           "beds_saved": sum(x["beds_saved"] for x in wards),
                           "saline_saved": sum(x["saline_saved"] for x in wards),
                           "roi": round(prevented / used, 2) if used else None},
                "weeks": weeks, "ranking": ranking, "opportunities": opportunities,
                "wards": sorted(wards, key=lambda x: (-x["crews"], -x["first_crew_roi"], x["ward"]))}
