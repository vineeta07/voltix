from app.scheduler import STRATEGIES, Job, plan, slots_needed, smallest_relaxation


def flat(v, n=96):
    return [v] * n


def test_slots_needed():
    assert slots_needed(Job(1, 1000, 1000, 0, 96), 15) == 4
    assert slots_needed(Job(1, 1000, 1001, 0, 96), 15) == 5


def test_meets_deadlines_and_capacity():
    jobs = [Job(i, 1000, 2000, 0, 40) for i in range(6)]  # 8 slots each
    r = plan(jobs, flat(2000), time_limit_s=2)
    assert r.feasible
    assert max(r.ev_load) <= 2000
    for j in jobs:
        jp = r.jobs[j.id]
        assert jp.end <= j.deadline and jp.start >= j.earliest
        assert sum(jp.power) * 0.25 >= j.energy_wh


def test_capacity_profile_respected():
    cap = [3000] * 20 + [0] * 20 + [3000] * 56
    jobs = [Job(i, 1500, 1500, 0, 96) for i in range(4)]
    r = plan(jobs, cap, time_limit_s=2)
    assert r.feasible
    assert all(r.ev_load[t] <= cap[t] for t in range(96))
    for jp in r.jobs.values():  # non-interruptible blocks are contiguous
        on = [t for t, p in enumerate(jp.power) if p]
        assert on == list(range(on[0], on[-1] + 1))


def test_started_session_never_moves():
    jobs = [Job(1, 1000, 1000, 0, 96, started=True), Job(2, 1000, 1000, 0, 96)]
    r = plan(jobs, flat(1000), time_limit_s=2)
    assert r.jobs[1].start == 0
    assert r.jobs[2].start >= 4
    assert r.feasible


def test_minimises_peak():
    jobs = [Job(i, 1000, 1000, 0, 96) for i in range(4)]
    r = plan(jobs, flat(10000), base_w=flat(500), time_limit_s=2)
    assert r.peak_w == 1500  # one at a time, although capacity would allow all four


def test_uses_solar_then_cheap_hours():
    solar = [0] * 40 + [2000] * 8 + [0] * 48
    price = [500] * 60 + [300] * 36
    jobs = [Job(1, 1000, 2000, 0, 96), Job(2, 1000, 2000, 50, 96)]
    r = plan(jobs, flat(5000), solar_w=solar, price=price, time_limit_s=2)
    assert r.jobs[1].start == 40  # inside the solar window
    assert r.jobs[2].start >= 60  # cannot reach solar, so takes the cheap rate
    assert r.solar_wh == 2000


def test_interruptible_gets_variable_power():
    cap = [500] * 96
    jobs = [Job(1, 2000, 3000, 0, 40, interruptible=True)]
    r = plan(jobs, cap, time_limit_s=2)
    assert r.feasible
    assert max(r.jobs[1].power) <= 500
    assert sum(r.jobs[1].power) * 0.25 >= 3000


def test_infeasible_is_reported_with_smallest_relaxation():
    jobs = [Job(1, 1000, 2000, 0, 8), Job(2, 1000, 2000, 0, 8)]  # both need all 8 slots
    r = plan(jobs, flat(1000), time_limit_s=2)
    assert not r.feasible
    relax = smallest_relaxation(r)
    assert sum(relax.values()) == 8 * 15 and len(relax) == 1
    assert all(sum(jp.power) * 0.25 >= 2000 for jp in r.jobs.values())  # still fully charged


def test_job_larger_than_site_is_flagged():
    r = plan([Job(1, 5000, 1000, 0, 96)], flat(1000), time_limit_s=1)
    assert r.jobs[1].impossible and not r.feasible


def test_fairness_moves_repeatedly_last_user_forward():
    jobs = [Job(1, 1000, 1000, 0, 96, fairness=0), Job(2, 1000, 1000, 0, 96, fairness=3)]
    r = plan(jobs, flat(1000), time_limit_s=2)
    assert r.jobs[2].start < r.jobs[1].start


def test_baselines():
    jobs = [Job(i, 1000, 1000, i, 96, cheap_start=20) for i in range(5)]
    cap = flat(2000)
    un = plan(jobs, cap, strategy="uncontrolled")
    tod = plan(jobs, cap, strategy="tod_timer")
    rnd = plan(jobs, cap, strategy="random_delay")
    lim = plan(jobs, cap, strategy="site_limit_only", time_limit_s=2)
    assert [un.jobs[i].start for i in range(5)] == [0, 1, 2, 3, 4]
    assert all(tod.jobs[i].start == 20 for i in range(5))
    assert tod.peak_w == 5000 and not tod.feasible  # the snapback peak
    assert all(20 <= rnd.jobs[i].start <= 22 for i in range(5))
    assert lim.feasible and max(lim.ev_load) <= 2000
    assert set(STRATEGIES) == {"voltix", "site_limit_only", "random_delay", "tod_timer",
                               "uncontrolled"}


def test_deterministic():
    jobs = [Job(i, 1200, 1800, i % 3, 60) for i in range(8)]
    a = plan(jobs, flat(3000), base_w=flat(100), time_limit_s=2, workers=1)
    b = plan(jobs, flat(3000), base_w=flat(100), time_limit_s=2, workers=1)
    assert a.peak_w == b.peak_w and a.cost_paise == b.cost_paise
