"""Train and compare models that forecast next-week dengue cases per ward.

Usage:  python train_models.py [processed_dir] [output_dir]

Tuning uses train (<=2023) -> val (2024). The winning setup is refit on train+val and
scored once on the untouched 2025 test set.

Outputs (in output_dir, default ./models):
  leaderboard_val.csv, test_results.csv   metrics per model
  test_predictions.csv                    2025 actual vs predicted, per ward-week
  feature_importance.csv                  LightGBM gain importance
  final_model_*.txt / .json, ensemble.json   saved models + blend weights
"""
import json
import sys
import time
import warnings
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import PoissonRegressor
from sklearn.metrics import mean_absolute_error, mean_poisson_deviance, mean_squared_error, r2_score
from sklearn.model_selection import ParameterSampler

warnings.filterwarnings("ignore")
DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "experiments/processed")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "experiments/results")
OUT.mkdir(exist_ok=True)
SEED = 42
TARGET = "dengue_cases"
# outlier_dengue_cases is derived from the current week's target -> leakage; log_cases is the target itself.
DROP = ["date", "ward_id", TARGET, "log_cases", "outlier_dengue_cases"]

train, val, test = (pd.read_csv(DATA / f"{s}.csv") for s in ("train", "val", "test"))
FEATS = [c for c in train.columns if c not in DROP]
Xtr, ytr = train[FEATS], train[TARGET].values
Xva, yva = val[FEATS], val[TARGET].values
Xte, yte = test[FEATS], test[TARGET].values
print(f"{len(FEATS)} features | train {len(train)} | val {len(val)} | test {len(test)}")

# Lag features are scaled; recover raw case counts for the naive baselines.
sp = json.load(open(DATA / "scaler_params.json"))
def unscale(df, c):
    return df[c] * sp["std"][c] + sp["mean"][c]


def metrics(y, p):
    p = np.clip(p, 1e-6, None)
    return {"MAE": mean_absolute_error(y, p), "RMSE": mean_squared_error(y, p) ** 0.5,
            "R2": r2_score(y, p), "PoissonDev": mean_poisson_deviance(y, p),
            "Acc_exact": np.mean(np.round(p) == y), "Acc_within1": np.mean(np.abs(np.round(p) - y) <= 1)}


val_preds, best_cfg, rows = {}, {}, []
def record(name, p, secs, cfg=None):
    val_preds[name] = np.clip(p, 0, None)
    best_cfg[name] = cfg
    rows.append({"model": name, **metrics(yva, p), "fit_s": round(secs, 1)})
    print(f"  {name:<22} val MAE {rows[-1]['MAE']:.3f}  RMSE {rows[-1]['RMSE']:.3f}  R2 {rows[-1]['R2']:.4f}")

# ---------------------------------------------------------------- baselines
print("Baselines")
record("naive_last_week", unscale(val, "cases_lag1").values, 0)
record("naive_4wk_mean", unscale(val, "cases_roll4_mean").values, 0)
record("seasonal_last_year", unscale(val, "cases_lag52").values, 0)

# ---------------------------------------------------------------- linear count model
print("Linear")
t = time.time()
glm_feats = [c for c in FEATS if c != "ward_code"]
glm = PoissonRegressor(alpha=1e-3, max_iter=3000).fit(Xtr[glm_feats], ytr)
record("poisson_glm", glm.predict(Xva[glm_feats]), time.time() - t, {"alpha": 1e-3})

# ---------------------------------------------------------------- random forest
print("Random forest")
t = time.time()
rf = RandomForestRegressor(n_estimators=500, min_samples_leaf=3, max_features=0.4, n_jobs=-1,
                           random_state=SEED).fit(Xtr, ytr)
record("random_forest", rf.predict(Xva), time.time() - t,
       {"n_estimators": 500, "min_samples_leaf": 3, "max_features": 0.4})

