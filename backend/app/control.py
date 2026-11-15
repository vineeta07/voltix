"""Planning and the live control loop for a site. Deterministic code only.

replan()  builds the capacity profile from the P90 forecast and solves the schedule.
tick()    runs every minute: starts due sessions, tracks energy, reacts to overload.

Fail open: when there is no plan or no data, plugs stay on and users can charge.
"""

import threading
import time
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, commands, notify, weather
from . import forecast as fc
from .config import get_settings
from .models import (
    Alert,
    ChargeSession,
    ForecastPoint,
    MeterReading,
    Override,
    Plan,
    Plug,
    PlugReading,
    Site,
    User,
    must,
    utcnow,
)
from .scheduler import Job, plan, smallest_relaxation
from .tariff import cost_paise, next_cheap_start, price_profile, rate_at, to_ist

ACTIVE = ("waiting", "charging", "paused")
_plan_lock = threading.Lock()
_fc_cache: dict[int, tuple[float, datetime, fc.Forecast]] = {}


def slot_floor(ts: datetime, slot_min: int) -> datetime:
    return ts.replace(minute=ts.minute - ts.minute % slot_min, second=0, microsecond=0)


def fmt_ist(ts: datetime | None) -> str:
    return to_ist(ts).strftime("%H:%M") if ts else "-"


# ---------------------------------------------------------------- measured series

def load_frames(db: Session, site: Site, since: datetime, until: datetime | None = None,
                slot_min: int = 15) -> pd.DataFrame:
    """Slot-resolution frame: load_w, export_w, ev_w, nonev_w (>=0), surplus_w (>=0), source."""
    until = until or utcnow()
    rows = db.execute(select(MeterReading.ts, MeterReading.load_w, MeterReading.export_w,
                             MeterReading.source)
                      .where(MeterReading.site_id == site.id, MeterReading.ts >= since,
                             MeterReading.ts < until).order_by(MeterReading.ts)).all()
    cols = ["load_w", "export_w", "ev_w", "nonev_w", "surplus_w", "simulated"]
    if not rows:
        return pd.DataFrame(columns=cols)
    m = pd.DataFrame(rows, columns=["ts", "load_w", "export_w", "source"]).set_index("ts")
    m["simulated"] = (m.pop("source") == "simulated").astype(float)
    rule = f"{slot_min}min"
    out = m.resample(rule).mean()
    plug_ids = [p.id for p in db.scalars(select(Plug).where(Plug.site_id == site.id))]
    ev = pd.Series(0.0, index=out.index)
    if plug_ids:
        pr = db.execute(select(PlugReading.ts, PlugReading.plug_id, PlugReading.power_w)
                        .where(PlugReading.plug_id.in_(plug_ids), PlugReading.ts >= since,
                               PlugReading.ts < until)).all()
        if pr:
            p = pd.DataFrame(pr, columns=["ts", "plug_id", "power_w"]).set_index("ts")
            per = p.groupby("plug_id")["power_w"].resample(rule).mean().unstack(0).fillna(0.0)
            ev = per.sum(axis=1).reindex(out.index).fillna(0.0)
    out["ev_w"] = ev
    net = out["load_w"] - out["export_w"] - out["ev_w"]
    out["nonev_w"] = net.clip(lower=0)
    out["surplus_w"] = (-net).clip(lower=0)
    return out.dropna(subset=["load_w"])[cols]


def get_forecast(db: Session, site: Site, now: datetime | None = None,
                 force: bool = False) -> fc.Forecast:
    s = get_settings()
    start = slot_floor(now or utcnow(), s.slot_minutes)
    hit = _fc_cache.get(site.id)
    if hit and not force and hit[1] == start and time.time() - hit[0] < 900:
        return hit[2]
    hist = load_frames(db, site, start - timedelta(days=21), start, s.slot_minutes)
    wx = weather.fetch(site.latitude, site.longitude, s.slot_minutes) \
        if s.open_meteo_enabled else None
    f = fc.forecast(hist["nonev_w"] if len(hist) else pd.Series(dtype=float), start,
                    s.horizon_slots, s.slot_minutes,
                    temp=wx["temp"] if wx is not None else None,
                    solar_surplus=hist["surplus_w"] if len(hist) else None,
                    irradiance=wx["irradiance"] if wx is not None else None)
    _fc_cache[site.id] = (time.time(), start, f)
    for ts, p50, p90, sol in zip(f.index, f.p50, f.p90, f.solar, strict=True):
        db.merge(ForecastPoint(site_id=site.id, ts=ts, p50_w=p50, p90_w=p90, solar_w=sol,
                               method=f.method))
    return f


