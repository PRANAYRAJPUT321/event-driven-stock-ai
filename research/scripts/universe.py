"""
Universe selection per STRATEGY_SPEC.md Section 1: fixed, mechanical rules
applied BEFORE any backtest is run, written to disk so the list can't be
quietly re-cut after seeing results.
"""

from __future__ import annotations

import json
import os

import pandas as pd

MIN_ADTV_CR = 10.0          # average daily traded value, INR crore
MAX_GAP_SESSIONS = 10        # consecutive missing trading days allowed


def apply_universe_filter(data: dict[str, pd.DataFrame], full_start: pd.Timestamp,
                           full_end: pd.Timestamp) -> tuple[list[str], dict]:
    # Reference trading calendar = union of dates actually present across the
    # candidate universe. This makes the gap test "did THIS stock stop
    # trading/report data for a stretch that other stocks didn't", rather
    # than penalizing every symbol for source-wide missing bhavcopy files
    # (holidays, or days the upstream scraper simply has no file for).
    calendar = sorted(set().union(*[
        set(df.loc[(df["Date"] >= full_start) & (df["Date"] <= full_end), "Date"]) for df in data.values()
    ]))
    cal_index = {d: i for i, d in enumerate(calendar)}

    kept, dropped = [], []
    for sym, df in data.items():
        d = df[(df["Date"] >= full_start) & (df["Date"] <= full_end)]
        if d.empty:
            dropped.append((sym, "no data in window")); continue
        sym_dates = set(d["Date"])
        first_i, last_i = cal_index[min(sym_dates)], cal_index[max(sym_dates)]
        # max run of consecutive False (missing) calendar sessions within the symbol's own trading span
        max_gap_sessions, run = 0, 0
        present_mask = [calendar[i] in sym_dates for i in range(first_i, last_i + 1)]
        for p in present_mask:
            run = 0 if p else run + 1
            max_gap_sessions = max(max_gap_sessions, run)
        if max_gap_sessions > MAX_GAP_SESSIONS:
            dropped.append((sym, f"max gap {max_gap_sessions} sessions > {MAX_GAP_SESSIONS} "
                                  f"(trades {min(sym_dates).date()}..{max(sym_dates).date()})")); continue
        if max(sym_dates) < full_end - pd.Timedelta(days=45):
            dropped.append((sym, f"data ends {max(sym_dates).date()}, well before window end "
                                  f"{full_end.date()} (delisted/merged/renamed)")); continue
        adtv = (d["Close"] * d["Volume"]).mean() / 1e7  # INR crore
        if adtv < MIN_ADTV_CR:
            dropped.append((sym, f"ADTV {adtv:.2f} cr < {MIN_ADTV_CR} cr")); continue
        kept.append(sym)
    stats = dict(
        n_input=len(data), n_kept=len(kept), n_dropped=len(dropped),
        dropped_detail=dropped, full_start=str(full_start), full_end=str(full_end),
    )
    return sorted(kept), stats


def write_universe(kept: list[str], stats: dict, out_path: str):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(dict(universe=kept, filter_stats=stats), f, indent=2, default=str)
