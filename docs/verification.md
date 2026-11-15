# Verification report

Last full run: 15–16 November 2026, on the built-in simulator (no hardware
attached). "Pass" means the check was run and passed in that run. Anything not
run is marked **Not run** with the reason.

## 1. Unit tests — `make test` (48 passed)

| Check | Result | Where |
|---|---|---|
| Scheduler: deadlines met, capacity respected, capacity profile | Pass | `tests/test_scheduler.py` |
| Scheduler: started non-interruptible sessions never move | Pass | same |
| Scheduler: peak, then solar, then ToD cost ordering | Pass | same |
| Scheduler: interruptible sessions get variable power | Pass | same |
| Scheduler: infeasible case reported with the smallest relaxation | Pass | same |
| Scheduler: fairness moves a repeatedly-last user forward | Pass | same |
| Scheduler: four baseline strategies; deterministic results | Pass | same |
| Thermal model against the IEC 60076-7 worked example | Pass, ±2 K | `tests/test_thermal.py`. The reference temperatures were transcribed from memory of the standard and need checking against a copy (see `docs/sources.md`) |
| Thermal: steady state, ageing rate, loss of life, large time steps | Pass | same |
| Forecaster: pinball loss, coverage, held-out calibration, fallbacks | Pass | `tests/test_forecast.py` |
| Tariff windows in IST and cost in integer paise | Pass | `tests/test_tariff_audit.py` |
| Audit chain verifies; detects an edited row and a deleted row | Pass | same |
| Neighbourhood twin: profiles, VOLTIX vs ToD timer, sweep headline | Pass | `tests/test_twin.py` |

## 2. Integration tests (in `make test`)

| Check | Result | Notes |
|---|---|---|
| MQTT telemetry → database → API | Pass | `tests/test_api_flow.py`. Messages are fed to the ingest handler directly, not through a running broker |
| API → WebSocket → UI chart | Pass (end-to-end suite) | The live chart is asserted in the browser. The socket path itself has no dedicated test; polling is the fallback |
| Session created → scheduler → plug command on MQTT | Pass | Asserts `cmnd/<plug>/POWER` messages in the outbound queue |
| Plug state reflected in the UI | Pass | API level, and the plug list in the browser |
| Override: immediate ON, logged, audit chain intact | Pass | |
| Control loop starts, tracks energy from the plug counter, finishes | Pass | |
| Measured overload triggers a re-plan and an alert | Pass | |
| Roles enforced (user / operator / admin) | Pass | |
| OCPP simulator receives `SetChargingProfile` | Pass | `tests/test_ocpp.py`, simulated charger over a real WebSocket |
| Edge agent offline fallback | Pass | `tests/test_edge.py` tests the decision logic and the saved plan. Cutting a real network link is in the hardware checklist |
| Assistant cannot call any write endpoint | Pass | `tests/test_assistant.py`: write tool names are refused, the module imports no command or scheduler code, and a model asking for a write tool gets an error result |
| `docker compose up` with a real broker and TimescaleDB | **Not run** | Docker could not be started in the build environment. The compose file, Dockerfiles and the Alembic migration are untested as a stack |

## 3. End-to-end — `make e2e` (44 passed)

11 scenarios × 390 px and 1440 px × light and dark. Each run fails on any
console error or horizontal scroll.

| Scenario | Result |
|---|---|
| Landing page | Pass |
| Public impact page and user guide | Pass |
| Sign-in (redirect when signed out, development login) | Pass. Google sign-in **not run** (needs a client ID) |
| User plugs in, sees the start time, progress and override; history; Hindi | Pass |
| Operator live view | Pass |
| Night report | Pass |
| Twin and adoption sweep | Pass |
| Forecast, sessions, audit log | Pass |
| Admin pairs and removes a plug; tariff tab | Pass |
| Ask VOLTIX | Pass for the no-key case (feature hidden, endpoint closed). The live conversation was **not run** (no API key) |
| A driver cannot open operator screens | Pass |

Screenshots are in `docs/screenshots/` (76 files). A sample was reviewed by
eye (landing, live, twin, night report, charging app, admin on a phone); the
full set has not been reviewed one by one. Review found and fixed: a sideways
overflow on the admin screen at 390 px, crowded timeline labels, and cancelled
sessions cluttering the live timeline.

## 4. Hardware-in-the-loop

**Not run.** `docs/hil-checklist.md` is for the team to run on the real meter
and plugs.

## 5. Quality gates

| Gate | Result |
|---|---|
| ruff | Pass |
| mypy | Pass |
| eslint | Pass |
| tsc | Pass |
| Lighthouse, production build, mobile profile | `/` 94 / 96 / 100 · `/impact` 99 / 100 / 100 · `/guide` 100 / 100 / 100 · `/signin` 92 / 100 / 100 (performance / accessibility / best practices) |
| Lighthouse on signed-in screens | **Not run** |
| No console errors | Pass (enforced in every end-to-end run) |
| No horizontal scroll at 390 px | Pass (enforced in every end-to-end run). 360 px was not tested separately |
| `pip-audit` | Pass, no known vulnerabilities |
| `npm audit` | No high or critical. 8 moderate, all in the eslint toolchain (development only) |
| README setup from a fresh clone in under 10 minutes | **Not run** on a fresh machine. `make setup`, `make api` and `make web` are the commands used throughout this build |

## Known limitations

See the Limitations section of the README. The ones that affect how far these
results can be trusted:

- Everything above ran on simulated devices. No measured data exists yet.
- The tariff defaults, transformer cost and IEC reference values are marked TO
  CONFIRM in `docs/sources.md`.
- Twin households are a synthetic placeholder until the CEEW files are
  prepared.
- The stack has not been run under Docker with TimescaleDB and Mosquitto.
