/**
 * Quotes and fundamentals from TradingView's screener endpoint.
 *
 * Why this source: one POST returns the latest price, the day's move and up
 * to ~100 fundamental and technical fields for every symbol asked for, so the
 * whole NIFTY 50 grid — or a twelve-company analysis — costs one request
 * instead of the one-or-two-per-company Yahoo needed. It answers datacenter
 * IPs (verified from a cloud runner: see scripts/fixtures/market), which is
 * the property Yahoo lost.
 *
 * It is an unofficial endpoint, so it is read defensively: every field is
 * optional, a symbol missing from the answer is simply absent, and the
 * callers fall back to other providers rather than failing.
 *
 * Server-side only (the endpoint expects TradingView's own origin).
 */

export type TvMarket = 'india' | 'global'

export type TvRow = Record<string, unknown>

const ENDPOINT = (market: TvMarket) => `https://scanner.tradingview.com/${market}/scan`
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
}
const TIMEOUT_MS = 8000
const CHUNK = 100

/** The day's quote. Every caller wants at least these. */
export const QUOTE_COLUMNS = [
  'description',
  'close',
  'change',
  'change_abs',
  'open',
  'high',
  'low',
  'volume',
  'currency',
] as const

/** What the stock profile page and the scoring engine read, beyond the quote. */
export const PROFILE_COLUMNS = [
  ...QUOTE_COLUMNS,
  'market_cap_basic',
  'price_earnings_ttm',
  'earnings_per_share_diluted_ttm',
  'price_book_ratio',
  'price_sales_current',
  'dividends_yield_current',
  'return_on_equity',
  'return_on_equity_fy',
  'return_on_assets',
  'debt_to_equity',
  'debt_to_equity_fy',
  'current_ratio',
  'total_revenue_ttm',
  'net_income_ttm',
  'ebitda_ttm',
  'free_cash_flow_ttm',
  'gross_margin',
  'operating_margin',
  'net_margin',
  'total_revenue_yoy_growth_ttm',
  'net_income_yoy_growth_ttm',
  'earnings_per_share_diluted_yoy_growth_ttm',
  'enterprise_value_current',
  'number_of_employees',
  'beta_1_year',
  'price_52_week_high',
  'price_52_week_low',
  'SMA20',
  'SMA50',
  'SMA200',
  'RSI',
  'MACD.macd',
  'MACD.signal',
  'ADX',
  'Volatility.D',
  'Volatility.M',
  'Perf.W',
  'Perf.1M',
  'Perf.3M',
  'Perf.6M',
  'Perf.YTD',
  'Perf.Y',
  'Perf.5Y',
  'average_volume_10d_calc',
  'average_volume_30d_calc',
  'relative_volume_10d_calc',
  'Recommend.All',
  'Recommend.MA',
  'Recommend.Other',
  'sector',
  'industry',
  'logoid',
  'earnings_release_next_date',
  'earnings_release_date',
  'total_shares_outstanding',
  'float_shares_outstanding',
] as const

/** NSE symbols use '-' where TradingView uses '_' (BAJAJ-AUTO → BAJAJ_AUTO). */
export function tvTicker(nseSymbol: string): string {
  return `NSE:${nseSymbol.toUpperCase().replace(/-/g, '_')}`
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Within one warm function instance, an identical scan inside the TTL is
 * answered from memory. The CDN caches the routes in front of this anyway;
 * this covers the burst where several routes on one page ask at once.
 */
const memo = new Map<string, { at: number; rows: Map<string, TvRow> }>()

export class TvError extends Error {}

/**
 * Runs one screener request and returns rows keyed by ticker, each row a
 * column → value record. Tickers TradingView does not know are simply missing
 * from the map; a transport or HTTP failure throws TvError.
 */
export async function tvScan(
  market: TvMarket,
  tickers: string[],
  columns: readonly string[],
  { ttlSeconds = 60 }: { ttlSeconds?: number } = {}
): Promise<Map<string, TvRow>> {
  const unique = Array.from(new Set(tickers))
  const key = `${market}|${unique.join(',')}|${columns.join(',')}`
  const cached = memo.get(key)
  if (cached && Date.now() - cached.at < ttlSeconds * 1000) return cached.rows

  const rows = new Map<string, TvRow>()
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    let response: Response
    try {
      response = await fetch(ENDPOINT(market), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ symbols: { tickers: slice, query: { types: [] } }, columns }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (err: any) {
      throw new TvError(`TradingView unreachable: ${err?.cause?.code || err?.message || 'network error'}`)
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160)
      throw new TvError(`TradingView returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    const body = await response.json().catch(() => null)
    const data: { s?: string; d?: unknown[] }[] = Array.isArray(body?.data) ? body.data : []
    for (const item of data) {
      if (typeof item?.s !== 'string' || !Array.isArray(item.d)) continue
      const row: TvRow = {}
      columns.forEach((column, index) => {
        row[column] = item.d![index]
      })
      rows.set(item.s, row)
    }
  }

  memo.set(key, { at: Date.now(), rows })
  if (memo.size > 200) memo.delete(memo.keys().next().value as string)
  return rows
}

/** Price, previous close and the day's move, read from a scanner row. */
export function quoteFromRow(row: TvRow): {
  price: number
  previousClose: number
  change: number
  changePct: number
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  currency: string
} | null {
  const price = num(row.close)
  if (price === null) return null
  const changeAbs = num(row.change_abs)
  const changePct = num(row.change)
  // change_abs is relative to the previous session's close, so the two
  // together give the previous close without a second request.
  const previousClose =
    changeAbs !== null ? price - changeAbs : changePct !== null && changePct !== -100 ? price / (1 + changePct / 100) : price
  const change = price - previousClose
  return {
    price,
    previousClose,
    change,
    changePct: changePct ?? (previousClose !== 0 ? (change / previousClose) * 100 : 0),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    volume: num(row.volume),
    currency: str(row.currency) ?? 'INR',
  }
}

/**
 * TradingView's technical rating (-1 … +1), in the five buckets its own UI
 * uses. This is a summary of moving-average and oscillator signals — not an
 * analyst opinion, and the UI must say so.
 */
export function technicalRatingLabel(value: number | null): string | null {
  if (value === null) return null
  if (value >= 0.5) return 'Strong buy'
  if (value >= 0.1) return 'Buy'
  if (value > -0.1) return 'Neutral'
  if (value > -0.5) return 'Sell'
  return 'Strong sell'
}
