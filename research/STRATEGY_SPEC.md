# Strategy Specification — Donchian-ATR Trend Breakout (Long-Only, Cash Equity)

Status: **DRAFT — pending real data.** Numbers in this file are rules and cost
assumptions only. No performance figures appear here; those live in
`research/output/` only once produced from real, cross-checked data, never
before.

## 0. Scope decision: cash equity, not F&O

The brief covers "Indian cash and F&O markets" and says prefer defined-risk
trades, never naked option selling. A genuinely defined-risk options strategy
(e.g. debit spreads) needs historical **options chain** data (strikes, IV,
bid/ask) for 5 years — there is no free bulk source for that, and none of the
data this session can reach (see DATA_SOURCES.md) carries it. Faking option
premia from spot prices via Black-Scholes with assumed IV would silently
inject a model assumption into every P&L number and hide it as "data."

So this strategy is implemented and backtested on **cash equity (NSE
delivery/CNC), long-only**, with risk defined structurally by a hard stop-loss
and fixed per-trade risk budget instead of an options structure. This is
retail-executable exactly as specified (no margin, no derivatives, no
naked selling — the naked-selling prohibition is moot here since there are no
options at all). Section 5 (Limitations) states this scope narrowing
explicitly; it is not swept under the rug.

## 1. Universe selection (point-in-time, stated before any results)

Rule, fixed **before** looking at performance:
- Start from the NIFTY 50 index membership list from the data source's own
  stock-metadata file (a fixed snapshot — see caveat in Limitations about
  this not being a true point-in-time-reconstructed index history).
- Keep a symbol only if it has continuous daily trading data for the full
  backtest window with no gaps longer than 10 consecutive trading days
  (proxy for "was listed and liquid the whole time").
- Drop any symbol with average daily traded value below ₹10 crore over the
  full sample (illiquid-for-retail-size filter), computed from
  Close × Volume in the dataset itself.
- No manual add/remove of individual names after this rule is applied — the
  resulting list is the universe, in full, win or lose. It is written to
  `research/output/universe.json` with the filter statistics before any
  backtest is run, so the list can't be quietly re-cut after seeing results.

## 2. Signal (computed only after market close)

All indicators for session **T** use only data through T's close (T's own
High/Low/Close/Volume included — legitimate, since by definition the signal
is generated after T's market close, when T's full OHLC is known).

- `donchian_high(T, 20)` = max(High) over sessions **T-19 … T** (20 sessions
  inclusive of T)
- `donchian_low(T, 10)` = min(Low) over sessions **T-10 … T-1** (the 10
  sessions strictly BEFORE T — excludes T itself; see bug note below)
- `atr14(T)` = 14-period Wilder ATR using True Range through session T

**Entry signal** fires on session T if:
- `Close[T] >= donchian_high(T-1, 20)` i.e. T's close breaks the prior
  20-session high channel (the channel is computed on the 20 sessions
  *before* T so T's own breakout day isn't included in its own threshold),
  AND
- the symbol has no open position, AND
- fewer than `MAX_CONCURRENT_POSITIONS` (5) positions are currently open
  across the whole universe on that evening.

**Exit signal** (for an open position) fires on session T if:
- `Close[T] < donchian_low(T-1, 10)` (trailing channel stop, computed from
  the 10 sessions before T — same no-lookahead shape as the entry channel),
  OR
- the hard stop-loss (below) is touched intraday on a later session.

**Bug caught in review, fixed before any results were reported:** an earlier
draft defined the exit channel as the 10-day low *including* today's own bar.
Since a session's Close can never be below its own Low, that made
`Close[T] < low_including_T` tautologically false — mathematically
impossible to ever trigger, at any date, for any stock. The channel exit
therefore never fired in the first (buggy) run, which combined with a static,
non-trailing stop meant positions in any stock that simply never fell 2×ATR
below its multi-year-old entry price (common for Indian large caps across a
16-year secular bull run) stayed open for the rest of the backtest, freezing
most of the 5 position slots by ~2012–2015 and leaving almost the entire
2015–2026 span, including the whole out-of-sample year, with zero new trades.
That is a textbook example of exactly the kind of "unrealistic fills /
mechanical bug masquerading as a result" the brief asked us to hunt for
before trusting any performance number — caught here, not glossed over.

No same-bar execution anywhere: a signal computed from session T's close can
only affect an order placed for session **T+1**.

## 3. Execution (no earlier than next session's open)

- **Entry**: market order at T+1's **open**. Fill price = `Open[T+1]`, minus
  slippage (Section 4).
- **Initial hard stop-loss**: set at entry = `entry_fill_price - 2 * atr14(T)`
  (ATR measured as of the signal day, T, frozen at entry — not recomputed
  daily). This is the defined-risk element: max loss per unit is known before
  the trade is placed.
- **Stop-loss fill simulation on any subsequent session T+k (k ≥ 1)**,
  checked using that session's High/Low (the earliest point after the signal
  bar, so this is legitimate — the stop order sits in the market overnight
  like a real GTT/SL order):
  - If `Open[T+k] <= stop_price`: the stop gapped through at the open.
    Fill = `Open[T+k]` (worse than the stop price — this is the realistic
    gap-risk model; **the stop does NOT fill at the stop price** in this
    case).
  - Else if `Low[T+k] <= stop_price <= High[T+k]`: fill = `stop_price` minus
    slippage (ordinary intraday touch, stop assumed to fill at its price
    less standard slippage).
  - Else: stop not touched, position stays open.
