"""Train, select and serialize the per-horizon dengue forecast models.

    python train.py            # ~10 min on a laptop CPU (not needed to run the app: models are committed)

Chronological protocol (split on the forecast *target* week):
  train  targets 2016-2023 -> fit candidates
  val    targets 2024      -> hyper-parameters, early stopping, GLM/LightGBM blend weight
  test   targets 2025      -> refit winner on train+val, score once (reported in the dashboard)
"""
import json
import time
import warnings

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import PoissonRegressor
from sklearn.metrics import mean_absolute_error, mean_poisson_deviance, mean_squared_error, r2_score
from sklearn.model_selection import ParameterSampler
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from dengue_ews.config import (BACKTEST_PATH, DATA_PATH, HORIZONS, METRICS_PATH, MODEL_DIR, MODEL_PATH, SEED,
                               TARGET, TIER_QUANTILES, TIERS, TRAIN_END, VAL_END)
from dengue_ews.data import clean, load_raw
from dengue_ews.features import FEATURES, add_horizon, build_features
from dengue_ews.model import LogBlend, tier_of

warnings.filterwarnings("ignore")
LGB_SPACE = {"num_leaves": [7, 15, 31, 63], "min_child_samples": [20, 40, 80, 160],
             "learning_rate": [0.02, 0.03, 0.05], "feature_fraction": [0.5, 0.7, 0.9],
             "bagging_fraction": [0.7, 0.85, 1.0], "lambda_l2": [0, 1, 5, 20], "lambda_l1": [0, 0.1, 1]}
N_TRIALS = 20
GLM_ALPHAS = [1e-4, 1e-3, 1e-2, 1e-1]


def regression_metrics(y, p):
    p = np.clip(p, 1e-6, None)
    return {"MAE": round(mean_absolute_error(y, p), 4), "RMSE": round(mean_squared_error(y, p) ** 0.5, 4),
            "R2": round(r2_score(y, p), 4), "PoissonDeviance": round(mean_poisson_deviance(y, p), 4)}


def tier_metrics(y, p, thr):
    ta, tp = tier_of(y, thr), tier_of(p, thr)
    ia, ip = (pd.Categorical(t, categories=TIERS).codes for t in (ta, tp))
    alert_a, alert_p = np.isin(ta, ["High", "Critical"]), np.isin(tp, ["High", "Critical"])
    return {"tier_accuracy": round(float(np.mean(ta == tp)), 4),
            "tier_within_one": round(float(np.mean(np.abs(ia - ip) <= 1)), 4),
            "alert_recall": round(float(alert_p[alert_a].mean()), 4) if alert_a.any() else None,
            "alert_precision": round(float(alert_a[alert_p].mean()), 4) if alert_p.any() else None}


def fit_glm(alpha, X, y):
    return Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()),
                     ("glm", PoissonRegressor(alpha=alpha, max_iter=5000))]).fit(X, y)


def fit_lgb(params, X, y, Xv=None, yv=None, rounds=5000):
    dtr = lgb.Dataset(X, y, params={"feature_pre_filter": False})
    if Xv is None:
        return lgb.train(params, dtr, rounds)
    dva = lgb.Dataset(Xv, yv, reference=dtr)
    return lgb.train(params, dtr, rounds, valid_sets=[dva], callbacks=[lgb.early_stopping(200, verbose=False)])


def quantile_params(alpha):
    return {"objective": "quantile", "alpha": alpha, "metric": "quantile", "num_leaves": 15,
            "min_child_samples": 40, "learning_rate": 0.05, "feature_fraction": 0.8, "bagging_fraction": 0.85,
            "bagging_freq": 1, "verbose": -1, "seed": SEED}


