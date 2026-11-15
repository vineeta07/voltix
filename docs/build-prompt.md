# VOLTIX: build prompt for Claude Code

How to use this:
- Paste everything below the line into Claude Code, inside an empty repo.
- Use **plan mode** first, then build **one milestone at a time**.
- Also save the "Project rules" section as `CLAUDE.md` in the repo.

---

You are building **VOLTIX**, a working product for the Schneider Electric **Yuva Yodha Energy Tech Hackathon 2026, Challenge 03 (Grid Reliability & Renewable Intermittency)**. The prototype deadline is **7 Dec 2026**. Build it milestone by milestone; after each milestone the system must run end to end.

## 1. What VOLTIX is (keep this scope; do not add features)

**The traffic signal for EV charging on a neighbourhood transformer.** India's Time-of-Day (ToD) tariffs make every EV start charging the minute the cheap rate begins, all on the same transformer (a "snapback peak"). VOLTIX:
- keeps everyone's cheap rate and ready-by time;
- gives each vehicle its own start time, so the site never exceeds its real capacity;
- pulls vehicles parked in the daytime into hours of **measured solar surplus**.

It never controls household appliances. It only controls EV charging.

**Who it's for:**
- **Product (paying customer): housing societies and RWAs.** They want to add EV chargers for residents **without upgrading their sanctioned load or transformer**. VOLTIX keeps the society's total load under its real limit, every resident still gets charged by their ready-by time, and the DISCOM gets a verified report. Main users: the society facility manager (operator) and residents (EV owners).
- **Social-impact pilot: e-rickshaw charging points.** Low-income drivers keep their charging, get it cheaper by shifting into solar and off-peak hours (the Delhi BSES–CEEW pilot showed ~13% cost reduction from shifting), and are never left uncharged in the morning.
- **Proof site: DTU.** A real building with Vineeta's meter, real plugs and real users. Model the data so that "site" can be a society, a charging point or a campus building.

**Real, not simulated.** The live pilot runs on a real DTU building:
- a **real IoT energy meter** (bidirectional, MQTT; it already exists, built by Vineeta) on the building's supply;
- **real smart plugs** (Tasmota/ESPHome, MQTT, with energy metering) on real e-scooter and e-rickshaw chargers;
- **real users** (DTU students and staff) entering plug-in time and ready-by time in the web app.

The constraint VOLTIX protects in the pilot is real: the building's **capacity headroom**, i.e. the rated limit of its breaker or sub-board, configured per site.

The **transformer digital twin** scales the same logic to a whole neighbourhood transformer. It adds modelled households from real CEEW smart-meter data to the real measured load. Every value shown in the UI is labelled **MEASURED**, **MODELLED** or **FORECAST**.

## 2. Architecture

```
[Edge — Raspberry Pi at the site]                 [Cloud — one VM, docker compose]
 Mosquitto MQTT broker  ◄── IoT meter (ESP32)       FastAPI backend + Postgres/TimescaleDB
 edge-agent (Python):   ◄── Tasmota smart plugs     Scheduler worker (OR-Tools CP-SAT)
   - forwards telemetry ──────── MQTT bridge ──────► Forecaster (LightGBM quantile)
   - executes plug commands ◄────────────────────── Twin (IEC 60076-7 thermal model)
   - SAFE FALLBACK: if cloud unreachable,           OCPP 1.6J central system (python `ocpp`)
     run the last plan; on no plan, allow charging  Next.js web app (operator + user PWA)
```

The edge must keep working if the internet drops: run the last valid schedule, and fail **open** (users can always charge).

## 3. Tech stack (use current stable versions; check docs via Context7)

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, `aiomqtt`, `ocpp`, `ortools`, `lightgbm`, `pandas`, `httpx`.
- **DB:** PostgreSQL + TimescaleDB (hypertables for telemetry; continuous aggregates for 1 min and 15 min).
- **Messaging:** Mosquitto, with TLS and username/password.
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Apache ECharts (live time series) + TanStack Query + WebSocket live updates. The user app is an installable **PWA** with web push. Auth via Auth.js (Google sign-in) with roles `admin`, `operator`, `user`.
- **Notifications:** web push + a Telegram bot. SMS is roadmap only; Indian SMS needs DLT registration.
- **Infra:** Docker Compose. GitHub Actions CI (lint, tests, build). `.env.example`, no secrets in git. MIT license.
- **No LangChain, LangGraph or agent frameworks.** Control decisions are deterministic. Optional milestone 6 only: a single LLM call that turns the night's report into a plain-language summary, read-only, with no write access to schedules.

