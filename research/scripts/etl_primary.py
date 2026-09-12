"""
ETL: parse raw NSE bhavcopy daily files (tilak999/NSE-Data-bank mirror,
data/sec_bhavdata_full_DDMMYYYY.csv, one file per trading session,
2010-06-10 .. present) into per-symbol OHLCV CSVs under research/data/primary/.

This is the PRIMARY data source for the backtest (see DATA_SOURCES.md for
why: this sandbox has no network access to Yahoo Finance, so the brief's
"Yahoo Finance primary" requirement is substituted with the exchange's own
official settlement-price bhavcopy, arguably a stronger primary source).
"""

import glob
import os
import sys
import time

import pandas as pd

RAW_DIR = "/home/user/bhavcopy/tilak999/repo/data"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "primary")

CANDIDATE_UNIVERSE = [
    "ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJAJ-AUTO", "BAJAJFINSV",
    "BAJFINANCE", "BHARTIARTL", "BPCL", "BRITANNIA", "CIPLA", "COALINDIA",
    "DRREDDY", "EICHERMOT", "GAIL", "GRASIM", "HCLTECH", "HDFC", "HDFCBANK",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK",
    "INFRATEL", "INFY", "IOC", "ITC", "JSWSTEEL", "KOTAKBANK", "LT", "M&M",
    "MARUTI", "NESTLEIND", "NTPC", "ONGC", "POWERGRID", "RELIANCE", "SBIN",
    "SHREECEM", "SUNPHARMA", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM",
    "TITAN", "ULTRACEMCO", "UPL", "VEDL", "WIPRO", "ZEEL",
]
# ISIN-stable renames known to have happened within our window -- mapped to
# their current trading symbol so the series doesn't spuriously "end" on a
# pure ticker rename. Documented here, not silently invented: both facts are
# publicly known corporate actions, not curve-fit after seeing results.
SYMBOL_ALIASES = {
    "INFRATEL": ["INFRATEL", "INDUSTOWER"],   # Bharti Infratel -> Indus Towers (2020 merger)
}


def load_all():
    files = sorted(glob.glob(os.path.join(RAW_DIR, "*.csv")))
    files = [f for f in files if os.path.basename(f) != "README.md"]
    wanted = set(CANDIDATE_UNIVERSE)
    for aliases in SYMBOL_ALIASES.values():
        wanted.update(aliases)

    frames = []
    t0 = time.time()
    for i, f in enumerate(files):
        try:
            df = pd.read_csv(f, skipinitialspace=True, dtype=str)
        except Exception as e:
            print(f"SKIP {f}: {e}", file=sys.stderr)
            continue
        df.columns = [c.strip() for c in df.columns]
        if "SYMBOL" not in df.columns:
            print(f"SKIP {f}: no SYMBOL column, cols={list(df.columns)}", file=sys.stderr)
            continue
        df["SYMBOL"] = df["SYMBOL"].str.strip()
        df["SERIES"] = df["SERIES"].str.strip()
        sub = df[(df["SYMBOL"].isin(wanted)) & (df["SERIES"] == "EQ")]
        if len(sub):
            frames.append(sub)
        if (i + 1) % 500 == 0:
            print(f"{i+1}/{len(files)} files, elapsed {time.time()-t0:.0f}s", file=sys.stderr)

    all_rows = pd.concat(frames, ignore_index=True)
    return all_rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    raw = load_all()
    print(f"Total matched rows: {len(raw)}")

    numeric_cols = ["PREV_CLOSE", "OPEN_PRICE", "HIGH_PRICE", "LOW_PRICE",
                     "LAST_PRICE", "CLOSE_PRICE", "AVG_PRICE", "TTL_TRD_QNTY",
                     "TURNOVER_LACS", "NO_OF_TRADES", "DELIV_QTY", "DELIV_PER"]
    for c in numeric_cols:
        raw[c] = pd.to_numeric(raw[c], errors="coerce")
    raw["Date"] = pd.to_datetime(raw["DATE1"], format="%d-%b-%Y")

    # collapse aliases onto the canonical (most recent) symbol name
    canonical = {}
    for canon, aliases in SYMBOL_ALIASES.items():
        for a in aliases:
            canonical[a] = aliases[-1]  # last in list = most current symbol
    raw["OutSymbol"] = raw["SYMBOL"].map(lambda s: canonical.get(s, s))

    report = []
    for sym, g in raw.groupby("OutSymbol"):
        g = g.sort_values("Date").drop_duplicates("Date", keep="last")
        out = pd.DataFrame({
            "Date": g["Date"].dt.strftime("%Y-%m-%d"),
            "Open": g["OPEN_PRICE"], "High": g["HIGH_PRICE"],
            "Low": g["LOW_PRICE"], "Close": g["CLOSE_PRICE"],
            "Volume": g["TTL_TRD_QNTY"],
        })
        out_path = os.path.join(OUT_DIR, f"{sym}.csv")
        out.to_csv(out_path, index=False)
        report.append(dict(symbol=sym, rows=len(out),
                            start=out["Date"].iloc[0], end=out["Date"].iloc[-1]))

    rep_df = pd.DataFrame(report).sort_values("symbol")
    rep_df.to_csv(os.path.join(OUT_DIR, "_etl_report.csv"), index=False)
    print(rep_df.to_string(index=False))
    missing = set(CANDIDATE_UNIVERSE) - set(rep_df["symbol"]) - {"INFRATEL"}
    if missing:
        print(f"NEVER MATCHED (check symbol spelling / still listed?): {sorted(missing)}")


if __name__ == "__main__":
    main()
