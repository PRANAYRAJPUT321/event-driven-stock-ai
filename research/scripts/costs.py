"""
Line-by-line Indian cash-equity (NSE, CNC/delivery) transaction cost model.

Every component is a separate, auditable function rather than one blended
"round-trip %" constant, per STRATEGY_SPEC.md Section 4. Rates are the
standard, widely-published retail discount-broker delivery schedule at the
time this was written -- verify against the live broker/exchange tariff
sheet before risking real capital; exchange/SEBI/govt rates change.
"""

from dataclasses import dataclass

BROKERAGE_FLAT = 20.0
BROKERAGE_PCT = 0.0003          # 0.03%
STT_PCT = 0.001                 # 0.1% delivery, both legs
EXCHANGE_TXN_PCT = 0.0000297    # 0.00297% (NSE)
SEBI_FEE_PCT = 0.000001         # 0.0001%
STAMP_DUTY_PCT = 0.00015        # 0.015%, buy side only
GST_PCT = 0.18
DP_CHARGE_FLAT = 20.0           # + GST, sell side only, per scrip per day
SLIPPAGE_PCT = 0.001            # 10 bps, both legs, adverse direction


@dataclass
class FillCosts:
    turnover: float
    brokerage: float
    stt: float
    exchange_txn: float
    sebi_fee: float
    stamp_duty: float
    gst: float
    dp_charge: float
    total: float


def brokerage(turnover: float) -> float:
    return min(BROKERAGE_FLAT, BROKERAGE_PCT * turnover)


def leg_costs(turnover: float, side: str) -> FillCosts:
    """side: 'buy' or 'sell'. turnover = shares * fill_price (post-slippage)."""
    assert side in ("buy", "sell")
    brk = brokerage(turnover)
    stt = STT_PCT * turnover
    exch = EXCHANGE_TXN_PCT * turnover
    sebi = SEBI_FEE_PCT * turnover
    stamp = STAMP_DUTY_PCT * turnover if side == "buy" else 0.0
    dp = (DP_CHARGE_FLAT * (1 + GST_PCT)) if side == "sell" else 0.0
    gst = GST_PCT * (brk + exch + sebi)
    total = brk + stt + exch + sebi + stamp + gst + dp
    return FillCosts(turnover, brk, stt, exch, sebi, stamp, gst, dp, total)


def apply_slippage(price: float, side: str) -> float:
    """Adverse slippage: buys fill higher, sells fill lower."""
    if side == "buy":
        return price * (1 + SLIPPAGE_PCT)
    return price * (1 - SLIPPAGE_PCT)
