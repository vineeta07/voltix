"""Telemetry ingest: MQTT payloads -> database -> WebSocket.

Topics
  <meter.topic>            JSON from the site meter (see parse_meter)
  tele/<plug>/SENSOR       Tasmota energy telemetry
  tele/<plug>/STATE        Tasmota state (carries POWER)
  stat/<plug>/POWER        ON | OFF after a command
  tele/<plug>/LWT          Online | Offline
"""

import json
from collections import deque
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .hub import hub
from .models import Meter, MeterReading, Plug, PlugReading, utcnow

# Topics seen on the broker that are not paired to anything yet (for the admin pairing screen).
unpaired: deque[dict] = deque(maxlen=50)


def _num(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] is not None:
            try:
                return float(d[k])
            except (TypeError, ValueError):
                continue
    return default


def parse_meter(payload: dict) -> dict | None:
    """Accepts the meter's JSON in a few common shapes.

    Either a signed net power (`power_w`/`power`/`P`, negative = export) or
    separate `import_w` / `export_w`. Optional `voltage`.
    """
    imp = _num(payload, "import_w", "load_w")
    exp = _num(payload, "export_w", default=0.0)
    if imp is None:
        net = _num(payload, "power_w", "power", "P", "active_power")
        if net is None:
            return None
        imp, exp = (net, 0.0) if net >= 0 else (0.0, -net)
    return {"load_w": max(0.0, imp), "export_w": max(0.0, exp or 0.0),
            "voltage": _num(payload, "voltage", "V", "voltage_v")}


def parse_tasmota_sensor(payload: dict) -> dict | None:
    e = payload.get("ENERGY")
    if not isinstance(e, dict):
        return None
    power = _num(e, "Power")
    if power is None:
        return None
    total_kwh = _num(e, "Total", default=0.0)
    return {"power_w": power, "total_wh": total_kwh * 1000.0}


def record_meter(db: Session, meter: Meter, reading: dict, ts: datetime | None = None,
                 source: str = "measured") -> None:
    ts = ts or utcnow()
    db.merge(MeterReading(ts=ts, site_id=meter.site_id, load_w=reading["load_w"],
                          export_w=reading["export_w"], voltage=reading.get("voltage"),
                          source=source))
    meter.last_seen = ts
    hub.publish(meter.site_id, {"type": "meter", "ts": ts.isoformat() + "Z", "source": source,
                                "load_w": reading["load_w"], "export_w": reading["export_w"]})


def record_plug(db: Session, plug: Plug, reading: dict, ts: datetime | None = None,
                source: str = "measured") -> None:
    ts = ts or utcnow()
    db.merge(PlugReading(ts=ts, plug_id=plug.id, power_w=reading["power_w"],
                         total_wh=reading["total_wh"], source=source))
    plug.power_w, plug.total_wh = reading["power_w"], reading["total_wh"]
    plug.last_seen, plug.online, plug.source = ts, True, source
    hub.publish(plug.site_id, {"type": "plug", "ts": ts.isoformat() + "Z", "plug_id": plug.id,
                               "power_w": plug.power_w, "total_wh": plug.total_wh,
                               "is_on": plug.is_on, "source": source})


def handle_message(db: Session, topic: str, raw: bytes | str) -> str:
    """Route one MQTT message. Returns what it was treated as (for tests and logs)."""
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    meter = db.scalars(select(Meter).where(Meter.topic == topic)).first()
    if meter:
        try:
            reading = parse_meter(json.loads(text))
        except json.JSONDecodeError:
            reading = None
        if reading is None:
            return "meter:invalid"
        record_meter(db, meter, reading)
        return "meter"

    parts = topic.split("/")
    if len(parts) == 3 and parts[0] in ("tele", "stat"):
        prefix, name, leaf = parts
        plug = db.scalars(select(Plug).where(Plug.topic == name)).first()
        if not plug:
            _note_unpaired(name, "tasmota", topic)
            return "unpaired"
        if leaf == "SENSOR":
            try:
                reading = parse_tasmota_sensor(json.loads(text))
            except json.JSONDecodeError:
                reading = None
            if reading is None:
                return "plug:invalid"
            record_plug(db, plug, reading)
            return "plug"
        if leaf == "LWT":
            plug.online = text.strip().lower() == "online"
            return "plug:lwt"
        if leaf in ("POWER", "STATE", "RESULT"):
            state = text.strip()
            if leaf != "POWER":
                try:
                    state = str(json.loads(text).get("POWER", ""))
                except json.JSONDecodeError:
                    state = ""
            if state.upper() in ("ON", "OFF"):
                plug.is_on = state.upper() == "ON"
                plug.last_seen, plug.online = utcnow(), True
                hub.publish(plug.site_id, {"type": "plug_state", "plug_id": plug.id,
                                           "is_on": plug.is_on})
                return "plug:state"
        return "plug:ignored"

    _note_unpaired(topic, "meter?", topic)
    return "unpaired"


def _note_unpaired(name: str, kind: str, topic: str) -> None:
    for u in unpaired:
        if u["name"] == name:
            u["last_seen"] = utcnow().isoformat() + "Z"
            return
    unpaired.append({"name": name, "kind": kind, "topic": topic,
                     "last_seen": utcnow().isoformat() + "Z"})
