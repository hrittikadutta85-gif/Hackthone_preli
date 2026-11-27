"""Smart early warning: detect rising dengue risk from the real forecasts, store alerts, track acknowledgements.

Detection walks through the stored forecasts week by week (the same forecasts every page shows) and raises four kinds
of alert per ward:

* risk_increase   this week's forecast tier (ALERT_HORIZON weeks ahead) is higher than last week's forecast tier
* case_surge      the forecast is ALERT_SURGE_PCT% (and ALERT_SURGE_MIN_CASES cases) above the ward's recent average
* rainfall        the last 4 weeks' rain is unusually high for the ward and month (or above ALERT_RAIN_ABS_MM) AND
                  the model forecasts at least ALERT_RAIN_MIN_LEVEL within 2-4 weeks. Rain alone never raises an alert.
* upcoming_high   a forecast within 4 weeks reaches ALERT_UPCOMING_LEVEL while this week's reported cases are below it

Duplicates are prevented three ways: an alert fires only when its condition *starts* (it was false the week before) or
its level rises; the same ward + type stays quiet for ALERT_COOLDOWN_WEEKS unless the level rises; and every alert has a
unique key, so a rescan inserts nothing that already exists. Detection is deterministic, so rescans are idempotent.

Storage is SQLite (Python standard library): one file, no server. Acknowledgements are anonymous: each browser sends a
random client id it keeps in localStorage, and statuses are stored per alert and client.
"""
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from dengue_ews.config import ALERTS, ALERTS_DB, TIERS, TRAIN_END
from dengue_ews.model import tier_of

from . import narrative as nl
from .service import PRECOMPUTE_FROM, Store, day

TYPES = ["risk_increase", "case_surge", "rainfall", "upcoming_high"]
LEVEL = {t: i for i, t in enumerate(TIERS)}
STATUSES = ["new", "acknowledged", "resolved"]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ------------------------------------------------------------------ messages (English is stored; Bangla for pushes)
CITY_BN = {"Chattogram": "চট্টগ্রাম", "Dhaka North": "ঢাকা উত্তর", "Dhaka South": "ঢাকা দক্ষিণ", "Gazipur": "গাজীপুর",
           "Narayanganj": "নারায়ণগঞ্জ"}
TIER_BN = {"Low": "কম", "Medium": "মাঝারি", "High": "উচ্চ", "Critical": "সংকটজনক"}
MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"]
BN = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def _date(iso: str, lang: str) -> str:
    d = pd.Timestamp(iso)
    return f"{d.day} {MONTH[d.month - 1]} {d.year}" if lang == "en" else f"{d.day} {MONTH_BN[d.month - 1]} {d.year}".translate(BN)


def ward_name(ward: str, city: str, lang: str) -> str:
    num = ward.split("_")[-1]
    return f"Ward {num}, {city}" if lang == "en" else f"ওয়ার্ড {num.translate(BN)}, {CITY_BN.get(city, city)}"


