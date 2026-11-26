"""Every sentence the backend can write must have a Bangla version in frontend/lib/i18n/backend.ts.

The sentences are produced by the real backend code (all branches of narrative.py, plus real forecasts), translated by
the real TypeScript module through Node, and checked for any English word left behind. Needs Node 23.6 or newer.
"""
import itertools
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from backend import narrative as nl
from backend.service import Store
from dengue_ews.config import HORIZONS, MODEL_PATH, TIERS
from dengue_ews.features import FEATURE_GROUPS, FEATURES

ROOT = Path(__file__).resolve().parent.parent
TRANSLATOR = ROOT / "frontend" / "lib" / "i18n" / "backend.ts"
KEPT_IN_ENGLISH = {"NS1", "IV"}  # medical codes used as they are in Bangla health writing

pytestmark = [pytest.mark.skipif(not MODEL_PATH.exists(), reason="run train.py first"),
              pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed to run the translator")]


@pytest.fixture(scope="module")
def store():
    return Store()


def collect(value, out: set, keys=("summary", "headline", "story", "actions", "warnings", "label", "city", "plain",
                                    "group", "top_feature", "name", "tier", "tiers", "tier_help", "tier_actions", "cities")):
    """Gather every user-facing string under the given keys of an API response."""
    def walk(v, wanted):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, wanted or k in keys)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x, wanted)
        elif isinstance(v, str) and wanted:
            out.add(v)
    walk(value, False)


def synthetic_sentences() -> set:
    """Every branch of the sentence builders."""
    out: set = set()
    label = "Ward 05, Dhaka South"
    features = [nl.plain_feature(f) for f in FEATURES]
    groups = [g for g in FEATURE_GROUPS if g != "Seasonality"]

    def row(h, predicted, tier, score):
        return {"h": h, "predicted": predicted, "lower": predicted * 0.5, "upper": predicted * 2, "score": score, "tier": tier}

    for tier, h, cases_now in itertools.product(TIERS, HORIZONS, [None, 0, 1, 7, 40]):
        for predicted in (1.0, 7.2, 30.0):
            peak = 4 if h != 4 else 1
            rows = [row(i, predicted, "Critical" if i == peak else tier, 90 if i == peak else 10) for i in HORIZONS]
            driver = {"group": "Temperature", "top_feature": "dew point", "weather": True, "effect_cases": 2.4}
            out_story = nl.forecast_story(label, rows, {i: [driver] for i in HORIZONS}, cases_now, h)
            collect(out_story, out)
    rows = [row(i, 5.0, "Medium", 30) for i in HORIZONS]
    for group, feature, effect in itertools.product(groups, features, [-3.0, -1.0, 0.1, 1.0, 12.5]):
        driver = {"group": group, "top_feature": feature, "weather": True, "effect_cases": effect}
        collect(nl.forecast_story(label, rows, {i: [driver] for i in HORIZONS}, 5, 2), out)

    rain, temp, hum = ["", "80% more rain", "70% less rain"], ["", "3°C warmer weather", "1.5°C cooler weather"], \
        ["", "8 points more humidity", "1 points less humidity"]
    for parts in itertools.product(["", "Your edited rainfall"], rain, temp, hum):
        p = [x for x in parts if x]
        changes = ", ".join(p[:-1]) + (" and " if len(p) > 1 else "") + p[-1] if p else ""
        for h, (before, after) in itertools.product(HORIZONS, [(5.0, 5.1), (5.0, 9.0), (12.0, 3.0), (7.2, 7.6)]):
            for old, new in (("Low", "Low"), ("Medium", "Critical")):
                out.add(nl.whatif_story(label, [row(h, before, old, 1)], [row(h, after, new, 1)], changes, h))

    out.update(features)
    out.update(FEATURE_GROUPS)
    out.update(nl.GROUP_PLAIN.values())
    out.update(a for actions in nl.ACTIONS.values() for a in actions)
    return out


