"""Central configuration: paths, schema, split dates and risk-tier definitions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "dengue_weekly.csv"
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "dengue_models.joblib"
METRICS_PATH = MODEL_DIR / "metrics.json"
BACKTEST_PATH = MODEL_DIR / "backtest.csv.gz"

KEY = ["ward_id", "date"]
STATIC = ["population_density_sqkm", "water_logging_risk_index", "sanitation_score"]
WEATHER = ["avg_temp_c", "max_temp_c", "min_temp_c", "rainfall_mm", "relative_humidity_pct"]
TARGET = "dengue_cases"
REQUIRED = ["date", "city", "ward_id", *STATIC, *WEATHER, TARGET]

# Ward-id prefix -> city corporation (used to repair/validate the city column).
CITY_PREFIX = {"CCC": "Chattogram", "DNCC": "Dhaka North", "DSCC": "Dhaka South",
               "GCC": "Gazipur", "NCC": "Narayanganj"}

# Physically plausible ranges; values outside are treated as sensor/entry errors.
BOUNDS = {"avg_temp_c": (5, 45), "max_temp_c": (5, 48), "min_temp_c": (0, 40),
          "rainfall_mm": (0, 1000), "relative_humidity_pct": (1, 100),
          "water_logging_risk_index": (0, 1), "sanitation_score": (0, 1),
          "population_density_sqkm": (1, 200_000), TARGET: (0, 10_000)}

# Forecast horizons in weeks. The brief asks for a 2-4 week early-warning window; 1 week is kept as a reference.
HORIZONS = [1, 2, 3, 4]

# Chronological split on the *target* week (no shuffling, no future information in training).
TRAIN_END = "2023-12-31"  # train: targets 2016..2023
VAL_END = "2024-12-31"    # validation: targets in 2024 (model selection / early stopping)
                          # test: targets in 2025 (scored once, after selection)

# Risk tiers are set from historical weekly ward case percentiles in the training period.
TIER_QUANTILES = {"Medium": 0.70, "High": 0.85, "Critical": 0.95}
TIERS = ["Low", "Medium", "High", "Critical"]
TIER_COLORS = {"Low": "#2e9e5b", "Medium": "#e0b000", "High": "#e8711a", "Critical": "#c62828"}

SEED = 42

# ---------------------------------------------------------------- Phase 2: operations
# Supply columns added in the onsite dataset. Each is an exact step function of the week's case count:
#   need = floor(rate * cases + offset)
# These constants reproduce every one of the 31,320 rows (tests/test_operations.py checks this), so the same rule
# turns *forecast* cases into tomorrow's supply demand.
SUPPLIES = ["saline_bags_needed", "diagnostic_kits_needed", "hospital_beds_required"]
SUPPLY_RULES = {"saline_bags_needed": (2.385, 0.49),
                "diagnostic_kits_needed": (1.165, 0.445),
                "hospital_beds_required": (0.30, 0.45)}

# Dengue bed capacity per ward is not in the data. We size it from what each ward's hospitals already handled:
# the beds it needed in the busiest week of a typical year (median of its 2016-2023 annual peaks), at least 2.
BED_CAPACITY_MIN = 2

# Priority for scarce stock: 70% the model's risk score (0-100), 30% the ward's population-density percentile.
# Under scarcity a ward's fill rate is proportional to (PRIORITY_FLOOR + priority), capped at 100%: the top wards are
# filled completely first, and no ward drops to zero while stock remains.
PRIORITY_RISK_WEIGHT = 0.70
PRIORITY_FLOOR = 20

# Vector-control crews needed by a ward: one crew per this many expected cases at median density, more in denser
# wards (scaled by sqrt(density / median)); Medium-risk and above only; capped per ward.
CASES_PER_CREW = 6
MAX_CREWS_PER_WARD = 6

# Vector-control simulator. A larvicide/fogging crew removes breeding habitat. Coverage with k crews:
#   efficacy(k) = MAX_EFFICACY * (1 - exp(-k / (CREW_SCALE * sqrt(density / median density))))
# so denser wards need more crews for the same coverage and returns diminish. The model is then re-run with the
# ward's standing-water inputs (recent rain, water-logging) reduced by that fraction.
MAX_EFFICACY = 0.60
CREW_SCALE = 2.0
SIM_MAX_CREWS = 8          # most crews the simulator will put in one ward
SIM_HORIZONS = [2, 3, 4]   # larvae take 1-2 weeks to become biting adults, so the payoff lands 2-4 weeks out
BREEDING_FEATURES = ["rainfall_mm", "rain_lag1", "rain_lag2", "rain_lag3", "rain_lag4", "rain_sum_lag2_4",
                     "rain_sum_4w", "heavy_rain_weeks_4w", "water_logging_risk_index", "vulnerability_index"]

# ---------------------------------------------------------------- Smart early warning (alerts)
# Every threshold can be overridden with an environment variable of the same name, e.g. ALERT_SURGE_PCT=80.
import os as _os


def _env(name: str, default):
    raw = _os.environ.get(name)
    if raw is None or raw == "":
        return default
    return type(default)(raw)


ALERTS = {
    # A. risk-level increase: this week's forecast tier vs last week's forecast tier, at this horizon
    "ALERT_HORIZON": _env("ALERT_HORIZON", 2),
    "ALERT_MIN_LEVEL": _env("ALERT_MIN_LEVEL", "Medium"),     # ignore anything below this level
    # B. sudden case increase: forecast at SURGE_HORIZON vs the ward's last-4-week average of reported cases
    "ALERT_SURGE_HORIZON": _env("ALERT_SURGE_HORIZON", 2),
    "ALERT_SURGE_PCT": _env("ALERT_SURGE_PCT", 50.0),         # % rise needed
    "ALERT_SURGE_MIN_CASES": _env("ALERT_SURGE_MIN_CASES", 3.0),  # and at least this many extra cases a week
    # C. rainfall: last 4 weeks' rain above the ward's usual (percentile for that month, 2016-2023) or above an
    #    absolute amount, AND the model forecasting at least RAIN_MIN_LEVEL within 2-4 weeks
    "ALERT_RAIN_PERCENTILE": _env("ALERT_RAIN_PERCENTILE", 0.90),
    "ALERT_RAIN_ABS_MM": _env("ALERT_RAIN_ABS_MM", 450.0),       # this much in 4 weeks is heavy in any month
    "ALERT_RAIN_MIN_MM": _env("ALERT_RAIN_MIN_MM", 100.0),       # never call less than this "heavy" (dry season)
    "ALERT_RAIN_MIN_LEVEL": _env("ALERT_RAIN_MIN_LEVEL", "Medium"),
    # D. upcoming high risk: forecast reaches this level within 4 weeks while reported cases are still below it
    "ALERT_UPCOMING_LEVEL": _env("ALERT_UPCOMING_LEVEL", "High"),
    # duplicate prevention: after an alert, the same ward + type stays quiet this many weeks unless the level rises
    "ALERT_COOLDOWN_WEEKS": _env("ALERT_COOLDOWN_WEEKS", 3),
    # background job: rescan (and reload the data if the file changed) every this many minutes
    "ALERT_SCAN_MINUTES": _env("ALERT_SCAN_MINUTES", 15.0),
}
ALERTS_DB = Path(_os.environ.get("ALERTS_DB") or ROOT / "data" / "alerts.sqlite3")
