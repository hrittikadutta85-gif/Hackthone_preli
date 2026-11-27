"""Accounts and sign-in: login, codes, sessions, roles, notifications and provider failures.

Runs against the real FastAPI app with a temporary accounts database. SMS, WhatsApp and email go to in-test fake
providers that record what would have been sent; the product code itself has no fake or simulated provider.
"""
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
import requests
from fastapi.testclient import TestClient

from backend import main
from backend.auth import notify as nt
from backend.auth.config import Settings
from backend.auth.notify import Message, Provider, SendResult
from backend.auth.service import AuthService, Client, set_service

PASSWORD = "Monsoon-Watch-2026"
T0 = datetime(2026, 11, 27, 4, 30, tzinfo=timezone.utc)  # 10:30 AM in Dhaka


class Fake(Provider):
    def __init__(self, channel: str, fail: str | None = None):
        self.channel, self.name, self.fail, self.sent = channel, f"fake-{channel}", fail, []

    def configured(self):
        return True

    def send(self, to, m: Message, callback_url=None):
        if self.fail == "raise":
            raise requests.ConnectionError("gateway down")
        if self.fail == "reject":
            return SendResult("failed", detail="HTTP 400: rejected")
        self.sent.append({"to": to, "event": m.event, "code": m.code, "text": m.text(self.channel)})
        return SendResult("sent", f"{self.name}-{len(self.sent)}", "accepted (queued)")

    def last_code(self):
        return next(x["code"] for x in reversed(self.sent) if x["code"])


class Env:
    def __init__(self, tmp_path, providers=("sms", "whatsapp", "email"), **settings):
        self.now = [T0]
        self.fakes = {ch: Fake(ch) for ch in providers}
        cfg = Settings(db_path=tmp_path / "auth.sqlite3", secret_key="test-secret-key", **settings)
        self.svc = AuthService(cfg, providers={ch: self.fakes.get(ch) for ch in ("sms", "whatsapp", "email")},
                               clock=lambda: self.now[0])
        set_service(self.svc)

    def tick(self, **kw):
        self.now[0] += timedelta(**kw)

    def user(self, email="officer@dncc.gov.bd", role="officer", phone="+8801711000001", verified_phone=True, **kw):
        uid = self.svc._insert_user(email=email, full_name="Nusrat Jahan", phone=phone, username=None,
                                    organization="DNCC", designation="Health officer", role=role, status="active",
                                    password=PASSWORD, email_verified=True, terms=True)
        if verified_phone:
            self.svc.db.run("UPDATE users SET phone_verified_at = ? WHERE id = ?", (self.svc.ts(), uid))
        for k, v in kw.items():
            self.svc.db.run(f"UPDATE users SET {k} = ? WHERE id = ?", (v, uid))
        return uid

    def client(self, ip="203.0.113.5"):
        return TestClient(main.app, raise_server_exceptions=False, headers={"x-forwarded-for": ip})

    def login(self, email="officer@dncc.gov.bd", password=PASSWORD, ip="203.0.113.5", tc=None, **body):
        tc = tc or self.client(ip)
        r = tc.post("/api/auth/login", json={"identifier": email, "password": password, **body})
        if r.status_code == 200 and r.json()["status"] == "ok":
            tc.headers["x-csrf-token"] = r.json()["csrf"]
        return tc, r


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.svc.notifier.flush()
    set_service(None)


def code_of(r):
    return r.json()["detail"]["code"]


# ------------------------------------------------------------------------------------------------ login
def test_successful_login_sets_a_safe_cookie_and_sends_a_login_alert(env):
    env.user()
    tc, r = env.login()
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["home"] == "/"
    cookie = r.headers.get_list("set-cookie")[0]
    assert "dw_session=" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert "session" not in r.json() and r.json()["user"]["role"] == "officer"   # token only in the cookie
    me = tc.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["email"] == "officer@dncc.gov.bd"
    assert me.headers["cache-control"] == "no-store"
    env.svc.notifier.flush()
    sms = env.fakes["sms"].sent[-1]
    assert sms["event"] == "login" and sms["to"] == "+8801711000001"
    assert "27 November 2026 at 10:30 AM" in sms["text"] and "If this wasn't you" in sms["text"]
    hist = tc.get("/api/account/logins").json()["logins"][0]
    assert hist["success"] and hist["notifications"][0]["status"] == "sent"