def real_sentences(store: Store) -> set:
    out: set = set()
    collect(store.meta(), out)
    cities = [None, *store.meta()["cities"]]
    for origin, h, city in itertools.product(store.origins[::3], HORIZONS, cities):
        result = store.city(str(origin.date()), h, city)
        collect({"summary": result["summary"]}, out)
    for origin in store.origins:
        out.add(store.outlook(str(origin.date()))["summary"])
    for ward in sorted(store.city_of):
        for origin in store.origins[::13]:
            result = store.forecast(ward, str(origin.date()), 2)
            collect(result, out)
            feat = store.feat[(store.feat["ward_id"] == ward) & (store.feat["date"] == origin)]
            for h in HORIZONS:
                collect(nl.forecast_story(store.label(ward), result["horizons"], result["drivers"],
                                          feat["cases_now"].iloc[0], h), out)
    for h in HORIZONS:
        collect(store.performance("DSCC_Ward_05", h), out, keys=("label", "name", "tiers"))

    # prediction portal: carried-forward warnings and every validation message
    weeks = store.template("DSCC_Ward_05", 8)["weeks"]
    collect(store.predict_custom("DSCC_Ward_05", [{**w, "cases": None} for w in weeks], 2), out)
    gap = [{**w, "date": w["date"]} for w in weeks[::2]]
    late = [{**w, "date": f"2027-03-{1 + 7 * i:02d}"} for i, w in enumerate(weeks[:4])]
    for bad in (gap, late):
        with pytest.raises(ValueError) as error:
            store.predict_custom("DSCC_Ward_05", bad, 2)
        out.add(str(error.value))
    out.update(["Not enough history to compute the lag features.", "I couldn't find a ward called 'X1'.",
                "No city corporation called 'X1'.", "Request failed (500)"])
    return out


def translate(strings: list[str], tmp_path: Path) -> list[str]:
    (tmp_path / "in.json").write_text(json.dumps(strings), encoding="utf-8")
    script = tmp_path / "run.mjs"
    script.write_text(
        "import { readFileSync, writeFileSync } from 'node:fs';\n"
        f"const {{ translate }} = await import({json.dumps(TRANSLATOR.as_uri())});\n"
        f"const input = JSON.parse(readFileSync({json.dumps(str(tmp_path / 'in.json'))}, 'utf8'));\n"
        f"writeFileSync({json.dumps(str(tmp_path / 'out.json'))}, JSON.stringify(input.map(translate)));\n",
        encoding="utf-8")
    done = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8")
    assert done.returncode == 0, done.stderr
    return json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))


def leftovers(pairs):
    bad = []
    for english, bangla in pairs:
        text = re.sub(r"“.*?”", "", bangla)  # quoted ids typed by a user stay as typed
        words = [w for w in re.findall(r"[A-Za-z][A-Za-z0-9]*", text) if w not in KEPT_IN_ENGLISH]
        if words or re.search(r"[0-9]", re.sub(r"NS1", "", text)):
            bad.append((english, bangla))
    return bad


def test_every_backend_sentence_has_a_bangla_version(store, tmp_path):
    strings = sorted(synthetic_sentences() | real_sentences(store))
    assert len(strings) > 1000
    bad = leftovers(zip(strings, translate(strings, tmp_path)))
    assert not bad, f"{len(bad)} of {len(strings)} not fully translated, e.g. {bad[:8]}"


def test_numbers_survive_translation(store, tmp_path):
    """The Bangla sentence must carry exactly the numbers of the English one (dates are rewritten as words)."""
    strings = sorted(s for s in synthetic_sentences() | real_sentences(store) if not re.search(r"\d{4}-\d\d-\d\d", s))
    digits = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
    number = re.compile(r"\d+(?:[.,]\d+)*")
    wrong = []
    for english, bangla in zip(strings, translate(strings, tmp_path)):
        want = sorted(number.findall(english.replace("NS1", "")))
        got = sorted(number.findall(bangla.replace("NS1", "").translate(digits)))
        if want != got:
            wrong.append((english, bangla))
    assert not wrong, f"{len(wrong)} sentences changed numbers, e.g. {wrong[:5]}"
