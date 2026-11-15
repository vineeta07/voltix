<p align="left"><img src="assets/brand/voltix-logo-light.svg" alt="VOLTIX" height="48"></p>

**The traffic signal for EV charging on a neighbourhood transformer.**

India's Time-of-Day tariffs make every EV start charging the minute the cheap
rate begins, all on the same transformer. That is the snapback peak. VOLTIX
keeps everyone's cheap rate and ready-by time, gives each vehicle its own start
time so the site never exceeds its real capacity, and pulls vehicles parked in
the daytime into hours of measured solar surplus.

It only controls EV charging. It never controls household appliances.

Built for the Schneider Electric Yuva Yodha Energy Tech Hackathon 2026,
Challenge 03 (Grid Reliability & Renewable Intermittency).

## Run it in 5 minutes (no hardware needed)

You need Python 3.12+, [uv](https://docs.astral.sh/uv/) and Node 22.

```bash
make setup
```

```bash
make api
```

In a second terminal:

```bash
make web
```

Open http://localhost:3000. `make api` starts the built-in simulator with a
demo site and nine days of history, so every screen has data. Everything the
simulator produces is labelled **SIMULATED** in the UI. Sign in with the
development login and pick a role (driver, facility manager or admin).

Full stack in Docker (Postgres/TimescaleDB, Mosquitto, API, web):

```bash
cp .env.example .env
```

```bash
make up
```

## What is in the box

| Area | What it does | Where |
|---|---|---|
| Scheduler | OR-Tools CP-SAT. Hard: ready-by times, capacity, started non-interruptible sessions never move. Then, in order: lowest peak, most solar, lowest ToD cost, fairness. Reports the smallest relaxation when infeasible | `backend/app/scheduler.py` |
| Baselines | `uncontrolled`, `tod_timer`, `random_delay`, `site_limit_only` through the same entry point | same |
| Control loop | Every minute: start due sessions, track energy from the plug's own counter, react to measured overload (delay first, pause interruptible last), log overrides | `backend/app/control.py` |
| Forecaster | LightGBM quantile regression, P50/P90 non-EV load for 24 h; solar surplus from measured export and Open-Meteo irradiance; pinball loss and coverage on held-out days | `backend/app/forecast.py` |
| Thermal twin | IEC 60076-7 difference equations, ageing rate, life cost | `backend/app/thermal.py` |
| Neighbourhood twin | Building + modelled homes + EVs; five strategies across 5–40% adoption; adoption at which each first overloads | `backend/app/twin.py` |
| Ingest | MQTT: site meter JSON and Tasmota `tele/<plug>/SENSOR`; commands on `cmnd/<plug>/POWER` | `backend/app/ingest.py`, `commands.py` |
| OCPP | Minimal OCPP 1.6J central system that sends `SetChargingProfile` | `backend/app/ocpp_cs.py` |
| Audit log | Append-only, SHA-256 hash-chained, with a verify endpoint | `backend/app/audit.py` |
| Edge agent | Runs on the Pi. Follows the last schedule if the cloud is unreachable; with no schedule, every plug is on | `edge/agent.py` |
| Assistant | Optional, operator-only, read-only. One LLM API call with function calling over four read-only tools. Hidden when no key is set | `backend/app/assistant.py` |
| Web app | Landing page, operator screens, driver app (English/Hindi, installable), admin, public impact page, user guide | `frontend/` |

## Architecture

```
[Edge: Raspberry Pi at the site]                  [Cloud: one VM, docker compose]
 Mosquitto MQTT broker  <-- IoT meter (ESP32)       FastAPI + Postgres/TimescaleDB
 edge agent (Python)    <-- Tasmota smart plugs     Scheduler (OR-Tools CP-SAT)
   forwards telemetry  ------ MQTT bridge ------->  Forecaster (LightGBM quantile)
   executes plug commands <-----------------------  Twin (IEC 60076-7 thermal model)
   SAFE FALLBACK: if the cloud is unreachable,      OCPP 1.6J central system
   run the last plan; with no plan, allow charging  Next.js web app
```

The browser talks only to the web app's origin; `/api/*` is proxied to the API.
Live updates arrive over a WebSocket, with polling as the fallback.

## Real, modelled, forecast, simulated

Nothing modelled or simulated is ever presented as measured. Every value on
screen carries one of these labels.

| What | Label | Where it comes from |
|---|---|---|
| Building load, solar export | MEASURED | The site's IoT meter over MQTT |
| Charger power and kWh | MEASURED | Tasmota smart plugs |
| Plug-in time, battery %, ready-by time | Entered by the user | The driver app |
| Non-EV load for the next 24 h, EV headroom | FORECAST | LightGBM P50/P90 |
| ToD-timer and uncontrolled comparisons in the night report | MODELLED | The same real sessions re-placed on the same measured building load |
| Neighbourhood twin: homes, EV fleet, transformer temperatures | MODELLED | CEEW household profiles (a labelled synthetic placeholder until `tools/ceew_prepare.py` has been run), IEC 60076-7 |
| Anything produced with `VOLTIX_SIMULATE=1` | SIMULATED | The built-in simulator. For demos and tests only |

## Connecting real devices

1. Set `VOLTIX_SIMULATE=0` and `VOLTIX_SEED_DEMO=0`, and point `VOLTIX_MQTT_*`
   at your broker.
2. **Meter.** Publish JSON on any topic and pair that topic in Admin → Plugs &
   meters. Accepted shapes: `{"power_w": 1830}` (signed; negative means export)
   or `{"import_w": 0, "export_w": 420}`. Optional `"voltage"`.
3. **Smart plugs.** Flash Tasmota, set the MQTT host, and power up. The plug
   appears under "Seen on the broker"; pair it and set its maximum watts.
4. **Edge.** On the Pi, install Mosquitto with `infra/mosquitto/edge-bridge.conf`
   and run `edge/agent.py` (see the header of that file).
5. Work through `docs/hil-checklist.md`.

## Tests and checks

```bash
make test
```

```bash
make lint
```

```bash
make e2e
```

`make e2e` needs `make api` and `make web` running. It drives every screen at
390 px and 1440 px, in light and dark, and saves screenshots to
`docs/screenshots/`. Results of the last full run are in
[`docs/verification.md`](docs/verification.md).

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).
Tariff windows and transformer constants are per-site configuration in the
Admin screens, with their sources in [`docs/sources.md`](docs/sources.md).

## Limitations

- **One pilot site.** A handful of chargers on one building does not prove
  behaviour at feeder scale. The twin is a model.
- **Constants to confirm.** The default ToD windows, the base rate, the
  transformer cost and the IEC worked-example reference values are marked TO
  CONFIRM in `docs/sources.md`. Check them against the primary documents.
- **Smart plugs are on/off.** Variable power needs an OCPP charger. The OCPP
  central system covers boot, heartbeat, status and `SetChargingProfile`; it is
  tested against a simulated charger, not yet against a real one.
- **Sign-in.** Google sign-in is verified by the API, which issues its own
  signed session token. It does not use Auth.js.
- **Notifications.** Telegram messages are sent when a bot token and a user's
  chat ID are set. Web push and SMS are not implemented.
- **Charger health.** Anomaly flags are rule-based (stopped early, unusual
  draw). Learning each plug's normal curve is not done yet.
- **NASA POWER** historical weather is not wired in; the forecaster uses
  Open-Meteo only.
- **Photos.** The landing page has no pilot photos yet. See
  `assets/photos/README.md`.

## Licence

MIT. See [LICENSE](LICENSE).