def test_wrong_password_is_refused_and_recorded(env):
    env.user()
    tc, r = env.login(password="not-the-password")
    assert r.status_code == 401 and code_of(r) == "invalid_credentials"
    _, unknown = env.login(email="nobody@example.org")
    assert unknown.status_code == 401 and code_of(unknown) == "invalid_credentials"   # same answer for both
    rows = env.svc.history(limit=10)
    assert [x["reason"] for x in rows] == ["unknown_user", "bad_password"] and not any(x["success"] for x in rows)


def test_lockout_after_repeated_failures_even_with_the_right_password(env):
    env.user()
    for _ in range(4):
        assert env.login(password="wrong-one")[1].status_code == 401
    _, r = env.login(password="wrong-one")
    assert r.status_code == 423 and code_of(r) == "account_locked" and int(r.headers["retry-after"]) > 800
    assert env.login()[1].status_code == 423
    env.tick(minutes=16)
    assert env.login()[1].status_code == 200


def test_unverified_email_and_pending_accounts_cannot_sign_in(env):
    uid = env.user()
    env.svc.db.run("UPDATE users SET email_verified_at = NULL WHERE id = ?", (uid,))
    _, r = env.login()
    assert r.status_code == 403 and code_of(r) == "email_unverified"
    env.svc.db.run("UPDATE users SET email_verified_at = ?, status = 'pending' WHERE id = ?", (env.svc.ts(), uid))
    env.svc.s.require_approval = True
    assert code_of(env.login()[1]) == "account_pending"
    env.svc.db.run("UPDATE users SET status = 'deactivated' WHERE id = ?", (uid,))
    assert code_of(env.login()[1]) == "account_deactivated"


def test_cross_site_requests_and_missing_csrf_token_are_refused(env):
    env.user()
    evil = env.client().post("/api/auth/login", json={"identifier": "officer@dncc.gov.bd", "password": PASSWORD},
                             headers={"origin": "https://evil.example"})
    assert evil.status_code == 403 and code_of(evil) == "bad_origin"
    tc, _ = env.login()
    token = tc.headers.pop("x-csrf-token")
    r = tc.post("/api/account/password", json={"current_password": PASSWORD, "new_password": "Another-Strong-Pass-9"})
    assert r.status_code == 403 and code_of(r) == "csrf_failed"
    tc.headers["x-csrf-token"] = token
    assert tc.post("/api/account/password", json={"current_password": PASSWORD,
                                                  "new_password": "Another-Strong-Pass-9"}).status_code == 200


# ------------------------------------------------------------------------------------------------ sessions
def test_logout_revokes_the_session(env):
    env.user()
    tc, _ = env.login()
    cookie = tc.cookies.get("dw_session")
    assert tc.post("/api/auth/logout").json() == {"ok": True}
    assert tc.get("/api/auth/me").status_code == 401
    replay = env.client()
    replay.cookies.set("dw_session", cookie)     # an old cookie copied before logout is dead too
    assert replay.get("/api/auth/me").status_code == 401


def test_idle_and_absolute_session_expiry(env):
    env.user()
    tc, _ = env.login()
    env.tick(minutes=59)
    assert tc.get("/api/auth/me").status_code == 200       # activity slides the idle timeout
    env.tick(minutes=59)
    assert tc.get("/api/auth/me").status_code == 200
    env.tick(minutes=61)
    r = tc.get("/api/auth/me")
    assert r.status_code == 401 and code_of(r) == "not_authenticated"
    tc2, _ = env.login(remember=True)
    env.tick(days=29)
    assert tc2.get("/api/auth/me").status_code == 200
    env.tick(days=2)
    assert tc2.get("/api/auth/me").status_code == 401


