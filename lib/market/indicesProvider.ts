export interface IndexQuote {
  symbol: string
  name: string
  region: string
  price: number
  changePct: number
}

// Major world indices to show on the heatmap. Twelve Data's free /quote
// endpoint accepts a batch of comma-separated symbols in one call — these are
// the commonly documented symbols for each index; if TWELVE_DATA_API_KEY's
// account reports one as "not found" (some accounts/plans have narrower
// index coverage), that tile is simply skipped rather than failing the
// whole fetch (see fetchGlobalIndices below).
const INDICES: { symbol: string; name: string; region: string }[] = [
  { symbol: 'NSEI', name: 'NIFTY 50', region: 'India' },
  { symbol: 'BSESN', name: 'SENSEX', region: 'India' },
  { symbol: 'SPX', name: 'S&P 500', region: 'United States' },
  { symbol: 'IXIC', name: 'Nasdaq Composite', region: 'United States' },
  { symbol: 'DJI', name: 'Dow Jones', region: 'United States' },
  { symbol: 'FTSE', name: 'FTSE 100', region: 'United Kingdom' },
  { symbol: 'GDAXI', name: 'DAX', region: 'Germany' },
  { symbol: 'FCHI', name: 'CAC 40', region: 'France' },
  { symbol: 'N225', name: 'Nikkei 225', region: 'Japan' },
  { symbol: 'HSI', name: 'Hang Seng', region: 'Hong Kong' },
]

/**
 * Pulls a batch quote for all tracked world indices from Twelve Data in a
 * single request. Free tier: 800 requests/day, 8/min — comfortably enough
 * since this is only called from a manual "Refresh Markets" action, not on
 * every page view.
 */
export async function fetchGlobalIndices(): Promise<IndexQuote[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (!apiKey) {
    throw new Error('TWELVE_DATA_API_KEY is not configured')
  }

  const symbols = INDICES.map((i) => i.symbol).join(',')
  const url = new URL('https://api.twelvedata.com/quote')
  url.searchParams.set('symbol', symbols)
  url.searchParams.set('apikey', apiKey)

  const response = await fetch(url.toString(), { cache: 'no-store' })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Twelve Data request failed (${response.status}): ${body.substring(0, 200)}`)
  }

  const data = await response.json()

  // With multiple symbols, Twelve Data returns an object keyed by symbol.
  // With a single symbol it would return the quote object directly — not
  // relevant here since we always request the full batch. Each entry may
  // itself be an error object ({ status: 'error', ... }) for a symbol the
  // account's plan doesn't cover; skip those rather than failing the batch.
  const quotes: IndexQuote[] = []
  for (const idx of INDICES) {
    const entry = data[idx.symbol]
    if (!entry || entry.status === 'error' || entry.close == null) continue
    const price = parseFloat(entry.close)
    const changePct = parseFloat(entry.percent_change)
    if (Number.isNaN(price) || Number.isNaN(changePct)) continue
    quotes.push({ symbol: idx.symbol, name: idx.name, region: idx.region, price, changePct })
  }

  return quotes
}
