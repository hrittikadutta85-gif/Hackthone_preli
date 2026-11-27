"""Write sample dispatch exports to /exports (SMS, WhatsApp, printable briefs, plan tables).

    python -m backend.export_samples                 # default scenario below
    python -m backend.export_samples --origin 2025-06-23 --stock 60 --crews 15

Runs fully offline (the network is switched off while it works). If Microsoft Edge or Google Chrome is installed, the
English brief is also printed to PDF with the browser's headless mode; otherwise the HTML brief is the printable copy.
"""
import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

from dengue_ews.config import ROOT

from . import dispatch
from .offline import no_network
from .planner import Planner
from .service import Store

OUT = ROOT / "exports"
BROWSERS = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "google-chrome", "chromium", "chromium-browser", "microsoft-edge"]


def browser() -> str | None:
    for b in BROWSERS:
        found = shutil.which(b) or (b if Path(b).exists() else None)
        if found:
            return found
    return None


def write_text(path: Path, text: str):
    path.write_text(text, encoding="utf-8", newline="\n")
    print("wrote", path.relative_to(ROOT).as_posix())


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Bangla and "�" on a Windows console
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin", default="2025-07-07")
    ap.add_argument("--horizon", type=int, default=2)
    ap.add_argument("--stock", type=float, default=70)
    ap.add_argument("--crews", type=int, default=20)
    ap.add_argument("--basis", default="upper", choices=["expected", "upper"])
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    with no_network():
        store = Store()
        planner = Planner(store)
        plan = planner.plan(args.origin, args.horizon, args.stock, args.crews, args.basis)
        sim = planner.simulate(args.origin, None, args.crews)
        notices = {lang: dispatch.notices(plan, lang) for lang in ("en", "bn")}
        briefs = {lang: dispatch.brief_html(plan, lang) for lang in ("en", "bn")}
        city_brief = dispatch.brief_html(planner.plan(args.origin, args.horizon, args.stock, args.crews, args.basis,
                                                      city="Dhaka South"), "en")

    scenario = (f"Forecast made {plan['origin']} for the week of {plan['target_date']} ({args.horizon} weeks ahead) · "
                f"regional stock {args.stock:g}% · {args.crews} spraying crews · planned for "
                f"{'the upper 80% bound' if args.basis == 'upper' else 'expected cases'}")

    for lang in ("en", "bn"):
        sms_lines = [f"# {scenario}", f"# {len(notices[lang])} ward notices, most urgent first", ""]
        wa_lines = [f"# {scenario}", ""]
        for x in notices[lang]:
            sms_lines += [f"[{x['ward']}] {x['sms_chars']} chars · {x['sms_encoding']} · {x['sms_parts']} part(s)", x["sms"], ""]
            wa_lines += [f"----- {x['ward']} -----", x["whatsapp"], ""]
        write_text(OUT / f"sms_alerts_{lang}.txt", "\n".join(sms_lines))
        write_text(OUT / f"whatsapp_alerts_{lang}.txt", "\n".join(wa_lines))
        write_text(OUT / f"commissioner_brief_{lang}.html", briefs[lang])
    write_text(OUT / "commissioner_brief_dhaka_south_en.html", city_brief)
    write_text(OUT / "dispatch_notices.json", json.dumps(
        {"scenario": scenario, "params": plan["params"], "origin": plan["origin"], "target_date": plan["target_date"],
         "notices": notices}, ensure_ascii=False, indent=1))

    with open(OUT / "allocation_plan.csv", "w", newline="", encoding="utf-8-sig") as f:
        cols = ["rank", "ward", "city", "tier", "risk_score", "density_sqkm", "priority", "expected_cases", "planned_cases",
                "saline_required", "saline_allocated", "kits_required", "kits_allocated", "beds_required",
                "beds_secured", "beds_open_locally", "patients_sent", "patients_received", "patients_without_bed",
                "crews_needed", "crews_assigned", "status"]
        wr = csv.writer(f)
        wr.writerow(cols)
        for w in plan["wards"]:
            wr.writerow([w["rank"], w["ward"], w["city"], w["tier"], w["score"], w["density"], w["priority"],
                         w["predicted"], w["planning_cases"], w["required"]["saline"], w["allocated"]["saline"],
                         w["required"]["kits"], w["allocated"]["kits"], w["required"]["beds"], w["allocated"]["beds"],
                         w["beds"]["capacity"], w["beds"]["sent"], w["beds"]["received"], w["beds"]["unplaced"],
                         w["crews_needed"], w["crews"], w["status"]])
    print("wrote exports/allocation_plan.csv")
    with open(OUT / "overflow_transfers.csv", "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["city", "from_ward", "to_ward", "patients"])
        for t in plan["transfers"]:
            wr.writerow([t["city"], t["from"], t["to"], t["patients"]])
    print("wrote exports/overflow_transfers.csv")
    with open(OUT / "vector_control_simulation.csv", "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["roi_rank", "ward", "city", "tier", "crews", "habitat_removed", "cases_wk2_4_without",
                     "cases_wk2_4_with", "cases_prevented", "cases_prevented_per_crew", "bed_weeks_saved", "saline_bags_saved"])
        for x in sim["ranking"]:
            wr.writerow([x["roi_rank"], x["ward"], x["city"], x["tier"], x["crews"], x["coverage"], x["baseline_cases"],
                         x["scenario_cases"], x["prevented"], x["roi"], x["beds_saved"], x["saline_saved"]])
    print("wrote exports/vector_control_simulation.csv")

    exe = browser()
    if exe:
        src = (OUT / "commissioner_brief_en.html").resolve()
        pdf = (OUT / "commissioner_brief_en.pdf").resolve()
        try:
            subprocess.run([exe, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}",
                            src.as_uri()], check=True, timeout=90, capture_output=True)
            print("wrote exports/commissioner_brief_en.pdf")
        except (subprocess.SubprocessError, OSError) as e:
            print("PDF skipped:", e)
    else:
        print("PDF skipped: no Edge/Chrome found (open the HTML brief and print it instead)")

    t = plan["totals"]
    print(f"\n{scenario}\n  saline {t['saline']['allocated']}/{t['saline']['required']} · kits "
          f"{t['kits']['allocated']}/{t['kits']['required']} · beds {t['beds']['allocated']}/{t['beds']['required']} · "
          f"crews {t['crews']['assigned']}/{t['crews']['needed']} · transfers {sum(x['patients'] for x in plan['transfers'])}"
          f" · critical wards {plan['alerts']['critical']}\n  simulator: {sim['crews_used']} crews prevent "
          f"{sim['totals']['prevented']} cases over weeks 2-4 ({sim['totals']['roi']} per crew)")


if __name__ == "__main__":
    main()
