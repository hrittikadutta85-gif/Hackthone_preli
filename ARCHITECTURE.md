# Architecture: Dengue Early-Warning System

## 1. System data flow

```mermaid
flowchart LR
    A["Weekly ward CSV<br/>bundled or uploaded<br/>weather + cases + ward attributes"] --> B["data.py · clean()<br/>schema & type checks · dedupe<br/>Monday weekly grid per ward<br/>range checks · gap filling"]
    B --> C["features.py · build_features()<br/>groupby(ward_id).shift(k)<br/>rain lags 1-8 wk · breeding-window sum (lags 2-4)<br/>4/8-wk rolling rain · temp/humidity lags & means<br/>dew point · Aedes-optimal weeks · recent cases"]
    C --> D["add_horizon(h)<br/>target = cases at t+h<br/>h = 1,2,3,4 weeks"]
    D -->|train.py, offline| E["Chronological split<br/>train ≤2023 · val 2024 · test 2025<br/>Poisson GLM + LightGBM Poisson<br/>log-scale blend · quantile models"]
    E --> F[("models/dengue_models.joblib<br/>metrics.json · backtest.csv.gz")]
    F -->|loaded once, cached| G["model.py · DenguePredictor<br/>expected cases · 80% interval<br/>risk score & tier · driver contributions"]
    C -->|online, cached per data version| G
    G --> H["Streamlit dashboard (app.py)<br/>ward forecast · what-if weather<br/>city risk heatmap · validation metrics"]
    H -->|what-if edits: one ward rebuilt| C
```

**Offline** (`python train.py`, ~10 min CPU): clean → features → per-horizon training and validation → serialize.
**Online** (`streamlit run app.py`): load the models once → clean and featurize the data once per data version →
score only the ward-weeks shown on screen → explain. No network access is needed.

## 2. Lag pipeline (why these features)

Rain creates standing water; *Aedes aegypti* eggs need 7–14 days to become adults, and then viral incubation and
symptom onset follow. Rain therefore shows up in hospitals **2–4 weeks later**. For each forecast week *t*, and
**separately within each `ward_id`** (`groupby(...).shift(k)` / rolling windows), we compute:

* `rain_lag1…rain_lag8`, `rain_sum_lag2_4` (the breeding window), `rain_sum_4w`, `rain_sum_8w`, `heavy_rain_weeks_4w`
* `temp_lag1…4`, `temp_mean_4w`, `aedes_optimal_weeks_4w` (25–32 °C), `temp_range_c`
* `hum_lag1…4`, `hum_mean_4w`, `humid_weeks_4w` (>80%), `dew_point_c`
* surveillance: cases now, lags 1–3, 4-week mean, 2-week trend, city mean, same week last year
* ward vulnerability: `log_pop_density`, `water_logging_risk_index`, `sanitation_score`, `vulnerability_index = waterlog × (1 − sanitation)`
* seasonality: week-of-year sine and cosine

Every feature uses data from week *t* or earlier. `tests/test_pipeline.py` checks this: the lags match a manual
per-ward shift, no lag crosses from one ward into the next, and overwriting all future weeks does not change a
week's features.

## 3. Chronological validation split

Rows are split on the **target week**, never shuffled:

| Split | Target weeks | Used for |
|---|---|---|
| Train | 2016–2023 | fitting candidate models |
| Validation | 2024 | hyper-parameter search (20 LightGBM trials, 4 GLM penalties), early stopping, blend weight |
| Test | 2025 | scored **once**, after refitting the chosen setup on train + validation |

Random K-fold would leak information: neighbouring weeks are highly correlated, and lag features would put future
weather into training. Splitting by year also tests a full monsoon season that the model has never seen. Tier
thresholds come from 2016–2023 data only.

## 4. Model selection rationale