def capacity_profile(site: Site, f: fc.Forecast, nonev_now: float | None = None) -> list[int]:
    """EV capacity per slot in W: site limit minus P90 non-EV load minus the safety margin."""
    usable_w = (site.limit_va - site.safety_margin_va) * site.power_factor
    cap = [int(usable_w - p90) for p90 in f.p90]
    if nonev_now is not None and cap:
        cap[0] = min(cap[0], int(usable_w - nonev_now))
    return [max(0, c) for c in cap]


def latest_meter(db: Session, site_id: int) -> MeterReading | None:
    return db.scalars(select(MeterReading).where(MeterReading.site_id == site_id)
                      .order_by(MeterReading.ts.desc()).limit(1)).first()


def measured_now(db: Session, site: Site) -> dict | None:
    m = latest_meter(db, site.id)
    if not m or (utcnow() - m.ts).total_seconds() > 300:
        return None
    ev = sum(p.power_w for p in db.scalars(select(Plug).where(Plug.site_id == site.id)))
    net = m.load_w - m.export_w - ev
    return {"ts": m.ts, "load_w": m.load_w, "export_w": m.export_w, "ev_w": ev,
            "nonev_w": max(0.0, net), "surplus_w": max(0.0, -net), "source": m.source}


# ---------------------------------------------------------------- planning

def active_sessions(db: Session, site_id: int) -> list[ChargeSession]:
    return list(db.scalars(select(ChargeSession).where(
        ChargeSession.site_id == site_id, ChargeSession.status.in_(ACTIVE))
        .order_by(ChargeSession.id)))


def remaining_wh(s: ChargeSession) -> float:
    return max(0.0, s.energy_needed_wh - s.delivered_wh)


