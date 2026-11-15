"""Integration: telemetry -> database -> API, and session -> scheduler -> plug command."""

import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import audit, commands, control, ingest
from app.db import Base, SessionLocal, engine, init_db
from app.main import app
from app.models import ChargeSession, Meter, MeterReading, Plug, Site, utcnow
from app.tariff import DEFAULT_TARIFF


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    init_db()
    while not commands.outbox.empty():
        commands.outbox.get()
    with SessionLocal() as db:
        site = Site(slug="t", name="Test site", limit_va=3000, safety_margin_va=0,
                    power_factor=1.0, tariff=DEFAULT_TARIFF)
        db.add(site)
        db.flush()
        db.add(Meter(site_id=site.id, name="m", topic="voltix/t/meter"))
        for i in (1, 2, 3):
            db.add(Plug(site_id=site.id, name=f"Bay {i}", topic=f"plug{i}", max_w=1300))
        db.commit()
    return TestClient(app)


def login(c, role="user", email=None):
    r = c.post("/api/auth/dev-login", json={"email": email or f"{role}@x.in", "role": role})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def drain():
    out = []
    while not commands.outbox.empty():
        out.append(commands.outbox.get())
    return out


def test_mqtt_telemetry_reaches_the_api(client):
    with SessionLocal() as db:
        assert ingest.handle_message(db, "voltix/t/meter",
                                     json.dumps({"power_w": 1800, "voltage": 231})) == "meter"
        assert ingest.handle_message(db, "voltix/t/meter", json.dumps({"power": -400})) == "meter"
        sensor = {"Time": "2026-11-15T10:00:00", "ENERGY": {"Total": 1.5, "Power": 720}}
        assert ingest.handle_message(db, "tele/plug1/SENSOR", json.dumps(sensor)) == "plug"
        assert ingest.handle_message(db, "stat/plug1/POWER", "OFF") == "plug:state"
        assert ingest.handle_message(db, "tele/unknown/SENSOR", json.dumps(sensor)) == "unpaired"
        assert ingest.handle_message(db, "tele/plug1/SENSOR", "not json") == "plug:invalid"
        db.commit()
        last = db.scalars(select(MeterReading).order_by(MeterReading.ts.desc())).first()
        assert last.export_w == 400 and last.load_w == 0 and last.source == "measured"
    h = login(client, "operator")
    live = client.get("/api/sites/1/live", headers=h).json()
    assert live["measured"]["source"] == "MEASURED"
    assert live["plugs"][0]["power_w"] == 720 and live["plugs"][0]["is_on"] is False
    assert live["plugs"][0]["total_wh"] == 1500
    admin = login(client, "admin")
    assert client.get("/api/admin/devices", headers=admin).json()["unpaired"][0]["name"] == "unknown"


def test_session_is_scheduled_and_the_plug_is_commanded(client):
    h = login(client)
    ready = (utcnow() + timedelta(hours=10)).isoformat() + "Z"
    # three e-rickshaws (1300 W each) on a 3000 VA site: at most two may charge at once
    ids = []
    for i, pid in enumerate((1, 2, 3)):
        r = client.post("/api/sessions", headers=login(client, email=f"u{i}@x.in"),
                        json={"plug_id": pid, "vehicle_type": "e_rickshaw", "battery_pct": 30,
                              "ready_by": ready})
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    with SessionLocal() as db:
        ss = list(db.scalars(select(ChargeSession).order_by(ChargeSession.id)))
        plan = control.latest_plan(db, 1)
        assert plan.feasible and max(plan.body["ev_w"]) <= 3000
        assert all(s.planned_end <= s.ready_by for s in ss)
        assert min(s.planned_start for s in ss) != max(s.planned_start for s in ss)  # staggered
        waiting = [s for s in ss if s.status == "waiting"]
        assert waiting, "someone has to wait"
    sent = drain()
    assert any(p == "OFF" for _, p in sent), "waiting plugs are switched off over MQTT"
    assert all(t.startswith("cmnd/plug") and t.endswith("/POWER") for t, _ in sent)

    # the waiting user overrides: plug switches on at once, and it is logged
    wid = waiting[0].id
    owner = login(client, email=f"u{ids.index(wid)}@x.in")
    assert client.post(f"/api/sessions/{wid}/override", headers=h,
                       json={"action": "charge_now"}).status_code == 403  # not theirs
    r = client.post(f"/api/sessions/{wid}/override", headers=owner,
                    json={"action": "charge_now", "reason": "leaving early"})
    assert r.status_code == 200 and r.json()["status"] == "charging" and r.json()["overridden"]
    topic = f"cmnd/plug{waiting[0].plug_id}/POWER"
    assert (topic, "ON") in drain()
    with SessionLocal() as db:
        kinds = [e.kind for e in db.scalars(select(audit.AuditEntry))]
        assert "override" in kinds and "plan" in kinds and "command" in kinds
        assert audit.verify(db)["ok"]


