"""Neighbourhood transformer twin.

One distribution transformer = the site's building load (MEASURED when the
meter has history) + N households (MODELLED) + EV sessions (MODELLED arrivals,
charging powers from the vehicle catalogue or measured plugs).

For each EV-adoption level it runs all five strategies through the same
scheduler entry point and the IEC 60076-7 thermal model, and reports the
adoption at which each strategy first overloads the transformer.
"""

import csv
import math
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import thermal
from .scheduler import STRATEGIES, Job, plan, slots_needed
from .tariff import DEFAULT_TARIFF
from .vehicles import VEHICLES, energy_needed_wh

SLOT_MIN = 15
DAY = 96
START_HOUR_IST = 12  # the twin day runs noon to noon so one night sits in the middle
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CEEW_FILE = DATA_DIR / "ceew_households.csv"


@dataclass
class TwinConfig:
    rated_kva: float = 100.0
    homes: int = 120
    power_factor: float = 0.95
    mix: dict = field(default_factory=lambda: {"e_scooter": 0.6, "e_rickshaw": 0.1, "e_car": 0.3})
    adoption_levels: tuple = (5, 10, 15, 20, 25, 30, 35, 40)
    ambient_mean_c: float = 30.0
    ambient_swing_c: float = 5.0
    transformer_cost_paise: int = 25_000_000  # Rs 2.5 lakh, config
    normal_life_h: float = 180_000.0
    thermal: dict = field(default_factory=dict)
    seed: int = 11
    solver_time_s: float = 1.0
    random_delay_max_min: int = 30


def household_profiles(n: int, seed: int = 11) -> tuple[list[list[float]], str]:
    """n daily profiles (W per 15-min slot, starting 12:00 IST) and their provenance."""
    rng = random.Random(seed)
    if CEEW_FILE.exists():
        with CEEW_FILE.open() as f:
            rows = list(csv.reader(f))
        cols = list(zip(*rows[1:], strict=False))[1:]  # first column is the slot index
        homes = [[float(v) for v in c] for c in cols if len(c) == DAY]
        if homes:
            shift = START_HOUR_IST * 4  # file starts at 00:00 IST
            picked = [homes[rng.randrange(len(homes))] for _ in range(n)]
            return [h[shift:] + h[:shift] for h in picked], "CEEW smart-meter profiles"
    # Placeholder shape until the CEEW files are prepared with tools/ceew_prepare.py.
    out = []
    for _ in range(n):
        scale = rng.lognormvariate(0, 0.35)
        evening, morning = rng.gauss(20.5, 0.7), rng.gauss(7.5, 0.6)
        prof = []
        for s in range(DAY):
            h = (START_HOUR_IST + s / 4) % 24
            w = 140 + 420 * math.exp(-((h - evening) ** 2) / 5.0)
            w += 190 * math.exp(-((h - morning) ** 2) / 2.5)
            w += 120 * math.exp(-((h - 14.5) ** 2) / 8.0)
            if h >= 22.5 or h < 5.5:
                w += 160  # night cooling
            prof.append(max(60.0, scale * w * rng.uniform(0.85, 1.15)))
        out.append(prof)
    return out, "synthetic placeholder (CEEW data not loaded)"


def _slot_of(hour_ist: float) -> int:
    return int(round(((hour_ist - START_HOUR_IST) % 24) * 4))


def make_fleet(n_ev: int, cfg: TwinConfig, cheap_slot: int, rng: random.Random) -> list[Job]:
    kinds, weights = list(cfg.mix.keys()), list(cfg.mix.values())
    jobs = []
    for i in range(n_ev):
        kind = rng.choices(kinds, weights)[0]
        v = VEHICLES[kind]
        arrive = min(23.5, max(16.0, rng.gauss(21.0 if kind == "e_rickshaw" else 19.5, 1.3)))
        ready = min(9.5, max(5.0, rng.gauss(7.0, 0.9)))
        job = Job(id=i + 1, power_w=v["charger_w"],
                  energy_wh=energy_needed_wh(kind, rng.randint(20, 65)),
                  earliest=_slot_of(arrive), deadline=_slot_of(ready),
                  interruptible=False, cheap_start=cheap_slot)
        # keep every modelled trip physically possible
        job.deadline = max(job.deadline, job.earliest + slots_needed(job, SLOT_MIN))
        jobs.append(job)
    return jobs


def cheap_slot_for(tariff: dict | None) -> int:
    t = tariff or DEFAULT_TARIFF
    wins = t.get("windows", [])
    if not wins:
        return 0
    w = min(wins, key=lambda w: w["multiplier"])
    h, m = w["start"].split(":")
    return _slot_of(int(h) + int(m) / 60)


