/**
 * Single-stock data from Yahoo Finance, keyless.
 *
 * Replaces the two Vercel Python Functions this page used to call
 * (api/py/stock-quote.py, api/py/stock-history.py). They were removed for two
 * reasons: whether a root-level /api/*.py function is even built under the
 * Next.js framework preset could not be verified from here, and more
 * importantly the endpoint they called — v10/finance/quoteSummary — no longer
 * answers anonymous callers at all. Running this in TypeScript removes the
 * first question entirely and lets the second be handled properly.
 *
 * Two tiers, deliberately:
 *   - v8/finance/chart needs nothing: no key, no cookie, no crumb. Price,
 *     history and everything derivable from the series come from here, and
 *     this tier is expected to work.
 *   - quoteSummary carries the fundamentals and the analyst view, and needs a
 *     session cookie plus a crumb. That handshake is scraping-adjacent and can
 *     break without notice, so it is attempted and allowed to fail: the page
 *     still gets price, chart and computed statistics, and is told plainly
 *     that the fundamentals are unavailable rather than showing an error.
 *
 * Server-side only.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const TIMEOUT_MS = 8000

export const ALLOWED_RANGES = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'] as const
export const ALLOWED_INTERVALS = ['1d', '1wk', '1mo'] as const

export type HistoryRange = (typeof ALLOWED_RANGES)[number]
export type HistoryInterval = (typeof ALLOWED_INTERVALS)[number]

export interface HistoryPoint {
  date: string
  close: number
}

export interface StockHistory {
  symbol: string
  yahooSymbol: string
  range: string
  interval: string
  currency: string | null
  points: HistoryPoint[]
}

export interface DerivedStats {
  /** From the returned series, so it reflects the requested range. */
  periodHigh: number | null
  periodLow: number | null
  sma50: number | null
  sma200: number | null
  /** Annualised standard deviation of daily log returns, in percent. */
  volatilityPct: number | null
  changePctInPeriod: number | null
}

export interface StockQuote {
  symbol: string
  yahooSymbol: string
  name: string | null
  currency: string | null
  price: number | null
  changePct: number | null
  marketCap: number | null
  peRatio: number | null
  pbRatio: number | null
  dividendYield: number | null
  week52High: number | null
  week52Low: number | null
  analystRecommendationKey: string | null
  analystRecommendationMean: number | null
  analystCount: number | null
  targetMean: number | null
  targetHigh: number | null
  targetLow: number | null
  recommendationBreakdown: {
    strongBuy: number | null
    buy: number | null
    hold: number | null
    sell: number | null
    strongSell: number | null
  }
  /**
   * Set when the fundamentals/analyst tier could not be reached. The price and
   * history fields above are still valid — this says the rest is missing and
   * why, so the page can be honest instead of rendering blank cells.
   */
  fundamentalsError: string | null
}

/** NSE-listed unless the caller already gave a Yahoo-qualified symbol. */
export function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().trim()
  return upper.includes('.') ? upper : `${upper}.NS`
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Unwraps Yahoo's { raw, fmt } value shape, walking a key path. */
function raw(source: any, ...path: string[]): number | null {
  let cursor = source
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return null
    cursor = cursor[key]
  }
  if (cursor && typeof cursor === 'object' && 'raw' in cursor) return num(cursor.raw)
  return num(cursor)
}

async function yahooFetch(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
}

