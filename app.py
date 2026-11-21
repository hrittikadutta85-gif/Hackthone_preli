"""Dengue Early-Warning Dashboard (Streamlit).

    streamlit run app.py
"""
import hashlib
import io
import json

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from dengue_ews.config import (BACKTEST_PATH, DATA_PATH, HORIZONS, METRICS_PATH, MODEL_PATH, TIER_COLORS, TIERS,
                               VAL_END, WEATHER)
from dengue_ews.data import clean, load_raw
from dengue_ews.features import FEATURE_TO_GROUP, WEATHER_GROUPS, build_features
from dengue_ews.model import DenguePredictor, load_predictor

st.set_page_config(page_title="Dengue Early Warning", page_icon="🦟", layout="wide")


# ---------------------------------------------------------------- cached loaders (run once per data version)
@st.cache_resource(show_spinner="Loading models...")
def get_predictor() -> DenguePredictor:
    return load_predictor(str(MODEL_PATH))


@st.cache_data(show_spinner="Cleaning data and computing ward-level lag features...")
def prepare(_raw_bytes: bytes | None, key: str):
    """`key` (content hash) is the cache key, so the raw bytes are not re-hashed on every rerun."""
    raw = load_raw(DATA_PATH) if _raw_bytes is None else load_raw(io.BytesIO(_raw_bytes))
    df, report = clean(raw)
    return df, build_features(df), report


HEATMAP_WEEKS = 26


@st.cache_data(show_spinner="Running model inference...", max_entries=64)
def predict_window(key: str, origin: pd.Timestamp, _feat: pd.DataFrame) -> pd.DataFrame:
    """Score only the origins the dashboard shows (all wards x last 26 weeks), cached per data version + week."""
    window = _feat[(_feat["date"] > origin - pd.Timedelta(weeks=HEATMAP_WEEKS)) & (_feat["date"] <= origin)]
    return get_predictor().predict(window)


@st.cache_data
def load_metrics():
    return json.load(open(METRICS_PATH)), pd.read_csv(BACKTEST_PATH, parse_dates=["origin_date", "target_date"])


def tier_badge(tier: str) -> str:
    return (f"<span style='background:{TIER_COLORS[tier]};color:white;padding:2px 10px;border-radius:12px;"
            f"font-weight:600'>{tier}</span>")


def pretty(feature: str) -> str:
    return (feature.replace("rain_", "rainfall ").replace("hum_", "humidity ").replace("temp_", "temperature ")
            .replace("_", " ").replace("lag", "lag ").replace("4w", "(4 wk)").replace("8w", "(8 wk)"))


predictor = get_predictor()
thr = predictor.thresholds

# ---------------------------------------------------------------- sidebar: inputs
st.sidebar.title("🦟 Dengue Early Warning")
upload = st.sidebar.file_uploader("Weekly ward data (CSV, optional)", type="csv",
                                  help="Same columns as the bundled dataset. Leave empty to use the bundled data.")
raw_bytes = upload.getvalue() if upload else None
data_key = hashlib.md5(raw_bytes).hexdigest() if raw_bytes else "bundled"
df, feat, report = prepare(raw_bytes, data_key)

cities = sorted(df["city"].unique())
city = st.sidebar.selectbox("City corporation", cities, index=cities.index("Dhaka South") if "Dhaka South" in cities else 0)
wards = sorted(df.loc[df["city"] == city, "ward_id"].unique())
ward = st.sidebar.selectbox("Ward", wards)
dates = sorted(df["date"].unique())
default_origin = pd.Timestamp("2025-07-07") if pd.Timestamp("2025-07-07") in dates else dates[-1]
origin = st.sidebar.select_slider("Forecast from week (latest data available)", options=dates, value=default_origin,
                                  format_func=lambda d: pd.Timestamp(d).strftime("%d %b %Y"))
origin = pd.Timestamp(origin)
preds = predict_window(data_key, origin, feat)
horizon = st.sidebar.radio("Early-warning window", HORIZONS, index=1, horizontal=True,
                           format_func=lambda h: f"{h} wk")
st.sidebar.caption(
    f"Risk tiers (expected cases / ward / week): Low < {thr['Medium']:g} ≤ Medium < {thr['High']:g} ≤ High < "
    f"{thr['Critical']:g} ≤ Critical. Thresholds = 70th/85th/95th percentile of 2016-2023 ward-weeks.")
st.sidebar.caption("All inference runs locally on serialized models. No external API or LLM calls.")

