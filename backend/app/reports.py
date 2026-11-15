"""Night report and public impact numbers, computed from stored measurements."""

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit
from .control import load_frames
from .models import ChargeSession, MeterReading, Override, Site, User
from .scheduler import Job, plan
from .tariff import IST, UTC, next_cheap_start, price_profile, to_ist

SLOT = 15


def night_window(day: date) -> tuple[datetime, datetime]:
    """The 'night of <day>' runs 12:00 IST on that day to 12:00 IST the next day."""
    start = datetime.combine(day, time(12, 0), IST).astimezone(UTC).replace(tzinfo=None)
    return start, start + timedelta(hours=24)


def default_night(now: datetime) -> date:
    """The most recent night that has finished (a night ends at 12:00 IST)."""
    local = to_ist(now)
    return (local - timedelta(days=1 if local.hour >= 12 else 2)).date()


def _sessions_in(db: Session, site_id: int, start: datetime, end: datetime):
    return list(db.scalars(select(ChargeSession).where(
        ChargeSession.site_id == site_id, ChargeSession.plugged_at < end,
        ChargeSession.ready_by >= start, ChargeSession.status != "cancelled")
        .order_by(ChargeSession.plugged_at)))


def counterfactual(site: Site, sessions, frame, start: datetime, strategy: str) -> dict:
    """What the same sessions would have done to the same measured non-EV load under a
    baseline strategy. MODELLED: it re-places real sessions, it was not measured."""
    n = 96
    nonev = [0] * n
    if len(frame):
        for ts, v in frame["nonev_w"].items():
            i = int((ts - start).total_seconds() // 60 // SLOT)
            if 0 <= i < n:
                nonev[i] = int(v)
    jobs = []
    for s in sessions:
        e = max(0, int((s.plugged_at - start).total_seconds() // 60 // SLOT))
        d = max(e + 1, int((s.ready_by - start).total_seconds() // 60 // SLOT))
        cheap = int((next_cheap_start(site.tariff, max(start, s.plugged_at)) - start)
                    .total_seconds() // 60 // SLOT)
        energy = s.delivered_wh if s.delivered_wh > 0 else s.energy_needed_wh
        jobs.append(Job(s.id, s.power_w, energy, min(e, n - 1), min(d, n + 31),
                        cheap_start=cheap))
    usable = int((site.limit_va - site.safety_margin_va) * site.power_factor)
    r = plan(jobs, [usable - x for x in nonev], nonev, None,
             price_profile(site.tariff, start, n, SLOT), strategy=strategy, slot_min=SLOT)
    return {"peak_w": r.peak_w, "cost_paise": r.cost_paise,
            "total_w": [nonev[i] + r.ev_load[i] for i in range(n)]}


def night_report(db: Session, site: Site, day: date) -> dict:
    start, end = night_window(day)
    frame = load_frames(db, site, start, end, SLOT)
    sessions = _sessions_in(db, site.id, start, end)
    done = [s for s in sessions if s.status == "done"]
    met = [s for s in done if s.ended_at and s.ended_at <= s.ready_by + timedelta(minutes=5)]
    spare = [(s.ready_by - s.ended_at).total_seconds() / 60 for s in done if s.ended_at]
    kwh = sum(s.delivered_wh for s in sessions) / 1000
    solar_kwh = sum(s.solar_wh for s in sessions) / 1000
    cost = sum(s.cost_paise for s in sessions)
    peak_w = float(frame["load_w"].max()) if len(frame) else 0.0
    raw_peak = db.scalar(select(func.max(MeterReading.load_w)).where(
        MeterReading.site_id == site.id, MeterReading.ts >= start, MeterReading.ts < end))
    simulated = bool(len(frame) and frame["simulated"].max() > 0)
    tod = counterfactual(site, sessions, frame, start, "tod_timer") if sessions else None
    unc = counterfactual(site, sessions, frame, start, "uncontrolled") if sessions else None
    overrides = db.scalar(select(func.count(Override.id)).where(
        Override.ts >= start, Override.ts < end,
        Override.session_id.in_([s.id for s in sessions] or [0]))) or 0
    limit_w = site.limit_va * site.power_factor
    series = [{"ts": ts.isoformat() + "Z", "load_w": round(r.load_w), "ev_w": round(r.ev_w),
               "export_w": round(r.export_w)} for ts, r in frame.iterrows()]
    return {
        "site": site.name, "night_of": day.isoformat(),
        "window": {"start": start.isoformat() + "Z", "end": end.isoformat() + "Z"},
        "source": "SIMULATED" if simulated else "MEASURED",
        "has_data": bool(len(frame)),
        "peak_w": round(raw_peak or peak_w), "peak_15min_w": round(peak_w),
        "limit_w": round(limit_w), "limit_va": site.limit_va,
        "peak_pct_of_limit": round(100 * peak_w / limit_w, 1) if limit_w else None,
        "sessions": len(sessions), "sessions_done": len(done), "ready_by_met": len(met),
        "worst_spare_min": round(min(spare)) if spare else None,
        "kwh_delivered": round(kwh, 2), "kwh_solar": round(solar_kwh, 2),
        "cost_paise": cost,
        "tod_timer": {"peak_w": tod["peak_w"], "cost_paise": tod["cost_paise"],
                      "total_w": tod["total_w"]} if tod else None,
        "uncontrolled": {"peak_w": unc["peak_w"], "cost_paise": unc["cost_paise"]} if unc else None,
        "saved_paise_vs_uncontrolled": (unc["cost_paise"] - cost) if unc else None,
        "peak_reduction_pct_vs_tod": round(100 * (tod["peak_w"] - peak_w) / tod["peak_w"], 1)
        if tod and tod["peak_w"] else None,
        "overrides": overrides, "audit": audit.verify(db), "series": series,
        "session_rows": [session_row(s) for s in sessions],
    }


def session_row(s: ChargeSession) -> dict:
    iso = lambda t: t.isoformat() + "Z" if t else None  # noqa: E731
    return {"id": s.id, "plug_id": s.plug_id, "vehicle_type": s.vehicle_type,
            "status": s.status, "power_w": s.power_w, "interruptible": s.interruptible,
            "battery_pct": s.battery_pct, "energy_needed_wh": s.energy_needed_wh,
            "delivered_wh": round(s.delivered_wh), "solar_wh": round(s.solar_wh),
            "cost_paise": s.cost_paise, "plugged_at": iso(s.plugged_at),
            "ready_by": iso(s.ready_by), "planned_start": iso(s.planned_start),
            "planned_end": iso(s.planned_end), "started_at": iso(s.started_at),
            "ended_at": iso(s.ended_at), "overridden": s.overridden, "at_risk": s.at_risk,
            "proposed_ready_by": iso(s.proposed_ready_by), "rating": s.rating,
            "anomaly": s.anomaly, "source": s.source.upper()}


def impact(db: Session) -> dict:
    """Aggregate, non-personal numbers for the public page."""
    sessions = list(db.scalars(select(ChargeSession).where(ChargeSession.status == "done")))
    met = sum(1 for s in sessions if s.ended_at and s.ended_at <= s.ready_by + timedelta(minutes=5))
    simulated = sum(1 for s in sessions if s.source == "simulated")
    users = db.scalar(select(func.count(func.distinct(ChargeSession.user_id)))) or 0
    reductions = []
    for site in db.scalars(select(Site)):
        last = db.scalar(select(func.max(ChargeSession.plugged_at))
                         .where(ChargeSession.site_id == site.id))
        if not last:
            continue
        for back in range(1, 8):
            day = (to_ist(last) - timedelta(days=back - 1)).date()
            start, end = night_window(day)
            ss = [s for s in _sessions_in(db, site.id, start, end) if s.status == "done"]
            if len(ss) < 2:
                continue
            frame = load_frames(db, site, start, end, SLOT)
            if not len(frame):
                continue
            tod = counterfactual(site, ss, frame, start, "tod_timer")
            if tod["peak_w"]:
                reductions.append(100 * (tod["peak_w"] - float(frame["load_w"].max()))
                                  / tod["peak_w"])
    return {
        "users": users, "sessions": len(sessions),
        "kwh_measured": round(sum(s.delivered_wh for s in sessions) / 1000, 1),
        "deadlines_met": met,
        "deadlines_met_pct": round(100 * met / len(sessions), 1) if sessions else None,
        "kwh_solar": round(sum(s.solar_wh for s in sessions) / 1000, 1),
        "peak_reduction_pct_vs_tod": round(sum(reductions) / len(reductions), 1)
        if reductions else None,
        "nights_compared": len(reductions),
        "source": "SIMULATED" if sessions and simulated == len(sessions) else
        "MEASURED" if simulated == 0 else "MIXED",
        "registered_users": db.scalar(select(func.count(User.id))) or 0,
    }
