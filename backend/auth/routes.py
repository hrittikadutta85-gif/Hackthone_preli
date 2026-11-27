"""HTTP routes for sign-in, own account, administration and provider delivery callbacks."""
from __future__ import annotations

import json
from typing import Annotated, Literal
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from .deps import client, current, optional_principal, require
from .notify import META_STATUS, TWILIO_STATUS, env, meta_signature_ok, twilio_signature_ok
from .service import AuthError, Client, Principal, get_service

router = APIRouter()
Lang = Literal["en", "bn"]
PhoneChannel = Literal["sms", "whatsapp"]
AnyChannel = Literal["sms", "whatsapp", "email"]
Text = Annotated[str, Field(max_length=200)]
Code = Annotated[str, Field(min_length=1, max_length=12)]
Password = Annotated[str, Field(min_length=1, max_length=128)]
Ident = Annotated[str, Field(min_length=1, max_length=254)]

# ward ids known to the forecasting store; main.py fills this in at start-up
known_wards: dict[str, set[str] | None] = {"ids": None}


def svc():
    return get_service()


def error_response(e: AuthError) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if e.extra.get("retry_after"):
        headers["Retry-After"] = str(e.extra["retry_after"])
    return JSONResponse({"detail": {"code": e.code, "message": e.message, **e.extra}}, e.status, headers=headers)


def secure_cookie(request: Request) -> bool:
    mode = svc().s.cookie_secure
    if mode in ("true", "1", "yes"):
        return True
    if mode in ("false", "0", "no"):
        return False
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    return proto == "https"


def set_session_cookies(request: Request, response: Response, result: dict):
    s = svc().s
    secure = secure_cookie(request)
    response.set_cookie(s.cookie_name, result["session"], httponly=True, secure=secure, samesite=s.cookie_samesite,
                        path="/", max_age=s.remember_days * 86400 if result["remember"] else None)
    response.set_cookie(s.device_cookie, result["device_id"], httponly=True, secure=secure, samesite=s.cookie_samesite,
                        path="/", max_age=400 * 86400)


def clear_session_cookie(request: Request, response: Response):
    s = svc().s
    response.delete_cookie(s.cookie_name, path="/", secure=secure_cookie(request), httponly=True, samesite=s.cookie_samesite)


def login_reply(request: Request, response: Response, result: dict) -> dict:
    if result.get("status") == "ok":
        set_session_cookies(request, response, result)
        return {"status": "ok", "user": result["user"], "csrf": result["csrf"], "home": result["home"]}
    return result


# ================================================================================================ sign-in
@router.get("/api/auth/config")
def auth_config():
    return svc().public_config()


@router.get("/api/auth/me")
def me(p: Principal = Depends(current)):
    s = svc()
    return {"user": s.view(p.user), "csrf": s.csrf_for(p.session["token_hash"]),
            "session": {"id": p.session["id"], "expires_at": p.session["expires_at"],
                        "absolute_expires_at": p.session["absolute_expires_at"], "remember": bool(p.session["remember"])}}


class Register(BaseModel):
    phone: Annotated[str, Field(min_length=6, max_length=24)]
    full_name: Annotated[str, Field(max_length=120)] = ""
    email: Annotated[str, Field(max_length=254)] | None = None
    password: Password
    organization: Text = ""
    designation: Text = ""
    username: Annotated[str, Field(max_length=32)] | None = None
    role: Literal["officer", "analyst", "field", "viewer", "admin"] = "viewer"
    accept_terms: bool = True  # the sign-up page states that creating an account accepts the terms
    whatsapp_consent: bool = False
    phone_channel: PhoneChannel = "sms"
    lang: Lang = "en"


@router.post("/api/auth/register", status_code=201)
def register(body: Register, request: Request, response: Response, c: Client = Depends(client)):
    data = body.model_dump()
    data["email"] = (data.get("email") or "").strip() or None
    return login_reply(request, response, svc().register(data, c))


class VerifyRequest(BaseModel):
    email: Ident
    kind: Literal["email", "phone"]
    channel: AnyChannel = "email"
    lang: Lang = "en"


@router.post("/api/auth/verify/request")
def verify_request(body: VerifyRequest, c: Client = Depends(client)):
    return svc().request_verification(body.email, body.kind, body.channel, c, body.lang)


class VerifyConfirm(BaseModel):
    email: Ident
    kind: Literal["email", "phone"]
    code: Code


@router.post("/api/auth/verify/confirm")
def verify_confirm(body: VerifyConfirm, c: Client = Depends(client)):
    return svc().confirm_verification(body.email, body.kind, body.code, c)


