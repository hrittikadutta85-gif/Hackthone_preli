"""Ward dispatch notices: SMS, WhatsApp and a printable commissioner brief, in English or Bangla.

Plain string templates filled from the operations plan (backend/planner.py). No LLM, no network, no randomness:
the same plan always produces the same text, so notices still go out when the internet or an AI service is down.
"""
import html
import math
from datetime import date

ACTIONS = {
    "en": {
        "Low": ["Keep routine surveillance going.", "Check larvicide and fogging stock."],
        "Medium": ["Inspect breeding spots: drains, tanks, containers.", "Send a community message on emptying standing water."],
        "High": ["Larvicide and spray this ward before the window opens.", "Warn clinics and hospitals to expect more fever cases."],
        "Critical": ["Send emergency vector-control teams now.", "Prepare beds, NS1 kits and IV fluids for a surge."],
    },
    "bn": {
        "Low": ["নিয়মিত নজরদারি চালিয়ে যান।", "লার্ভানাশক ও ফগিং সামগ্রীর মজুত যাচাই করুন।"],
        "Medium": ["প্রজননস্থল পরিদর্শন করুন: ড্রেন, ট্যাংক, পাত্র।", "জমা পানি ফেলে দিতে এলাকাবাসীকে বার্তা দিন।"],
        "High": ["ঝুঁকির সময়ের আগেই এই ওয়ার্ডে লার্ভানাশক ও স্প্রে দিন।", "ক্লিনিক ও হাসপাতালকে জ্বরের রোগী বাড়ার সতর্কতা দিন।"],
        "Critical": ["এখনই জরুরি মশক নিয়ন্ত্রণ দল পাঠান।", "শয্যা, NS1 কিট ও স্যালাইন (IV) প্রস্তুত রাখুন।"],
    },
}

TIER = {"en": {"Low": "Low", "Medium": "Medium", "High": "High", "Critical": "Critical"},
        "bn": {"Low": "কম", "Medium": "মাঝারি", "High": "উচ্চ", "Critical": "সংকটজনক"}}
CITY_BN = {"Chattogram": "চট্টগ্রাম", "Dhaka North": "ঢাকা উত্তর", "Dhaka South": "ঢাকা দক্ষিণ", "Gazipur": "গাজীপুর",
           "Narayanganj": "নারায়ণগঞ্জ"}
MONTH = {"en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
         "bn": ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর",
                "নভেম্বর", "ডিসেম্বর"]}
RES_NAME = {"en": {"saline": "saline", "kits": "kits", "beds": "beds"},
            "bn": {"saline": "স্যালাইন", "kits": "কিট", "beds": "শয্যা"}}
BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
SMS_LIMIT = 160        # one GSM-7 segment
UCS2_SINGLE, UCS2_PART = 70, 67


def digits(s, lang: str) -> str:
    return str(s).translate(BN_DIGITS) if lang == "bn" else str(s)


def short_date(iso: str, lang: str, year: bool = False) -> str:
    d = date.fromisoformat(iso)
    out = f"{d.day} {MONTH[lang][d.month - 1]}" + (f" {d.year}" if year else "")
    return digits(out, lang)


def code(ward: str) -> str:
    """DSCC_Ward_05 -> DSCC-05 (short enough for SMS, unambiguous for field teams)."""
    prefix, _, num = ward.partition("_Ward_")
    return f"{prefix}-{num}"


def ward_name(w: dict, lang: str) -> str:
    num = w["ward"].split("_")[-1]
    return f"ওয়ার্ড {digits(num, 'bn')}, {CITY_BN.get(w['city'], w['city'])}" if lang == "bn" else w["label"]


def city_name(city: str, lang: str) -> str:
    return CITY_BN.get(city, city) if lang == "bn" else city


def segments(text: str) -> tuple[str, int]:
    """SMS encoding and how many message parts the text needs."""
    if all(ord(ch) < 128 for ch in text):
        return "GSM-7", max(1, math.ceil(len(text) / 153)) if len(text) > SMS_LIMIT else 1
    return "UCS-2", 1 if len(text) <= UCS2_SINGLE else math.ceil(len(text) / UCS2_PART)


# ------------------------------------------------------------------ SMS
def pts(k: int) -> str:
    return f"{k} pt" if k == 1 else f"{k} pts"