| Option | Verdict |
|---|---|
| Persistence (cases now) and seasonal naive (same week last year) | Baselines to beat |
| **Poisson GLM** (scaled features, L2 penalty) | Suits count data (log link, non-negative); stable and interpretable; strong at short horizons |
| **LightGBM, Poisson objective** | Captures non-linear weather thresholds and interactions (rain × water-logging, temperature optimum); best at 3–4 weeks |
| **Blend (chosen)** | `log ŷ = w·LightGBM + (1−w)·GLM`, with `w` tuned per horizon on 2024 (selected: 0.7 / 0.4 / 0.9 / 1.0 for 1/2/3/4 weeks). Both members are additive on the log scale, so the blend keeps **exact driver contributions**: exp(base + Σ contributions) = prediction. |
| LightGBM quantile (α = 0.1 / 0.9) | 80% prediction interval |
| Deep sequence models (LSTM etc.) | Rejected: 60 short weekly series, slower CPU inference, harder to explain to health officers |

**Results on the unseen 2025 test year** (model trained on 2016–2024):

| Horizon | MAE | RMSE | R² | RMSE persistence | RMSE seasonal naive | 80% coverage | Tier accuracy | Alert recall / precision |
|---|---|---|---|---|---|---|---|---|
| 1 wk | 1.00 | 2.04 | 0.73 | 2.90 | 3.01 | 81% | 84% | 73% / 73% |
| 2 wk | 1.05 | 2.18 | 0.69 | 3.43 | 3.01 | 75% | 84% | 69% / 73% |
| 3 wk | 1.07 | 2.12 | 0.71 | 3.81 | 3.01 | 75% | 82% | 73% / 67% |
| 4 wk | 1.30 | 2.28 | 0.67 | 4.00 | 3.01 | 83% | 82% | 76% / 60% |

The model cuts RMSE by 30–44% against persistence. About 99% of tier calls are within one tier of the actual.
The strongest drivers are weather: 4-week rainfall, dew point, humidity lags, temperature and seasonality.

**Risk tiers:** expected cases per ward per week, cut at the 70th/85th/95th percentiles of 2016–2023 ward-weeks:
Low < 2, Medium 2–7, High 7–13, Critical ≥ 13. The 0–100 risk score is piecewise linear, so each tier spans 25
points.

## 5. Compute and API cost controls

* **Zero external API and LLM calls for forecasting and planning.** All inference is local; there are no per-request
  costs and no LLM tokens are spent. The final round did not add an LLM: the Phase 2 dispatch notices are
  deterministic templates (section 6.5), so they work with no internet and always give the same text for the same
  plan. The only outbound calls the backend can make are messages to an SMS, WhatsApp or email provider, and only
  when one is configured in `.env` (sign-in codes, security alerts and, on request, ward dispatch notices).
* **Serialized models** (`joblib`, compressed, 8 MB) are loaded once per server process with
  `st.cache_resource`. No training happens at app start.
* **Caching:** cleaning and the lag features are computed once per data version (`st.cache_data`, keyed by an MD5
  hash of the uploaded file). Predictions are computed only for the 26-week window on screen and cached per week
  (all 60 wards × 4 horizons in about 1 s).
* **Incremental what-if:** a weather edit rebuilds features for **one ward only** and re-scores 4 rows, in
  milliseconds.
* **Vectorized pandas and NumPy throughout**; no per-row Python loops in the pipeline.
* **Measured:** cold start ≈ 17 s (mostly the one-time model load); changing ward/horizon ≈ 1 s; changing the week
  ≈ 2 s. Laptop CPU; no GPU needed.
* **Ingestion:** new weeks arrive as a CSV upload or by appending to `data/dengue_weekly.csv`. A live weather feed
  would be pulled once per day in a batch job and cached locally, never on each page view.

## 6. Phase 2: operations command

Phase 2 extends the forecaster into a resource-optimization, intervention-simulation and dispatch system. All of it
sits on top of the stored forecasts (section 1), so the operations pages, the dispatch notices and the rest of the app
always describe the same forecast.

```mermaid
flowchart LR
    F["Stored forecasts<br/>expected cases · 80% range<br/>risk score & tier (per ward, week, horizon)"] --> N["Supply rule<br/>⌊rate × cases + offset⌋<br/>saline · kits · beds"]
    F --> P["Priority<br/>70% risk score<br/>+ 30% density percentile"]
    N --> A["Water-filling allocation<br/>stock = slider % of need<br/>whole units · deterministic"]
    P --> A
    N --> R["Bed routing per city<br/>capacity = median annual peak × slider %<br/>overflow → least-loaded ward, same city"]
    P --> R
    F --> C["Crews needed<br/>⌈cases × √(density/median) ÷ 6⌉"] --> A
    M[("ML models")] --> S["Vector-control simulator<br/>re-score weeks 2-4 with breeding inputs<br/>reduced by crew coverage"]
    A --> D["Dispatch templates<br/>SMS · WhatsApp · HTML/PDF brief<br/>English + Bangla"]
    R --> D
    A & R & S & D --> UI["/ops in the web app<br/>/api/ops/* · exports/"]
```

