/**
 * Keyless live quotes from Yahoo Finance's chart endpoint.
 *
 * Why this endpoint: `query1.finance.yahoo.com/v8/finance/chart/{symbol}`
 * needs no API key, no signup and no session crumb (unlike v7/finance/quote
 * and v10/finance/quoteSummary, which now reject anonymous callers). It
 * covers indices, futures and FX with the same response shape, so one parser
 * serves every row in the market bar.
 *
 * It is an unofficial, undocumented endpoint: it can rate-limit, change field
 * names, or go away. Everything here is therefore read defensively and each
 * symbol is fetched independently via Promise.allSettled — one bad symbol
 * degrades to a missing tile, it never blanks the bar.
 *
 * Must only be called server-side (the endpoint sends no CORS headers).
 */

export type QuoteCategory = 'domestic' | 'international' | 'commodity' | 'currency'

export interface MarketQuote {
  symbol: string
  name: string
  category: QuoteCategory
  price: number
  previousClose: number
  change: number
  changePct: number
  currency: string
  /** Yahoo's timestamp for the quote, ISO-8601. */
  asOf: string | null
}

export interface TrackedSymbol {
  symbol: string
  name: string
  category: QuoteCategory
}

/**
 * The bar's contents. Domestic first — this is an Indian-equity product, so
 * NIFTY/SENSEX should be what a user sees before the marquee moves.
 */
export const TRACKED_SYMBOLS: TrackedSymbol[] = [
  // Domestic (India)
  { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic' },
  { symbol: '^BSESN', name: 'SENSEX', category: 'domestic' },
  { symbol: '^NSEBANK', name: 'BANK NIFTY', category: 'domestic' },
  { symbol: '^CNXIT', name: 'NIFTY IT', category: 'domestic' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX', category: 'domestic' },

  // International
  { symbol: '^GSPC', name: 'S&P 500', category: 'international' },
  { symbol: '^IXIC', name: 'NASDAQ', category: 'international' },
  { symbol: '^DJI', name: 'DOW JONES', category: 'international' },
  { symbol: '^FTSE', name: 'FTSE 100', category: 'international' },
  { symbol: '^GDAXI', name: 'DAX', category: 'international' },
  { symbol: '^N225', name: 'NIKKEI 225', category: 'international' },
  { symbol: '^HSI', name: 'HANG SENG', category: 'international' },

  // Commodities (front-month futures)
  { symbol: 'GC=F', name: 'GOLD', category: 'commodity' },
  { symbol: 'SI=F', name: 'SILVER', category: 'commodity' },
  { symbol: 'CL=F', name: 'WTI CRUDE', category: 'commodity' },
  { symbol: 'BZ=F', name: 'BRENT CRUDE', category: 'commodity' },
  { symbol: 'NG=F', name: 'NAT GAS', category: 'commodity' },
  { symbol: 'HG=F', name: 'COPPER', category: 'commodity' },

  // Currency
  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' },
  { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', category: 'currency' },
]

export const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  domestic: 'India',
  international: 'Global',
  commodity: 'Commodities',
  currency: 'Currencies',
}

// Yahoo rejects requests without a browser-shaped User-Agent.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const TIMEOUT_MS = 6000

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The close of the previous trading session.
 *
 * Deriving this from the series rather than from meta is deliberate.
 * `meta.chartPreviousClose` is the close before the *requested range*, not
 * before today — so with range=5d it yields a five-day move presented as
 * "today's move". The second-to-last point of a daily series is the prior
 * session in both states that matter: mid-session the last point is today's
 * running bar, and after the close it is today's final bar.
 *
 * meta is still the fallback for instruments that return no usable series
 * (thin FX and futures feeds do this), where chartPreviousClose is the only
 * previous close on offer and a range-wide move beats no move at all.
 */
export function previousSessionClose(closes: unknown[], meta: any): number | null {
  const series = closes.map(num).filter((c): c is number => c !== null)
  if (series.length >= 2) return series[series.length - 2]
  return num(meta?.previousClose) ?? num(meta?.chartPreviousClose) ?? series[0] ?? null
}

/**
 * Yahoo's `meta` gives the last price and a previous close, but which field
 * carries the previous close varies by instrument (indices use
 * chartPreviousClose, FX and futures often only set previousClose).
 */
export function parseChart(body: any, tracked: TrackedSymbol): MarketQuote | null {
  const result = body?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return null

  const price =
    num(meta.regularMarketPrice) ??
    num(meta.previousClose) ??
    num(meta.chartPreviousClose)
  if (price === null) return null

  const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? []
  const previousClose =
    previousSessionClose(closes, meta) ?? price

  const change = price - previousClose
  // Guard the divide: a zero previous close would otherwise produce Infinity
  // and render as "Infinity%" in the bar.
  const changePct = previousClose !== 0 ? (change / previousClose) * 100 : 0

  const ts = num(meta.regularMarketTime)

  return {
    symbol: tracked.symbol,
    name: tracked.name,
    category: tracked.category,
    price,
    previousClose,
    change,
    changePct,
    currency: typeof meta.currency === 'string' ? meta.currency : '',
    asOf: ts !== null ? new Date(ts * 1000).toISOString() : null,
  }
}

async function fetchOne(tracked: TrackedSymbol, revalidateSeconds: number): Promise<MarketQuote> {
  let lastError: Error | null = null

  // query1 and query2 are independent front-ends for the same API; one being
  // rate-limited or briefly unhealthy doesn't imply the other is.
  for (const host of HOSTS) {
    const url =
      `https://${host}/v8/finance/chart/${encodeURIComponent(tracked.symbol)}` +
      `?interval=1d&range=5d`

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: revalidateSeconds },
      })
      if (!response.ok) {
        lastError = new Error(`${tracked.symbol}: HTTP ${response.status} from ${host}`)
        continue
      }
      const quote = parseChart(await response.json(), tracked)
      if (!quote) {
        lastError = new Error(`${tracked.symbol}: unexpected response shape from ${host}`)
        continue
      }
      return quote
    } catch (err: any) {
      lastError = new Error(`${tracked.symbol}: ${err?.message || 'request failed'}`)
    }
  }

  throw lastError ?? new Error(`${tracked.symbol}: no data`)
}

export interface MarketBarData {
  quotes: MarketQuote[]
  /** Symbols that failed, so the UI/logs can show partial-data honestly. */
  failed: string[]
  fetchedAt: string
}

/**
 * Fetches every tracked symbol in parallel. Never throws for a partial
 * failure — callers get whatever resolved plus the list that didn't, and only
 * an empty `quotes` array means the upstream is genuinely unavailable.
 */
export async function fetchMarketBar(revalidateSeconds = 60): Promise<MarketBarData> {
  const settled = await Promise.allSettled(
    TRACKED_SYMBOLS.map((t) => fetchOne(t, revalidateSeconds))
  )

  const quotes: MarketQuote[] = []
  const failed: string[] = []
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') quotes.push(outcome.value)
    else failed.push(TRACKED_SYMBOLS[i].symbol)
  })

  return { quotes, failed, fetchedAt: new Date().toISOString() }
}

/** Single-symbol lookup for the stock profile page. Throws on failure. */
export async function fetchQuote(
  symbol: string,
  name = symbol,
  category: QuoteCategory = 'domestic',
  revalidateSeconds = 60
): Promise<MarketQuote> {
  return fetchOne({ symbol, name, category }, revalidateSeconds)
}
