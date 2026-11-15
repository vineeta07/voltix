"""In-process device simulator, enabled with VOLTIX_SIMULATE=1.

It stands in for the meter and the smart plugs so the whole system can run
without hardware. Everything it produces is stored with source="simulated"
and is labelled SIMULATED in the UI. It is never used when real devices are
paired, and it is not part of the control logic.
"""

import math
import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, ingest
from .models import ChargeSession, Meter, Plug, Site, User, utcnow
from .tariff import DEFAULT_TARIFF, to_ist
from .vehicles import VEHICLES, energy_needed_wh

rng = random.Random(42)
SOLAR_KWP = 6.0


def building_w(ts: datetime, noise: bool = True) -> float:
    """A campus building: daytime occupancy, small evening tail, low night base."""
    t = to_ist(ts)
    h = t.hour + t.minute / 60
    weekend = t.weekday() >= 5
    day = 5200 * math.exp(-((h - 13.5) ** 2) / 18.0) * (0.45 if weekend else 1.0)
    evening = 1500 * math.exp(-((h - 20.0) ** 2) / 5.0)
    w = 1900 + day + evening
    return w * (rng.uniform(0.96, 1.04) if noise else 1.0)


def solar_w(ts: datetime, noise: bool = True) -> float:
    t = to_ist(ts)
    h = t.hour + t.minute / 60
    if h < 6.2 or h > 18.2:
        return 0.0
    clear = math.sin((h - 6.2) / 12.0 * math.pi) ** 1.3
    cloud = 0.75 + 0.25 * math.sin(t.timetuple().tm_yday * 1.7) if noise else 1.0
    return SOLAR_KWP * 1000 * clear * cloud


def meter_reading(ts: datetime, ev_w: float) -> dict:
    net = building_w(ts) + ev_w - solar_w(ts)
    return {"load_w": max(0.0, net), "export_w": max(0.0, -net),
            "voltage": 230 + rng.uniform(-4, 4)}


def step(db: Session, dt_s: float) -> None:
    """Advance every simulated device by dt_s seconds and ingest the readings."""
    now = utcnow()
    for site in db.scalars(select(Site)):
        plugs = list(db.scalars(select(Plug).where(Plug.site_id == site.id,
                                                   Plug.source == "simulated")))
        if not plugs:
            continue
        ev_total = 0.0
        for p in plugs:
            s = db.scalars(select(ChargeSession).where(
                ChargeSession.plug_id == p.id,
                ChargeSession.status.in_(("waiting", "charging", "paused")))).first()
            power = 0.0
            if s and p.is_on:
                left = s.energy_needed_wh - s.delivered_wh
                if left > 0:
                    taper = min(1.0, max(0.12, left / (0.08 * s.energy_needed_wh)))
                    power = s.power_w * taper * rng.uniform(0.97, 1.03)
            total = p.total_wh + power * dt_s / 3600
            ingest.record_plug(db, p, {"power_w": round(power, 1), "total_wh": total}, now,
                               "simulated")
            ev_total += power
        meter = db.scalars(select(Meter).where(Meter.site_id == site.id)).first()
        if meter:
            ingest.record_meter(db, meter, meter_reading(now, ev_total), now, "simulated")


