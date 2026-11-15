"""Vehicle catalogue. These are starting values only: once a plug has measured a
real charge, the session uses the plug's measured power instead (MEASURED)."""

VEHICLES: dict[str, dict] = {
    "e_scooter": {"label": "E-scooter", "label_hi": "ई-स्कूटर", "wheels": 2,
                  "battery_wh": 3000, "charger_w": 750, "interruptible": False},
    "e_rickshaw": {"label": "E-rickshaw", "label_hi": "ई-रिक्शा", "wheels": 3,
                   "battery_wh": 6200, "charger_w": 1300, "interruptible": False},
    "e_car": {"label": "Electric car", "label_hi": "इलेक्ट्रिक कार", "wheels": 4,
              "battery_wh": 30000, "charger_w": 3300, "interruptible": True},
}
CHARGE_EFFICIENCY = 0.9


def energy_needed_wh(vehicle_type: str, battery_pct: int) -> int:
    v = VEHICLES[vehicle_type]
    pct = min(100, max(0, battery_pct))
    return int(round(v["battery_wh"] * (100 - pct) / 100 / CHARGE_EFFICIENCY))
