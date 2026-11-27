"""Authentication settings, read from environment variables (or the git-ignored .env file).

Nothing secret has a default. Without AUTH_SECRET_KEY the server makes a random key at first start and keeps it in the
data folder (git-ignored), so OTP hashes stay valid across restarts on that machine.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dengue_ews.config import ROOT

from ..envfile import load_env_file

DATA_DIR = ROOT / "data"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    v = _env(name).lower()
    return default if v == "" else v in ("1", "true", "yes", "on")


def _list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in _env(name, default).split(",") if x.strip()]


def _secret_key() -> str:
    key = _env("AUTH_SECRET_KEY")
    if key:
        return key
    path = Path(_env("AUTH_SECRET_FILE") or DATA_DIR / ".auth_secret")
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        path.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_urlsafe(48)
        path.write_text(key, encoding="utf-8")
        return key


@dataclass
class Settings:
    db_path: Path
    secret_key: str
    # sessions
    session_minutes: int = 60            # idle timeout; each request slides it forward
    session_max_hours: int = 12          # absolute limit for a normal session
    remember_days: int = 30              # absolute limit when "Remember me" is ticked
    reauth_minutes: int = 10             # how long a password re-check unlocks sensitive changes
    cookie_name: str = "dw_session"
    device_cookie: str = "dw_device"
    cookie_secure: str = "auto"          # auto | true | false
    cookie_samesite: str = "lax"
    allowed_origins: list[str] = field(default_factory=list)
    trusted_proxies: int = 1             # proxies in front of the API that append to X-Forwarded-For (Next.js = 1)
    # registration and login policy
    public_registration: bool = True
    require_approval: bool = False       # true: self-registered accounts wait for an administrator
    default_role: str = "officer"        # role a new sign-up gets: every dashboard page, no administration
    require_email_verification: bool = True  # applies to accounts that have an email address
    allow_otp_login: bool = True         # passwordless login with a code to a verified phone
    require_otp_roles: list[str] = field(default_factory=list)  # roles that must pass a code at every login
    # OTP
    otp_expiry_seconds: int = 300
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 60
    otp_per_target_hour: int = 5
    otp_per_ip_hour: int = 20
    # lockout
    lockout_threshold: int = 5
    lockout_minutes: int = 15
    ip_failures_15min: int = 30
    # password
    password_min_length: int = 8
    reset_token_minutes: int = 10
    invite_days: int = 7
    # notifications
    essential_events: list[str] = field(default_factory=lambda: ["suspicious_login", "password_change"])
    timezone: str = "Asia/Dhaka"
    public_base_url: str = ""            # https URL the providers can reach, for delivery-status callbacks
    location_header: str = ""            # e.g. CF-IPCountry when a trusted CDN adds it; otherwise no location is shown

    @property
    def session_seconds(self) -> int:
        return self.session_minutes * 60


def load_settings(db_path: Path | None = None) -> Settings:
    load_env_file()
    origins = _list("AUTH_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    base = _env("PUBLIC_BASE_URL").rstrip("/")
    if base and base not in origins:
        origins.append(base)
    return Settings(
        db_path=Path(db_path or _env("AUTH_DB") or DATA_DIR / "auth.sqlite3"),
        secret_key=_secret_key(),
        session_minutes=_int("LOGIN_SESSION_EXPIRY_MINUTES", 60),
        session_max_hours=_int("LOGIN_SESSION_MAX_HOURS", 12),
        remember_days=_int("LOGIN_REMEMBER_DAYS", 30),
        reauth_minutes=_int("AUTH_REAUTH_MINUTES", 10),
        cookie_secure=_env("AUTH_COOKIE_SECURE", "auto").lower(),
        cookie_samesite=_env("AUTH_COOKIE_SAMESITE", "lax").lower(),
        allowed_origins=origins,
        trusted_proxies=_int("AUTH_TRUSTED_PROXIES", 1),
        public_registration=_bool("AUTH_PUBLIC_REGISTRATION", True),
        require_approval=_bool("AUTH_REQUIRE_APPROVAL", False),
        default_role=_env("AUTH_DEFAULT_ROLE", "officer").lower(),
        require_email_verification=_bool("AUTH_REQUIRE_EMAIL_VERIFICATION", True),
        allow_otp_login=_bool("AUTH_ALLOW_OTP_LOGIN", True),
        require_otp_roles=_list("AUTH_REQUIRE_OTP_ROLES"),
        otp_expiry_seconds=_int("OTP_EXPIRY_SECONDS", 300),
        otp_max_attempts=_int("OTP_MAX_ATTEMPTS", 5),
        otp_resend_seconds=_int("OTP_RESEND_SECONDS", 60),
        otp_per_target_hour=_int("OTP_MAX_PER_HOUR", 5),
        otp_per_ip_hour=_int("OTP_MAX_PER_IP_HOUR", 20),
        lockout_threshold=_int("AUTH_LOCKOUT_THRESHOLD", 5),
        lockout_minutes=_int("AUTH_LOCKOUT_MINUTES", 15),
        password_min_length=max(8, _int("AUTH_PASSWORD_MIN_LENGTH", 8)),
        essential_events=_list("AUTH_ESSENTIAL_EVENTS", "suspicious_login,password_change"),
        timezone=_env("AUTH_TIMEZONE", "Asia/Dhaka"),
        public_base_url=base,
        location_header=_env("AUTH_LOCATION_HEADER"),
    )
