"""
Turns a closed-trade list + price data into the equity curve and performance
statistics requested in the brief: trade count, win rate, avg win/loss,
profit factor, CAGR, monthly returns, max drawdown, exposure, worst losing
streak. Equity is marked to market daily (not just at trade exits), so
drawdown reflects real intra-trade pain, not just realized P&L jumps.
"""

from __future__ import annotations

import pandas as pd
import numpy as np


def build_equity_curve(trades, data: dict[str, pd.DataFrame], start_capital: float,
                        period_start: pd.Timestamp, period_end: pd.Timestamp) -> pd.Series:
    idx = {sym: df.set_index("Date")["Close"] for sym, df in data.items()}
    all_dates = sorted(set().union(*[set(s.index) for s in idx.values()]))
    all_dates = [d for d in all_dates if period_start <= d <= period_end]

    # position lots active on each date, keyed by symbol -> (shares, still_open)
    cash = start_capital
    equity = []
    # Pre-index trades by entry/exit date for cash flow application
    entries_by_date: dict[pd.Timestamp, list] = {}
    exits_by_date: dict[pd.Timestamp, list] = {}
    for t in trades:
        entries_by_date.setdefault(t.entry_date, []).append(t)
        exits_by_date.setdefault(t.exit_date, []).append(t)

    open_lots: dict[str, object] = {}  # symbol -> Trade currently open (for mark-to-market)

    for date in all_dates:
        for t in entries_by_date.get(date, []):
            if period_start <= t.entry_date <= period_end:
                cash -= (t.shares * t.entry_fill + t.entry_costs)
                open_lots[t.symbol] = t
        for t in exits_by_date.get(date, []):
            if t.symbol in open_lots and open_lots[t.symbol] is t:
                cash += (t.shares * t.exit_fill - t.exit_costs)
                del open_lots[t.symbol]

        mtm = 0.0
        for sym, t in open_lots.items():
            px_series = idx[sym]
            if date in px_series.index:
                mtm += t.shares * px_series.loc[date]
            else:
                mtm += t.shares * t.entry_fill  # stale fallback, rare
        equity.append(cash + mtm)

    return pd.Series(equity, index=pd.DatetimeIndex(all_dates), name="equity")


def max_drawdown(equity: pd.Series) -> tuple[float, pd.Timestamp, pd.Timestamp]:
    running_max = equity.cummax()
    dd = (equity - running_max) / running_max
    trough_date = dd.idxmin()
    peak_date = equity.loc[:trough_date].idxmax()
    return dd.min(), peak_date, trough_date


def monthly_returns(equity: pd.Series) -> pd.Series:
    m = equity.resample("ME").last()
    return m.pct_change().dropna()


def cagr(equity: pd.Series) -> float:
    if len(equity) < 2:
        return float("nan")
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    if years <= 0:
        return float("nan")
    return (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1


def worst_losing_streak(trades_sorted_by_exit) -> int:
    worst = cur = 0
    for t in trades_sorted_by_exit:
        if t.exit_reason == "data_end":
            continue
        if t.net_pnl < 0:
            cur += 1
            worst = max(worst, cur)
        else:
            cur = 0
    return worst


def exposure(equity_dates: pd.DatetimeIndex, trades, period_start, period_end) -> float:
    """Fraction of sessions with >=1 open position."""
    total_days = len(equity_dates)
    if total_days == 0:
        return float("nan")
    open_days = set()
    for t in trades:
        if t.exit_date is None:
            continue
        span = equity_dates[(equity_dates >= max(t.entry_date, period_start)) &
                             (equity_dates <= min(t.exit_date, period_end))]
        open_days.update(span)
    return len(open_days) / total_days


def trade_stats(trades) -> dict:
    # "data_end" exits are the backtest window running out while a position
    # was still open -- not a strategy decision, so they're reported
    # separately (count + unrealized P&L) rather than folded into win
    # rate / profit factor, which would otherwise arbitrarily score an
    # undecided, still-open trade as a win or loss based on today's close.
    open_at_cutoff = [t for t in trades if t.exit_reason == "data_end"]
    trades = [t for t in trades if t.exit_reason != "data_end"]
    n = len(trades)
    if n == 0:
        return dict(n_trades=0, open_at_cutoff_count=len(open_at_cutoff),
                     open_at_cutoff_unrealized_pnl=sum(t.net_pnl for t in open_at_cutoff))
    pnls = np.array([t.net_pnl for t in trades])
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]
    win_rate = len(wins) / n
    avg_win = wins.mean() if len(wins) else 0.0
    avg_loss = losses.mean() if len(losses) else 0.0
    gross_win = wins.sum()
    gross_loss = abs(losses.sum())
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf")
    gapped = sum(1 for t in trades if t.gapped_stop)
    reasons = {}
    for t in trades:
        reasons[t.exit_reason] = reasons.get(t.exit_reason, 0) + 1
    return dict(
        n_trades=n, win_rate=win_rate, avg_win=avg_win, avg_loss=avg_loss,
        profit_factor=profit_factor, gross_win=gross_win, gross_loss=gross_loss,
        total_net_pnl=pnls.sum(), gapped_stop_count=gapped,
        exit_reason_breakdown=reasons,
        open_at_cutoff_count=len(open_at_cutoff),
        open_at_cutoff_unrealized_pnl=sum(t.net_pnl for t in open_at_cutoff),
    )


def full_report(trades, data, start_capital, period_start, period_end) -> dict:
    trades_in_period = [t for t in trades if t.exit_date is not None
                         and period_start <= t.entry_date <= period_end]
    trades_in_period.sort(key=lambda t: t.exit_date)
    eq = build_equity_curve(trades_in_period, data, start_capital, period_start, period_end)
    dd, peak, trough = max_drawdown(eq) if len(eq) else (float("nan"), None, None)
    mret = monthly_returns(eq) if len(eq) else pd.Series(dtype=float)
    report = trade_stats(trades_in_period)
    report.update(dict(
        cagr=cagr(eq) if len(eq) else float("nan"),
        max_drawdown=dd, dd_peak_date=str(peak), dd_trough_date=str(trough),
        exposure=exposure(eq.index, trades_in_period, period_start, period_end) if len(eq) else float("nan"),
        worst_losing_streak=worst_losing_streak(trades_in_period),
        monthly_returns={str(k.date()): v for k, v in mret.items()},
        start_equity=eq.iloc[0] if len(eq) else start_capital,
        end_equity=eq.iloc[-1] if len(eq) else start_capital,
        n_sessions=len(eq),
    ))
    return report, eq