def sms(w: dict, plan: dict, lang: str) -> str:
    cases = round(w["predicted"])
    req, got = w["required"], w["allocated"]
    if lang == "bn":
        head = (f"ডেঙ্গু {code(w['ward'])} সপ্তাহ {short_date(plan['target_date'], 'bn')}: "
                f"সম্ভাব্য রোগী {digits(cases, 'bn')} ({TIER['bn'][w['tier']]})।")
        supplies = (f" স্যালাইন {digits(got['saline'], 'bn')}/{digits(req['saline'], 'bn')}, "
                    f"কিট {digits(got['kits'], 'bn')}/{digits(req['kits'], 'bn')}, "
                    f"শয্যা {digits(got['beds'], 'bn')}/{digits(req['beds'], 'bn')}। দল {digits(w['crews'], 'bn')}।")
        flags = []
        if w["deficits"]:
            flags.append(" ঘাটতি: " + ", ".join(RES_NAME["bn"][r] for r in w["deficits"]) + "।")
        sent = sum(t["patients"] for t in w["transfers_out"])
        if sent:
            flags.append(f" {digits(sent, 'bn')} রোগী পাঠান: " + ", ".join(code(t["ward"]) for t in w["transfers_out"]) + "।")
        recv = sum(t["patients"] for t in w["transfers_in"])
        if recv:
            flags.append(f" {digits(recv, 'bn')} রোগী গ্রহণ করুন।")
        if not flags:
            flags.append(" সরবরাহ পূর্ণ।")
        return head + supplies + "".join(flags)

    head = f"DENGUE {code(w['ward'])} wk {short_date(plan['target_date'], 'en')}: {cases} cases exp ({w['tier'].upper()})."
    supplies = (f" Saline {got['saline']}/{req['saline']} Kits {got['kits']}/{req['kits']} "
                f"Beds {got['beds']}/{req['beds']}. Crews {w['crews']}.")
    sent = sum(t["patients"] for t in w["transfers_out"])
    recv = sum(t["patients"] for t in w["transfers_in"])
    unplaced = w["beds"]["unplaced"]
    # The most important flags first; longer forms are swapped for shorter ones until the text fits one SMS.
    variants = []
    for detail in (True, False):
        parts = []
        if w["deficits"]:
            parts.append(" SHORT: " + ",".join(w["deficits"]) + ".")
        if sent:
            parts.append(f" Send {pts(sent)} to " + ",".join(code(t["ward"]) for t in w["transfers_out"]) + "."
                         if detail else f" Send {pts(sent)} to {len(w['transfers_out'])} wards.")
        if recv:
            parts.append(f" Receive {pts(recv)}" + (" from " + ",".join(code(t["ward"]) for t in w["transfers_in"]) if detail else "") + ".")
        if unplaced:
            parts.append(f" {pts(unplaced)} NO BED.")
        if not parts:
            parts.append(" Supplies OK.")
        variants.append(head + supplies + "".join(parts))
    for v in variants:
        if len(v) <= SMS_LIMIT:
            return v
    return variants[-1][:SMS_LIMIT - 1] + "~"


