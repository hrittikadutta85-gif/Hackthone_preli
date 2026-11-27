"""SQLite storage for the hospital directory, admin-added localities and the geocoding cache.

Kept apart from the forecasting data (data/dengue_weekly.csv) and from accounts (data/auth.sqlite3), so hospital
information can be updated at any time without touching or retraining the dengue models. Default file:
data/area.sqlite3 (git-ignored; set AREA_DB to move it).
"""
from __future__ import annotations

import os
from pathlib import Path

from dengue_ews.config import ROOT

from ..auth.db import Database, iso, parse  # noqa: F401  (re-exported for the area modules)

MIGRATIONS = [
    """
    CREATE TABLE data_sources (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        kind        TEXT NOT NULL,          -- official_registry | admin_entry | csv_import | api | gazetteer
        url         TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL
    );
    CREATE TABLE localities (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        name_bn     TEXT,
        aliases     TEXT NOT NULL DEFAULT '[]',
        city_corporation TEXT,              -- e.g. CCC; links the locality to forecasting coverage
        district    TEXT NOT NULL,
        division    TEXT NOT NULL,
        lat         REAL NOT NULL,
        lon         REAL NOT NULL,
        source_id   INTEGER REFERENCES data_sources(id),
        verified    INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE TABLE hospitals (
        id              INTEGER PRIMARY KEY,
        external_id     TEXT UNIQUE,        -- id in the source registry, when imported
        name            TEXT NOT NULL,
        name_bn         TEXT,
        type            TEXT NOT NULL CHECK (type IN ('government', 'private', 'autonomous', 'ngo', 'military', 'other')),
        address         TEXT NOT NULL DEFAULT '',
        city_corporation TEXT,
        district        TEXT NOT NULL,
        division        TEXT NOT NULL,
        lat             REAL,
        lon             REAL,
        phone           TEXT,
        emergency_phone TEXT,
        has_emergency   INTEGER,            -- NULL = unknown
        registered_beds INTEGER,            -- officially registered capacity; NULL = unknown
        icu_beds        INTEGER,
        source_id       INTEGER REFERENCES data_sources(id),
        source_ref      TEXT,               -- URL or document the record was checked against
        verified        INTEGER NOT NULL DEFAULT 0,
        verified_by     INTEGER,
        verified_at     TEXT,
        active          INTEGER NOT NULL DEFAULT 1,
        created_by      INTEGER,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );
    CREATE INDEX hospitals_area ON hospitals(district, city_corporation);
    CREATE TABLE bed_updates (
        id              INTEGER PRIMARY KEY,
        hospital_id     INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
        available_beds  INTEGER,
        occupied_beds   INTEGER,
        icu_available   INTEGER,
        reported_at     TEXT NOT NULL,      -- when the hospital/source reported these numbers
        recorded_at     TEXT NOT NULL,      -- when they were entered here
        method          TEXT NOT NULL CHECK (method IN ('manual', 'api')),
        source_ref      TEXT,               -- who reported it (phone call, bulletin, API name)
        verified        INTEGER NOT NULL DEFAULT 0,
        recorded_by     INTEGER
    );
    CREATE INDEX bed_updates_hospital ON bed_updates(hospital_id, reported_at);
    CREATE TABLE geocode_cache (
        query       TEXT PRIMARY KEY,
        results     TEXT NOT NULL,
        fetched_at  TEXT NOT NULL
    );
    CREATE TABLE osm_places (
        id          TEXT PRIMARY KEY,       -- osm:N123456
        data        TEXT NOT NULL,
        fetched_at  TEXT NOT NULL
    );
    """,
]


class AreaDB(Database):
    def __init__(self, path: Path | None = None):
        super().__init__(Path(path or os.environ.get("AREA_DB") or ROOT / "data" / "area.sqlite3"))

    def migrate(self):
        c = self.conn()
        version = c.execute("PRAGMA user_version").fetchone()[0]
        for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
            c.executescript(f"BEGIN; {sql}; PRAGMA user_version = {i}; COMMIT;")

    def source_id(self, name: str, kind: str, url: str | None = None, notes: str | None = None) -> int:
        from datetime import datetime, timezone
        row = self.one("SELECT id FROM data_sources WHERE name = ?", (name,))
        if row:
            return row["id"]
        return self.run("INSERT INTO data_sources(name, kind, url, notes, created_at) VALUES (?,?,?,?,?)",
                        (name, kind, url, notes, iso(datetime.now(timezone.utc)))).lastrowid
