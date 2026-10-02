# Session 6 — Global/Crypto Heatmaps, 10 Interlinked Features, Visual Polish

## Why

The app was one strong core loop (event → classification → scoring →
recommendation) with little around it. This session broadens it into a fuller
market-intelligence platform without turning it into a pile of disconnected
pages — every new feature reuses or feeds data another feature already has.

## New external data

- **Global indices** — Twelve Data `/quote` (free tier, batch request).
  Needs `TWELVE_DATA_API_KEY` added to Vercel — without it the indices tab
  reports a clear "not configured" warning rather than crashing.
- **Crypto** — CoinGecko `/coins/markets`, free, no key required.

Both write into one new table, `market_snapshots` (migration
`006_markets_and_portfolio.sql`), refreshed via a manual "Refresh Markets"
button — same pattern as the existing news-fetch flow, not polled per page
view.

## The 10 features

1. **Global Indices Heatmap** (`/markets`)
2. **Crypto Heatmap** (`/markets`, second tab)
3. **Sector Heatmap** (Dashboard) — aggregates this user's own analysis
   history by sector
4. **Watchlist Alerts** — sector-relevant events since a stock was watched,
   shown per-row and as a nav badge
5. **Paper Portfolio** — "Simulate" a recommended stock from any event
   detail page; new `portfolio_positions` table
6. **Track Record / Calibration** (Dashboard) — how simulated BUY/HOLD/AVOID
   calls actually moved, against this project's own deterministic price
   model (honest, unbiased simulation — not tautological)
7. **Global-Market Context** on event detail — shown only for
   GLOBAL_MARKET_SHOCK / CURRENCY / OIL_PRICE classified events
8. **Command Palette** extended with Markets/Portfolio jump targets
9. **Market Ticker** now interleaves live market data with news, and every
   item is clickable (previously news-only, non-interactive)
10. **Animation/hover/responsiveness pass** — shared `.tile-hover` and
    `.skeleton` utilities, `prefers-reduced-motion` support, fixed 3-column
    stat grids that didn't fit mobile

## Verification

Each of the 6 build steps was independently verified: `npx tsc --noEmit`,
`npm run build` (both with `.env.local` present and removed entirely, to
keep replicating the Vercel missing-env-var failure mode from earlier
sessions), and a final Playwright pass at both 1280px and 375px viewports —
zero console/page errors.

## Not changed / open items

- `TWELVE_DATA_API_KEY` still needs to be obtained and added to Vercel for
  the indices tab to populate.
- Migration `006_markets_and_portfolio.sql` needs to be run against the live
  Supabase project, same as every prior migration.
- Track record numbers are against simulated (mock) prices, clearly labeled
  as such — this project's Stage 1 has no live price feed by design.
