"""
Driver: load data -> apply universe filter -> run engine once over the full
window -> slice into in-sample / out-of-sample (last 12 months held out) ->
write JSON reports. Run from research/scripts/.
"""

from __future__ import annotations

import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from load_data import load_universe
from universe import apply_universe_filter, write_universe
from engine import run_backtest
from stats import full_report

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")


def main(column_map=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    data, quality_reports = load_universe(column_map=column_map)
    with open(os.path.join(OUT_DIR, "data_quality_report.json"), "w") as f:
        json.dump(quality_reports, f, indent=2, default=str)

    full_start = max(df["Date"].min() for df in data.values())
    full_end = min(df["Date"].max() for df in data.values())
    # Use the union's practical bounds: start = earliest common-enough date is
    # too strict for a 50-stock universe with staggered listings, so instead
    # use the GLOBAL min/max and let the per-symbol gap filter handle holes.
    full_start = min(df["Date"].min() for df in data.values())
    full_end = max(df["Date"].max() for df in data.values())

    kept, ustats = apply_universe_filter(data, full_start, full_end)
    write_universe(kept, ustats, os.path.join(OUT_DIR, "universe.json"))
    print(f"Universe: {len(kept)}/{len(data)} kept. Dropped: {ustats['dropped_detail']}")

    uni_data = {s: data[s] for s in kept}
    oos_start = full_end - pd.DateOffset(months=12) + pd.Timedelta(days=1)
    print(f"Full window: {full_start.date()} .. {full_end.date()}")
    print(f"OOS window (held out, last 12 months): {oos_start.date()} .. {full_end.date()}")

    trades = run_backtest(uni_data)
    print(f"Total closed trades over full window: {len(trades)}")

    is_report, is_eq = full_report(trades, uni_data, 100_000, full_start, oos_start - pd.Timedelta(days=1))
    oos_report, oos_eq = full_report(trades, uni_data, 100_000, oos_start, full_end)

    with open(os.path.join(OUT_DIR, "in_sample_report.json"), "w") as f:
        json.dump(is_report, f, indent=2, default=str)
    with open(os.path.join(OUT_DIR, "out_of_sample_report.json"), "w") as f:
        json.dump(oos_report, f, indent=2, default=str)
    is_eq.to_csv(os.path.join(OUT_DIR, "is_equity_curve.csv"))
    oos_eq.to_csv(os.path.join(OUT_DIR, "oos_equity_curve.csv"))

    all_trades_rows = [dict(
        symbol=t.symbol, signal_date=str(t.signal_date), entry_date=str(t.entry_date),
        entry_fill=t.entry_fill, shares=t.shares, stop_price=t.stop_price,
        exit_date=str(t.exit_date), exit_fill=t.exit_fill, exit_reason=t.exit_reason,
        gapped_stop=t.gapped_stop, net_pnl=t.net_pnl,
        period="OOS" if t.entry_date >= oos_start else "IS",
    ) for t in trades if t.exit_date is not None]
    pd.DataFrame(all_trades_rows).to_csv(os.path.join(OUT_DIR, "trade_log.csv"), index=False)

    print("IS:", {k: v for k, v in is_report.items() if k != "monthly_returns"})
    print("OOS:", {k: v for k, v in oos_report.items() if k != "monthly_returns"})


if __name__ == "__main__":
    main()