# ------------------------------------------------------------------ WhatsApp
def whatsapp(w: dict, plan: dict, lang: str) -> str:
    req, got, short, b = w["required"], w["allocated"], w["shortfall"], w["beds"]
    n = lambda v: digits(v, lang)  # noqa: E731
    lines = []
    if lang == "bn":
        lines += [f"🦟 *ডেঙ্গু নির্দেশনা · {ward_name(w, 'bn')}*",
                  f"সপ্তাহ: {short_date(plan['target_date'], 'bn', True)} · পূর্বাভাস {short_date(plan['origin'], 'bn')} "
                  f"({n(plan['horizon'])} সপ্তাহ আগে)",
                  f"ঝুঁকি: *{TIER['bn'][w['tier']]}* (স্কোর {n(round(w['score']))}/১০০) · অগ্রাধিকার #{n(w['rank'])}",
                  f"সম্ভাব্য রোগী: *{n(round(w['predicted']))}* (সম্ভাব্য সীমা {n(round(w['lower']))}–{n(round(w['upper']))})",
                  "", "*সরবরাহ (বরাদ্দ / প্রয়োজন)*"]
        for key, icon in (("saline", "💧"), ("kits", "🧪")):
            warn = f" ⚠️ ঘাটতি {n(short[key])}" if short[key] else " ✅"
            lines.append(f"{icon} {RES_NAME['bn'][key]}: {n(got[key])} / {n(req[key])}{warn}")
        warn = f" ⚠️ শয্যা নেই {n(b['unplaced'])}" if b["unplaced"] else " ✅"
        lines.append(f"🛏️ শয্যা: {n(got['beds'])} / {n(req['beds'])} (নিজ ওয়ার্ডে {n(b['local'])}, অন্যত্র {n(b['sent'])}){warn}")
        lines += ["", f"*মশক নিয়ন্ত্রণ:* {n(w['crews'])} টি দল (প্রয়োজন {n(w['crews_needed'])})"]
        for t in w["transfers_out"]:
            lines.append(f"🚑 {n(t['patients'])} রোগী পাঠান → {ward_name({'ward': t['ward'], 'city': w['city'], 'label': t['label']}, 'bn')}")
        for t in w["transfers_in"]:
            lines.append(f"🏥 {n(t['patients'])} রোগী আসবে ← {ward_name({'ward': t['ward'], 'city': w['city'], 'label': t['label']}, 'bn')}")
        if w["deficits"]:
            lines.append("🚨 *ঘাটতি সতর্কতা:* " + ", ".join(RES_NAME["bn"][r] for r in w["deficits"]) + " — জরুরি সরবরাহ চান।")
        lines += ["", "*করণীয়*"] + [f"• {a}" for a in ACTIONS["bn"][w["tier"]]]
        lines.append("_ডেঙ্গু ওয়াচ · স্বয়ংক্রিয় নির্দেশনা_")
        return "\n".join(lines)

    lines += [f"🦟 *Dengue dispatch · {w['label']}*",
              f"Week of {short_date(plan['target_date'], 'en', True)} · forecast made {short_date(plan['origin'], 'en')} "
              f"({plan['horizon']} wk ahead)",
              f"Risk: *{w['tier'].upper()}* (score {round(w['score'])}/100) · priority #{w['rank']}",
              f"Expected cases: *{round(w['predicted'])}* (likely {round(w['lower'])}–{round(w['upper'])})",
              "", "*Supplies (allocated / required)*"]
    for key, icon, name in (("saline", "💧", "Saline bags"), ("kits", "🧪", "Test kits")):
        warn = f" ⚠️ short {short[key]}" if short[key] else " ✅"
        lines.append(f"{icon} {name}: {got[key]} / {req[key]}{warn}")
    warn = f" ⚠️ {b['unplaced']} without a bed" if b["unplaced"] else " ✅"
    lines.append(f"🛏️ Beds: {got['beds']} / {req['beds']} (own ward {b['local']}, elsewhere {b['sent']}){warn}")
    lines += ["", f"*Vector control:* {w['crews']} crew{'s' if w['crews'] != 1 else ''} assigned (needs {w['crews_needed']})"]
    for t in w["transfers_out"]:
        lines.append(f"🚑 Send {t['patients']} patient{'s' if t['patients'] != 1 else ''} → {t['label']}")
    for t in w["transfers_in"]:
        lines.append(f"🏥 Expect {t['patients']} patient{'s' if t['patients'] != 1 else ''} ← {t['label']}")
    if w["deficits"]:
        lines.append("🚨 *Deficit alert:* " + ", ".join(w["deficits"]) + " — request emergency resupply.")
    lines += ["", "*Actions*"] + [f"• {a}" for a in ACTIONS["en"][w["tier"]]]
    lines.append("_Dengue Watch · automated dispatch_")
    return "\n".join(lines)


def needs_notice(w: dict) -> bool:
    """A ward gets a notice if it has something to act on: a deficit, a transfer, crews, or Medium risk and up."""
    return bool(w["deficits"] or w["transfers_out"] or w["transfers_in"] or w["crews"] or w["tier"] != "Low")