def message(a: dict, lang: str = "en") -> str:
    """One plain sentence describing the alert."""
    w = ward_name(a["ward_id"], a["city"], lang)
    n = (lambda v: str(v)) if lang == "en" else (lambda v: str(v).translate(BN))
    cases = round(a["predicted_cases"])
    if lang == "bn":
        tier = TIER_BN[a["level"]]
        if a["alert_type"] == "risk_increase":
            return (f"{w}: {n(a['horizon'])} সপ্তাহের পূর্বাভাসে ঝুঁকি {TIER_BN[a['prev_tier']]} থেকে বেড়ে {tier} হচ্ছে "
                    f"({_date(a['target_week'], 'bn')}-এর সপ্তাহে প্রায় {n(cases)} জন রোগী)।")
        if a["alert_type"] == "case_surge":
            if a["baseline"] < 1:
                return f"{w}: {n(a['horizon'])} সপ্তাহ পরে প্রায় {n(cases)} জন রোগী সম্ভাব্য, যেখানে সম্প্রতি প্রায় কোনো রোগী ছিল না।"
            return (f"{w}: {n(a['horizon'])} সপ্তাহ পরে প্রায় {n(cases)} জন রোগী সম্ভাব্য, সাম্প্রতিক গড় "
                    f"সপ্তাহে {n(round(a['baseline']))} জনের চেয়ে {n(round(a['change_pct']))}% বেশি।")
        if a["alert_type"] == "rainfall":
            return (f"{w}: গত ৪ সপ্তাহে {n(round(a['rain_mm']))} মিমি বৃষ্টি (এ সময়ের স্বাভাবিক সীমা "
                    f"{n(round(a['rain_threshold']))} মিমি), আর মডেল ২–৪ সপ্তাহে {tier} ঝুঁকি দেখছে।")
        return f"{w}: {_date(a['target_week'], 'bn')}-এর সপ্তাহে ({n(a['horizon'])} সপ্তাহ পরে) {tier} ঝুঁকিতে পৌঁছাতে পারে।"
    if a["alert_type"] == "risk_increase":
        return (f"{w}: risk rising from {a['prev_tier']} to {a['level']} in the {a['horizon']}-week forecast "
                f"(about {cases} cases expected in the week of {_date(a['target_week'], 'en')}).")
    if a["alert_type"] == "case_surge":
        if a["baseline"] < 1:
            return f"{w}: about {cases} cases expected in {a['horizon']} weeks, after almost none in recent weeks."
        return (f"{w}: about {cases} cases expected in {a['horizon']} weeks, up {round(a['change_pct'])}% from a recent "
                f"average of {round(a['baseline'])} a week.")
    if a["alert_type"] == "rainfall":
        return (f"{w}: {round(a['rain_mm'])} mm of rain in the last 4 weeks (usual for this time of year: up to "
                f"{round(a['rain_threshold'])} mm), and the model expects {a['level']} risk within 2-4 weeks.")
    return (f"{w}: expected to reach {a['level']} risk in the week of {_date(a['target_week'], 'en')} "
            f"({a['horizon']} week{'s' if a['horizon'] != 1 else ''} ahead).")


TITLE = {"en": {"risk_increase": "Risk rising", "case_surge": "Sudden case increase", "rainfall": "Heavy-rain warning",
                "upcoming_high": "High risk ahead"},
         "bn": {"risk_increase": "ঝুঁকি বাড়ছে", "case_surge": "হঠাৎ রোগী বৃদ্ধি", "rainfall": "ভারী বৃষ্টির সতর্কতা",
                "upcoming_high": "সামনে উচ্চ ঝুঁকি"}}


# ------------------------------------------------------------------ detection
def rain_thresholds(store: Store) -> dict:
    """Unusually heavy rain per ward and month: the ALERT_RAIN_PERCENTILE of 4-week rainfall in the training years."""
    tr = store.feat[store.feat["date"] <= TRAIN_END]
    q = tr.groupby([tr["ward_id"], tr["date"].dt.month])["rain_sum_4w"].quantile(ALERTS["ALERT_RAIN_PERCENTILE"])
    return q.to_dict()


