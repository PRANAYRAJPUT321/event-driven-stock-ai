"""
Sanity tests for the Monte Carlo VaR engine using synthetic prices with a known
covariance, so MC results can be checked against closed-form Gaussian VaR/CVaR.

    python -m pytest quant/test_monte_carlo_var.py -q
"""

import numpy as np
import pandas as pd
import pytest
from scipy.stats import norm

from monte_carlo_var import run_var, var_cvar


def synthetic_prices(n_days=500, seed=0):
    rng = np.random.default_rng(seed)
    vols = np.array([0.015, 0.012, 0.014, 0.016, 0.018])
    corr = np.full((5, 5), 0.4) + 0.6 * np.eye(5)
    cov = np.outer(vols, vols) * corr
    rets = rng.multivariate_normal(np.zeros(5), cov, size=n_days)
    prices = 1000 * np.exp(np.cumsum(rets, axis=0))
    idx = pd.bdate_range("2024-09-26", periods=n_days)
    return pd.DataFrame(prices, index=idx, columns=["A", "B", "C", "D", "E"])


def test_var_cvar_on_known_sample():
    pnl = np.arange(-100, 0, dtype=float)  # 100 losses: -100 .. -1
    var, cvar = var_cvar(pnl, 0.95)
    assert var == pytest.approx(95.05, abs=0.1)
    assert cvar == pytest.approx(97.5, abs=0.5)


def test_mc_matches_parametric_gaussian():
    prices = synthetic_prices()
    w = np.full(5, 0.2)
    value = 1_000_000
    r = run_var(prices, w, portfolio_value=value, n_paths=200_000, seed=1)

    log_ret = np.log(prices / prices.shift(1)).dropna()
    mu_p = log_ret.mean().to_numpy() @ w
    sd_p = np.sqrt(w @ log_ret.cov().to_numpy() @ w)
    for level in (0.95, 0.99):
        z = norm.ppf(level)
        var_exact = value * (z * sd_p - mu_p)
        cvar_exact = value * (sd_p * norm.pdf(z) / (1 - level) - mu_p)
        # Small differences come from exp() revaluation vs linear returns and MC noise.
        assert r.var[level] == pytest.approx(var_exact, rel=0.03)
        assert r.cvar[level] == pytest.approx(cvar_exact, rel=0.03)


def test_invariants_and_reproducibility():
    prices = synthetic_prices()
    w = np.array([0.3, 0.2, 0.2, 0.15, 0.15])
    a = run_var(prices, w, n_paths=10_000, seed=7)
    b = run_var(prices, w, n_paths=10_000, seed=7)
    assert a.var == b.var and a.cvar == b.cvar
    assert a.var[0.99] > a.var[0.95] > 0
    for level in (0.95, 0.99):
        assert a.cvar[level] >= a.var[level]


def test_student_t_has_fatter_99_tail():
    prices = synthetic_prices()
    w = np.full(5, 0.2)
    normal = run_var(prices, w, n_paths=200_000, seed=3)
    fat = run_var(prices, w, n_paths=200_000, seed=3, dist="t", df=4)
    assert fat.cvar[0.99] > normal.cvar[0.99]


def test_rejects_bad_weights():
    with pytest.raises(ValueError):
        run_var(synthetic_prices(), np.array([0.5, 0.5, 0.5, 0.0, 0.0]))