### 6.1 Supplies from forecasts

The onsite dataset adds `saline_bags_needed`, `diagnostic_kits_needed` and `hospital_beds_required`. Each one is an
exact step function of the week's case count. We searched for `floor(rate × cases + offset)` and found constants that
reproduce **all 31,320 rows**:

| Supply | Rule |
|---|---|
| Saline bags | ⌊2.385 × cases + 0.49⌋ |
| Diagnostic kits | ⌊1.165 × cases + 0.445⌋ |
| Hospital beds | ⌊0.30 × cases + 0.45⌋ |

`tests/test_operations.py` checks the match row by row. The same rule is applied to the forecast, using either the
expected cases or the top of the 80% range ("likely-high case", the default, which is safer for ordering stock and
for beds). If an uploaded file lacks the supply columns, `data.clean()` fills them in from the rule.

### 6.2 Constrained allocation (requirement 1)

* **Stock:** the regional store holds *s*% (30–100%, one slider or one per supply) of the forecast need in the
  selected area.
* **Priority** (0–100) = 0.7 × model risk score + 0.3 × the ward's `population_density_sqkm` percentile. Dense
  wards spread dengue faster, and risk alone would ignore that.
* **Water-filling:** ward *i* gets `need_i × min(1, λ × (20 + priority_i))`, with λ found by bisection so the total
  equals the stock. The riskiest, densest wards are filled to 100% first; the rest share what is left in proportion
  to priority, and no ward drops to zero while stock remains. Whole units are handed out by largest remainder
  (ties: higher priority, then ward order), so the result is deterministic and sums exactly to the stock.
* **Crews:** need = ⌈expected cases × √(density ÷ median density) ÷ 6⌉ for Medium risk and above (1–6 per ward). The
  *Total spraying crews* slider is shared out by the same water-filling.
* **Deficit warnings:** any shortfall marks a ward *Short*. It becomes a **critical shortage** if the ward is High
  or Critical risk, or gets under half of any item. The alert strip and tables update on every slider move (the plan
  takes about 0.1 s).

### 6.3 Hospital surge and overflow routing (requirement 2)

* **Capacity:** the data has no bed counts, so each ward's dengue beds = the beds it needed in the busiest week of
  a typical year (the median of its 2016–2023 annual peaks; at least 2). A normal season fits; a sharp one overflows.
  The stock slider opens that share of beds.
* **Routing** (`operations.route_overflow`): each ward first fills its own beds. Overflow from the highest-priority
  ward is placed first, **one patient at a time**, in the ward of the **same city** with the lowest current occupancy
  (ties: lower priority, then ward id). Placing one at a time spreads the load instead of swamping one neighbour.
  Patients who fit nowhere in the city are the net deficit. Patients never cross city pools.
* **Outputs:** per ward: beds open, needed, net balance, sent, received, without a bed, occupancy. Per city: load
  before and after routing, transfers, without a bed, spare beds (headroom). A ward's *allocated beds* in the supply
  table = beds secured anywhere in its city, so modules 1 and 2 always agree.
* **Tested:** patients are conserved (local + sent + unplaced = demand), no ward goes over capacity, every transfer
  stays inside one city, and a sending ward picks the emptiest receiver.

### 6.4 Vector-control simulator (requirement 3)

* **Coverage:** *k* larvicide/fogging crews remove a share of a ward's breeding habitat:
  `0.6 × (1 − exp(−k ÷ (2 × √(density ÷ median))))`. Returns diminish, and dense wards need more crews.
* **Model-driven counterfactual:** the trained models for horizons 2, 3 and 4 are re-run with the ward's
  standing-water inputs (this week's and the last four weeks' rain, rain sums, heavy-rain weeks,
  `water_logging_risk_index`, `vulnerability_index`) scaled by (1 − coverage). Temperature, humidity, recent cases and
  season stay as recorded. Only weeks 2–4 count, because larvae need 1–2 weeks to become biting adults.