## 4. Data: real sources

| Data | Source | Use |
|---|---|---|
| Building load + solar export, live | Vineeta's IoT meter via MQTT | Real constraint + solar-surplus signal |
| EV charger power + kWh, live | Tasmota plugs (`tele/<plug>/SENSOR`, command `cmnd/<plug>/POWER`) | Real charging curves; actual switching |
| User inputs | Web app: vehicle, battery %, plug-in time, ready-by time | Real deadlines |
| Weather forecast | Open-Meteo API (free; temperature, irradiance) | Forecaster features |
| Historical weather | NASA POWER | Training and backtest |
| Household profiles | CEEW smart-meter data, Mathura & Bareilly (Harvard Dataverse) | Twin households, forecaster training |
| Tariff | ToD schedule from the official DERC tariff order, entered as **config** | Cost calculation |
| Transformer parameters | IEC 60076-7 default ONAN distribution values; losses from IS 1180 for the chosen kVA, entered as **config** with citations | Thermal twin |

**Simulation is allowed only for:** (a) automated tests, (b) the twin's modelled households, and (c) a `DEMO_REPLAY` mode that replays **recorded real** telemetry. All of it must be clearly labelled in the UI.

## 5. Core logic

**Sessions.** When a user plugs in, a session is created: vehicle type, charge profile (measured kW from the plug), energy needed, ready-by time, and `interruptible` (false for lead-acid and plug-controlled chargers; true for OCPP cars).

**Forecaster.** Predicts the building's non-EV load at P50 and P90, every 15 minutes over the next 24 h. Features: recent measured load, hour, weekday, temperature forecast. Report pinball loss and interval coverage on held-out data.

**Scheduler** (CP-SAT, re-solved every 15 minutes and whenever a session is added or changed):
- Capacity per slot = `site_limit_kVA − P90_forecast_nonEV_kVA − safety_margin`.
- Non-interruptible sessions are fixed-length intervals. Use `AddCumulative` against the capacity profile.
- Interruptible OCPP sessions get variable power per slot, up to charger max.
- **Hard constraints:** every session meets its ready-by time; capacity is never exceeded; started non-interruptible sessions never move.
- **Objective, in order:**
  1. Meet ready-by times.
  2. Minimise peak.
  3. Maximise use of measured or forecast solar surplus.
  4. Minimise ToD cost.
  5. Fairness: penalise users who were scheduled last repeatedly.
- **If infeasible,** don't silently miss a deadline. Mark the affected sessions, notify the user and the operator, and propose the smallest relaxation.
- **Baseline strategies for comparison** (same engine, flags): `uncontrolled`, `tod_timer` (all start at the cheap-rate boundary), `random_delay` (UK-style), `site_limit_only`.

**Live control loop (every minute).** Compare the measured load with the plan. If measured load exceeds the limit, delay not-yet-started sessions first; pause interruptible ones only as a last resort. Users can override at any time, and every override is logged.

**Thermal twin** (IEC 60076-7 difference equations). Top-oil and hot-spot temperatures from the kVA load profile and ambient temperature. Ageing rate `V = 2^((θh − 98)/6)`. Loss of life in hours, then in ₹ using the transformer cost from config. Unit-test it against the worked example in IEC 60076-7.

**Neighbourhood twin.** One transformer (configurable kVA) = **real measured** building load + N modelled households (CEEW profiles) + EV sessions, using real measured charging curves. An EV-adoption sweep (5–40% of homes; configurable mix of 2W/3W/4W) runs all five strategies and reports, for each:
- peak %;
- minutes over the limit;
- maximum hot-spot temperature;
- ₹ of transformer life lost;
- deadlines met.

The headline output: **"adoption at which each strategy first overloads."**

**Audit log.** An append-only, hash-chained table of every plan, command, override and measurement summary, with a Verify endpoint.

## 6. Web app (production quality, not a demo page)

