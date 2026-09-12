# Donchian-ATR Trend Breakout — Backtest Report (NSE Cash Equity)

**Bottom line: REJECT for live capital. Net of realistic costs, this exact,
non-optimized strategy lost money in-sample (15.3 years) and lost more money
out-of-sample (the held-out final 12 months), while a naive equal-weight
buy-and-hold of the same universe returned +16.5% CAGR in-sample. Do not
paper-trade this parameter set as-is; see Section 6.**

Full code, data, and every intermediate artifact referenced below are in
`research/` of this repo (`STRATEGY_SPEC.md`, `scripts/`, `data/`, `output/`)
so every number here is reproducible by re-running `scripts/run_backtest.py`.

---

## 1. Exact strategy rules and execution assumptions

Full detail in `research/STRATEGY_SPEC.md`; summary:

- **Instrument scope**: NSE cash equity (delivery/CNC), long-only. **Not**
  F&O / options — see the "scope decision" note below.
- **Universe**: 48 NSE large-caps (see Section 2).
- **Entry**: 20-session Donchian breakout — buy when close ≥ the prior
  20-session high — filled at the **next session's open**, never same-bar.
- **Exit**: whichever comes first —
  - close breaks below the **prior** 10-session low (trailing channel,
    executed next open), or
  - hard stop at entry − 2×ATR(14), **static, not trailed**, filled on the
    stop-touch day using that day's Low/High, or at that day's **open** if
    the market gapped through the stop (never assumed to fill at the stop
    price on a gap).
- **Position sizing**: 1.5% of **current** book equity at risk per trade
  (not a fixed rupee number — see the bug note in Section 5), capped at
  ₹18,000 position value, capped at 5 concurrent positions, and hard-capped
  by actual available cash (the engine can never spend money it doesn't
  have).
- **Costs on every fill**: brokerage (₹20 flat or 0.03%, whichever lower),
  STT 0.1% (both legs, delivery), NSE exchange charges 0.00297%, SEBI fee
  0.0001%, stamp duty 0.015% (buy only), 18% GST on brokerage+exchange+SEBI,
  DP charge ₹20+GST (sell only), and 10 bps slippage on every fill. Full
  schedule and code in `research/scripts/costs.py`.
- **Parameters (20/10/14/2×ATR/1.5%/5 positions) are textbook Donchian/Turtle
  values, not grid-searched or optimized on this data** — pre-registered in
  `STRATEGY_SPEC.md` before any result was computed, specifically to avoid
  in-sample overfitting.

**Scope decision — cash equity, not F&O:** the brief covers Indian cash and
F&O markets and asks for defined-risk trades, never naked option selling. A
genuinely defined-risk options strategy (e.g. debit spreads) needs 5 years
of historical options-chain data (strikes, IV, bid/ask), which no source
reachable in this environment carries (see Section 2). Simulating option
premia from spot via Black-Scholes with an assumed IV would silently inject
a model assumption into every P&L number and misrepresent it as data, so
this was not done. Risk here is instead defined structurally (hard stop +
fixed risk-per-trade), which is retail-executable exactly as specified.

## 2. Data sources and validation

**This sandboxed session has no outbound internet access** to Yahoo Finance,
NSE, BSE, or any general web endpoint (confirmed by testing direct
connections and the WebFetch tool against all four — every one was rejected
by the environment's egress policy). The brief's "Yahoo Finance primary,
NSE/BSE cross-check" instruction could not be followed literally. Instead:

- **Primary source**: NSE's own official daily bhavcopy (`sec_bhavdata_full`
  report), via `tilak999/NSE-Data-bank` — a public GitHub repo whose Actions
  workflow downloads directly from `nseindia.com` daily. 4,011 daily files,
  **2010-06-10 to 2026-09-11** (i.e. current through yesterday). This is
  arguably a *stronger* primary source than Yahoo Finance for this purpose —
  it's the exchange's own settlement data, not a third-party aggregator —
  but it is a substitution from the brief's literal instruction, stated here
  explicitly rather than silently swapped in.
- **Independent cross-check source**: `Yuvraj-Singh-Bits-Pilani-Camus/Analysis-of-Nifty50`,
  a mirror of the well-known Kaggle dataset "NIFTY-50 Stock Market Data
  (2000-2021)" (uploader Vopani/rohanrao) — collected years earlier, by a
  different person, via a different pipeline, covering 2000-01-03 to
  2021-04-30. Both sources trace back to NSE, so this validates
  **scraping/collection correctness**, not exchange-side correctness — a
  real, stated limit on what the cross-check can catch.
