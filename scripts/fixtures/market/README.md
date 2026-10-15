# Recorded market-data responses

Real responses from the providers the app uses in production, recorded on
9 October 2026 from a GitHub Actions runner (a cloud address, like Vercel's).
They let the market code be tested, and the app run locally, where those
hosts cannot be reached.

| File | Provider | What it holds |
|---|---|---|
| `tv-equities.json` | TradingView scanner (`india`) | Quote and fundamentals columns for the NIFTY 50 |
| `tv-tickers.json` | TradingView scanner (`global`) | Indices, commodities and currencies for the market bar |
| `tv-search.json` | TradingView symbol search | Ticker spellings for indices |
| `upstox-*.json` | Upstox v3 candles | Daily, weekly and 5-minute bars, and closes for sparklines |
| `moneycontrol-1y.json` | Moneycontrol techCharts | Daily bars (second chart source) |
| `groww-1y.json` | Groww charting service | Daily bars (third chart source) |
| `probe3.json` | All of the above | The raw probe that chose which provider serves which symbol |

`replay.cjs` serves these in place of the network:

- `npm run test:market` uses them through `respond()`.
- `node --require scripts/fixtures/market/replay.cjs` (or `NODE_OPTIONS`) patches
  `fetch` for a local `next dev`.

Any host without a recording — Yahoo, NSE, Google News, CoinGecko — is
refused with an error naming the host, rather than answered with invented
data. So a local run shows those feeds as unavailable, and some symbols
have shorter histories than they do in production.

`lib/market/data/` holds the NSE reference lists recorded in the same run:
the NIFTY 50 constituents and the full equity directory that search uses.
