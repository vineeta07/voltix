"""Open-Meteo forecast (temperature, shortwave irradiance). Free, no key.
Failures return None: weather is a feature, never a dependency."""

import time
from datetime import datetime

import httpx
import pandas as pd

_cache: dict[tuple[float, float], tuple[float, pd.DataFrame]] = {}
URL = "https://api.open-meteo.com/v1/forecast"


def fetch(lat: float, lon: float, slot_min: int = 15, ttl_s: int = 1800) -> pd.DataFrame | None:
    """DataFrame indexed by naive-UTC slot start with columns temp (degC), irradiance (W/m2)."""
    key = (round(lat, 3), round(lon, 3))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl_s:
        return hit[1]
    try:
        r = httpx.get(URL, timeout=8.0, params={
            "latitude": lat, "longitude": lon, "hourly": "temperature_2m,shortwave_radiation",
            "past_days": 7, "forecast_days": 3, "timezone": "UTC"})
        r.raise_for_status()
        h = r.json()["hourly"]
        df = pd.DataFrame({"temp": h["temperature_2m"], "irradiance": h["shortwave_radiation"]},
                          index=pd.DatetimeIndex([datetime.fromisoformat(t) for t in h["time"]]))
        df = df.resample(f"{slot_min}min").interpolate()
        _cache[key] = (time.time(), df)
        return df
    except Exception as e:
        print(f"[weather] Open-Meteo unavailable: {e}")
        return hit[1] if hit else None
