import { previousSessionClose } from './yahooFinance'
import {
  getYahooSession,
  invalidateYahooSession,
  yahooRequest,
} from './yahooClient'

/**
 * Real, sourced metrics for one NSE-listed stock.
 *
 * This replaces lib/market/mockData.ts, which produced ROE, P/E, RSI, moving
 * averages and volatility from a hash of the ticker. Those numbers were
 * stable and plausible, which made them worse than obviously fake ones: they
 * fed the scoring engine and reached the user as though they were measured.
 *
 * Everything here is measured or read from a source, and anything that cannot
 * be sourced is reported as null rather than filled in. The scoring engine
 * then drops that factor and re-weights (see scoreCalculator.ts), so a missing
 * input costs precision and says so, instead of quietly inventing precision.
 *
 * Two tiers, same split as the rest of the Yahoo layer:
 *   - The chart endpoint is keyless and reliable. Price and every technical
 *     measure are computed from a year of daily closes.
 *   - quoteSummary carries valuation and company fundamentals and needs a
 *     cookie + crumb handshake that can refuse without notice.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 8000

export interface TechnicalMetrics {
  price: number
  previousClose: number
  changePct: number
  sma50: number | null
  sma200: number | null
  /** Wilder's 14-period RSI. */
  rsi14: number | null
  /** Annualised standard deviation of daily log returns, in percent. */
  volatilityPct: number | null
  week52High: number | null
  week52Low: number | null
  /** Number of daily closes the above were computed from. */
  sampleSize: number
}

export interface ValuationMetrics {
  peRatio: number | null
  pbRatio: number | null
  marketCap: number | null
  dividendYieldPct: number | null
}

export interface FundamentalMetrics {
  returnOnEquityPct: number | null
  profitMarginPct: number | null
  revenueGrowthPct: number | null
  earningsGrowthPct: number | null
  debtToEquity: number | null
  currentRatio: number | null
}

export interface RiskMetrics {
  beta: number | null
  volatilityPct: number | null
  debtToEquity: number | null
}

export interface StockMetrics {
  symbol: string
  name: string | null
  sector: string
  currency: string | null
  technical: TechnicalMetrics | null
  valuation: ValuationMetrics | null
  fundamental: FundamentalMetrics | null
  risk: RiskMetrics | null
  /** Why a tier is missing, for the UI and the logs. Never silent. */
  notes: string[]
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function raw(source: any, ...path: string[]): number | null {
  let cursor = source
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return null
    cursor = cursor[key]
  }
  if (cursor && typeof cursor === 'object' && 'raw' in cursor) return num(cursor.raw)
  return num(cursor)
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function sma(closes: number[], window: number): number | null {
  if (closes.length < window) return null
  return Number(mean(closes.slice(-window)).toFixed(2))
}

/**
 * Wilder's RSI, the standard 14-period smoothing rather than a simple average
 * of gains and losses — the two diverge noticeably and charting platforms all
 * use Wilder's, so a score derived from the simple form would not match what
 * a user sees on their own chart.
 */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta >= 0) avgGain += delta
    else avgLoss -= delta
  }
  avgGain /= period
  avgLoss /= period

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return Number((100 - 100 / (1 + rs)).toFixed(1))
}

function annualisedVolatility(closes: number[]): number | null {
  if (closes.length < 21) return null
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]))
  }
  if (returns.length < 2) return null
  const avg = mean(returns)
  const variance = mean(returns.map((r) => (r - avg) ** 2))
  // 252 trading days a year is the standard annualisation factor.
  return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(1))
}

/** Everything derivable from a year of daily closes. Keyless and reliable. */
export async function fetchTechnicals(nseSymbol: string): Promise<TechnicalMetrics | null> {
  const yahooSymbol = `${nseSymbol.toUpperCase()}.NS`
  const response = await yahooRequest(
    `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1y&interval=1d`,
    { revalidate: 300 }
  )
  if (!response.ok) return null

  const body = await response.json()
  const result = body?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return null

  const rawCloses: unknown[] = result?.indicators?.quote?.[0]?.close ?? []
  const closes = rawCloses.map(num).filter((c): c is number => c !== null)
  if (closes.length === 0) return null

  const price = num(meta.regularMarketPrice) ?? closes[closes.length - 1]
  const previousClose = previousSessionClose(rawCloses, meta) ?? price

  return {
    price,
    previousClose,
    changePct:
      previousClose !== 0 ? Number((((price - previousClose) / previousClose) * 100).toFixed(2)) : 0,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes),
    volatilityPct: annualisedVolatility(closes),
    // From the observed year, not from meta — meta's 52-week fields are not
    // populated for every instrument.
    week52High: Number(Math.max(...closes).toFixed(2)),
    week52Low: Number(Math.min(...closes).toFixed(2)),
    sampleSize: closes.length,
  }
}

