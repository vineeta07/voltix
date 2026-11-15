"""Time-of-Day tariff. All money is integer paise.

The windows and rates are *config*, entered per site from the DISCOM's tariff
order (see docs/sources.md). The defaults below are placeholders shaped like
the DERC ToD schedule and must be confirmed against the current order.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")

DEFAULT_TARIFF: dict = {
    "name": "DERC ToD (placeholder - confirm against the current order)",
    "base_paise_per_kwh": 450,
    # Local (IST) windows, [start, end) in HH:MM. Later entries win on overlap.
    "windows": [
        {"label": "off-peak", "start": "04:00", "end": "10:00", "multiplier": 0.8},
        {"label": "peak", "start": "14:00", "end": "17:00", "multiplier": 1.2},
        {"label": "peak", "start": "22:00", "end": "01:00", "multiplier": 1.2},
    ],
}


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


@dataclass(frozen=True)
class Rate:
    label: str
    paise_per_kwh: int


def to_ist(ts_utc: datetime) -> datetime:
    return ts_utc.replace(tzinfo=UTC).astimezone(IST)


def rate_at(tariff: dict, ts_utc: datetime) -> Rate:
    """Rate that applies at a UTC instant."""
    t = tariff or DEFAULT_TARIFF
    base = int(t.get("base_paise_per_kwh", 0))
    local = to_ist(ts_utc)
    minute = local.hour * 60 + local.minute
    label, mult = "normal", 1.0
    for w in t.get("windows", []):
        s, e = _minutes(w["start"]), _minutes(w["end"])
        inside = s <= minute < e if s < e else (minute >= s or minute < e)
        if inside:
            label, mult = w["label"], float(w["multiplier"])
    return Rate(label, int(round(base * mult)))


def price_profile(tariff: dict, start_utc: datetime, slots: int, slot_min: int) -> list[int]:
    return [
        rate_at(tariff, start_utc + timedelta(minutes=i * slot_min)).paise_per_kwh
        for i in range(slots)
    ]


def cost_paise(wh: float, paise_per_kwh: int) -> int:
    """Cost of `wh` at a rate, rounded to the nearest paisa."""
    return int(round(wh * paise_per_kwh / 1000))


def next_cheap_start(tariff: dict, ts_utc: datetime, slot_min: int = 15) -> datetime:
    """Start of the next cheapest-rate window at or after ts (the 'ToD timer' moment).
    Returns ts itself when it is already inside the cheapest window."""
    day = [rate_at(tariff, ts_utc + timedelta(minutes=i * slot_min)).paise_per_kwh
           for i in range(24 * 60 // slot_min)]
    cheapest = min(day)
    for i, p in enumerate(day):
        if p == cheapest:
            return ts_utc + timedelta(minutes=i * slot_min)
    return ts_utc
