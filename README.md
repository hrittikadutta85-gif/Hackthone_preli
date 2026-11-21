# 🦟 Dengue Early-Warning System

**Team CodeNova** · EDU AI Engineering Hackathon 2026 · Preliminary Round: *AI for Urban Dengue Outbreak*

Forecasts dengue outbreak risk for each city ward **2–4 weeks ahead** from weekly rainfall, temperature and
humidity. Public health officers can then send larvicide and spraying teams to the right wards *before* hospital
admissions peak.

![Python](https://img.shields.io/badge/Python-3.11%2B-blue) ![Streamlit](https://img.shields.io/badge/UI-Streamlit-red) ![LightGBM](https://img.shields.io/badge/Model-LightGBM%20%2B%20Poisson%20GLM-green) ![APIs](https://img.shields.io/badge/External%20APIs-none-lightgrey)

---

## Contents

1. [The problem](#the-problem)
2. [What the system does](#what-the-system-does)
3. [System architecture](#system-architecture)
4. [Quick start](#quick-start)
5. [Using the dashboard](#using-the-dashboard)
6. [Model and validation](#model-and-validation)
7. [Cost and resource efficiency](#cost-and-resource-efficiency)
8. [Project structure](#project-structure)
9. [Team](#team)
10. [AI assistance and external services](#ai-assistance-and-external-services)

---

## The problem

Dengue does not follow the same day's weather. Rain leaves standing water, *Aedes aegypti* eggs take 7–14 days to
become adult mosquitoes, and then viral incubation and symptom onset follow. The result is a **2–4 week lag**
between rain and hospital spikes. The same rain also hits wards differently: poor drainage, crowding and weak waste
collection turn some wards into hotspots much faster than their neighbours.

## What the system does

| Requirement | How we meet it |
|---|---|
| **Weather data processing** | Ingests `avg_temp_c`, `rainfall_mm` and `relative_humidity_pct`, then computes **1–8 week rainfall lags**, the **2–4 week breeding-window rainfall** and rolling totals, separately for each `ward_id` |
| **Risk prediction engine** | Trained models forecast expected cases for **+1 to +4 weeks** with an 80% range, a 0–100 risk score and a **Low / Medium / High / Critical** tier for any ward and week |
| **Cost efficiency** | Local inference on serialized models, cached results, no external API or LLM calls |
| **User interface** | Web dashboard showing forecasts, risk tiers, **main weather drivers**, what-if scenarios, a ward risk heatmap and validation errors |

---

## System architecture

```mermaid
flowchart TB
    subgraph DATA["Data layer"]
        CSV["Weekly ward data (CSV)<br/>weather · cases · ward attributes"]
    end

    subgraph BACKEND["Backend: Python package (dengue_ews)"]
        ING["1 · Ingestion & cleaning<br/>schema + type checks · dedupe<br/>weekly grid per ward · range checks · gap filling"]
        FEAT["2 · Multi-week lag pipeline<br/>groupby(ward_id).shift(k)<br/>rain lags 1-8 wk · breeding window (lags 2-4)<br/>temp / humidity lags · dew point · recent cases"]
        TRAIN["3 · Training (offline)<br/>chronological split<br/>Poisson GLM + LightGBM blend<br/>quantile models for intervals"]
        STORE[("Serialized models<br/>joblib · metrics · backtests")]
        INF["4 · Inference engine<br/>expected cases · 80% interval<br/>risk score & tier · driver contributions"]
    end

    subgraph FRONTEND["Frontend: Streamlit dashboard"]
        UI["Ward forecast · What-if weather<br/>City risk heatmap · Model performance<br/>Data & lag pipeline"]
    end

    CSV --> ING --> FEAT
    FEAT --> TRAIN --> STORE
    STORE -->|loaded once, cached| INF
    FEAT -->|cached per data version| INF
    INF --> UI
    UI -->|user selects ward, week, horizon<br/>or edits weather| INF
```

### Components

| Layer | Component | Responsibility |
|---|---|---|
| Backend | `dengue_ews/data.py` | Validates and cleans raw weekly data, then aligns every ward to a complete Monday-weekly grid |
| Backend | `dengue_ews/features.py` | Ward-level multi-week weather lag pipeline; uses only data available on the forecast date |
| Backend | `train.py` | Trains one model per horizon, validates chronologically and serializes the models |
| Backend | `dengue_ews/model.py` | Loads the models once; returns predictions, intervals, risk tiers and driver breakdowns |
| Frontend | `app.py` | Interactive Streamlit dashboard: inputs, forecasts, drivers, heatmap, validation |

### Request flow

1. The user picks a **ward**, a **forecast week** and an **early-warning window** (1–4 weeks).
2. The backend gets that ward's lag features (computed once and cached).
3. The models for the four horizons return expected cases, an 80% range and a tier.
4. Contributions from each feature are grouped into **drivers** (rainfall lags, temperature, humidity, recent cases,
   ward vulnerability, seasonality) and shown on the dashboard.
5. In **what-if** mode, edited weather rebuilds the features for that single ward and re-scores it instantly.

Full design notes are in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Quick start

Requires **Python 3.11 or newer** and git. Setup takes about 2–3 minutes.

```bash
git clone https://github.com/MLproject551/Hackathon_preli.git
cd Hackathon_preli
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Open **http://localhost:8501**. The trained models are included in the repository, so no training step is needed.

| Optional command | Purpose |
|---|---|
| `python -m pytest -q` | Verifies the lag pipeline, guards against future-data leakage and checks inference |
| `python train.py` | Retrains and re-validates all models from the raw data (~10 min on a laptop CPU) |

---

## Using the dashboard

| Tab | What it shows |
|---|---|
| **Ward forecast** | Risk tier, expected cases and 80% range for +1…+4 weeks; history and forecast chart; **driver breakdown**; weather chart with the breeding window highlighted |
| **What-if weather** | Edit recent rainfall, temperature or humidity, or apply a scenario (e.g. +50% rain), and see how the risk changes |
| **City risk heatmap** | All wards ranked by risk for the chosen week, plus a ward × week heatmap; CSV export |
| **Model performance** | MAE, RMSE and R² by horizon against baselines on unseen data; interval coverage; tier confusion matrix |
| **Data & lag pipeline** | Data-quality report and the per-ward lag feature table, to check the lag computation |

**Using new data:** upload a CSV with the same columns in the sidebar. It is cleaned, featurized and scored
automatically.

Required columns: `date, city, ward_id, population_density_sqkm, water_logging_risk_index, sanitation_score,
avg_temp_c, max_temp_c, min_temp_c, rainfall_mm, relative_humidity_pct, dengue_cases`

---

## Model and validation

**Model:** one model per forecast horizon. Each blends a **Poisson GLM** (stable and interpretable) with
**LightGBM** using a Poisson objective (captures non-linear weather effects). The blend is made on the log scale,
with the weight tuned for each horizon. **LightGBM quantile models** provide the 80% prediction interval.

**Chronological validation:** the data is never shuffled.

| Split | Target weeks | Purpose |
|---|---|---|
| Train | 2016 – 2023 | Fit models |
| Validation | 2024 | Tune hyper-parameters and the blend weight |
| Test | 2025 | Final, one-time evaluation on unseen data |

**Results on the unseen 2025 test year:**

| Early-warning window | MAE | RMSE | R² | Baseline RMSE* | Tier accuracy | High/Critical alert recall |
|---|---|---|---|---|---|---|
| 1 week | 1.00 | 2.04 | 0.73 | 2.90 | 84% | 73% |
| 2 weeks | 1.05 | 2.18 | 0.69 | 3.43 | 84% | 69% |
| 3 weeks | 1.07 | 2.12 | 0.71 | 3.81 | 82% | 73% |
| 4 weeks | 1.30 | 2.28 | 0.67 | 4.00 | 82% | 76% |

\*Baseline = "cases stay the same as this week". The model reduces error by 30–44%.

**Risk tiers** (expected cases per ward per week, from historical percentiles):

| Tier | Expected cases | Suggested action |
|---|---|---|
| 🟢 Low | < 2 | Routine surveillance |
| 🟡 Medium | 2 – 7 | Inspect breeding sites, community awareness |
| 🟠 High | 7 – 13 | Larviciding and spraying, alert local clinics |
| 🔴 Critical | ≥ 13 | Emergency vector control, prepare hospital beds and test kits |

---

## Cost and resource efficiency

- **No external APIs or LLM calls.** There are no per-request costs and no API keys.
- **Serialized models** (joblib, ~8 MB) are loaded once per server.
- **Caching:** cleaning and lag features run once per dataset; predictions run only for the weeks on screen.
- **What-if scenarios** recompute a single ward rather than the whole city.
- **CPU only:** changing an input in the dashboard takes about 1–2 seconds.

---

## Project structure

```
Hackathon_preli/
├── app.py                  # Frontend: Streamlit dashboard
├── train.py                # Backend: training, validation, model export
├── dengue_ews/             # Backend: core package
│   ├── config.py           #   settings, schema, split dates, risk tiers
│   ├── data.py             #   ingestion and cleaning
│   ├── features.py         #   ward-level multi-week lag pipeline
│   └── model.py            #   inference, risk tiers, driver contributions
├── models/                 # Serialized models, metrics, backtests
├── data/                   # Weekly ward dataset (2016–2025, 60 wards)
├── tests/                  # Pipeline and inference tests
├── experiments/            # Exploratory analysis scripts
├── requirements.txt
├── ARCHITECTURE.md
└── README.md
```

---

## Team

**CodeNova**

| Member | Role |
|---|---|
| *(name)* | *(role)* |
| *(name)* | *(role)* |
| *(name)* | *(role)* |

---

## AI assistance and external services

As required by the hackathon rules:

| Tool | Usage |
|---|---|
| Claude Code (Anthropic) | AI coding assistant used for data analysis, pipeline and model code, the dashboard, tests and documentation drafts. The team reviewed and tested all output. |
| *(add any other AI tools used)* | |

**External APIs used at runtime:** none.
**Open-source libraries:** pandas, NumPy, scikit-learn, LightGBM, joblib, Streamlit, Plotly, pytest.