### Design system (follow strictly)
- **Feel:** calm, trustworthy, utility-grade, like a modern fintech or energy-ops product. **No neon, no glows, no gradients on text, no glassmorphism, no particle or "AI" background animations.** Motion only for meaning: 150–200 ms fades and slides, chart transitions, a live pulse on "LIVE" badges. Respect `prefers-reduced-motion`.
- **Logo:** use the provided SVGs in `assets/brand/` (`voltix-mark.svg`, `voltix-mark-dark.svg`, `voltix-logo-light.svg`, `voltix-logo-dark.svg`). Generate the favicon, PWA icons (192/512, maskable) and Open Graph image from the mark. Never recolour or stretch it.
- **Colour tokens** (CSS variables, light and dark):

  | Token | Light | Dark |
  |---|---|---|
  | Ink / Night | `#0F2A3A` text | `#0B1F2B` background |
  | Panel | white | `#173A4D` |
  | Paper | `#F7F6F2` background | — |
  | Teal (brand accent) | `#1F9E89` | `#1F9E89` |
  | Signal amber (only for "scheduled / waiting" states) | `#F2A93B` | `#F2A93B` |
  | Safe | `#2E9D5B` | `#2E9D5B` |
  | Danger | `#D64545` | `#D64545` |

  Use greys for everything else. Charts: teal = VOLTIX, grey = baseline, red dashed line = limit, amber = forecast band.
- **Type:** Inter (UI) + JetBrains Mono (numbers in tables), self-hosted. Use tabular numerals for all metrics. Scale 12/14/16/20/24/32/40.
- **Layout:** 8 px spacing grid. Cards with 12 px radius, 1 px border, very soft shadow. Max content width 1280 px. Left sidebar on desktop, bottom tab bar on mobile.
- **Imagery:**
  - Use **real photos from our pilot** (meter, plugs, scooters, e-rickshaws) in `assets/photos/`. Add `assets/photos/README.md` with credits and consent.
  - Until we have them, use free-licence photos from Unsplash or Pexels with attribution recorded in `docs/sources.md`.
  - Spot illustrations: simple line icons (Lucide) only.
  - **No AI-generated images** (the hackathon terms restrict AI-generated content).
- **Components:** shadcn/ui, themed with the tokens above. One `StatCard`, `LiveBadge`, `DataLabel` (MEASURED / MODELLED / FORECAST pill), `SessionTimeline`, `LoadChart` and `EmptyState` component, reused everywhere.
- **Copy:** plain English, short. Hindi toggle for the user PWA (driver-facing strings only). Numbers always have units.
- **Quality bar:**
  - Lighthouse ≥ 90 for performance, accessibility and best practices on every page.
  - No layout shift on live updates.
  - No horizontal scroll at 360 px.
  - Every screen has designed loading, empty and error states.
  - Keyboard navigable; WCAG AA contrast.

Real-time updates via WebSocket.

### Landing page (public)
Hero with the logo, the one-line pitch ("Tariffs tell every EV when power is cheap. Nobody tells them not all at once."), a real photo, and three live numbers from the impact API. Then: "How it works" in 3 steps, the snapback chart (ToD timer vs VOLTIX), "For societies" / "For drivers" / "For DISCOMs" sections, and a short honest-limits note.

1. **Operator: Live site.**
   - The live load curve (MEASURED) with the site limit line, the P50/P90 forecast band, and solar export.
   - Active sessions as a timeline (planned vs actual).
   - The kW of each plug.
   - Alerts.
2. **Operator: Night report.** Peak vs limit, ready-by times met, worst spare time, kWh moved into solar hours, ₹ saved under ToD, overrides, and the audit chain status.
3. **Operator: Neighbourhood twin.** Transformer loading for the five strategies, the hot-spot temperature curve, ₹ of life lost, and the EV-adoption sweep chart (the headline chart).
4. **User PWA.**
   - One-tap "I've plugged in", with vehicle, battery % and ready-by time.
   - Then: "Starts at 12:40, ready by 6:10".
   - Live progress, an override button, history, and a rating after each session.
5. **Admin.** Sites, limits, plugs (pair by MQTT topic), meters, tariff config, transformer config, users and consent records.
6. **Public impact page.** Live aggregate metrics with no personal data: users, sessions, kWh measured, deadlines met, kWh moved into solar hours, and peak reduction vs the ToD-timer counterfactual.

## 6b. AI features (useful, safe, connected to real data)