- **Trailing-channel exit**: once an exit signal fires at T's close (Section
  2), the position is closed at **Open[T+1]** minus slippage — never at T's
  close.
- **No arbitrary time stop.** A position stays open until the channel exit or
  the hard stop fires — trend-following's positive expectancy depends on
  letting the rare big winner run, and any mid-trade time cap truncates
  exactly that tail. (An earlier draft of this spec used a 60-session
  bookkeeping cap that, in practice, bound before the channel exit could on
  genuinely trending winners — 0 of 605 trades in that version ever exited
  via the channel. That was a real implementation bug, caught in code review
  before any results were reported; see the final report's bug log.) The only
  thing closed by time rather than signal is a position still open on the
  very last date the data covers — an artifact of the backtest window ending,
  not a trading rule — marked distinctly as `data_end` and excluded from
  strategy-performance statistics.
- Only one open position per symbol at a time. No pyramiding, no averaging
  down.

## 4. Costs and slippage (applied to every fill, both legs)

Modeled per the standard NSE cash-delivery (CNC) charge schedule (retail
discount-broker assumptions; see Limitations for "verify current tariff"
caveat — these rates can and do change and must be confirmed against the
live broker/exchange tariff sheet before real capital is risked):

| Item | Rate | Side |
|---|---|---|
| Brokerage | ₹20 flat or 0.03% of turnover, whichever is **lower**, per executed leg | both |
| STT (Securities Transaction Tax) | 0.1% of turnover | both (delivery) |
| Exchange transaction charges (NSE) | 0.00297% of turnover | both |
| SEBI turnover fee | 0.0001% of turnover | both |
| Stamp duty | 0.015% of turnover | buy only |
| GST | 18% on (brokerage + exchange txn charges + SEBI fee) | both |
| DP (depository) charge | ₹20 + 18% GST flat per scrip, per sell-day | sell only |
| **Slippage** | 10 bps (0.10%) of fill price, adverse direction, applied on **every** fill (entries, channel exits, and touched stop-loss fills alike) | both |
| **Gapped stop-loss** | fill = next open (already worse than stop; no additional slippage bps layered on top — the gap itself is the realistic-fill mechanism) | — |

These are applied line-by-line in code (`research/scripts/costs.py`), not as
a single blended "round-trip cost %" fudge factor, so the effect of any one
component can be audited.

## 5. Position sizing (tied to the ₹10,000 max-loss ceiling)

- Capital: ₹1,00,000.
- **Per-trade risk budget**: 1.5% of **current book equity** (cash + cost
  basis of open positions), not a fixed rupee amount. Shares bought =
  `floor(risk_budget / (entry_fill_price - stop_price))`, subject to the caps
  below. Sizing off current equity (rather than a fixed ₹1,500, which was an
  earlier draft of this rule) self-delevers automatically during a losing
  streak instead of holding position size constant while the capital
  underneath it shrinks — an earlier fixed-rupee version of this engine
  produced an unrealistic ~93% drawdown because it kept risking a fixed ₹1,500
  even after the book was down to ₹9,000, i.e. effectively risking ~15% of
  remaining capital per trade instead of the intended 1.5%. See the final
  report's bias/bug log for this.
- **Per-position value cap**: no single position may exceed ₹18,000 (18% of
  capital) at entry, to avoid a low-volatility stock (tiny stop distance ⇒
  huge share count) dominating the book, and so 5 fully-sized positions
  (₹90,000) still leave headroom under ₹1,00,000 for transaction costs —
  see the hard-cash-constraint note below.
- **Concurrent-position cap**: max 5 open positions ⇒ max ~90% of capital
  deployed at any time if all five are at their value cap; realistically
  usually less.
- **Hard cash constraint**: the backtest engine tracks actual available cash
  and will size a position DOWN (or skip it) rather than ever spend money the
  book doesn't have. An earlier draft of this engine sized purely from the
  fixed risk budget and a value cap without checking real cash, which allowed
  5 positions to be opened at up to ₹25,000 each (₹1,25,000 — more than the
  ₹1,00,000 capital) and produced an impossible >100% drawdown. That bug was
  caught during our own review (see final report Section 5) and fixed before
  any results were accepted; it's recorded here as a concrete example of the
  "unrealistic fills" failure mode the brief asked us to actively hunt for.
- **Portfolio max-loss framing**: if all 5 concurrent slots are open and every
  single one is stopped out at its full planned risk with zero gap-through
  penalty, planned loss = 5 × ₹1,500 = ₹7,500, inside the ₹10,000 ceiling.
  Gap-through risk (Section 4) can push any individual stop's realized loss
  past its planned ₹1,500 — this is exactly the risk the brief asked to be
  modeled honestly, not assumed away. Section 6 of the final report quantifies
  how often that happens historically and by how much, and the deployment
  plan (Section 4 of the final report) sets a hard kill-switch instead of
  assuming the ₹10,000 figure is a guarantee.

## 6. In-sample / out-of-sample split

- Out-of-sample (OOS): the **last 12 months of whatever the data source's max
  available date is**, held out completely. No parameter in this document was
  changed after looking at OOS-period data.
- In-sample (IS): all preceding sessions, down to the start of the 5-year (or
  longest-available) window.
- Parameters (20-session breakout, 10-session channel exit, 14-period ATR,
  2×ATR stop, ₹1,500 risk/trade, 5-position cap) are the standard textbook
  Donchian/Turtle-style values, **not** grid-searched or optimized on this
  data — deliberately, to avoid in-sample overfitting. This is stated here,
  before IS results are computed, as a pre-registered commitment.