def test_revoked_sessions_stop_working_everywhere(env):
    env.user()
    laptop, _ = env.login()
    phone, _ = env.login(ip="203.0.113.9")
    sessions = phone.get("/api/account/sessions").json()["sessions"]
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    other = next(s["id"] for s in sessions if not s["current"])
    assert phone.delete(f"/api/account/sessions/{other}").json()["current"] is False
    assert laptop.get("/api/auth/me").status_code == 401 and phone.get("/api/auth/me").status_code == 200
    phone.post("/api/account/sessions/revoke-all", json={"include_current": True})
    assert phone.get("/api/auth/me").status_code == 401


# ------------------------------------------------------------------------------------------------ roles
def test_protected_api_needs_a_session(env):
    """Every API route except health, sign-in and provider callbacks refuses an anonymous caller."""
    open_paths = {"/api/health", "/api/auth/config", "/api/auth/logout"}
    tc = env.client()
    checked = 0

    def walk(routes):  # FastAPI 0.165 keeps an included router as one nested entry
        for r in routes:
            sub = getattr(r, "original_router", None)
            yield from walk(sub.routes) if sub is not None else [r]

    for route in walk(main.app.routes):
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in open_paths or path.startswith("/api/auth/") and not path.startswith(
                ("/api/auth/me", "/api/auth/reauth")):
            continue
        url = re.sub(r"\{[^}]+\}", "1", path)
        for method in route.methods - {"HEAD"}:
            if method == "GET" and path.startswith(("/api/locations", "/api/hospitals")):
                continue  # Area Intelligence is readable by anyone (AREA_PUBLIC); its write routes are checked below
            r = tc.request(method, url, json={})
            assert r.status_code == 401, (method, path, r.status_code)
            checked += 1
    assert checked >= 40


def test_role_restrictions_are_enforced_by_the_api(env):
    env.user()
    env.user(email="viewer@x.org", role="viewer", phone="+8801711000002")
    env.user(email="analyst@x.org", role="analyst", phone="+8801711000003")
    env.user(email="field@x.org", role="field", phone="+8801711000004", assigned_wards='["DNCC_Ward_01"]')
    allowed = lambda r: r.status_code not in (401, 403)  # noqa: E731 - handlers need the model store, not loaded here
    viewer, _ = env.login("viewer@x.org")
    assert viewer.get("/api/predict/template?ward=DNCC_Ward_01").status_code == 403
    assert viewer.get("/api/ops/plan").status_code == 403
    assert viewer.post("/api/alerts/1/status", json={"status": "resolved"}).status_code == 403
    assert viewer.get("/api/admin/users").status_code == 403
    assert allowed(viewer.get("/api/meta"))
    analyst, _ = env.login("analyst@x.org")
    assert allowed(analyst.get("/api/performance?ward=DNCC_Ward_01"))
    assert analyst.get("/api/ops/plan").status_code == 403
    assert analyst.get("/api/admin/logins").status_code == 403
    field, _ = env.login("field@x.org")
    r = field.get("/api/ward/DNCC_Ward_02")
    assert r.status_code == 403 and code_of(r) == "ward_not_assigned"
    assert allowed(field.get("/api/ward/DNCC_Ward_01"))
    assert field.get("/api/ops/dispatch").status_code == 403
    officer, _ = env.login()
    assert officer.get("/api/admin/users").status_code == 403 and allowed(officer.get("/api/ops/plan"))


def test_sign_up_needs_only_a_mobile_number_and_password(env):
    tc = env.client()
    r = tc.post("/api/auth/register", json={"phone": "01712345678", "password": "rainy-season-7"})
    assert r.status_code == 201 and r.json()["status"] == "ok" and r.json()["home"] == "/"
    assert tc.cookies.get("dw_session")                       # signed in straight away
    tc.headers["x-csrf-token"] = r.json()["csrf"]
    me = tc.get("/api/auth/me").json()["user"]
    assert me["phone"] == "+8801712345678" and me["role"] == "officer" and me["status"] == "active" and me["email"] is None
    assert tc.get("/api/ops/plan").status_code not in (401, 403)   # every dashboard page...
    assert tc.get("/api/admin/users").status_code == 403           # ...but no administration
    # signs in again later with the same two fields, in either number format
    for typed in ("01712345678", "+8801712345678", "8801712345678"):
        assert env.login(typed, "rainy-season-7")[1].json()["status"] == "ok", typed