in_sample = origin + pd.Timedelta(weeks=horizon) <= pd.Timestamp(VAL_END)
ward_preds = preds[(preds["ward_id"] == ward) & (preds["origin_date"] == origin)].set_index("horizon")
feat_row = feat[(feat["ward_id"] == ward) & (feat["date"] == origin)]

tab_fc, tab_whatif, tab_map, tab_perf, tab_data = st.tabs(
    ["📍 Ward forecast", "🌧️ What-if weather", "🗺️ City risk heatmap", "📊 Model performance", "🔧 Data & lag pipeline"])

# ================================================================ TAB 1: ward forecast
with tab_fc:
    st.subheader(f"{ward} ({city}): forecast from week of {origin:%d %b %Y}")
    if in_sample:
        st.caption("ℹ️ Target weeks up to 2024 were part of model training (in-sample). "
                   "Pick a 2025 week for a true out-of-sample check, or the latest week for a live forecast.")
    cols = st.columns(len(HORIZONS))
    for col, h in zip(cols, HORIZONS):
        r = ward_preds.loc[h]
        with col:
            st.markdown(f"**+{h} week{'s' if h > 1 else ''}** · {pd.Timestamp(r.target_date):%d %b}")
            st.markdown(tier_badge(r.tier) + f"&nbsp; score **{r.risk_score:.0f}**/100", unsafe_allow_html=True)
            st.metric("Expected cases", f"{r.predicted:.1f}", help="Model expectation for that ward-week")
            st.caption(f"80% range {r.lower_80:.1f} – {r.upper_80:.1f}"
                       + (f" · actual {int(r.actual)}" if pd.notna(r.actual) else ""))

    left, right = st.columns([3, 2])
    with left:
        hist = df[(df["ward_id"] == ward) & (df["date"] > origin - pd.Timedelta(weeks=20))
                  & (df["date"] <= origin + pd.Timedelta(weeks=4))]
        fig = go.Figure()
        known = hist[hist["date"] <= origin]
        fig.add_bar(x=known["date"], y=known["dengue_cases"], name="Reported cases", marker_color="#90a4ae")
        later = hist[hist["date"] > origin]
        if later["dengue_cases"].notna().any():
            fig.add_scatter(x=later["date"], y=later["dengue_cases"], mode="markers", name="Actual (unseen by model)",
                            marker=dict(symbol="x", size=10, color="#37474f"))
        wp = ward_preds.reset_index()
        fig.add_scatter(x=wp["target_date"], y=wp["upper_80"], mode="lines", line=dict(width=0), showlegend=False,
                        hoverinfo="skip")
        fig.add_scatter(x=wp["target_date"], y=wp["lower_80"], mode="lines", line=dict(width=0), fill="tonexty",
                        fillcolor="rgba(198,40,40,0.15)", name="80% interval")
        fig.add_scatter(x=wp["target_date"], y=wp["predicted"], mode="lines+markers", name="Forecast",
                        line=dict(color="#c62828", width=3),
                        marker=dict(size=12, color=[TIER_COLORS[t] for t in wp["tier"]], line=dict(width=1, color="white")),
                        text=wp["tier"], hovertemplate="%{x|%d %b}: %{y:.1f} cases (%{text})<extra></extra>")
        for t in ("Medium", "High", "Critical"):
            fig.add_hline(y=thr[t], line_dash="dot", line_color=TIER_COLORS[t], annotation_text=t,
                          annotation_position="right", opacity=0.6)
        fig.add_vline(x=origin, line_dash="dash", line_color="#555")
        fig.update_layout(title="Weekly cases: history and 1-4 week forecast", height=380, margin=dict(t=50, b=10),
                          legend=dict(orientation="h", y=-0.15), yaxis_title="cases / week")
        st.plotly_chart(fig, width="stretch")

    with right:
        drivers = predictor.explain_groups(feat_row, horizon)
        drivers["effect_pct"] = (drivers["multiplier"] - 1) * 100
        drivers["kind"] = np.where(drivers["group"].isin(WEATHER_GROUPS), "Weather driver", "Other driver")
        drivers = drivers.sort_values("effect_pct")
        fig = px.bar(drivers, x="effect_pct", y="group", orientation="h", color="kind",
                     color_discrete_map={"Weather driver": "#1e88e5", "Other driver": "#9e9e9e"},
                     hover_data={"top_feature": True, "multiplier": ":.2f", "kind": False},
                     labels={"effect_pct": "effect on expected cases (%)", "group": ""})
        fig.add_vline(x=0, line_color="#555")
        fig.update_layout(title=f"What drives the +{horizon}-week forecast", height=380, margin=dict(t=50, b=10),
                          legend=dict(orientation="h", y=-0.2, title=None))
        st.plotly_chart(fig, width="stretch")
        st.caption("Effects are multiplicative versus the model's average ward-week (Poisson log link): "
                   "+100% doubles the expected cases, −50% halves them.")

    # Weather panel with the breeding-window lags highlighted
    st.markdown("##### Weather inputs and the 2-4 week breeding window")
    w = df[(df["ward_id"] == ward) & (df["date"] > origin - pd.Timedelta(weeks=12)) & (df["date"] <= origin)]
    fig = go.Figure()
    fig.add_vrect(x0=origin - pd.Timedelta(weeks=4, days=3), x1=origin - pd.Timedelta(weeks=2) + pd.Timedelta(days=3),
                  fillcolor="#1e88e5", opacity=0.08, line_width=0, annotation_text="breeding window (lags 2-4)",
                  annotation_position="top left")
    fig.add_bar(x=w["date"], y=w["rainfall_mm"], name="Rainfall (mm)", marker_color="#1e88e5")
    fig.add_scatter(x=w["date"], y=w["avg_temp_c"], name="Avg temp (°C)", yaxis="y2", line=dict(color="#e53935"))
    fig.add_scatter(x=w["date"], y=w["relative_humidity_pct"], name="Humidity (%)", yaxis="y2",
                    line=dict(color="#43a047", dash="dot"))
    fig.update_layout(height=300, margin=dict(t=20, b=10), yaxis=dict(title="rainfall mm"),
                      yaxis2=dict(title="°C / %", overlaying="y", side="right"), legend=dict(orientation="h", y=-0.2))
    st.plotly_chart(fig, width="stretch")

    contrib, _ = predictor.explain(feat_row, horizon)
    c = contrib.iloc[0]
    weather_feats = [f for f in c.index if FEATURE_TO_GROUP[f] in WEATHER_GROUPS]
    top = c[weather_feats].abs().sort_values(ascending=False).head(8).index
    st.markdown("##### Top weather features for this forecast")
    st.dataframe(pd.DataFrame({"feature": [pretty(f) for f in top], "value": feat_row[top].iloc[0].round(2).values,
                               "effect on cases": [f"{(np.exp(c[f]) - 1) * 100:+.0f}%" for f in top]}),
                 hide_index=True, width="stretch")