def notices(plan: dict, lang: str = "en", only_actionable: bool = True) -> list[dict]:
    out = []
    for w in plan["wards"]:
        if only_actionable and not needs_notice(w):
            continue
        text = sms(w, plan, lang)
        enc, parts = segments(text)
        out.append({"ward": w["ward"], "label": w["label"], "city": w["city"], "tier": w["tier"], "rank": w["rank"],
                    "status": w["status"], "sms": text, "sms_chars": len(text), "sms_encoding": enc,
                    "sms_parts": parts, "whatsapp": whatsapp(w, plan, lang)})
    return out


# ------------------------------------------------------------------ printable brief
L = {
    "en": {"title": "Dengue operations brief", "for": "Commissioner brief", "scope_all": "All five city corporations",
           "week": "Forecast week", "made": "Forecast made", "ahead": "weeks ahead", "params": "Plan settings",
           "stock": "Regional stock", "crews": "Spraying crews", "basis": "Planned for",
           "basis_expected": "expected cases", "basis_upper": "the likely-high case (upper 80% bound)",
           "kpi_cases": "Expected cases", "kpi_alert": "Wards at High or Critical", "kpi_critical": "Critical supply deficits",
           "kpi_saline": "Saline bags allocated", "kpi_kits": "Test kits allocated", "kpi_beds": "Patients with a bed",
           "kpi_crews": "Crews assigned", "pools": "Hospital beds by city (overflow routed within each city)",
           "city": "City", "capacity": "Beds open", "demand": "Beds needed", "util_before": "Load before routing",
           "util_after": "Occupancy after", "moved": "Moved", "unplaced": "No bed", "headroom": "Spare beds",
           "wards": "Ward allocation (highest priority first)", "rank": "#", "ward": "Ward", "risk": "Risk",
           "cases": "Exp. cases", "saline": "Saline", "kits": "Kits", "beds": "Beds", "crews_col": "Crews",
           "status": "Status", "transfers": "Patient transfers", "from": "From", "to": "To", "patients": "Patients",
           "no_transfers": "No transfers needed: every ward has enough beds, or its city has none to spare.",
           "alerts": "Ward dispatch notes", "no_alerts": "No ward is short of supplies.",
           "status_ok": "OK", "status_deficit": "Deficit", "status_critical": "CRITICAL",
           "short": "short", "actions": "Actions", "send": "Send", "receive": "Receive from",
           "foot": "Generated locally by Dengue Watch from the ML forecast with fixed rules and templates: no internet "
                   "or AI service is needed. Supplies use the dataset's own per-case rule; scarce stock goes to the "
                   "riskiest, densest wards first; overflow patients only move within their city.",
           "print": "Print or save as PDF"},
    "bn": {"title": "ডেঙ্গু কার্যক্রম ব্রিফ", "for": "কমিশনার ব্রিফ", "scope_all": "পাঁচটি সিটি কর্পোরেশন",
           "week": "পূর্বাভাসের সপ্তাহ", "made": "পূর্বাভাস তৈরি", "ahead": "সপ্তাহ আগে", "params": "পরিকল্পনার সেটিং",
           "stock": "আঞ্চলিক মজুত", "crews": "স্প্রে দল", "basis": "পরিকল্পনার ভিত্তি",
           "basis_expected": "সম্ভাব্য রোগী", "basis_upper": "উচ্চ সম্ভাবনা (৮০% সীমার ঊর্ধ্ব প্রান্ত)",
           "kpi_cases": "সম্ভাব্য রোগী", "kpi_alert": "উচ্চ বা সংকটজনক ওয়ার্ড", "kpi_critical": "গুরুতর সরবরাহ ঘাটতি",
           "kpi_saline": "বরাদ্দকৃত স্যালাইন", "kpi_kits": "বরাদ্দকৃত টেস্ট কিট", "kpi_beds": "শয্যা পাওয়া রোগী",
           "kpi_crews": "নিযুক্ত দল", "pools": "শহরভিত্তিক হাসপাতাল শয্যা (অতিরিক্ত রোগী একই শহরে স্থানান্তর)",
           "city": "শহর", "capacity": "খোলা শয্যা", "demand": "প্রয়োজনীয় শয্যা", "util_before": "স্থানান্তরের আগে চাপ",
           "util_after": "স্থানান্তরের পরে", "moved": "স্থানান্তর", "unplaced": "শয্যা নেই", "headroom": "খালি শয্যা",
           "wards": "ওয়ার্ডভিত্তিক বরাদ্দ (সর্বোচ্চ অগ্রাধিকার আগে)", "rank": "#", "ward": "ওয়ার্ড", "risk": "ঝুঁকি",
           "cases": "সম্ভাব্য রোগী", "saline": "স্যালাইন", "kits": "কিট", "beds": "শয্যা", "crews_col": "দল",
           "status": "অবস্থা", "transfers": "রোগী স্থানান্তর", "from": "থেকে", "to": "যেখানে", "patients": "রোগী",
           "no_transfers": "স্থানান্তরের প্রয়োজন নেই: প্রতিটি ওয়ার্ডে যথেষ্ট শয্যা আছে, অথবা শহরে খালি শয্যা নেই।",
           "alerts": "ওয়ার্ডভিত্তিক নির্দেশনা", "no_alerts": "কোনো ওয়ার্ডে সরবরাহ ঘাটতি নেই।",
           "status_ok": "ঠিক আছে", "status_deficit": "ঘাটতি", "status_critical": "গুরুতর",
           "short": "ঘাটতি", "actions": "করণীয়", "send": "পাঠান", "receive": "গ্রহণ করুন",
           "foot": "ডেঙ্গু ওয়াচ এই ব্রিফটি এমএল পূর্বাভাস থেকে নির্দিষ্ট নিয়ম ও টেমপ্লেটে এই কম্পিউটারেই তৈরি করেছে: "
                   "ইন্টারনেট বা এআই সেবা লাগে না। সরবরাহের হিসাব ডেটাসেটের প্রতি-রোগী নিয়মে; সীমিত মজুত আগে সবচেয়ে "
                   "ঝুঁকিপূর্ণ ও ঘনবসতিপূর্ণ ওয়ার্ডে যায়; অতিরিক্ত রোগী কেবল নিজ শহরের ভেতরে স্থানান্তর হয়।",
           "print": "প্রিন্ট বা PDF হিসেবে সংরক্ষণ"},
}


