/**
 * Foreign exchange from Frankfurter, which publishes the European Central
 * Bank's daily reference rates.
 *
 * Chosen because this deployment's diagnostics proved it reachable while
 * every Yahoo endpoint answers 429 and Stooq answers 404 — the currency tab
 * was showing nothing at all, and this fixes it outright rather than waiting
 * for a rate limit to lift.
 *
 * Three further things make it a better fit than what it replaces. One
 * request covers every pair, because the API takes a list of quote
 * currencies. A date range returns the whole series, so the previous close
 * and the tile's sparkline come from the same call rather than one request
 * per symbol. And it is a published reference dataset with a stable contract,
 * not an undocumented endpoint that can withdraw access.
 *
 * The limits are worth stating. These are ECB reference rates, fixed once per
 * European working day — correct, but not intraday, so a tile sourced here is
 * "today's fixing against yesterday's", not a live tick. The ECB list is also
 * finite: AED is not in it, and the dollar index is not a currency pair at
 * all, so both are left to the other providers.
 */

import type { MarketQuote, TrackedSymbol } from './yahooFinance'

const HOST = 'https://api.frankfurter.app'
const TIMEOUT_MS = 7000
/** Enough days to draw a line and survive a long weekend. */
const WINDOW_DAYS = 12

/**
 * The pairs this provider can serve, mapped to the Yahoo-style symbols the
 * rest of the app already uses so nothing downstream has to change.
 *
 * `invert` marks a pair quoted the other way round by the ECB: it publishes
 * INR per EUR, so EUR/INR is direct, while USD/INR has to be derived.
 */
interface Pair {
  symbol: string
  name: string
  /** The ECB currency this pair is priced in terms of. */
  base: string
  quote: string
}

const PAIRS: Pair[] = [
  { symbol: 'USDINR=X', name: 'USD/INR', base: 'USD', quote: 'INR' },
  { symbol: 'EURINR=X', name: 'EUR/INR', base: 'EUR', quote: 'INR' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', base: 'GBP', quote: 'INR' },
  { symbol: 'JPYINR=X', name: 'JPY/INR', base: 'JPY', quote: 'INR' },
  { symbol: 'CNYINR=X', name: 'CNY/INR', base: 'CNY', quote: 'INR' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', base: 'EUR', quote: 'USD' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', base: 'GBP', quote: 'USD' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', base: 'USD', quote: 'JPY' },
]

/** Symbols this provider covers, so a caller can skip them elsewhere. */
export const FRANKFURTER_SYMBOLS = new Set(PAIRS.map((p) => p.symbol))

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

interface Series {
  /** date -> rate, oldest first. */
  points: { date: string; rate: number }[]
}

/**
 * One request per base currency, covering every pair quoted against it.
 *
 * The ECB publishes rates relative to a base, so the pairs are grouped by
 * base and each group costs a single call — four requests for eight pairs,
 * and the responses carry the full history the tiles need.
 */
async function fetchSeriesByBase(
  base: string,
  quotes: string[]
): Promise<Map<string, Series>> {
  const url =
    `${HOST}/${isoDaysAgo(WINDOW_DAYS)}..?from=${encodeURIComponent(base)}` +
    `&to=${encodeURIComponent(quotes.join(','))}`

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 900 },
  })
  if (!response.ok) throw new Error(`Frankfurter returned HTTP ${response.status}`)

  const body = await response.json()
  const rates: Record<string, Record<string, number>> = body?.rates ?? {}

  const out = new Map<string, Series>()
  for (const quote of quotes) out.set(quote, { points: [] })

  // Object key order is not a contract; sort the dates explicitly.
  for (const date of Object.keys(rates).sort()) {
    for (const quote of quotes) {
      const rate = rates[date]?.[quote]
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        out.get(quote)!.points.push({ date, rate })
      }
    }
  }
  return out
}

/**
 * Live-ish quotes for every pair this provider covers.
 *
 * Never throws: a failed base costs its pairs, not the whole set, which keeps
 * the currency tab partially populated rather than empty.
 */
export async function fetchFxQuotes(
  tracked: TrackedSymbol[]
): Promise<MarketQuote[]> {
  const wanted = PAIRS.filter((p) => tracked.some((t) => t.symbol === p.symbol))
  if (wanted.length === 0) return []

  const byBase = new Map<string, string[]>()
  for (const pair of wanted) {
    byBase.set(pair.base, [...(byBase.get(pair.base) ?? []), pair.quote])
  }

  const seriesByBase = new Map<string, Map<string, Series>>()
  await Promise.all(
    Array.from(byBase.entries()).map(async ([base, quotes]) => {
      try {
        seriesByBase.set(base, await fetchSeriesByBase(base, quotes))
      } catch {
        // This base's pairs are simply absent from the result.
      }
    })
  )

  const quotes: MarketQuote[] = []
  for (const pair of wanted) {
    const series = seriesByBase.get(pair.base)?.get(pair.quote)
    // One point gives a price but no move, and a move is most of what a
    // currency tile is for — so it is left out rather than shown at 0.00%.
    if (!series || series.points.length < 2) continue

    const points = series.points
    const price = points[points.length - 1].rate
    const previousClose = points[points.length - 2].rate
    const change = price - previousClose
    const trackedEntry = tracked.find((t) => t.symbol === pair.symbol)!

    quotes.push({
      symbol: pair.symbol,
      name: trackedEntry.name || pair.name,
      category: trackedEntry.category,
      price,
      previousClose,
      change,
      changePct: previousClose !== 0 ? (change / previousClose) * 100 : 0,
      currency: pair.quote,
      asOf: new Date(`${points[points.length - 1].date}T00:00:00Z`).toISOString(),
      source: 'frankfurter',
      spark: points.map((p) => p.rate),
    })
  }

  return quotes
}
