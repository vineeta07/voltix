"""VOLTIX API: FastAPI app, background tasks and routes."""

import asyncio
import contextlib
import threading
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, auth, commands, control, ingest, reports, simulator, twin
from . import forecast as fc
from .config import get_settings
from .db import get_db, init_db, session_scope
from .hub import hub
from .models import Alert, AuditEntry, ChargeSession, Meter, Override, Plug, Site, User, utcnow
from .tariff import DEFAULT_TARIFF, rate_at
from .vehicles import VEHICLES, energy_needed_wh

settings = get_settings()
iso = lambda t: t.isoformat() + "Z" if t else None  # noqa: E731


# ------------------------------------------------------------------ background

async def control_loop() -> None:
    last_slot = None
    while True:
        try:
            await asyncio.to_thread(_control_pass, last_slot)
            last_slot = control.slot_floor(utcnow(), settings.slot_minutes)
        except Exception as e:  # the loop must survive anything
            print(f"[control] {type(e).__name__}: {e}")
        await asyncio.sleep(settings.control_interval_s)


def _control_pass(last_slot) -> None:
    with session_scope() as db:
        now = utcnow()
        for site in db.scalars(select(Site)):
            if control.slot_floor(now, settings.slot_minutes) != last_slot:
                control.replan(db, site, "periodic", now)
            control.tick(db, site, now)
            hub.publish(site.id, {"type": "tick"})


async def simulator_loop() -> None:
    step_s = 5
    while True:
        try:
            await asyncio.to_thread(_sim_pass, step_s)
        except Exception as e:
            print(f"[simulator] {type(e).__name__}: {e}")
        await asyncio.sleep(step_s)


def _sim_pass(step_s: int) -> None:
    with session_scope() as db:
        simulator.step(db, step_s)


async def mqtt_loop() -> None:
    import ssl

    import aiomqtt

    while True:
        try:
            tls = ssl.create_default_context() if settings.mqtt_tls else None
            async with aiomqtt.Client(settings.mqtt_host, settings.mqtt_port,
                                      username=settings.mqtt_username or None,
                                      password=settings.mqtt_password or None,
                                      tls_context=tls) as client:
                for t in ("tele/#", "stat/#", "voltix/#"):
                    await client.subscribe(t)
                print(f"[mqtt] connected to {settings.mqtt_host}:{settings.mqtt_port}")

                async def pump() -> None:
                    while True:
                        topic, payload = await asyncio.to_thread(commands.outbox.get)
                        await client.publish(topic, payload, qos=1)

                task = asyncio.create_task(pump())
                try:
                    async for msg in client.messages:
                        await asyncio.to_thread(_ingest, str(msg.topic), bytes(msg.payload))
                finally:
                    task.cancel()
        except Exception as e:
            print(f"[mqtt] {type(e).__name__}: {e}; retrying in 5 s")
            await asyncio.sleep(5)


def _ingest(topic: str, payload: bytes) -> None:
    with session_scope() as db:
        ingest.handle_message(db, topic, payload)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    hub.bind(asyncio.get_running_loop())
    if settings.seed_demo:
        with session_scope() as db:
            simulator.seed(db)
    tasks = [asyncio.create_task(control_loop())]
    if settings.simulate:
        tasks.append(asyncio.create_task(simulator_loop()))
    if settings.mqtt_host:
        tasks.append(asyncio.create_task(mqtt_loop()))
    if settings.ocpp_port:
        from . import ocpp_cs
        tasks.append(asyncio.create_task(ocpp_cs.serve(settings.ocpp_port)))
    yield
    for t in tasks:
        t.cancel()
    for t in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await t


