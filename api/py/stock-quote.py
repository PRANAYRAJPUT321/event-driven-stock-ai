"""
Vercel Python Function: live stock quote, fundamentals, and analyst view.

GET /api/py/stock-quote?symbol=RELIANCE

Calls Yahoo Finance's unofficial quoteSummary endpoint directly via
`requests` (not the yfinance package — yfinance wraps this same endpoint but
drags in pandas/numpy, which is unnecessary weight for a single JSON call
and risks Vercel's serverless function size limit).

This is informational data only. It is deliberately NOT wired into this
project's deterministic opportunity-score calculation (see
lib/scoring/scoreCalculator.ts / app/api/analyze/route.ts) — mixing live,
variable data into that engine would break the "AI never invents/uses
numbers it wasn't given deterministically" guarantee the scoring system was
built around.

Yahoo Finance is unofficial and undocumented: field names and availability
can change without notice. Every field is read defensively; a missing field
becomes null in the response rather than a crash, but total failure (bad
symbol, network error, unexpected response shape) returns a real HTTP error
with a clear message — never a silently empty "success".
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import requests

YAHOO_MODULES = "price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend"
TIMEOUT_SECONDS = 8


def _raw(d, *path):
    """Walk a dict path, unwrapping Yahoo's {"raw": ..., "fmt": ...} value
    shape. Returns None if any key along the path is missing."""
    cur = d
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    if isinstance(cur, dict) and "raw" in cur:
        return cur["raw"]
    return cur


def fetch_quote(symbol: str):
    yahoo_symbol = symbol if symbol.upper().endswith(".NS") else f"{symbol.upper()}.NS"
    url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{yahoo_symbol}"

    response = requests.get(
        url,
        params={"modules": YAHOO_MODULES},
        headers={"User-Agent": "Mozilla/5.0 (compatible; PulseStockApp/1.0)"},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Yahoo Finance returned HTTP {response.status_code}")

    payload = response.json()
    summary = payload.get("quoteSummary") or {}
    if summary.get("error"):
        raise RuntimeError(f"Yahoo Finance error: {summary['error']}")

    results = summary.get("result") or []
    if not results:
        raise RuntimeError(f"No data found for symbol '{yahoo_symbol}' — check the ticker is NSE-listed")

    result = results[0]
    price = result.get("price") or {}
    summary_detail = result.get("summaryDetail") or {}
    key_stats = result.get("defaultKeyStatistics") or {}
    financial = result.get("financialData") or {}
    trend_entries = (result.get("recommendationTrend") or {}).get("trend") or []
    latest_trend = trend_entries[0] if trend_entries else {}

    return {
        "symbol": symbol.upper(),
        "yahooSymbol": yahoo_symbol,
        "name": price.get("shortName") or price.get("longName"),
        "currency": price.get("currency"),
        "price": _raw(price, "regularMarketPrice"),
        "changePct": _raw(price, "regularMarketChangePercent"),
        "marketCap": _raw(price, "marketCap") or _raw(summary_detail, "marketCap"),
        "peRatio": _raw(summary_detail, "trailingPE"),
        "pbRatio": _raw(key_stats, "priceToBook"),
        "dividendYield": _raw(summary_detail, "dividendYield"),
        "week52High": _raw(summary_detail, "fiftyTwoWeekHigh"),
        "week52Low": _raw(summary_detail, "fiftyTwoWeekLow"),
        "analystRecommendationKey": financial.get("recommendationKey"),
        "analystRecommendationMean": _raw(financial, "recommendationMean"),
        "analystCount": _raw(financial, "numberOfAnalystOpinions"),
        "targetMean": _raw(financial, "targetMeanPrice"),
        "targetHigh": _raw(financial, "targetHighPrice"),
        "targetLow": _raw(financial, "targetLowPrice"),
        "recommendationBreakdown": {
            "strongBuy": latest_trend.get("strongBuy"),
            "buy": latest_trend.get("buy"),
            "hold": latest_trend.get("hold"),
            "sell": latest_trend.get("sell"),
            "strongSell": latest_trend.get("strongSell"),
        },
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        symbol = (query.get("symbol", [""])[0] or "").strip()

        if not symbol:
            self._send_json(400, {"error": "Missing required query param: symbol"})
            return

        try:
            data = fetch_quote(symbol)
            self._send_json(200, data)
        except requests.Timeout:
            self._send_json(504, {"error": "Yahoo Finance request timed out"})
        except Exception as err:  # noqa: BLE001 — surface exact cause to the caller, never swallow
            self._send_json(502, {"error": str(err)})

    def _send_json(self, status: int, body: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))
