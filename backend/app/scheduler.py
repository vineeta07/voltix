"""EV charging scheduler (OR-Tools CP-SAT) and the baseline strategies.

One entry point, `plan()`, runs every strategy on the same inputs:

  voltix           CP-SAT, lexicographic: deadlines > peak > solar > cost > fairness
  site_limit_only  CP-SAT, capacity respected, everything starts as early as it can
  uncontrolled     every vehicle starts when plugged in
  tod_timer        every vehicle starts at the cheap-rate boundary
  random_delay     tod_timer plus a random delay per vehicle (UK-style)

All power is W, all time is in slots (default 15 min). This is deterministic
code: no learning and no LLM anywhere in the control path.
"""

import math
import random
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

UNIT_W = 10  # solver works in units of 10 W
STRATEGIES = ("voltix", "site_limit_only", "random_delay", "tod_timer", "uncontrolled")


@dataclass
class Job:
    id: int
    power_w: int
    energy_wh: float
    earliest: int  # first slot it may charge in
    deadline: int  # must be finished before this slot index (exclusive)
    interruptible: bool = False
    started: bool = False  # non-interruptible and already running: must not move
    fairness: int = 0  # how often this user was scheduled last recently
    cheap_start: int | None = None  # slot of the cheap-rate boundary (baselines)


@dataclass
class JobPlan:
    id: int
    power: list[int]  # W per slot
    start: int | None
    end: int | None  # exclusive
    late_slots: int = 0
    impossible: bool = False


@dataclass
class PlanResult:
    strategy: str
    jobs: dict[int, JobPlan] = field(default_factory=dict)
    ev_load: list[int] = field(default_factory=list)
    feasible: bool = True  # every deadline met and capacity respected
    peak_w: int = 0  # max of base + EV load
    over_capacity_slots: int = 0
    solar_wh: float = 0.0
    cost_paise: int = 0
    solver_status: str = "n/a"


def slots_needed(job: Job, slot_min: int) -> int:
    per_slot_wh = job.power_w * slot_min / 60
    return max(1, math.ceil(job.energy_wh / per_slot_wh - 1e-9)) if per_slot_wh > 0 else 0


def _metrics(res: PlanResult, jobs, capacity, base, solar, price, slot_min) -> PlanResult:
    n = len(res.ev_load)
    h = slot_min / 60
    res.peak_w = max((base[t] + res.ev_load[t] for t in range(n)), default=0)
    res.over_capacity_slots = sum(1 for t in range(n) if res.ev_load[t] > capacity[t] + UNIT_W)
    used = [min(res.ev_load[t], solar[t]) for t in range(n)]
    res.solar_wh = sum(used) * h
    res.cost_paise = int(round(sum((res.ev_load[t] - used[t]) * h * price[t] / 1000
                                   for t in range(n))))
    late = any(j.late_slots > 0 or j.impossible for j in res.jobs.values())
    res.feasible = not late and res.over_capacity_slots == 0
    return res


def _extend(seq: list[int], n: int, cyclic: bool = False) -> list[int]:
    if len(seq) >= n:
        return list(seq[:n])
    if not seq:
        return [0] * n
    out = list(seq)
    while len(out) < n:
        out.append(seq[len(out) % len(seq)] if cyclic else seq[-1])
    return out