def test_sign_up_refuses_duplicates_weak_passwords_and_admin_role(env):
    tc = env.client()
    tc.post("/api/auth/register", json={"phone": "01712345678", "password": "rainy-season-7"})
    tc = env.client()
    assert code_of(tc.post("/api/auth/register", json={"phone": "+8801712345678", "password": "another-pass-9"})) == "phone_taken"
    assert code_of(tc.post("/api/auth/register", json={"phone": "1234567", "password": "another-pass-9"})) == "invalid_phone"
    for weak, rule in (("short", "too_short"), ("password1", "too_common"), ("aaaaaaaaaa", "too_common"),
                       ("01812345678", "too_common")):
        r = tc.post("/api/auth/register", json={"phone": "01812345678", "password": weak})
        assert code_of(r) == "weak_password" and rule in r.json()["detail"]["rules"], weak
    r = tc.post("/api/auth/register", json={"phone": "01812345678", "password": "rainy-season-7", "role": "admin"})
    assert r.status_code == 422 and code_of(r) == "role_not_allowed"


def test_default_role_setting_can_never_grant_admin(tmp_path):
    e = Env(tmp_path, default_role="admin")
    try:
        tc = e.client()
        r = tc.post("/api/auth/register", json={"phone": "01712345678", "password": "rainy-season-7"})
        assert r.json()["user"]["role"] == "viewer"
    finally:
        e.svc.notifier.flush()
        set_service(None)


def test_approval_mode_still_available(tmp_path):
    e = Env(tmp_path, require_approval=True)
    try:
        e.user(email="admin@x.org", role="admin", phone="+8801711000009")
        tc = e.client()
        r = tc.post("/api/auth/register", json={"phone": "01712345678", "password": "rainy-season-7"})
        assert r.json()["status"] == "pending" and not tc.cookies.get("dw_session")
        assert code_of(e.login("01712345678", "rainy-season-7")[1]) == "account_pending"
        admin, _ = e.login("admin@x.org")
        pending = admin.get("/api/admin/users?status=pending").json()["users"]
        assert [u["phone"] for u in pending] == ["+88017*****678"]
        assert admin.patch(f"/api/admin/users/{pending[0]['id']}", json={"status": "active"}).json()["status"] == "active"
        assert e.login("01712345678", "rainy-season-7")[1].json()["status"] == "ok"
        actions = [x["action"] for x in admin.get("/api/admin/audit").json()["events"]]
        assert "user_approved" in actions and "register" in actions
    finally:
        e.svc.notifier.flush()
        set_service(None)


def test_no_dead_end_without_an_email_provider(tmp_path):
    """Accounts from the old sign-up (pending, email never verified) can sign in when the server cannot send email."""
    e = Env(tmp_path, providers=("sms",))
    try:
        uid = e.user()
        e.svc.db.run("UPDATE users SET email_verified_at = NULL, status = 'pending' WHERE id = ?", (uid,))
        tc, r = e.login("01711000001")
        assert r.status_code == 200 and r.json()["status"] == "ok"
        assert e.svc.user(uid)["status"] == "active"
        assert "auto_activated" in [x["action"] for x in e.svc.audit_log()]
    finally:
        e.svc.notifier.flush()
        set_service(None)


def test_admin_created_pending_accounts_are_not_auto_activated(env):
    uid = env.user()
    env.svc.db.run("UPDATE users SET status = 'pending', created_by = ? WHERE id = ?", (uid, uid))
    assert code_of(env.login()[1]) == "account_pending"


