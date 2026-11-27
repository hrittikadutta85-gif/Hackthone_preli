"""Roles and permissions, mapped to what Dengue Watch actually does.

The backend checks these on every API route (see `require` in deps.py); the frontend only uses them to hide menu
items a user could not open anyway. A role sent by the browser is never trusted: it is always read from the database.
"""

PERMISSIONS = {
    "dashboard.view":   "City overview, risk map, outlook and how-it-works",
    "ward.view":        "Ward forecasts and their recommended actions (field officers: assigned wards only)",
    "plan.view":        "Action plan: where to send teams first",
    "forecast.whatif":  "Run what-if weather scenarios on a ward",
    "model.view":       "Model evaluation: can I trust it?",
    "predict.use":      "Prediction portal: forecast from new data, upload CSV",
    "ops.view":         "Operations: resource allocation, bed routing, vector-control simulator",
    "ops.dispatch":     "Generate SMS/WhatsApp notices and the printable brief",
    "ops.selftest":     "Run the offline resilience self-test",
    "alerts.view":      "See alerts and enable browser notifications",
    "alerts.manage":    "Acknowledge or resolve alerts (field officers: assigned wards only)",
    "alerts.admin":     "Run the alert scanner on demand",
    "users.manage":     "Create, approve, deactivate users; assign roles and wards",
    "security.view":    "System-wide login history, sessions, notification deliveries and audit log",
    "hospitals.manage": "Add, edit and verify hospitals, record bed availability, add localities",
}

_ALL = set(PERMISSIONS)
_READ = {"dashboard.view", "ward.view", "alerts.view"}

ROLES: dict[str, dict] = {
    "admin": {
        "rank": 100, "self_service": False, "permissions": _ALL,
    },
    "officer": {  # Public Health Officer
        "rank": 80, "self_service": True,
        "permissions": _READ | {"plan.view", "forecast.whatif", "model.view", "predict.use", "ops.view", "ops.dispatch",
                                "ops.selftest", "alerts.manage"},
    },
    "analyst": {
        "rank": 60, "self_service": True,
        "permissions": _READ | {"forecast.whatif", "model.view", "predict.use"},
    },
    "field": {  # Field Officer
        "rank": 40, "self_service": True,
        "permissions": _READ | {"plan.view", "alerts.manage"},
    },
    "viewer": {
        "rank": 10, "self_service": True, "permissions": set(_READ),
    },
}

# Where each role lands after logging in (the first page it is most likely to need)
HOME = {"admin": "/", "officer": "/", "analyst": "/predict", "field": "/plan", "viewer": "/"}

# Roles limited to the wards an administrator assigns them
WARD_SCOPED = {"field"}


def permissions(role: str) -> set[str]:
    return set(ROLES.get(role, {"permissions": set()})["permissions"])


def can(role: str, perm: str) -> bool:
    return perm in permissions(role)