def plan(
    jobs: list[Job],
    capacity_w: list[int],
    base_w: list[int] | None = None,
    solar_w: list[int] | None = None,
    price: list[int] | None = None,
    strategy: str = "voltix",
    slot_min: int = 15,
    time_limit_s: float = 3.0,
    extra_slots: int = 32,
    seed: int = 7,
    random_delay_max_min: int = 30,
    workers: int = 8,
) -> PlanResult:
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy {strategy}")
    horizon = len(capacity_w)
    n = horizon + extra_slots
    cap = [max(0, c) for c in _extend(capacity_w, n)]
    base = _extend(base_w or [0] * horizon, n)
    solar = [max(0, s) for s in _extend(solar_w or [0] * horizon, n, cyclic=False)]
    if solar_w and len(solar_w) < n:
        solar[len(solar_w):] = [0] * (n - len(solar_w))
    pr = _extend(price or [0] * horizon, n, cyclic=True)

    if strategy in ("uncontrolled", "tod_timer", "random_delay"):
        res = _baseline(jobs, n, strategy, slot_min, seed, random_delay_max_min)
    else:
        res = _solve(jobs, cap, base, solar, pr, strategy, slot_min, time_limit_s, n, workers)
    return _metrics(res, jobs, cap, base, solar, pr, slot_min)