app = FastAPI(title="VOLTIX API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])


def get_site(site_id: int, db: Session = Depends(get_db)) -> Site:
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site not found")
    return site


# ------------------------------------------------------------------ public

@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    return {"ok": True, "sites": db.scalar(select(func.count(Site.id))), "time": iso(utcnow())}


@app.get("/api/config")
def public_config():
    return {"dev_login": settings.dev_login, "google_client_id": settings.google_client_id,
            "simulate": settings.simulate, "assistant": bool(settings.anthropic_api_key),
            "telegram": bool(settings.telegram_bot_token), "mqtt": bool(settings.mqtt_host),
            "slot_minutes": settings.slot_minutes}


@app.get("/api/vehicles")
def vehicles():
    return VEHICLES


@app.get("/api/impact")
def impact(db: Session = Depends(get_db)):
    return reports.impact(db)


@app.get("/api/sites")
def sites(db: Session = Depends(get_db)):
    return [{"id": s.id, "slug": s.slug, "name": s.name, "kind": s.kind,
             "limit_va": s.limit_va} for s in db.scalars(select(Site).order_by(Site.id))]


@app.get("/api/snapback")
def snapback(db: Session = Depends(get_db)):
    """The landing-page chart: one transformer, ToD timer vs VOLTIX (MODELLED)."""
    site = db.scalars(select(Site)).first()
    return _twin_level(site, 30.0, db)


# ------------------------------------------------------------------ auth

class DevLogin(BaseModel):
    email: str
    name: str = ""
    role: str = "user"


class GoogleLogin(BaseModel):
    credential: str


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role,
            "consented": u.consent_at is not None, "telegram": bool(u.telegram_chat_id)}


@app.post("/api/auth/dev-login")
def dev_login(body: DevLogin, db: Session = Depends(get_db)):
    if not settings.dev_login:
        raise HTTPException(404, "Development login is disabled")
    user = auth.upsert_user(db, body.email, body.name, body.role)
    return {"token": auth.make_token(user.id), "user": user_out(user)}


@app.post("/api/auth/google")
def google_login(body: GoogleLogin, db: Session = Depends(get_db)):
    info = auth.verify_google(body.credential)
    user = auth.upsert_user(db, info["email"], info.get("name", ""))
    return {"token": auth.make_token(user.id), "user": user_out(user)}


@app.get("/api/me")
def me(user: User = Depends(auth.current_user)):
    return user_out(user)


class Consent(BaseModel):
    accepted: bool
    telegram_chat_id: str | None = None


CONSENT_TEXT = ("I agree that VOLTIX records my charging sessions (times, energy, vehicle type) "
                "to schedule charging at this site and to report anonymous totals. I can "
                "override the schedule at any time and can ask for my data to be deleted.")


