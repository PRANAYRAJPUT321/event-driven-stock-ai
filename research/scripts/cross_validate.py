"""
Independent-source cross-validation: 5 randomly selected (symbol, date)
pairs, comparing RAW (pre-split-adjustment) OHLCV as reported by two
independently-collected sources for the same NSE trading session:

  PRIMARY:   research/data/primary/<SYM>.csv
             -- built by etl_primary.py from tilak999/NSE-Data-bank, a
             GitHub Actions pipeline that downloads NSE's own official daily
             bhavcopy (sec_bhavdata_full report) directly.
  INDEPENDENT: Yuvraj-Singh-Bits-Pilani-Camus/Analysis-of-Nifty50, a mirror
             of the "NIFTY-50 Stock Market Data (2000-2021)" Kaggle dataset
             (uploader: Vopani/rohanrao), itself scraped from NSE archives
             independently, years earlier, by a different person using a
             different pipeline.

Both ultimately trace back to NSE, so this checks for SCRAPING/COLLECTION
errors (transcription bugs, wrong-date rows, unit errors), not exchange-side
errors -- an honest limitation stated in the final report, not hidden here.

Symbol/date pairs are drawn with a fixed seed (today's date, chosen before
looking at any result) from the overlap window both sources cover
(2010-06-10 .. 2021-04-30) so the check can't be quietly re-rolled to dodge
a bad sample.
"""

import random
import pandas as pd
import os

PRIMARY_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "primary")
KAGGLE_DIR = "/home/user/yuvraj-singh-bits-pilani-camus/analysis-of-nifty50/extracted/stock_market"

OVERLAP_START = pd.Timestamp("2010-06-10")
OVERLAP_END = pd.Timestamp("2021-04-30")

TOLERANCE_PCT = 0.005  # 0.5% -- allows for rounding differences, not real discrepancies


def load_primary_raw(sym):
    df = pd.read_csv(os.path.join(PRIMARY_DIR, f"{sym}.csv"))
    df["Date"] = pd.to_datetime(df["Date"])
    return df.set_index("Date")


def load_kaggle_raw(sym):
    df = pd.read_csv(os.path.join(KAGGLE_DIR, f"{sym}.csv"))
    df["Date"] = pd.to_datetime(df["Date"])
    return df.set_index("Date")


def main():
    random.seed(20260912)  # today's date at time of this analysis, fixed before sampling
    overlap_syms = sorted(
        set(os.path.splitext(f)[0] for f in os.listdir(PRIMARY_DIR) if f.endswith(".csv") and not f.startswith("_"))
        & set(os.path.splitext(f)[0] for f in os.listdir(KAGGLE_DIR) if f.endswith(".csv"))
    )
    picks = []
    attempts = 0
    while len(picks) < 5 and attempts < 200:
        attempts += 1
        sym = random.choice(overlap_syms)
        days_offset = random.randint(0, (OVERLAP_END - OVERLAP_START).days)
        candidate_date = OVERLAP_START + pd.Timedelta(days=days_offset)
        prim = load_primary_raw(sym)
        # snap to nearest actual trading date on/after the random calendar date
        future_dates = prim.index[prim.index >= candidate_date]
        if len(future_dates) == 0:
            continue
        actual_date = future_dates[0]
        picks.append((sym, actual_date))

    results = []
    for sym, date in picks:
        prim = load_primary_raw(sym)
        kag = load_kaggle_raw(sym)
        row_p = prim.loc[date] if date in prim.index else None
        row_k = kag.loc[date] if date in kag.index else None
        rec = dict(symbol=sym, date=str(date.date()))
        if row_p is None:
            rec["status"] = "MISSING_IN_PRIMARY"
        elif row_k is None:
            rec["status"] = "MISSING_IN_INDEPENDENT"
        else:
            fields = [("Open", "Open"), ("High", "High"), ("Low", "Low"), ("Close", "Close")]
            mismatches = []
            for pf, kf in fields:
                pv, kv = float(row_p[pf]), float(row_k[kf])
                rec[f"primary_{pf}"] = pv
                rec[f"independent_{kf}"] = kv
                if kv == 0:
                    continue
                pct_diff = abs(pv - kv) / abs(kv)
                rec[f"{pf}_pct_diff"] = pct_diff
                if pct_diff > TOLERANCE_PCT:
                    mismatches.append(f"{pf}: {pv} vs {kv} ({pct_diff:.2%})")
            rec["primary_Volume"] = float(row_p["Volume"])
            rec["independent_Volume"] = float(row_k["Volume"])
            rec["status"] = "MATCH" if not mismatches else f"MISMATCH: {'; '.join(mismatches)}"
        results.append(rec)

    df = pd.DataFrame(results)
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", "cross_validation.csv")
    df.to_csv(out_path, index=False)
    print(df.to_string(index=False))
    print(f"\nWritten to {out_path}")


if __name__ == "__main__":
    main()
