"""Area Intelligence administration from the command line.

    python -m backend.area sync-registry       # pull facilities from a FRED-compatible registry (needs credentials)
    python -m backend.area import FILE.csv --source "Name of the source"
    python -m backend.area stats
"""
import argparse
import sys
from pathlib import Path

from . import hospitals as hz
from .db import AreaDB


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="python -m backend.area")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync-registry", help="pull facilities from FACILITY_REGISTRY_URL")
    imp = sub.add_parser("import", help="import hospitals from a CSV file (rows arrive unverified)")
    imp.add_argument("file")
    imp.add_argument("--source", required=True)
    sub.add_parser("stats", help="count hospitals and bed reports")
    args = ap.parse_args(argv)
    db = AreaDB()
    try:
        if args.cmd == "sync-registry":
            print(hz.sync_fred(db))
        elif args.cmd == "import":
            print(hz.import_csv(db, Path(args.file).read_text(encoding="utf-8-sig"), args.source, None))
        else:
            row = db.one("SELECT COUNT(*) AS n, SUM(verified) AS v FROM hospitals WHERE active = 1")
            beds = db.one("SELECT COUNT(*) AS n FROM bed_updates WHERE verified = 1")
            print(f"hospitals: {row['n']} ({row['v'] or 0} verified); verified bed reports: {beds['n']}")
    except hz.HospitalError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
