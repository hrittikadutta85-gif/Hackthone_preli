"""Primitives: password hashing (Argon2id), random tokens, one-time codes, input normalisation and masking."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # Argon2id, library defaults (RFC 9106 low-memory profile)
# Verified against when the account does not exist, so a wrong email and a wrong password take the same time.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> tuple[bool, str | None]:
    """(matches, new hash if the parameters changed and the hash should be upgraded)."""
    try:
        _hasher.verify(stored or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None
    if stored is None:
        return False, None
    return True, (_hasher.hash(password) if _hasher.check_needs_rehash(stored) else None)


def token() -> str:
    """256-bit URL-safe random value, used for session cookies, challenges and reset tokens."""
    return secrets.token_urlsafe(32)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_code(digits: int = 6) -> str:
    """Cryptographically random numeric code, zero-padded (000000-999999)."""
    return f"{secrets.randbelow(10 ** digits):0{digits}d}"


def code_hash(secret_key: str, purpose: str, target: str, code: str) -> str:
    """Keyed hash: a leaked database alone does not allow brute-forcing the 10^6 codes offline."""
    msg = f"{purpose}|{target}|{code}".encode()
    return hmac.new(secret_key.encode(), msg, hashlib.sha256).hexdigest()


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ------------------------------------------------------------------------------------------------- input rules
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                      r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def normalise_email(email: str) -> str | None:
    e = email.strip()
    if len(e) > 254 or not EMAIL_RE.match(e):
        return None
    local, domain = e.rsplit("@", 1)
    return f"{local}@{domain.lower()}"


def normalise_phone(phone: str, default_cc: str = "880") -> str | None:
    """E.164. Accepts '+8801712345678', '8801712345678' or a local '01712345678' (Bangladesh by default)."""
    p = re.sub(r"[\s()-]", "", phone.strip())
    if p.startswith("00"):
        p = "+" + p[2:]
    if not p.startswith("+"):
        if p.startswith("0") and default_cc:
            p = f"+{default_cc}{p[1:]}"
        else:
            p = "+" + p
    if not re.fullmatch(r"\+[1-9]\d{7,14}", p):
        return None
    if p.startswith("+880") and not re.fullmatch(r"\+8801[3-9]\d{8}", p):
        return None  # Bangladesh mobile numbers: +880 1[3-9]XX XXXXXX
    return p


COMMON = {"password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou",
          "admin123", "letmein", "welcome1", "dengue123", "dhaka1234", "bangladesh", "abc12345", "11111111",
          "qwertyui", "asdfghjk", "87654321", "00000000", "12341234", "passw0rd", "bangladesh1"}


def password_problems(password: str, min_length: int, email: str = "", name: str = "", phone: str = "") -> list[str]:
    """Codes for every rule the password breaks (empty when acceptable). The frontend shows the same rules.

    Length plus a block-list of common and personal passwords, as NIST SP 800-63B recommends, instead of
    character-mix rules that make passwords harder to remember without making them much harder to guess."""
    issues = []
    if len(password) < min_length:
        issues.append("too_short")
    if len(password) > 128:
        issues.append("too_long")
    low = password.lower()
    digits = re.sub(r"\D", "", phone)
    personal = [email.split("@")[0].lower()] + [w.lower() for w in name.split() if len(w) >= 4]
    if (low in COMMON or len(set(low)) <= 2 or any(len(p) >= 4 and p in low for p in personal)
            or (len(digits) >= 6 and (digits[-8:] in low or low in digits))):
        issues.append("too_common")
    return issues


# ------------------------------------------------------------------------------------------------- display helpers
def mask_phone(phone: str | None) -> str:
    if not phone:
        return ""
    return phone[:6] + "*" * max(len(phone) - 9, 2) + phone[-3:]


def mask_email(email: str | None) -> str:
    if not email or "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    return (local[:2] + "***" if len(local) > 2 else local[:1] + "***") + "@" + domain


def mask_target(target: str) -> str:
    return mask_email(target) if "@" in target else mask_phone(target)


def device_label(ua: str | None) -> str:
    """'Chrome on Windows', from the User-Agent header. Good enough to recognise a device; not a fingerprint."""
    ua = ua or ""
    if not ua:
        return "Unknown device"
    browser = next((name for pat, name in (
        (r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"SamsungBrowser", "Samsung Internet"), (r"Firefox/", "Firefox"),
        (r"Chrome/|CriOS", "Chrome"), (r"Safari/", "Safari"), (r"curl/", "curl"), (r"python", "Script")) if re.search(pat, ua)),
        "Browser")
    os_name = next((name for pat, name in (
        (r"Android", "Android"), (r"iPhone|iPad|iPod", "iOS"), (r"Windows", "Windows"), (r"Mac OS X|Macintosh", "macOS"),
        (r"CrOS", "ChromeOS"), (r"Linux", "Linux")) if re.search(pat, ua)), "")
    return f"{browser} on {os_name}" if os_name else browser