def brief_html(plan: dict, lang: str = "en") -> str:
    """A self-contained, printable HTML brief (A4). No external fonts, scripts or images."""
    t = L[lang]
    e = html.escape
    n = lambda v: digits(v, lang)  # noqa: E731
    pct = lambda v: n(f"{round(v * 100)}%")  # noqa: E731
    wards, tot = plan["wards"], plan["totals"]
    scope = city_name(plan["city"], lang) if plan["city"] else t["scope_all"]
    status = {"ok": t["status_ok"], "deficit": t["status_deficit"], "critical": t["status_critical"]}
    tier_color = {"Low": "#1f8a4c", "Medium": "#b58900", "High": "#d9640b", "Critical": "#c0182b"}
    cases = round(sum(w["predicted"] for w in wards))
    alert = sum(w["tier"] in ("High", "Critical") for w in wards)
    placed = tot["beds"]["allocated"]

    def kpi(label, value, warn=False):
        return f'<div class="kpi{" warn" if warn else ""}"><b>{value}</b><span>{e(label)}</span></div>'

    def ratio(k):
        return f'{n(tot[k]["allocated"])} / {n(tot[k]["required"])}'

    def cell(w, k):
        cls = ' class="short"' if w["shortfall"][k] else ""
        return f'<td{cls}>{n(w["allocated"][k])}/{n(w["required"][k])}</td>'

    rows = "".join(
        f'<tr><td>{n(w["rank"])}</td><td>{e(ward_name(w, lang))}</td>'
        f'<td><span class="tier" style="color:{tier_color[w["tier"]]}">{e(TIER[lang][w["tier"]])}</span></td>'
        f'<td>{n(round(w["predicted"]))}</td>{cell(w, "saline")}{cell(w, "kits")}{cell(w, "beds")}'
        f'<td>{n(w["crews"])}/{n(w["crews_needed"])}</td><td class="st-{w["status"]}">{e(status[w["status"]])}</td></tr>'
        for w in wards)
    pools = "".join(
        f'<tr><td>{e(city_name(c["city"], lang))}</td><td>{n(c["capacity"])}</td><td>{n(c["demand"])}</td>'
        f'<td>{pct(c["utilization_before"])}</td><td>{pct(c["utilization_after"])}</td><td>{n(c["transferred"])}</td>'
        f'<td class="{"short" if c["unplaced"] else ""}">{n(c["unplaced"])}</td><td>{n(c["headroom"])}</td></tr>'
        for c in plan["pools"])
    by_id = {w["ward"]: w for w in wards}
    transfers = "".join(
        f'<tr><td>{e(city_name(x["city"], lang))}</td><td>{e(ward_name(by_id[x["from"]], lang))}</td>'
        f'<td>{e(ward_name(by_id[x["to"]], lang))}</td><td>{n(x["patients"])}</td></tr>' for x in plan["transfers"])
    cards = []
    for w in wards:
        if w["status"] == "ok":
            continue
        shorts = ", ".join(f'{RES_NAME[lang][k]} {t["short"]} {n(w["shortfall"][k])}' for k in w["deficits"])
        moves = "".join(f'<li>🚑 {t["send"]} {n(x["patients"])} → {e(ward_name({"ward": x["ward"], "city": w["city"], "label": x["label"]}, lang))}</li>'
                        for x in w["transfers_out"])
        acts = "".join(f"<li>{e(a)}</li>" for a in ACTIONS[lang][w["tier"]])
        cards.append(
            f'<div class="card st-border-{w["status"]}"><h4>#{n(w["rank"])} · {e(ward_name(w, lang))} · '
            f'<span style="color:{tier_color[w["tier"]]}">{e(TIER[lang][w["tier"]])}</span></h4>'
            f'<p><b>{e(status[w["status"]])}</b>: {e(shorts)}</p><ul>{moves}{acts}</ul></div>')

    basis = t["basis_upper"] if plan["basis"] == "upper" else t["basis_expected"]
    p = plan["params"]
    share = lambda v: n(format(v, "g") + "%")  # noqa: E731
    if p["saline_pct"] == p["kits_pct"] == p["beds_pct"]:
        stock = share(p["stock_pct"])
    else:
        stock = " · ".join(f"{t[k]} {share(p[k + '_pct'])}" for k in ("saline", "kits", "beds"))
    if transfers:
        head = "".join(f"<th>{e(t[k])}</th>" for k in ("city", "from", "to", "patients"))
        transfers_block = f'<div class="wide"><table><thead><tr>{head}</tr></thead><tbody>{transfers}</tbody></table></div>'
    else:
        transfers_block = f"<p>{e(t['no_transfers'])}</p>"
    cards_block = f'<div class="cards">{"".join(cards)}</div>' if cards else f"<p>{e(t['no_alerts'])}</p>"
    return f"""<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(t['title'])} · {e(scope)} · {e(plan['target_date'])}</title>
<style>
  :root {{ color-scheme: light; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #eef1f4; color: #14202b; font: 13px/1.45 "Segoe UI", "Noto Sans Bengali", "Nirmala UI", system-ui, sans-serif; }}
  .page {{ max-width: 960px; margin: 24px auto; background: #fff; padding: 32px 36px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }}
  header {{ display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0f766e; padding-bottom: 14px; }}
  h1 {{ margin: 0; font-size: 22px; }} h2 {{ font-size: 15px; margin: 22px 0 8px; color: #0f766e; }}
  h4 {{ margin: 0 0 4px; font-size: 13px; }}
  .kicker {{ text-transform: uppercase; letter-spacing: .08em; font-size: 10.5px; color: #5b6b78; }}
  .meta {{ text-align: right; font-size: 12px; color: #3c4a56; }}
  .kpis {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 16px; }}
  .kpi {{ border: 1px solid #d5dde3; border-radius: 8px; padding: 8px 10px; }}
  .kpi b {{ display: block; font-size: 18px; }} .kpi span {{ font-size: 11px; color: #5b6b78; }}
  .kpi.warn {{ border-color: #e8a0a8; background: #fdf1f2; }} .kpi.warn b {{ color: #b3121f; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ border-bottom: 1px solid #e3e8ec; padding: 5px 6px; text-align: left; font-variant-numeric: tabular-nums; }}
  th {{ background: #f4f7f9; font-weight: 600; }}
  td.short {{ color: #b3121f; font-weight: 600; }}
  .tier {{ font-weight: 600; }}
  .st-critical {{ color: #b3121f; font-weight: 700; }} .st-deficit {{ color: #b45309; font-weight: 600; }} .st-ok {{ color: #1f8a4c; }}
  .cards {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }}
  .card {{ border: 1px solid #d5dde3; border-left-width: 4px; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }}
  .card p {{ margin: 0 0 4px; }} .card ul {{ margin: 0; padding-left: 18px; }}
  .st-border-critical {{ border-left-color: #c0182b; }} .st-border-deficit {{ border-left-color: #d9840b; }}
  footer {{ margin-top: 22px; padding-top: 10px; border-top: 1px solid #d5dde3; font-size: 11px; color: #5b6b78; }}
  .toolbar {{ max-width: 960px; margin: 16px auto 0; text-align: right; }}
  .toolbar button {{ font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #0f766e; background: #0f766e; color: #fff; cursor: pointer; }}
  @media (max-width: 640px) {{ .page {{ margin: 0; padding: 18px 16px; border-radius: 0; }} header {{ flex-direction: column; }} .meta {{ text-align: left; }} .wide {{ overflow-x: auto; }} }}
  @media print {{ body {{ background: #fff; }} .page {{ margin: 0; box-shadow: none; padding: 0; max-width: none; }} .toolbar {{ display: none; }}
                  @page {{ size: A4; margin: 14mm; }} tr, .card {{ break-inside: avoid; }} }}
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">{e(t['print'])}</button></div>
<div class="page">
<header>
  <div><div class="kicker">{e(t['for'])}</div><h1>{e(t['title'])} · {e(scope)}</h1></div>
  <div class="meta">
    <div><b>{e(t['week'])}:</b> {short_date(plan['target_date'], lang, True)}</div>
    <div><b>{e(t['made'])}:</b> {short_date(plan['origin'], lang, True)} ({n(plan['horizon'])} {e(t['ahead'])})</div>
    <div><b>{e(t['stock'])}:</b> {stock} · <b>{e(t['crews'])}:</b> {n(p['crews'])}</div>
    <div><b>{e(t['basis'])}:</b> {e(basis)}</div>
  </div>
</header>
<div class="kpis">
  {kpi(t['kpi_cases'], n(cases))}
  {kpi(t['kpi_alert'], n(alert), alert > 0)}
  {kpi(t['kpi_critical'], n(plan['alerts']['critical']), plan['alerts']['critical'] > 0)}
  {kpi(t['kpi_saline'], ratio('saline'), tot['saline']['shortfall'] > 0)}
  {kpi(t['kpi_kits'], ratio('kits'), tot['kits']['shortfall'] > 0)}
  {kpi(t['kpi_beds'], f"{n(placed)} / {n(tot['beds']['required'])}", tot['beds']['shortfall'] > 0)}
  {kpi(t['kpi_crews'], f"{n(tot['crews']['assigned'])} / {n(tot['crews']['needed'])}", tot['crews']['wards_short'] > 0)}
</div>
<h2>{e(t['pools'])}</h2>
<div class="wide"><table><thead><tr><th>{e(t['city'])}</th><th>{e(t['capacity'])}</th><th>{e(t['demand'])}</th><th>{e(t['util_before'])}</th>
<th>{e(t['util_after'])}</th><th>{e(t['moved'])}</th><th>{e(t['unplaced'])}</th><th>{e(t['headroom'])}</th></tr></thead><tbody>{pools}</tbody></table></div>
<h2>{e(t['transfers'])}</h2>
{transfers_block}
<h2>{e(t['alerts'])}</h2>
{cards_block}
<h2>{e(t['wards'])}</h2>
<div class="wide"><table><thead><tr><th>{e(t['rank'])}</th><th>{e(t['ward'])}</th><th>{e(t['risk'])}</th><th>{e(t['cases'])}</th><th>{e(t['saline'])}</th>
<th>{e(t['kits'])}</th><th>{e(t['beds'])}</th><th>{e(t['crews_col'])}</th><th>{e(t['status'])}</th></tr></thead><tbody>{rows}</tbody></table></div>
<footer>{e(t['foot'])}</footer>
</div></body></html>"""
