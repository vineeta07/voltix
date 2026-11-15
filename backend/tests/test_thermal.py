import math

import pytest

from app.thermal import ThermalParams, ageing_rate, life_cost_paise, simulate, steady_state

# IEC 60076-7 Annex C worked example (250 MVA ONAF unit, step load profile).
IEC = ThermalParams(d_theta_or=38.3, d_theta_hr=20.3, R=1000, x=0.8, y=1.3,
                    k11=0.5, k21=2.0, k22=2.0, tau_o=150, tau_w=7)
STEPS = [(190, 1.0), (365, 0.6), (500, 1.5), (705, 0.3), (730, 2.1), (745, 0.0)]
# (minute, top-oil degC, hot-spot degC) at the end of each load step, as tabulated
# in the standard for the difference-equation method. See docs/sources.md.
REFERENCE = [(190, 61.9, 83.8), (365, 44.4, 54.6), (500, 89.2, 127.0),
             (705, 35.9, 37.6), (730, 68.2, 138.2), (745, 60.3, 76.0)]


def profile():
    out, t0 = [], 0
    for end, k in STEPS:
        out += [k] * (end - t0)
        t0 = end
    return out


def test_iec_60076_7_worked_example():
    r = simulate(profile(), 25.6, IEC, dt_min=1, initial=(38.3, 38.3))
    for minute, top, hot in REFERENCE:
        assert r.top_oil[minute - 1] == pytest.approx(top, abs=1.5)
        assert r.hot_spot[minute - 1] == pytest.approx(hot, abs=2.0)


def test_converges_to_steady_state():
    p = ThermalParams()
    r = simulate([1.0] * 3000, 20.0, p, dt_min=1, initial=(20.0, 20.0))
    top, hot = steady_state(1.0, 20.0, p)
    assert (top, hot) == (75.0, 98.0)  # rated: 55 K rise + 23 K gradient at 20 degC
    assert r.top_oil[-1] == pytest.approx(top, abs=0.05)
    assert r.hot_spot[-1] == pytest.approx(hot, abs=0.05)
    assert r.ageing_rate[-1] == pytest.approx(1.0, abs=0.01)


def test_ageing_rate_doubles_every_6k():
    assert ageing_rate(98) == 1
    assert ageing_rate(104) == 2
    assert ageing_rate(92) == 0.5


def test_loss_of_life_and_cost():
    p = ThermalParams()
    rated = simulate([1.0] * 1440, 20.0, p)
    assert rated.loss_of_life_h == pytest.approx(24.0, rel=0.01)
    assert rated.excess_loss_h == pytest.approx(0.0, abs=0.3)
    over = simulate([1.3] * 1440, 20.0, p)
    assert over.excess_loss_h > 100
    assert over.max_hot_spot > 120
    # 180 000 h of normal life, Rs 3,00,000 transformer: one excess hour costs Rs 1.67
    assert life_cost_paise(1.0, 30_000_000, 180_000) == 167


def test_large_time_step_is_subdivided():
    p = ThermalParams()
    fine = simulate([0.5] * 60 + [1.2] * 240, 30.0, p, dt_min=1)
    coarse = simulate([0.5] * 4 + [1.2] * 16, 30.0, p, dt_min=15)
    assert coarse.hot_spot[-1] == pytest.approx(fine.hot_spot[-1], abs=0.5)
    assert not math.isnan(coarse.loss_of_life_h)