- **Validation performed**: 5 randomly selected (symbol, date) pairs — seed
  fixed to today's date before sampling, so the sample can't be re-rolled
  after seeing results — compared field-by-field (Open/High/Low/Close/Volume)
  between the two independent sources. **All 5 matched exactly (0.00% diff on
  every field)**:

  | Symbol | Date | Open | High | Low | Close | Volume | Result |
  |---|---|---|---|---|---|---|---|
  | BAJAJ-AUTO | 2018-02-07 | 3198.30 | 3198.30 | 3125.20 | 3135.55 | 223,029 | MATCH |
  | KOTAKBANK | 2012-11-05 | 612.05 | 626.70 | 612.00 | 625.65 | 620,149 | MATCH |
  | BPCL | 2010-10-11 | 752.00 | 753.80 | 740.00 | 744.10 | 701,658 | MATCH |
  | TATASTEEL | 2021-04-05 | 862.00 | 877.85 | 837.15 | 867.75 | 30,575,986 | MATCH |
  | UPL | 2016-11-15 | 647.00 | 647.00 | 596.00 | 600.35 | 2,089,813 | MATCH |

  Full script: `research/scripts/cross_validate.py`; raw output:
  `research/output/cross_validation.csv`.

## 3. Universe selection (point-in-time rules, stated before results)

Candidate list: the 50 symbols in the Kaggle dataset's own
`stock_metadata.csv` (an externally published NIFTY50-membership snapshot,
not hand-picked). Mechanical filter, applied before any backtest ran
(`research/scripts/universe.py`):
1. Drop if the stock's own trading data has a gap of >10 sessions **relative
   to the observed trading calendar** (union of dates any universe stock
   actually traded — so a source-wide missing-file gap doesn't unfairly
   penalize individual stocks; see Section 5).
2. Drop if data ends >45 days before the window end (delisted/merged/
   renamed and never resumed under a tracked symbol).
3. Drop if average daily traded value < ₹10 crore (illiquid-for-retail-size).

**Result: 48 of 50 kept.** Dropped: `HDFC` (merged into HDFCBANK, last
trades 2023-07-12 — a real corporate action, confirms data integrity) and
`TATAMOTORS` (data ends 2025-10-23, consistent with the 2024-25 commercial-
vehicle demerger). Full detail: `research/output/universe.json`.

## 4. Results — trade stats, CAGR, drawdown, exposure, streaks

**IN-SAMPLE (2010-06-10 → 2025-09-11, 15.3 years)**

| Metric | Value |
|---|---|
| Trades | 745 closed |
| Win rate | 31.4% |
| Avg win / avg loss | ₹1,626 / −₹803 |
| Profit factor | 0.93 |
| Exit mix | 424 channel exit, 285 stop-touch, 36 gapped stop |
| CAGR | **−2.16%** |
| Max drawdown | **−60.2%** (peak 2015-01-28 → trough 2023-03-28, ~8 years underwater) |
| Exposure | 97.8% of sessions with ≥1 open position |
| Worst losing streak | 15 consecutive losers |
| Equity path | ₹1,00,000 → ₹71,615 |
| **Benchmark (equal-weight buy & hold, same 48 stocks)** | **+16.5% CAGR** |

**OUT-OF-SAMPLE (2025-09-12 → 2026-09-11, 12 months, held out, no parameter
touched after seeing this)**

| Metric | Value |
|---|---|
| Trades | 51 closed (+3 still open at cutoff, unrealized −₹434) |
| Win rate | 27.5% |
| Avg win / avg loss | ₹680 / −₹606 |
| Profit factor | 0.42 |
| Exit mix | 26 channel exit, 20 stop-touch, 5 gapped stop |
| CAGR | **−13.4%** |
| Max drawdown | −16.7% |
| Exposure | 99.2% |
| Worst losing streak | 11 consecutive losers |
| Equity path | ₹1,00,000 → ₹86,657 |
| **Benchmark (equal-weight buy & hold, same 48 stocks)** | −3.1% (a weak/down year for the universe generally) |

Monthly return distribution — IS: mean −0.09%, std 4.34%, best +14.1%, worst
−8.6%, 46.4% of months positive (n=183). OOS: mean −1.11%, std 2.37%, best
+2.4%, worst −5.0%, 33.3% of months positive (n=12). Full monthly series:
`research/output/in_sample_report.json` / `out_of_sample_report.json`
(`monthly_returns` key) and `research/output/is_equity_curve.csv` /
`oos_equity_curve.csv`.

**Interpretation**: the strategy underperformed simple buy-and-hold by ~19
points of CAGR in-sample, and lost more than the benchmark out-of-sample too.
Direction is *consistent* between IS and OOS (both net negative, both worse
than benchmark) — there's no "worked in-sample, broke out-of-sample" pattern,
which is actually a cleaner, more credible negative result than a
curve-fit-then-collapsed one would be.

## 5. Every bug, bias, and limitation found

Caught and fixed **before** any result above was accepted — kept here as a
log, not smoothed away:

1. **Over-leverage bug (fixed).** The original position sizer computed share
   count from a fixed risk budget and a value cap without ever checking
   actual cash. Five ₹25,000 positions could open simultaneously (₹1,25,000)
   against ₹1,00,000 capital, producing a mathematically impossible >100%
   drawdown on the first run. Fixed by tracking real cash and sizing down
   (or skipping) rather than ever overspending, plus lowering the per-
   position cap to ₹18,000 (5× ≤ ₹90,000, leaving headroom for costs).
2. **Fixed-rupee risk sizing (fixed).** Risking a constant ₹1,500/trade
   regardless of shrinking equity meant a losing account's *relative* risk
   per trade silently grew (₹1,500 on a ₹9,000 book = ~15%, not the intended
   1.5%), accelerating drawdowns unrealistically. Fixed: risk is now 1.5% of
   *current* book equity, which self-delevers during a losing streak, as any
   real risk-managed account would.
3. **Channel-exit tautology bug (fixed) — the most serious one.** The exit
   channel was originally defined as the 10-session low *including* today's
   own bar. Since a session's close can never be below its own low, that
   made the exit condition mathematically impossible to ever trigger — 0 of
   605 trades exited via the channel in that run. Combined with a static,
   non-trailing stop, any stock that simply never fell 2×ATR below its
   multi-year-old entry price (common for Indian large-caps across a 16-year
   bull run) never closed, freezing most of the 5 position slots by ~2015
   and leaving most of 2015–2026 — including the entire OOS year — with
   almost zero trading. Fixed by comparing today's close against the prior
   10 sessions' low (excluding today), matching the entry channel's own
   no-lookahead shape. This single fix changed total trade count from 18 to
   799 and produced the sane exit-reason mix reported in Section 4.
4. **Unadjusted stock splits/bonuses (fixed).** Raw NSE bhavcopy prices are
   not split-adjusted. TITAN's raw series shows an entry at ₹2,497 (2010)
   and an "exit" a year later at ₹209 — an 11.9x apparent loss that is
   actually a 1:10-magnitude split, not a real market move; ASIANPAINT
   showed the same pattern. Left unadjusted, every ATR/stop/channel
   calculation around a split date is corrupted, and any strategy holding
   through one registers a phantom catastrophic loss. Built an automatic
   detector (`research/scripts/adjust_splits.py`): flags an overnight price
   ratio within 4% of a clean multiple (2, 3, 5, 10, 1.5, ...) **and**
   requires turnover (price×volume) to stay within 4x across the jump before
   back-adjusting — both conditions together are the actual signature of a
   corporate action, not a coincidence a real crash could produce. Detected
   52 events across 31 symbols; the detected dates and ratios line up with
   publicly known corporate actions (e.g. INFY bonus Dec-2014 and split
   Jun-2015, TCS bonus 2018, SBI's 2014 face-value split, HDFCBANK's 2025
   split) — strong independent evidence the detector is finding real events,
   not false-firing on genuine crashes. Full log:
   `research/output/split_adjustments.json`.
5. **No lookahead / no same-bar execution (verified by construction).**
   Entry/exit channel thresholds for session T use only data through T-1 (or
   T's own OHLC for the *breakout comparison itself*, which is legitimate —
   the signal is generated after T's close, when T's full bar is known); all
   fills happen at T+1's open at the earliest. Verified by code review of
   `engine.py`, not just assumed.
6. **Stop-loss gap risk modeled, not assumed away.** 41 of 745 IS stop exits
   (5.5%) and 5 of 51 OOS stop exits (9.8%) gapped through the stop price and
   filled worse, at that session's open — the brief's specific ask.
7. **Survivorship bias — real, only partly mitigated.** The candidate
   universe is a *current-ish* (as of the Kaggle snapshot, ~2021) NIFTY50
   membership list projected backward, not a true point-in-time
   reconstruction of index membership through history. A stock that was
   in NIFTY50 for part of the window, got demoted, and languished is not
   in this universe at all; only survivors (or clean corporate-action
   successors like HDFCBANK) are. This inflates the benchmark comparison in
   Section 4 (and probably the strategy's own results, since it also only
   ever traded survivors) somewhat versus a true point-in-time backtest.
   Not fixable without a licensed point-in-time index-membership dataset,
   which is disclosed rather than glossed over.
