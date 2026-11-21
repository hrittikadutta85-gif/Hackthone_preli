"""Turns model output into plain language a ward officer can act on.

The numbers come from the models; this module only decides how to say them.
"""
import re

import pandas as pd

ACTIONS = {
    "Low": [
        "Keep routine surveillance going. Nothing urgent this window.",
        "Use the quiet time to check larvicide and fogging stock.",
    ],
    "Medium": [
        "Inspect the usual breeding spots: clogged drains, open water tanks, discarded containers.",
        "Send a short community message about emptying standing water weekly.",
        "Check that larvicide and test kits are stocked before the window opens.",
    ],
    "High": [
        "Schedule larviciding and spraying in this ward before the window opens.",
        "Tell nearby clinics and hospitals to expect more fever cases.",
        "Run door-to-door container clearing in the most waterlogged lanes.",
    ],
    "Critical": [
        "Send emergency vector-control teams now, not next week.",
        "Prepare hospital beds, NS1 test kits and IV fluids for a surge.",
        "Ask clinics for daily case counts so the plan can change quickly.",
    ],
}

TIER_PLAIN = {
    "Low": "a quiet stretch",
    "Medium": "something to keep an eye on",
    "High": "a real outbreak risk",
    "Critical": "an emergency-level risk",
}

GROUP_PLAIN = {
    "Rainfall (multi-week lags)": "rainfall",
    "Temperature": "temperature",
    "Humidity": "humidity",
    "Recent cases (surveillance)": "recent case counts",
    "Ward vulnerability": "the ward's own conditions (drainage, crowding, sanitation)",
    "Seasonality": "the time of year",
}


def plain_feature(f: str) -> str:
    """rain_lag3 -> 'rain 3 weeks ago'. Used wherever a raw column name would otherwise reach a person."""
    if m := re.fullmatch(r"rain_lag(\d)", f):
        return f"rain {m[1]} week{'s' if m[1] != '1' else ''} ago"
    if m := re.fullmatch(r"temp_lag(\d)", f):
        return f"temperature {m[1]} week{'s' if m[1] != '1' else ''} ago"
    if m := re.fullmatch(r"hum_lag(\d)", f):
        return f"humidity {m[1]} week{'s' if m[1] != '1' else ''} ago"
    if m := re.fullmatch(r"cases_lag(\d)", f):
        return f"cases {m[1]} week{'s' if m[1] != '1' else ''} ago"
    return {
        "rainfall_mm": "this week's rain", "rain_sum_lag2_4": "total rain 2 to 4 weeks ago (breeding window)",
        "rain_sum_4w": "rain over the last 4 weeks", "rain_sum_8w": "rain over the last 8 weeks",
        "heavy_rain_weeks_4w": "number of very heavy rain weeks lately",
        "avg_temp_c": "this week's temperature", "temp_range_c": "day-night temperature swing",
        "temp_mean_4w": "average temperature over 4 weeks", "aedes_optimal_weeks_4w": "weeks in mosquito-friendly warmth",
        "relative_humidity_pct": "this week's humidity", "dew_point_c": "dew point",
        "hum_mean_4w": "average humidity over 4 weeks", "humid_weeks_4w": "very humid weeks lately",
        "cases_now": "cases this week", "cases_mean_4w": "average cases over 4 weeks",
        "cases_trend_2w": "how fast cases are rising", "city_cases_now": "cases across the whole city",
        "cases_last_year_target": "cases at this time last year",
        "log_pop_density": "how crowded the ward is", "water_logging_risk_index": "waterlogging risk",
        "sanitation_score": "sanitation", "vulnerability_index": "waterlogging combined with poor sanitation",
        "woy_sin": "time of year", "woy_cos": "time of year",
    }.get(f, f.replace("_", " "))


def ward_label(ward_id: str, city: str) -> str:
    num = ward_id.split("_")[-1]
    return f"Ward {num}, {city}"


def _cases(x: float) -> str:
    return f"{abs(x):.1f}".rstrip("0").rstrip(".") + (" case" if round(abs(x), 1) == 1 else " cases")


def week_phrase(h: int) -> str:
    return "next week" if h == 1 else f"in {h} weeks"


def forecast_story(label: str, rows: list[dict], drivers_by_h: dict[int, list[dict]], cases_now: float,
                   focus_h: int) -> dict:
    """Headline, a few sentences and actions for the chosen early-warning window."""
    row = next(r for r in rows if r["h"] == focus_h)
    peak = max(rows, key=lambda r: r["score"])
    tier = row["tier"]

    if tier == "Low":
        headline = f"{label} looks calm {week_phrase(focus_h)}."
    elif tier == "Medium":
        headline = f"{label} is worth watching {week_phrase(focus_h)}."
    else:
        headline = f"{label} is heading toward {tier} risk {week_phrase(focus_h)}."

    story = [f"The model expects about {row['predicted']:.0f} case{'s' if round(row['predicted']) != 1 else ''} "
             f"that week, most likely between {row['lower']:.0f} and {row['upper']:.0f}. "
             f"That's {TIER_PLAIN[tier]}."]
    if cases_now is not None and pd.notna(cases_now):
        diff = row["predicted"] - cases_now
        if abs(diff) >= 1:
            story.append(f"This week there {'were' if round(cases_now) != 1 else 'was'} {cases_now:.0f} reported, "
                         f"so cases are expected to {'climb' if diff > 0 else 'fall'}.")
        else:
            story.append(f"That's close to this week's {cases_now:.0f} reported cases, so no big change is expected.")

    drivers = drivers_by_h[focus_h]
    weather = sorted((d for d in drivers if d["weather"]), key=lambda d: -abs(d["effect_cases"]))
    if weather and abs(weather[0]["effect_cases"]) >= 0.3:
        d = weather[0]
        story.append(f"The biggest weather factor is {GROUP_PLAIN[d['group']]}, mainly {d['top_feature']}. "
                     f"Compared with a typical week at this time of year, it "
                     f"{'adds' if d['effect_cases'] > 0 else 'removes'} about {_cases(d['effect_cases'])}.")
    else:
        story.append("Weather isn't moving the forecast much right now.")

    if peak["h"] != focus_h and peak["tier"] != tier and peak["score"] > row["score"]:
        story.append(f"Heads up: risk climbs to {peak['tier']} {week_phrase(peak['h'])}.")
    return {"headline": headline, "story": story, "actions": ACTIONS[tier]}


def _n(a: float, b: float) -> tuple[str, str]:
    """Format two case counts, adding a decimal only when whole numbers would look identical."""
    return (f"{a:.1f}", f"{b:.1f}") if round(a) == round(b) else (f"{a:.0f}", f"{b:.0f}")


def whatif_story(label: str, base: list[dict], scen: list[dict], changes: str, h: int) -> str:
    """One sentence comparing the scenario with recorded weather at the chosen horizon."""
    b = next(r for r in base if r["h"] == h)
    s = next(r for r in scen if r["h"] == h)
    delta = s["predicted"] - b["predicted"]
    if not changes:
        return "Nothing changed yet. Move a slider to see how the weather could shift the picture."
    bn, sn = _n(b["predicted"], s["predicted"])
    if abs(delta) < 0.3:
        return (f"{changes} would barely move {label}'s forecast. It stays {s['tier']} "
                f"(about {sn} cases {week_phrase(h)}).")
    word = "raise" if delta > 0 else "lower"
    tail = f"moving it from {b['tier']} to {s['tier']}" if b["tier"] != s["tier"] else f"keeping it at {s['tier']}"
    return f"{changes} would {word} the forecast {week_phrase(h)} from {bn} to {sn} cases, {tail}."
