"""Plug commands. Every command is written to the audit log before it is sent.

Tasmota plugs: MQTT `cmnd/<plug>/POWER` ON|OFF (queued for the MQTT task, which
the edge agent also mirrors locally). OCPP chargers: a charging-profile limit.
Simulated plugs are switched in-process.
"""

import queue

from sqlalchemy.orm import Session

from . import audit
from .hub import hub
from .models import Plug

outbox: "queue.Queue[tuple[str, str]]" = queue.Queue()
ocpp_limits: dict[str, int] = {}  # charge point id -> W limit requested


def set_plug(db: Session, plug: Plug, on: bool, reason: str, session_id: int | None = None,
             limit_w: int | None = None) -> None:
    audit.append(db, "command", {"plug": plug.topic, "plug_id": plug.id, "on": on,
                                 "limit_w": limit_w, "reason": reason, "session_id": session_id})
    if plug.kind == "ocpp":
        ocpp_limits[plug.topic] = (limit_w if limit_w is not None else plug.max_w) if on else 0
    elif plug.source != "simulated":
        outbox.put((f"cmnd/{plug.topic}/POWER", "ON" if on else "OFF"))
    # Optimistic state; the plug's own stat/<plug>/POWER reply confirms it.
    plug.is_on = on
    hub.publish(plug.site_id, {"type": "plug_state", "plug_id": plug.id, "is_on": on})