def test_email_accounts_still_need_a_verified_email(env):
    uid = env.user()
    env.svc.db.run("UPDATE users SET email_verified_at = NULL WHERE id = ?", (uid,))
    assert code_of(env.login()[1]) == "email_unverified"


def test_admins_cannot_lock_themselves_out(env):
    uid = env.user(email="admin@x.org", role="admin", phone="+8801711000009")
    admin, _ = env.login("admin@x.org")
    r = admin.patch(f"/api/admin/users/{uid}", json={"role": "viewer"})
    assert r.status_code == 409 and code_of(r) == "cannot_change_self"
    env.tick(minutes=11)   # sensitive admin changes need a recent password check
    other = env.user(email="o@x.org", role="officer", phone="+8801711000010")
    r = admin.patch(f"/api/admin/users/{other}", json={"role": "analyst"})
    assert r.status_code == 401 and code_of(r) == "reauth_required"
    assert admin.post("/api/auth/reauth", json={"password": PASSWORD}).status_code == 200
    assert admin.patch(f"/api/admin/users/{other}", json={"role": "analyst"}).json()["role"] == "analyst"


def test_invitation_flow(env):
    env.user(email="admin@x.org", role="admin", phone="+8801711000009")
    admin, _ = env.login("admin@x.org")
    r = admin.post("/api/admin/users", json={"full_name": "Karim Hasan", "email": "karim@dncc.gov.bd", "role": "officer"})
    code = r.json()["invite_code"]
    assert re.fullmatch(r"[A-Z2-9]{5}-[A-Z2-9]{5}", code)
    assert code not in str(env.svc.db.all("SELECT * FROM invitations"))
    tc = env.client()
    bad = tc.post("/api/auth/invite/accept", json={"email": "karim@dncc.gov.bd", "code": "AAAAA-AAAAA", "password": PASSWORD})
    assert code_of(bad) == "invite_invalid"
    ok = tc.post("/api/auth/invite/accept", json={"email": "karim@dncc.gov.bd", "code": code.lower(), "password": PASSWORD})
    assert ok.json() == {"ok": True}
    assert env.login("karim@dncc.gov.bd")[1].json()["user"]["role"] == "officer"
    again = tc.post("/api/auth/invite/accept", json={"email": "karim@dncc.gov.bd", "code": code, "password": PASSWORD})
    assert code_of(again) == "invite_invalid"


# ------------------------------------------------------------------------------------------------ one-time codes
def two_step(env):
    env.user(otp_login=1)
    return env.login()


def test_two_step_login_with_a_code(env):
    tc, r = two_step(env)
    body = r.json()
    assert body["status"] == "otp_required" and body["channel"] == "sms" and body["sent_to"].startswith("+88017")
    assert "dw_session" not in tc.cookies
    code = env.fakes["sms"].last_code()
    assert re.fullmatch(r"\d{6}", code) and "login code is " + code in env.fakes["sms"].sent[-1]["text"]
    r = tc.post("/api/auth/login/otp/verify", json={"challenge": body["challenge"], "code": code})
    assert r.json()["status"] == "ok" and tc.cookies.get("dw_session")


def test_codes_are_stored_only_as_keyed_hashes(env):
    two_step(env)
    code = env.fakes["sms"].last_code()
    with sqlite3.connect(env.svc.s.db_path) as c:
        dump = "\n".join(c.iterdump())
    assert code not in dump and PASSWORD not in dump


def test_incorrect_code_then_too_many_attempts(env):
    tc, r = two_step(env)
    ch = r.json()["challenge"]
    good = env.fakes["sms"].last_code()
    wrong = f"{(int(good) + 1) % 1000000:06d}"
    left = []
    for _ in range(4):
        r = tc.post("/api/auth/login/otp/verify", json={"challenge": ch, "code": wrong})
        assert code_of(r) == "otp_incorrect"
        left.append(r.json()["detail"]["attempts_left"])
    assert left == [4, 3, 2, 1]
    assert code_of(tc.post("/api/auth/login/otp/verify", json={"challenge": ch, "code": wrong})) == "otp_too_many"
    assert code_of(tc.post("/api/auth/login/otp/verify", json={"challenge": ch, "code": good})) == "otp_too_many"