# ================================================================ TAB 2: what-if weather scenario
with tab_whatif:
    st.subheader(f"What-if: change the weather for {ward} and re-run the model")
    st.caption("Edit the last 8 weeks of weather, or apply a scenario shift. Lag features are recomputed for this "
               "ward and all four horizon models re-run instantly.")
    s1, s2, s3 = st.columns(3)
    rain_mult = s1.slider("Rainfall change (%)", -100, 200, 0, 10)
    temp_shift = s2.slider("Temperature shift (°C)", -5.0, 5.0, 0.0, 0.5)
    hum_shift = s3.slider("Humidity shift (points)", -20, 20, 0, 1)
    ward_hist = df[(df["ward_id"] == ward) & (df["date"] <= origin)].copy()
    recent_mask = ward_hist["date"] > origin - pd.Timedelta(weeks=8)
    editable = ward_hist.loc[recent_mask, ["date", "rainfall_mm", "avg_temp_c", "relative_humidity_pct"]]
    edited = st.data_editor(editable.assign(date=editable["date"].dt.strftime("%Y-%m-%d")), hide_index=True,
                            disabled=["date"], width="stretch", key=f"edit_{ward}_{origin:%Y%m%d}",
                            column_config={"rainfall_mm": st.column_config.NumberColumn("rainfall mm", min_value=0),
                                           "avg_temp_c": st.column_config.NumberColumn("avg temp °C"),
                                           "relative_humidity_pct": st.column_config.NumberColumn("humidity %",
                                                                                                  min_value=1, max_value=100)})
    scen = ward_hist.copy()
    idx = scen.index[recent_mask]
    t_delta = edited["avg_temp_c"].values - scen.loc[idx, "avg_temp_c"].values + temp_shift
    scen.loc[idx, "rainfall_mm"] = np.clip(edited["rainfall_mm"].values * (1 + rain_mult / 100), 0, None)
    scen.loc[idx, "avg_temp_c"] += t_delta
    scen.loc[idx, ["max_temp_c", "min_temp_c"]] += t_delta[:, None]  # keep the diurnal range
    scen.loc[idx, "relative_humidity_pct"] = np.clip(edited["relative_humidity_pct"].values + hum_shift, 1, 100)

    scen_feat = build_features(scen)
    # A single-ward rebuild cannot see other wards; keep the recorded city-wide case signal.
    scen_feat["city_cases_now"] = scen_feat["date"].map(feat[feat["ward_id"] == ward].set_index("date")["city_cases_now"])
    scen_row = scen_feat[scen_feat["date"] == origin]
    scen_pred = predictor.predict(scen_row).set_index("horizon")
    comp = pd.DataFrame({"horizon": [f"+{h} wk" for h in HORIZONS],
                         "baseline cases": ward_preds.loc[HORIZONS, "predicted"].values,
                         "baseline tier": ward_preds.loc[HORIZONS, "tier"].values,
                         "scenario cases": scen_pred.loc[HORIZONS, "predicted"].values,
                         "scenario tier": scen_pred.loc[HORIZONS, "tier"].values})
    comp["change"] = (comp["scenario cases"] - comp["baseline cases"]).round(2)
    a, b = st.columns([2, 3])
    a.dataframe(comp, hide_index=True, width="stretch")
    fig = go.Figure()
    fig.add_bar(x=comp["horizon"], y=comp["baseline cases"], name="Recorded weather", marker_color="#9e9e9e")
    fig.add_bar(x=comp["horizon"], y=comp["scenario cases"], name="Scenario",
                marker_color=[TIER_COLORS[t] for t in comp["scenario tier"]])
    fig.update_layout(barmode="group", height=320, margin=dict(t=20, b=10), yaxis_title="expected cases",
                      legend=dict(orientation="h", y=-0.2))
    b.plotly_chart(fig, width="stretch")

