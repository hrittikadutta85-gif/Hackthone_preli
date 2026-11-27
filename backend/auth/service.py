"""Account logic: registration, login, one-time codes, sessions, password reset, invitations, profile, admin.

Everything that touches a secret goes through security.py; everything that sends a message goes through notify.py.
Errors are raised as AuthError(status, code); the frontend shows a translated sentence for each code.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import rbac
from .config import Settings, load_settings
from .db import Database, iso, parse
from .notify import Message, Notifier, when_params
from .security import (code_hash, device_label, hash_password, mask_email, mask_phone, new_code, normalise_email,
                       normalise_phone, password_problems, same, sha256, token, verify_password, USERNAME_RE)

PHONE_CHANNELS = ("sms", "whatsapp")
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, so a code read aloud is not misheard


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str = "", **extra):
        super().__init__(message or code)
        self.status, self.code, self.message, self.extra = status, code, message or code, extra


@dataclass
class Client:
    """Who is asking: taken from the request by routes.py, never from the request body."""
    ip: str | None = None
    user_agent: str | None = None
    device_id: str | None = None
    location: str | None = None


@dataclass
class Principal:
    user: dict
    session: dict

    @property
    def id(self) -> int:
        return self.user["id"]

    @property
    def role(self) -> str:
        return self.user["role"]

    def can(self, perm: str) -> bool:
        return rbac.can(self.role, perm)

    def wards(self) -> list[str] | None:
        """Wards this user is limited to, or None for every ward."""
        return json.loads(self.user["assigned_wards"] or "[]") if self.role in rbac.WARD_SCOPED else None


def ip_prefix(ip: str | None) -> str:
    try:
        a = ipaddress.ip_address(ip or "")
    except ValueError:
        return ""
    net = ipaddress.ip_network(f"{a}/{24 if a.version == 4 else 48}", strict=False)
    return str(net)


class AuthService:
    def __init__(self, settings: Settings | None = None, providers: dict | None = None, clock=None):
        self.s = settings or load_settings()
        self.db = Database(self.s.db_path)
        self.notifier = Notifier(self.db, self.s, providers)
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    # ------------------------------------------------------------------------------------------- helpers
    def now(self) -> datetime:
        return self.clock()

    def ts(self, delta: timedelta = timedelta()) -> str:
        return iso(self.now() + delta)

    def audit(self, action: str, actor: int | None = None, target: int | None = None, client: Client | None = None,
              **detail):
        self.db.run("INSERT INTO audit_log(at, actor_id, action, target_user_id, ip, detail) VALUES (?,?,?,?,?,?)",
                    (self.ts(), actor, action, target, client.ip if client else None,
                     json.dumps(detail, ensure_ascii=False, default=str)))

    def user(self, user_id: int) -> dict | None:
        return self.db.one("SELECT * FROM users WHERE id = ?", (user_id,))

    def find(self, identifier: str) -> dict | None:
        ident = (identifier or "").strip()
        if not ident:
            return None
        if "@" in ident:
            email = normalise_email(ident)
            return self.db.one("SELECT * FROM users WHERE email = ?", (email,)) if email else None
        row = self.db.one("SELECT * FROM users WHERE username = ?", (ident,)) if USERNAME_RE.match(ident) else None
        if row is None:
            phone = normalise_phone(ident)
            row = self.db.one("SELECT * FROM users WHERE phone = ?", (phone,)) if phone else None
        return row

    def prefs(self, user_id: int) -> dict:
        row = self.db.one("SELECT * FROM notification_prefs WHERE user_id = ?", (user_id,))
        if row is None:
            self.db.run("INSERT OR IGNORE INTO notification_prefs(user_id, updated_at) VALUES (?, ?)", (user_id, self.ts()))
            row = self.db.one("SELECT * FROM notification_prefs WHERE user_id = ?", (user_id,))
        return row

    def view(self, u: dict, private: bool = True) -> dict:
        """A user as the API shows it. Never includes the password hash or lockout counters."""
        out = {"id": u["id"], "email": u["email"], "username": u["username"], "full_name": u["full_name"],
               "organization": u["organization"], "designation": u["designation"], "role": u["role"],
               "requested_role": u["requested_role"], "status": u["status"],
               "email_verified": bool(u["email_verified_at"]), "phone_verified": bool(u["phone_verified_at"]),
               "otp_login": bool(u["otp_login"]), "assigned_wards": json.loads(u["assigned_wards"] or "[]"),
               "lang": u["lang"], "created_at": u["created_at"], "last_login_at": u["last_login_at"],
               "phone": u["phone"] if private else mask_phone(u["phone"]),
               "locked": bool(u["locked_until"] and u["locked_until"] > self.ts())}
        out["permissions"] = sorted(rbac.permissions(u["role"]))
        out["home"] = rbac.HOME.get(u["role"], "/")
        return out

    def check_password(self, password: str, email: str | None = "", name: str = "", phone: str | None = ""):
        issues = password_problems(password, self.s.password_min_length, email or "", name or "", phone or "")
        if issues:
            raise AuthError(422, "weak_password", "The password does not meet the rules.", rules=issues,
                            min_length=self.s.password_min_length)

    def public_config(self) -> dict:
        ch = self.notifier.available()
        return {"public_registration": self.s.public_registration, "allow_otp_login": self.s.allow_otp_login,
                "channels": {k: v["available"] for k, v in ch.items()},
                "password_min_length": self.s.password_min_length, "otp_expiry_seconds": self.s.otp_expiry_seconds,
                "otp_resend_seconds": self.s.otp_resend_seconds,
                "self_service_roles": [r for r, v in rbac.ROLES.items() if v["self_service"]],
                "require_email_verification": self.s.require_email_verification,
                "require_approval": self.s.require_approval}

    # ------------------------------------------------------------------------------------------- users
    def _check_unique(self, email: str | None, phone: str | None, username: str | None, exclude: int | None = None):
        def taken(col, val):
            return val and self.db.one(f"SELECT id FROM users WHERE {col} = ? AND id != ?", (val, exclude or -1))
        if taken("email", email):
            raise AuthError(409, "email_taken", "An account with this email already exists.")
        if taken("phone", phone):
            raise AuthError(409, "phone_taken", "An account with this phone number already exists.")
        if taken("username", username):
            raise AuthError(409, "username_taken", "This username is taken.")

    def _clean_identity(self, email: str | None, phone: str | None, username: str | None) -> tuple[str | None, str | None, str | None]:
        e = None
        if email:
            e = normalise_email(email)
            if not e:
                raise AuthError(422, "invalid_email", "Enter a valid email address.")
        p = None
        if phone:
            p = normalise_phone(phone)
            if not p:
                raise AuthError(422, "invalid_phone", "Enter a valid mobile number with its country code.")
        u = (username or "").strip() or None
        if u and (not USERNAME_RE.match(u) or u.isdigit()):
            raise AuthError(422, "invalid_username", "Usernames use 3-32 letters, digits, dot, dash or underscore.")
        return e, p, u

    def _insert_user(self, *, email, full_name, phone, username, organization, designation, role, status,
                     requested_role=None, password=None, created_by=None, email_verified=False, terms=False,
                     lang="en") -> int:
        now = self.ts()
        with self.db.tx() as c:
            self._check_unique(email, phone, username)
            cur = c.execute(
                "INSERT INTO users(email, username, full_name, phone, organization, designation, role, requested_role, "
                "status, password_hash, password_changed_at, email_verified_at, terms_accepted_at, created_by, lang, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (email, username, (full_name or "").strip(), phone, organization.strip(), designation.strip(), role,
                 requested_role, status, hash_password(password) if password else None, now if password else None,
                 now if email_verified and email else None, now if terms else None, created_by, lang, now, now))
            c.execute("INSERT INTO notification_prefs(user_id, updated_at) VALUES (?, ?)", (cur.lastrowid, now))
            return cur.lastrowid

    def register(self, data: dict, client: Client) -> dict:
        """Public sign-up with a mobile number and a password. The account gets AUTH_DEFAULT_ROLE (Public Health
        Officer: every dashboard page, no administration) and can sign in straight away. With AUTH_REQUIRE_APPROVAL
        it waits for an administrator instead."""
        if not self.s.public_registration:
            raise AuthError(403, "registration_closed", "Accounts are created by an administrator.")
        role = data.get("role") or "viewer"
        if role not in rbac.ROLES or not rbac.ROLES[role]["self_service"]:
            raise AuthError(422, "role_not_allowed", "This role can only be given by an administrator.")
        if not data.get("accept_terms"):
            raise AuthError(422, "terms_required", "Please accept the terms and privacy notice.")
        email, phone, username = self._clean_identity(data.get("email"), data.get("phone"), data.get("username"))
        if not phone:
            raise AuthError(422, "invalid_phone", "Enter a valid mobile number with its country code.")
        name = (data.get("full_name") or "").strip()
        self.check_password(data["password"], email, name, phone)
        status = "pending" if self.s.require_approval else "active"
        start = self.s.default_role if self.s.default_role in rbac.ROLES and rbac.ROLES[self.s.default_role]["self_service"]             else "viewer"  # never admin, whatever the setting says
        uid = self._insert_user(email=email, full_name=name, phone=phone, username=username,
                                organization=data.get("organization") or "", designation=data.get("designation") or "",
                                role=start, requested_role=None, status=status,
                                password=data["password"], terms=True, lang=data.get("lang", "en"))
        self.audit("register", uid, uid, client, requested_role=role)
        if data.get("whatsapp_consent"):
            self.db.run("UPDATE notification_prefs SET whatsapp_consent_at = ? WHERE user_id = ?", (self.ts(), uid))
            self.audit("whatsapp_consent_given", uid, uid, client)
        if status == "active":  # signed in at once; phone and email can be verified later from the profile
            out = self.finish_login(self.user(uid), "register", False, client, phone)
            out["status"] = "ok"
            return out
        verification = {"email": self._try_code(uid, "verify_email", "email", email, client, data.get("lang", "en"))
                        if email else "none"}
        channel = data.get("phone_channel") or "sms"
        if channel == "whatsapp" and not data.get("whatsapp_consent"):
            channel = "sms"
        verification["phone"] = self._try_code(uid, "verify_phone", channel, phone, client, data.get("lang", "en"))
        return {"status": "pending", "verification": verification, "email": mask_email(email),
                "phone": mask_phone(phone), "approval_required": True}

    def _try_code(self, uid, purpose, channel, target, client, lang) -> str:
        """Send a code if the channel works; report what happened instead of failing the whole request."""
        if not self.notifier.has(channel):
            return "unavailable"
        try:
            self.issue_code(purpose, target, channel, uid, client, lang=lang)
            return "sent"
        except AuthError as e:
            return "failed" if e.code == "send_failed" else e.code

    # ------------------------------------------------------------------------------------------- one-time codes
    def issue_code(self, purpose: str, target: str, channel: str, user_id: int | None, client: Client,
                   challenge_id: int | None = None, lang: str = "en") -> dict:
        if not self.notifier.has(channel):
            raise AuthError(503, "channel_unavailable", f"Sending by {channel} is not set up on this server.",
                            channel=channel)
        now = self.now()
        with self.db.tx() as c:
            last = c.execute("SELECT created_at FROM otp_codes WHERE target = ? AND purpose = ? AND invalidated_at IS NULL "
                             "ORDER BY id DESC LIMIT 1", (target, purpose)).fetchone()
            if last:
                wait = self.s.otp_resend_seconds - (now - parse(last["created_at"])).total_seconds()
                if wait > 0:
                    raise AuthError(429, "otp_cooldown", "Please wait before asking for another code.",
                                    retry_after=int(wait) + 1)
            hour = iso(now - timedelta(hours=1))
            n_target = c.execute("SELECT COUNT(*) FROM otp_codes WHERE target = ? AND created_at > ?", (target, hour)).fetchone()[0]
            n_ip = c.execute("SELECT COUNT(*) FROM otp_codes WHERE ip = ? AND created_at > ?", (client.ip, hour)).fetchone()[0] \
                if client.ip else 0
            if n_target >= self.s.otp_per_target_hour or n_ip >= self.s.otp_per_ip_hour:
                raise AuthError(429, "otp_rate_limited", "Too many codes requested. Try again later.", retry_after=3600)
            c.execute("UPDATE otp_codes SET invalidated_at = ? WHERE target = ? AND purpose = ? AND consumed_at IS NULL "
                      "AND invalidated_at IS NULL", (iso(now), target, purpose))
            code = new_code()
            rid = c.execute("INSERT INTO otp_codes(purpose, channel, target, user_id, challenge_id, code_hash, created_at, "
                            "expires_at, ip) VALUES (?,?,?,?,?,?,?,?,?)",
                            (purpose, channel, target, user_id, challenge_id,
                             code_hash(self.s.secret_key, purpose, target, code), iso(now),
                             iso(now + timedelta(seconds=self.s.otp_expiry_seconds)), client.ip)).lastrowid
        name = (self.user(user_id) or {}).get("full_name", "") if user_id else ""
        msg = Message("otp", lang, {"purpose": purpose, "minutes": max(1, self.s.otp_expiry_seconds // 60), "name": name},
                      code=code)
        res = self.notifier.send(user_id=user_id, channel=channel, to=target, message=msg)
        del code
        if res["status"] != "sent":
            self.db.run("UPDATE otp_codes SET invalidated_at = ? WHERE id = ?", (self.ts(), rid))
            raise AuthError(502, "send_failed", "The code could not be sent. Try again or use another channel.",
                            channel=channel)
        return {"channel": channel, "sent_to": mask_email(target) if channel == "email" else mask_phone(target),
                "expires_in": self.s.otp_expiry_seconds, "resend_in": self.s.otp_resend_seconds}

    def check_code(self, purpose: str, target: str, code: str, challenge_id: int | None = None) -> dict:
        code = (code or "").strip()
        error: AuthError | None = None
        with self.db.tx() as c:
            sql = "SELECT * FROM otp_codes WHERE target = ? AND purpose = ?"
            args: list = [target, purpose]
            if challenge_id is not None:
                sql += " AND challenge_id = ?"
                args.append(challenge_id)
            row = c.execute(sql + " ORDER BY id DESC LIMIT 1", args).fetchone()
            now = self.ts()
            if row is None or row["invalidated_at"] and row["attempts"] < self.s.otp_max_attempts:
                error = AuthError(400, "otp_invalid", "That code is not valid. Ask for a new one.")
            elif row["consumed_at"]:
                error = AuthError(400, "otp_used", "That code has already been used. Ask for a new one.")
            elif row["attempts"] >= self.s.otp_max_attempts:
                error = AuthError(400, "otp_too_many", "Too many wrong codes. Ask for a new one.")
            elif row["expires_at"] <= now:
                error = AuthError(400, "otp_expired", "That code has expired. Ask for a new one.")
            elif not (len(code) == 6 and code.isdigit()
                      and same(row["code_hash"], code_hash(self.s.secret_key, purpose, target, code))):
                attempts = row["attempts"] + 1
                c.execute("UPDATE otp_codes SET attempts = ?, invalidated_at = CASE WHEN ? >= ? THEN ? END WHERE id = ?",
                          (attempts, attempts, self.s.otp_max_attempts, now, row["id"]))
                left = self.s.otp_max_attempts - attempts
                error = AuthError(400, "otp_incorrect" if left > 0 else "otp_too_many",
                                  "That code is not right." if left > 0 else "Too many wrong codes. Ask for a new one.",
                                  attempts_left=max(left, 0))
            else:
                c.execute("UPDATE otp_codes SET consumed_at = ? WHERE id = ?", (now, row["id"]))
        if error:  # raised after the transaction commits, so the failed attempt is counted
            raise error
        return dict(row)

    # ------------------------------------------------------------------------------------------- verification
    def request_verification(self, email: str, kind: str, channel: str, client: Client, lang: str = "en") -> dict:
        """Codes for an account that is not signed in yet. The answer is the same whether or not the account exists."""
        if kind == "email":
            channel = "email"
        if not self.notifier.has(channel):
            raise AuthError(503, "channel_unavailable", f"Sending by {channel} is not set up on this server.", channel=channel)
        u = self.find(email) if "@" in (email or "") else None
        out = {"accepted": True, "expires_in": self.s.otp_expiry_seconds, "resend_in": self.s.otp_resend_seconds}
        if not u or u["status"] == "deactivated":
            return out
        target = u["email"] if kind == "email" else u["phone"]
        done = u["email_verified_at"] if kind == "email" else u["phone_verified_at"]
        if channel == "whatsapp" and not self.prefs(u["id"])["whatsapp_consent_at"]:
            raise AuthError(409, "no_whatsapp_consent", "WhatsApp messages need your consent first.")
        if target and not done:
            self.issue_code(f"verify_{kind}", target, channel, u["id"], client, lang=lang)
        return out

    def confirm_verification(self, email: str, kind: str, code: str, client: Client) -> dict:
        u = self.find(email) if "@" in (email or "") else None
        if not u:
            raise AuthError(400, "otp_invalid", "That code is not valid. Ask for a new one.")
        target = u["email"] if kind == "email" else u["phone"]
        self.check_code(f"verify_{kind}", target, code)
        col = "email_verified_at" if kind == "email" else "phone_verified_at"
        self.db.run(f"UPDATE users SET {col} = ?, updated_at = ? WHERE id = ?", (self.ts(), self.ts(), u["id"]))
        self.audit(f"verify_{kind}", u["id"], u["id"], client)
        u = self.user(u["id"])
        return {"verified": kind, "status": u["status"], "email_verified": bool(u["email_verified_at"]),
                "phone_verified": bool(u["phone_verified_at"])}

    # ------------------------------------------------------------------------------------------- login
    def _history(self, user_id, identifier, client: Client, success, reason, method, new_device=False,
                 suspicious=False, session_id=None) -> int:
        return self.db.run(
            "INSERT INTO login_history(user_id, identifier, at, ip, user_agent, device, location, success, reason, method, "
            "new_device, suspicious, session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (user_id, (identifier or "")[:120], self.ts(), client.ip, (client.user_agent or "")[:300],
             device_label(client.user_agent), client.location, int(success), reason, method, int(new_device),
             int(suspicious), session_id)).lastrowid

    def _ip_guard(self, client: Client):
        if not client.ip:
            return
        since = self.ts(timedelta(minutes=-15))
        n = self.db.one("SELECT COUNT(*) AS n FROM login_history WHERE ip = ? AND success = 0 AND at > ?",
                        (client.ip, since))["n"]
        if n >= self.s.ip_failures_15min:
            raise AuthError(429, "too_many_attempts", "Too many failed attempts from this network. Try again later.",
                            retry_after=900)

    def _locked(self, u: dict) -> int:
        if u["locked_until"] and u["locked_until"] > self.ts():
            return int((parse(u["locked_until"]) - self.now()).total_seconds()) + 1
        return 0

    def _failed(self, u: dict, client: Client) -> int:
        """Count a wrong password; lock the account after too many, for longer each time. Returns lock seconds."""
        fails = u["failed_logins"] + 1
        if fails < self.s.lockout_threshold:
            self.db.run("UPDATE users SET failed_logins = ? WHERE id = ?", (fails, u["id"]))
            return 0
        lock_count = u["lock_count"] + 1
        minutes = min(self.s.lockout_minutes * 2 ** (lock_count - 1), 24 * 60)
        self.db.run("UPDATE users SET failed_logins = 0, lock_count = ?, locked_until = ? WHERE id = ?",
                    (lock_count, self.ts(timedelta(minutes=minutes)), u["id"]))
        self.audit("account_locked", None, u["id"], client, minutes=minutes)
        return minutes * 60

    def _email_ok(self, u: dict) -> bool:
        """An email must be verified only when the account has one AND this server can send email codes; never
        demand a step that cannot be completed."""
        return (not self.s.require_email_verification or not u["email"] or bool(u["email_verified_at"])
                or not self.notifier.has("email"))

    def _auto_activate(self, u: dict, client: Client) -> dict:
        """Self-registered accounts no longer wait for approval (unless AUTH_REQUIRE_APPROVAL). Accounts created
        under the old rule are activated at their next sign-in, and the change is recorded."""
        if u["status"] == "pending" and not self.s.require_approval and u["created_by"] is None:
            self.db.run("UPDATE users SET status = 'active', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
                        (self.ts(), self.ts(), u["id"]))
            self.audit("auto_activated", None, u["id"], client, reason="self-registration needs no approval")
            return self.user(u["id"])
        return u

    def _status_gate(self, u: dict, client: Client, identifier: str, method: str):
        reason = None
        if u["status"] == "deactivated":
            reason, err = "deactivated", AuthError(403, "account_deactivated", "This account has been deactivated.")
        elif not self._email_ok(u):
            reason, err = "email_unverified", AuthError(403, "email_unverified", "Verify your email address first.",
                                                        email=u["email"])
        elif u["status"] == "pending":
            reason, err = "pending", AuthError(403, "account_pending", "An administrator has not approved this account yet.")
        if reason:
            self._history(u["id"], identifier, client, False, reason, method)
            raise err

    def _needs_otp(self, u: dict) -> bool:
        return bool(u["otp_login"]) or u["role"] in self.s.require_otp_roles

    def _phone_channels(self, u: dict) -> list[str]:
        """Channels that can carry a code to this user right now."""
        if not (u["phone"] and u["phone_verified_at"]):
            return []
        prefs = self.prefs(u["id"])
        out = [ch for ch in PHONE_CHANNELS if self.notifier.has(ch)
               and (ch != "whatsapp" or prefs["whatsapp_consent_at"])]
        return sorted(out, key=lambda ch: ch != prefs["channel"])

    def _challenge(self, user_id: int | None, method: str, remember: bool, client: Client) -> tuple[str, int]:
        raw = token()
        cid = self.db.run("INSERT INTO login_challenges(token_hash, user_id, method, remember, created_at, expires_at, ip) "
                          "VALUES (?,?,?,?,?,?,?)",
                          (sha256(raw), user_id, method, int(remember), self.ts(),
                           self.ts(timedelta(seconds=self.s.otp_expiry_seconds + 300)), client.ip)).lastrowid
        return raw, cid

    def login(self, identifier: str, password: str, remember: bool, client: Client, channel: str | None = None) -> dict:
        self._ip_guard(client)
        u = self.find(identifier)
        if u:
            wait = self._locked(u)
            if wait:
                self._history(u["id"], identifier, client, False, "locked", "password")
                raise AuthError(423, "account_locked", "Too many failed attempts. Try again later.", retry_after=wait)
        ok, new_hash = verify_password(u["password_hash"] if u else None, password)
        if not ok:
            self._history(u["id"] if u else None, identifier, client, False, "bad_password" if u else "unknown_user",
                          "password")
            if u:
                wait = self._failed(u, client)
                if wait:
                    raise AuthError(423, "account_locked", "Too many failed attempts. Try again later.", retry_after=wait)
            raise AuthError(401, "invalid_credentials", "The email/username or password is not right.")
        if new_hash:
            self.db.run("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, u["id"]))
        u = self._auto_activate(u, client)
        self._status_gate(u, client, identifier, "password")
        self.db.run("UPDATE users SET failed_logins = 0 WHERE id = ?", (u["id"],))
        if not self._needs_otp(u):
            return self.finish_login(u, "password", remember, client, identifier)
        channels = self._phone_channels(u)
        if not channels:
            # Never skip a required second step: without a verified phone and a working channel, refuse.
            self._history(u["id"], identifier, client, False, "otp_unavailable", "password+otp")
            raise AuthError(503, "otp_unavailable", "Two-step login is required but no code can be sent right now.")
        raw, cid = self._challenge(u["id"], "password+otp", remember, client)
        use = channel if channel in channels else channels[0]
        sent = self.issue_code("login", u["phone"], use, u["id"], client, challenge_id=cid, lang=u["lang"])
        return {"status": "otp_required", "challenge": raw, "channels": channels, **sent}

    def otp_login_request(self, identifier: str, channel: str, client: Client, lang: str = "en") -> dict:
        """Passwordless login with a code sent to the account's verified phone. Same answer for unknown accounts."""
        if not self.s.allow_otp_login:
            raise AuthError(403, "otp_login_disabled", "Login with a one-time code is turned off.")
        if channel not in PHONE_CHANNELS or not self.notifier.has(channel):
            raise AuthError(503, "channel_unavailable", f"Sending by {channel} is not set up on this server.", channel=channel)
        self._ip_guard(client)
        u = self.find(identifier)
        usable = u and u["status"] == "active" and channel in self._phone_channels(u) and not self._locked(u) \
            and self._email_ok(u)
        raw, cid = self._challenge(u["id"] if usable else None, "otp", False, client)
        if usable:
            self.issue_code("login", u["phone"], channel, u["id"], client, challenge_id=cid, lang=u["lang"] or lang)
        return {"status": "otp_required", "challenge": raw, "channels": [channel], "channel": channel,
                "expires_in": self.s.otp_expiry_seconds, "resend_in": self.s.otp_resend_seconds}

    def _open_challenge(self, raw: str) -> dict:
        ch = self.db.one("SELECT * FROM login_challenges WHERE token_hash = ?", (sha256(raw or ""),))
        if not ch or ch["consumed_at"] or ch["expires_at"] <= self.ts():
            raise AuthError(400, "challenge_expired", "This sign-in attempt has expired. Start again.")
        return ch

    def login_verify(self, raw: str, code: str, client: Client) -> dict:
        self._ip_guard(client)
        ch = self._open_challenge(raw)
        u = self.user(ch["user_id"]) if ch["user_id"] else None
        if not u or not u["phone"]:
            self._history(None, "(one-time code)", client, False, "otp_failed", ch["method"])
            raise AuthError(400, "otp_incorrect", "That code is not right.", attempts_left=None)
        try:
            self.check_code("login", u["phone"], code, challenge_id=ch["id"])
        except AuthError:
            self._history(u["id"], u["email"], client, False, "otp_failed", ch["method"])
            raise
        self.db.run("UPDATE login_challenges SET consumed_at = ? WHERE id = ?", (self.ts(), ch["id"]))
        u = self._auto_activate(self.user(u["id"]), client)
        self._status_gate(u, client, u["email"] or u["phone"], ch["method"])
        return self.finish_login(u, ch["method"], bool(ch["remember"]), client, u["email"])

    def login_resend(self, raw: str, channel: str | None, client: Client) -> dict:
        ch = self._open_challenge(raw)
        u = self.user(ch["user_id"]) if ch["user_id"] else None
        channels = self._phone_channels(u) if u else []
        use = channel if channel in channels else (channels[0] if channels else channel or "sms")
        if not self.notifier.has(use):
            raise AuthError(503, "channel_unavailable", f"Sending by {use} is not set up on this server.", channel=use)
        out = {"channel": use, "expires_in": self.s.otp_expiry_seconds, "resend_in": self.s.otp_resend_seconds}
        if u:
            out = self.issue_code("login", u["phone"], use, u["id"], client, challenge_id=ch["id"], lang=u["lang"])
        return {"status": "otp_required", "channels": channels or [use], **out}

    def finish_login(self, u: dict, method: str, remember: bool, client: Client, identifier: str) -> dict:
        device_id = client.device_id or token()
        dhash = sha256(device_id)
        label = device_label(client.user_agent)
        now = self.ts()
        known = self.db.one("SELECT 1 AS k FROM known_devices WHERE user_id = ? AND device_hash = ?", (u["id"], dhash))
        first = self.db.one("SELECT COUNT(*) AS n FROM login_history WHERE user_id = ? AND success = 1", (u["id"],))["n"] == 0
        new_device = not known
        suspicious = False
        if new_device and not first:
            since = self.ts(timedelta(days=-90))
            seen = {ip_prefix(r["ip"]) for r in self.db.all(
                "SELECT DISTINCT ip FROM login_history WHERE user_id = ? AND success = 1 AND at > ?", (u["id"], since))}
            recent_fails = self.db.one("SELECT COUNT(*) AS n FROM login_history WHERE user_id = ? AND success = 0 AND at > ?",
                                       (u["id"], self.ts(timedelta(hours=-1))))["n"]
            suspicious = (ip_prefix(client.ip) not in seen) or recent_fails >= 3
        self.db.run("INSERT INTO known_devices(user_id, device_hash, label, first_seen_at, last_seen_at) VALUES (?,?,?,?,?) "
                    "ON CONFLICT(user_id, device_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at, label = excluded.label",
                    (u["id"], dhash, label, now, now))
        session_token, csrf, sid = self.create_session(u["id"], remember, client, dhash)
        hid = self._history(u["id"], identifier, client, True, "ok", method, new_device, suspicious, sid)
        self.db.run("UPDATE users SET last_login_at = ?, lock_count = 0, locked_until = NULL WHERE id = ?", (now, u["id"]))
        self.notify_login(u, hid, new_device and not first, suspicious, client)
        return {"status": "ok", "user": self.view(self.user(u["id"])), "session": session_token, "csrf": csrf,
                "device_id": device_id, "remember": remember, "home": rbac.HOME.get(u["role"], "/")}

    # ------------------------------------------------------------------------------------------- notifications
    def _deliver(self, u: dict, event: str, channels: list[str], params: dict, login_id: int | None = None,
                 fallback: bool = False):
        """Queue security messages; ineligible channels are recorded as skipped with the reason."""
        prefs = self.prefs(u["id"])
        base = {"name": u["full_name"], "device": params.pop("device", ""), **params}
        sent = False
        for ch in channels:
            if fallback and sent:
                break
            reason = None
            if not (u["phone"] and u["phone_verified_at"]):
                reason = "phone_unverified"
            elif ch == "whatsapp" and not prefs["whatsapp_consent_at"]:
                reason = "no_whatsapp_consent"
            elif not self.notifier.has(ch):
                reason = "provider_not_configured"
            if reason:
                self.notifier.record(u["id"], event, ch, u["phone"] or "", "skipped", reason, login_id=login_id)
                continue
            msg = Message(event, u["lang"], dict(base))
            self.notifier.send_later(user_id=u["id"], channel=ch, to=u["phone"], message=msg, login_id=login_id)
            sent = True

    def notify_login(self, u: dict, login_id: int, new_device: bool, suspicious: bool, client: Client):
        prefs = self.prefs(u["id"])
        params = {**when_params(self.now(), u["lang"], self.s.timezone), "device": device_label(client.user_agent)}
        preferred = [prefs["channel"], "whatsapp" if prefs["channel"] == "sms" else "sms"]
        if suspicious and ("suspicious_login" in self.s.essential_events or prefs["security"]):
            return self._deliver(u, "suspicious_login", preferred, params, login_id, fallback=True)
        if new_device and prefs["new_device"]:
            return self._deliver(u, "new_device", preferred, params, login_id, fallback=True)
        channels = [ch for ch, on in (("sms", prefs["sms_login"]), ("whatsapp", prefs["whatsapp_login"])) if on]
        if channels:
            self._deliver(u, "login", channels, params, login_id)

    def notify_security(self, u: dict, event: str, what: str | None = None, client: Client | None = None):
        prefs = self.prefs(u["id"])
        flag = prefs["password_change"] if event == "password_change" else prefs["security"]
        if not flag and event not in self.s.essential_events:
            return
        params = {**when_params(self.now(), u["lang"], self.s.timezone),
                  "device": device_label(client.user_agent) if client else "", "what": what or ""}
        preferred = [prefs["channel"], "whatsapp" if prefs["channel"] == "sms" else "sms"]
        self._deliver(u, event, preferred, params, fallback=True)

    # ------------------------------------------------------------------------------------------- sessions
    def create_session(self, user_id: int, remember: bool, client: Client, device_hash: str) -> tuple[str, str, int]:
        raw = token()
        now = self.now()
        absolute = now + (timedelta(days=self.s.remember_days) if remember else timedelta(hours=self.s.session_max_hours))
        idle = absolute if remember else min(now + timedelta(minutes=self.s.session_minutes), absolute)
        sid = self.db.run("INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at, "
                          "absolute_expires_at, remember, reauth_at, ip, user_agent, device_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          (sha256(raw), user_id, iso(now), iso(now), iso(idle), iso(absolute), int(remember),
                           iso(now), client.ip, (client.user_agent or "")[:300], device_hash)).lastrowid
        return raw, self.csrf_for(sha256(raw)), sid

    def authenticate(self, raw: str | None) -> Principal | None:
        if not raw:
            return None
        s = self.db.one("SELECT * FROM sessions WHERE token_hash = ?", (sha256(raw),))
        now = self.now()
        if not s or s["revoked_at"] or s["expires_at"] <= iso(now) or s["absolute_expires_at"] <= iso(now):
            return None
        u = self.user(s["user_id"])
        if not u or u["status"] != "active":
            return None
        if (now - parse(s["last_seen_at"])).total_seconds() > 60:  # slide the idle timeout, at most once a minute
            idle = parse(s["absolute_expires_at"]) if s["remember"] else \
                min(now + timedelta(minutes=self.s.session_minutes), parse(s["absolute_expires_at"]))
            self.db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", (iso(now), iso(idle), s["id"]))
            s.update(last_seen_at=iso(now), expires_at=iso(idle))
        return Principal(u, s)

    def csrf_for(self, session_token_hash: str) -> str:
        """CSRF token bound to one session: stable for its lifetime (so several tabs agree) and useless without it."""
        return hmac.new(self.s.secret_key.encode(), f"csrf|{session_token_hash}".encode(), hashlib.sha256).hexdigest()

    def check_csrf(self, p: Principal, header: str | None) -> bool:
        return bool(header) and same(self.csrf_for(p.session["token_hash"]), header)

    def revoke(self, session_id: int, reason: str):
        self.db.run("UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL",
                    (self.ts(), reason, session_id))

    def revoke_all(self, user_id: int, reason: str, keep: int | None = None) -> int:
        return self.db.run("UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL "
                           "AND id != ?", (self.ts(), reason, user_id, keep or -1)).rowcount

    def logout(self, p: Principal, client: Client):
        self.revoke(p.session["id"], "logout")
        self.audit("logout", p.id, p.id, client)

    def reauth(self, p: Principal, password: str, client: Client) -> dict:
        ok, _ = verify_password(p.user["password_hash"], password)
        if not ok:
            self.audit("reauth_failed", p.id, p.id, client)
            wait = self._failed(p.user, client)
            if wait:
                self.revoke_all(p.id, "locked")
                raise AuthError(423, "account_locked", "Too many failed attempts. Try again later.", retry_after=wait)
            raise AuthError(401, "invalid_password", "That password is not right.")
        self.db.run("UPDATE users SET failed_logins = 0 WHERE id = ?", (p.id,))
        self.db.run("UPDATE sessions SET reauth_at = ? WHERE id = ?", (self.ts(), p.session["id"]))
        return {"ok": True, "valid_for": self.s.reauth_minutes * 60}

    def require_recent(self, p: Principal):
        last = self.db.one("SELECT reauth_at FROM sessions WHERE id = ?", (p.session["id"],))["reauth_at"]
        if not last or parse(last) < self.now() - timedelta(minutes=self.s.reauth_minutes):
            raise AuthError(401, "reauth_required", "Confirm your password to continue.")

    def sessions(self, user_id: int, current: int | None = None) -> list[dict]:
        rows = self.db.all("SELECT id, created_at, last_seen_at, expires_at, remember, ip, user_agent FROM sessions "
                           "WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND absolute_expires_at > ? "
                           "ORDER BY last_seen_at DESC", (user_id, self.ts(), self.ts()))
        return [{**r, "device": device_label(r.pop("user_agent")), "remember": bool(r["remember"]),
                 "current": r["id"] == current} for r in rows]

    # ------------------------------------------------------------------------------------------- password reset
    def forgot_password(self, identifier: str, channel: str, client: Client, lang: str = "en") -> dict:
        if not self.notifier.has(channel):
            raise AuthError(503, "channel_unavailable", f"Sending by {channel} is not set up on this server.", channel=channel)
        out = {"accepted": True, "expires_in": self.s.otp_expiry_seconds, "resend_in": self.s.otp_resend_seconds}
        u = self.find(identifier)
        if not u or u["status"] == "deactivated" or not u["password_hash"]:
            return out
        if channel == "email":
            target = u["email"]
        elif u["phone"] and u["phone_verified_at"] and (channel != "whatsapp" or self.prefs(u["id"])["whatsapp_consent_at"]):
            target = u["phone"]
        else:
            return out
        self.issue_code("reset_password", target, channel, u["id"], client, lang=u["lang"] or lang)
        return out

    def verify_reset(self, identifier: str, code: str, client: Client) -> dict:
        u = self.find(identifier)
        if not u:
            raise AuthError(400, "otp_invalid", "That code is not valid. Ask for a new one.")
        last = self.db.one("SELECT target, channel FROM otp_codes WHERE user_id = ? AND purpose = 'reset_password' "
                           "ORDER BY id DESC LIMIT 1", (u["id"],))
        if not last:
            raise AuthError(400, "otp_invalid", "That code is not valid. Ask for a new one.")
        self.check_code("reset_password", last["target"], code)
        if last["channel"] == "email" and not u["email_verified_at"]:  # the code proved they read this mailbox
            self.db.run("UPDATE users SET email_verified_at = ? WHERE id = ?", (self.ts(), u["id"]))
        raw = token()
        self.db.run("INSERT INTO password_resets(user_id, token_hash, channel, created_at, expires_at, ip) VALUES (?,?,?,?,?,?)",
                    (u["id"], sha256(raw), last["channel"], self.ts(),
                     self.ts(timedelta(minutes=self.s.reset_token_minutes)), client.ip))
        return {"reset_token": raw, "expires_in": self.s.reset_token_minutes * 60}

    def reset_password(self, raw: str, password: str, client: Client) -> dict:
        r = self.db.one("SELECT * FROM password_resets WHERE token_hash = ?", (sha256(raw or ""),))
        if not r or r["used_at"] or r["expires_at"] <= self.ts():
            raise AuthError(400, "reset_expired", "This reset has expired. Start again.")
        u = self.user(r["user_id"])
        self.check_password(password, u["email"], u["full_name"], u["phone"])
        with self.db.tx() as c:
            if c.execute("UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL",
                         (self.ts(), r["id"])).rowcount != 1:
                raise AuthError(400, "reset_expired", "This reset has expired. Start again.")
            c.execute("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, lock_count = 0, "
                      "locked_until = NULL, updated_at = ? WHERE id = ?", (hash_password(password), self.ts(), self.ts(), u["id"]))
        self.revoke_all(u["id"], "password_reset")
        self.audit("password_reset", u["id"], u["id"], client, channel=r["channel"])
        self.notify_security(self.user(u["id"]), "password_change", client=client)
        return {"ok": True}

    # ------------------------------------------------------------------------------------------- invitations
    def _invite_code(self) -> str:
        raw = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(10))
        return f"{raw[:5]}-{raw[5:]}"

    def create_invitation(self, user_id: int, actor: int | None) -> str:
        u = self.user(user_id)
        code = self._invite_code()
        self.db.run("UPDATE invitations SET expires_at = ? WHERE user_id = ? AND accepted_at IS NULL", (self.ts(), user_id))
        self.db.run("INSERT INTO invitations(user_id, code_hash, created_by, created_at, expires_at) VALUES (?,?,?,?,?)",
                    (user_id, code_hash(self.s.secret_key, "invite", str(user_id), code.replace("-", "")), actor, self.ts(),
                     self.ts(timedelta(days=self.s.invite_days))))
        return code

    def accept_invitation(self, email: str, code: str, password: str, client: Client) -> dict:
        u = self.find(email)  # email or mobile number
        inv = self.db.one("SELECT * FROM invitations WHERE user_id = ? AND accepted_at IS NULL ORDER BY id DESC LIMIT 1",
                          (u["id"],)) if u else None
        if not inv or inv["expires_at"] <= self.ts() or inv["attempts"] >= 5 or u["status"] == "deactivated":
            raise AuthError(400, "invite_invalid", "This invitation is not valid. Ask your administrator for a new one.")
        given = (code or "").upper().replace("-", "").replace(" ", "")
        if not same(inv["code_hash"], code_hash(self.s.secret_key, "invite", str(u["id"]), given)):
            self.db.run("UPDATE invitations SET attempts = attempts + 1 WHERE id = ?", (inv["id"],))
            raise AuthError(400, "invite_invalid", "This invitation is not valid. Ask your administrator for a new one.")
        self.check_password(password, u["email"], u["full_name"], u["phone"])
        now = self.ts()
        self.db.run("UPDATE invitations SET accepted_at = ? WHERE id = ?", (now, inv["id"]))
        self.db.run("UPDATE users SET password_hash = ?, password_changed_at = ?, "
                    "email_verified_at = CASE WHEN email IS NULL THEN NULL ELSE COALESCE(email_verified_at, ?) END, "
                    "updated_at = ? WHERE id = ?", (hash_password(password), now, now, now, u["id"]))
        self.audit("invitation_accepted", u["id"], u["id"], client)
        return {"ok": True}

    # ------------------------------------------------------------------------------------------- own account
    def update_profile(self, p: Principal, data: dict, client: Client) -> dict:
        fields = {k: v.strip() if isinstance(v, str) else v for k, v in data.items()
                  if k in ("full_name", "organization", "designation", "lang", "username") and v is not None}
        if "username" in fields:
            _, _, fields["username"] = self._clean_identity(p.user["email"], None, fields["username"])
            self._check_unique("", None, fields["username"], exclude=p.id)
        if fields.get("full_name") == "":
            raise AuthError(422, "name_required", "Enter your full name.")
        if not fields:
            return self.view(p.user)
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.db.run(f"UPDATE users SET {sets}, updated_at = ? WHERE id = ?", (*fields.values(), self.ts(), p.id))
        u = self.user(p.id)
        if set(fields) - {"lang"}:
            self.audit("profile_updated", p.id, p.id, client, fields=sorted(fields))
            self.notify_security(u, "account_update", "profile", client)
        return self.view(u)

    def change_password(self, p: Principal, current: str, new: str, client: Client) -> dict:
        ok, _ = verify_password(p.user["password_hash"], current)
        if not ok:
            self.audit("password_change_failed", p.id, p.id, client)
            raise AuthError(401, "invalid_password", "Your current password is not right.")
        if current == new:
            raise AuthError(422, "password_reused", "Choose a password different from the current one.")
        self.check_password(new, p.user["email"], p.user["full_name"], p.user["phone"])
        self.db.run("UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?",
                    (hash_password(new), self.ts(), self.ts(), p.id))
        ended = self.revoke_all(p.id, "password_changed", keep=p.session["id"])
        self.audit("password_changed", p.id, p.id, client, other_sessions_ended=ended)
        self.notify_security(self.user(p.id), "password_change", client=client)
        return {"ok": True, "other_sessions_ended": ended}

    def phone_request(self, p: Principal, phone: str, channel: str, client: Client) -> dict:
        new = normalise_phone(phone)
        if not new:
            raise AuthError(422, "invalid_phone", "Enter a valid mobile number with its country code.")
        if channel not in PHONE_CHANNELS:
            raise AuthError(422, "invalid_channel", "Choose SMS or WhatsApp.")
        same_number = new == p.user["phone"]
        if same_number and p.user["phone_verified_at"]:
            raise AuthError(409, "phone_already_verified", "This number is already verified.")
        if not same_number:
            self.require_recent(p)
            self._check_unique("", new, None, exclude=p.id)
        if channel == "whatsapp" and not self.prefs(p.id)["whatsapp_consent_at"]:
            raise AuthError(409, "no_whatsapp_consent", "Allow WhatsApp messages in notification settings first.")
        return self.issue_code("verify_phone" if same_number else "change_phone", new, channel, p.id, client,
                               lang=p.user["lang"])

    def phone_confirm(self, p: Principal, phone: str, code: str, client: Client) -> dict:
        new = normalise_phone(phone)
        if not new:
            raise AuthError(422, "invalid_phone", "Enter a valid mobile number with its country code.")
        same_number = new == p.user["phone"]
        row = self.check_code("verify_phone" if same_number else "change_phone", new, code)
        if row["user_id"] != p.id:
            raise AuthError(400, "otp_invalid", "That code is not valid. Ask for a new one.")
        with self.db.tx():
            if not same_number:
                self._check_unique("", new, None, exclude=p.id)
            self.db.run("UPDATE users SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?",
                        (new, self.ts(), self.ts(), p.id))
        self.audit("phone_verified" if same_number else "phone_changed", p.id, p.id, client, phone=mask_phone(new))
        if not same_number:
            old = dict(p.user)
            if old["phone"] and old["phone_verified_at"]:  # tell the old number too
                self.notify_security(old, "account_update", "phone", client)
            self.notify_security(self.user(p.id), "account_update", "phone", client)
        return self.view(self.user(p.id))

    def set_otp_login(self, p: Principal, enabled: bool, client: Client) -> dict:
        self.require_recent(p)
        if enabled and not self._phone_channels(p.user):
            raise AuthError(409, "phone_unverified" if not p.user["phone_verified_at"] else "channel_unavailable",
                            "Verify your phone and make sure SMS or WhatsApp is available first.")
        if not enabled and p.role in self.s.require_otp_roles:
            raise AuthError(409, "otp_required_by_policy", "Two-step login is required for your role.")
        self.db.run("UPDATE users SET otp_login = ?, updated_at = ? WHERE id = ?", (int(enabled), self.ts(), p.id))
        self.audit("otp_login_on" if enabled else "otp_login_off", p.id, p.id, client)
        self.notify_security(self.user(p.id), "account_update", "otp_on" if enabled else "otp_off", client)
        return self.view(self.user(p.id))

    PREF_FIELDS = ("sms_login", "whatsapp_login", "new_device", "password_change", "security")

    def prefs_view(self, user_id: int) -> dict:
        r = self.prefs(user_id)
        locked = [k for k in ("password_change",) if k in self.s.essential_events]
        if "suspicious_login" in self.s.essential_events:
            locked.append("suspicious_login")
        return {**{k: bool(r[k]) for k in self.PREF_FIELDS}, "channel": r["channel"],
                "whatsapp_consent": bool(r["whatsapp_consent_at"]), "whatsapp_consent_at": r["whatsapp_consent_at"],
                "essential": locked, "providers": {k: v["available"] for k, v in self.notifier.available().items()}}

    def update_prefs(self, p: Principal, data: dict, client: Client) -> dict:
        cur = self.prefs(p.id)
        new = {k: int(bool(data[k])) if k in data and data[k] is not None else cur[k] for k in self.PREF_FIELDS}
        consent = cur["whatsapp_consent_at"]
        if data.get("whatsapp_consent") is True and not consent:
            consent = self.ts()
        elif data.get("whatsapp_consent") is False:
            consent = None
        channel = data.get("channel") or cur["channel"]
        if channel not in PHONE_CHANNELS:
            raise AuthError(422, "invalid_channel", "Choose SMS or WhatsApp.")
        if not consent:
            new["whatsapp_login"] = 0
            if channel == "whatsapp":
                channel = "sms"
        if "password_change" in self.s.essential_events:
            new["password_change"] = 1
        self.db.run("UPDATE notification_prefs SET sms_login = ?, whatsapp_login = ?, new_device = ?, password_change = ?, "
                    "security = ?, channel = ?, whatsapp_consent_at = ?, updated_at = ? WHERE user_id = ?",
                    (*[new[k] for k in self.PREF_FIELDS], channel, consent, self.ts(), p.id))
        if bool(consent) != bool(cur["whatsapp_consent_at"]):
            self.audit("whatsapp_consent_given" if consent else "whatsapp_consent_withdrawn", p.id, p.id, client)
        self.audit("notification_prefs_updated", p.id, p.id, client)
        return self.prefs_view(p.id)

    def history(self, user_id: int | None = None, limit: int = 100, success: bool | None = None,
                suspicious: bool | None = None) -> list[dict]:
        sql = ["SELECT h.*, u.full_name, u.email FROM login_history h LEFT JOIN users u ON u.id = h.user_id WHERE 1 = 1"]
        args: list = []
        if user_id is not None:
            sql.append("AND h.user_id = ?")
            args.append(user_id)
        if success is not None:
            sql.append("AND h.success = ?")
            args.append(int(success))
        if suspicious:
            sql.append("AND h.suspicious = 1")
        rows = self.db.all(" ".join(sql) + " ORDER BY h.id DESC LIMIT ?", (*args, limit))
        ids = [r["id"] for r in rows]
        notes: dict[int, list] = {}
        if ids:
            for n in self.db.all(f"SELECT login_id, event, channel, status, detail FROM notifications WHERE login_id IN "
                                 f"({','.join('?' * len(ids))}) ORDER BY id", ids):
                notes.setdefault(n["login_id"], []).append({k: n[k] for k in ("event", "channel", "status", "detail")})
        return [{"id": r["id"], "user_id": r["user_id"], "user": r["full_name"], "email": r["email"],
                 "identifier": r["identifier"] if not r["user_id"] else None, "at": r["at"], "ip": r["ip"],
                 "device": r["device"], "location": r["location"], "success": bool(r["success"]), "reason": r["reason"],
                 "method": r["method"], "new_device": bool(r["new_device"]), "suspicious": bool(r["suspicious"]),
                 "notifications": notes.get(r["id"], [])} for r in rows]

    # ------------------------------------------------------------------------------------------- administration
    def list_users(self, status: str | None = None, role: str | None = None, q: str | None = None) -> list[dict]:
        sql, args = ["SELECT * FROM users WHERE 1 = 1"], []
        if status:
            sql.append("AND status = ?")
            args.append(status)
        if role:
            sql.append("AND role = ?")
            args.append(role)
        if q:
            sql.append("AND (full_name LIKE ? OR email LIKE ? OR organization LIKE ?)")
            args += [f"%{q}%"] * 3
        rows = self.db.all(" ".join(sql) + " ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, "
                           "created_at DESC", args)
        return [self.view(r, private=False) for r in rows]

    def _active_admins(self) -> int:
        return self.db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")["n"]

    def admin_create(self, p: Principal, data: dict, client: Client, wards_known=None) -> dict:
        self.require_recent(p)
        role = data.get("role", "viewer")
        if role not in rbac.ROLES:
            raise AuthError(422, "invalid_role", "Unknown role.")
        email, phone, username = self._clean_identity(data.get("email"), data.get("phone"), data.get("username"))
        if not email and not phone:
            raise AuthError(422, "invalid_phone", "Give a mobile number or an email address.")
        wards = self._wards(data.get("assigned_wards") or [], wards_known)
        uid = self._insert_user(email=email, full_name=data["full_name"], phone=phone, username=username,
                                organization=data.get("organization", ""), designation=data.get("designation", ""),
                                role=role, status="active", created_by=p.id, lang=data.get("lang", "en"))
        if wards:
            self.db.run("UPDATE users SET assigned_wards = ? WHERE id = ?", (json.dumps(wards), uid))
        code = self.create_invitation(uid, p.id)
        self.db.run("UPDATE users SET approved_by = ?, approved_at = ? WHERE id = ?", (p.id, self.ts(), uid))
        self.audit("user_created", p.id, uid, client, role=role)
        return {"user": self.view(self.user(uid), private=False), "invite_code": code,
                "invite_expires_days": self.s.invite_days}

    def _wards(self, wards: list[str], known) -> list[str]:
        bad = [w for w in wards if known is not None and w not in known]
        if bad:
            raise AuthError(422, "unknown_ward", f"Unknown ward: {bad[0]}")
        return sorted(set(wards))

    def admin_update(self, p: Principal, user_id: int, data: dict, client: Client, wards_known=None) -> dict:
        u = self.user(user_id)
        if not u:
            raise AuthError(404, "user_not_found", "No such user.")
        changes: dict = {}
        if data.get("role") is not None and data["role"] != u["role"]:
            if data["role"] not in rbac.ROLES:
                raise AuthError(422, "invalid_role", "Unknown role.")
            changes["role"] = data["role"]
        if data.get("status") is not None and data["status"] != u["status"]:
            if data["status"] not in ("active", "deactivated"):
                raise AuthError(422, "invalid_status", "Status must be active or deactivated.")
            changes["status"] = data["status"]
        if data.get("assigned_wards") is not None:
            wards = self._wards(data["assigned_wards"], wards_known)
            if wards != json.loads(u["assigned_wards"] or "[]"):
                changes["assigned_wards"] = json.dumps(wards)
        confirm_email = bool(data.get("confirm_email")) and not u["email_verified_at"]
        if not changes and not confirm_email:
            return self.view(u, private=False)
        self.require_recent(p)
        if user_id == p.id and ("role" in changes or changes.get("status") == "deactivated"):
            raise AuthError(409, "cannot_change_self", "You cannot change your own role or deactivate yourself.")
        losing_admin = u["role"] == "admin" and u["status"] == "active" and \
            (changes.get("role", "admin") != "admin" or changes.get("status") == "deactivated")
        if losing_admin and self._active_admins() <= 1:
            raise AuthError(409, "last_admin", "There must always be at least one active administrator.")
        if changes.get("status") == "active" and u["status"] == "pending":
            changes.setdefault("role", data.get("role") or u["requested_role"] or u["role"])
            changes.update(approved_by=p.id, approved_at=self.ts())
        if confirm_email:
            changes["email_verified_at"] = self.ts()
        sets = ", ".join(f"{k} = ?" for k in changes)
        self.db.run(f"UPDATE users SET {sets}, updated_at = ? WHERE id = ?", (*changes.values(), self.ts(), user_id))
        if changes.get("status") == "deactivated" or "role" in changes and u["status"] == "active":
            self.revoke_all(user_id, "admin_change")  # new permissions take effect at the next login
        detail = {k: v for k, v in changes.items() if k in ("role", "status", "assigned_wards")}
        action = "user_approved" if u["status"] == "pending" and changes.get("status") == "active" else "user_updated"
        self.audit(action, p.id, user_id, client, **detail, email_confirmed=confirm_email or None)
        fresh = self.user(user_id)
        if "role" in changes and u["status"] == "active":
            self.notify_security(fresh, "account_update", "role", client)
        elif "status" in changes:
            self.notify_security(fresh, "account_update", "status", client)
        return self.view(fresh, private=False)

    def admin_unlock(self, p: Principal, user_id: int, client: Client):
        self.db.run("UPDATE users SET failed_logins = 0, lock_count = 0, locked_until = NULL WHERE id = ?", (user_id,))
        self.audit("user_unlocked", p.id, user_id, client)

    def admin_invite(self, p: Principal, user_id: int, client: Client) -> dict:
        self.require_recent(p)
        u = self.user(user_id)
        if not u or u["status"] == "deactivated":
            raise AuthError(404, "user_not_found", "No such user.")
        code = self.create_invitation(user_id, p.id)
        self.audit("invitation_reissued", p.id, user_id, client)
        return {"invite_code": code, "invite_expires_days": self.s.invite_days}

    def all_sessions(self) -> list[dict]:
        rows = self.db.all("SELECT s.id, s.user_id, u.full_name, u.email, s.created_at, s.last_seen_at, s.expires_at, "
                           "s.remember, s.ip, s.user_agent FROM sessions s JOIN users u ON u.id = s.user_id "
                           "WHERE s.revoked_at IS NULL AND s.expires_at > ? AND s.absolute_expires_at > ? "
                           "ORDER BY s.last_seen_at DESC LIMIT 500", (self.ts(), self.ts()))
        return [{**r, "device": device_label(r.pop("user_agent")), "remember": bool(r["remember"])} for r in rows]

    def audit_log(self, limit: int = 200, action: str | None = None) -> list[dict]:
        sql = ("SELECT a.*, actor.full_name AS actor_name, target.full_name AS target_name FROM audit_log a "
               "LEFT JOIN users actor ON actor.id = a.actor_id LEFT JOIN users target ON target.id = a.target_user_id")
        args: list = []
        if action:
            sql += " WHERE a.action = ?"
            args.append(action)
        rows = self.db.all(sql + " ORDER BY a.id DESC LIMIT ?", (*args, limit))
        return [{**r, "detail": json.loads(r["detail"] or "{}")} for r in rows]

    def deliveries(self, user_id: int | None = None, limit: int = 200) -> list[dict]:
        sql = ("SELECT n.id, n.user_id, u.full_name AS user, n.event, n.channel, n.provider, n.target, n.status, n.detail, "
               "n.created_at, n.updated_at FROM notifications n LEFT JOIN users u ON u.id = n.user_id")
        args: list = []
        if user_id is not None:
            sql += " WHERE n.user_id = ?"
            args.append(user_id)
        return self.db.all(sql + " ORDER BY n.id DESC LIMIT ?", (*args, limit))

    # ------------------------------------------------------------------------------------------- bootstrap
    def create_admin(self, email: str, full_name: str, password: str, phone: str | None = None) -> int:
        """First administrator, from the command line (python -m backend.auth create-admin)."""
        e, ph, _ = self._clean_identity(email, phone, None)
        self.check_password(password, e, full_name, ph)
        uid = self._insert_user(email=e, full_name=full_name, phone=ph, username=None, organization="", designation="",
                                role="admin", status="active", password=password, email_verified=True, terms=True)
        self.audit("admin_created_cli", None, uid)
        return uid


_service: AuthService | None = None


def get_service() -> AuthService:
    global _service
    if _service is None:
        _service = AuthService()
    return _service


def set_service(svc: AuthService | None):
    global _service
    _service = svc
