"""
Detects and back-adjusts unadjusted stock splits / bonus issues in raw
NSE bhavcopy OHLCV series.

Raw bhavcopy Open/High/Low/Close are NOT split-adjusted (unlike, say,
yfinance's "Adj Close"). A 1:10 split or a 1:1 bonus shows up in the raw
series as an overnight ~10x or ~2x price drop with a matching inverse jump
in share volume -- and turnover (price * volume, i.e. rupee value traded)
staying roughly continuous across the jump. Left unadjusted, this reads to
any moving-average/ATR/stop-loss system as a catastrophic real loss, which
it is not: an existing holder's position value is unchanged by a split.

Detection requires the day-over-day price ratio to sit within 3% of a
"clean" split/bonus multiple (2, 3, 5, 10, 1.5, 1/2, ...) AND turnover
(price*volume) to stay within 4x across the jump (real crashes/rallies of
that magnitude essentially never combine with a near-exact clean ratio AND
continuous turnover -- both together is the signature of a corporate
action, not two independent coincidences). Every detected adjustment is
logged, never silently applied.
"""

from __future__ import annotations

import pandas as pd

CANDIDATE_RATIOS = [10, 5, 4, 3, 2, 1.5, 20, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 2 / 3, 0.4, 0.2]
RATIO_TOLERANCE = 0.04
MAX_TURNOVER_JUMP = 4.0


def detect_and_adjust(df: pd.DataFrame, symbol: str) -> tuple[pd.DataFrame, list[dict]]:
    df = df.sort_values("Date").reset_index(drop=True).copy()
    events = []
    n = len(df)
    if n < 2:
        return df, events

    # Work forward once, applying a cumulative adjustment factor to
    # everything BEFORE each detected split date (standard back-adjustment).
    adj_factor = 1.0
    adjusted_close = df["Close"].astype(float).tolist()
    adjusted_open = df["Open"].astype(float).tolist()
    adjusted_high = df["High"].astype(float).tolist()
    adjusted_low = df["Low"].astype(float).tolist()
    adjusted_vol = df["Volume"].astype(float).tolist()
    turnover = [o * v for o, v in zip(adjusted_open, adjusted_vol)]

    # detect on RAW series first (chronological, forward), collect split points
    raw_close = df["Close"].astype(float).tolist()
    raw_open = df["Open"].astype(float).tolist()
    raw_vol = df["Volume"].astype(float).tolist()
    raw_turnover = [o * v for o, v in zip(raw_open, raw_vol)]

    split_points = []  # (index_of_first_post_split_row, ratio) ratio = pre/post price multiple
    for i in range(1, n):
        prev_close = raw_close[i - 1]
        today_open = raw_open[i]
        if prev_close <= 0 or today_open <= 0:
            continue
        ratio = prev_close / today_open
        best = min(CANDIDATE_RATIOS, key=lambda c: abs(ratio - c) / c)
        if abs(ratio - best) / best > RATIO_TOLERANCE:
            continue
        t_prev, t_today = raw_turnover[i - 1], raw_turnover[i]
        if t_prev <= 0 or t_today <= 0:
            continue
        turnover_jump = max(t_prev, t_today) / min(t_prev, t_today)
        if turnover_jump > MAX_TURNOVER_JUMP:
            continue
        split_points.append((i, best))

    if not split_points:
        return df, events

    # Apply back-adjustment: for each split point (processed in order), every
    # row BEFORE it gets divided by `best` (price) / multiplied by `best` (volume).
    out = df.copy()
    out["Volume"] = out["Volume"].astype(float)
    prices_cols = ["Open", "High", "Low", "Close"]
    for i, ratio in split_points:
        out.loc[: i - 1, prices_cols] = out.loc[: i - 1, prices_cols] / ratio
        out.loc[: i - 1, "Volume"] = out.loc[: i - 1, "Volume"] * ratio
        events.append(dict(
            symbol=symbol, split_date=str(df.loc[i, "Date"].date()),
            ratio_pre_over_post=ratio,
            raw_prev_close=raw_close[i - 1], raw_today_open=raw_open[i],
            turnover_prev=raw_turnover[i - 1], turnover_today=raw_turnover[i],
        ))
    return out, events
