"""SMS, WhatsApp and email delivery for one-time codes and account-security notifications.

Providers are picked and configured with environment variables (see .env.example and README "Accounts and sign-in"):

    SMS_PROVIDER=twilio | sslwireless        WHATSAPP_PROVIDER=meta | twilio        SMTP_HOST=... (email codes)

Rules this module keeps:
* An unconfigured channel is reported as unavailable and the message is recorded as `skipped`; nothing pretends to send.
* `sent` means the provider accepted the message. `delivered` is only set when the provider later confirms delivery
  through its status callback (Twilio StatusCallback or the WhatsApp Cloud API webhook).
* Message bodies and codes are never written to the database or to logs; only the event, channel, masked number,
  status and the provider's message id are kept.
* Sending happens on a small worker pool for notifications, so a slow or failing provider never delays or breaks a
  login. One-time codes are sent synchronously, because the user needs to know whether the code went out.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import smtplib
import ssl
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import requests

from .db import iso
from .security import mask_target

TIMEOUT = 12
EVENTS = ("otp", "login", "new_device", "suspicious_login", "password_change", "account_update")
BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Message:
    event: str
    lang: str                       # en | bn
    params: dict = field(default_factory=dict)   # name, date, time, device, what, minutes, purpose
    code: str | None = None         # only for event == "otp"; handed to the provider, never stored

    def text(self, channel: str) -> str:
        return render(self, channel)


@dataclass
class SendResult:
    status: str                     # sent | failed
    provider_message_id: str | None = None
    detail: str | None = None


# ------------------------------------------------------------------------------------------------ message text
OTP_PURPOSE = {
    "en": {"login": "login code", "verify_phone": "phone verification code", "verify_email": "email verification code",
           "change_phone": "phone verification code", "reset_password": "password reset code"},
    "bn": {"login": "লগইন কোড", "verify_phone": "ফোন যাচাইকরণ কোড", "verify_email": "ইমেইল যাচাইকরণ কোড",
           "change_phone": "ফোন যাচাইকরণ কোড", "reset_password": "পাসওয়ার্ড রিসেট কোড"},
}

SMS = {
    "en": {
        "otp": "Dengue Watch: your {purpose} is {code}. It expires in {minutes} minutes. Never share this code with anyone.",
        "login": "Dengue Watch Security Alert: A new login to your account was detected on {date} at {time} ({device}). "
                 "If this wasn't you, please secure your account.",
        "new_device": "Dengue Watch Security Alert: Your account was signed in from a new device ({device}) on {date} at "
                      "{time}. If this wasn't you, change your password and contact your administrator.",
        "suspicious_login": "Dengue Watch Security Alert: An unusual sign-in to your account was detected on {date} at "
                            "{time} ({device}). If this wasn't you, change your password now and contact your administrator.",
        "password_change": "Dengue Watch Security Alert: Your password was changed on {date} at {time}. If you didn't "
                           "do this, contact your administrator immediately.",
        "account_update": "Dengue Watch Security Alert: {what} on {date} at {time}. If you didn't do this, contact your "
                          "administrator.",
    },
    "bn": {
        "otp": "ডেঙ্গু ওয়াচ: আপনার {purpose} {code}। এটি {minutes} মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে। এই কোড কাউকে দেবেন না।",
        "login": "ডেঙ্গু ওয়াচ নিরাপত্তা সতর্কতা: {date}, {time}-এ আপনার অ্যাকাউন্টে একটি নতুন লগইন শনাক্ত হয়েছে ({device})। "
                 "এটি আপনি না হলে অনুগ্রহ করে আপনার অ্যাকাউন্ট সুরক্ষিত করুন।",
        "new_device": "ডেঙ্গু ওয়াচ নিরাপত্তা সতর্কতা: {date}, {time}-এ একটি নতুন ডিভাইস ({device}) থেকে আপনার অ্যাকাউন্টে "
                      "লগইন হয়েছে। এটি আপনি না হলে পাসওয়ার্ড পরিবর্তন করুন এবং প্রশাসকের সাথে যোগাযোগ করুন।",
        "suspicious_login": "ডেঙ্গু ওয়াচ নিরাপত্তা সতর্কতা: {date}, {time}-এ আপনার অ্যাকাউন্টে একটি অস্বাভাবিক লগইন শনাক্ত "
                            "হয়েছে ({device})। এটি আপনি না হলে এখনই পাসওয়ার্ড পরিবর্তন করুন এবং প্রশাসকের সাথে যোগাযোগ করুন।",
        "password_change": "ডেঙ্গু ওয়াচ নিরাপত্তা সতর্কতা: {date}, {time}-এ আপনার পাসওয়ার্ড পরিবর্তন করা হয়েছে। এটি আপনি "
                           "না করে থাকলে এখনই প্রশাসকের সাথে যোগাযোগ করুন।",
        "account_update": "ডেঙ্গু ওয়াচ নিরাপত্তা সতর্কতা: {date}, {time}-এ {what}। এটি আপনি না করে থাকলে প্রশাসকের সাথে "
                          "যোগাযোগ করুন।",
    },
}

# What changed, for account_update ("what" parameter)
CHANGES = {
    "en": {"profile": "your profile details were updated", "phone": "your phone number was changed",
           "otp_on": "two-step login was turned on", "otp_off": "two-step login was turned off",
           "sessions": "you were signed out of all devices", "notifications": "your notification settings were changed",
           "role": "your access role was changed", "status": "your account status was changed"},
    "bn": {"profile": "আপনার প্রোফাইলের তথ্য হালনাগাদ করা হয়েছে", "phone": "আপনার ফোন নম্বর পরিবর্তন করা হয়েছে",
           "otp_on": "দুই-ধাপের লগইন চালু করা হয়েছে", "otp_off": "দুই-ধাপের লগইন বন্ধ করা হয়েছে",
           "sessions": "সব ডিভাইস থেকে আপনাকে লগআউট করা হয়েছে", "notifications": "আপনার নোটিফিকেশন সেটিংস পরিবর্তন করা হয়েছে",
           "role": "আপনার অ্যাক্সেস ভূমিকা পরিবর্তন করা হয়েছে", "status": "আপনার অ্যাকাউন্টের অবস্থা পরিবর্তন করা হয়েছে"},
}

# WhatsApp: the event sentence that goes into the security template
WA_EVENT = {
    "en": {"login": "A new login to your Dengue Watch account was detected.",
           "new_device": "Your Dengue Watch account was signed in from a new device.",
           "suspicious_login": "An unusual sign-in to your Dengue Watch account was detected.",
           "password_change": "Your Dengue Watch password was changed.",
           "account_update": "Your Dengue Watch account was updated: {what}."},
    "bn": {"login": "আপনার ডেঙ্গু ওয়াচ অ্যাকাউন্টে একটি নতুন লগইন শনাক্ত হয়েছে।",
           "new_device": "একটি নতুন ডিভাইস থেকে আপনার ডেঙ্গু ওয়াচ অ্যাকাউন্টে লগইন হয়েছে।",
           "suspicious_login": "আপনার ডেঙ্গু ওয়াচ অ্যাকাউন্টে একটি অস্বাভাবিক লগইন শনাক্ত হয়েছে।",
           "password_change": "আপনার ডেঙ্গু ওয়াচ পাসওয়ার্ড পরিবর্তন করা হয়েছে।",
           "account_update": "আপনার ডেঙ্গু ওয়াচ অ্যাকাউন্ট হালনাগাদ করা হয়েছে: {what}।"},
}

WA_SECURITY = {
    "en": "Dengue Watch Security Notification\nHello {name},\n{event}\nDate: {date}\nTime: {time}\nDevice: {device}\n"
          "If this was not you, please contact your system administrator or secure your account.",
    "bn": "ডেঙ্গু ওয়াচ নিরাপত্তা বিজ্ঞপ্তি\nপ্রিয় {name},\n{event}\nতারিখ: {date}\nসময়: {time}\n"
          "ডিভাইস: {device}\nএটি আপনি না হলে অনুগ্রহ করে আপনার সিস্টেম প্রশাসকের সাথে যোগাযোগ করুন বা অ্যাকাউন্ট সুরক্ষিত করুন।",
}

EMAIL_SUBJECT = {"en": "Dengue Watch: your {purpose}", "bn": "ডেঙ্গু ওয়াচ: আপনার {purpose}"}

MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর",
             "নভেম্বর", "ডিসেম্বর"]


def local_time(when: datetime, tz_name: str) -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return when.astimezone(ZoneInfo(tz_name))
    except Exception:  # no tz database on this machine: Bangladesh is UTC+6 all year
        return when.astimezone(timezone(timedelta(hours=6)))


def when_params(when: datetime, lang: str, tz_name: str) -> dict:
    t = local_time(when, tz_name)
    if lang == "bn":
        hour = t.hour % 12 or 12
        part = "সকাল" if 5 <= t.hour < 12 else "দুপুর" if 12 <= t.hour < 15 else "বিকেল" if 15 <= t.hour < 18 \
            else "সন্ধ্যা" if 18 <= t.hour < 20 else "রাত"
        return {"date": f"{t.day} {MONTHS_BN[t.month - 1]} {t.year}".translate(BN_DIGITS),
                "time": f"{part} {hour}:{t.minute:02d}".translate(BN_DIGITS)}
    return {"date": f"{t.day} {t.strftime('%B %Y')}", "time": t.strftime("%I:%M %p").lstrip("0")}


def render(m: Message, channel: str) -> str:
    lang = m.lang if m.lang in SMS else "en"
    p = dict(m.params)
    if m.event == "otp":
        p["purpose"] = OTP_PURPOSE[lang].get(p.get("purpose", ""), OTP_PURPOSE[lang]["verify_phone"])
        minutes = str(p.get("minutes", 5))
        p["minutes"] = minutes.translate(BN_DIGITS) if lang == "bn" else minutes
        return SMS[lang]["otp"].format(code=m.code, **{k: p[k] for k in ("purpose", "minutes")})
    p.setdefault("what", "")
    if m.event == "account_update":
        p["what"] = CHANGES[lang].get(p["what"], p["what"])
    if channel == "whatsapp":
        event = WA_EVENT[lang][m.event].format(what=p["what"])
        return WA_SECURITY[lang].format(event=event, **{k: p.get(k, "") for k in ("name", "date", "time", "device")})
    what = p["what"][:1].upper() + p["what"][1:] if lang == "en" else p["what"]
    return SMS[lang][m.event].format(**{**p, "what": what})


# ------------------------------------------------------------------------------------------------ providers
class Provider:
    name = "none"
    channel = ""

    def configured(self) -> bool:
        return False

    def send(self, to: str, m: Message, callback_url: str | None = None) -> SendResult:
        raise NotImplementedError


def _http_error(r: requests.Response) -> str:
    try:
        body = r.json()
        msg = body.get("message") or body.get("error", {}).get("message") or body.get("error_message") or ""
    except ValueError:
        msg = ""
    return f"HTTP {r.status_code}" + (f": {str(msg)[:160]}" if msg else "")


class TwilioSMS(Provider):
    """Twilio Programmable Messaging. https://www.twilio.com/docs/messaging/api/message-resource"""
    name, channel = "twilio", "sms"

    def __init__(self):
        self.sid, self.token = env("TWILIO_ACCOUNT_SID"), env("TWILIO_AUTH_TOKEN")
        self.sender, self.service = env("TWILIO_SMS_FROM") or env("SMS_SENDER_ID"), env("TWILIO_MESSAGING_SERVICE_SID")

    def configured(self) -> bool:
        return bool(self.sid and self.token and (self.sender or self.service))

    def post(self, data: dict, callback_url: str | None) -> SendResult:
        if callback_url:
            data["StatusCallback"] = callback_url
        r = requests.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json", data=data,
                          auth=(self.sid, self.token), timeout=TIMEOUT)
        if r.status_code >= 300:
            return SendResult("failed", detail=_http_error(r))
        body = r.json()
        if body.get("status") == "failed" or body.get("error_code"):
            return SendResult("failed", body.get("sid"), f"Twilio error {body.get('error_code')}")
        return SendResult("sent", body.get("sid"), f"accepted ({body.get('status', 'queued')})")

    def send(self, to, m, callback_url=None):
        data = {"To": to, "Body": m.text("sms")}
        data.update({"MessagingServiceSid": self.service} if self.service else {"From": self.sender})
        return self.post(data, callback_url)


