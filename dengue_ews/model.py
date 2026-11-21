"""Inference: load serialized models once, predict cases, intervals, risk tiers and driver contributions."""
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from .config import MODEL_PATH, TIERS
from .features import FEATURE_GROUPS, FEATURE_TO_GROUP, add_horizon


def tier_of(cases, thresholds: dict) -> np.ndarray:
    """Map expected weekly cases to Low / Medium / High / Critical."""
    cuts = [thresholds["Medium"], thresholds["High"], thresholds["Critical"]]
    return np.array(TIERS)[np.searchsorted(cuts, np.asarray(cases, dtype=float), side="right")]


def risk_score(cases, thresholds: dict) -> np.ndarray:
    """0-100 score, piecewise linear so each tier spans 25 points (Low 0-25 ... Critical 75-100)."""
    xp = [0, thresholds["Medium"], thresholds["High"], thresholds["Critical"], 2 * thresholds["Critical"]]
    return np.interp(np.asarray(cases, dtype=float), xp, [0, 25, 50, 75, 100]).round(1)


class LogBlend:
    """Weighted blend of a Poisson GLM and a LightGBM Poisson model on the log (link) scale.

    log(cases) = w * lgb_raw + (1 - w) * glm_raw. Both members are additive in log space, so the blend
    keeps exact per-feature contributions. w=0 is the pure GLM, w=1 the pure LightGBM.
    """

    def __init__(self, glm, lgb_booster, w: float):
        self.glm, self.lgb, self.w = glm, lgb_booster, w

    def _glm_terms(self, X):
        imp, scaler, glm = (self.glm.named_steps[k] for k in ("impute", "scale", "glm"))
        return scaler.transform(imp.transform(X)) * glm.coef_, float(glm.intercept_)

    def predict_log(self, X):
        glm_c, glm_b = self._glm_terms(X)
        return self.w * self.lgb.predict(X, raw_score=True) + (1 - self.w) * (glm_c.sum(axis=1) + glm_b)

    def predict(self, X):
        return np.exp(self.predict_log(X))

    def contributions(self, X):
        """(n x features) log-scale contributions and the scalar base value."""
        glm_c, glm_b = self._glm_terms(X)
        raw = self.lgb.predict(X, pred_contrib=True)
        return self.w * raw[:, :-1] + (1 - self.w) * glm_c, float(self.w * raw[0, -1] + (1 - self.w) * glm_b)


class DenguePredictor:
    """Holds one point model + two quantile models per forecast horizon."""

    def __init__(self, bundle: dict):
        self.models = bundle["models"]          # {h: {"model": LogBlend, "q_lo", "q_hi", "features"}}
        self.thresholds = bundle["thresholds"]  # tier cut-offs in cases / ward / week
        self.meta = bundle["meta"]
        self.horizons = sorted(self.models)

    def predict(self, feat: pd.DataFrame, horizons=None) -> pd.DataFrame:
        """Forecast from every origin row in `feat` (output of build_features) for each horizon."""
        out = []
        for h in horizons or self.horizons:
            m = self.models[h]
            fh = add_horizon(feat, h)
            X = fh[m["features"]]
            pred = np.clip(m["model"].predict(X), 0, None)
            lo = np.minimum(np.clip(m["q_lo"].predict(X), 0, None), pred)
            hi = np.maximum(m["q_hi"].predict(X), pred)
            out.append(pd.DataFrame({
                "ward_id": fh["ward_id"].values, "city": fh["city"].values, "origin_date": fh["date"].values,
                "horizon": h, "target_date": fh["target_date"].values, "actual": fh["target"].values,
                "predicted": pred.round(2), "lower_80": lo.round(2), "upper_80": hi.round(2),
                "risk_score": risk_score(pred, self.thresholds), "tier": tier_of(pred, self.thresholds)}))
        return pd.concat(out, ignore_index=True)

    def explain(self, feat_rows: pd.DataFrame, h: int) -> tuple[pd.DataFrame, float]:
        """Per-feature contributions on the log scale (Poisson link) for each row, plus the base value.

        exp(base + sum(contributions)) == predicted cases, so exp(c) is the multiplicative effect of a feature.
        """
        m = self.models[h]
        X = add_horizon(feat_rows, h)[m["features"]]
        contrib, base = m["model"].contributions(X)
        return pd.DataFrame(contrib, columns=m["features"], index=feat_rows.index), base

    def explain_groups(self, feat_row: pd.DataFrame, h: int) -> pd.DataFrame:
        """Contributions of one forecast summed into driver groups (rainfall, temperature, ...)."""
        contrib, _ = self.explain(feat_row, h)
        c = contrib.iloc[0]
        grouped = c.groupby(c.index.map(FEATURE_TO_GROUP)).sum().reindex(FEATURE_GROUPS).dropna()
        top = c.abs().sort_values(ascending=False)
        top_feature = {g: top[[f for f in top.index if FEATURE_TO_GROUP[f] == g]].index[0] for g in grouped.index}
        return pd.DataFrame({"group": grouped.index, "log_contribution": grouped.values,
                             "multiplier": np.exp(grouped.values),
                             "top_feature": [top_feature[g] for g in grouped.index]})


@lru_cache(maxsize=1)
def load_predictor(path: str = str(MODEL_PATH)) -> DenguePredictor:
    return DenguePredictor(joblib.load(path))