def test_expired_code(env):
    tc, r = two_step(env)
    env.tick(seconds=301)
    r = tc.post("/api/auth/login/otp/verify", json={"challenge": r.json()["challenge"], "code": env.fakes["sms"].last_code()})
    assert code_of(r) == "otp_expired"


def test_resend_cooldown_and_old_codes_stop_working(env):
    tc, r = two_step(env)
    ch, first = r.json()["challenge"], env.fakes["sms"].last_code()
    r = tc.post("/api/auth/login/otp/resend", json={"challenge": ch})
    assert r.status_code == 429 and code_of(r) == "otp_cooldown" and 0 < int(r.headers["retry-after"]) <= 61
    env.tick(seconds=61)
    assert tc.post("/api/auth/login/otp/resend", json={"challenge": ch}).status_code == 200
    second = env.fakes["sms"].last_code()
    if second != first:
        assert code_of(tc.post("/api/auth/login/otp/verify", json={"challenge": ch, "code": first})) in ("otp_incorrect",)
    assert tc.post("/api/auth/login/otp/verify", json={"challenge": ch, "code": second}).json()["status"] == "ok"


def test_codes_cannot_be_reused(env):
    env.user()
    c = Client(ip="203.0.113.5")
    env.svc.issue_code("verify_phone", "+8801799999999", "sms", None, c)
    code = env.fakes["sms"].last_code()
    env.svc.check_code("verify_phone", "+8801799999999", code)
    with pytest.raises(Exception) as e:
        env.svc.check_code("verify_phone", "+8801799999999", code)
    assert e.value.code == "otp_used"


def test_code_requests_are_rate_limited(env):
    c = Client(ip="198.51.100.1")
    for _ in range(5):
        env.svc.issue_code("verify_phone", "+8801788888888", "sms", None, c)
        env.tick(seconds=61)
    with pytest.raises(Exception) as e:
        env.svc.issue_code("verify_phone", "+8801788888888", "sms", None, c)
    assert e.value.code == "otp_rate_limited"


def test_unverified_phone_gets_no_codes_or_alerts(env):
    env.user(verified_phone=False)
    tc, r = env.login()
    assert r.json()["status"] == "ok"
    r = tc.put("/api/account/otp-login", json={"enabled": True})
    assert r.status_code == 409 and code_of(r) == "phone_unverified"
    anon = env.client()
    r = anon.post("/api/auth/login/otp/request", json={"identifier": "officer@dncc.gov.bd", "channel": "sms"})
    assert r.json()["status"] == "otp_required"        # same answer as for a real account...
    r = anon.post("/api/auth/login/otp/verify", json={"challenge": r.json()["challenge"], "code": "123456"})
    assert code_of(r) == "otp_incorrect"               # ...but nothing was sent and nothing can pass
    env.svc.notifier.flush()
    assert not [m for m in env.fakes["sms"].sent if m["event"] == "otp"]
    notes = tc.get("/api/account/logins").json()["logins"][0]["notifications"]
    assert notes == [{"event": "login", "channel": "sms", "status": "skipped", "detail": "phone_unverified"}]


def test_phone_verification_from_the_profile(env):
    env.user(verified_phone=False)
    tc, _ = env.login()
    r = tc.post("/api/account/phone/request", json={"phone": "+8801711000001", "channel": "sms"})
    assert r.status_code == 200
    r = tc.post("/api/account/phone/confirm", json={"phone": "+8801711000001", "code": env.fakes["sms"].last_code()})
    assert r.json()["phone_verified"] is True


