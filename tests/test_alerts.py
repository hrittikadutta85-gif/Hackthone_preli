"""Smart early warning: alerts come from the real forecasts, follow the configured rules, never repeat, and track
anonymous acknowledgements per browser."""
import collections

import pandas as pd
import pytest

from backend import alerts as al
from backend import push
from backend.service import Store
from dengue_ews.config import ALERTS, MODEL_PATH, TIERS

pytestmark = pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first")
LEVEL = {t: i for i, t in enumerate(TIERS)}


@pytest.fixture(scope="module")
def store():
    return Store()


@pytest.fixture(scope="module")
def found(store):
    return al.detect(store)


@pytest.fixture()
def db(tmp_path):
    return al.AlertDB(tmp_path / "alerts.sqlite3")


def pred(store, ward, origin, h):
    p = store.preds
    return p[(p["ward_id"] == ward) & (p["origin_date"] == pd.Timestamp(origin)) & (p["horizon"] == h)].iloc[0]


def test_detection_is_deterministic(store, found):
    again = al.detect(store)
    assert [a["dedup_key"] for a in again] == [a["dedup_key"] for a in found]
    assert len({a["dedup_key"] for a in found}) == len(found)
    assert {a["alert_type"] for a in found} == set(al.TYPES)


def test_risk_increase_matches_the_stored_forecasts(store, found):
    h = ALERTS["ALERT_HORIZON"]
    for a in [x for x in found if x["alert_type"] == "risk_increase"][:80]:
        now = pred(store, a["ward_id"], a["alert_week"], h)
        before = pred(store, a["ward_id"], pd.Timestamp(a["alert_week"]) - pd.Timedelta(weeks=1), h)
        assert now["tier"] == a["new_tier"] == a["level"] and before["tier"] == a["prev_tier"]
        assert LEVEL[a["new_tier"]] > LEVEL[a["prev_tier"]]
        assert abs(now["predicted"] - a["predicted_cases"]) < 0.01


def test_case_surge_respects_thresholds(found):
    for a in (x for x in found if x["alert_type"] == "case_surge"):
        assert a["predicted_cases"] - a["baseline"] >= ALERTS["ALERT_SURGE_MIN_CASES"] - 1e-9
        assert a["change_pct"] >= ALERTS["ALERT_SURGE_PCT"] - 1e-9


def test_rain_never_alerts_on_its_own(found):
    rain = [x for x in found if x["alert_type"] == "rainfall"]
    assert rain
    for a in rain:
        assert a["rain_mm"] >= a["rain_threshold"] >= ALERTS["ALERT_RAIN_MIN_MM"]
        assert LEVEL[a["level"]] >= LEVEL[ALERTS["ALERT_RAIN_MIN_LEVEL"]]  # the model must agree


def test_upcoming_high_points_at_the_escalation_week(store, found):
    for a in [x for x in found if x["alert_type"] == "upcoming_high"][:80]:
        p = pred(store, a["ward_id"], a["alert_week"], a["horizon"])
        assert LEVEL[p["tier"]] >= LEVEL[ALERTS["ALERT_UPCOMING_LEVEL"]]
        assert str(p["target_date"].date()) == a["target_week"]
        assert LEVEL[a["prev_tier"]] < LEVEL[ALERTS["ALERT_UPCOMING_LEVEL"]]


def test_no_repeats_within_cooldown_unless_level_rises(found):
    cool = ALERTS["ALERT_COOLDOWN_WEEKS"]
    last = {}
    for a in found:
        key = (a["ward_id"], a["alert_type"])
        week = pd.Timestamp(a["alert_week"])
        if key in last:
            prev_week, prev_level = last[key]
            assert (week - prev_week).days >= 7 * cool or LEVEL[a["level"]] > LEVEL[prev_level]
        last[key] = (week, a["level"])


def test_thresholds_are_configurable(store, found):
    strict = al.detect(store, {"ALERT_SURGE_PCT": 300.0})
    count = lambda xs: collections.Counter(a["alert_type"] for a in xs)  # noqa: E731
    assert count(strict)["case_surge"] < count(found)["case_surge"]
    assert count(strict)["risk_increase"] == count(found)["risk_increase"]


def test_scans_store_once_and_only_push_genuinely_new_alerts(store, db):
    sent = []
    first = al.scan(store, db, notify=lambda new: sent.extend(new) or len(new))
    assert first["backfill"] and first["new"] > 0 and not sent        # history is never pushed
    again = al.scan(store, db, notify=lambda new: sent.extend(new) or len(new))
    assert again["new"] == 0 and not sent                              # refreshing changes nothing
    removed = db.delete_from("2025-08-01")                             # replay the last months of data
    third = al.scan(store, db, notify=lambda new: sent.extend(new) or len(new))
    assert removed and third["new"] == removed == len(sent)
    assert all(a["alert_week"] >= "2025-08-01" for a in sent)


def test_anonymous_statuses_are_per_browser(store, db):
    al.scan(store, db)
    week = "2025-07-07"
    rows = db.query("browser-one", week)
    assert rows and all(r["status"] == "new" for r in rows)
    assert all(r["alert_week"] <= week <= r["expires_week"] for r in rows)
    first = rows[0]["id"]
    out = db.set_status(first, "browser-one", "acknowledged")
    assert out["acknowledged_at"] and out["resolved_at"] is None
    out = db.set_status(first, "browser-one", "resolved")
    assert out["resolved_at"]
    assert first not in [r["id"] for r in db.query("browser-one", week)]          # resolved leaves "active"
    assert first in [r["id"] for r in db.query("browser-one", week, "history")]   # but stays in history
    assert first in [r["id"] for r in db.query("browser-two", week)]              # another browser is unaffected
    with pytest.raises(ValueError):
        db.set_status(first, "browser-one", "deleted")


def test_messages_exist_in_both_languages(found):
    for kind in al.TYPES:
        a = next(x for x in found if x["alert_type"] == kind)
        en, bn = al.message(a, "en"), al.message(a, "bn")
        assert a["ward_id"].split("_")[-1] in en and en != bn
        assert not any(ch.isascii() and ch.isalpha() for ch in bn.replace("NS1", ""))


def test_push_is_a_no_op_without_keys(store, db, monkeypatch):
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.setattr(push, "load_env_file", lambda *a, **k: None)
    al.scan(store, db)
    rows = db.query("x" * 8, "2025-07-07")
    assert push.send(db, rows[:1]) == 0
