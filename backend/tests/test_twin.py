from app.twin import TwinConfig, household_profiles, run_level, sweep


def test_household_profiles_are_plausible():
    homes, src = household_profiles(50)
    assert len(homes) == 50 and all(len(h) == 96 for h in homes)
    avg = sum(sum(h) for h in homes) / 50 / 96
    assert 150 < avg < 900  # W per home
    assert "placeholder" in src or "CEEW" in src


def test_voltix_beats_tod_timer_at_same_adoption():
    cfg = TwinConfig(homes=60, rated_kva=63, solver_time_s=0.5)
    lv = run_level(30, cfg, strategies=("voltix", "tod_timer", "uncontrolled"))
    v, t = lv["strategies"]["voltix"], lv["strategies"]["tod_timer"]
    assert v["peak_pct"] <= t["peak_pct"]
    assert v["minutes_over"] <= t["minutes_over"]
    assert v["max_hot_spot_c"] <= t["max_hot_spot_c"] + 0.5
    assert lv["evs"] == 18


def test_sweep_reports_first_overload_per_strategy():
    cfg = TwinConfig(homes=40, rated_kva=25, adoption_levels=(10, 40), solver_time_s=0.5)
    s = sweep(cfg)
    assert len(s["levels"]) == 2
    assert set(s["first_overload"]) == {"voltix", "site_limit_only", "random_delay",
                                        "tod_timer", "uncontrolled"}
    fo = s["first_overload"]
    assert fo["tod_timer"]["first_overload_pct"] is not None  # the snapback overloads
    v = fo["voltix"]["first_overload_pct"]
    assert v is None or v >= fo["tod_timer"]["first_overload_pct"]
