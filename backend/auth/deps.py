"""FastAPI dependencies: who is calling, and are they allowed to.

    @app.get("/api/x", dependencies=[Depends(require("dashboard.view"))])     # just the check
    def x(p: Principal = Depends(require("ward.view"))): ...                    # check + the caller

Every check runs on the server. Unsafe methods (POST/PUT/PATCH/DELETE) from a signed-in session must also carry
the session's CSRF token in the X-CSRF-Token header.
"""
from __future__ import annotations

from fastapi import Depends, Request

from .service import AuthError, Client, Principal, get_service

SAFE = {"GET", "HEAD", "OPTIONS"}


def client_ip(request: Request) -> str | None:
    """The browser's address. Behind N trusted proxies (Next.js is one), it is the Nth entry from the right of
    X-Forwarded-For; entries further left were written by the client and can't be trusted."""
    n = get_service().s.trusted_proxies
    fwd = [x.strip() for x in request.headers.get("x-forwarded-for", "").split(",") if x.strip()]
    if n > 0 and fwd:
        return fwd[-n] if len(fwd) >= n else fwd[0]
    return request.client.host if request.client else None


def client(request: Request) -> Client:
    s = get_service().s
    loc = request.headers.get(s.location_header) if s.location_header else None
    return Client(ip=client_ip(request), user_agent=request.headers.get("user-agent"),
                  device_id=request.cookies.get(s.device_cookie), location=(loc or None) and loc[:80])


def optional_principal(request: Request) -> Principal | None:
    svc = get_service()
    p = svc.authenticate(request.cookies.get(svc.s.cookie_name))
    if p and request.method not in SAFE and not svc.check_csrf(p, request.headers.get("x-csrf-token")):
        raise AuthError(403, "csrf_failed", "Your session check failed. Reload the page and try again.")
    return p


def current(p: Principal | None = Depends(optional_principal)) -> Principal:
    if p is None:
        raise AuthError(401, "not_authenticated", "Please sign in.")
    return p


def require(*perms: str):
    """Dependency that lets the request through only if the caller's role has every listed permission."""
    def check(p: Principal = Depends(current)) -> Principal:
        missing = [x for x in perms if not p.can(x)]
        if missing:
            raise AuthError(403, "forbidden", "Your role does not allow this.", permission=missing[0])
        return p
    check.__name__ = f"require_{'_'.join(x.replace('.', '_') for x in perms)}"
    return check


def ward_allowed(p: Principal, ward: str) -> None:
    wards = p.wards()
    if wards is not None and ward not in wards:
        raise AuthError(403, "ward_not_assigned", "This ward is not assigned to you.", ward=ward)