8. **Missing ~6-week data window (upstream, not this pipeline).** All 48
   symbols are simultaneously missing bhavcopy files for 2025-05-05 to
   2025-06-20 in the primary source (a gap in the `tilak999` mirror itself,
   confirmed identical across every symbol). Falls inside the IS period.
   The backtest has no visibility into signals/stops during that ~33-session
   stretch; any position open across it effectively skipped that window's
   intraday risk. A small, disclosed blind spot, not filled with synthetic
   data.
9. **IS/OOS boundary trades are simplified.** A position open across
   2025-09-11/12 (the IS/OOS cut) is excluded from OOS reporting rather than
   split or reassigned — OOS trades are only ones that both entered and are
   evaluated entirely within the OOS window. Chosen to avoid attributing
   IS-originated P&L to the "untouched" OOS period; disclosed as a modeling
   simplification, not zero-impact.
10. **Transaction cost schedule is a standard, disclosed assumption, not a
    live-verified tariff.** Rates in `costs.py` are the widely-published
    retail discount-broker delivery schedule; exchange/SEBI/stamp-duty rates
    do change over a 16-year backtest and this uses one static schedule
    throughout rather than the exact historical rate for each year. Verify
    against your live broker's current tariff sheet before risking capital.
11. **No shorting, no options, no futures leverage modeled** — by design
    (Section 1), not an oversight, but it does mean the "F&O" half of the
    brief's scope isn't covered by any backtested number here.
12. **Slippage and cost parameters are assumptions, not fitted to this
    strategy's own realized fill data** (no live fills exist to fit to).
    10 bps slippage is a standard planning assumption for liquid large-caps;
    real slippage varies by order size, time of day, and volatility regime,
    and could be worse during the exact high-volatility stretches (2018,
    2020, 2022 drawdown years) where this strategy was already losing money.

## 6. Deployment plan and conclusion

**₹1,00,000 deployment plan, IF this were being paper-traded (it should not
be traded live — see conclusion):**
- Capital: ₹1,00,000. Risk per trade: 1.5% of current equity, ≤ ₹18,000
  position value, ≤ 5 concurrent positions (≤ ₹90,000 deployed at full book).
- Planned max loss if all 5 slots stop out cleanly at their full planned
  risk: 5 × 1.5% ≈ ₹7,500 — inside the ₹10,000 ceiling.
- **Realistic max loss is higher than the planned figure**, because gapped
  stops don't fill at the stop price: in this backtest, gapped stops
  overshot the intended loss materially on 5.5–9.8% of stop-outs. A hard
  **kill-switch is required, not optional**: stop opening new positions and
  review the system the moment realized+unrealized drawdown reaches ₹10,000
  (10% of capital) from any equity high — do not rely on the per-trade
  ₹1,500-ish planned figure as a portfolio-level guarantee, because gap risk
  and simultaneous-stop-outs (correlated large-caps often gap together on
  market-wide shocks) can breach it.
- Given Section 4's results, the honest deployment recommendation is:
  **do not deploy this exact rule set with real capital.**

**Conclusion: REJECT this specific strategy as specified.** It is not
suspicious in the way the brief warned about (no 75%+ win rate, no 5%+
monthly returns — quite the opposite, it loses money net of realistic
costs), which is itself evidence the backtest is measuring something real
rather than an artifact. But "not suspicious" is not the same as "works":
- Negative CAGR in-sample (−2.16%) **and** out-of-sample (−13.4%), both
  underperforming simple buy-and-hold of the same universe by a wide margin.
- Profit factor below 1 in both periods.
- A single-country, correlated large-cap equity universe does not give a
  Donchian/Turtle-style breakout system the market diversification its
  original design (originally traded across ~20 uncorrelated global futures
  markets) depends on for positive portfolio-level expectancy — the
  well-documented mechanism ("many whipsaw losers, funded by a few giant
  trend winners, needs enough independent bets to work") plausibly explains
  why it doesn't clear its own costs here.

This is not "needs more validation" — the validation (5-year+ window, real
IS/OOS split, real costs, real gap-risk modeling, cross-checked data) was
done, and it says no. It should not go to paper trading in its current form.
If this line of research continues, the next step is not re-tuning these
parameters on this same data (that would be exactly the p-hacking the brief
warned against) — it would be testing the *same pre-registered rule family*
on a genuinely different, diversified universe (e.g. multiple uncorrelated
NSE sector indices or a multi-asset futures set), which is a different
study, not a parameter tweak of this one.