class Login(BaseModel):
    identifier: Ident
    password: Password
    remember: bool = False
    channel: PhoneChannel | None = None


@router.post("/api/auth/login")
def login(body: Login, request: Request, response: Response, c: Client = Depends(client)):
    return login_reply(request, response, svc().login(body.identifier, body.password, body.remember, c, body.channel))


class OtpLogin(BaseModel):
    identifier: Ident
    channel: PhoneChannel = "sms"
    lang: Lang = "en"


@router.post("/api/auth/login/otp/request")
def otp_login_request(body: OtpLogin, c: Client = Depends(client)):
    return svc().otp_login_request(body.identifier, body.channel, c, body.lang)


class OtpVerify(BaseModel):
    challenge: Annotated[str, Field(min_length=10, max_length=100)]
    code: Code


@router.post("/api/auth/login/otp/verify")
def otp_login_verify(body: OtpVerify, request: Request, response: Response, c: Client = Depends(client)):
    return login_reply(request, response, svc().login_verify(body.challenge, body.code, c))


class OtpResend(BaseModel):
    challenge: Annotated[str, Field(min_length=10, max_length=100)]
    channel: PhoneChannel | None = None


@router.post("/api/auth/login/otp/resend")
def otp_login_resend(body: OtpResend, c: Client = Depends(client)):
    return svc().login_resend(body.challenge, body.channel, c)


@router.post("/api/auth/logout")
def logout(request: Request, response: Response, c: Client = Depends(client),
           p: Principal | None = Depends(optional_principal)):
    if p:
        svc().logout(p, c)
    clear_session_cookie(request, response)
    return {"ok": True}


class Reauth(BaseModel):
    password: Password