* We tested the obvious alternative of lowering the recent-case features (as a stand-in for fogging killing
  infected adults). The model's response there was weak and changed sign between wards, so we did not use it. The
  breeding-habitat inputs gave consistent reductions in every week we checked.
* For speed, the forecasts for 0–8 crews in every ward are computed once per forecast week (≈0.2 s) and cached. A
  running minimum makes sure an extra crew never raises the forecast.
* **ROI:** cases prevented over weeks 2–4 ÷ crews. Beds and saline saved come from the supply rule applied to the
  baseline and scenario cases. **Automatic placement** gives each crew to the ward with the largest marginal gain,
  which is optimal with diminishing returns. Tests check that it beats putting every crew in any single ward, that
  more crews never prevent fewer cases, and that zero crews reproduces the stored forecast.

### 6.5 Dispatch notices (requirement 4)

`backend/dispatch.py` fills fixed templates from the plan:

* **SMS:** English in GSM-7 within 160 characters (shorter forms replace longer ones until it fits); Bangla in UCS-2
  with the part count shown.
* **WhatsApp:** *bold* markup with risk, expected cases and range, allocated / required supplies, bed transfers,
  crews, a deficit alert and two actions.
* **Commissioner brief:** a self-contained, A4-printable HTML page (KPIs, city bed pools, transfers, deficit cards,
  the full ward table) that can be printed to PDF. `/api/ops/brief` serves it; `python -m backend.export_samples` also
  prints a PDF with headless Edge or Chrome if one is installed.

Samples for one scenario are in [`exports/`](exports/).

**Getting a notice to the field team.** Each notice lists its recipients: the active Field Officer accounts assigned to
that ward that have a mobile number (`AuthService.ward_contacts`). Only roles with `ops.dispatch` see them.

```mermaid
flowchart LR
    P["Plan settings<br/>(same query as /api/ops/plan)"] --> N["dispatch.notices()<br/>SMS + WhatsApp text"]
    U[("users<br/>role = field · active · phone<br/>assigned_wards")] --> R["Recipients per ward"]
    N & R --> UI["Dispatch tab"]
    UI -->|"always available"| L["Phone links<br/>wa.me/&lt;number&gt;?text=… · sms:&lt;number&gt;?body=…<br/>sent from the officer's own phone"]
    UI -->|"POST /api/ops/dispatch/send<br/>after a confirmation"| S["Server rebuilds the text from the plan<br/>duplicate guard · 300-message cap"]
    S --> Q["Notifier (section 8)<br/>event = dispatch · ref = dispatch:&lt;week&gt;:&lt;ward&gt;"]
    Q --> SMS["SMS provider"] & WA["WhatsApp provider<br/>needs an approved dispatch template"]
    Q --> D[("notifications<br/>status per message")] --> UI
    S --> AU[("audit_log<br/>dispatch_sent")]
```

* **From the officer's own phone (no provider needed).** Per-recipient buttons open WhatsApp (or WhatsApp Web) or
  the phone's messaging app with the number and the text filled in. The app does not see or track these messages.
* **Automatic sending (when a provider is configured).** The browser sends only the plan settings, the channel and the
  ward ids; the server rebuilds every notice itself, so the text cannot be altered in transit. A request sends at most
  300 messages, and the same week's notice is not sent to a ward twice on the same channel within an hour unless
  `resend` is set (`already_sent` otherwise). Each message is a row in `notifications` with `event = 'dispatch'` and a
  `ref` of `dispatch:<week>:<ward>`, so the Dispatch tab shows the latest batch per ward with its delivery counts, and
  provider callbacks move them to *Delivered* or *Failed* as for any other message. The batch is written to the audit
  log (`dispatch_sent`).
* **Channel readiness** comes from `Notifier.ready_for(channel, "dispatch")`: SMS needs only a configured provider;
  WhatsApp also needs an approved Utility template (`WHATSAPP_TEMPLATE_DISPATCH` for Meta,
  `TWILIO_WHATSAPP_CONTENT_SID_DISPATCH` for Twilio) because WhatsApp does not allow business-initiated free text.
  The template carries two variables: the ward and the notice flattened to one line. When a channel is not ready the
  endpoint answers `409 provider_not_configured` or `template_not_configured`, and the page says what is missing.

### 6.6 Offline resilience (requirement 5)

* There is **no LLM or external API in any code path**. Forecasting, allocation, routing, simulation and dispatch
  are local Python, and the notices are templates, so there is nothing that needs a fallback.
* `backend/offline.py` has a kill-switch that makes every outbound connection and DNS lookup fail.
  `/api/ops/selftest` (the **Offline check** tab) runs all five modules under it and reports timings.
  `tests/test_operations.py` also starts the whole backend under it.
* The browser talks only to the local Next.js server. The production build bundles its fonts. The only internet
  resource is the OpenStreetMap background, and when it fails the map offers its offline view. A banner appears
  whenever the browser goes offline.
* Delivering a notice needs a phone network or the internet by nature: the phone links hand the text to the officer's
  own phone, and automatic sending needs a provider. Writing the notices, the brief and every plan stays offline.

### 6.7 Phase 2 API

| Endpoint | Purpose |
|---|---|
| `GET /api/ops/plan` | Allocation, crews, bed routing and deficits. Parameters: `origin, horizon, stock, crews, basis, city`, optional `saline_pct, kits_pct, beds_pct` |
| `POST /api/ops/simulate` | Vector-control counterfactual: `{origin, city, crews}` for automatic placement or `{deployments: {ward: crews}}` |
| `GET /api/ops/dispatch` | SMS and WhatsApp notices (`lang=en|bn`) for the same plan parameters, each with its `recipients` and `last_sent`, plus `sending` (whether SMS and WhatsApp can send automatically) |
| `POST /api/ops/dispatch/send` | Send notices to the assigned field officers: plan parameters plus `{lang, channel: sms|whatsapp, wards[], resend}`; returns counts per ward |
| `GET /api/ops/brief` | Printable HTML commissioner brief |
| `GET /api/ops/selftest` | Offline self-test with outbound network blocked |

### 6.8 Assumptions to state at judging

* Bed capacity is inferred from history (section 6.3). With real bed counts, only `operations.bed_capacity` changes.
* Crew coverage (60% maximum, scale 2 crews at median density) is a planning assumption, not a measured efficacy.
  The model then decides how much that coverage changes cases.
* There are no ward coordinates, so routing prefers the least-loaded ward rather than the nearest. A distance
  matrix would slot into the receiver choice in `route_overflow`.

## 7. Smart early warning and notifications

```mermaid
flowchart LR
    F["Stored forecasts<br/>(every ward × week × horizon)"] --> D["detect()<br/>4 rules · start-of-event only<br/>cooldown unless level rises"]
    W["Recorded weather<br/>4-week rain vs ward/month norm"] --> D
    D --> S[("SQLite<br/>alerts · alert_status · push_subscriptions")]
    T["Background scanner<br/>startup + every 15 min<br/>reload if data file changed"] --> D
    S -->|new, after the first scan| P["Web Push (VAPID)<br/>pywebpush → browser push service"]
    S --> API["/api/alerts · /api/alerts/summary<br/>status · acknowledge · scan · config"]
    API --> UI["Bell (top bar) · Alerts & Warnings page<br/>anonymous browser id in localStorage"]
    P --> SW["Service worker (sw.js)<br/>notification → /alerts?week=…&id=…"]
```

* **Rules** (thresholds in `config.ALERTS`, each overridable by environment variable): risk-level increase against
  last week's forecast for the same horizon; sudden increase against the last-4-week average of reported cases (a % and
  an absolute floor, so 1 → 2 cases is not a "100% surge"); heavy rain against the ward's own 90th percentile for that
  month, an absolute 450 mm or a 100 mm floor, and only together with forecast risk of Medium or above; High or
  Critical expected within 4 weeks while reported cases are below it.
* **Active period:** an alert is active from the week it is raised until its expected week passes, unless that
  browser resolved it. History keeps everything.
* **Duplicate prevention:** fire only when the condition starts (or its level rises), a per-ward and per-type
  cooldown, and a unique `dedup_key` with `INSERT OR IGNORE`. Detection is deterministic, so rescans are no-ops.
  Dashboard refreshes only read.