def replan(db: Session, site: Site, reason: str = "periodic",
           now: datetime | None = None) -> Plan | None:
    """Solve the schedule for every active session and store it. The caller commits."""
    cfg = get_settings()
    now = now or utcnow()
    with _plan_lock:
        sessions = active_sessions(db, site.id)
        slot_min = cfg.slot_minutes
        t0 = slot_floor(now, slot_min)
        f = get_forecast(db, site, now)
        live = measured_now(db, site)
        cap = capacity_profile(site, f, live["nonev_w"] if live else None)
        price = price_profile(site.tariff, t0, cfg.horizon_slots, slot_min)

        def slot_of(ts: datetime, up: bool = False) -> int:
            d = (ts - t0).total_seconds() / 60 / slot_min
            return int(-(-d // 1)) if up else int(d // 1)

        users = {u.id: u for u in db.scalars(select(User).where(
            User.id.in_({s.user_id for s in sessions})))} if sessions else {}
        jobs = []
        for s in sessions:
            running = s.status == "charging"
            jobs.append(Job(
                id=s.id, power_w=s.power_w, energy_wh=remaining_wh(s),
                earliest=0 if running or s.overridden else max(0, slot_of(s.plugged_at, up=True)),
                deadline=max(1, slot_of(s.ready_by)),
                interruptible=s.interruptible and not s.overridden,
                started=(running or s.overridden) and not (s.interruptible and not s.overridden),
                fairness=min(5, users[s.user_id].late_count) if s.user_id in users else 0,
                cheap_start=max(0, slot_of(next_cheap_start(site.tariff, now), up=True)),
            ))
        result = plan(jobs, cap, [int(x) for x in f.p50], [int(x) for x in f.solar], price,
                      strategy="voltix", slot_min=slot_min, time_limit_s=cfg.solver_time_s)
        relax = smallest_relaxation(result, slot_min)

        waiting_starts = []
        for s in sessions:
            jp = result.jobs.get(s.id)
            if jp is None:
                continue
            was_risk = s.at_risk
            if jp.start is not None and s.status == "waiting":
                s.planned_start = max(now, t0 + timedelta(minutes=jp.start * slot_min)) \
                    if jp.start == 0 else t0 + timedelta(minutes=jp.start * slot_min)
                waiting_starts.append((s.planned_start, s))
            if jp.end is not None:
                s.planned_end = t0 + timedelta(minutes=jp.end * slot_min)
            s.at_risk = jp.impossible or jp.late_slots > 0
            s.proposed_ready_by = (s.ready_by + timedelta(minutes=relax[s.id])
                                   if s.id in relax else None)
            if s.at_risk and not was_risk:
                if jp.impossible:
                    msg = (f"Session #{s.id} needs {s.power_w} W but the site can never spare "
                           f"that much. Raise the limit or use a smaller charger.")
                else:
                    msg = (f"Session #{s.id} cannot be ready by {fmt_ist(s.ready_by)} IST. "
                           f"Smallest change: ready by {fmt_ist(s.proposed_ready_by)} IST.")
                notify.alert(db, site.id, "deadline_at_risk", msg, "critical", s.id)
                notify.telegram(users.get(s.user_id), "VOLTIX: " + msg)
        for s in sessions:
            s.position_last = False
        if len(waiting_starts) >= 2:
            max(waiting_starts, key=lambda x: x[0])[1].position_last = True

        body = {
            "slot_min": slot_min, "slots": len(result.ev_load), "method": f.method,
            "capacity_w": cap, "ev_w": result.ev_load[:len(cap)], "p50_w": [int(x) for x in f.p50],
            "p90_w": [int(x) for x in f.p90], "solar_w": [int(x) for x in f.solar],
            "price": price, "solver": result.solver_status, "cost_paise": result.cost_paise,
            "solar_wh": round(result.solar_wh), "relaxations_min": relax,
            "sessions": {str(j.id): {"start": j.start, "end": j.end, "late_slots": j.late_slots,
                                     "impossible": j.impossible,
                                     "power": j.power[:len(cap)] if sessions and
                                     any(s.id == j.id and s.interruptible for s in sessions)
                                     else None}
                         for j in result.jobs.values()},
        }
        p = Plan(site_id=site.id, created_at=now, slot_start=t0, reason=reason,
                 feasible=result.feasible, peak_w=result.peak_w, body=body)
        db.add(p)
        db.flush()
        audit.append(db, "plan", {"plan_id": p.id, "site": site.slug, "reason": reason,
                                  "feasible": result.feasible, "peak_w": result.peak_w,
                                  "sessions": {str(j.id): [j.start, j.end, j.late_slots]
                                               for j in result.jobs.values()}})
        from .hub import hub
        hub.publish(site.id, {"type": "plan", "plan_id": p.id, "reason": reason})
        return p


def latest_plan(db: Session, site_id: int) -> Plan | None:
    return db.scalars(select(Plan).where(Plan.site_id == site_id)
                      .order_by(Plan.id.desc()).limit(1)).first()


# ---------------------------------------------------------------- sessions

def start_session(db: Session, s: ChargeSession, plug: Plug, reason: str, now: datetime) -> None:
    s.status = "charging"
    s.started_at = s.started_at or now
    if s.start_total_wh is None:
        s.start_total_wh = plug.total_wh - s.delivered_wh
    commands.set_plug(db, plug, True, reason, s.id)


def finish_session(db: Session, s: ChargeSession, now: datetime, status: str = "done") -> None:
    s.status, s.ended_at = status, now
    user = db.get(User, s.user_id)
    if user and status == "done":
        user.late_count = user.late_count + 1 if s.position_last else max(0, user.late_count - 1)
        notify.telegram(user, f"VOLTIX: your {s.vehicle_type.replace('_', ' ')} is charged "
                              f"({s.delivered_wh / 1000:.1f} kWh).")
    plug = db.get(Plug, s.plug_id)
    if plug and not plug.is_on:
        commands.set_plug(db, plug, True, "session ended: plug released", s.id)  # fail open


def override(db: Session, s: ChargeSession, user: User, action: str, reason: str = "") -> None:
    """A user can always take control. Every override is logged."""
    now = utcnow()
    plug = must(db.get(Plug, s.plug_id))
    db.add(Override(session_id=s.id, user_id=user.id, action=action, reason=reason))
    audit.append(db, "override", {"session_id": s.id, "user_id": user.id, "action": action,
                                  "reason": reason})
    if action == "charge_now" and s.status in ("waiting", "paused"):
        s.overridden = True
        start_session(db, s, plug, "user override: charge now", now)
    elif action == "stop" and s.status in ACTIVE:
        finish_session(db, s, now, "cancelled")
    replan(db, must(db.get(Site, s.site_id)), "override", now)


# ---------------------------------------------------------------- live loop

def tick(db: Session, site: Site, now: datetime | None = None) -> dict:
    """One pass of the control loop. Returns counts (useful in tests and logs)."""
    now = now or utcnow()
    did = {"started": 0, "finished": 0, "paused": 0, "resumed": 0, "replanned": 0}
    plugs = {p.id: p for p in db.scalars(select(Plug).where(Plug.site_id == site.id))}
    live = measured_now(db, site)
    sessions = active_sessions(db, site.id)
    plan_row = latest_plan(db, site.id)
    step_h = get_settings().control_interval_s / 3600

    for s in sessions:
        plug = plugs.get(s.plug_id)
        if not plug:
            continue
        if s.status == "charging":
            before = s.delivered_wh
            if s.start_total_wh is not None and plug.total_wh >= s.start_total_wh:
                s.delivered_wh = plug.total_wh - s.start_total_wh
            else:  # plug has no usable counter: integrate power
                s.delivered_wh += plug.power_w * step_h
            delta = max(0.0, s.delivered_wh - before)
            if delta > 0:
                ev = max(1.0, live["ev_w"]) if live else 1.0
                share = min(1.0, live["surplus_w"] / ev + 0.0) if live else 0.0
                solar = delta * min(1.0, share)
                s.solar_wh += solar
                s.cost_paise += cost_paise(delta - solar, rate_at(site.tariff, now).paise_per_kwh)
            long_enough = s.started_at and (now - s.started_at) > timedelta(minutes=10)
            idle = plug.power_w < max(5.0, 0.03 * s.power_w)
            if remaining_wh(s) <= 0.02 * s.energy_needed_wh or (long_enough and idle
                                                               and plug.is_on):
                if remaining_wh(s) > 0.15 * s.energy_needed_wh:
                    s.anomaly = "stopped early: drew much less energy than expected"
                    notify.alert(db, site.id, "charger_anomaly",
                                 f"Session #{s.id} on {plug.name} stopped after "
                                 f"{s.delivered_wh / 1000:.2f} kWh of an expected "
                                 f"{s.energy_needed_wh / 1000:.2f} kWh.", "warning", s.id)
                finish_session(db, s, now)
                did["finished"] += 1
                continue
            if plug.is_on and plug.power_w > 1.25 * s.power_w + 50 and not s.anomaly:
                s.anomaly = "unusual draw: well above this charger's normal power"
                notify.alert(db, site.id, "charger_anomaly",
                             f"{plug.name} is drawing {plug.power_w:.0f} W; this charger "
                             f"normally draws {s.power_w} W.", "warning", s.id)
        elif s.status == "waiting":
            if plug.is_on and not s.overridden and (s.planned_start is None
                                                    or s.planned_start > now):
                if s.planned_start is not None:
                    commands.set_plug(db, plug, False, "waiting for scheduled start", s.id)
            if s.planned_start is not None and s.planned_start <= now:
                start_session(db, s, plug, "scheduled start", now)
                did["started"] += 1
        elif s.status == "paused":
            idx = _slot_index(plan_row, now)
            want = _planned_power(plan_row, s.id, idx)
            if want and want > 0:
                start_session(db, s, plug, "resume after pause", now)
                did["resumed"] += 1

    # Interruptible sessions follow their per-slot power plan.
    idx = _slot_index(plan_row, now)
    for s in sessions:
        if s.status == "charging" and s.interruptible and not s.overridden:
            want = _planned_power(plan_row, s.id, idx)
            plug = plugs.get(s.plug_id)
            if want is not None and plug:
                if want <= 0:
                    s.status = "paused"
                    commands.set_plug(db, plug, False, "planned pause", s.id)
                    did["paused"] += 1
                elif plug.kind == "ocpp" and commands.ocpp_limits.get(plug.topic) != want:
                    commands.set_plug(db, plug, True, "planned power", s.id, limit_w=want)

    # Measured overload: delay what has not started; pause interruptible only as a last resort.
    if live:
        measured_va = (live["load_w"]) / max(0.5, site.power_factor)
        if measured_va > site.limit_va:
            notify.alert(db, site.id, "overload",
                         f"Measured load {measured_va / 1000:.1f} kVA is above the site limit "
                         f"{site.limit_va / 1000:.1f} kVA.", "critical")
            replan(db, site, "measured overload", now)
            did["replanned"] += 1
            waiting_due = [s for s in active_sessions(db, site.id)
                           if s.status == "waiting" and s.planned_start
                           and s.planned_start <= now + timedelta(minutes=1)]
            if not waiting_due:
                victims = [s for s in sessions if s.status == "charging" and s.interruptible
                           and not s.overridden]
                if victims:
                    v = max(victims, key=lambda s: s.power_w)
                    v.status = "paused"
                    commands.set_plug(db, plugs[v.plug_id], False, "overload: paused", v.id)
                    did["paused"] += 1
        else:
            for a in db.scalars(select(Alert).where(Alert.site_id == site.id,
                                                    Alert.kind == "overload",
                                                    Alert.resolved.is_(False))):
                a.resolved = True

    # Unregistered charging: fail open, but tell the operator.
    busy = {s.plug_id for s in sessions}
    for p in plugs.values():
        if p.id not in busy and p.power_w > 50:
            notify.alert(db, site.id, "unregistered_charging",
                         f"{p.name} is drawing {p.power_w:.0f} W with no session registered. "
                         f"It is allowed to charge, but is not scheduled.", "info")
    return did


def _slot_index(plan_row: Plan | None, now: datetime) -> int | None:
    if not plan_row:
        return None
    i = int((now - plan_row.slot_start).total_seconds() // 60 // plan_row.body.get("slot_min", 15))
    return i if 0 <= i < plan_row.body.get("slots", 0) else None


def _planned_power(plan_row: Plan | None, session_id: int, idx: int | None) -> int | None:
    if plan_row is None or idx is None:
        return None
    row = plan_row.body.get("sessions", {}).get(str(session_id), {}).get("power")
    return row[idx] if row and idx < len(row) else None