@router.post("/api/auth/reauth")
def reauth(body: Reauth, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().reauth(p, body.password, c)


class Forgot(BaseModel):
    identifier: Ident
    channel: AnyChannel = "email"
    lang: Lang = "en"


@router.post("/api/auth/password/forgot")
def password_forgot(body: Forgot, c: Client = Depends(client)):
    return svc().forgot_password(body.identifier, body.channel, c, body.lang)


class ResetVerify(BaseModel):
    identifier: Ident
    code: Code


@router.post("/api/auth/password/verify")
def password_verify(body: ResetVerify, c: Client = Depends(client)):
    return svc().verify_reset(body.identifier, body.code, c)


class Reset(BaseModel):
    reset_token: Annotated[str, Field(min_length=10, max_length=100)]
    password: Password


@router.post("/api/auth/password/reset")
def password_reset(body: Reset, c: Client = Depends(client)):
    return svc().reset_password(body.reset_token, body.password, c)


class Accept(BaseModel):
    email: Ident
    code: Annotated[str, Field(min_length=6, max_length=20)]
    password: Password


@router.post("/api/auth/invite/accept")
def invite_accept(body: Accept, c: Client = Depends(client)):
    return svc().accept_invitation(body.email, body.code, body.password, c)


# ================================================================================================ own account
class Profile(BaseModel):
    full_name: Annotated[str, Field(max_length=120)] | None = None
    organization: Text | None = None
    designation: Text | None = None
    username: Annotated[str, Field(max_length=32)] | None = None
    lang: Lang | None = None


@router.get("/api/account/profile")
def profile(p: Principal = Depends(current)):
    return svc().view(p.user)


@router.patch("/api/account/profile")
def profile_update(body: Profile, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().update_profile(p, body.model_dump(exclude_none=True), c)


class PasswordChange(BaseModel):
    current_password: Password
    new_password: Password


@router.post("/api/account/password")
def password_change(body: PasswordChange, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().change_password(p, body.current_password, body.new_password, c)


class PhoneRequest(BaseModel):
    phone: Annotated[str, Field(min_length=6, max_length=24)]
    channel: PhoneChannel = "sms"


@router.post("/api/account/phone/request")
def phone_request(body: PhoneRequest, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().phone_request(p, body.phone, body.channel, c)


class PhoneConfirm(BaseModel):
    phone: Annotated[str, Field(min_length=6, max_length=24)]
    code: Code


@router.post("/api/account/phone/confirm")
def phone_confirm(body: PhoneConfirm, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().phone_confirm(p, body.phone, body.code, c)


class OtpSetting(BaseModel):
    enabled: bool


@router.put("/api/account/otp-login")
def otp_setting(body: OtpSetting, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().set_otp_login(p, body.enabled, c)


class Prefs(BaseModel):
    sms_login: bool | None = None
    whatsapp_login: bool | None = None
    new_device: bool | None = None
    password_change: bool | None = None
    security: bool | None = None
    channel: PhoneChannel | None = None
    whatsapp_consent: bool | None = None


@router.get("/api/account/notifications")
def prefs(p: Principal = Depends(current)):
    return svc().prefs_view(p.id)


@router.put("/api/account/notifications")
def prefs_update(body: Prefs, p: Principal = Depends(current), c: Client = Depends(client)):
    return svc().update_prefs(p, body.model_dump(), c)


@router.get("/api/account/logins")
def my_logins(p: Principal = Depends(current), limit: Annotated[int, Query(ge=1, le=500)] = 100):
    return {"logins": svc().history(p.id, limit)}


@router.get("/api/account/deliveries")
def my_deliveries(p: Principal = Depends(current), limit: Annotated[int, Query(ge=1, le=500)] = 100):
    return {"deliveries": svc().deliveries(p.id, limit)}


@router.get("/api/account/sessions")
def my_sessions(p: Principal = Depends(current)):
    return {"sessions": svc().sessions(p.id, p.session["id"])}


@router.delete("/api/account/sessions/{session_id}")
def end_session(session_id: int, request: Request, response: Response, p: Principal = Depends(current),
                c: Client = Depends(client)):
    s = svc()
    if not s.db.one("SELECT 1 AS k FROM sessions WHERE id = ? AND user_id = ?", (session_id, p.id)):
        raise AuthError(404, "session_not_found", "No such session.")
    s.revoke(session_id, "ended_by_user")
    s.audit("session_ended", p.id, p.id, c, session=session_id)
    if session_id == p.session["id"]:
        clear_session_cookie(request, response)
    return {"ok": True, "current": session_id == p.session["id"]}


class RevokeAll(BaseModel):
    include_current: bool = True


@router.post("/api/account/sessions/revoke-all")
def end_all_sessions(body: RevokeAll, request: Request, response: Response, p: Principal = Depends(current),
                     c: Client = Depends(client)):
    s = svc()
    n = s.revoke_all(p.id, "signed_out_everywhere", keep=None if body.include_current else p.session["id"])
    s.audit("signed_out_everywhere", p.id, p.id, c, sessions=n)
    s.notify_security(p.user, "account_update", "sessions", c)
    if body.include_current:
        clear_session_cookie(request, response)
    return {"ended": n}


# ================================================================================================ administration
Admin = Annotated[Principal, Depends(require("users.manage"))]
Security = Annotated[Principal, Depends(require("security.view"))]


@router.get("/api/admin/users")
def admin_users(_: Admin, status: Literal["pending", "active", "deactivated"] | None = None,
                role: str | None = None, q: Annotated[str | None, Query(max_length=80)] = None):
    return {"users": svc().list_users(status, role, q)}


class NewUser(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=120)]
    email: Annotated[str, Field(max_length=254)] | None = None
    phone: Annotated[str, Field(max_length=24)] | None = None
    organization: Text = ""
    designation: Text = ""
    role: Literal["admin", "officer", "analyst", "field", "viewer"] = "viewer"
    assigned_wards: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=200)
    lang: Lang = "en"


@router.post("/api/admin/users", status_code=201)
def admin_create(body: NewUser, p: Admin, c: Client = Depends(client)):
    data = body.model_dump()
    data["phone"] = data["phone"] or None
    data["email"] = (data["email"] or "").strip() or None
    return svc().admin_create(p, data, c, known_wards["ids"])


class UserChange(BaseModel):
    role: Literal["admin", "officer", "analyst", "field", "viewer"] | None = None
    status: Literal["active", "deactivated"] | None = None
    assigned_wards: list[Annotated[str, Field(max_length=40)]] | None = Field(None, max_length=200)
    confirm_email: bool = False


@router.patch("/api/admin/users/{user_id}")
def admin_update(user_id: int, body: UserChange, p: Admin, c: Client = Depends(client)):
    return svc().admin_update(p, user_id, body.model_dump(), c, known_wards["ids"])


@router.post("/api/admin/users/{user_id}/unlock")
def admin_unlock(user_id: int, p: Admin, c: Client = Depends(client)):
    svc().admin_unlock(p, user_id, c)
    return {"ok": True}


@router.post("/api/admin/users/{user_id}/revoke-sessions")
def admin_revoke(user_id: int, p: Admin, c: Client = Depends(client)):
    s = svc()
    n = s.revoke_all(user_id, "ended_by_admin", keep=p.session["id"] if user_id == p.id else None)
    s.audit("sessions_ended_by_admin", p.id, user_id, c, sessions=n)
    return {"ended": n}


@router.post("/api/admin/users/{user_id}/invite")
def admin_invite(user_id: int, p: Admin, c: Client = Depends(client)):
    return svc().admin_invite(p, user_id, c)


@router.get("/api/admin/logins")
def admin_logins(_: Security, user_id: int | None = None, outcome: Literal["success", "failed"] | None = None,
                 suspicious: bool = False, limit: Annotated[int, Query(ge=1, le=1000)] = 200):
    success = None if outcome is None else outcome == "success"
    return {"logins": svc().history(user_id, limit, success, suspicious)}


@router.get("/api/admin/sessions")
def admin_sessions(_: Security):
    return {"sessions": svc().all_sessions()}


@router.delete("/api/admin/sessions/{session_id}")
def admin_end_session(session_id: int, p: Admin, c: Client = Depends(client)):
    s = svc()
    row = s.db.one("SELECT user_id FROM sessions WHERE id = ?", (session_id,))
    if not row:
        raise AuthError(404, "session_not_found", "No such session.")
    s.revoke(session_id, "ended_by_admin")
    s.audit("session_ended_by_admin", p.id, row["user_id"], c, session=session_id)
    return {"ok": True}


@router.get("/api/admin/audit")
def admin_audit(_: Security, action: Annotated[str | None, Query(max_length=60)] = None,
                limit: Annotated[int, Query(ge=1, le=1000)] = 200):
    return {"events": svc().audit_log(limit, action)}


@router.get("/api/admin/deliveries")
def admin_deliveries(_: Security, limit: Annotated[int, Query(ge=1, le=1000)] = 200):
    return {"deliveries": svc().deliveries(None, limit)}


@router.get("/api/admin/providers")
def admin_providers(_: Security):
    s = svc()
    return {"providers": s.notifier.available(), "status_callbacks": s.s.public_base_url.startswith("https://"),
            "essential_events": s.s.essential_events, "require_otp_roles": s.s.require_otp_roles,
            "public_registration": s.s.public_registration}


# ================================================================================================ provider callbacks
@router.post("/api/auth/hooks/twilio")
async def twilio_status(request: Request):
    """Twilio StatusCallback for SMS and WhatsApp. Signed with the auth token; unsigned calls are rejected."""
    s = svc()
    token = env("TWILIO_AUTH_TOKEN")
    raw = (await request.body()).decode()
    params = dict(parse_qsl(raw, keep_blank_values=True))
    url = f"{s.s.public_base_url}/api/auth/hooks/twilio"
    if not token or not twilio_signature_ok(url, params, request.headers.get("x-twilio-signature", ""), token):
        return PlainTextResponse("invalid signature", 403)
    sid, word = params.get("MessageSid", ""), params.get("MessageStatus", "").lower()
    status = TWILIO_STATUS.get(word)
    if sid and status:
        detail = word + (f" (error {params['ErrorCode']})" if params.get("ErrorCode") else "")
        s.notifier.update_status(sid, status, detail)
    return PlainTextResponse("", 204)


@router.get("/api/auth/hooks/whatsapp")
def whatsapp_verify(mode: Annotated[str, Query(alias="hub.mode")] = "",
                    verify_token: Annotated[str, Query(alias="hub.verify_token")] = "",
                    challenge: Annotated[str, Query(alias="hub.challenge", max_length=200)] = ""):
    """Meta's one-time webhook verification handshake."""
    expected = env("WHATSAPP_VERIFY_TOKEN")
    if mode == "subscribe" and expected and verify_token == expected:
        return PlainTextResponse(challenge)
    return PlainTextResponse("forbidden", 403)


@router.post("/api/auth/hooks/whatsapp")
async def whatsapp_status(request: Request):
    """WhatsApp Cloud API webhook: message status updates (sent, delivered, read, failed)."""
    secret = env("WHATSAPP_APP_SECRET")
    raw = await request.body()
    if not secret or not meta_signature_ok(raw, request.headers.get("x-hub-signature-256", ""), secret):
        return PlainTextResponse("invalid signature", 403)
    try:
        body = json.loads(raw)
    except ValueError:
        return PlainTextResponse("bad request", 400)
    s = svc()
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            for st in change.get("value", {}).get("statuses", []):
                status = META_STATUS.get(str(st.get("status", "")).lower())
                if st.get("id") and status:
                    errors = st.get("errors") or [{}]
                    detail = st["status"] + (f" (error {errors[0].get('code')})" if errors[0].get("code") else "")
                    s.notifier.update_status(st["id"], status, detail)
    return PlainTextResponse("", 200)
