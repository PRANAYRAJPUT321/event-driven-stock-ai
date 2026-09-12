"""
Loads per-symbol daily OHLCV CSVs from research/data/ into the
dict[symbol -> DataFrame] shape engine.run_backtest expects, with basic
data-quality checks (not silent cleaning -- anything suspicious is reported,
not papered over).
"""

from __future__ import annotations

import glob
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from engine import add_indicators
from adjust_splits import detect_and_adjust

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "primary")

REQUIRED_COLS = ["Date", "Open", "High", "Low", "Close", "Volume"]


def load_symbol_csv(path: str, column_map: dict[str, str] | None = None) -> pd.DataFrame:
    df = pd.read_csv(path)
    if column_map:
        df = df.rename(columns=column_map)
    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"{path}: missing required columns {missing}, has {list(df.columns)}")
    df["Date"] = pd.to_datetime(df["Date"])
    df = df[REQUIRED_COLS].sort_values("Date").drop_duplicates("Date", keep="last")
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    return df.reset_index(drop=True)


def quality_report(sym: str, df: pd.DataFrame) -> dict:
    issues = []
    bad_ohlc = df[(df["High"] < df["Low"]) | (df["Close"] > df["High"]) | (df["Close"] < df["Low"])
                  | (df["Open"] > df["High"]) | (df["Open"] < df["Low"])]
    if len(bad_ohlc):
        issues.append(f"{len(bad_ohlc)} rows with High<Low or Close/Open outside High-Low band")
    zero_vol = (df["Volume"] <= 0).sum()
    if zero_vol:
        issues.append(f"{zero_vol} rows with zero/negative volume")
    ret = df["Close"].pct_change()
    jumps = (ret.abs() > 0.20).sum()
    if jumps:
        issues.append(f"{jumps} single-day |return| > 20% (verify vs. split/bonus adjustment)")
    gaps = df["Date"].diff().dt.days
    long_gaps = (gaps > 10).sum()
    if long_gaps:
        issues.append(f"{long_gaps} gaps of >10 calendar days between rows")
    return dict(symbol=sym, n_rows=len(df), start=str(df["Date"].min()), end=str(df["Date"].max()),
                issues=issues)


def load_universe(pattern: str = "*.csv", column_map: dict[str, str] | None = None,
                   adjust_for_splits: bool = True) -> dict[str, pd.DataFrame]:
    data = {}
    reports = []
    all_split_events = []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, pattern))):
        sym = os.path.splitext(os.path.basename(path))[0]
        if sym.startswith("_"):
            continue
        df = load_symbol_csv(path, column_map)
        if adjust_for_splits:
            df, events = detect_and_adjust(df, sym)
            all_split_events.extend(events)
        reports.append(quality_report(sym, df))
        data[sym] = add_indicators(df)
    if adjust_for_splits and all_split_events:
        out_path = os.path.join(os.path.dirname(__file__), "..", "output", "split_adjustments.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        import json
        with open(out_path, "w") as f:
            json.dump(all_split_events, f, indent=2, default=str)
        print(f"Detected & back-adjusted {len(all_split_events)} split/bonus events "
              f"across {len(set(e['symbol'] for e in all_split_events))} symbols "
              f"-> {out_path}")
    return data, reports


if __name__ == "__main__":
    data, reports = load_universe()
    for r in reports:
        print(r)