* **Push without flooding:** the first scan backfills history with `backfill = 1` and pushes nothing. Later scans
  push only rows they inserted. The `replay` command removes recent alerts so a scan raises them again, which tests the
  real "new week of data" path.
* **Anonymous acknowledgement:** a random id in localStorage is the only identity. Status, acknowledged and resolved
  times are stored per (alert, browser). There is no login and no personal data.
* **Offline:** detection, storage and in-app alerts are local. Only push delivery needs the internet, and it fails
  quietly.
* **The prediction portal** reuses the same rules (`alerts.evaluate`) on a typed-in forecast, and the supply rule and
  bed capacity (`Planner.resource_outlook`) to show the saline, kits, beds and crews it implies.

## 8. Accounts, roles and security notifications

```mermaid
flowchart LR
    B["Browser"] -->|"same origin /api/*"| N["Next.js<br/>proxy.ts: no cookie -> /login"]
    N --> M["FastAPI middleware<br/>Origin / Sec-Fetch-Site check<br/>no-store on account routes"]
    M --> D["Dependencies<br/>session cookie -> Principal<br/>CSRF on POST/PUT/PATCH/DELETE<br/>require(permission)"]
    D --> R["Existing routes<br/>(forecasts, ops, alerts, push)"]
    D --> A["/api/auth, /api/account, /api/admin"]
    A --> S[("data/auth.sqlite3<br/>users · sessions · codes · logins<br/>deliveries · audit · migrations")]
    A --> Q["Notifier<br/>worker pool for alerts, synchronous for codes"]
    Q --> P1["SMS: Twilio / SSL Wireless"]
    Q --> P2["WhatsApp: Meta Cloud API / Twilio<br/>approved templates, consent"]
    Q --> P3["Email: SMTP"]
    P1 & P2 -->|"signed status callbacks"| A
```

* **Sessions, not JWTs:** an opaque random token whose SHA-256 is stored, so logout and "sign out everywhere" take
  effect immediately. The CSRF token is an HMAC of the session, so every tab agrees on it.
* **Authorisation is server-side:** every API route depends on `require(permission)`; field officers are additionally
  limited to their assigned wards (`ward_allowed`, `check_alert_wards`). Roles always come from the database.
* **Codes:** `secrets.randbelow`, HMAC-SHA256 keyed with `AUTH_SECRET_KEY`, purpose- and target-bound, expiry, attempts,
  cooldown and hourly limits enforced inside one SQLite `BEGIN IMMEDIATE` transaction; a failed attempt is committed
  before the error is raised.
* **Delivery status** never moves backwards and *Delivered* comes only from a verified provider callback.
* Alert acknowledgements and push subscriptions now belong to the signed-in user instead of an anonymous browser id.
* **Migrations** run at start-up in order (`PRAGMA user_version`): 1 creates the schema, 2 makes email optional for
  mobile-number sign-up, 3 adds `notifications.ref` so Operations messages record what they were about. Each one is
  additive or a checked table rebuild, so an existing database upgrades in place.

## 9. Area Intelligence

```mermaid
flowchart LR
    Q["Search box"] --> SR["search.py<br/>gazetteer + dataset wards + admin localities<br/>prefix · romanisation skeleton · Bangla"]
    SR -.->|"only on request"| G["geocode.py<br/>OpenStreetMap Nominatim<br/>1 req/s, cached"]
    SR --> C["intel.coverage()<br/>ward · city · city_context<br/>district_partial · none"]
    C --> F["Existing forecasts<br/>Store.preds / forecast()"]
    C --> E["Dataset indicators<br/>sanitation · waterlogging · weather"]
    SR --> H[("data/area.sqlite3<br/>hospitals · bed_updates · localities<br/>data_sources · geocode cache")]
    H --> Y["hospitals.summary()<br/>capacity vs verified availability"]
```

The hospital directory is a separate database, so hospital information changes without touching the dengue data or
retraining the models. Coverage is decided once, in `coverage()`, and the dengue and environment sections only ever
read the wards it returns.