AI sits **around** the control loop, never inside it:
1. **Forecasting (core):** LightGBM P50/P90 forecasts of the site's non-EV load and of solar export (from the meter + Open-Meteo). These drive the scheduler.
2. **Charger health and anomaly detection:** learn each plug's normal charging curve, and flag abnormal sessions (unusual draw, stalled charge, a battery that never reaches its expected kWh). Alert the operator. This is a real safety feature for e-rickshaw lead-acid packs.
3. **"Ask VOLTIX" assistant (operator only, read-only):**
   - A direct LLM API call with function calling. **No LangChain or LangGraph.**
   - Its tools are *read-only* API endpoints (site status, the night report, sessions, alerts).
   - Answers in English or Hindi, with numbers taken only from tool results and a link to the source screen.
   - It cannot create, change or cancel schedules or commands.
   - If no API key is set, the feature hides itself.
4. **Night report summary:** the same read-only assistant writes a 5-line plain-language summary of each night for the facility manager and the DISCOM.

## 7. Milestones (each one ends running end to end, with tests)

1. **Data spine:**
   - docker compose (Postgres/Timescale, Mosquitto, API, web);
   - MQTT ingest for the meter and Tasmota plugs;
   - telemetry tables;
   - the live operator chart from **real MQTT data**;
   - a `tools/fake_device.py` for tests only.
2. **Sessions + scheduler + control:**
   - the user PWA flow;
   - the CP-SAT scheduler with hard constraints;
   - plug commands through the edge agent;
   - overrides;
   - the audit log.
3. **Forecaster + solar surplus:** P50/P90 model, Open-Meteo integration, solar-aware objective, accuracy report.
4. **Thermal + neighbourhood twin:** IEC 60076-7 model with tests, CEEW household pipeline, five-strategy comparison, adoption sweep.
5. **Production polish:**
   - auth and roles;
   - the night report;
   - the public impact page;
   - Telegram bot;
   - OCPP 1.6J central system tested with a charger simulator (`SetChargingProfile`);
   - CI;
   - Playwright end-to-end tests at 390 px and 1440 px;
   - README with setup, architecture, the real-vs-modelled table, and limitations.
6. **AI features:** charger anomaly detection, the "Ask VOLTIX" read-only assistant, night summaries.
7. **Final verification:** run everything in section 7b and fix everything it finds before calling the project done.

## 7b. Final verification (the last milestone; nothing ships broken)

1. **Unit tests:**
   - scheduler: deadlines, capacity, non-interruptible sessions, infeasible-case handling, fairness;
   - thermal model against the IEC 60076-7 worked example;
   - forecaster metrics;
   - tariff and cost maths;
   - audit chain verification.
2. **Integration tests** (docker compose up, with test fixtures):
   - MQTT telemetry → database → API → WebSocket → UI chart;
   - session created in the PWA → scheduler → plug command published on MQTT → the plug's state reflected in the UI;
   - an OCPP simulator receiving `SetChargingProfile`;
   - the edge agent's offline fallback (cut the cloud link; charging continues);
   - the assistant can't call any write endpoint (test that it's refused).
3. **End-to-end (Playwright),** at 390 px and 1440 px, light and dark:
   - landing page;
   - sign-in;
   - user plugs in, then sees the start time, progress and override;
   - operator live view;
   - night report;
   - twin and adoption sweep;
   - admin pairing a plug;
   - "Ask VOLTIX".

   Save screenshots to `docs/screenshots/` and review every one for visual defects.
4. **Hardware-in-the-loop checklist** (`docs/hil-checklist.md`), run by the team on real devices:
   - meter publishing;
   - each plug switching on its scheduled minute (±60 s);
   - the measured kWh matching the plug's own counter;
   - override works;
   - internet loss handled.
5. **Quality gates:**
   - lint and type-check clean (ruff, mypy, eslint, tsc);
   - Lighthouse ≥ 90;
   - no console errors;
   - `pip-audit` and `npm audit` show no high or critical issues;
   - README setup works from a fresh clone in under 10 minutes.
6. **Report:** write `docs/verification.md` listing every check with pass/fail and any known limitation.

## 8. Project rules (save as CLAUDE.md)

- Never present modelled or simulated data as measured. Label every value MEASURED / MODELLED / FORECAST.
- Money in integer paise; power in W and VA internally; timestamps in UTC, displayed in IST.
- Grid and charging decisions are deterministic code only. No LLM in the control path.
- Fail open: if VOLTIX is unsure or offline, users can still charge.
- Every module has tests. Run `make test` before saying a milestone is done.
- Keep it small: don't add features outside section 1 without asking.
- Put the citations for every config constant (IEC 60076-7, IS 1180, the DERC ToD order) in `docs/sources.md`.