def detect(store: Store, cfg: dict | None = None) -> list[dict]:
    """Every alert the real forecasts justify, for every origin week on file, oldest first. Deterministic."""
    cfg = {**ALERTS, **(cfg or {})}
    thr = store.thr
    wards = sorted(store.city_of)
    p = store.preds
    origins = sorted(p["origin_date"].unique())
    oi = {o: i for i, o in enumerate(origins)}
    wi = {w: i for i, w in enumerate(wards)}
    shape = (len(origins), len(wards), 5)                      # horizon index 1..4
    pred = np.full(shape, np.nan)
    lvl = np.full(shape, -1, dtype=int)
    r, c, h = p["origin_date"].map(oi).to_numpy(), p["ward_id"].map(wi).to_numpy(), p["horizon"].to_numpy()
    pred[r, c, h] = p["predicted"].to_numpy(float)
    lvl[r, c, h] = p["tier"].map(LEVEL).to_numpy(int)

    feat = store.feat[store.feat["date"].isin(origins)]
    fr, fc = feat["date"].map(oi).to_numpy(), feat["ward_id"].map(wi).to_numpy()

    def grid(col):
        g = np.full(shape[:2], np.nan)
        g[fr, fc] = feat[col].to_numpy(float)
        return g

    mean4, now, rain = grid("cases_mean_4w"), grid("cases_now"), grid("rain_sum_4w")
    now_lvl = np.vectorize(LEVEL.get)(tier_of(np.nan_to_num(now), thr))
    rain_q = rain_thresholds(store)
    usual = np.array([[rain_q.get((w, pd.Timestamp(o).month), np.inf) for w in wards] for o in origins])

    h_a, h_s = cfg["ALERT_HORIZON"], cfg["ALERT_SURGE_HORIZON"]
    min_lvl, rain_lvl, up_lvl = (LEVEL[cfg[k]] for k in ("ALERT_MIN_LEVEL", "ALERT_RAIN_MIN_LEVEL", "ALERT_UPCOMING_LEVEL"))
    cool = cfg["ALERT_COOLDOWN_WEEKS"]
    last: dict[tuple, tuple] = {}      # (ward, type) -> (origin index, level) of the last alert
    was_on: dict[tuple, bool] = {}     # (ward, type) -> condition held the week before
    out = []

    def fire(ward, kind, i, on, level, **fields):
        key = (ward, kind)
        prev_on = was_on.get(key, False)
        was_on[key] = on
        if not on or level < min_lvl:
            return
        lw = last.get(key)
        rising = lw is not None and level > lw[1]
        if prev_on and not rising:
            return                                   # the same event is still going on
        if lw is not None and i - lw[0] < cool and not rising:
            return                                   # cooling down after a recent alert
        last[key] = (i, level)
        a = {"alert_type": kind, "ward_id": ward, "city": store.city_of[ward], "alert_week": day(origins[i]),
             "level": TIERS[level], **fields}
        a["message"] = message(a)
        a["dedup_key"] = f"{kind}:{ward}:{a['alert_week']}:{a['level']}"
        out.append(a)

    for i, o in enumerate(origins):
        o = pd.Timestamp(o)
        target = lambda k: day(o + pd.Timedelta(weeks=int(k)))  # noqa: E731
        for j, w in enumerate(wards):
            t = lvl[i, j]
            if (t[1:] < 0).any():
                continue                              # no forecast for this ward-week
            f = pred[i, j]

            # A. risk-level increase vs last week's forecast for the same horizon
            prev_t = lvl[i - 1, j, h_a] if i else -1
            up = prev_t >= 0 and t[h_a] > prev_t
            fire(w, "risk_increase", i, bool(up), int(t[h_a]), prev_tier=TIERS[prev_t] if prev_t >= 0 else None,
                 new_tier=TIERS[t[h_a]], horizon=h_a, predicted_cases=float(f[h_a]), target_week=target(h_a),
                 expires_week=target(h_a))

            # B. sudden case increase vs the ward's last-4-week average of reported cases
            base = mean4[i, j] if not np.isnan(mean4[i, j]) else np.nan_to_num(now[i, j])
            rise = f[h_s] - base
            pct = rise / max(base, 1.0) * 100
            surge = rise >= cfg["ALERT_SURGE_MIN_CASES"] and pct >= cfg["ALERT_SURGE_PCT"]
            fire(w, "case_surge", i, bool(surge), int(t[h_s]), prev_tier=tier_of([base], thr)[0],
                 new_tier=TIERS[t[h_s]], horizon=h_s, predicted_cases=float(f[h_s]), baseline=float(base),
                 change_pct=float(pct), target_week=target(h_s), expires_week=target(h_s))

            # C. heavy rain AND model risk within 2-4 weeks (rain alone never raises an alert)
            mm = float(np.nan_to_num(rain[i, j]))
            line = max(min(usual[i, j], cfg["ALERT_RAIN_ABS_MM"]), cfg["ALERT_RAIN_MIN_MM"])
            h_max = max((2, 3, 4), key=lambda k: (t[k], -k))
            wet = mm >= line and t[h_max] >= rain_lvl
            fire(w, "rainfall", i, bool(wet), int(t[h_max]), prev_tier=None, new_tier=TIERS[t[h_max]], horizon=h_max,
                 predicted_cases=float(f[h_max]), rain_mm=mm, rain_threshold=float(line), target_week=target(h_max),
                 expires_week=target(h_max))

            # D. High/Critical expected within 4 weeks while this week's reported cases are below that level
            ahead = [k for k in (1, 2, 3, 4) if t[k] >= up_lvl]
            soon = bool(ahead) and now_lvl[i, j] < up_lvl
            if ahead:
                first = ahead[0]
                peak = max(ahead, key=lambda k: (t[k], -k))
                fire(w, "upcoming_high", i, soon, int(t[peak]), prev_tier=TIERS[now_lvl[i, j]], new_tier=TIERS[t[peak]],
                     horizon=first, predicted_cases=float(f[first]), target_week=target(first),
                     expires_week=target(first))
            else:
                fire(w, "upcoming_high", i, False, 0)
    return out