# ================================================================ TAB 3: city heatmap
with tab_map:
    st.subheader(f"Ward risk ranking: +{horizon}-week forecast from {origin:%d %b %Y}")
    scope = st.radio("Scope", ["Selected city", "All cities"], horizontal=True)
    p = preds[(preds["horizon"] == horizon)]
    if scope == "Selected city":
        p = p[p["city"] == city]
    now = p[p["origin_date"] == origin].sort_values("risk_score", ascending=False)
    k1, k2 = st.columns([2, 3])
    with k1:
        counts = now["tier"].value_counts().reindex(TIERS, fill_value=0)
        st.markdown(" ".join(f"{tier_badge(t)} **{n}**" for t, n in counts.items()), unsafe_allow_html=True)
        st.dataframe(now[["ward_id", "city", "predicted", "lower_80", "upper_80", "risk_score", "tier"]],
                     hide_index=True, width="stretch", height=420,
                     column_config={"risk_score": st.column_config.ProgressColumn("risk score", min_value=0,
                                                                                  max_value=100, format="%.0f")})
    with k2:
        mat = p.pivot_table(index="ward_id", columns="target_date", values="risk_score")
        fig = px.imshow(mat, aspect="auto", zmin=0, zmax=100, labels=dict(color="risk score", x="target week", y=""),
                        color_continuous_scale=[(0, TIER_COLORS["Low"]), (0.25, TIER_COLORS["Low"]),
                                                (0.25, TIER_COLORS["Medium"]), (0.5, TIER_COLORS["Medium"]),
                                                (0.5, TIER_COLORS["High"]), (0.75, TIER_COLORS["High"]),
                                                (0.75, TIER_COLORS["Critical"]), (1, TIER_COLORS["Critical"])])
        fig.update_layout(title=f"Risk score by ward, last {HEATMAP_WEEKS} forecast weeks (+{horizon} wk ahead)",
                          height=max(420, 14 * len(mat)), margin=dict(t=50, b=10))
        st.plotly_chart(fig, width="stretch")
    st.download_button("Download this ranking (CSV)", now.to_csv(index=False), f"risk_{origin:%Y%m%d}_h{horizon}.csv")

