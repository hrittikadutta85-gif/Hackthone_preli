"""Offline kill-switch: prove the whole pipeline runs with the network cut.

`no_network()` makes every outbound connection and DNS lookup in this process fail while it is active. The self-test
runs each Phase 2 module under it (forecast, constrained allocation, overflow routing, vector-control simulation,
dispatch templates) and reports how long each took. If any step tried to reach the internet it would fail here.
"""
import socket
import threading
import time
from contextlib import contextmanager

_lock = threading.Lock()


class NetworkBlocked(OSError):
    pass


@contextmanager
def no_network():
    def blocked(*_, **__):
        raise NetworkBlocked("Network is switched off for the offline self-test.")

    with _lock:
        saved = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)
        socket.socket.connect = blocked
        socket.socket.connect_ex = blocked
        socket.create_connection = blocked
        socket.getaddrinfo = blocked
        try:
            yield
        finally:
            socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = saved


def network_really_blocked() -> bool:
    """Sanity check that the switch works: a DNS lookup must fail while it is on."""
    try:
        socket.getaddrinfo("example.com", 443)
    except NetworkBlocked:
        return True
    except OSError:
        return True  # no network at all is just as good
    return False


def self_test(store, planner, origin: str | None = None, ward: str = "DSCC_Ward_05") -> dict:
    from . import dispatch

    steps = []

    def step(key, fn):
        t0 = time.perf_counter()
        try:
            detail = fn()
            ok = True
        except Exception as e:  # report, never crash: this endpoint exists to show what still works
            detail, ok = f"{type(e).__name__}: {e}", False
        steps.append({"step": key, "ok": ok, "ms": round((time.perf_counter() - t0) * 1000, 1), "detail": detail})

    with no_network():
        blocked = network_really_blocked()
        o = store.snap(origin)
        planner._curves.pop(o, None)  # recompute the simulator from scratch, not from cache
        holder = {}

        def forecast():
            f = store.forecast(ward, str(o.date()), 2)
            return {"ward": ward, "expected_cases": f["horizons"][1]["predicted"], "tier": f["horizons"][1]["tier"]}

        def allocate():
            holder["plan"] = p = planner.plan(str(o.date()), 2, stock_pct=60, crews=15)
            t = p["totals"]
            return {"saline": f"{t['saline']['allocated']}/{t['saline']['required']}",
                    "kits": f"{t['kits']['allocated']}/{t['kits']['required']}",
                    "crews": f"{t['crews']['assigned']}/{t['crews']['needed']}",
                    "critical_wards": p["alerts"]["critical"]}

        def route():
            p = holder["plan"]
            return {"transfers": sum(x["patients"] for x in p["transfers"]),
                    "unplaced": sum(c["unplaced"] for c in p["pools"]), "cities": len(p["pools"])}

        def simulate():
            sim = planner.simulate(str(o.date()), None, 10)
            return {"crews": sim["crews_used"], "cases_prevented": sim["totals"]["prevented"], "roi": sim["totals"]["roi"]}

        def notices():
            p = holder["plan"]
            en, bn = dispatch.notices(p, "en"), dispatch.notices(p, "bn")
            html = dispatch.brief_html(p, "en")
            return {"notices": len(en) + len(bn), "brief_kb": round(len(html.encode()) / 1024, 1)}

        step("forecast", forecast)
        step("allocation", allocate)
        step("routing", route)
        step("simulator", simulate)
        step("dispatch", notices)

    return {"ok": all(s["ok"] for s in steps), "network_blocked": blocked, "origin": str(o.date()), "steps": steps,
            "external_services": []}
