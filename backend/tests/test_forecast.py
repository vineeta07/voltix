import numpy as np
import pandas as pd
import pytest

from app.forecast import backtest, coverage, forecast, pinball_loss


def synthetic(days=14, seed=1):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-05-01", periods=days * 96, freq="15min")
    hour = idx.hour + idx.minute / 60
    y = 3000 + 2000 * np.sin((hour - 9) / 24 * 2 * np.pi) + rng.normal(0, 150, len(idx))
    return pd.Series(y, index=idx)


def test_pinball_and_coverage():
    y = np.array([1.0, 2.0, 3.0, 4.0])
    assert pinball_loss(y, y, 0.9) == 0
    assert pinball_loss(np.array([10.0]), np.array([0.0]), 0.9) == pytest.approx(9.0)
    assert pinball_loss(np.array([0.0]), np.array([10.0]), 0.9) == pytest.approx(1.0)
    assert coverage(y, np.full(4, 2.5)) == 0.5


def test_lightgbm_forecast_is_calibrated_on_held_out_days():
    m = backtest(synthetic(), holdout_days=2)
    assert m["ok"] and m["method"] == "lightgbm"
    assert m["mae_w"] < 400  # noise sigma is 150 W on a 1 kW..5 kW signal
    assert 0.75 <= m["coverage_p90"] <= 1.0
    assert 0.3 <= m["coverage_p50"] <= 0.7
    assert m["pinball_p90_w"] < m["mae_w"]


def test_short_history_falls_back_to_profile():
    s = synthetic(days=2)
    fc = forecast(s, s.index[-1].to_pydatetime() + pd.Timedelta(minutes=15))
    assert fc.method == "profile" and len(fc.p50) == 96
    assert all(b >= a for a, b in zip(fc.p50, fc.p90, strict=True))


def test_no_history_is_flat_and_safe():
    fc = forecast(pd.Series(dtype=float), pd.Timestamp("2026-05-01").to_pydatetime())
    assert fc.method == "flat" and fc.p90 == [0.0] * 96 and fc.solar == [0.0] * 96


def test_solar_surplus_profile():
    s = synthetic(days=3)
    hour = s.index.hour
    surplus = pd.Series(np.where((hour >= 5) & (hour < 9), 1500.0, 0.0), index=s.index)
    fc = forecast(s, s.index[-1].to_pydatetime() + pd.Timedelta(minutes=15),
                  solar_surplus=surplus)
    by_hour = {t.hour: v for t, v in zip(fc.index, fc.solar, strict=True)}
    assert by_hour[6] == 1500 and by_hour[14] == 0