class SSLWirelessSMS(Provider):
    """SSL Wireless ISMS (Bangladesh), API v3 'send-sms'. Check field names against your account's API document."""
    name, channel = "sslwireless", "sms"

    def __init__(self):
        self.token = env("SSLWIRELESS_API_TOKEN") or env("SMS_API_KEY")
        self.sid = env("SSLWIRELESS_SID") or env("SMS_SENDER_ID")
        self.url = env("SSLWIRELESS_URL", "https://smsplus.sslwireless.com").rstrip("/")

    def configured(self) -> bool:
        return bool(self.token and self.sid)

    def send(self, to, m, callback_url=None):
        csms = uuid.uuid4().hex[:20]
        r = requests.post(f"{self.url}/api/v3/send-sms", timeout=TIMEOUT, json={
            "api_token": self.token, "sid": self.sid, "msisdn": to.lstrip("+"), "sms": m.text("sms"), "csms_id": csms})
        if r.status_code >= 300:
            return SendResult("failed", detail=_http_error(r))
        body = r.json()
        info = (body.get("smsinfo") or [{}])[0]
        if str(body.get("status", "")).upper() != "SUCCESS" or str(info.get("sms_status", "SUCCESS")).upper() != "SUCCESS":
            return SendResult("failed", detail=str(body.get("error_message") or info.get("status_message") or "rejected")[:160])
        return SendResult("sent", info.get("reference_id") or csms, "accepted")


