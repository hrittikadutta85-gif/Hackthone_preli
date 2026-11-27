"""Account administration from the command line.

    python -m backend.auth create-admin            # first administrator (asks for the password, never echoes it)
    python -m backend.auth users                   # list accounts
    python -m backend.auth providers               # which SMS / WhatsApp / email channels are configured
    python -m backend.auth unlock EMAIL            # clear a lockout
"""
import argparse
import getpass
import os
import sys

from .service import AuthError, AuthService


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="python -m backend.auth")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin", help="create an administrator account")
    a.add_argument("--email", required=True)
    a.add_argument("--name", required=True)
    a.add_argument("--phone", help="mobile number with country code, e.g. +8801712345678")
    sub.add_parser("users", help="list accounts")
    sub.add_parser("providers", help="show which delivery channels are configured")
    u = sub.add_parser("unlock", help="clear a lockout")
    u.add_argument("email")
    args = ap.parse_args(argv)
    svc = AuthService()

    if args.cmd == "create-admin":
        # AUTH_ADMIN_PASSWORD lets scripted deployments avoid the prompt; it is read once and never printed.
        password = os.environ.get("AUTH_ADMIN_PASSWORD") or getpass.getpass("Password: ")
        if not os.environ.get("AUTH_ADMIN_PASSWORD") and getpass.getpass("Repeat password: ") != password:
            sys.exit("The passwords do not match.")
        try:
            uid = svc.create_admin(args.email, args.name, password, args.phone)
        except AuthError as e:
            sys.exit(f"{e.message} {e.extra.get('rules', '')}".strip())
        print(f"Administrator #{uid} created for {args.email}. Phone verification can be done from the profile page.")
    elif args.cmd == "users":
        for r in svc.list_users():
            print(f"#{r['id']:<4} {r['role']:<8} {r['status']:<11} {'verified' if r['email_verified'] else 'unverified':<10} "
                  f"{r['email']}  ({r['full_name']})")
    elif args.cmd == "providers":
        for ch, v in svc.notifier.available().items():
            print(f"{ch:<9} {'configured (' + v['provider'] + ')' if v['available'] else 'not configured'}")
        print(f"status callbacks: {'on' if svc.s.public_base_url.startswith('https://') else 'off (set PUBLIC_BASE_URL)'}")
    elif args.cmd == "unlock":
        u = svc.find(args.email)
        if not u:
            sys.exit("No such account.")
        svc.db.run("UPDATE users SET failed_logins = 0, lock_count = 0, locked_until = NULL WHERE id = ?", (u["id"],))
        svc.audit("user_unlocked_cli", None, u["id"])
        print("Unlocked.")


if __name__ == "__main__":
    main()