**Beds left.** Two numbers are kept apart on purpose. *Reported* free beds come only from verified hospital updates in
the directory; with none, the page says live availability is unavailable. The *estimate* (`intel.bed_outlook`) uses
the planner's dengue bed capacity per ward (median annual peak of beds required, 2016–2023) minus the beds this week's
cases need, and for each of the next 4 weeks the beds the expected and the upper-80% forecasts would need (the
dataset's own supply rule). It lists the wards that run short first and, for a single ward, the spare beds the rest of
its city should have. `GET /api/locations/{id}/beds?as_of=` returns both; the dashboard's bed card reuses the same
estimate.

## 10. Web interface

* **One design system** in `frontend/app/globals.css`: colour tokens on `:root` (background `#F5F8F7`, cards white,
  primary teal `#287F75`, secondary green `#75B8A5`, headings `#193B38`, body `#647571`, light teal `#E8F5F1`, soft
  green / amber / orange / red for the four risk levels) mapped into Tailwind with `@theme`, so every page, chart and
  map reads the same values. Inter for text, Poppins for headings. Risk colours are soft fills; as text they switch to
  darker shades for contrast.
* **Shell** (`components/Shell.tsx`): a fixed sidebar with the brand and the menu on wide screens, a drawer on phones
  and tablets, and a top bar with the page name, the current date and time, alerts, language and the user menu. The
  menu is filtered by the role's permissions; the API enforces the same rules.
* **Dashboard** (`app/page.tsx`): hero, four indicator cards (cases this week with the change from last week, current
  risk level, predicted cases, estimated bed availability), the street risk map, recent alerts, an actual-versus-
  predicted forecast chart (1, 2 or 4 weeks ahead, labelled 7, 14 and 28 days), and the earlier overview sections.
  Every number comes from existing endpoints (`/api/city`, `/api/map`, `/api/alerts/summary`, the beds estimate); the
  forecast series are sums of the stored ward forecasts, plotted at the week each forecast was for.
* **Sign-in screens** share one split layout (`components/auth/AuthLayout.tsx`): a brand panel with figures taken
  from the project's own data and model metrics, and the form card.

## 11. Deployment

```mermaid
flowchart LR
    U["Browser"] -->|"https"| V["Vercel<br/>Next.js (frontend/)<br/>rewrites /api/* → API_URL"]
    V -->|"server-side proxy"| R["Render web service<br/>uvicorn backend.main:app<br/>models + data from the repo"]
    R --> DB[("SQLite files on the instance<br/>auth · alerts · area")]
    R -.->|"only if configured"| M["SMS / WhatsApp / email providers"]
```

* **One origin for the browser.** The browser only talks to the Vercel site; Next.js forwards `/api/*` to the Render
  service (`API_URL`), so the session cookie is first-party and no CORS is needed. The backend accepts state-changing
  requests from the Vercel addresses (`AUTH_ALLOWED_ORIGINS`), reads the client address behind two proxies
  (`AUTH_TRUSTED_PROXIES=2`) and signs sessions with a fixed `AUTH_SECRET_KEY`.
* **Builds:** Vercel builds `frontend/` with Node 22; Render runs `pip install -r requirements.txt` and starts
  `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`. The trained model and the dataset are in the repository, so
  nothing is trained at deploy time; the backend needs about 230 MB of memory with everything loaded. A push to `main`
  redeploys both.
* **State:** accounts, alert statuses and the hospital directory are SQLite files. On a free Render instance the disk
  is not persistent, so they reset when the service restarts or redeploys; a persistent disk (with `AUTH_DB`,
  `AREA_DB` and the alerts database pointed at it) keeps them. Free instances also sleep after 15 idle minutes, so the
  first request afterwards waits for the model to load.

## 12. AI disclosure

We used **Claude Code** (Anthropic), an AI coding assistant, in both phases. It helped with data analysis, deriving
the supply rule from the onsite dataset, the pipeline and model code, the FastAPI backend, the Next.js app, the
Phase 2 allocation, routing, simulator, dispatch and offline modules, the early-warning and push notification system, the prediction-portal upgrade, the accounts and sign-in system, Area Intelligence and the beds-left estimate, the
interface redesign, sending dispatch notices, the Vercel and Render deployment, the tests, and these documents. The team
reviewed, ran and tested everything. The running system makes **no** AI or LLM calls.