class MetaWhatsApp(Provider):
    """WhatsApp Business Platform, Cloud API. Business-initiated messages must use approved templates:

    * WHATSAPP_TEMPLATE_OTP       an Authentication template (one body variable = the code, copy-code button)
    * WHATSAPP_TEMPLATE_SECURITY  a Utility template with 5 body variables: name, event, date, time, device
    """
    name, channel = "meta", "whatsapp"

    def __init__(self):
        self.token, self.phone_id = env("WHATSAPP_ACCESS_TOKEN"), env("WHATSAPP_PHONE_NUMBER_ID")
        self.version = env("WHATSAPP_API_VERSION", "v23.0")
        self.t_otp, self.t_sec = env("WHATSAPP_TEMPLATE_OTP"), env("WHATSAPP_TEMPLATE_SECURITY")
        self.langs = {"en": env("WHATSAPP_TEMPLATE_LANG_EN", "en"), "bn": env("WHATSAPP_TEMPLATE_LANG_BN", "bn")}

    def configured(self) -> bool:
        return bool(self.token and self.phone_id and self.t_otp and self.t_sec)

    def send(self, to, m, callback_url=None):
        lang = {"code": self.langs.get(m.lang, "en")}
        if m.event == "otp":
            template = {"name": self.t_otp, "language": lang, "components": [
                {"type": "body", "parameters": [{"type": "text", "text": m.code}]},
                {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": m.code}]}]}
        else:
            p = dict(m.params)
            what = CHANGES.get(m.lang, CHANGES["en"]).get(p.get("what", ""), p.get("what", ""))
            event = WA_EVENT.get(m.lang, WA_EVENT["en"])[m.event].format(what=what)
            values = [p.get("name", ""), event, p.get("date", ""), p.get("time", ""), p.get("device", "")]
            template = {"name": self.t_sec, "language": lang, "components": [
                {"type": "body", "parameters": [{"type": "text", "text": v or "-"} for v in values]}]}
        r = requests.post(f"https://graph.facebook.com/{self.version}/{self.phone_id}/messages", timeout=TIMEOUT,
                          headers={"Authorization": f"Bearer {self.token}"},
                          json={"messaging_product": "whatsapp", "to": to.lstrip("+"), "type": "template",
                                "template": template})
        if r.status_code >= 300:
            return SendResult("failed", detail=_http_error(r))
        msgs = r.json().get("messages") or [{}]
        return SendResult("sent", msgs[0].get("id"), f"accepted ({msgs[0].get('message_status', 'accepted')})")


class TwilioWhatsApp(TwilioSMS):
    """Twilio WhatsApp. Business-initiated messages need approved Content templates (ContentSid); without them only
    the sandbox or replies inside a 24-hour customer window are accepted."""
    name, channel = "twilio", "whatsapp"

    def __init__(self):
        super().__init__()
        self.sender = env("TWILIO_WHATSAPP_FROM")
        self.c_otp, self.c_sec = env("TWILIO_WHATSAPP_CONTENT_SID_OTP"), env("TWILIO_WHATSAPP_CONTENT_SID_SECURITY")

    def configured(self) -> bool:
        return bool(self.sid and self.token and self.sender)

    def send(self, to, m, callback_url=None):
        data = {"To": f"whatsapp:{to}", "From": f"whatsapp:{self.sender.removeprefix('whatsapp:')}"}
        content = self.c_otp if m.event == "otp" else self.c_sec
        if content:
            if m.event == "otp":
                variables = {"1": m.code}
            else:
                p = m.params
                what = CHANGES.get(m.lang, CHANGES["en"]).get(p.get("what", ""), p.get("what", ""))
                variables = {"1": p.get("name", ""), "2": WA_EVENT.get(m.lang, WA_EVENT["en"])[m.event].format(what=what),
                             "3": p.get("date", ""), "4": p.get("time", ""), "5": p.get("device", "")}
            data.update(ContentSid=content, ContentVariables=json.dumps(variables, ensure_ascii=False))
        else:
            data["Body"] = m.text("whatsapp")
        return self.post(data, callback_url)


class SMTPEmail(Provider):
    """Email codes (verification and password reset) through any SMTP server."""
    name, channel = "smtp", "email"

    def __init__(self):
        self.host, self.port = env("SMTP_HOST"), int(env("SMTP_PORT", "587") or 587)
        self.user, self.password = env("SMTP_USERNAME"), env("SMTP_PASSWORD")
        self.sender = env("SMTP_FROM") or self.user
        self.starttls = env("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")
        self.ssl = env("SMTP_SSL", "false").lower() in ("1", "true", "yes")

    def configured(self) -> bool:
        return bool(self.host and self.sender)

    def send(self, to, m, callback_url=None):
        lang = m.lang if m.lang in EMAIL_SUBJECT else "en"
        msg = EmailMessage()
        msg["From"], msg["To"] = self.sender, to
        msg["Subject"] = EMAIL_SUBJECT[lang].format(purpose=OTP_PURPOSE[lang].get(m.params.get("purpose", ""), "code"))
        msg.set_content(m.text("email"))
        ctx = ssl.create_default_context()
        cls = smtplib.SMTP_SSL if self.ssl else smtplib.SMTP
        kwargs = {"context": ctx} if self.ssl else {}
        with cls(self.host, self.port, timeout=TIMEOUT, **kwargs) as s:
            if self.starttls and not self.ssl:
                s.starttls(context=ctx)
            if self.user:
                s.login(self.user, self.password)
            s.send_message(msg)
        return SendResult("sent", None, "accepted by mail server")


def providers_from_env() -> dict[str, Provider | None]:
    sms = {"twilio": TwilioSMS, "sslwireless": SSLWirelessSMS}.get(env("SMS_PROVIDER").lower())
    wa = {"meta": MetaWhatsApp, "twilio": TwilioWhatsApp}.get(env("WHATSAPP_PROVIDER").lower())
    out = {"sms": sms() if sms else None, "whatsapp": wa() if wa else None, "email": SMTPEmail()}
    return {k: (p if p and p.configured() else None) for k, p in out.items()}


# ------------------------------------------------------------------------------------------------ delivery records
STATUS_ORDER = {"pending": 0, "sent": 1, "delivered": 2}
TWILIO_STATUS = {"accepted": "sent", "scheduled": "sent", "queued": "sent", "sending": "sent", "sent": "sent",
                 "delivered": "delivered", "read": "delivered", "undelivered": "failed", "failed": "failed",
                 "canceled": "failed"}
META_STATUS = {"sent": "sent", "delivered": "delivered", "read": "delivered", "failed": "failed"}


class Notifier:
    def __init__(self, db, settings, providers: dict[str, Provider | None] | None = None):
        self.db, self.settings = db, settings
        self.providers = providers if providers is not None else providers_from_env()
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="notify")
        self.pending: list[Future] = []

    def available(self) -> dict[str, dict]:
        return {ch: {"available": p is not None, "provider": p.name if p else None}
                for ch, p in (("sms", self.providers.get("sms")), ("whatsapp", self.providers.get("whatsapp")),
                              ("email", self.providers.get("email")))}

    def has(self, channel: str) -> bool:
        return self.providers.get(channel) is not None

    def callback_url(self, provider: Provider) -> str | None:
        base = self.settings.public_base_url
        if not base.startswith("https://"):
            return None
        return f"{base}/api/auth/hooks/twilio" if provider.name == "twilio" else None

    def record(self, user_id, event, channel, to, status, detail=None, provider=None, login_id=None) -> int:
        now = iso(datetime.now(timezone.utc))
        cur = self.db.run("INSERT INTO notifications(user_id, event, channel, provider, target, status, detail, login_id, "
                          "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (user_id, event, channel, provider, mask_target(to), status, detail, login_id, now, now))
        return cur.lastrowid

    def send(self, *, user_id: int | None, channel: str, to: str, message: Message, login_id: int | None = None) -> dict:
        """Send now and record the outcome. Never raises: a provider failure is a `failed` record."""
        provider = self.providers.get(channel)
        if provider is None:
            rid = self.record(user_id, message.event, channel, to, "skipped", "provider_not_configured", login_id=login_id)
            return {"id": rid, "status": "skipped", "detail": "provider_not_configured"}
        rid = self.record(user_id, message.event, channel, to, "pending", provider=provider.name, login_id=login_id)
        try:
            res = provider.send(to, message, self.callback_url(provider))
        except requests.RequestException as e:
            res = SendResult("failed", detail=f"network error ({type(e).__name__})")
        except Exception as e:  # provider bug or unexpected answer; the message text is not included
            res = SendResult("failed", detail=f"{type(e).__name__}")
        now = iso(datetime.now(timezone.utc))
        self.db.run("UPDATE notifications SET status = ?, detail = ?, provider_message_id = ?, updated_at = ? WHERE id = ?",
                    (res.status, res.detail, res.provider_message_id, now, rid))
        return {"id": rid, "status": res.status, "detail": res.detail}

    def send_later(self, **kwargs) -> Future:
        fut = self.pool.submit(self.send, **kwargs)
        self.pending = [f for f in self.pending if not f.done()] + [fut]
        return fut

    def flush(self, timeout: float = 30):
        for f in list(self.pending):
            f.result(timeout=timeout)

    def update_status(self, provider_message_id: str, status: str, detail: str | None = None) -> bool:
        """Apply a provider status callback. Never moves backwards (delivered stays delivered)."""
        row = self.db.one("SELECT id, status FROM notifications WHERE provider_message_id = ?", (provider_message_id,))
        if not row:
            return False
        cur = row["status"]
        if cur in ("failed", "delivered", "skipped") or (status != "failed" and STATUS_ORDER.get(status, 0) <= STATUS_ORDER.get(cur, 0)):
            return True
        self.db.run("UPDATE notifications SET status = ?, detail = ?, updated_at = ? WHERE id = ?",
                    (status, detail, iso(datetime.now(timezone.utc)), row["id"]))
        return True


def twilio_signature_ok(url: str, params: dict[str, str], signature: str, auth_token: str) -> bool:
    """https://www.twilio.com/docs/usage/security#validating-requests"""
    payload = url + "".join(k + params[k] for k in sorted(params))
    digest = base64.b64encode(hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()).decode()
    return bool(signature) and hmac.compare_digest(digest, signature)


def meta_signature_ok(raw: bytes, header: str, app_secret: str) -> bool:
    """X-Hub-Signature-256: sha256=<HMAC of the raw body with the app secret>."""
    expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
    return bool(header) and hmac.compare_digest(expected, header)
