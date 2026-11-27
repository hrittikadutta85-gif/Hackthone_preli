"""Location search across Bangladesh: divisions, districts, city corporations, neighbourhoods, dataset wards and
localities that administrators added.

Matching is forgiving: partial words ("chatt"), common romanisations ("Chittagong", "Comilla", "Jessore"), a
vowel-free consonant skeleton for spelling variants ("Mojjafor Nogor" ~ "Muzaffar Nagar"), and Bangla script.
When only part of a query matches (e.g. "Mojjafor Nogor, Chattogram" where only "Chattogram" is known), the
answer says which words were not found instead of pretending to have an exact match.
"""
from __future__ import annotations

import difflib
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

GAZETTEER = Path(__file__).with_name("gazetteer.json")

# tie-break when two places match equally well: the larger, better-known unit first
KIND_RANK = {"city_corporation": 0, "district": 1, "division": 2, "neighbourhood": 3, "locality": 3, "ward": 4, "osm": 5}
CITY_KEY = {"Dhaka North": "DNCC", "Dhaka South": "DSCC", "Chattogram": "CCC", "Gazipur": "GCC", "Narayanganj": "NCC"}
CITY_BN = {"Dhaka North": "ঢাকা উত্তর", "Dhaka South": "ঢাকা দক্ষিণ", "Chattogram": "চট্টগ্রাম", "Gazipur": "গাজীপুর",
           "Narayanganj": "নারায়ণগঞ্জ"}
BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
STOP = {"city", "corporation", "district", "division", "zila", "zilla", "ward", "bangladesh", "the", "area", "thana",
        "সিটি", "কর্পোরেশন", "জেলা", "বিভাগ", "ওয়ার্ড", "বাংলাদেশ"}


def normalise(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().replace("'", "").replace("’", "")
    s = s.translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789"))
    return re.sub(r"[^\w\u0980-\u09FF]+", " ", s).replace("_", " ").strip()  # keep Bangla vowel signs inside words


def tokens(s: str) -> list[str]:
    return [t for t in normalise(s).split() if t]


def skeleton(tok: str) -> str:
    """Consonant skeleton of a romanised word, so spelling variants meet: z->j, ph->f, v->b, drop vowels and an
    'h' after a consonant, collapse doubles. Bangla-script words are returned unchanged."""
    if not tok.isascii():
        return tok
    t = tok.replace("ph", "f").replace("z", "j").replace("v", "b").replace("q", "k").replace("x", "ks").replace("w", "")
    t = t[0] + re.sub(r"[aeiouy]", "", t[1:]) if t else t
    t = re.sub(r"(?<=[bcdfgjklmnprstk])h", "", t)
    return re.sub(r"(.)\1+", r"\1", t)


def token_score(q: str, cand: str) -> float:
    if q == cand:
        return 3.0
    if len(q) >= 2 and cand.startswith(q):
        return 2.5
    sq, sc = skeleton(q), skeleton(cand)
    if len(sq) >= 3 and sq == sc:
        return 2.2
    if len(sq) >= 3 and sc.startswith(sq):
        return 1.6
    if len(q) >= 4 and difflib.SequenceMatcher(None, q, cand).ratio() >= 0.82:
        return 1.3
    return 0.0


@lru_cache(maxsize=1)
def gazetteer() -> dict:
    return json.loads(GAZETTEER.read_text(encoding="utf-8"))


def ward_places(store) -> list[dict]:
    """The forecasting dataset's wards, as searchable places (no coordinates: the dataset has none)."""
    out = []
    by_cc = {p["city_corporation"]: p for p in gazetteer()["places"] if p["kind"] == "city_corporation"}
    for ward, city in sorted(store.city_of.items()):
        cc = by_cc[CITY_KEY[city]]
        num = ward.split("_")[-1]
        out.append({"id": f"ward:{ward}", "kind": "ward", "name": f"Ward {num}, {city}",
                    "name_bn": f"ওয়ার্ড {num.translate(BN_DIGITS)}, {CITY_BN[city]}", "aliases": [ward, f"{city} ward {num}"],
                    # a ward is found by its city code and number, not by the city name alone
                    "search_names": [CITY_KEY[city], cc["city_corporation"], num, str(int(num)), "ward"],
                    "ward": ward, "ward_number": num, "city_corporation": cc["city_corporation"], "dataset_city": city,
                    "district": cc["district"], "district_bn": cc["district_bn"], "division": cc["division"],
                    "division_bn": cc["division_bn"], "point": None})
    return out


def locality_places(db) -> list[dict]:
    rows = db.all("SELECT l.*, s.name AS source FROM localities l LEFT JOIN data_sources s ON s.id = l.source_id")
    g = {p["name"]: p for p in gazetteer()["places"] if p["kind"] in ("district", "division")}
    return [{"id": f"loc:{r['id']}", "kind": "locality", "name": r["name"], "name_bn": r["name_bn"],
             "aliases": json.loads(r["aliases"] or "[]"), "city_corporation": r["city_corporation"],
             "district": r["district"], "district_bn": (g.get(r["district"]) or {}).get("name_bn"),
             "division": r["division"], "division_bn": (g.get(r["division"]) or {}).get("name_bn"),
             "point": [r["lat"], r["lon"]], "verified": bool(r["verified"]), "source": r["source"]} for r in rows]


def all_places(store, db) -> list[dict]:
    return gazetteer()["places"] + ward_places(store) + locality_places(db)


def find(store, db, place_id: str) -> dict | None:
    return next((p for p in all_places(store, db) if p["id"] == place_id), None)


def search(store, db, query: str, limit: int = 8) -> dict:
    qt = [t for t in tokens(query) if t not in STOP] or tokens(query)
    if not qt:
        return {"query": query, "results": [], "unmatched": [], "partial": False}
    scored = []
    for p in all_places(store, db):
        own = set()
        for name in p.get("search_names") or [p["name"], p.get("name_bn") or "", *p.get("aliases", [])]:
            own.update(tokens(name))
        own -= STOP
        context = set()
        for k in ("district", "division", "district_bn", "division_bn", "dataset_city"):
            context.update(tokens(p.get(k) or ""))
        matched, total, own_hits = [], 0.0, 0
        for q in qt:
            best_own = max((token_score(q, c) for c in own), default=0.0)
            best_ctx = max((token_score(q, c) for c in context), default=0.0) * 0.55
            best = max(best_own, best_ctx)
            if best > 0:
                matched.append(q)
                total += best
                own_hits += best_own > 0
        if not own_hits:  # at least one query word must name the place itself, not just its district
            continue
        coverage = len(matched) / len(qt)
        scored.append((coverage, total / len(qt), -KIND_RANK.get(p["kind"], 9), p, matched))
    scored.sort(key=lambda x: (-x[0], -x[1], -x[2], x[3]["name"]))
    best_cov = scored[0][0] if scored else 0
    top = [s for s in scored if s[0] == best_cov][:limit]
    matched_words = set(top[0][4]) if top else set()
    unmatched = [q for q in qt if q not in matched_words]
    results = [{k: v for k, v in s[3].items() if k not in ("aliases", "search_names")} for s in top]
    return {"query": query, "results": results, "unmatched": unmatched, "partial": bool(top) and bool(unmatched)}
