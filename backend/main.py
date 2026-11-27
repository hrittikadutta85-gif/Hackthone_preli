"""FastAPI backend for the dengue early-warning dashboard.

    uvicorn backend.main:app --port 8000

Models and data are loaded once at startup, so requests are cheap lookups (or a single-ward re-score for what-if).
No external API or LLM calls: forecasting, allocation, routing, simulation and dispatch all run in this process.
"""
import threading
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field

from dengue_ews.config import ALERTS, DATA_PATH

from . import alerts as al
from . import dispatch, push
from .offline import self_test
from .planner import Planner
from .service import Store

state: dict = {}
scan_lock = threading.Lock()


def run_scan() -> dict:
    """One alert scan; reloads the forecasts first if the data file changed (new weeks appended)."""
    with scan_lock:
        mtime = DATA_PATH.stat().st_mtime
        if state.get("data_mtime") not in (None, mtime):
            fresh = Store()
            state["store"], state["planner"] = fresh, Planner(fresh)
        state["data_mtime"] = mtime
        result = al.scan(state["store"], state["db"], notify=lambda new: push.send_in_background(state["db"], new))
        state["last_scan"] = result
        return result


def scanner(stop: threading.Event):
    """Background job: scan at startup, then every ALERT_SCAN_MINUTES. Rescans are idempotent."""
    while not stop.is_set():
        try:
            run_scan()
        except Exception as e:  # never take the API down; report on /api/alerts/config
            state["last_scan"] = {"error": f"{type(e).__name__}: {e}"}
        stop.wait(ALERTS["ALERT_SCAN_MINUTES"] * 60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["store"] = Store()
    state["planner"] = Planner(state["store"])
    state["db"] = al.AlertDB()
    stop = threading.Event()
    threading.Thread(target=scanner, args=(stop,), name="alert-scanner", daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Dengue Early-Warning API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)

Horizon = Annotated[int, Query(ge=1, le=4, description="Weeks ahead")]


def store() -> Store:
    return state["store"]


def planner() -> Planner:
    return state["planner"]


def known_city(city: str | None) -> str | None:
    if city and city not in store().meta()["cities"]:
        raise HTTPException(404, f"No city corporation called '{city}'.")
    return city or None


def known_ward(ward: str) -> str:
    if ward not in store().city_of:
        raise HTTPException(404, f"I couldn't find a ward called '{ward}'.")
    return ward


@app.get("/api/health")
def health():
    ready = "planner" in state
    return {"ok": ready, "models_loaded": ready, "external_services": [],
            "rows": int(len(store().df)) if ready else 0, "wards": len(store().city_of) if ready else 0}


@app.get("/api/meta")
def meta():
    return store().meta()


@app.get("/api/city")
def city(origin: str | None = None, horizon: Horizon = 2, city: str | None = None):
    if city and city not in store().meta()["cities"]:
        raise HTTPException(404, f"No city corporation called '{city}'.")
    return store().city(origin, horizon, city)


@app.get("/api/outlook")
def outlook(origin: str | None = None):
    return store().outlook(origin)


@app.get("/api/map")
def risk_map(horizon: Horizon = 2):
    return store().map_view(horizon)


@app.get("/api/ward/{ward}")
def ward_forecast(ward: str, origin: str | None = None, horizon: Horizon = 2):
    return store().forecast(known_ward(ward), origin, horizon)


class WhatIf(BaseModel):
    origin: str | None = None
    horizon: int = Field(2, ge=1, le=4)
    rain_pct: float = Field(0, ge=-100, le=300, description="Change in rainfall over the last 8 weeks, %")
    temp_shift: float = Field(0, ge=-8, le=8, description="Temperature shift, °C")
    humidity_shift: float = Field(0, ge=-30, le=30, description="Humidity shift, percentage points")
    rain_mm: list[float] | None = Field(None, description="Optional: exact weekly rainfall for the last 8 weeks")


@app.post("/api/ward/{ward}/whatif")
def ward_whatif(ward: str, body: WhatIf):
    return store().whatif(known_ward(ward), body.origin, body.rain_pct, body.temp_shift, body.humidity_shift,
                          body.rain_mm, body.horizon)


@app.get("/api/performance")
def performance(ward: str, horizon: Horizon = 2):
    return store().performance(known_ward(ward), horizon)


class Observation(BaseModel):
    date: str
    rain: float = Field(ge=0, le=1000, description="Weekly rainfall, mm")
    temp: float = Field(ge=5, le=45, description="Average temperature, °C")
    humidity: float = Field(ge=1, le=100, description="Relative humidity, %")
    cases: float | None = Field(None, ge=0, le=10000, description="Reported dengue cases that week")


class PredictBody(BaseModel):
    horizon: int = Field(2, ge=1, le=4)
    weeks: list[Observation] = Field(min_length=1, max_length=26)


@app.get("/api/predict/template")
def predict_template(ward: str, weeks: Annotated[int, Query(ge=4, le=26)] = 8):
    return store().template(known_ward(ward), weeks)


@app.post("/api/predict/{ward}")
def predict(ward: str, body: PredictBody):
    weeks = [w.model_dump() for w in body.weeks]
    try:
        res = store().predict_custom(known_ward(ward), weeks, body.horizon)
    except ValueError as e:
        raise HTTPException(422, str(e))
    res["resources"] = planner().resource_outlook(ward, res["horizons"])
    res["alerts"] = al.evaluate(store(), ward, res["origin"], res["horizons"], weeks)
    return res


# ---------------------------------------------------------------------------- Phase 2: operations
Pct = Annotated[float, Query(ge=30, le=100, description="Available regional stock, % of need (beds: % of normal capacity)")]
OptPct = Annotated[float | None, Query(ge=30, le=100, description="Override the stock % for this resource")]
Crews = Annotated[int, Query(ge=0, le=300, description="Vector-control crews available")]
Basis = Annotated[Literal["expected", "upper"], Query(description="Plan for expected cases or the upper 80% bound")]


def plan_args(origin, horizon, stock, crews, basis, city, saline_pct, kits_pct, beds_pct) -> dict:
    return dict(origin=origin, horizon=horizon, stock_pct=stock, crews=crews, basis=basis, city=known_city(city),
                saline_pct=saline_pct, kits_pct=kits_pct, beds_pct=beds_pct)


@app.get("/api/ops/plan")
def ops_plan(origin: str | None = None, horizon: Horizon = 2, stock: Pct = 70, crews: Crews = 20,
             basis: Basis = "upper", city: str | None = None, saline_pct: OptPct = None, kits_pct: OptPct = None,
             beds_pct: OptPct = None):
    """Constrained allocation of saline, kits, beds and crews, with intra-city overflow routing."""
    return planner().plan(**plan_args(origin, horizon, stock, crews, basis, city, saline_pct, kits_pct, beds_pct))


class Simulation(BaseModel):
    origin: str | None = None
    city: str | None = None
    crews: int = Field(10, ge=0, le=300, description="Crews to place automatically when `deployments` is empty")
    deployments: dict[str, int] | None = Field(None, description="Ward id -> crews (0-8). Omit for automatic placement.")


@app.post("/api/ops/simulate")
def ops_simulate(body: Simulation):
    """Model-driven counterfactual: weeks 2-4 with and without vector-control crews, ranked by cases prevented per crew."""
    if body.deployments:
        for w in body.deployments:
            known_ward(w)
    return planner().simulate(body.origin, body.deployments, body.crews, known_city(body.city))


@app.get("/api/ops/dispatch")
def ops_dispatch(origin: str | None = None, horizon: Horizon = 2, stock: Pct = 70, crews: Crews = 20,
                 basis: Basis = "upper", city: str | None = None, saline_pct: OptPct = None, kits_pct: OptPct = None,
                 beds_pct: OptPct = None, lang: Literal["en", "bn"] = "en", everyone: bool = False):
    """Ward-by-ward SMS and WhatsApp notices built from fixed templates (works offline)."""
    plan = planner().plan(**plan_args(origin, horizon, stock, crews, basis, city, saline_pct, kits_pct, beds_pct))
    return {"origin": plan["origin"], "target_date": plan["target_date"], "horizon": horizon, "lang": lang,
            "notices": dispatch.notices(plan, lang, only_actionable=not everyone)}


@app.get("/api/ops/brief", response_class=HTMLResponse)
def ops_brief(origin: str | None = None, horizon: Horizon = 2, stock: Pct = 70, crews: Crews = 20,
              basis: Basis = "upper", city: str | None = None, saline_pct: OptPct = None, kits_pct: OptPct = None,
              beds_pct: OptPct = None, lang: Literal["en", "bn"] = "en"):
    """Printable commissioner brief (self-contained HTML; print to PDF from the browser)."""
    plan = planner().plan(**plan_args(origin, horizon, stock, crews, basis, city, saline_pct, kits_pct, beds_pct))
    return HTMLResponse(dispatch.brief_html(plan, lang))


@app.get("/api/ops/selftest")
def ops_selftest(origin: str | None = None):
    """Offline kill-switch: run every module with all outbound network access blocked."""
    return self_test(store(), planner(), origin)


# ---------------------------------------------------------------------------- Smart early warning
Client = Annotated[str, Query(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$", description="Anonymous browser id")]
Level = Literal["Medium", "High", "Critical"]
AlertType = Literal["risk_increase", "case_surge", "rainfall", "upcoming_high"]


def db() -> al.AlertDB:
    return state["db"]


def as_of_week(as_of: str | None) -> str:
    return str(store().snap(as_of).date())


def counts(rows: list[dict]) -> dict:
    return {"total": len(rows), "new": sum(r["status"] == "new" for r in rows),
            "by_level": {lv: sum(r["level"] == lv for r in rows) for lv in ("Critical", "High", "Medium")},
            "by_type": {t: sum(r["alert_type"] == t for r in rows) for t in al.TYPES}}


@app.get("/api/alerts")
def alerts_list(client: Client, as_of: str | None = None, scope: Literal["active", "history"] = "active",
                city: str | None = None, ward: str | None = None, level: Level | None = None,
                type: AlertType | None = None, date_from: str | None = None, date_to: str | None = None):
    """Alerts as of a forecast week: `active` (still in their expected period, not resolved) or the full `history`."""
    week = as_of_week(as_of)
    rows = db().query(client, week, scope, known_city(city), ward, level, type, date_from, date_to)
    return {"as_of": week, "scope": scope, "alerts": [al.view(r, store()) for r in rows], "counts": counts(rows),
            "scanning": db().meta("backfill_done") is None}


@app.get("/api/alerts/summary")
def alerts_summary(client: Client, as_of: str | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 8):
    """What the notification bell shows: active alerts as of the week, unread first."""
    week = as_of_week(as_of)
    rows = db().query(client, week, "active")
    rank = {"Critical": 0, "High": 1, "Medium": 2}
    rows.sort(key=lambda r: (r["status"] != "new", rank[r["level"]], r["alert_week"] < week, r["ward_id"]))
    return {"as_of": week, "counts": counts(rows), "latest": [al.view(r, store()) for r in rows[:limit]],
            "scanning": db().meta("backfill_done") is None}


class StatusBody(BaseModel):
    client: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    status: Literal["new", "acknowledged", "resolved"]


@app.post("/api/alerts/{alert_id}/status")
def alert_status(alert_id: int, body: StatusBody):
    try:
        return db().set_status(alert_id, body.client, body.status)
    except KeyError:
        raise HTTPException(404, "No such alert.")


class AckAll(BaseModel):
    client: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    ids: list[int] = Field(max_length=1000)


@app.post("/api/alerts/acknowledge")
def alerts_ack_all(body: AckAll):
    return {"acknowledged": db().acknowledge_all(body.ids, body.client)}


@app.post("/api/alerts/scan")
def alerts_scan():
    """Run the detector now (it also runs in the background). Safe to repeat: nothing is stored twice."""
    return run_scan()


@app.get("/api/alerts/config")
def alerts_config():
    return {"thresholds": ALERTS, "last_scan": state.get("last_scan"), "last_scan_at": db().meta("last_scan"),
            "last_data_week": db().meta("last_data_week"), "push_enabled": push.keys() is not None}


# ---------------------------------------------------------------------------- browser push
class Subscription(BaseModel):
    client: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    lang: Literal["en", "bn"] = "en"
    subscription: dict


@app.get("/api/push/key")
def push_key():
    k = push.keys()
    return {"public_key": k["public"] if k else None}


@app.post("/api/push/subscribe")
def push_subscribe(body: Subscription):
    sub = body.subscription
    if not isinstance(sub.get("endpoint"), str) or not sub["endpoint"].startswith("https://") \
            or not isinstance(sub.get("keys"), dict) or not {"p256dh", "auth"} <= set(sub["keys"]):
        raise HTTPException(422, "That is not a valid push subscription.")
    db().add_subscription(body.client, sub, body.lang)
    return {"ok": True}


class Unsubscribe(BaseModel):
    endpoint: str


@app.post("/api/push/unsubscribe")
def push_unsubscribe(body: Unsubscribe):
    db().remove_subscription(body.endpoint)
    return {"ok": True}


class PushTest(BaseModel):
    client: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    as_of: str | None = None


@app.post("/api/push/test")
def push_test(body: PushTest):
    """Send this browser the most urgent real alert of the week, marked [Test], to check notifications work."""
    if push.keys() is None:
        raise HTTPException(503, "Push is not configured on the server (VAPID keys missing).")
    if not db().subscriptions(body.client):
        raise HTTPException(409, "This browser has not enabled notifications yet.")
    rows = db().query(body.client, as_of_week(body.as_of), "active")
    if not rows:
        rows = db().query(body.client, as_of_week(body.as_of), "history", limit=1)
    if not rows:
        raise HTTPException(404, "There is no alert to send yet.")
    rank = {"Critical": 0, "High": 1, "Medium": 2}
    top = min(rows, key=lambda r: rank[r["level"]])
    return {"delivered": push.send(db(), [top], client=body.client, test=True)}