def test_control_loop_starts_tracks_and_finishes(client):
    h = login(client)
    ready = (utcnow() + timedelta(hours=8)).isoformat() + "Z"
    sid = client.post("/api/sessions", headers=h, json={
        "plug_id": 1, "vehicle_type": "e_scooter", "battery_pct": 80, "ready_by": ready}).json()["id"]
    with SessionLocal() as db:
        site, s, plug = db.get(Site, 1), db.get(ChargeSession, sid), db.get(Plug, 1)
        start = s.planned_start
        assert control.tick(db, site, start + timedelta(seconds=1))["started"] in (0, 1)
        assert s.status == "charging" and plug.is_on
        # the plug reports energy; the session follows the plug's own counter
        plug.total_wh += s.energy_needed_wh
        plug.power_w = 0
        did = control.tick(db, site, start + timedelta(hours=1))
        assert did["finished"] == 1 and s.status == "done"
        assert round(s.delivered_wh) == s.energy_needed_wh
        db.commit()
    assert client.post(f"/api/sessions/{sid}/rating", headers=h,
                       json={"rating": 5}).json()["rating"] == 5
    assert client.get("/api/impact").json()["sessions"] == 1


def test_infeasible_session_is_flagged_not_silently_missed(client):
    h = login(client)
    ready = (utcnow() + timedelta(minutes=40)).isoformat() + "Z"  # needs ~5 h of charging
    r = client.post("/api/sessions", headers=h, json={
        "plug_id": 1, "vehicle_type": "e_rickshaw", "battery_pct": 5, "ready_by": ready}).json()
    assert r["at_risk"] and r["proposed_ready_by"] > r["ready_by"]
    op = login(client, "operator")
    alerts = client.get("/api/sites/1/live", headers=op).json()["alerts"]
    assert alerts[0]["kind"] == "deadline_at_risk" and alerts[0]["level"] == "critical"
    r2 = client.post(f"/api/sessions/{r['id']}/ready-by", headers=h, json={}).json()
    assert not r2["at_risk"] and r2["ready_by"] == r["proposed_ready_by"]


def test_measured_overload_delays_waiting_sessions(client):
    with SessionLocal() as db:
        site = db.get(Site, 1)
        ingest.handle_message(db, "voltix/t/meter", json.dumps({"power_w": 3600}))
        db.commit()
        did = control.tick(db, site)
        db.commit()
        assert did["replanned"] == 1
    op = login(client, "operator")
    kinds = [a["kind"] for a in client.get("/api/sites/1/live", headers=op).json()["alerts"]]
    assert "overload" in kinds


def test_roles_are_enforced(client):
    user, op = login(client), login(client, "operator")
    assert client.get("/api/sites/1/live").status_code == 401
    assert client.get("/api/sites/1/live", headers=user).status_code == 403
    assert client.get("/api/admin/users", headers=op).status_code == 403
    admin = login(client, "admin")
    r = client.post("/api/admin/plugs", headers=admin, json={
        "site_id": 1, "name": "Bay 9", "topic": "tasmota_9F3A", "max_w": 800})
    assert r.status_code == 200 and r.json()["topic"] == "tasmota_9F3A"
    assert client.post("/api/admin/plugs", headers=admin, json={
        "site_id": 1, "name": "dup", "topic": "tasmota_9F3A"}).status_code == 409
    r = client.patch("/api/admin/sites/1", headers=admin, json={"limit_va": 5000})
    assert r.json()["limit_va"] == 5000


def test_night_report_and_twin_endpoints(client):
    op = login(client, "operator")
    rep = client.get("/api/sites/1/report", headers=op).json()
    assert rep["audit"]["ok"] and rep["sessions"] == 0 and rep["has_data"] is False
    lvl = client.get("/api/sites/1/twin/level?adoption=20", headers=op).json()
    assert set(lvl["strategies"]) >= {"voltix", "tod_timer"}
    assert "placeholder" in lvl["household_source"]
    assert client.get("/api/audit/verify").json()["ok"]
