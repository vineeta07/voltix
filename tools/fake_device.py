#!/usr/bin/env python3
"""Fake meter and Tasmota plugs on a real MQTT broker. FOR TESTS ONLY.

It publishes the same topics and payloads as the real devices and obeys
`cmnd/<plug>/POWER`, so the full MQTT path can be exercised without hardware.
Never point it at a production broker: its readings would be stored as measured.

    python tools/fake_device.py --host localhost --site dtu-pilot --plugs 3
"""

import argparse
import json
import math
import random
import time
from datetime import datetime


def main() -> None:
    import paho.mqtt.client as mqtt

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--username")
    ap.add_argument("--password")
    ap.add_argument("--site", default="dtu-pilot")
    ap.add_argument("--plugs", type=int, default=3)
    ap.add_argument("--interval", type=float, default=5.0)
    a = ap.parse_args()

    names = [f"fake_plug_{i + 1}" for i in range(a.plugs)]
    on = {n: True for n in names}
    total = {n: 0.0 for n in names}

    def on_message(client, _u, msg):
        _, name, _ = msg.topic.split("/")
        if name in on:
            on[name] = msg.payload.decode().strip().upper() == "ON"
            client.publish(f"stat/{name}/POWER", "ON" if on[name] else "OFF")

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="voltix-fake-devices")
    if a.username:
        c.username_pw_set(a.username, a.password)
    c.on_message = on_message
    c.connect(a.host, a.port)
    c.subscribe("cmnd/+/POWER")
    c.loop_start()
    for n in names:
        c.publish(f"tele/{n}/LWT", "Online", retain=True)
    print(f"fake devices publishing to {a.host}:{a.port} (test use only)")
    while True:
        hour = datetime.now().hour + datetime.now().minute / 60
        ev = 0.0
        for n in names:
            power = 740 * random.uniform(0.97, 1.03) if on[n] else 0.0
            total[n] += power * a.interval / 3600 / 1000
            ev += power
            c.publish(f"tele/{n}/SENSOR", json.dumps({
                "Time": datetime.now().isoformat(timespec="seconds"),
                "ENERGY": {"Total": round(total[n], 4), "Power": round(power),
                           "Voltage": 230, "Current": round(power / 230, 2)}}))
        building = 2000 + 3000 * math.exp(-((hour - 13) ** 2) / 18)
        solar = 4000 * max(0.0, math.sin((hour - 6) / 12 * math.pi))
        c.publish(f"voltix/{a.site}/meter", json.dumps(
            {"power_w": round(building + ev - solar), "voltage": 230}))
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
