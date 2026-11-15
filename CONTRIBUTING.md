# Project rules

These rules apply to every change in this repository.

- **Never present modelled or simulated data as measured.** Every value on
  screen is labelled MEASURED, MODELLED, FORECAST or SIMULATED.
- **Units.** Money in integer paise. Power in W and VA internally. Timestamps in
  UTC in the database and the API, shown in IST.
- **Deterministic control.** Grid and charging decisions are plain code. No LLM
  and no learned model in the control path. Forecasts inform the scheduler;
  they never issue commands.
- **Fail open.** If VOLTIX is unsure or offline, users can still charge.
- **Tests.** Every module has tests. Run `make test` and `make lint` before
  calling a piece of work done.
- **Keep it small.** VOLTIX controls EV charging only. Do not add features
  outside that scope without discussing it first.
- **Cite the constants.** Every configuration constant taken from a standard or
  tariff order (IEC 60076-7, IS 1180, the DERC ToD order) has its source in
  `docs/sources.md`.
- **Photos.** Only real photos from the pilot, or free-licence photos with the
  attribution recorded in `docs/sources.md`. No AI-generated images.