def _baseline(jobs, n, strategy, slot_min, seed, delay_max_min) -> PlanResult:
    rng = random.Random(seed)
    res = PlanResult(strategy=strategy, ev_load=[0] * n)
    for j in jobs:
        dur = slots_needed(j, slot_min)
        start = j.earliest
        if not j.started and strategy in ("tod_timer", "random_delay") and j.cheap_start is not None:
            target = j.cheap_start
            if strategy == "random_delay":
                target += rng.randint(0, max(0, delay_max_min // slot_min))
            # a timer user still sets it early enough to be charged by the morning
            start = max(j.earliest, min(target, j.deadline - dur))
        start = min(start, max(0, n - dur))
        end = start + dur
        power = [0] * n
        for t in range(start, min(end, n)):
            power[t] = j.power_w
            res.ev_load[t] += j.power_w
        res.jobs[j.id] = JobPlan(j.id, power, start, end, late_slots=max(0, end - j.deadline))
    return res


def _solve(jobs, cap, base, solar, price, strategy, slot_min, time_limit_s, n, workers):
    res = PlanResult(strategy=strategy, ev_load=[0] * n)
    max_cap = max(cap) if cap else 0
    todo = []
    for j in jobs:
        # A started non-interruptible session keeps running whatever the capacity says.
        if j.power_w > max_cap and not j.started and not j.interruptible:
            res.jobs[j.id] = JobPlan(j.id, [0] * n, None, None, impossible=True)
        elif j.energy_wh <= 0:
            res.jobs[j.id] = JobPlan(j.id, [0] * n, j.earliest, j.earliest)
        else:
            todo.append(j)
    if not todo:
        res.solver_status = "TRIVIAL"
        return res

    m = cp_model.CpModel()
    u = UNIT_W
    cap_u = [c // u for c in cap]
    load = [[] for _ in range(n)]  # linear terms per slot
    late, starts, x, pvars, ends = {}, {}, {}, {}, {}
    intervals, demands = [], []

    for j in todo:
        p_u = max(1, j.power_w // u)
        if not j.interruptible:
            dur = slots_needed(j, slot_min)
            lo = 0 if j.started else min(j.earliest, n - dur)
            hi = 0 if j.started else n - dur
            xs = {t: m.NewBoolVar(f"x{j.id}_{t}") for t in range(lo, hi + 1)}
            m.AddExactlyOne(xs.values())
            s = m.NewIntVar(lo, hi, f"s{j.id}")
            m.Add(s == sum(t * b for t, b in xs.items()))
            x[j.id], starts[j.id], ends[j.id] = xs, s, s + dur
            for t in range(n):
                terms = [xs[k] for k in range(max(lo, t - dur + 1), min(hi, t) + 1)]
                if terms:
                    load[t].append((p_u, sum(terms)))
            if not j.started:
                intervals.append(m.NewIntervalVar(s, dur, s + dur, f"i{j.id}"))
                demands.append(p_u)
            lt = m.NewIntVar(0, n, f"late{j.id}")
            m.Add(lt >= s + dur - j.deadline)
            late[j.id] = lt
        else:
            need_u = math.ceil(j.energy_wh * 60 / slot_min / u - 1e-9)  # in (10 W x slot)
            lo = min(j.earliest, n - 1)
            ps = {t: m.NewIntVar(0, p_u, f"p{j.id}_{t}") for t in range(lo, n)}
            m.Add(sum(ps.values()) >= min(need_u, p_u * len(ps)))
            m.Add(sum(ps.values()) <= need_u + p_u)
            pvars[j.id] = ps
            lt = m.NewIntVar(0, n, f"late{j.id}")
            for t, pv in ps.items():
                load[t].append((1, pv))
                if t >= j.deadline:
                    on = m.NewBoolVar(f"on{j.id}_{t}")
                    m.Add(pv <= p_u * on)
                    m.Add(lt >= (t + 1 - j.deadline) * on)
            late[j.id] = lt

    slot_load = []
    fixed_u = [0] * n  # load of started sessions, which is allowed to exceed capacity
    for j in todo:
        if j.started and not j.interruptible:
            for t in range(min(n, slots_needed(j, slot_min))):
                fixed_u[t] += max(1, j.power_w // u)
    for t in range(n):
        e = sum(c * v for c, v in load[t]) if load[t] else 0
        slot_load.append(e)
        if load[t]:
            m.Add(e <= max(cap_u[t], fixed_u[t]))
    if intervals:
        top = max(max(cap_u), max(demands))
        for t in range(n):  # capacity profile as fixed blockers under one cumulative
            room = max(0, cap_u[t] - fixed_u[t])
            if top - room > 0:
                intervals.append(m.NewFixedSizeIntervalVar(t, 1, f"b{t}"))
                demands.append(top - room)
        m.AddCumulative(intervals, demands, top)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = workers
    solver.parameters.random_seed = 1

    last = {"status": "n/a"}
    best: dict = {}
    all_vars = list(starts.values()) + [p for ps in pvars.values() for p in ps.values()]
    all_vars += list(late.values())

    # A greedy placement gives the solver a feasible starting point straight away.
    g_start, g_power = _greedy(todo, cap, n, slot_min)
    for jid, sv in g_start.items():
        m.AddHint(starts[jid], sv)
    for jid, row in g_power.items():
        for t, pv in pvars[jid].items():
            m.AddHint(pv, row[t] // u)

    def stage(expr, minimize=True, limit=time_limit_s):
        if minimize:
            m.Minimize(expr)
        else:
            m.Maximize(expr)
        solver.parameters.max_time_in_seconds = limit
        st = solver.Solve(m)
        if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        last["status"] = "OPTIMAL" if st == cp_model.OPTIMAL else "FEASIBLE"
        for var in all_vars:
            best[var.Index()] = solver.Value(var)
        val = round(solver.ObjectiveValue())
        m.ClearHints()
        for var in all_vars:
            m.AddHint(var, best[var.Index()])
        return val

    # 1. deadlines: minimise total lateness (0 when every ready-by time can be met)
    total_late = sum(late.values())
    v = stage(total_late) or stage(total_late, limit=time_limit_s * 5)
    if v is None and not best:
        # The solver found nothing in time: fall back to the greedy plan rather than no plan.
        for j in todo:
            if j.id in g_start:
                dur = slots_needed(j, slot_min)
                st0 = g_start[j.id]
                power = [j.power_w if st0 <= t < st0 + dur else 0 for t in range(n)]
                start, end = st0, st0 + dur
            else:
                power = g_power[j.id]
                on = [t for t, w in enumerate(power) if w > 0]
                start, end = (on[0], on[-1] + 1) if on else (None, None)
            for t in range(n):
                res.ev_load[t] += power[t]
            res.jobs[j.id] = JobPlan(j.id, power, start, end,
                                     late_slots=max(0, (end or 0) - j.deadline))
        res.solver_status = "GREEDY_FALLBACK"
        return res
    m.Add(total_late <= v)

    end_sum = sum(ends.values()) if ends else 0
    if strategy == "site_limit_only":
        # first come, first served: finish as early as capacity allows
        w = sum((t + 1) * pv for ps in pvars.values() for t, pv in ps.items())
        stage(end_sum * 1000 + w)
    else:
        # 2. peak of (non-EV base + EV)
        base_u = [b // u for b in base]
        peak = m.NewIntVar(0, max(base_u) + sum(max(1, j.power_w // u) for j in todo) + 1, "peak")
        for t in range(n):
            if load[t]:
                m.Add(peak >= base_u[t] + slot_load[t])
        m.Add(peak >= max(base_u))
        v = stage(peak)
        if v is not None:
            m.Add(peak <= v)
        # 3. solar surplus used
        sol_u = [s // u for s in solar]
        used = []
        for t in range(n):
            if load[t] and sol_u[t] > 0:
                su = m.NewIntVar(0, sol_u[t], f"su{t}")
                m.Add(su <= slot_load[t])
                used.append((t, su))
        if used:
            tot_solar = sum(su for _, su in used)
            v = stage(tot_solar, minimize=False)
            if v is not None:
                m.Add(tot_solar >= v)
        # 4. ToD cost of the energy drawn from the grid
        used_at = dict(used)
        cost = sum((slot_load[t] - used_at.get(t, 0)) * price[t] for t in range(n) if load[t])
        if any(price):
            v = stage(cost)
            if v is not None:
                m.Add(cost <= v)
        # 5. fairness, then "sooner is better" as the final tie-break
        fair = sum((1 + 4 * j.fairness) * ends[j.id] for j in todo if j.id in ends)
        for j in todo:
            for t, pv in pvars.get(j.id, {}).items():
                fair += (1 + 4 * j.fairness) * (t + 1) * pv
        stage(fair)

    res.solver_status = last["status"]
    for j in todo:
        power = [0] * n
        if j.id in starts:
            s = best[starts[j.id].Index()]
            dur = slots_needed(j, slot_min)
            for t in range(s, s + dur):
                power[t] = j.power_w
            start, end = s, s + dur
        else:
            for t, pv in pvars[j.id].items():
                power[t] = best[pv.Index()] * u
            on = [t for t, w in enumerate(power) if w > 0]
            start, end = (on[0], on[-1] + 1) if on else (None, None)
        for t in range(n):
            res.ev_load[t] += power[t]
        res.jobs[j.id] = JobPlan(j.id, power, start, end, late_slots=best[late[j.id].Index()])
    return res


def _greedy(todo, cap, n, slot_min):
    """Earliest-deadline-first placement that respects capacity where it can."""
    room = list(cap)
    g_start, g_power = {}, {}
    order = sorted(todo, key=lambda j: (not j.started, j.deadline, j.id))
    for j in order:
        if j.interruptible:
            need = j.energy_wh * 60 / slot_min  # W-slots
            row = [0] * n
            for t in range(min(j.earliest, n - 1), n):
                if need <= 0:
                    break
                w = int(min(j.power_w, room[t], math.ceil(need / UNIT_W) * UNIT_W))
                w = max(0, w // UNIT_W * UNIT_W)
                row[t], room[t], need = w, room[t] - w, need - w
            g_power[j.id] = row
            continue
        dur = slots_needed(j, slot_min)
        lo = 0 if j.started else min(j.earliest, n - dur)
        pick = lo
        if not j.started:
            pick = next((t for t in range(lo, n - dur + 1)
                         if all(room[k] >= j.power_w for k in range(t, t + dur))), n - dur)
        for k in range(pick, min(n, pick + dur)):
            room[k] -= j.power_w
        g_start[j.id] = pick
    return g_start, g_power


def smallest_relaxation(result: PlanResult, slot_min: int = 15) -> dict[int, int]:
    """Minutes each late session's ready-by time would have to move. The solver
    minimised total lateness first, so this is the smallest total relaxation."""
    return {j.id: j.late_slots * slot_min for j in result.jobs.values() if j.late_slots > 0}
