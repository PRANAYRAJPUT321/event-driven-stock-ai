# Monte Carlo VaR — NSE portfolio

Standalone engine: one-day Value-at-Risk and CVaR (Expected Shortfall) for a
five-stock NSE portfolio, from two years of daily data and 10,000 simulated paths.

## Method

1. Pull ~2y of daily adjusted closes for each `.NS` ticker (Yahoo Finance chart API).
2. Daily log returns → mean vector μ and covariance Σ.
3. Draw 10,000 correlated return vectors: `r = μ + L·z` with `L = cholesky(Σ)`,
   `z` standard normal (or multivariate Student-t with `--dist t`).
4. Full revaluation: `P&L = V · Σ wᵢ (exp(rᵢ) − 1)`.
5. `VaR_α = −quantile(P&L, 1−α)`, `CVaR_α = −mean(P&L | P&L ≤ −VaR_α)`.

Historical-simulation VaR/CVaR on the same window is printed alongside as a cross-check.

## Run

```bash
pip install -r quant/requirements.txt
python quant/monte_carlo_var.py                       # RELIANCE TCS HDFCBANK INFY ICICIBANK, equal weights, ₹10L
python quant/monte_carlo_var.py --tickers SBIN ITC LT BHARTIARTL AXISBANK \
       --weights 0.3 0.2 0.2 0.15 0.15 --value 2500000
python quant/monte_carlo_var.py --dist t --df 5       # fat tails
python quant/monte_carlo_var.py --csv prices.csv      # offline: date column + one price column per stock
python quant/monte_carlo_var.py --json                # machine-readable output
python -m pytest quant -q                             # tests (synthetic data vs closed-form Gaussian VaR)
```

`--seed` (default 42) makes runs reproducible.