export async function fetchStockHistory(
  symbol: string,
  range: HistoryRange = '6mo',
  interval: HistoryInterval = '1d'
): Promise<StockHistory> {
  const yahooSymbol = toYahooSymbol(symbol)
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?range=${range}&interval=${interval}`

  const response = await yahooFetch(url)
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `No data for '${yahooSymbol}' — check the ticker is NSE-listed`
        : `Yahoo Finance returned HTTP ${response.status}`
    )
  }

  const body = await response.json()
  const result = body?.chart?.result?.[0]
  if (!result) {
    const message = body?.chart?.error?.description || body?.chart?.error?.code
    throw new Error(
      message
        ? `Yahoo Finance: ${message}`
        : `No history for '${yahooSymbol}' — check the ticker is NSE-listed`
    )
  }

  const timestamps: unknown[] = result.timestamp ?? []
  const closes: unknown[] = result.indicators?.quote?.[0]?.close ?? []

  const points: HistoryPoint[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const ts = num(timestamps[i])
    const close = num(closes[i])
    // Yahoo leaves nulls in the series for holidays and halted sessions.
    if (ts === null || close === null) continue
    points.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: Number(close.toFixed(2)) })
  }

  return {
    symbol: symbol.toUpperCase(),
    yahooSymbol,
    range,
    interval,
    currency: typeof result.meta?.currency === 'string' ? result.meta.currency : null,
    points,
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Statistics the page can show even when the fundamentals tier is unreachable.
 * All of it comes from the price series, so it is always as fresh as the chart.
 */
export function deriveStats(points: HistoryPoint[]): DerivedStats {
  if (points.length === 0) {
    return { periodHigh: null, periodLow: null, sma50: null, sma200: null, volatilityPct: null, changePctInPeriod: null }
  }

  const closes = points.map((p) => p.close)
  const last = closes[closes.length - 1]
  const first = closes[0]

  const sma = (window: number) =>
    closes.length >= window ? Number(mean(closes.slice(-window)).toFixed(2)) : null

  // Annualised from daily log returns; only meaningful with a real sample.
  let volatilityPct: number | null = null
  if (closes.length > 20) {
    const returns: number[] = []
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]))
    }
    if (returns.length > 1) {
      const avg = mean(returns)
      const variance = mean(returns.map((r) => (r - avg) ** 2))
      volatilityPct = Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(1))
    }
  }

  return {
    periodHigh: Number(Math.max(...closes).toFixed(2)),
    periodLow: Number(Math.min(...closes).toFixed(2)),
    sma50: sma(50),
    sma200: sma(200),
    volatilityPct,
    changePctInPeriod: first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : null,
  }
}

/**
 * Yahoo's cookie + crumb handshake, required by quoteSummary since it stopped
 * serving anonymous callers. Returns null if any step fails — callers treat
 * the fundamentals tier as simply unavailable rather than erroring out.
 */
async function getCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const seed = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      cache: 'no-store',
    })

    // fc.yahoo.com answers with an error status; the cookie is the point.
    const setCookies =
      typeof (seed.headers as any).getSetCookie === 'function'
        ? (seed.headers as any).getSetCookie()
        : ([seed.headers.get('set-cookie')].filter(Boolean) as string[])

    const cookie = setCookies
      .map((c: string) => c.split(';')[0])
      .filter(Boolean)
      .join('; ')
    if (!cookie) return null

    const crumbResponse = await yahooFetch('https://query1.finance.yahoo.com/v1/test/getcrumb', cookie)
    if (!crumbResponse.ok) return null

    const crumb = (await crumbResponse.text()).trim()
    // A failed crumb call can return an HTML error page with a 200.
    if (!crumb || crumb.length > 64 || crumb.includes('<')) return null

    return { cookie, crumb }
  } catch {
    return null
  }
}

const SUMMARY_MODULES =
  'price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend'

export async function fetchStockQuote(symbol: string): Promise<StockQuote> {
  const yahooSymbol = toYahooSymbol(symbol)

  // Tier 1 — always attempted, and the source of truth for price.
  const chartResponse = await yahooFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1mo&interval=1d`
  )
  if (!chartResponse.ok) {
    throw new Error(
      chartResponse.status === 404
        ? `No data for '${yahooSymbol}' — check the ticker is NSE-listed`
        : `Yahoo Finance returned HTTP ${chartResponse.status}`
    )
  }

  const chartBody = await chartResponse.json()
  const chartResult = chartBody?.chart?.result?.[0]
  const meta = chartResult?.meta
  if (!meta) {
    throw new Error(`No data for '${yahooSymbol}' — check the ticker is NSE-listed`)
  }

  const price = num(meta.regularMarketPrice)
  const previousClose = num(meta.chartPreviousClose) ?? num(meta.previousClose)
  const changePct =
    price !== null && previousClose !== null && previousClose !== 0
      ? Number((((price - previousClose) / previousClose) * 100).toFixed(2))
      : null

  const base: StockQuote = {
    symbol: symbol.toUpperCase(),
    yahooSymbol,
    name: typeof meta.longName === 'string' ? meta.longName : typeof meta.shortName === 'string' ? meta.shortName : null,
    currency: typeof meta.currency === 'string' ? meta.currency : null,
    price,
    changePct,
    marketCap: null,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    week52High: num(meta.fiftyTwoWeekHigh),
    week52Low: num(meta.fiftyTwoWeekLow),
    analystRecommendationKey: null,
    analystRecommendationMean: null,
    analystCount: null,
    targetMean: null,
    targetHigh: null,
    targetLow: null,
    recommendationBreakdown: { strongBuy: null, buy: null, hold: null, sell: null, strongSell: null },
    fundamentalsError: null,
  }

  // Tier 2 — fundamentals and the analyst view. Never fatal.
  const session = await getCrumb()
  if (!session) {
    return {
      ...base,
      fundamentalsError:
        'Yahoo Finance did not issue a session for its fundamentals endpoint, so valuation ratios and the analyst view are unavailable right now. Price and chart are unaffected.',
    }
  }

  try {
    const summaryUrl =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}` +
      `?modules=${SUMMARY_MODULES}&crumb=${encodeURIComponent(session.crumb)}`
    const summaryResponse = await yahooFetch(summaryUrl, session.cookie)
    if (!summaryResponse.ok) {
      return {
        ...base,
        fundamentalsError: `Fundamentals endpoint returned HTTP ${summaryResponse.status}. Price and chart are unaffected.`,
      }
    }

    const summaryBody = await summaryResponse.json()
    const result = summaryBody?.quoteSummary?.result?.[0]
    if (!result) {
      return { ...base, fundamentalsError: 'Fundamentals endpoint returned no data for this symbol.' }
    }

    const priceModule = result.price ?? {}
    const detail = result.summaryDetail ?? {}
    const stats = result.defaultKeyStatistics ?? {}
    const financial = result.financialData ?? {}
    const trend = result.recommendationTrend?.trend?.[0] ?? {}

    return {
      ...base,
      name: base.name ?? (priceModule.shortName || priceModule.longName || null),
      currency: base.currency ?? (priceModule.currency || null),
      price: base.price ?? raw(priceModule, 'regularMarketPrice'),
      marketCap: raw(priceModule, 'marketCap') ?? raw(detail, 'marketCap'),
      peRatio: raw(detail, 'trailingPE'),
      pbRatio: raw(stats, 'priceToBook'),
      dividendYield: raw(detail, 'dividendYield'),
      week52High: base.week52High ?? raw(detail, 'fiftyTwoWeekHigh'),
      week52Low: base.week52Low ?? raw(detail, 'fiftyTwoWeekLow'),
      analystRecommendationKey:
        typeof financial.recommendationKey === 'string' ? financial.recommendationKey : null,
      analystRecommendationMean: raw(financial, 'recommendationMean'),
      analystCount: raw(financial, 'numberOfAnalystOpinions'),
      targetMean: raw(financial, 'targetMeanPrice'),
      targetHigh: raw(financial, 'targetHighPrice'),
      targetLow: raw(financial, 'targetLowPrice'),
      recommendationBreakdown: {
        strongBuy: num(trend.strongBuy),
        buy: num(trend.buy),
        hold: num(trend.hold),
        sell: num(trend.sell),
        strongSell: num(trend.strongSell),
      },
      fundamentalsError: null,
    }
  } catch (error: any) {
    return {
      ...base,
      fundamentalsError: `Fundamentals lookup failed: ${error?.message || 'unknown error'}. Price and chart are unaffected.`,
    }
  }
}
