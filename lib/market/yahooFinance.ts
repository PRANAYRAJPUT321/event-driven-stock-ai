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

import {
  DEFAULT_CONCURRENCY,
  fetchQuotesBatch,
  mapWithConcurrency,
  recallLastGood,
  rememberLastGood,
  yahooRequest,
  YAHOO_HOSTS,
  type BatchQuote,
} from './yahooClient'

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
/**
 * The compact set shown in the always-on header bar. Kept deliberately short:
 * a marquee people can actually read beats an exhaustive one they cannot.
 * Domestic first, because this is an Indian-equity product.
 */
export const TRACKED_SYMBOLS: TrackedSymbol[] = [
  { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic' },
  { symbol: '^BSESN', name: 'SENSEX', category: 'domestic' },
  { symbol: '^NSEBANK', name: 'BANK NIFTY', category: 'domestic' },
  { symbol: '^CNXIT', name: 'NIFTY IT', category: 'domestic' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX', category: 'domestic' },

  { symbol: '^GSPC', name: 'S&P 500', category: 'international' },
  { symbol: '^IXIC', name: 'NASDAQ', category: 'international' },
  { symbol: '^DJI', name: 'DOW JONES', category: 'international' },
  { symbol: '^FTSE', name: 'FTSE 100', category: 'international' },
  { symbol: '^N225', name: 'NIKKEI 225', category: 'international' },
  { symbol: '^HSI', name: 'HANG SENG', category: 'international' },

  { symbol: 'GC=F', name: 'GOLD', category: 'commodity' },
  { symbol: 'SI=F', name: 'SILVER', category: 'commodity' },
  { symbol: 'CL=F', name: 'WTI CRUDE', category: 'commodity' },
  { symbol: 'BZ=F', name: 'BRENT CRUDE', category: 'commodity' },

  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' },
  { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency' },
]

/**
 * The full set behind the /markets heatmaps. Everything the bar carries, plus
 * the breadth a heatmap is actually for: Indian sector indices, the major
 * exchanges of every region, the commodity complex, and the INR crosses that
 * matter to Indian importers and exporters.
 *
 * Each entry is one upstream request, so this list is the page's cost — which
 * is why it is fetched once per minute at the edge and shared by all callers
 * rather than per visitor.
 */
export const HEATMAP_SYMBOLS: TrackedSymbol[] = [
  // ── India: headline and sector indices ──────────────────────────────
  { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic' },
  { symbol: '^BSESN', name: 'SENSEX', category: 'domestic' },
  { symbol: '^NSEBANK', name: 'BANK NIFTY', category: 'domestic' },
  { symbol: '^CNXIT', name: 'NIFTY IT', category: 'domestic' },
  { symbol: '^CNXAUTO', name: 'NIFTY AUTO', category: 'domestic' },
  { symbol: '^CNXPHARMA', name: 'NIFTY PHARMA', category: 'domestic' },
  { symbol: '^CNXFMCG', name: 'NIFTY FMCG', category: 'domestic' },
  { symbol: '^CNXMETAL', name: 'NIFTY METAL', category: 'domestic' },
  { symbol: '^CNXENERGY', name: 'NIFTY ENERGY', category: 'domestic' },
  { symbol: '^CNXREALTY', name: 'NIFTY REALTY', category: 'domestic' },
  { symbol: '^CNXINFRA', name: 'NIFTY INFRA', category: 'domestic' },
  { symbol: '^CNXPSUBANK', name: 'NIFTY PSU BANK', category: 'domestic' },
  { symbol: '^NSEMDCP50', name: 'NIFTY MIDCAP 50', category: 'domestic' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX', category: 'domestic' },

  // ── Americas ────────────────────────────────────────────────────────
  { symbol: '^GSPC', name: 'S&P 500', category: 'international' },
  { symbol: '^IXIC', name: 'NASDAQ COMPOSITE', category: 'international' },
  { symbol: '^DJI', name: 'DOW JONES', category: 'international' },
  { symbol: '^RUT', name: 'RUSSELL 2000', category: 'international' },
  { symbol: '^VIX', name: 'CBOE VIX', category: 'international' },
  { symbol: '^GSPTSE', name: 'TSX COMPOSITE', category: 'international' },
  { symbol: '^BVSP', name: 'BOVESPA', category: 'international' },
  { symbol: '^MXX', name: 'IPC MEXICO', category: 'international' },

  // ── Europe ──────────────────────────────────────────────────────────
  { symbol: '^FTSE', name: 'FTSE 100', category: 'international' },
  { symbol: '^GDAXI', name: 'DAX', category: 'international' },
  { symbol: '^FCHI', name: 'CAC 40', category: 'international' },
  { symbol: '^STOXX50E', name: 'EURO STOXX 50', category: 'international' },
  { symbol: '^IBEX', name: 'IBEX 35', category: 'international' },
  { symbol: 'FTSEMIB.MI', name: 'FTSE MIB', category: 'international' },
  { symbol: '^AEX', name: 'AEX', category: 'international' },
  { symbol: '^SSMI', name: 'SMI', category: 'international' },

  // ── Asia-Pacific & Middle East ──────────────────────────────────────
  { symbol: '^N225', name: 'NIKKEI 225', category: 'international' },
  { symbol: '^HSI', name: 'HANG SENG', category: 'international' },
  { symbol: '000001.SS', name: 'SHANGHAI COMPOSITE', category: 'international' },
  { symbol: '399001.SZ', name: 'SHENZHEN COMPONENT', category: 'international' },
  { symbol: '^KS11', name: 'KOSPI', category: 'international' },
  { symbol: '^TWII', name: 'TAIWAN WEIGHTED', category: 'international' },
  { symbol: '^AXJO', name: 'ASX 200', category: 'international' },
  { symbol: '^STI', name: 'STRAITS TIMES', category: 'international' },
  { symbol: '^JKSE', name: 'JAKARTA COMPOSITE', category: 'international' },
  { symbol: '^KLSE', name: 'FTSE BURSA MALAYSIA', category: 'international' },
  { symbol: '^TA125.TA', name: 'TA-125 ISRAEL', category: 'international' },

  // ── Commodities ─────────────────────────────────────────────────────
  { symbol: 'GC=F', name: 'GOLD', category: 'commodity' },
  { symbol: 'SI=F', name: 'SILVER', category: 'commodity' },
  { symbol: 'PL=F', name: 'PLATINUM', category: 'commodity' },
  { symbol: 'PA=F', name: 'PALLADIUM', category: 'commodity' },
  { symbol: 'HG=F', name: 'COPPER', category: 'commodity' },
  { symbol: 'CL=F', name: 'WTI CRUDE', category: 'commodity' },
  { symbol: 'BZ=F', name: 'BRENT CRUDE', category: 'commodity' },
  { symbol: 'NG=F', name: 'NATURAL GAS', category: 'commodity' },
  { symbol: 'RB=F', name: 'GASOLINE', category: 'commodity' },
  { symbol: 'ZC=F', name: 'CORN', category: 'commodity' },
  { symbol: 'ZW=F', name: 'WHEAT', category: 'commodity' },
  { symbol: 'ZS=F', name: 'SOYBEAN', category: 'commodity' },
  { symbol: 'SB=F', name: 'SUGAR', category: 'commodity' },
  { symbol: 'KC=F', name: 'COFFEE', category: 'commodity' },
  { symbol: 'CT=F', name: 'COTTON', category: 'commodity' },

  // ── Currencies ──────────────────────────────────────────────────────
  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' },
  { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', category: 'currency' },
  { symbol: 'JPYINR=X', name: 'JPY/INR', category: 'currency' },
  { symbol: 'AEDINR=X', name: 'AED/INR', category: 'currency' },
  { symbol: 'CNYINR=X', name: 'CNY/INR', category: 'currency' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', category: 'currency' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', category: 'currency' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', category: 'currency' },
  { symbol: 'DX-Y.NYB', name: 'DOLLAR INDEX', category: 'currency' },
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
  const path =
    `/v8/finance/chart/${encodeURIComponent(tracked.symbol)}` + `?interval=1d&range=5d`

  const response = await yahooRequest(path, { revalidate: revalidateSeconds })
  if (!response.ok) {
    throw new Error(`${tracked.symbol}: HTTP ${response.status} from ${YAHOO_HOSTS[0]}`)
  }
  const quote = parseChart(await response.json(), tracked)
  if (!quote) throw new Error(`${tracked.symbol}: unexpected response shape`)
  return quote
}

/** Turns a row from the batch quote endpoint into our quote shape. */
function fromBatch(tracked: TrackedSymbol, row: BatchQuote): MarketQuote | null {
  const previousClose = row.previousClose ?? row.price
  if (row.price === null || previousClose === null) return null
  const change = row.price - previousClose
  return {
    symbol: tracked.symbol,
    name: tracked.name,
    category: tracked.category,
    price: row.price,
    previousClose,
    change,
    changePct: previousClose !== 0 ? (change / previousClose) * 100 : 0,
    currency: row.currency ?? '',
    asOf: row.marketTimeSeconds !== null
      ? new Date(row.marketTimeSeconds * 1000).toISOString()
      : null,
  }
}

/**
 * Resolves a list of symbols with as few upstream requests as possible.
 *
 * Batch first — one request covers forty symbols. Whatever the batch did not
 * answer for falls back to the per-symbol chart endpoint, but with bounded
 * concurrency, because firing the remainder all at once is what produced the
 * rate limiting this function exists to avoid.
 */
async function resolveQuotes(
  tracked: TrackedSymbol[],
  revalidateSeconds: number
): Promise<{ quotes: MarketQuote[]; failed: string[]; failureReason?: string }> {
  const quotes: MarketQuote[] = []
  const failed: string[] = []
  let failureReason: string | undefined

  let pending = tracked
  try {
    const batch = await fetchQuotesBatch(tracked.map((t) => t.symbol))
    if (batch) {
      const remaining: TrackedSymbol[] = []
      for (const t of tracked) {
        const row = batch.get(t.symbol)
        const quote = row ? fromBatch(t, row) : null
        if (quote) quotes.push(quote)
        else remaining.push(t)
      }
      pending = remaining
    }
  } catch (err: any) {
    failureReason ??= `batch quote failed: ${err?.message || 'unknown error'}`
  }

  if (pending.length > 0) {
    const settled = await mapWithConcurrency(pending, DEFAULT_CONCURRENCY, (t) =>
      fetchOne(t, revalidateSeconds)
    )
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') quotes.push(outcome.value)
      else {
        failed.push(pending[i].symbol)
        failureReason ??= String((outcome.reason as any)?.message ?? outcome.reason)
      }
    })
  }

  return { quotes, failed, failureReason }
}

export interface MarketBarData {
  quotes: MarketQuote[]
  /** Symbols that failed, so the UI/logs can show partial-data honestly. */
  failed: string[]
  /**
   * Why the first failure happened. Without this the caller can only guess at
   * the cause, and the guess it used to print — "usually upstream rate
   * limiting" — was wrong whenever the real answer was a blocked host or a
   * DNS failure, which sent people looking in the wrong place.
   */
  failureReason?: string
  /** True when the upstream failed and the previous good payload is being served. */
  stale?: boolean
  staleAgeSeconds?: number
  fetchedAt: string
}

/**
 * Fetches every tracked symbol in parallel. Never throws for a partial
 * failure — callers get whatever resolved plus the list that didn't, and only
 * an empty `quotes` array means the upstream is genuinely unavailable.
 */
export async function fetchMarketBar(
  revalidateSeconds = 60,
  symbols: TrackedSymbol[] = TRACKED_SYMBOLS
): Promise<MarketBarData> {
  const cacheKey = `bar:${symbols.length}`
  const { quotes, failed, failureReason } = await resolveQuotes(symbols, revalidateSeconds)

  // A minute where the upstream rate-limits should not blank a page that was
  // populated a minute ago. Serve the previous good payload, aged and
  // labelled, and let the UI say how old it is.
  if (quotes.length === 0) {
    const stale = recallLastGood<MarketQuote[]>(cacheKey)
    if (stale) {
      return {
        quotes: stale.value,
        failed,
        failureReason,
        stale: true,
        staleAgeSeconds: stale.ageSeconds,
        fetchedAt: new Date(Date.now() - stale.ageSeconds * 1000).toISOString(),
      }
    }
  } else {
    rememberLastGood(cacheKey, quotes)
  }

  return { quotes, failed, failureReason, fetchedAt: new Date().toISOString() }
}

/**
 * Live quotes for a list of NSE-listed equities.
 *
 * Separate from fetchMarketBar so the index/commodity request and the
 * fifty-odd equity requests do not compound into one very slow call — each
 * endpoint stays inside a serverless function's budget on its own.
 */
export async function fetchEquityQuotes(
  constituents: { symbol: string; name: string; sector: string }[],
  revalidateSeconds = 60
): Promise<{
  quotes: (MarketQuote & { sector: string })[]
  failed: string[]
  failureReason?: string
  stale?: boolean
  staleAgeSeconds?: number
  fetchedAt: string
}> {
  // .NS is Yahoo's suffix for the NSE. The category is only used for grouping
  // in the bar, which equities never appear in.
  const tracked: TrackedSymbol[] = constituents.map((c) => ({
    symbol: `${c.symbol}.NS`,
    name: c.name,
    category: 'domestic',
  }))
  const sectorBySymbol = new Map(constituents.map((c) => [`${c.symbol}.NS`, c.sector]))
  const nseBySymbol = new Map(constituents.map((c) => [`${c.symbol}.NS`, c.symbol]))

  const { quotes: raw, failed: rawFailed, failureReason } = await resolveQuotes(
    tracked,
    revalidateSeconds
  )

  const quotes = raw.map((q) => ({
    ...q,
    // Report the NSE symbol, not Yahoo's suffixed form — this is what the rest
    // of the app links and stores.
    symbol: nseBySymbol.get(q.symbol) ?? q.symbol,
    sector: sectorBySymbol.get(q.symbol) ?? '',
  }))
  const failed = rawFailed.map((s) => nseBySymbol.get(s) ?? s)

  const cacheKey = 'equities'
  if (quotes.length === 0) {
    const stale = recallLastGood<(MarketQuote & { sector: string })[]>(cacheKey)
    if (stale) {
      return {
        quotes: stale.value,
        failed,
        failureReason,
        stale: true,
        staleAgeSeconds: stale.ageSeconds,
        fetchedAt: new Date(Date.now() - stale.ageSeconds * 1000).toISOString(),
      }
    }
  } else {
    rememberLastGood(cacheKey, quotes)
  }

  return { quotes, failed, failureReason, fetchedAt: new Date().toISOString() }
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
