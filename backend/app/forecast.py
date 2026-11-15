"""Non-EV load and solar-surplus forecaster.

P50 and P90 of the site's non-EV load every 15 minutes for the next 24 h,
from LightGBM quantile regression (features: lagged load, time of day,
weekday, temperature). With too little history it falls back to
time-of-day quantiles of whatever has been measured, and says so.

The forecaster only *informs* the scheduler; it never issues commands.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from .tariff import to_ist

MIN_TRAIN_ROWS = 96 * 5  # five days of 15-minute history before LightGBM is used
FEATURES = ["sin_t", "cos_t", "weekday", "is_weekend", "lag_1d", "lag_7d", "roll_1d", "temp"]


@dataclass
class Forecast:
    index: list[datetime]  # slot starts, UTC
    p50: list[float]
    p90: list[float]
    solar: list[float]  # expected surplus available to EVs, W
    method: str  # "lightgbm" | "profile" | "flat"
    metrics: dict | None = None


def pinball_loss(y: np.ndarray, q_pred: np.ndarray, q: float) -> float:
    d = y - q_pred
    return float(np.mean(np.maximum(q * d, (q - 1) * d)))


def coverage(y: np.ndarray, q_pred: np.ndarray) -> float:
    """Share of observations at or below the predicted quantile."""
    return float(np.mean(y <= q_pred))


def to_slots(df: pd.DataFrame, slot_min: int = 15) -> pd.DataFrame:
    """Resample raw (ts-indexed) readings to slot means."""
    if df.empty:
        return df
    return df.resample(f"{slot_min}min").mean()


def _features(idx: pd.DatetimeIndex, series: pd.Series, temp: pd.Series | None, slot_min: int):
    per_day = 24 * 60 // slot_min
    local = [to_ist(t.to_pydatetime()) for t in idx]
    minute = np.array([t.hour * 60 + t.minute for t in local])
    wd = np.array([t.weekday() for t in local])
    f = pd.DataFrame(index=idx)
    f["sin_t"] = np.sin(2 * math.pi * minute / 1440)
    f["cos_t"] = np.cos(2 * math.pi * minute / 1440)
    f["weekday"] = wd
    f["is_weekend"] = (wd >= 5).astype(int)
    full = series.reindex(series.index.union(idx))
    f["lag_1d"] = full.shift(per_day).reindex(idx)
    f["lag_7d"] = full.shift(7 * per_day).reindex(idx)
    f["roll_1d"] = full.shift(per_day).rolling(per_day, min_periods=4).mean().reindex(idx)
    f["temp"] = temp.reindex(idx).astype(float) if temp is not None else np.nan
    return f[FEATURES]


def _profile_quantiles(series: pd.Series, idx: pd.DatetimeIndex, q: float, slot_min: int):
    """Quantile by time of day; borrows neighbouring slots so it works on short history."""
    if series.empty:
        return np.zeros(len(idx))
    per_day = 24 * 60 // slot_min
    slot_of = lambda ix: (ix.hour * 60 + ix.minute) // slot_min  # noqa: E731
    hist = pd.DataFrame({"v": series.values, "s": slot_of(series.index)})
    by_slot = hist.groupby("s")["v"].apply(list).to_dict()
    overall = float(np.quantile(series.values, q))
    out = []
    for s in slot_of(idx):
        vals: list[float] = []
        for d in (0, -1, 1, -2, 2):
            vals += by_slot.get((s + d) % per_day, [])
            if len(vals) >= 6:
                break
        out.append(float(np.quantile(vals, q)) if vals else overall)
    return np.array(out)


def _fit(X: pd.DataFrame, y: pd.Series, q: float):
    import lightgbm as lgb

    params = {"objective": "quantile", "alpha": q, "learning_rate": 0.05, "num_leaves": 15,
              "min_data_in_leaf": 10, "bagging_fraction": 0.9, "bagging_freq": 1, "seed": 7,
              "verbose": -1, "num_threads": 2, "deterministic": True}
    return lgb.train(params, lgb.Dataset(X, label=y), num_boost_round=200)


def forecast(
    load: pd.Series,
    start: datetime,
    slots: int = 96,
    slot_min: int = 15,
    temp: pd.Series | None = None,
    solar_surplus: pd.Series | None = None,
    irradiance: pd.Series | None = None,
) -> Forecast:
    """`load` is the non-EV load in W at slot resolution, indexed by naive-UTC slot start."""
    idx = pd.date_range(start, periods=slots, freq=f"{slot_min}min")
    load = load.dropna()
    if len(load):
        load = load[load.index < idx[0]]
    solar = _solar_forecast(solar_surplus, irradiance, idx, slot_min)

    if len(load) < 4:
        level = float(load.mean()) if len(load) else 0.0
        return Forecast(list(idx.to_pydatetime()), [level] * slots, [level * 1.25] * slots,
                        solar, "flat")

    if len(load) >= MIN_TRAIN_ROWS:
        try:
            X = _features(load.index, load, temp, slot_min)
            ok = X["lag_1d"].notna()
            if ok.sum() >= MIN_TRAIN_ROWS // 2:
                Xf = _features(idx, load, temp, slot_min)
                p50 = _fit(X[ok], load[ok], 0.5).predict(Xf)
                p90 = _fit(X[ok], load[ok], 0.9).predict(Xf)
                p50 = np.maximum(p50, 0)
                p90 = np.maximum(p90, p50)
                return Forecast(list(idx.to_pydatetime()), p50.tolist(), p90.tolist(), solar,
                                "lightgbm")
        except Exception as e:  # fall back rather than leave the scheduler blind
            print(f"[forecast] lightgbm failed, using profile: {e}")

    p50 = _profile_quantiles(load, idx, 0.5, slot_min)
    p90 = np.maximum(_profile_quantiles(load, idx, 0.9, slot_min), p50)
    return Forecast(list(idx.to_pydatetime()), p50.tolist(), p90.tolist(), solar, "profile")


def _solar_forecast(surplus, irradiance, idx, slot_min) -> list[float]:
    """Expected solar surplus. Uses the measured surplus by time of day (median),
    scaled by forecast irradiance relative to the irradiance seen in history when
    both are available. Zero when the site has never exported."""
    if surplus is None or surplus.dropna().empty or float(surplus.max()) <= 0:
        return [0.0] * len(idx)
    surplus = surplus.dropna()
    surplus = surplus[surplus.index < idx[0]]
    if surplus.empty:
        return [0.0] * len(idx)
    base = _profile_quantiles(surplus, idx, 0.5, slot_min)
    if irradiance is not None and not irradiance.dropna().empty:
        hist = irradiance.reindex(surplus.index).dropna()
        if len(hist) > 8 and float(hist.max()) > 0:
            typical = _profile_quantiles(hist, idx, 0.5, slot_min)
            fut = irradiance.reindex(idx).astype(float).to_numpy()
            ratio = np.where((typical > 20) & ~np.isnan(fut),
                             np.clip(fut / np.maximum(typical, 1), 0, 1.5), 1.0)
            base = base * ratio
    return np.maximum(base, 0).tolist()


def backtest(load: pd.Series, slot_min: int = 15, temp: pd.Series | None = None,
             holdout_days: int = 2) -> dict:
    """Day-ahead forecasts for each of the last `holdout_days` days, scored on
    data the model did not see. Returns pinball loss and interval coverage."""
    per_day = 24 * 60 // slot_min
    load = load.dropna()
    if len(load) < per_day * (holdout_days + 1):
        return {"ok": False, "reason": "not enough history", "rows": int(len(load))}
    ys, p50s, p90s, method = [], [], [], "profile"
    last = load.index[-1] + timedelta(minutes=slot_min)
    for d in range(holdout_days, 0, -1):
        start = last - timedelta(days=d)
        fc = forecast(load[load.index < start], start.to_pydatetime(), per_day, slot_min, temp)
        actual = load.reindex(pd.DatetimeIndex(fc.index))
        ok = actual.notna().to_numpy()
        ys.append(actual.to_numpy()[ok])
        p50s.append(np.array(fc.p50)[ok])
        p90s.append(np.array(fc.p90)[ok])
        method = fc.method
    y, p50, p90 = np.concatenate(ys), np.concatenate(p50s), np.concatenate(p90s)
    if len(y) == 0:
        return {"ok": False, "reason": "no held-out rows", "rows": int(len(load))}
    return {
        "ok": True, "method": method, "holdout_rows": int(len(y)), "train_rows": int(len(load)),
        "pinball_p50_w": round(pinball_loss(y, p50, 0.5), 1),
        "pinball_p90_w": round(pinball_loss(y, p90, 0.9), 1),
        "coverage_p50": round(coverage(y, p50), 3),
        "coverage_p90": round(coverage(y, p90), 3),
        "mae_w": round(float(np.mean(np.abs(y - p50))), 1),
        "mean_load_w": round(float(np.mean(y)), 1),
    }