const SUMMARY_MODULES = 'price,summaryDetail,defaultKeyStatistics,financialData'

/**
 * Valuation, fundamentals and beta. Returns nulls rather than throwing when
 * the endpoint refuses, because this tier is genuinely unreliable and the
 * caller's job is to re-weight, not to fail.
 */
export async function fetchCompanyFundamentals(nseSymbol: string): Promise<{
  valuation: ValuationMetrics | null
  fundamental: FundamentalMetrics | null
  beta: number | null
  name: string | null
  currency: string | null
  note: string | null
}> {
  const empty = { valuation: null, fundamental: null, beta: null, name: null, currency: null }

  const session = await getYahooSession()
  if (!session) {
    return { ...empty, note: 'Yahoo did not issue a session for its fundamentals endpoint' }
  }

  try {
    const yahooSymbol = `${nseSymbol.toUpperCase()}.NS`
    const response = await yahooRequest(
      `/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}` +
        `?modules=${SUMMARY_MODULES}&crumb=${encodeURIComponent(session.crumb)}`,
      { cookie: session.cookie, attempts: 2 }
    )
    if (!response.ok) {
      // A refused crumb is usually stale; drop it so the next call re-handshakes.
      if (response.status === 401 || response.status === 403) invalidateYahooSession()
      return { ...empty, note: `Fundamentals endpoint returned HTTP ${response.status}` }
    }

    const result = (await response.json())?.quoteSummary?.result?.[0]
    if (!result) return { ...empty, note: 'Fundamentals endpoint returned no data for this symbol' }

    const priceModule = result.price ?? {}
    const detail = result.summaryDetail ?? {}
    const stats = result.defaultKeyStatistics ?? {}
    const financial = result.financialData ?? {}

    // Yahoo reports rates as fractions (0.184 = 18.4%); the scoring engine and
    // the UI both work in percent.
    const pct = (value: number | null) => (value === null ? null : Number((value * 100).toFixed(2)))

    return {
      valuation: {
        peRatio: raw(detail, 'trailingPE'),
        pbRatio: raw(stats, 'priceToBook'),
        marketCap: raw(priceModule, 'marketCap') ?? raw(detail, 'marketCap'),
        dividendYieldPct: pct(raw(detail, 'dividendYield')),
      },
      fundamental: {
        returnOnEquityPct: pct(raw(financial, 'returnOnEquity')),
        profitMarginPct: pct(raw(financial, 'profitMargins')),
        revenueGrowthPct: pct(raw(financial, 'revenueGrowth')),
        earningsGrowthPct: pct(raw(financial, 'earningsGrowth')),
        debtToEquity: raw(financial, 'debtToEquity'),
        currentRatio: raw(financial, 'currentRatio'),
      },
      beta: raw(stats, 'beta') ?? raw(detail, 'beta'),
      name: typeof priceModule.longName === 'string' ? priceModule.longName : null,
      currency: typeof priceModule.currency === 'string' ? priceModule.currency : null,
      note: null,
    }
  } catch (error: any) {
    return { ...empty, note: `Fundamentals lookup failed: ${error?.message || 'unknown error'}` }
  }
}

/** Both tiers for one stock, with a note for whatever could not be sourced. */
export async function fetchStockMetrics(
  nseSymbol: string,
  name: string,
  sector: string
): Promise<StockMetrics> {
  const notes: string[] = []

  const [technicalOutcome, fundamentalsOutcome] = await Promise.allSettled([
    fetchTechnicals(nseSymbol),
    fetchCompanyFundamentals(nseSymbol),
  ])

  const technical =
    technicalOutcome.status === 'fulfilled' ? technicalOutcome.value : null
  if (!technical) notes.push('Price history unavailable, so technical factors were not scored')

  const fundamentals =
    fundamentalsOutcome.status === 'fulfilled'
      ? fundamentalsOutcome.value
      : { valuation: null, fundamental: null, beta: null, name: null, currency: null, note: 'lookup failed' }
  if (fundamentals.note) notes.push(fundamentals.note)

  const risk: RiskMetrics | null =
    technical || fundamentals.beta !== null
      ? {
          beta: fundamentals.beta,
          volatilityPct: technical?.volatilityPct ?? null,
          debtToEquity: fundamentals.fundamental?.debtToEquity ?? null,
        }
      : null

  return {
    symbol: nseSymbol.toUpperCase(),
    name: fundamentals.name ?? name,
    sector,
    currency: fundamentals.currency ?? (technical ? 'INR' : null),
    technical,
    valuation: fundamentals.valuation,
    fundamental: fundamentals.fundamental,
    risk,
    notes,
  }
}