# ---------------------------------------------------------------- sklearn HistGB (Poisson)
print("HistGradientBoosting")
t = time.time()
hgb = HistGradientBoostingRegressor(loss="poisson", learning_rate=0.05, max_iter=2000, max_leaf_nodes=31,
                                    l2_regularization=1.0, early_stopping=True, validation_fraction=0.15,
                                    n_iter_no_change=100, random_state=SEED).fit(Xtr, ytr)
record("hist_gb_poisson", hgb.predict(Xva), time.time() - t,
       {"max_iter": int(hgb.n_iter_), "learning_rate": 0.05, "max_leaf_nodes": 31, "l2_regularization": 1.0})

# ---------------------------------------------------------------- LightGBM, random search per objective
LGB_SPACE = {"num_leaves": [15, 31, 63, 127], "min_child_samples": [10, 20, 40, 80],
             "learning_rate": [0.02, 0.03, 0.05], "feature_fraction": [0.5, 0.7, 0.9],
             "bagging_fraction": [0.7, 0.85, 1.0], "lambda_l2": [0, 1, 5, 20], "lambda_l1": [0, 0.1, 1]}
dtr = lgb.Dataset(Xtr, ytr, categorical_feature=["ward_code"], free_raw_data=False,
                  params={"feature_pre_filter": False})
dva = lgb.Dataset(Xva, yva, reference=dtr)
for obj, extra in [("poisson", {}), ("tweedie", {"tweedie_variance_power": 1.3}), ("regression", {})]:
    print(f"LightGBM {obj}: 30-trial search")
    t, best = time.time(), None
    for params in ParameterSampler(LGB_SPACE, 30, random_state=SEED):
        p = {"objective": obj, "metric": "rmse", "bagging_freq": 1, "verbose": -1, "seed": SEED,
             "num_threads": 0, **extra, **params}
        m = lgb.train(p, dtr, 5000, valid_sets=[dva], callbacks=[lgb.early_stopping(200, verbose=False)])
        score = m.best_score["valid_0"]["rmse"]
        if best is None or score < best[0]:
            best = (score, {**p, "num_boost_round": m.best_iteration}, m)
    record(f"lightgbm_{obj}", best[2].predict(Xva, num_iteration=best[2].best_iteration), time.time() - t, best[1])
    if obj == "poisson":
        imp = pd.DataFrame({"feature": FEATS, "gain": best[2].feature_importance("gain")})
        imp.sort_values("gain", ascending=False).to_csv(OUT / "feature_importance.csv", index=False)

# ---------------------------------------------------------------- XGBoost, random search per objective
XGB_SPACE = {"max_depth": [4, 6, 8], "min_child_weight": [1, 5, 10], "learning_rate": [0.02, 0.03, 0.05],
             "subsample": [0.7, 0.85, 1.0], "colsample_bytree": [0.5, 0.7, 0.9],
             "reg_lambda": [1, 5, 20], "reg_alpha": [0, 0.1, 1]}
xtr, xva = xgb.DMatrix(Xtr, ytr), xgb.DMatrix(Xva, yva)
for obj in ["count:poisson", "reg:tweedie", "reg:squarederror"]:
    print(f"XGBoost {obj}: 20-trial search")
    t, best = time.time(), None
    for params in ParameterSampler(XGB_SPACE, 20, random_state=SEED):
        p = {"objective": obj, "eval_metric": "rmse", "tree_method": "hist", "seed": SEED, **params}
        if obj == "count:poisson":
            p["max_delta_step"] = 0.7
        m = xgb.train(p, xtr, 5000, evals=[(xva, "val")], early_stopping_rounds=200, verbose_eval=False)
        if best is None or m.best_score < best[0]:
            best = (m.best_score, {**p, "num_boost_round": m.best_iteration + 1}, m)
    name = "xgboost_" + obj.split(":")[1]
    record(name, best[2].predict(xva, iteration_range=(0, best[2].best_iteration + 1)), time.time() - t, best[1])

