"""FastAPI backend for the dengue early-warning dashboard.

    uvicorn backend.main:app --port 8000

Models and data are loaded once at startup, so requests are cheap lookups (or a single-ward re-score for what-if).
No external API or LLM calls.
"""
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field

from .service import Store

state: dict[str, Store] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["store"] = Store()
    yield


app = FastAPI(title="Dengue Early-Warning API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)

Horizon = Annotated[int, Query(ge=1, le=4, description="Weeks ahead")]


def store() -> Store:
    return state["store"]


def known_ward(ward: str) -> str:
    if ward not in store().city_of:
        raise HTTPException(404, f"I couldn't find a ward called '{ward}'.")
    return ward


@app.get("/api/health")
def health():
    return {"ok": "store" in state}


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
    try:
        return store().predict_custom(known_ward(ward), [w.model_dump() for w in body.weeks], body.horizon)
    except ValueError as e:
        raise HTTPException(422, str(e))
