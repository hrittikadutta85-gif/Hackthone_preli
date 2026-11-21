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
