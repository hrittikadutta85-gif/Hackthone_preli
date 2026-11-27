"""Browser push notifications (Web Push with VAPID).

Keys come from environment variables (or a git-ignored `.env` file at the repo root), never from frontend code:

    VAPID_PUBLIC_KEY   base64url, given to browsers so they can subscribe (safe to share)
    VAPID_PRIVATE_KEY  base64url, signs pushes; stays on the server
    VAPID_SUBJECT      contact for push services, e.g. mailto:ops@example.org

Make a key pair once with:  python -m backend.push keygen

Pushing is optional. Without keys, or without internet (push services are run by browser vendors), alerts still
appear in the app; sends simply fail quietly and are retried for the next new alert.
"""
import base64
import json
import os
import sys
import threading

from dengue_ews.config import ROOT

from .alerts import TITLE, AlertDB, message


def load_env_file(path=ROOT / ".env"):
    """Minimal KEY=VALUE reader so Windows users don't need extra tooling. Real environment variables win."""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


def keys() -> dict | None:
    load_env_file()
    pub, priv = os.environ.get("VAPID_PUBLIC_KEY"), os.environ.get("VAPID_PRIVATE_KEY")
    if not pub or not priv:
        return None
    return {"public": pub, "private": priv, "subject": os.environ.get("VAPID_SUBJECT", "mailto:alerts@dengue-watch.local")}


def payload(alert: dict, lang: str, test: bool = False) -> str:
    title = TITLE[lang][alert["alert_type"]]
    level = alert["level"] if lang == "en" else {"Medium": "মাঝারি", "High": "উচ্চ", "Critical": "সংকটজনক"}[alert["level"]]
    prefix = ("[Test] " if lang == "en" else "[পরীক্ষা] ") if test else ""
    return json.dumps({
        "title": f"{prefix}{title} · {level}",
        "body": message(alert, lang),
        "url": f"/alerts?week={alert['alert_week']}&id={alert['id']}",
        "tag": f"dengue-alert-{alert['id']}",
        "level": alert["level"],
    }, ensure_ascii=False)


def send(db: AlertDB, alerts: list[dict], client: str | None = None, test: bool = False) -> int:
    """Push each alert to every subscription (or one client's). Returns how many pushes were delivered."""
    k = keys()
    if not k or not alerts:
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return 0
    delivered = 0
    for sub in db.subscriptions(client):
        info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        for a in alerts:
            try:
                webpush(info, payload(a, sub["lang"], test), vapid_private_key=k["private"],
                        vapid_claims={"sub": k["subject"]}, timeout=10, ttl=24 * 3600)
                delivered += 1
                db.push_result(sub["endpoint"], True)
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):          # the browser unsubscribed: forget it
                    db.remove_subscription(sub["endpoint"])
                    break
                db.push_result(sub["endpoint"], False)
            except Exception:                     # offline, DNS failure, timeout: keep the app running
                db.push_result(sub["endpoint"], False)
                break
    if not test:
        db.mark_pushed([a["id"] for a in alerts])
    return delivered


def send_in_background(db: AlertDB, alerts: list[dict]) -> int:
    """Used by the scanner: pushes go out on a thread so a slow push service never delays the API."""
    if keys() and db.subscriptions():
        threading.Thread(target=send, args=(db, alerts), daemon=True).start()
    return len(alerts)


def keygen():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    raw_priv = key.private_numbers().private_value.to_bytes(32, "big")
    raw_pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    print("# Add these to .env at the repo root (git-ignored) or to your hosting provider's environment settings.")
    print(f"VAPID_PUBLIC_KEY={b64(raw_pub)}")
    print(f"VAPID_PRIVATE_KEY={b64(raw_priv)}")
    print("VAPID_SUBJECT=mailto:you@example.org")


if __name__ == "__main__":
    if sys.argv[1:] == ["keygen"]:
        keygen()
    else:
        print(__doc__)
