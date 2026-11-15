#!/usr/bin/env python3
"""Turn CEEW smart-meter files into the twin's household profiles.

Source: CEEW smart-meter data for Mathura and Bareilly, Harvard Dataverse
(see docs/sources.md). Download the CSVs yourself (the dataset has its own
terms of use) and run:

    python tools/ceew_prepare.py path/to/ceew/*.csv

Output: backend/data/ceew_households.csv with one row per 15-minute slot from
00:00 IST and one column per household (mean W on a typical day).

The script looks for a timestamp column and a power (kW or W) or energy (kWh
per interval) column by name; adjust COLUMN_HINTS if your files differ.
"""

import sys
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "backend" / "data" / "ceew_households.csv"
COLUMN_HINTS = {
    "time": ["x_timestamp", "timestamp", "datetime", "time"],
    "meter": ["meter", "meter_id", "meter_name", "id"],
    "power_w": ["w", "power_w", "watt"],
    "power_kw": ["kw", "power_kw"],
    "energy_kwh": ["kwh", "t_kwh", "energy_kwh"],
}


def find(cols, names):
    low = {c.lower(): c for c in cols}
    return next((low[n] for n in names if n in low), None)


def main(paths: list[str]) -> None:
    if not paths:
        sys.exit(__doc__)
    homes = {}
    for p in paths:
        df = pd.read_csv(p)
        t = find(df.columns, COLUMN_HINTS["time"])
        if not t:
            print(f"skip {p}: no timestamp column")
            continue
        df[t] = pd.to_datetime(df[t], errors="coerce")
        df = df.dropna(subset=[t])
        meter = find(df.columns, COLUMN_HINTS["meter"])
        groups = df.groupby(meter) if meter else [(Path(p).stem, df)]
        for name, g in groups:
            g = g.set_index(t).sort_index()
            if c := find(g.columns, COLUMN_HINTS["power_w"]):
                w = g[c].astype(float)
            elif c := find(g.columns, COLUMN_HINTS["power_kw"]):
                w = g[c].astype(float) * 1000
            elif c := find(g.columns, COLUMN_HINTS["energy_kwh"]):
                step_h = g.index.to_series().diff().dt.total_seconds().median() / 3600
                w = g[c].astype(float) / step_h * 1000
            else:
                continue
            w = w.resample("15min").mean()
            slot = w.index.hour * 4 + w.index.minute // 15
            prof = w.groupby(slot).mean().reindex(range(96)).interpolate().bfill().ffill()
            if prof.notna().all() and prof.mean() > 5:
                homes[str(name)] = prof.round(1).values
    if not homes:
        sys.exit("No usable household profiles found. Check COLUMN_HINTS.")
    out = pd.DataFrame(homes)
    out.index.name = "slot"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT)
    print(f"wrote {len(homes)} household profiles to {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