def seed(db: Session, days: int = 9) -> None:
    """A demo site with simulated history so every screen has something to show."""
    from .models import MeterReading, PlugReading

    if db.scalars(select(Site)).first():
        return
    site = Site(slug="dtu-pilot", name="DTU pilot building", kind="campus", limit_va=12000,
                safety_margin_va=600, power_factor=0.95, tariff=DEFAULT_TARIFF,
                transformer={"rated_kva": 100, "homes": 120, "cost_paise": 25_000_000,
                             "normal_life_h": 180_000})
    db.add(site)
    db.flush()
    db.add(Meter(site_id=site.id, name="Main supply meter", topic="voltix/dtu-pilot/meter"))
    specs = [("Bay 1 - scooter", "sim-plug-1", 750, "tasmota"),
             ("Bay 2 - scooter", "sim-plug-2", 750, "tasmota"),
             ("Bay 3 - e-rickshaw", "sim-plug-3", 1300, "tasmota"),
             ("Bay 4 - e-rickshaw", "sim-plug-4", 1300, "tasmota"),
             ("Bay 5 - scooter", "sim-plug-5", 750, "tasmota"),
             ("Bay 6 - car (OCPP)", "sim-cp-6", 3300, "ocpp")]
    plugs = []
    for name, topic, w, kind in specs:
        p = Plug(site_id=site.id, name=name, topic=topic, max_w=w, kind=kind,
                 source="simulated", online=True, is_on=True)
        db.add(p)
        plugs.append(p)
    people = [("Asha", "user"), ("Rohit", "user"), ("Imran", "user"), ("Meena", "user"),
              ("Kabir", "user")]
    users = []
    for name, role in people:
        u = User(email=f"{name.lower()}@demo.voltix.local", name=name, role=role,
                 consent_at=utcnow(), consent_text="Demo account (simulated).")
        db.add(u)
        users.append(u)
    db.flush()

    # History: one reading a minute. Sessions are placed the way VOLTIX would place them:
    # staggered through the night, daytime ones inside the solar hours.
    now = utcnow().replace(second=0, microsecond=0)
    start = now - timedelta(days=days)
    hist_rng = random.Random(5)
    sessions: list[ChargeSession] = []
    day0 = to_ist(start).date()
    for d in range(days):
        from .reports import night_window
        w0, _ = night_window(day0 + timedelta(days=d))
        slots = [(18.5, 31.0, 3), (19.0, 30.5, 2), (20.0, 31.5, 0), (21.0, 30.0, 1),
                 (22.0, 31.0, 4)]
        offset = 0.0
        for arrive_h, ready_h, pi in slots:
            if hist_rng.random() < 0.15:
                continue
            plug, user = plugs[pi], users[pi % len(users)]
            kind = "e_rickshaw" if plug.max_w == 1300 else "e_scooter"
            pct = hist_rng.randint(15, 60)
            need = energy_needed_wh(kind, pct)
            plugged = w0 + timedelta(hours=arrive_h - 12 + hist_rng.uniform(-0.4, 0.4))
            ready = w0 + timedelta(hours=ready_h - 12 + hist_rng.uniform(-0.3, 0.3))
            dur_h = need / plug.max_w
            begin = max(plugged + timedelta(minutes=5),
                        w0 + timedelta(hours=11.0 + offset))  # from 23:00 IST, one after another
            offset += dur_h * 0.55
            finish = begin + timedelta(hours=dur_h)
            if finish > ready:
                begin, finish = ready - timedelta(hours=dur_h + 0.4), ready - timedelta(hours=0.4)
            if finish > now or plugged < start:
                continue
            sessions.append(ChargeSession(
                site_id=site.id, plug_id=plug.id, user_id=user.id, vehicle_type=kind,
                battery_pct=pct, energy_needed_wh=need, power_w=plug.max_w,
                interruptible=False, plugged_at=plugged, ready_by=ready, planned_start=begin,
                planned_end=finish, started_at=begin, ended_at=finish, delivered_wh=need,
                status="done", rating=hist_rng.choice([4, 5, 5, 5]), source="simulated"))
        # a daytime scooter charge, pulled into solar surplus on weekends
        dt0 = w0 + timedelta(hours=22.5 + hist_rng.uniform(0, 1.5))  # ~10:30-12:00 IST next day
        need = energy_needed_wh("e_scooter", 40)
        fin = dt0 + timedelta(hours=need / 750)
        if fin < now and dt0 > start:
            sessions.append(ChargeSession(
                site_id=site.id, plug_id=plugs[4].id, user_id=users[4].id,
                vehicle_type="e_scooter", battery_pct=40, energy_needed_wh=need, power_w=750,
                interruptible=False, plugged_at=dt0 - timedelta(minutes=40),
                ready_by=fin + timedelta(hours=3), planned_start=dt0, planned_end=fin,
                started_at=dt0, ended_at=fin, delivered_wh=need, status="done", rating=5,
                source="simulated"))
    db.add_all(sessions)
    db.flush()

    totals = {p.id: 0.0 for p in plugs}
    by_plug: dict[int, list[ChargeSession]] = {p.id: [] for p in plugs}
    for s in sessions:
        by_plug[s.plug_id].append(s)
    meter_rows, plug_rows = [], []
    from .tariff import cost_paise, rate_at
    ts = start
    while ts < now:
        ev = 0.0
        active = []
        for p in plugs:
            power = 0.0
            for s in by_plug[p.id]:
                if s.started_at and s.ended_at and s.started_at <= ts < s.ended_at:
                    power = s.power_w * hist_rng.uniform(0.97, 1.03)
                    active.append((s, power))
            totals[p.id] += power / 60
            if ts.minute % 5 == 0 or power > 0:
                plug_rows.append({"ts": ts, "plug_id": p.id, "power_w": round(power, 1),
                                  "total_wh": totals[p.id], "source": "simulated"})
            ev += power
        net = building_w(ts) + ev - solar_w(ts)
        surplus = max(0.0, -(net - ev))
        for s, power in active:
            share = min(1.0, surplus / ev) if ev else 0.0
            s.solar_wh += power / 60 * share
            s.cost_paise += cost_paise(power / 60 * (1 - share),
                                       rate_at(site.tariff, ts).paise_per_kwh)
        meter_rows.append({"ts": ts, "site_id": site.id, "load_w": max(0.0, net),
                           "export_w": max(0.0, -net), "voltage": 230.0, "source": "simulated"})
        ts += timedelta(minutes=1)
    db.bulk_insert_mappings(MeterReading, meter_rows)
    db.bulk_insert_mappings(PlugReading, plug_rows)
    for p in plugs:
        p.total_wh, p.last_seen = totals[p.id], now
    audit.append(db, "config", {"event": "demo site seeded", "site": site.slug,
                                "note": "all history is SIMULATED"})
    _ = VEHICLES