def test_password_reset_by_email(env):
    env.user()
    old, _ = env.login()
    tc = env.client()
    assert tc.post("/api/auth/password/forgot", json={"identifier": "officer@dncc.gov.bd", "channel": "email"}).json()["accepted"]
    assert tc.post("/api/auth/password/forgot", json={"identifier": "ghost@x.org", "channel": "email"}).json()["accepted"]
    code = env.fakes["email"].last_code()
    assert len(env.fakes["email"].sent) == 1          # nothing sent for the unknown address
    token = tc.post("/api/auth/password/verify", json={"identifier": "officer@dncc.gov.bd", "code": code}).json()["reset_token"]
    weak = tc.post("/api/auth/password/reset", json={"reset_token": token, "password": "short"})
    assert code_of(weak) == "weak_password"
    assert tc.post("/api/auth/password/reset", json={"reset_token": token, "password": "New-Strong-Pass-77"}).json()["ok"]
    assert code_of(tc.post("/api/auth/password/reset", json={"reset_token": token, "password": "Other-Strong-Pass-8"})) == "reset_expired"
    assert old.get("/api/auth/me").status_code == 401   # every old session ended
    assert env.login()[1].status_code == 401
    assert env.login(password="New-Strong-Pass-77")[1].status_code == 200
    env.svc.notifier.flush()
    assert any(m["event"] == "password_change" for m in env.fakes["sms"].sent)


# ------------------------------------------------------------------------------------------------ notifications
def test_provider_not_configured_is_reported_not_faked(tmp_path):
    e = Env(tmp_path, providers=("email",))
    try:
        e.user(otp_login=1)
        _, r = e.login()
        assert r.status_code == 503 and code_of(r) == "otp_unavailable"   # never skip a required second step
        r = e.client().post("/api/auth/login/otp/request", json={"identifier": "officer@dncc.gov.bd", "channel": "sms"})
        assert r.status_code == 503 and code_of(r) == "channel_unavailable"
        assert e.client().get("/api/auth/config").json()["channels"] == {"sms": False, "whatsapp": False, "email": True}
        e.svc.db.run("UPDATE users SET otp_login = 0")
        tc, r = e.login()
        assert r.json()["status"] == "ok"
        e.svc.notifier.flush()
        notes = tc.get("/api/account/logins").json()["logins"][0]["notifications"]
        assert notes[0]["status"] == "skipped" and notes[0]["detail"] == "provider_not_configured"
    finally:
        e.svc.notifier.flush()
        set_service(None)


@pytest.mark.parametrize("channel", ["sms", "whatsapp"])
@pytest.mark.parametrize("mode", ["raise", "reject"])
def test_provider_failure_never_breaks_a_login(env, channel, mode):
    uid = env.user()
    env.svc.db.run("UPDATE notification_prefs SET sms_login = ?, whatsapp_login = ?, whatsapp_consent_at = ? WHERE user_id = ?",
                   (int(channel == "sms"), int(channel == "whatsapp"), env.svc.ts(), uid))
    env.fakes[channel].fail = mode
    tc, r = env.login()
    assert r.status_code == 200 and r.json()["status"] == "ok"
    env.svc.notifier.flush()
    note = tc.get("/api/account/logins").json()["logins"][0]["notifications"][0]
    assert note["channel"] == channel and note["status"] == "failed"
    assert "gateway down" not in (note["detail"] or "")      # internals stay out of the record


@pytest.mark.parametrize("channel", ["sms", "whatsapp"])
def test_failed_code_delivery_is_an_error_and_the_code_is_void(env, channel):
    uid = env.user(otp_login=1)
    env.svc.db.run("UPDATE notification_prefs SET channel = ?, whatsapp_consent_at = ? WHERE user_id = ?",
                   (channel, env.svc.ts(), uid))
    env.fakes[channel].fail = "raise"
    _, r = env.login(channel=channel)
    assert r.status_code == 502 and code_of(r) == "send_failed" and r.json()["detail"]["channel"] == channel
    assert env.svc.db.one("SELECT COUNT(*) AS n FROM otp_codes WHERE invalidated_at IS NULL")["n"] == 0


