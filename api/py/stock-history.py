"""
Vercel Python Function: price history for the stock profile chart.

GET /api/py/stock-history?symbol=RELIANCE&range=6mo&interval=1d

Same rationale as stock-quote.py: thin `requests` call directly against
Yahoo Finance's chart endpoint rather than pulling in yfinance/pandas.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import json
import requests

TIMEOUT_SECONDS = 8
ALLOWED_RANGES = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
ALLOWED_INTERVALS = {"1d", "1wk", "1mo"}


def fetch_history(symbol: str, range_: str, interval: str):
    yahoo_symbol = symbol if symbol.upper().endswith(".NS") else f"{symbol.upper()}.NS"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"

    response = requests.get(
        url,
        params={"range": range_, "interval": interval},
        headers={"User-Agent": "Mozilla/5.0 (compatible; PulseStockApp/1.0)"},
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Yahoo Finance returned HTTP {response.status_code}")

    payload = response.json()
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"Yahoo Finance error: {chart['error']}")

    results = chart.get("result") or []
    if not results:
        raise RuntimeError(f"No history found for symbol '{yahoo_symbol}' — check the ticker is NSE-listed")

    result = results[0]
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []

    points = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        date = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        points.append({"date": date, "close": round(close, 2)})

    return {"symbol": symbol.upper(), "yahooSymbol": yahoo_symbol, "range": range_, "interval": interval, "points": points}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        symbol = (query.get("symbol", [""])[0] or "").strip()
        range_ = (query.get("range", ["6mo"])[0] or "6mo").strip()
        interval = (query.get("interval", ["1d"])[0] or "1d").strip()

        if not symbol:
            self._send_json(400, {"error": "Missing required query param: symbol"})
            return
        if range_ not in ALLOWED_RANGES:
            self._send_json(400, {"error": f"Invalid range '{range_}'. Allowed: {sorted(ALLOWED_RANGES)}"})
            return
        if interval not in ALLOWED_INTERVALS:
            self._send_json(400, {"error": f"Invalid interval '{interval}'. Allowed: {sorted(ALLOWED_INTERVALS)}"})
            return

        try:
            data = fetch_history(symbol, range_, interval)
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
