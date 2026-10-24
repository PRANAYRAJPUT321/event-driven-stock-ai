"""
Monte Carlo Value-at-Risk engine for a portfolio of NSE stocks.

Pipeline
--------
1. Load ~2 years of daily adjusted closes (Yahoo Finance `.NS` tickers, or a CSV).
2. Compute daily log returns and estimate the mean vector and covariance matrix.
3. Simulate N correlated one-day return vectors via a Cholesky factor of the
   covariance (multivariate normal, or multivariate Student-t for fat tails).
4. Revalue the portfolio on each path (full revaluation: exp(r) - 1 per stock),
   giving a distribution of one-day P&L.
5. VaR_a  = -quantile(P&L, 1 - a)
   CVaR_a = -mean(P&L | P&L <= -VaR_a)      (a.k.a. Expected Shortfall)

Usage
-----
    python quant/monte_carlo_var.py
    python quant/monte_carlo_var.py --tickers RELIANCE TCS HDFCBANK INFY ICICIBANK \
        --weights 0.3 0.2 0.2 0.15 0.15 --value 1000000 --paths 10000 --seed 42
    python quant/monte_carlo_var.py --csv prices.csv     # offline: Date + one column per stock
    python quant/monte_carlo_var.py --dist t --df 5      # fat-tailed simulation
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

DEFAULT_TICKERS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"]
DEFAULT_LEVELS = (0.95, 0.99)
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
TIMEOUT_SECONDS = 15


# --------------------------------------------------------------------------- data

def fetch_nse_prices(tickers: list[str], range_: str = "2y") -> pd.DataFrame:
    """Daily adjusted closes for NSE tickers from Yahoo Finance, aligned on common dates."""
    series = {}
    for ticker in tickers:
        symbol = ticker if ticker.upper().endswith(".NS") else f"{ticker.upper()}.NS"
        response = requests.get(
            YAHOO_CHART_URL.format(symbol=symbol),
            params={"range": range_, "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0 (compatible; PulseStockApp/1.0)"},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        chart = response.json().get("chart") or {}
        if chart.get("error") or not chart.get("result"):
            raise RuntimeError(f"No data for {symbol}: {chart.get('error')}")

        result = chart["result"][0]
        indicators = result["indicators"]
        adj = (indicators.get("adjclose") or [{}])[0].get("adjclose")
        closes = adj if adj else indicators["quote"][0]["close"]
        dates = pd.to_datetime(result["timestamp"], unit="s", utc=True).tz_convert("Asia/Kolkata").normalize()
        series[ticker.upper().removesuffix(".NS")] = pd.Series(closes, index=dates.tz_localize(None), dtype=float)

    prices = pd.DataFrame(series).sort_index()
    prices = prices[~prices.index.duplicated(keep="last")]
    return prices.dropna(how="any")


def load_prices_csv(path: str) -> pd.DataFrame:
    """CSV with a date column first and one price column per stock."""
    prices = pd.read_csv(path, index_col=0, parse_dates=True).sort_index()
    return prices.dropna(how="any")


# --------------------------------------------------------------------------- engine

@dataclass
class VaRResult:
    tickers: list[str]
    weights: list[float]
    portfolio_value: float
    n_paths: int
    distribution: str
    obs: int
    start: str
    end: str
    var: dict[float, float] = field(default_factory=dict)
    cvar: dict[float, float] = field(default_factory=dict)
    hist_var: dict[float, float] = field(default_factory=dict)
    hist_cvar: dict[float, float] = field(default_factory=dict)
    sim_mean: float = 0.0
    sim_std: float = 0.0
    annual_vol: dict[str, float] = field(default_factory=dict)
    corr: pd.DataFrame | None = None


def var_cvar(pnl: np.ndarray, level: float) -> tuple[float, float]:
    """VaR and CVaR (as positive loss numbers) of a P&L sample at confidence `level`."""
    threshold = np.quantile(pnl, 1.0 - level)
    tail = pnl[pnl <= threshold]
    return float(-threshold), float(-tail.mean())


def simulate_returns(
    mu: np.ndarray,
    cov: np.ndarray,
    n_paths: int,
    rng: np.random.Generator,
    dist: str = "normal",
    df: float = 5.0,
) -> np.ndarray:
    """(n_paths, n_assets) correlated one-day log returns."""
    chol = np.linalg.cholesky(cov)
    z = rng.standard_normal((n_paths, len(mu)))
    if dist == "t":
        # Multivariate t scaled so its covariance equals `cov` (requires df > 2).
        if df <= 2:
            raise ValueError("Student-t df must be > 2 for a finite covariance")
        chi2 = rng.chisquare(df, size=(n_paths, 1))
        z = z * np.sqrt((df - 2) / chi2)
    elif dist != "normal":
        raise ValueError(f"Unknown distribution: {dist}")
    return mu + z @ chol.T


def run_var(
    prices: pd.DataFrame,
    weights: np.ndarray,
    portfolio_value: float = 1_000_000.0,
    n_paths: int = 10_000,
    levels: tuple[float, ...] = DEFAULT_LEVELS,
    dist: str = "normal",
    df: float = 5.0,
    seed: int | None = 42,
) -> VaRResult:
    weights = np.asarray(weights, dtype=float)
    if len(weights) != prices.shape[1]:
        raise ValueError("One weight per stock is required")
    if not np.isclose(weights.sum(), 1.0):
        raise ValueError(f"Weights must sum to 1 (got {weights.sum():.4f})")

    log_ret = np.log(prices / prices.shift(1)).dropna()
    mu = log_ret.mean().to_numpy()
    cov = log_ret.cov().to_numpy()

    rng = np.random.default_rng(seed)
    sim = simulate_returns(mu, cov, n_paths, rng, dist=dist, df=df)
    pnl = portfolio_value * (np.expm1(sim) @ weights)

    hist_pnl = portfolio_value * (np.expm1(log_ret.to_numpy()) @ weights)

    result = VaRResult(
        tickers=list(prices.columns),
        weights=weights.tolist(),
        portfolio_value=portfolio_value,
        n_paths=n_paths,
        distribution=dist if dist == "normal" else f"student-t (df={df:g})",
        obs=len(log_ret),
        start=prices.index[0].strftime("%Y-%m-%d"),
        end=prices.index[-1].strftime("%Y-%m-%d"),
        sim_mean=float(pnl.mean()),
        sim_std=float(pnl.std(ddof=1)),
        annual_vol={t: float(v) for t, v in (log_ret.std() * np.sqrt(252)).items()},
        corr=log_ret.corr(),
    )
    for level in levels:
        result.var[level], result.cvar[level] = var_cvar(pnl, level)
        result.hist_var[level], result.hist_cvar[level] = var_cvar(hist_pnl, level)
    return result


# --------------------------------------------------------------------------- report

def inr(x: float) -> str:
    return f"₹{x:,.0f}"


def format_report(r: VaRResult) -> str:
    lines = [
        "Monte Carlo VaR — NSE portfolio",
        "=" * 64,
        f"Data window     : {r.start} → {r.end}  ({r.obs} daily returns)",
        f"Portfolio value : {inr(r.portfolio_value)}",
        f"Simulation      : {r.n_paths:,} paths, {r.distribution}, 1-day horizon",
        "",
        f"{'Stock':<12}{'Weight':>8}{'Ann. vol':>11}",
    ]
    for t, w in zip(r.tickers, r.weights):
        lines.append(f"{t:<12}{w:>8.1%}{r.annual_vol[t]:>11.1%}")

    lines += ["", "Correlation of daily log returns:", r.corr.round(2).to_string(), ""]
    lines.append(f"{'Level':<8}{'MC VaR':>14}{'MC CVaR':>14}{'Hist VaR':>14}{'Hist CVaR':>14}")
    for level in r.var:
        lines.append(
            f"{level:<8.0%}"
            f"{inr(r.var[level]):>14}{inr(r.cvar[level]):>14}"
            f"{inr(r.hist_var[level]):>14}{inr(r.hist_cvar[level]):>14}"
        )
    lines.append("")
    for level in r.var:
        lines.append(
            f"{level:.0%}: VaR {r.var[level] / r.portfolio_value:.2%}, "
            f"CVaR {r.cvar[level] / r.portfolio_value:.2%} of portfolio value"
        )
    lines += [
        "",
        f"Simulated 1-day P&L: mean {inr(r.sim_mean)}, std {inr(r.sim_std)}",
        "VaR/CVaR are losses (positive = money lost). Hist = historical simulation on the same window.",
    ]
    return "\n".join(lines)


def to_json(r: VaRResult) -> str:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tickers": r.tickers,
        "weights": r.weights,
        "portfolio_value": r.portfolio_value,
        "paths": r.n_paths,
        "distribution": r.distribution,
        "window": {"start": r.start, "end": r.end, "observations": r.obs},
        "monte_carlo": {f"{l:.0%}": {"var": r.var[l], "cvar": r.cvar[l]} for l in r.var},
        "historical": {f"{l:.0%}": {"var": r.hist_var[l], "cvar": r.hist_cvar[l]} for l in r.var},
    }
    return json.dumps(payload, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Monte Carlo 1-day VaR / CVaR for NSE stocks")
    parser.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS, help="NSE symbols (without .NS)")
    parser.add_argument("--weights", nargs="+", type=float, help="Portfolio weights (default: equal)")
    parser.add_argument("--value", type=float, default=1_000_000.0, help="Portfolio value in INR")
    parser.add_argument("--paths", type=int, default=10_000)
    parser.add_argument("--range", dest="range_", default="2y", help="Yahoo history range (default 2y)")
    parser.add_argument("--csv", help="Load prices from CSV instead of Yahoo Finance")
    parser.add_argument("--dist", choices=["normal", "t"], default="normal")
    parser.add_argument("--df", type=float, default=5.0, help="Student-t degrees of freedom")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a text report")
    args = parser.parse_args()

    if args.csv:
        prices = load_prices_csv(args.csv)
    else:
        prices = fetch_nse_prices(args.tickers, args.range_)

    n = prices.shape[1]
    weights = np.array(args.weights) if args.weights else np.full(n, 1.0 / n)

    result = run_var(
        prices, weights, portfolio_value=args.value, n_paths=args.paths,
        dist=args.dist, df=args.df, seed=args.seed,
    )
    print(to_json(result) if args.json else format_report(result))


if __name__ == "__main__":
    main()