def test_whatsapp_needs_consent_and_essential_alerts_stay_on(env):
    env.user()
    tc, _ = env.login()
    r = tc.put("/api/account/notifications", json={"whatsapp_login": True, "channel": "whatsapp", "sms_login": False,
                                                   "password_change": False})
    p = r.json()
    assert p["whatsapp_login"] is False and p["channel"] == "sms"      # no consent: WhatsApp stays off
    assert p["password_change"] is True and "password_change" in p["essential"]
    p = tc.put("/api/account/notifications", json={"whatsapp_consent": True, "whatsapp_login": True}).json()
    assert p["whatsapp_login"] and p["whatsapp_consent"]
    env.fakes["sms"].sent.clear()
    env.fakes["whatsapp"].sent.clear()
    env.login(tc=tc)                                  # same browser, so a plain login alert
    env.svc.notifier.flush()
    assert [m["event"] for m in env.fakes["whatsapp"].sent] == ["login"] and env.fakes["sms"].sent == []
    wa = env.fakes["whatsapp"].sent[0]["text"]
    assert wa.startswith("Dengue Watch Security Notification\nHello Nusrat Jahan,") and "Device: " in wa
    tc.put("/api/account/notifications", json={"whatsapp_consent": False})
    assert tc.get("/api/account/notifications").json()["whatsapp_login"] is False


def test_new_device_from_a_new_network_is_flagged_suspicious(env):
    env.user()
    env.login(ip="203.0.113.5")                         # first sign-in ever: a normal login alert
    env.svc.notifier.flush()
    assert env.fakes["sms"].sent[-1]["event"] == "login"
    env.login(ip="198.51.100.77")                       # new browser (no device cookie) on an unseen network
    env.svc.notifier.flush()
    assert env.fakes["sms"].sent[-1]["event"] == "suspicious_login"
    assert "unusual sign-in" in env.fakes["sms"].sent[-1]["text"]
    rows = env.svc.history(limit=1)
    assert rows[0]["suspicious"] and rows[0]["new_device"]


def test_delivery_status_callbacks_are_signed_and_never_go_backwards(env, monkeypatch):
    env.user()
    env.login()
    env.svc.notifier.flush()
    env.svc.s.public_base_url = "https://watch.example.org"
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tw-token")
    msg_id = env.fakes["sms"].sent and env.svc.db.one("SELECT provider_message_id FROM notifications")["provider_message_id"]
    url = "https://watch.example.org/api/auth/hooks/twilio"

    def post(status, sign=True):
        params = {"MessageSid": msg_id, "MessageStatus": status}
        sig = nt.base64.b64encode(nt.hmac.new(b"tw-token", (url + "".join(k + params[k] for k in sorted(params))).encode(),
                                              nt.hashlib.sha1).digest()).decode() if sign else "bad"
        return env.client().post("/api/auth/hooks/twilio", data=params, headers={"x-twilio-signature": sig})

    assert post("delivered", sign=False).status_code == 403
    assert env.svc.db.one("SELECT status FROM notifications")["status"] == "sent"
    assert post("delivered").status_code == 204
    assert post("sent").status_code == 204
    assert env.svc.db.one("SELECT status, detail FROM notifications") == {"status": "delivered", "detail": "delivered"}


def test_message_templates_in_both_languages():
    when = nt.when_params(T0, "bn", "Asia/Dhaka")
    assert when == {"date": "২৭ নভেম্বর ২০২৬", "time": "সকাল ১০:৩০"}
    otp = Message("otp", "bn", {"purpose": "login", "minutes": 5}, code="482913").text("sms")
    assert "482913" in otp and "৫ মিনিটের" in otp
    for lang in ("en", "bn"):
        for event in ("login", "new_device", "suspicious_login", "password_change", "account_update"):
            p = {**nt.when_params(T0, lang, "Asia/Dhaka"), "name": "Nusrat", "device": "Chrome on Android", "what": "phone"}
            for ch in ("sms", "whatsapp"):
                text = Message(event, lang, p).text(ch)
                assert "{" not in text and "None" not in text and len(text) > 40