def evaluate(store: Store, ward: str, origin: str, horizons: list[dict], weeks: list[dict]) -> list[dict]:
    """The alerts a forecast from the prediction portal would raise, under the same configured rules as the scanner.

    `horizons` are the forecast rows; `weeks` the observations the user entered (oldest first). Nothing is stored:
    this answers "if these were this week's numbers, what would we warn about?".
    """
    cfg = ALERTS
    thr = store.thr
    by_h = {r["h"]: r for r in horizons}
    o = pd.Timestamp(origin)
    target = lambda h: day(o + pd.Timedelta(weeks=h))  # noqa: E731
    cases = [w.get("cases") for w in weeks if w.get("cases") is not None]
    base = float(np.mean(cases[-4:])) if cases else 0.0
    now = float(cases[-1]) if cases else 0.0
    rain4 = float(sum(w.get("rain") or 0 for w in weeks[-4:]))
    common = {"ward_id": ward, "city": store.city_of[ward], "alert_week": day(o)}
    out = []

    # A. vs the stored forecast made the week before, for the same target week
    h_a = cfg["ALERT_HORIZON"]
    prev = store.preds[(store.preds["ward_id"] == ward) & (store.preds["origin_date"] == o - pd.Timedelta(weeks=1))
                       & (store.preds["horizon"] == min(h_a + 1, 4))]
    if len(prev) and LEVEL[by_h[h_a]["tier"]] > LEVEL[prev["tier"].iloc[0]] and LEVEL[by_h[h_a]["tier"]] >= 1:
        out.append({**common, "alert_type": "risk_increase", "level": by_h[h_a]["tier"], "prev_tier": prev["tier"].iloc[0],
                    "new_tier": by_h[h_a]["tier"], "horizon": h_a, "predicted_cases": by_h[h_a]["predicted"],
                    "target_week": target(h_a)})
    # B. sudden increase vs the average of the cases entered for the last 4 weeks
    h_s = cfg["ALERT_SURGE_HORIZON"]
    rise = by_h[h_s]["predicted"] - base
    pct = rise / max(base, 1.0) * 100
    if rise >= cfg["ALERT_SURGE_MIN_CASES"] and pct >= cfg["ALERT_SURGE_PCT"] and LEVEL[by_h[h_s]["tier"]] >= 1:
        out.append({**common, "alert_type": "case_surge", "level": by_h[h_s]["tier"], "prev_tier": tier_of([base], thr)[0],
                    "new_tier": by_h[h_s]["tier"], "horizon": h_s, "predicted_cases": by_h[h_s]["predicted"],
                    "baseline": base, "change_pct": pct, "target_week": target(h_s)})
    # C. heavy rain in the entered weeks AND forecast risk within 2-4 weeks
    usual = rain_thresholds(store).get((ward, o.month), np.inf)
    line = max(min(usual, cfg["ALERT_RAIN_ABS_MM"]), cfg["ALERT_RAIN_MIN_MM"])
    h_max = max((2, 3, 4), key=lambda h: (LEVEL[by_h[h]["tier"]], -h))
    if len(weeks) >= 4 and rain4 >= line and LEVEL[by_h[h_max]["tier"]] >= LEVEL[cfg["ALERT_RAIN_MIN_LEVEL"]]:
        out.append({**common, "alert_type": "rainfall", "level": by_h[h_max]["tier"], "prev_tier": None,
                    "new_tier": by_h[h_max]["tier"], "horizon": h_max, "predicted_cases": by_h[h_max]["predicted"],
                    "rain_mm": rain4, "rain_threshold": float(line), "target_week": target(h_max)})
    # D. High or Critical ahead while this week's cases are below it
    up = LEVEL[cfg["ALERT_UPCOMING_LEVEL"]]
    ahead = [h for h in (1, 2, 3, 4) if LEVEL[by_h[h]["tier"]] >= up]
    if ahead and LEVEL[tier_of([now], thr)[0]] < up:
        first = ahead[0]
        peak = max(ahead, key=lambda h: (LEVEL[by_h[h]["tier"]], -h))
        out.append({**common, "alert_type": "upcoming_high", "level": by_h[peak]["tier"], "prev_tier": tier_of([now], thr)[0],
                    "new_tier": by_h[peak]["tier"], "horizon": first, "predicted_cases": by_h[first]["predicted"],
                    "target_week": target(first)})
    for a in out:
        a.setdefault("baseline", None)
        a.setdefault("change_pct", None)
        a.setdefault("rain_mm", None)
        a.setdefault("rain_threshold", None)
        a["action"] = nl.ACTIONS[a["level"]][0]
    return out