@app.post("/api/me/consent")
def consent(body: Consent, user: User = Depends(auth.current_user),
            db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    if body.accepted:
        u.consent_at, u.consent_text = utcnow(), CONSENT_TEXT
    if body.telegram_chat_id is not None:
        u.telegram_chat_id = body.telegram_chat_id or None
    db.commit()
    return user_out(u)


# ------------------------------------------------------------------ live site

def plug_out(p: Plug) -> dict:
    return {"id": p.id, "name": p.name, "topic": p.topic, "kind": p.kind, "max_w": p.max_w,
            "is_on": p.is_on, "online": p.online, "power_w": round(p.power_w, 1),
            "total_wh": round(p.total_wh), "last_seen": iso(p.last_seen),
            "source": p.source.upper(), "site_id": p.site_id}


def alert_out(a: Alert) -> dict:
    return {"id": a.id, "ts": iso(a.ts), "level": a.level, "kind": a.kind,
            "message": a.message, "session_id": a.session_id, "resolved": a.resolved}


@app.get("/api/sites/{site_id}/live")
def live(site: Site = Depends(get_site), hours: int = 6, db: Session = Depends(get_db),
         _: User = Depends(auth.operator)):
    now = utcnow()
    hours = min(48, max(1, hours))
    frame = control.load_frames(db, site, now - timedelta(hours=hours), now, 1 if hours <= 12
                                else 5)
    f = control.get_forecast(db, site, now)
    db.commit()
    plan_row = control.latest_plan(db, site.id)
    m = control.measured_now(db, site)
    plugs = list(db.scalars(select(Plug).where(Plug.site_id == site.id).order_by(Plug.id)))
    since = now - timedelta(hours=18)
    sess = list(db.scalars(select(ChargeSession).where(
        ChargeSession.site_id == site.id,
        (ChargeSession.status.in_(control.ACTIVE)) | (ChargeSession.ended_at >= since))
        .order_by(ChargeSession.id)))
    users = {u.id: u.name for u in db.scalars(select(User))}
    alerts = list(db.scalars(select(Alert).where(Alert.site_id == site.id)
                             .order_by(Alert.id.desc()).limit(20)))
    rate = rate_at(site.tariff, now)
    return {
        "site": site_out(site), "now": iso(now),
        "measured": ({**m, "ts": iso(m["ts"]), "source": m["source"].upper()} if m else None),
        "limit_w": round(site.limit_va * site.power_factor),
        "history": [{"ts": iso(ts), "load_w": round(r.load_w), "export_w": round(r.export_w),
                     "ev_w": round(r.ev_w)} for ts, r in frame.iterrows()],
        "history_source": "SIMULATED" if len(frame) and frame["simulated"].max() > 0
        else "MEASURED",
        "forecast": {"method": f.method, "points": [
            {"ts": iso(t), "p50_w": round(a), "p90_w": round(b), "solar_w": round(c)}
            for t, a, b, c in zip(f.index, f.p50, f.p90, f.solar, strict=True)]},
        "plan": ({"id": plan_row.id, "created_at": iso(plan_row.created_at),
                  "slot_start": iso(plan_row.slot_start), "feasible": plan_row.feasible,
                  "reason": plan_row.reason, "capacity_w": plan_row.body.get("capacity_w"),
                  "ev_w": plan_row.body.get("ev_w"), "solver": plan_row.body.get("solver")}
                 if plan_row else None),
        "plugs": [plug_out(p) for p in plugs],
        "sessions": [{**reports.session_row(s), "user": users.get(s.user_id, "")} for s in sess],
        "alerts": [alert_out(a) for a in alerts],
        "tariff_now": {"label": rate.label, "paise_per_kwh": rate.paise_per_kwh},
    }


def site_out(s: Site) -> dict:
    return {"id": s.id, "slug": s.slug, "name": s.name, "kind": s.kind, "limit_va": s.limit_va,
            "safety_margin_va": s.safety_margin_va, "power_factor": s.power_factor,
            "latitude": s.latitude, "longitude": s.longitude,
            "tariff": s.tariff or DEFAULT_TARIFF, "transformer": s.transformer or {}}


@app.websocket("/ws/sites/{site_id}")
async def ws_site(ws: WebSocket, site_id: int):
    await hub.connect(site_id, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(site_id, ws)


@app.post("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, db: Session = Depends(get_db), _: User = Depends(auth.operator)):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    a.resolved = True
    db.commit()
    return alert_out(a)


@app.post("/api/sites/{site_id}/replan")
def force_replan(site: Site = Depends(get_site), db: Session = Depends(get_db),
                 _: User = Depends(auth.operator)):
    p = control.replan(db, site, "operator request")
    db.commit()
    return {"plan_id": p.id, "feasible": p.feasible}


# ------------------------------------------------------------------ sessions

class NewSession(BaseModel):
    plug_id: int
    vehicle_type: str
    battery_pct: int = Field(ge=0, le=100)
    ready_by: datetime


def _own(db: Session, session_id: int, user: User) -> ChargeSession:
    s = db.get(ChargeSession, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if s.user_id != user.id and user.role == "user":
        raise HTTPException(403, "This is not your session")
    return s


def session_out(db: Session, s: ChargeSession) -> dict:
    plug = db.get(Plug, s.plug_id)
    return {**reports.session_row(s), "plug": plug_out(plug) if plug else None,
            "site_id": s.site_id}


@app.get("/api/sites/{site_id}/plugs")
def site_plugs(site: Site = Depends(get_site), db: Session = Depends(get_db),
               _: User = Depends(auth.current_user)):
    busy = {s.plug_id for s in control.active_sessions(db, site.id)}
    return [{**plug_out(p), "busy": p.id in busy}
            for p in db.scalars(select(Plug).where(Plug.site_id == site.id).order_by(Plug.id))]


@app.post("/api/sessions")
def create_session(body: NewSession, user: User = Depends(auth.current_user),
                   db: Session = Depends(get_db)):
    if body.vehicle_type not in VEHICLES:
        raise HTTPException(422, "Unknown vehicle type")
    plug = db.get(Plug, body.plug_id)
    if not plug:
        raise HTTPException(404, "Plug not found")
    if any(s.plug_id == plug.id for s in control.active_sessions(db, plug.site_id)):
        raise HTTPException(409, "This plug already has a vehicle on it")
    now = utcnow()
    ready = body.ready_by
    if ready.tzinfo is not None:
        ready = ready.astimezone(UTC).replace(tzinfo=None)
    if ready <= now + timedelta(minutes=15):
        raise HTTPException(422, "Ready-by time must be at least 15 minutes from now")
    if ready > now + timedelta(hours=23):
        raise HTTPException(422, "Ready-by time must be within the next 23 hours")
    v = VEHICLES[body.vehicle_type]
    power = min(plug.max_w, v["charger_w"])
    s = ChargeSession(
        site_id=plug.site_id, plug_id=plug.id, user_id=user.id, vehicle_type=body.vehicle_type,
        battery_pct=body.battery_pct, energy_needed_wh=energy_needed_wh(body.vehicle_type,
                                                                        body.battery_pct),
        power_w=power, interruptible=bool(v["interruptible"]) and plug.kind == "ocpp",
        plugged_at=now, ready_by=ready, status="waiting", source=plug.source)
    db.add(s)
    db.flush()
    site = db.get(Site, plug.site_id)
    control.replan(db, site, "session added", now)
    control.tick(db, site, now)
    db.commit()
    return session_out(db, s)


@app.get("/api/sessions/mine")
def my_sessions(user: User = Depends(auth.current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ChargeSession).where(ChargeSession.user_id == user.id)
                      .order_by(ChargeSession.id.desc()).limit(50))
    return [session_out(db, s) for s in rows]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, user: User = Depends(auth.current_user),
                db: Session = Depends(get_db)):
    return session_out(db, _own(db, session_id, user))


class OverrideIn(BaseModel):
    action: str  # charge_now | stop
    reason: str = ""


@app.post("/api/sessions/{session_id}/override")
def override_session(session_id: int, body: OverrideIn,
                     user: User = Depends(auth.current_user), db: Session = Depends(get_db)):
    if body.action not in ("charge_now", "stop"):
        raise HTTPException(422, "Unknown action")
    s = _own(db, session_id, user)
    if s.status not in control.ACTIVE:
        raise HTTPException(409, "This session has already ended")
    control.override(db, s, user, body.action, body.reason)
    db.commit()
    return session_out(db, s)


class ReadyBy(BaseModel):
    accept_proposal: bool = True


@app.post("/api/sessions/{session_id}/ready-by")
def accept_relaxation(session_id: int, body: ReadyBy, user: User = Depends(auth.current_user),
                      db: Session = Depends(get_db)):
    s = _own(db, session_id, user)
    if not s.proposed_ready_by:
        raise HTTPException(409, "There is nothing to change for this session")
    audit.append(db, "override", {"session_id": s.id, "user_id": user.id,
                                  "action": "accept_ready_by",
                                  "from": iso(s.ready_by), "to": iso(s.proposed_ready_by)})
    s.ready_by, s.proposed_ready_by, s.at_risk = s.proposed_ready_by, None, False
    for a in db.scalars(select(Alert).where(Alert.session_id == s.id,
                                            Alert.resolved.is_(False))):
        a.resolved = True
    control.replan(db, db.get(Site, s.site_id), "ready-by changed")
    db.commit()
    return session_out(db, s)


class Rating(BaseModel):
    rating: int = Field(ge=1, le=5)


@app.post("/api/sessions/{session_id}/rating")
def rate(session_id: int, body: Rating, user: User = Depends(auth.current_user),
         db: Session = Depends(get_db)):
    s = _own(db, session_id, user)
    s.rating = body.rating
    db.commit()
    return session_out(db, s)


@app.get("/api/sites/{site_id}/sessions")
def site_sessions(site: Site = Depends(get_site), limit: int = 100,
                  db: Session = Depends(get_db), _: User = Depends(auth.operator)):
    users = {u.id: u.name for u in db.scalars(select(User))}
    plugs = {p.id: p.name for p in db.scalars(select(Plug))}
    rows = db.scalars(select(ChargeSession).where(ChargeSession.site_id == site.id)
                      .order_by(ChargeSession.id.desc()).limit(min(500, limit)))
    return [{**reports.session_row(s), "user": users.get(s.user_id, ""),
             "plug_name": plugs.get(s.plug_id, "")} for s in rows]


# ------------------------------------------------------------------ reports, forecast, twin

@app.get("/api/sites/{site_id}/report")
def report(site: Site = Depends(get_site), night: date | None = None,
           db: Session = Depends(get_db), _: User = Depends(auth.operator)):
    return reports.night_report(db, site, night or reports.default_night(utcnow()))


@app.get("/api/sites/{site_id}/forecast")
def forecast_view(site: Site = Depends(get_site), db: Session = Depends(get_db),
                  _: User = Depends(auth.operator)):
    now = utcnow()
    f = control.get_forecast(db, site, now)
    db.commit()
    hist = control.load_frames(db, site, now - timedelta(days=21), now, settings.slot_minutes)
    metrics = fc.backtest(hist["nonev_w"], settings.slot_minutes) if len(hist) else \
        {"ok": False, "reason": "no history yet", "rows": 0}
    recent = hist.tail(96 * 2)
    return {"method": f.method, "metrics": metrics,
            "history_source": "SIMULATED" if len(hist) and hist["simulated"].max() > 0
            else "MEASURED",
            "recent": [{"ts": iso(ts), "nonev_w": round(r.nonev_w),
                        "surplus_w": round(r.surplus_w)} for ts, r in recent.iterrows()],
            "points": [{"ts": iso(t), "p50_w": round(a), "p90_w": round(b), "solar_w": round(c)}
                       for t, a, b, c in zip(f.index, f.p50, f.p90, f.solar, strict=True)],
            "capacity_w": control.capacity_profile(site, f)}


_twin_cache: dict[str, dict] = {}
_twin_lock = threading.Lock()


def _twin_cfg(site: Site | None) -> twin.TwinConfig:
    t = (site.transformer if site else None) or {}
    cfg = twin.TwinConfig()
    cfg.rated_kva = float(t.get("rated_kva", cfg.rated_kva))
    cfg.homes = int(t.get("homes", cfg.homes))
    cfg.transformer_cost_paise = int(t.get("cost_paise", cfg.transformer_cost_paise))
    cfg.normal_life_h = float(t.get("normal_life_h", cfg.normal_life_h))
    cfg.thermal = t.get("thermal", {}) or {}
    if t.get("mix"):
        cfg.mix = t["mix"]
    return cfg


def _building_profile(db: Session, site: Site | None) -> tuple[list[float] | None, str]:
    """Typical measured day of the building (W per 15-min slot from 12:00 IST)."""
    if not site:
        return None, "none"
    now = utcnow()
    hist = control.load_frames(db, site, now - timedelta(days=14), now, 15)
    if len(hist) < 96:
        return None, "none"
    from .tariff import to_ist
    slot = [((to_ist(ts).hour * 60 + to_ist(ts).minute) // 15 - twin.START_HOUR_IST * 4) % 96
            for ts in hist.index]
    med = hist["nonev_w"].groupby(slot).median()
    prof = [float(med.get(i, med.mean())) for i in range(96)]
    return prof, "SIMULATED" if hist["simulated"].max() > 0 else "MEASURED"


def _twin_level(site: Site | None, adoption: float, db: Session) -> dict:
    key = f"level:{site.id if site else 0}:{adoption}:{(site.transformer if site else {})}"
    with _twin_lock:
        if key not in _twin_cache:
            prof, src = _building_profile(db, site)
            out = twin.run_level(adoption, _twin_cfg(site), prof, site.tariff if site else None,
                                 detail=True)
            out["building_source"] = src
            _twin_cache[key] = out
        return _twin_cache[key]


@app.get("/api/sites/{site_id}/twin")
def twin_sweep(site: Site = Depends(get_site), db: Session = Depends(get_db),
               _: User = Depends(auth.operator)):
    key = f"sweep:{site.id}:{site.transformer}:{site.tariff}"
    with _twin_lock:
        if key not in _twin_cache:
            prof, src = _building_profile(db, site)
            out = twin.sweep(_twin_cfg(site), prof, site.tariff)
            out["building_source"] = src
            _twin_cache[key] = out
        return _twin_cache[key]


@app.get("/api/sites/{site_id}/twin/level")
def twin_level(site: Site = Depends(get_site), adoption: float = 30.0,
               db: Session = Depends(get_db), _: User = Depends(auth.operator)):
    return _twin_level(site, min(100.0, max(0.0, adoption)), db)


# ------------------------------------------------------------------ audit

@app.get("/api/audit")
def audit_list(limit: int = 100, db: Session = Depends(get_db), _: User = Depends(auth.operator)):
    rows = db.scalars(select(AuditEntry).order_by(AuditEntry.id.desc()).limit(min(500, limit)))
    return [{"id": e.id, "ts": iso(e.ts), "kind": e.kind, "payload": e.payload,
             "hash": e.hash, "prev_hash": e.prev_hash} for e in rows]


@app.get("/api/audit/verify")
def audit_verify(db: Session = Depends(get_db)):
    return audit.verify(db)


# ------------------------------------------------------------------ admin

class SiteIn(BaseModel):
    name: str | None = None
    kind: str | None = None
    limit_va: int | None = Field(default=None, gt=0)
    safety_margin_va: int | None = Field(default=None, ge=0)
    power_factor: float | None = Field(default=None, gt=0, le=1)
    latitude: float | None = None
    longitude: float | None = None
    tariff: dict | None = None
    transformer: dict | None = None


class NewSite(SiteIn):
    slug: str
    name: str


@app.get("/api/admin/sites")
def admin_sites(db: Session = Depends(get_db), _: User = Depends(auth.admin)):
    return [site_out(s) for s in db.scalars(select(Site).order_by(Site.id))]


@app.post("/api/admin/sites")
def add_site(body: NewSite, db: Session = Depends(get_db), user: User = Depends(auth.admin)):
    if db.scalars(select(Site).where(Site.slug == body.slug)).first():
        raise HTTPException(409, "A site with this short name already exists")
    s = Site(slug=body.slug, name=body.name, tariff=body.tariff or DEFAULT_TARIFF,
             transformer=body.transformer or {})
    for k, v in body.model_dump(exclude_none=True, exclude={"slug", "name", "tariff",
                                                            "transformer"}).items():
        setattr(s, k, v)
    db.add(s)
    audit.append(db, "config", {"event": "site added", "slug": body.slug, "by": user.email})
    db.commit()
    return site_out(s)


@app.patch("/api/admin/sites/{site_id}")
def edit_site(body: SiteIn, site: Site = Depends(get_site), db: Session = Depends(get_db),
              user: User = Depends(auth.admin)):
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(site, k, v)
    audit.append(db, "config", {"event": "site changed", "slug": site.slug, "by": user.email,
                                "fields": sorted(changes)})
    control.replan(db, site, "config changed")
    db.commit()
    return site_out(site)


class PlugIn(BaseModel):
    site_id: int
    name: str
    topic: str
    kind: str = "tasmota"
    max_w: int = Field(default=1500, gt=0)


@app.get("/api/admin/devices")
def devices(db: Session = Depends(get_db), _: User = Depends(auth.admin)):
    return {"plugs": [plug_out(p) for p in db.scalars(select(Plug).order_by(Plug.id))],
            "meters": [{"id": m.id, "site_id": m.site_id, "name": m.name, "topic": m.topic,
                        "last_seen": iso(m.last_seen)}
                       for m in db.scalars(select(Meter).order_by(Meter.id))],
            "unpaired": list(ingest.unpaired)}


@app.post("/api/admin/plugs")
def pair_plug(body: PlugIn, db: Session = Depends(get_db), user: User = Depends(auth.admin)):
    if body.kind not in ("tasmota", "ocpp"):
        raise HTTPException(422, "Plug type must be tasmota or ocpp")
    if db.scalars(select(Plug).where(Plug.topic == body.topic)).first():
        raise HTTPException(409, "A plug is already paired to this topic")
    if not db.get(Site, body.site_id):
        raise HTTPException(404, "Site not found")
    p = Plug(**body.model_dump())
    db.add(p)
    audit.append(db, "config", {"event": "plug paired", "topic": body.topic, "by": user.email})
    for u in list(ingest.unpaired):
        if u["name"] == body.topic:
            ingest.unpaired.remove(u)
    db.commit()
    return plug_out(p)


@app.delete("/api/admin/plugs/{plug_id}")
def unpair_plug(plug_id: int, db: Session = Depends(get_db), user: User = Depends(auth.admin)):
    p = db.get(Plug, plug_id)
    if not p:
        raise HTTPException(404, "Plug not found")
    if any(s.plug_id == p.id for s in control.active_sessions(db, p.site_id)):
        raise HTTPException(409, "This plug has an active session")
    audit.append(db, "config", {"event": "plug removed", "topic": p.topic, "by": user.email})
    db.delete(p)
    db.commit()
    return {"ok": True}


class MeterIn(BaseModel):
    site_id: int
    name: str
    topic: str


@app.post("/api/admin/meters")
def pair_meter(body: MeterIn, db: Session = Depends(get_db), user: User = Depends(auth.admin)):
    if db.scalars(select(Meter).where(Meter.topic == body.topic)).first():
        raise HTTPException(409, "A meter is already paired to this topic")
    m = Meter(**body.model_dump())
    db.add(m)
    audit.append(db, "config", {"event": "meter paired", "topic": body.topic, "by": user.email})
    db.commit()
    return {"id": m.id, "site_id": m.site_id, "name": m.name, "topic": m.topic}


@app.get("/api/admin/users")
def users_list(db: Session = Depends(get_db), _: User = Depends(auth.admin)):
    return [{**user_out(u), "consent_at": iso(u.consent_at), "created_at": iso(u.created_at),
             "sessions": db.scalar(select(func.count(ChargeSession.id))
                                   .where(ChargeSession.user_id == u.id)),
             "overrides": db.scalar(select(func.count(Override.id))
                                    .where(Override.user_id == u.id))}
            for u in db.scalars(select(User).order_by(User.id))]


class RoleIn(BaseModel):
    role: str


@app.patch("/api/admin/users/{user_id}")
def set_role(user_id: int, body: RoleIn, db: Session = Depends(get_db),
             me_: User = Depends(auth.admin)):
    if body.role not in auth.ROLES:
        raise HTTPException(422, "Unknown role")
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    u.role = body.role
    audit.append(db, "config", {"event": "role changed", "user_id": u.id, "role": body.role,
                                "by": me_.email})
    db.commit()
    return user_out(u)
