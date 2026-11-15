#!/usr/bin/env python3
"""VOLTIX edge agent. Runs on the Raspberry Pi next to the site's MQTT broker.

Telemetry reaches the cloud through the Mosquitto bridge (infra/mosquitto).
This agent adds the safety net:

  * every 30 s it fetches the current schedule from the cloud and saves it;
  * every 20 s it makes sure each plug is in the state the schedule asks for;
  * if the cloud is unreachable it keeps following the last saved schedule;
  * if there is no usable schedule it switches every plug ON.

Fail open: when in doubt, people can charge.

    VOLTIX_API=https://voltix.example VOLTIX_SITE=dtu-pilot VOLTIX_EDGE_KEY=... \\
    MQTT_HOST=localhost python edge/agent.py
"""

import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

STALE_AFTER = timedelta(hours=24)


def parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def decide(plan: dict | None, now: datetime, known_plugs: list[str] | None = None) -> dict:
    """Desired state per plug: {topic: True (ON) | False (OFF)}.

    A plug is held OFF only while a session on it is waiting for a start time
    that is still in the future, and only if the plan is recent. Everything
    else is ON.
    """
    plugs = list(dict.fromkeys((plan or {}).get("plugs", []) + (known_plugs or [])))
    want = {p: True for p in plugs}
    issued = parse((plan or {}).get("issued_at"))
    if not plan or issued is None or now - issued > STALE_AFTER:
        return want
    for s in plan.get("sessions", []):
        start = parse(s.get("start"))
        waiting = s.get("status") == "waiting" and not s.get("overridden")
        want[s["plug"]] = not (waiting and start is not None and start > now)
    return want


def load(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def fetch(api: str, site: str, key: str) -> dict | None:
    import httpx
    try:
        r = httpx.get(f"{api}/api/edge/{site}/schedule", params={"key": key}, timeout=8.0)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[edge] cloud unreachable: {type(e).__name__}")
        return None


def main() -> None:
    import paho.mqtt.client as mqtt

    api, site = os.environ["VOLTIX_API"].rstrip("/"), os.environ["VOLTIX_SITE"]
    key = os.environ.get("VOLTIX_EDGE_KEY", "")
    store = Path(os.environ.get("VOLTIX_EDGE_STORE", "/var/lib/voltix/last_plan.json"))
    store.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()

    def on_message(_c, _u, msg):
        parts = msg.topic.split("/")
        if len(parts) == 3 and parts[0] == "tele":
            seen.add(parts[1])

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"voltix-edge-{site}")
    if os.environ.get("MQTT_USERNAME"):
        client.username_pw_set(os.environ["MQTT_USERNAME"], os.environ.get("MQTT_PASSWORD"))
    client.on_message = on_message
    client.connect(os.environ.get("MQTT_HOST", "localhost"),
                   int(os.environ.get("MQTT_PORT", "1883")))
    client.subscribe("tele/+/LWT")
    client.subscribe("tele/+/SENSOR")
    client.loop_start()

    plan, last_fetch, last_state, online = load(store), 0.0, {}, True
    while True:
        if time.time() - last_fetch >= 30:
            last_fetch = time.time()
            fresh = fetch(api, site, key)
            if fresh:
                plan = fresh
                store.write_text(json.dumps(plan))
            if bool(fresh) != online:
                online = bool(fresh)
                print("[edge] cloud link restored" if online
                      else "[edge] OFFLINE: following the last saved schedule")
        want = decide(plan, datetime.now(UTC), sorted(seen))
        for plug, on in want.items():
            # While online the cloud issues commands; the agent only enforces changes
            # and, when offline, repeats the desired state so a rebooted plug recovers.
            if last_state.get(plug) != on or not online:
                client.publish(f"cmnd/{plug}/POWER", "ON" if on else "OFF", qos=1)
                last_state[plug] = on
        time.sleep(20)


if __name__ == "__main__":
    main()