# ------------------------------------------------------------------ storage
SCHEMA = """
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key TEXT NOT NULL UNIQUE,
    alert_type TEXT NOT NULL,
    city TEXT NOT NULL,
    ward_id TEXT NOT NULL,
    alert_week TEXT NOT NULL,          -- forecast week the alert was raised in
    horizon INTEGER,
    target_week TEXT,                  -- week the risk is expected
    expires_week TEXT NOT NULL,        -- active until the end of this week
    prev_tier TEXT,
    new_tier TEXT,
    level TEXT NOT NULL,               -- Medium / High / Critical
    predicted_cases REAL,
    baseline REAL,
    change_pct REAL,
    rain_mm REAL,
    rain_threshold REAL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,          -- when the alert row was generated (UTC)
    backfill INTEGER NOT NULL DEFAULT 0,  -- 1 = found in the first scan of history (never pushed)
    pushed_at TEXT
);
CREATE INDEX IF NOT EXISTS alerts_week ON alerts(alert_week, expires_week);
CREATE TABLE IF NOT EXISTS alert_status (
    alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'acknowledged', 'resolved')),
    acknowledged_at TEXT,
    resolved_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (alert_id, client_id)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL,
    last_sent_at TEXT,
    failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""
COLUMNS = ["dedup_key", "alert_type", "city", "ward_id", "alert_week", "horizon", "target_week", "expires_week",
           "prev_tier", "new_tier", "level", "predicted_cases", "baseline", "change_pct", "rain_mm", "rain_threshold",
           "message"]


class AlertDB:
    def __init__(self, path: Path | str = ALERTS_DB):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.connect() as c:
            c.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        return c

    def meta(self, key: str, value: str | None = None) -> str | None:
        with self.lock, self.connect() as c:
            if value is not None:
                c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))
                return value
            row = c.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

    def insert(self, alerts: list[dict], backfill: bool) -> list[dict]:
        """Insert alerts that are not stored yet; returns the new ones (with ids)."""
        new = []
        stamp = now_iso()
        with self.lock, self.connect() as c:
            for a in alerts:
                vals = [None if isinstance(a.get(k), float) and np.isnan(a.get(k)) else a.get(k) for k in COLUMNS]
                cur = c.execute(
                    f"INSERT OR IGNORE INTO alerts({', '.join(COLUMNS)}, created_at, backfill) "
                    f"VALUES ({', '.join('?' * len(COLUMNS))}, ?, ?)", [*vals, stamp, int(backfill)])
                if cur.rowcount:
                    new.append({**a, "id": cur.lastrowid, "created_at": stamp, "backfill": int(backfill)})
        return new

    def query(self, client: str | None, as_of: str | None = None, scope: str = "active", city: str | None = None,
              ward: str | None = None, level: str | None = None, alert_type: str | None = None,
              date_from: str | None = None, date_to: str | None = None, limit: int = 500) -> list[dict]:
        sql = ["SELECT a.*, COALESCE(s.status, 'new') AS status, s.acknowledged_at, s.resolved_at FROM alerts a",
               "LEFT JOIN alert_status s ON s.alert_id = a.id AND s.client_id = ?", "WHERE 1 = 1"]
        args: list = [client or ""]
        if as_of:
            sql.append("AND a.alert_week <= ?")
            args.append(as_of)
            if scope == "active":
                sql.append("AND a.expires_week >= ? AND COALESCE(s.status, 'new') != 'resolved'")
                args.append(as_of)
        for col, val in (("a.city", city), ("a.ward_id", ward), ("a.level", level), ("a.alert_type", alert_type)):
            if val:
                sql.append(f"AND {col} = ?")
                args.append(val)
        if date_from:
            sql.append("AND a.alert_week >= ?")
            args.append(date_from)
        if date_to:
            sql.append("AND a.alert_week <= ?")
            args.append(date_to)
        sql.append("ORDER BY a.alert_week DESC, CASE a.level WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 "
                   "WHEN 'Medium' THEN 2 ELSE 3 END, a.ward_id, a.alert_type LIMIT ?")
        args.append(limit)
        with self.connect() as c:
            return [dict(r) for r in c.execute(" ".join(sql), args).fetchall()]

    def set_status(self, alert_id: int, client: str, status: str) -> dict:
        if status not in STATUSES:
            raise ValueError(f"Status must be one of {STATUSES}.")
        t = now_iso()
        with self.lock, self.connect() as c:
            if not c.execute("SELECT 1 FROM alerts WHERE id = ?", (alert_id,)).fetchone():
                raise KeyError(alert_id)
            old = c.execute("SELECT * FROM alert_status WHERE alert_id = ? AND client_id = ?", (alert_id, client)).fetchone()
            ack = old["acknowledged_at"] if old else None
            res = old["resolved_at"] if old else None
            if status == "new":
                ack = res = None
            elif status == "acknowledged":
                ack, res = ack or t, None
            else:
                ack, res = ack or t, t
            c.execute("INSERT OR REPLACE INTO alert_status(alert_id, client_id, status, acknowledged_at, resolved_at, "
                      "updated_at) VALUES (?, ?, ?, ?, ?, ?)", (alert_id, client, status, ack, res, t))
        return {"id": alert_id, "status": status, "acknowledged_at": ack, "resolved_at": res}

    def acknowledge_all(self, ids: list[int], client: str) -> int:
        t = now_iso()
        with self.lock, self.connect() as c:
            n = 0
            for i in ids:
                row = c.execute("SELECT status FROM alert_status WHERE alert_id = ? AND client_id = ?", (i, client)).fetchone()
                if row and row["status"] != "new":
                    continue
                c.execute("INSERT OR REPLACE INTO alert_status(alert_id, client_id, status, acknowledged_at, "
                          "resolved_at, updated_at) VALUES (?, ?, 'acknowledged', ?, NULL, ?)", (i, client, t, t))
                n += 1
            return n

    def delete_from(self, week: str) -> int:
        """Remove alerts raised in `week` or later (used to replay data weeks for testing)."""
        with self.lock, self.connect() as c:
            return c.execute("DELETE FROM alerts WHERE alert_week >= ?", (week,)).rowcount

    # push subscriptions
    def add_subscription(self, client: str, sub: dict, lang: str):
        with self.lock, self.connect() as c:
            c.execute("INSERT OR REPLACE INTO push_subscriptions(endpoint, client_id, p256dh, auth, lang, created_at) "
                      "VALUES (?, ?, ?, ?, ?, ?)",
                      (sub["endpoint"], client, sub["keys"]["p256dh"], sub["keys"]["auth"], lang, now_iso()))

    def remove_subscription(self, endpoint: str):
        with self.lock, self.connect() as c:
            c.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))

    def subscriptions(self, client: str | None = None) -> list[dict]:
        with self.connect() as c:
            if client:
                rows = c.execute("SELECT * FROM push_subscriptions WHERE client_id = ?", (client,))
            else:
                rows = c.execute("SELECT * FROM push_subscriptions")
            return [dict(r) for r in rows.fetchall()]

    def mark_pushed(self, ids: list[int]):
        with self.lock, self.connect() as c:
            c.executemany("UPDATE alerts SET pushed_at = ? WHERE id = ?", [(now_iso(), i) for i in ids])

    def push_result(self, endpoint: str, ok: bool):
        with self.lock, self.connect() as c:
            if ok:
                c.execute("UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE endpoint = ?", (now_iso(), endpoint))
            else:
                c.execute("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?", (endpoint,))


# ------------------------------------------------------------------ scanning
def scan(store: Store, db: AlertDB, notify=None) -> dict:
    """Detect, store what is new, and hand genuinely new alerts to `notify` (never the first scan of history)."""
    found = detect(store)
    first = db.meta("backfill_done") is None
    new = db.insert(found, backfill=first)
    if first:
        db.meta("backfill_done", now_iso())
    db.meta("last_scan", now_iso())
    db.meta("last_data_week", day(store.dates[-1]))
    pushed = 0
    if new and not first and notify is not None:
        pushed = notify(new)
    return {"detected": len(found), "new": len(new), "backfill": first, "pushed": pushed}


def view(row: dict, store: Store) -> dict:
    """API shape of one stored alert, with the suggested action for its level."""
    return {**row, "label": store.label(row["ward_id"]) if row["ward_id"] in store.city_of else row["ward_id"],
            "action": nl.ACTIONS[row["level"]][0]}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Alert maintenance. Normally the API server scans on its own.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan", help="detect and store alerts now (no pushes from the command line)")
    rp = sub.add_parser("replay", help="forget alerts raised from WEEK on, so the next server scan finds them again "
                                       "as new and pushes them, the same as when a new week of data arrives")
    rp.add_argument("week", help="YYYY-MM-DD forecast week, e.g. 2025-07-07")
    args = ap.parse_args()
    db = AlertDB()
    if args.cmd == "scan":
        print(scan(Store(), db))
    else:
        print(f"Removed {db.delete_from(args.week)} alerts raised on or after {args.week}. "
              "Run POST /api/alerts/scan (or wait for the background scan) to raise and push them again.")
