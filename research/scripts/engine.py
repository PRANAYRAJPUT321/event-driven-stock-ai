"""
Donchian-ATR trend breakout backtest engine (long-only, NSE cash delivery).

Rules implemented exactly per ../STRATEGY_SPEC.md:
  - Signals computed only from data through session T's close.
  - Entries/exits executed no earlier than session T+1's open.
  - Hard ATR stop-loss checked on subsequent sessions' High/Low, with a
    gap-through-open fill model (never assumes fill at the stop price when
    the market gaps past it).
  - Risk-based position sizing, per-position value cap, max concurrent
    positions.
  - Line-item transaction costs + slippage on every fill via costs.py.

This module is data-source agnostic: feed it a dict[symbol -> DataFrame]
with columns Date, Open, High, Low, Close, Volume (Date sorted ascending,
one row per trading session, no forward-filled/synthetic rows).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from costs import apply_slippage, leg_costs

DONCHIAN_ENTRY_N = 20
DONCHIAN_EXIT_N = 10
ATR_N = 14
ATR_STOP_MULT = 2.0
RISK_PCT_OF_EQUITY = 0.015       # 1.5% of CURRENT book equity, not a fixed rupee amount
MAX_POSITION_VALUE = 18000.0     # 5 * 18,000 = 90,000 <= 1,00,000 capital, leaving headroom for costs
MAX_CONCURRENT_POSITIONS = 5
STARTING_CAPITAL = 100_000.0


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values("Date").reset_index(drop=True).copy()
    prev_close = df["Close"].shift(1)
    tr = pd.concat(
        [
            df["High"] - df["Low"],
            (df["High"] - prev_close).abs(),
            (df["Low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.ewm(alpha=1 / ATR_N, adjust=False, min_periods=ATR_N).mean()
    df["atr14"] = atr
    df["donchian_high_prior20"] = df["High"].rolling(DONCHIAN_ENTRY_N).max().shift(1)
    # BUG FIX (caught in review before any results were reported): a rolling
    # min that INCLUDES today's own Low can never exceed today's Close (Close
    # >= Low always), which made "Close < rolling_min_incl_today" tautologically
    # false -- the channel exit could never fire, at all, ever. Correct
    # Donchian channel exit compares today's close against the low of the
    # PRIOR N sessions only (mirrors the entry channel's own shift(1)).
    df["donchian_low_prior10"] = df["Low"].rolling(DONCHIAN_EXIT_N).min().shift(1)
    df["entry_signal"] = (df["Close"] >= df["donchian_high_prior20"]) & df["atr14"].notna()
    df["exit_signal"] = df["Close"] < df["donchian_low_prior10"]
    return df


@dataclass
class Trade:
    symbol: str
    signal_date: pd.Timestamp
    entry_date: pd.Timestamp
    entry_fill: float
    shares: int
    stop_price: float
    entry_costs: float
    exit_date: pd.Timestamp = None
    exit_fill: float = None
    exit_reason: str = None
    exit_costs: float = None
    gapped_stop: bool = False

    @property
    def gross_pnl(self):
        return (self.exit_fill - self.entry_fill) * self.shares

    @property
    def net_pnl(self):
        return self.gross_pnl - self.entry_costs - self.exit_costs


def run_backtest(data: dict[str, pd.DataFrame], starting_capital: float = STARTING_CAPITAL) -> list[Trade]:
    """
    data: symbol -> DataFrame with indicators already added (add_indicators).
    Cross-symbol event-driven loop over the UNION of all trading dates so the
    concurrent-position cap AND the available-cash constraint are true
    portfolio-level constraints, not decided independently per symbol. A
    signal is sized down (or skipped, if cash can't cover even 1 share) by
    actual available cash -- the backtest can never spend money it doesn't
    have, unlike a naive per-trade risk-budget sizer that ignores how many
    other positions are already open. Queued signals that can't fill the
    very next time their symbol trades are dropped (stale), never carried
    forward indefinitely and never filled on a later, unrelated bar.
    """
    cash = starting_capital
    idx = {sym: df.set_index("Date") for sym, df in data.items()}
    all_dates = sorted(set().union(*[set(df.index) for df in idx.values()]))
    date_pos = {d: i for i, d in enumerate(all_dates)}

    open_positions: dict[str, dict] = {}
    closed_trades: list[Trade] = []
    # symbol -> (signal_date, atr_at_signal, target_fill_date_index)
    pending_entries: dict[str, tuple] = {}
    pending_exits: dict[str, int] = {}  # symbol -> target_fill_date_index

    def next_trading_date_index(sym: str, from_i: int) -> int | None:
        """Index into all_dates of the first date > all_dates[from_i] on which sym trades."""
        sym_dates = idx[sym].index
        for j in range(from_i + 1, len(all_dates)):
            if all_dates[j] in sym_dates:
                return j
        return None

    for i, date in enumerate(all_dates):
        # 1) Fill queued entries targeted for today
        for sym in list(pending_entries.keys()):
            signal_date, atr_at_signal, target_i = pending_entries[sym]
            if target_i != i:
                continue
            del pending_entries[sym]
            if sym in open_positions or len(open_positions) >= MAX_CONCURRENT_POSITIONS:
                continue
            row = idx[sym].loc[date]
            fill = apply_slippage(row["Open"], "buy")
            stop_price = fill - ATR_STOP_MULT * atr_at_signal
            risk_per_share = fill - stop_price
            if risk_per_share <= 0:
                continue
            # Risk-per-trade is a % of CURRENT book equity (cash + cost basis
            # of open positions), not a fixed rupee amount. This is what any
            # real risk-managed account does and it self-delevers a losing
            # streak instead of holding position size constant while capital
            # shrinks underneath it (which would understate real risk).
            open_cost_basis = sum(p["trade"].shares * p["trade"].entry_fill for p in open_positions.values())
            book_equity = cash + open_cost_basis
            risk_budget = RISK_PCT_OF_EQUITY * book_equity
            shares = math.floor(risk_budget / risk_per_share)
            shares = min(shares, math.floor(MAX_POSITION_VALUE / fill))
            # Hard cash constraint: never spend money the book doesn't have.
            # Solve shares*fill*(1+worst-case cost rate) <= cash conservatively
            # by iterating down from the desired size (cheap: shares is small).
            while shares > 0:
                turnover = shares * fill
                costs = leg_costs(turnover, "buy").total
                if turnover + costs <= cash:
                    break
                shares -= 1
            if shares <= 0:
                continue
            turnover = shares * fill
            costs = leg_costs(turnover, "buy").total
            cash -= (turnover + costs)
            open_positions[sym] = dict(
                trade=Trade(
                    symbol=sym, signal_date=signal_date, entry_date=date,
                    entry_fill=fill, shares=shares, stop_price=stop_price,
                    entry_costs=costs,
                ),
                sessions_held=0,
            )

        # 2) Fill queued channel exits targeted for today
        for sym in list(pending_exits.keys()):
            target_i = pending_exits[sym]
            if target_i != i:
                continue
            del pending_exits[sym]
            if sym not in open_positions:
                continue
            row = idx[sym].loc[date]
            pos = open_positions.pop(sym)
            fill = apply_slippage(row["Open"], "sell")
            trade: Trade = pos["trade"]
            trade.exit_date, trade.exit_fill = date, fill
            trade.exit_reason, trade.gapped_stop = "channel_exit", False
            trade.exit_costs = leg_costs(trade.shares * fill, "sell").total
            cash += (trade.shares * fill - trade.exit_costs)
            closed_trades.append(trade)

        # 3) Stop-loss check on remaining open positions using today's bar.
        # NOTE: an earlier version of this engine also force-closed any
        # position still open after TIME_STOP_SESSIONS (60 sessions, ~3
        # months), intended purely as bookkeeping so no trade could be
        # silently dropped as "still open at data end". In practice that cap
        # was short enough to routinely bind BEFORE the 10-session channel
        # exit ever could on a genuinely trending winner, so it was silently
        # amputating the exact "let winners run" tail that a Donchian/ATR
        # system's positive expectancy depends on (confirmed: 0 of 605 trades
        # exited via the channel in the first run, all via stop or time-stop).
        # That is a real implementation bug relative to this strategy's own
        # stated design, caught in review before any results were reported,
        # and fixed here by removing the mid-trade time cap entirely; open
        # positions are instead closed exactly once, after the main loop, on
        # the last date any data exists (see below) -- restoring the
        # bookkeeping guarantee without truncating live trades.
        for sym in list(open_positions.keys()):
            if date not in idx[sym].index:
                continue
            trade: Trade = open_positions[sym]["trade"]
            if date <= trade.entry_date:
                continue
            row = idx[sym].loc[date]
            open_positions[sym]["sessions_held"] += 1
            stop = trade.stop_price
            if row["Open"] <= stop:
                fill, gapped, reason = apply_slippage(row["Open"], "sell"), True, "stop_gap"
            elif row["Low"] <= stop <= row["High"]:
                fill, gapped, reason = apply_slippage(stop, "sell"), False, "stop_touch"
            else:
                continue
            del open_positions[sym]
            trade.exit_date, trade.exit_fill = date, fill
            trade.exit_reason, trade.gapped_stop = reason, gapped
            trade.exit_costs = leg_costs(trade.shares * fill, "sell").total
            cash += (trade.shares * fill - trade.exit_costs)
            closed_trades.append(trade)

        # 4) After today's close: raise fresh signals, queue for the symbol's next trading date
        for sym, df in idx.items():
            if date not in df.index:
                continue
            row = df.loc[date]
            nxt = next_trading_date_index(sym, i)
            if nxt is None:
                continue
            if sym in open_positions:
                if bool(row["exit_signal"]) and sym not in pending_exits:
                    pending_exits[sym] = nxt
            else:
                if bool(row["entry_signal"]) and sym not in pending_entries:
                    pending_entries[sym] = (date, float(row["atr14"]), nxt)

    # Bookkeeping close-out: anything still open when the data simply ends is
    # not a strategy exit signal -- mark it distinctly (reason="data_end")
    # rather than mixing it into stop/channel exit statistics, and use the
    # symbol's own last available close as the fill (no slippage model
    # applies -- this never happened in the market, it's a backtest-only
    # artifact of the data window ending).
    last_date_for = {sym: df.index.max() for sym, df in idx.items()}
    for sym, pos in list(open_positions.items()):
        trade: Trade = pos["trade"]
        last_date = last_date_for[sym]
        last_close = idx[sym].loc[last_date, "Close"]
        trade.exit_date, trade.exit_fill = last_date, last_close
        trade.exit_reason, trade.gapped_stop = "data_end", False
        trade.exit_costs = leg_costs(trade.shares * last_close, "sell").total
        closed_trades.append(trade)

    return closed_trades