# ================================================================ TAB 4: model performance
with tab_perf:
    metrics, backtest = load_metrics()
    st.subheader("Chronological validation: train ≤ 2023 · validate 2024 · test 2025")
    rows = []
    for h, m in metrics["horizons"].items():
        for split, block in (("validation 2024", m["validation_2024"]), ("test 2025", {"blend_glm_lightgbm": m["test_2025"],
                                                                                      **m["test_2025_baselines"]})):
            for model, s in block.items():
                rows.append({"horizon (wk)": int(h), "split": split, "model": model, "MAE": s["MAE"],
                             "RMSE": s["RMSE"], "R2": s["R2"]})
    perf = pd.DataFrame(rows)
    c1, c2 = st.columns(2)
    for col, metric in ((c1, "MAE"), (c2, "RMSE")):
        fig = px.bar(perf[perf["split"] == "test 2025"], x="horizon (wk)", y=metric, color="model", barmode="group",
                     title=f"{metric} on unseen 2025 data (lower is better)",
                     color_discrete_map={"blend_glm_lightgbm": "#c62828", "persistence (cases now)": "#90a4ae",
                                         "seasonal naive (last year)": "#cfd8dc"})
        fig.update_layout(height=340, margin=dict(t=50, b=10), legend=dict(orientation="h", y=-0.25, title=None))
        col.plotly_chart(fig, width="stretch")
    summ = pd.DataFrame([{"horizon (wk)": int(h), "LightGBM weight": m["hyperparameters"]["lightgbm_weight"],
                          **{k: m["test_2025"][k] for k in ("MAE", "RMSE", "R2", "interval80_coverage",
                                                             "tier_accuracy", "tier_within_one", "alert_recall",
                                                             "alert_precision")}}
                         for h, m in metrics["horizons"].items()])
    st.markdown("**Final model on 2025 test year** (alert = High or Critical tier)")
    st.dataframe(summ, hide_index=True, width="stretch")
    with st.expander("All validation and test scores"):
        st.dataframe(perf, hide_index=True, width="stretch")

    bt = backtest[(backtest["split"] == "test") & (backtest["horizon"] == horizon)]
    bw = bt[bt["ward_id"] == ward].sort_values("target_date")
    fig = go.Figure()
    fig.add_scatter(x=bw["target_date"], y=bw["upper_80"], line=dict(width=0), showlegend=False, hoverinfo="skip")
    fig.add_scatter(x=bw["target_date"], y=bw["lower_80"], line=dict(width=0), fill="tonexty",
                    fillcolor="rgba(198,40,40,0.15)", name="80% interval")
    fig.add_scatter(x=bw["target_date"], y=bw["predicted"], name=f"Forecast made {horizon} wk earlier",
                    line=dict(color="#c62828"))
    fig.add_scatter(x=bw["target_date"], y=bw["actual"], name="Actual", mode="markers", marker=dict(color="#37474f"))
    fig.update_layout(title=f"{ward}: 2025 out-of-sample backtest (+{horizon} wk)", height=340,
                      margin=dict(t=50, b=10), legend=dict(orientation="h", y=-0.2))
    st.plotly_chart(fig, width="stretch")

    from dengue_ews.model import tier_of
    cm = pd.crosstab(pd.Categorical(tier_of(bt["actual"], thr), TIERS), pd.Categorical(tier_of(bt["predicted"], thr), TIERS),
                     rownames=["actual"], colnames=["predicted"], dropna=False)
    a, b = st.columns(2)
    fig = px.imshow(cm, text_auto=True, color_continuous_scale="Reds", title=f"Risk-tier confusion, 2025, +{horizon} wk")
    fig.update_layout(height=340, margin=dict(t=50, b=10))
    a.plotly_chart(fig, width="stretch")
    imp = pd.Series(metrics["horizons"][str(horizon)]["top_features"]).head(12).iloc[::-1]
    fig = px.bar(x=imp.values, y=[pretty(f) for f in imp.index], orientation="h",
                 title=f"Top features overall (+{horizon} wk, share of |contribution|)", labels={"x": "", "y": ""})
    fig.update_layout(height=340, margin=dict(t=50, b=10))
    b.plotly_chart(fig, width="stretch")

# ================================================================ TAB 5: data & lag pipeline
with tab_data:
    st.subheader("Data quality report")
    st.json(report, expanded=False)
    st.subheader(f"Multi-week lag features computed per ward ({ward})")
    st.caption("Each row is a forecast-origin week. rain_lagK = rainfall K weeks earlier in the same ward "
               "(groupby ward_id → shift K). rain_sum_lag2_4 = total rainfall 2-4 weeks earlier (breeding window).")
    show = ["date", "rainfall_mm", "rain_lag1", "rain_lag2", "rain_lag3", "rain_lag4", "rain_lag8", "rain_sum_lag2_4",
            "rain_sum_4w", "avg_temp_c", "temp_mean_4w", "relative_humidity_pct", "hum_mean_4w", "cases_now"]
    lag_view = feat[(feat["ward_id"] == ward) & (feat["date"] <= origin)][show].tail(12)
    st.dataframe(lag_view.assign(date=lag_view["date"].dt.strftime("%Y-%m-%d")).round(2), hide_index=True,
                 width="stretch")
    st.download_button(f"Download forecasts for all wards, last {HEATMAP_WEEKS} weeks (CSV)",
                       preds.to_csv(index=False), f"dengue_forecasts_{origin:%Y%m%d}.csv")
