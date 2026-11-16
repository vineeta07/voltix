# Sources for constants, data and images

Every number in VOLTIX that comes from a standard, a tariff order or a dataset
is listed here with where it is used. Items marked **TO CONFIRM** were entered
from secondary knowledge and must be checked against the primary document
before the figures that depend on them are quoted.

## Transformer thermal model

| Constant | Value | Used in | Source |
|---|---|---|---|
| Difference equations for top-oil and hot-spot temperature | — | `backend/app/thermal.py` | IEC 60076-7, *Loading guide for mineral-oil-immersed power transformers*, exponential/difference equation method |
| Oil exponent x | 0.8 | `ThermalParams` | IEC 60076-7, recommended thermal characteristics, distribution transformers (ONAN) |
| Winding exponent y | 1.6 | `ThermalParams` | same table |
| k11, k21, k22 | 1.0, 1.0, 2.0 | `ThermalParams` | same table |
| Oil time constant τo | 180 min | `ThermalParams` | same table |
| Winding time constant τw | 4 min | `ThermalParams` | same table |
| Top-oil rise at rated load Δθor | 55 K | `ThermalParams` | same table |
| Hot-spot-to-top-oil gradient Δθhr | 23 K | `ThermalParams` | same table |
| Loss ratio R | 5 | `ThermalParams` | same table. For a specific unit, replace with load loss ÷ no-load loss from **IS 1180 (Part 1)** for the chosen kVA and energy-efficiency level |
| Relative ageing rate V = 2^((θh − 98)/6) | — | `thermal.ageing_rate` | IEC 60076-7, non-thermally-upgraded paper |
| Normal insulation life | 180 000 h | site transformer config | IEC 60076-7 lists 180 000 h among the normal-life criteria. **TO CONFIRM** which criterion applies to the pilot's transformer |
| Worked example used in the unit test | step-load profile, 250 MVA ONAF unit: Δθor 38.3 K, Δθhr 20.3 K (H·gr = 1.4 × 14.5), R 1000, x 0.8, y 1.3, k11 0.5, k21 2.0, k22 2.0, τo 150 min, τw 7 min, ambient 25.6 °C | `backend/tests/test_thermal.py` | IEC 60076-7, annex with the difference-equation example. **TO CONFIRM**: the reference temperatures in the test were transcribed from memory of that annex and are checked with a ±2 K tolerance. Verify them against a copy of the standard |
| Transformer replacement cost | ₹2.5 lakh (100 kVA) | site transformer config | Placeholder. **TO CONFIRM** with a current DISCOM schedule of rates |

## Tariff

| Constant | Value | Used in | Source |
|---|---|---|---|
| ToD windows and multipliers | off-peak 04:00–10:00 ×0.8; peak 14:00–17:00 and 22:00–01:00 ×1.2 | `backend/app/tariff.py` `DEFAULT_TARIFF` | Shaped like the DERC ToD schedule. **TO CONFIRM** against the current DERC tariff order; windows, months of applicability and surcharge/rebate percentages change between orders |
| Base energy charge | 450 paise/kWh | `DEFAULT_TARIFF` | Placeholder near the Delhi EV charging tariff. **TO CONFIRM** against the current order |

The tariff is per-site configuration (Admin → Tariff), not code.

## Data

| Data | Source | Used for |
|---|---|---|
| Building load and solar export | The site's IoT meter over MQTT | MEASURED load, solar surplus |
| Charger power and energy | Tasmota smart plugs (`tele/<plug>/SENSOR`) | MEASURED charging |
| Weather forecast | Open-Meteo forecast API (temperature, shortwave radiation), https://open-meteo.com | Forecaster features |
| Historical weather | NASA POWER, https://power.larc.nasa.gov | Planned for training and backtests; not wired in yet |
| Household load profiles | CEEW smart-meter data, Mathura and Bareilly, Harvard Dataverse. Prepared with `tools/ceew_prepare.py` | Twin households. Until the files are prepared the twin uses a synthetic placeholder shape and says so on screen |
| ~13% cost reduction from shifting e-rickshaw charging | BSES–CEEW Delhi pilot, as cited in the project brief | Landing-page copy. **TO CONFIRM** the exact figure and citation |
| Vehicle battery and charger sizes | `backend/app/vehicles.py` | Starting values only (typical 2W/3W/4W). Replaced by measured plug power once a plug has charged a vehicle |

## Images and fonts

- Logo: the supplied files in `assets/brand/`, used unmodified.
- Photos: five illustrative stock photos supplied by Vineeta, labelled on the landing page as not from the pilot. **TO CONFIRM**: the source, photographer and licence of each one (see `assets/photos/README.md`). The e-rickshaw photo in particular looks like a press photo and may not be free to use.
- Icons: Lucide (ISC licence).
- Fonts, self-hosted: Newsreader (SIL OFL 1.1), IBM Plex Sans, IBM Plex Mono and
  IBM Plex Sans Devanagari (SIL OFL 1.1), via the Fontsource packages.
- No AI-generated images are used anywhere.
