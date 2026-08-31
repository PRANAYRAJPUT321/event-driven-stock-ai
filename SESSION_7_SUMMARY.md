# Session 7 — Python-Fetched Real Stock Data, Charts, Fundamentals, Analyst Views

## Why

Everything priced/scored in the app was deterministic mock data by design.
This session adds a genuinely real-data view for any NSE-listed stock: live
price, a price history chart, real fundamentals, and analyst consensus /
price-target data — fetched with Python specifically (confirmed with the
user), from Yahoo Finance only (Screener.in has no API; scraping it was
explicitly ruled out as fragile and ToS-risky).

## What was built

- **`api/py/stock-quote.py`** and **`api/py/stock-history.py`** — new
  root-level Python serverless functions (Vercel Python runtime, declared in
  `vercel.json`), kept in a separate `api/py/` directory from Next.js's own
  `app/api/*` Node routes to avoid any path collision. Thin `requests`-based
  calls directly against Yahoo Finance's unofficial `quoteSummary` and
  `chart` endpoints — deliberately not the `yfinance` package, which wraps
  these same endpoints but drags in pandas/numpy for no benefit here.
- **`app/stocks/[symbol]/page.tsx`** — new stock profile page (the
  `app/stocks/` directory existed empty since Session 1). Price header,
  6-month price chart (recharts — a dependency since day one, used nowhere
  until now), fundamentals grid, analyst view panel (consensus rating,
  analyst count, price targets vs. current price), symbol search for any
  NSE ticker, and "Add to Watchlist" for symbols in the seeded universe.
- **Cross-links** — every stock symbol shown anywhere in the app (event
  detail's stock table, watchlist rows, portfolio positions) now links to
  its live profile page.

## Explicitly not changed

`lib/market/mockData.ts` and the scoring engine
(`lib/scoring/scoreCalculator.ts`, `app/api/analyze/route.ts`) are untouched.
Real Yahoo data is an additional informational view only — not wired into
the opportunity-score calculation, preserving the project's existing
"AI never invents/uses numbers it wasn't given deterministically" guarantee.

## Verification and known risk

- `npx tsc --noEmit` and `npm run build` (20/20 routes) after every step,
  with and without `.env.local` present.
- The Python parsing logic (`fetch_quote`, `fetch_history`) was tested
  locally against realistic mocked Yahoo Finance response payloads —
  full quote, a price-history gap (null close), and an empty-result error
  path all verified correct.
- **Not yet tested against the real Yahoo Finance endpoint or Vercel's
  Python runtime** — this sandbox's network policy blocks
  `query1.finance.yahoo.com`, and Vercel's exact config syntax for pinning
  a Python function's runtime version couldn't be verified against current
  docs from here either. Both should work once deployed (Vercel's build
  servers have normal internet access), but this is the first real
  integration test of Python-on-Vercel in this project — visit
  `/stocks/RELIANCE` (or any symbol) after deploying and report back
  whatever you see.