# ---------------------------------------------------------------- ensemble of the best learners
board = pd.DataFrame(rows).sort_values("RMSE").reset_index(drop=True)
learners = [m for m in board["model"] if not m.startswith("naive") and not m.startswith("seasonal")]
top = learners[:4]
P = np.column_stack([val_preds[m] for m in top])
# Non-negative weights summing to 1, found by coarse grid over the simplex (robust, no overfit-prone optimiser).
best_w, best_rmse = None, np.inf
grid = np.arange(0, 1.01, 0.05)
for w1 in grid:
    for w2 in grid[grid <= 1 - w1 + 1e-9]:
        for w3 in grid[grid <= 1 - w1 - w2 + 1e-9]:
            w = np.array([w1, w2, w3, 1 - w1 - w2 - w3])
            r = mean_squared_error(yva, P @ w) ** 0.5
            if r < best_rmse:
                best_w, best_rmse = w, r
weights = dict(zip(top, best_w.round(2)))
print(f"Ensemble weights: {weights}")
record("ensemble", P @ best_w, 0, {"weights": weights})
board = pd.DataFrame(rows).sort_values("RMSE").reset_index(drop=True)
board.to_csv(OUT / "leaderboard_val.csv", index=False)

# ---------------------------------------------------------------- refit on train+val, score on test
print("\nRefitting on train+val and scoring on 2025 test")
full = pd.concat([train, val], ignore_index=True)
Xf, yf = full[FEATS], full[TARGET].values


def refit_predict(name):
    cfg = best_cfg[name]
    if name.startswith("lightgbm"):
        p = {k: v for k, v in cfg.items() if k != "num_boost_round"}
        rounds = int(cfg["num_boost_round"] * len(full) / len(train))  # scale rounds to larger data
        m = lgb.train(p, lgb.Dataset(Xf, yf, categorical_feature=["ward_code"]), rounds)
        m.save_model(str(OUT / f"final_model_{name}.txt"))
        return m.predict(Xte)
    if name.startswith("xgboost"):
        p = {k: v for k, v in cfg.items() if k != "num_boost_round"}
        rounds = int(cfg["num_boost_round"] * len(full) / len(train))
        m = xgb.train(p, xgb.DMatrix(Xf, yf), rounds)
        m.save_model(str(OUT / f"final_model_{name}.json"))
        return m.predict(xgb.DMatrix(Xte))
    if name == "random_forest":
        return RandomForestRegressor(**cfg, n_jobs=-1, random_state=SEED).fit(Xf, yf).predict(Xte)
    if name == "hist_gb_poisson":
        return HistGradientBoostingRegressor(loss="poisson", early_stopping=False, random_state=SEED,
                                             **cfg).fit(Xf, yf).predict(Xte)
    if name == "poisson_glm":
        return PoissonRegressor(**cfg, max_iter=3000).fit(Xf[glm_feats], yf).predict(Xte[glm_feats])


test_preds = {m: np.clip(refit_predict(m), 0, None) for m in top}
test_preds["ensemble"] = np.column_stack([test_preds[m] for m in top]) @ best_w
test_preds["naive_last_week"] = unscale(test, "cases_lag1").values
test_res = pd.DataFrame([{"model": m, **metrics(yte, p)} for m, p in test_preds.items()]).sort_values("RMSE")
test_res.to_csv(OUT / "test_results.csv", index=False)
json.dump({"members": top, "weights": weights, "features": FEATS}, open(OUT / "ensemble.json", "w"),
          indent=2, default=float)

winner = test_res.iloc[0]["model"]
pd.DataFrame({"date": test["date"], "ward_id": test["ward_id"], "actual": yte,
              "predicted": test_preds[winner].round(2), "predicted_int": np.round(test_preds[winner]).astype(int)}
             ).to_csv(OUT / "test_predictions.csv", index=False)

pd.set_option("display.width", 200)
print("\n=== Validation leaderboard (2024) ===")
print(board.round(4).to_string(index=False))
print("\n=== Final test results (2025, never seen during tuning) ===")
print(test_res.round(4).to_string(index=False))
print(f"\nBest on test: {winner}")