def main():
    t0 = time.time()
    df, report = clean(load_raw(DATA_PATH))
    feat = build_features(df)
    hist = df.loc[df["date"] <= TRAIN_END, TARGET].dropna()
    thresholds = {t: float(hist.quantile(q)) for t, q in TIER_QUANTILES.items()}
    print(f"Data: {report['rows_out']} ward-weeks, {report['wards']} wards | tier thresholds {thresholds}")

    bundle = {"models": {}, "thresholds": thresholds,
              "meta": {"features": FEATURES, "train_end": TRAIN_END, "val_end": VAL_END, "data_report": report}}
    metrics, backtests = {"thresholds": thresholds, "horizons": {}}, []

    for h in HORIZONS:
        th = time.time()
        fh = add_horizon(feat, h).dropna(subset=FEATURES + ["target"])
        tr = fh[fh["target_date"] <= TRAIN_END]
        va = fh[(fh["target_date"] > TRAIN_END) & (fh["target_date"] <= VAL_END)]
        te = fh[fh["target_date"] > VAL_END]
        Xtr, ytr, Xva, yva, Xte, yte = tr[FEATURES], tr["target"], va[FEATURES], va["target"], te[FEATURES], te["target"]
        cand = {"persistence (cases now)": (va["cases_now"].values, None),
                "seasonal naive (last year)": (va["cases_last_year_target"].values, None)}

        best_glm = min(((a, fit_glm(a, Xtr, ytr)) for a in GLM_ALPHAS),
                       key=lambda am: mean_squared_error(yva, am[1].predict(Xva)))
        cand["poisson_glm"] = (best_glm[1].predict(Xva), {"alpha": best_glm[0]})

        best_lgb = None
        for p in ParameterSampler(LGB_SPACE, N_TRIALS, random_state=SEED):
            params = {"objective": "poisson", "metric": "rmse", "bagging_freq": 1, "verbose": -1, "seed": SEED, **p}
            m = fit_lgb(params, Xtr, ytr, Xva, yva)
            if best_lgb is None or m.best_score["valid_0"]["rmse"] < best_lgb[0]:
                best_lgb = (m.best_score["valid_0"]["rmse"], {**params, "rounds": m.best_iteration}, m)
        cand["lightgbm_poisson"] = (best_lgb[2].predict(Xva, num_iteration=best_lgb[2].best_iteration), best_lgb[1])

        # Log-scale blend weight chosen on validation (w=0 -> pure GLM, w=1 -> pure LightGBM).
        lgb_tr = best_lgb[2]
        lgb_tr.best_iteration = best_lgb[1]["rounds"]
        blends = {w: LogBlend(best_glm[1], lgb_tr, w) for w in np.round(np.arange(0, 1.01, 0.1), 1)}
        w_best = min(blends, key=lambda w: mean_squared_error(yva, blends[w].predict(Xva)))
        cand["blend_glm_lightgbm"] = (blends[w_best].predict(Xva),
                                      {"lightgbm_weight": float(w_best), "glm_alpha": best_glm[0],
                                       "lightgbm": best_lgb[1]})
        val_scores = {name: regression_metrics(yva, pred) for name, (pred, _) in cand.items()}
        winner = "blend_glm_lightgbm"

        # Quantile models for the 80% interval (early-stopped on val, then refit with the same rounds).
        q_rounds = {a: fit_lgb(quantile_params(a), Xtr, ytr, Xva, yva).best_iteration for a in (0.1, 0.9)}

        # Backtest rows for the validation year come from the train-only model.
        backtests.append(pd.DataFrame({"ward_id": va["ward_id"], "origin_date": va["date"], "horizon": h,
                                       "target_date": va["target_date"], "actual": yva,
                                       "predicted": np.clip(cand[winner][0], 0, None), "split": "val"}))

        # Refit winner + quantiles on train+val, score once on the 2025 test year.
        full = pd.concat([tr, va])
        Xf, yf = full[FEATURES], full["target"]
        scale = len(full) / len(tr)
        final = LogBlend(fit_glm(best_glm[0], Xf, yf),
                         fit_lgb({k: v for k, v in best_lgb[1].items() if k != "rounds"}, Xf, yf,
                                 rounds=max(50, int(best_lgb[1]["rounds"] * scale))), float(w_best))
        q_lo = fit_lgb(quantile_params(0.1), Xf, yf, rounds=max(50, int(q_rounds[0.1] * scale)))
        q_hi = fit_lgb(quantile_params(0.9), Xf, yf, rounds=max(50, int(q_rounds[0.9] * scale)))

        p_te = np.clip(final.predict(Xte), 0, None)
        lo, hi = np.minimum(np.clip(q_lo.predict(Xte), 0, None), p_te), np.maximum(q_hi.predict(Xte), p_te)
        test_scores = {**regression_metrics(yte, p_te), **tier_metrics(yte.values, p_te, thresholds),
                       "interval80_coverage": round(float(np.mean((yte >= lo) & (yte <= hi))), 4)}
        test_baselines = {"persistence (cases now)": regression_metrics(yte, te["cases_now"]),
                          "seasonal naive (last year)": regression_metrics(yte, te["cases_last_year_target"])}
        backtests.append(pd.DataFrame({"ward_id": te["ward_id"], "origin_date": te["date"], "horizon": h,
                                       "target_date": te["target_date"], "actual": yte, "predicted": p_te,
                                       "lower_80": lo, "upper_80": hi, "split": "test"}))

        # Importance = mean |log-scale contribution| on the test year (consistent with the dashboard drivers).
        contrib, _ = final.contributions(Xte)
        imp = np.abs(contrib).mean(axis=0)
        importance = pd.Series(imp / imp.sum(), index=FEATURES).sort_values(ascending=False).round(4)

        bundle["models"][h] = {"model": final, "q_lo": q_lo, "q_hi": q_hi, "features": FEATURES}
        metrics["horizons"][h] = {"winner": winner, "validation_2024": val_scores, "test_2025": test_scores,
                                  "test_2025_baselines": test_baselines,
                                  "hyperparameters": cand[winner][1], "n_train": len(tr), "n_val": len(va),
                                  "n_test": len(te), "top_features": importance.head(15).to_dict()}
        print(f"h={h}w  lightgbm weight={w_best:.1f} val RMSE {val_scores[winner]['RMSE']:.3f} | test MAE "
              f"{test_scores['MAE']:.3f} RMSE {test_scores['RMSE']:.3f} R2 {test_scores['R2']:.3f} "
              f"cov80 {test_scores['interval80_coverage']:.2f} alert recall {test_scores['alert_recall']} "
              f"({time.time() - th:.0f}s)")
        for name, s in val_scores.items():
            print(f"      val {name:<28} MAE {s['MAE']:.3f}  RMSE {s['RMSE']:.3f}  R2 {s['R2']:.3f}")

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(bundle, MODEL_PATH, compress=3)
    json.dump(metrics, open(METRICS_PATH, "w"), indent=2)
    bt = pd.concat(backtests, ignore_index=True)
    bt[["predicted", "lower_80", "upper_80"]] = bt[["predicted", "lower_80", "upper_80"]].round(3)
    bt.to_csv(BACKTEST_PATH, index=False, date_format="%Y-%m-%d")
    print(f"Saved {MODEL_PATH.name} ({MODEL_PATH.stat().st_size / 1e6:.1f} MB), metrics, backtest "
          f"in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