def _price(tariff: dict | None, n: int) -> list[int]:
    t = tariff or DEFAULT_TARIFF
    base = t.get("base_paise_per_kwh", 0)
    out = []
    for s in range(n):
        minute = int(((START_HOUR_IST * 60) + s * SLOT_MIN) % 1440)
        mult = 1.0
        for w in t.get("windows", []):
            a = int(w["start"][:2]) * 60 + int(w["start"][3:])
            b = int(w["end"][:2]) * 60 + int(w["end"][3:])
            if (a <= minute < b) if a < b else (minute >= a or minute < b):
                mult = w["multiplier"]
        out.append(int(round(base * mult)))
    return out


def ambient(cfg: TwinConfig, n: int) -> list[float]:
    return [cfg.ambient_mean_c + cfg.ambient_swing_c *
            math.cos(((START_HOUR_IST + s / 4) - 15) / 24 * 2 * math.pi) for s in range(n)]


def run_level(adoption_pct: float, cfg: TwinConfig, building_w: list[float] | None = None,
              tariff: dict | None = None, strategies=STRATEGIES, detail: bool = False) -> dict:
    extra = 32
    n = DAY + extra
    homes, provenance = household_profiles(cfg.homes, cfg.seed)
    hh = [sum(h[s % DAY] for h in homes) for s in range(n)]
    bld = [(building_w[s % DAY] if building_w else 0.0) for s in range(n)]
    base = [int(hh[s] + bld[s]) for s in range(n)]
    rated_w = cfg.rated_kva * 1000 * cfg.power_factor
    capacity = [int(rated_w - base[s]) for s in range(n)]
    n_ev = int(round(cfg.homes * adoption_pct / 100))
    # one fleet for the whole sweep; each adoption level takes the first n_ev vehicles
    max_ev = int(round(cfg.homes * max(max(cfg.adoption_levels), adoption_pct) / 100))
    fleet = make_fleet(max_ev, cfg, cheap_slot_for(tariff), random.Random(cfg.seed))[:n_ev]
    price = _price(tariff, n)
    amb = ambient(cfg, n)
    tp = thermal.ThermalParams.from_config(cfg.thermal)
    strategies_out: dict[str, dict] = {}
    out: dict = {"adoption_pct": adoption_pct, "evs": n_ev, "strategies": strategies_out}
    if detail:
        out |= {"base_w": base, "household_w": [int(x) for x in hh],
                "building_w": [int(x) for x in bld], "ambient_c": [round(a, 1) for a in amb],
                "rated_w": rated_w, "household_source": provenance,
                "start_hour_ist": START_HOUR_IST, "slot_min": SLOT_MIN}
    for st in strategies:
        r = plan(fleet, capacity[:DAY], base[:DAY], None, price[:DAY], strategy=st,
                 slot_min=SLOT_MIN, time_limit_s=cfg.solver_time_s, extra_slots=extra,
                 seed=cfg.seed, random_delay_max_min=cfg.random_delay_max_min)
        total = [base[s] + r.ev_load[s] for s in range(n)]
        K = [t / rated_w for t in total]
        th = thermal.simulate(K, amb, tp, dt_min=SLOT_MIN)
        met = sum(1 for j in r.jobs.values() if j.late_slots == 0 and not j.impossible)
        m: dict = {
            "peak_pct": round(max(K) * 100, 1),
            "minutes_over": sum(1 for k in K if k > 1.0) * SLOT_MIN,
            "max_hot_spot_c": round(th.max_hot_spot, 1),
            "life_lost_h": round(th.loss_of_life_h, 2),
            "life_lost_paise": thermal.life_cost_paise(th.loss_of_life_h,
                                                       cfg.transformer_cost_paise,
                                                       cfg.normal_life_h),
            "deadlines_met": met, "deadlines_total": len(fleet),
            "cost_paise": r.cost_paise,
        }
        if detail:
            m |= {"total_w": [int(t) for t in total], "ev_w": r.ev_load,
                  "hot_spot_c": [round(x, 1) for x in th.hot_spot],
                  "top_oil_c": [round(x, 1) for x in th.top_oil]}
        out["strategies"][st] = m
    return out


def sweep(cfg: TwinConfig | None = None, building_w: list[float] | None = None,
          tariff: dict | None = None) -> dict:
    cfg = cfg or TwinConfig()
    levels = [run_level(a, cfg, building_w, tariff) for a in cfg.adoption_levels]
    first = {}
    for st in STRATEGIES:
        hit = next((lv["adoption_pct"] for lv in levels
                    if lv["strategies"][st]["minutes_over"] > 0
                    or lv["strategies"][st]["deadlines_met"] < lv["strategies"][st]["deadlines_total"]),
                   None)
        over = next((lv["adoption_pct"] for lv in levels
                     if lv["strategies"][st]["minutes_over"] > 0), None)
        first[st] = {"first_overload_pct": over, "first_failure_pct": hit}
    _, provenance = household_profiles(1, cfg.seed)
    cfg_d = asdict(cfg)
    cfg_d["adoption_levels"] = list(cfg.adoption_levels)
    return {"config": cfg_d, "levels": levels, "first_overload": first,
            "household_source": provenance,
            "building_source": "MEASURED" if building_w else "none"}
