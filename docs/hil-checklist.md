# Hardware-in-the-loop checklist

Run by the team on the real devices at the pilot site. Fill in one copy per
run and keep it with the night's report.

Date: ________  Site: ________  Run by: ________

## Before you start

- [ ] `VOLTIX_SIMULATE=0` on the server (the red SIMULATED banner is gone).
- [ ] Site limit, safety margin and power factor in Admin match the breaker /
      sub-board rating.
- [ ] The meter and every plug are paired, and show "online".

## 1. Meter publishing

- [ ] Live site shows a reading less than 60 s old, labelled MEASURED.
- [ ] Switch a known load on (for example a 1 kW heater). The curve rises by
      about that much within 30 s. Measured step: ______ W
- [ ] With solar generating and little load, export shows as a positive
      "Solar export" value. Sign is correct: yes / no

## 2. Each plug switches on its scheduled minute (±60 s)

For every plug, start a session with a ready-by time that forces a wait.

| Plug | Planned start (IST) | Actual ON (IST) | Difference | Pass (≤ 60 s) |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

- [ ] While waiting, the plug is physically OFF (charger LED off).

## 3. Measured kWh matches the plug's own counter

| Plug | Plug counter before (kWh) | after (kWh) | Difference | VOLTIX "delivered" | Error % |
|---|---|---|---|---|---|
| | | | | | |

- [ ] Error is within 2% for every plug.

## 4. Override works

- [ ] On a waiting session tap "Charge now instead". Plug switches ON within
      10 s.
- [ ] The override appears in Night report → Overrides and in the Audit log.
- [ ] "Stop and unplug" ends the session; the plug is left ON (released).

## 5. Internet loss handled

- [ ] With one session waiting and one charging, unplug the Pi's uplink.
- [ ] The charging vehicle keeps charging.
- [ ] The waiting plug still switches ON at its planned minute (edge agent).
- [ ] Delete the edge agent's saved plan and restart it while offline: every
      plug switches ON (fail open).
- [ ] Reconnect. Telemetry resumes and the live view catches up.

## 6. Deadlines

- [ ] Every vehicle was charged by its ready-by time. Tightest finish: ______ min

Notes and anything that did not pass:
