/**
 * Price history for one instrument over a chart range, with provider fallback.
 *
 * Each range is planned once — bar size and window — and then tried against
 * Upstox, Moneycontrol and Groww in turn, Yahoo last (it refuses Vercel's
 * servers, but costs nothing to try from anywhere else). The response says
 * which provider answered, because a chart is only as trustworthy as its
 * source and the page shows it.
 *
 * Server-side only.
 */
import {
  growwCandles,
  moneycontrolCandles,
  upstoxCandles,
  upstoxEquityKey,
  upstoxIntraday,
  UPSTOX_INDEX_KEYS,
  type Candle,
  type CandleSource,
  type McResolution,
  type UpstoxUnit,
} from './candles'
import { findEquity } from './indianEquities'
import { isinFor, lookupEquity } from './nseDirectory'
import { fetchStockHistory, type HistoryInterval, type HistoryRange } from './yahooStock'

export const CHART_RANGES = ['1d', '5d', '1m', '6m', 'ytd', '1y', '5y', 'max'] as const
export type ChartRange = (typeof CHART_RANGES)[number]

export interface PriceHistory {
  symbol: string
  range: ChartRange
  /** Human description of the bar size, e.g. "5 min", "1 day", "1 week". */
  interval: string
  /** True for ranges plotted in minutes (1D, 5D): the x-axis shows times. */
  intraday: boolean
  candles: Candle[]
  /** Whether the bars carry real open/high/low (false: close-only fallback). */
  ohlc: boolean
  /** Previous session's close — the 1D chart's baseline. Null when unknown. */
  previousClose: number | null
  source: CandleSource
  /** Providers tried before the one that answered, with why they failed. */
  attempts: string[]
}

interface Plan {
  interval: string
  intraday: boolean
  upstox: (key: string) => Promise<Candle[]>
  moneycontrol: ((symbol: string) => Promise<Candle[]>) | null
  groww: ((symbol: string) => Promise<Candle[]>) | null
  yahoo: { range: HistoryRange; interval: HistoryInterval } | null
  /** Keep only the last N distinct trading days (intraday ranges). */
  lastDays?: number
  /**
   * How to bring the series up to the minute. Historical endpoints stop at
   * the previous session while the market is open, which left the chart
   * ending at yesterday's close beside today's live price. Today's bars come
   * from the intraday endpoint instead: aggregated into one daily bar, or
   * appended as they are for the 30-minute view.
   */
  today?: 'daily' | 'intraday30'
  revalidate: number
}

const DAY_MS = 86_400_000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

function startOfYearIST(): Date {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 5.5 * 3600 * 1000)
}

function plan(range: ChartRange): Plan {
  const now = new Date()
  switch (range) {
    case '1d':
      return {
        interval: '5 min',
        intraday: true,
        // Today's bars; before the open (or on a holiday) there are none, so
        // the last session's bars are fetched instead — a chart of the most
        // recent trading day beats an empty frame.
        upstox: async (key) => {
          const today = await upstoxIntraday(key, 5, 60)
          if (today.length >= 2) return today
          return upstoxCandles(key, 'minutes', 5, daysAgo(7), now, 300)
        },
        moneycontrol: (s) => moneycontrolCandles(s, '5', daysAgo(6), now, 400, 120),
        groww: (s) => growwCandles(s, 5, daysAgo(6), now, 120),
        yahoo: null,
        lastDays: 1,
        revalidate: 60,
      }
    case '5d':
      return {
        interval: '30 min',
        intraday: true,
        upstox: (key) => upstoxCandles(key, 'minutes', 30, daysAgo(12), now, 300),
        moneycontrol: (s) => moneycontrolCandles(s, '30', daysAgo(12), now, 200, 300),
        groww: (s) => growwCandles(s, 30, daysAgo(12), now, 300),
        yahoo: null,
        lastDays: 5,
        today: 'intraday30',
        revalidate: 300,
      }
    case '1m':
    case '6m':
    case 'ytd':
    case '1y': {
      const from = range === '1m' ? daysAgo(32) : range === '6m' ? daysAgo(184) : range === 'ytd' ? startOfYearIST() : daysAgo(367)
      const yahooRange: HistoryRange = range === '1m' ? '1mo' : range === '6m' ? '6mo' : '1y'
      return daily(from, now, yahooRange)
    }
    case '5y':
      return {
        interval: '1 week',
        intraday: false,
        upstox: (key) => upstoxCandles(key, 'weeks', 1, daysAgo(5 * 366), now, 21600),
        moneycontrol: (s) => moneycontrolCandles(s, '1W', daysAgo(5 * 366), now, 300, 21600),
        groww: (s) => growwCandles(s, 10080, daysAgo(5 * 366), now, 21600),
        yahoo: { range: '5y', interval: '1wk' },
        revalidate: 21600,
      }
    case 'max':
      return {
        interval: '1 month',
        intraday: false,
        upstox: (key) => upstoxCandles(key, 'months', 1, new Date('2000-01-01T00:00:00Z'), now, 86400),
        moneycontrol: (s) => moneycontrolCandles(s, '1W', new Date('2000-01-01T00:00:00Z'), now, 1500, 86400),
        groww: null,
        yahoo: { range: 'max', interval: '1mo' },
        revalidate: 86400,
      }
  }
}

function daily(from: Date, to: Date, yahooRange: HistoryRange): Plan {
  return {
    interval: '1 day',
    intraday: false,
    upstox: (key) => upstoxCandles(key, 'days', 1, from, to, 1800),
    moneycontrol: (s) => moneycontrolCandles(s, '1D', from, to, 400, 1800),
    groww: (s) => growwCandles(s, 1440, from, to, 1800),
    yahoo: { range: yahooRange, interval: '1d' },
    today: 'daily',
    revalidate: 1800,
  }
}

/** The calendar date of a bar, in India. */
function istDate(t: number): string {
  return new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Adds today's session to a historical series when the provider has not yet
 * included it. Only real bars are added: an aggregate of today's intraday
 * bars (open of the first, extremes of all, close of the last, summed volume).
 */
async function withToday(candles: Candle[], key: string | null, mode: Plan['today']): Promise<Candle[]> {
  if (!mode || !key || candles.length === 0) return candles
  let today: Candle[] = []
  try {
    today = await upstoxIntraday(key, mode === 'daily' ? 5 : 30, 60)
  } catch {
    return candles
  }
  if (today.length === 0) return candles
  const last = candles[candles.length - 1]
  if (mode === 'intraday30') {
    return [...candles, ...today.filter((c) => c.t > last.t)]
  }
  const todayDate = istDate(today[0].t)
  if (istDate(last.t) >= todayDate) return candles
  const bar: Candle = {
    t: Date.parse(`${todayDate}T00:00:00+05:30`),
    o: today[0].o,
    h: Math.max(...today.map((c) => c.h)),
    l: Math.min(...today.map((c) => c.l)),
    c: today[today.length - 1].c,
    v: today.reduce((sum, c) => sum + c.v, 0),
  }
  return [...candles, bar]
}

function keepLastDays(candles: Candle[], days: number): Candle[] {
  const dates = Array.from(new Set(candles.map((c) => istDate(c.t))))
  const keep = new Set(dates.slice(-days))
  return candles.filter((c) => keep.has(istDate(c.t)))
}

/** The close of the session before the first bar shown — the 1D baseline. */
async function previousSessionClose(key: string | null, symbol: string, firstBar: Candle | undefined): Promise<number | null> {
  if (!firstBar) return null
  const firstDate = istDate(firstBar.t)
  try {
    const days = key
      ? await upstoxCandles(key, 'days', 1, daysAgo(14), new Date(), 1800)
      : await moneycontrolCandles(symbol, '1D', daysAgo(14), new Date(), 20, 1800)
    const before = days.filter((d) => istDate(d.t) < firstDate)
    return before.length ? before[before.length - 1].c : null
  } catch {
    return null
  }
}

/**
 * Resolves `symbol` to provider identifiers: an index id like ^NSEI maps to
 * its Upstox index key; an NSE equity maps to its ISIN-based key.
 */
export function instrumentKeys(symbol: string): { upstox: string | null; nse: string | null } {
  const upper = symbol.toUpperCase()
  if (upper.startsWith('^')) return { upstox: UPSTOX_INDEX_KEYS[upper] ?? null, nse: null }
  // Only real listings get an NSE identity: asking three providers about a
  // symbol that does not exist just turns a typo into a slow error.
  const listed = !!lookupEquity(upper) || !!findEquity(upper)
  const isin = listed ? isinFor(upper) : null
  return { upstox: isin ? upstoxEquityKey(isin) : null, nse: listed ? upper : null }
}

export async function fetchPriceHistory(symbol: string, range: ChartRange): Promise<PriceHistory> {
  const p = plan(range)
  const { upstox, nse } = instrumentKeys(symbol)
  const attempts: string[] = []

  const finish = async (candles: Candle[], source: CandleSource, ohlc = true): Promise<PriceHistory> => {
    const current = ohlc ? await withToday(candles, upstox, p.today) : candles
    const trimmed = p.lastDays ? keepLastDays(current, p.lastDays) : current
    const previousClose = range === '1d' ? await previousSessionClose(upstox, nse ?? symbol, trimmed[0]) : null
    return {
      symbol: symbol.toUpperCase(),
      range,
      interval: p.interval,
      intraday: p.intraday,
      candles: trimmed,
      ohlc,
      previousClose,
      source,
      attempts,
    }
  }

  const providers: [CandleSource, (() => Promise<Candle[]>) | null][] = [
    ['upstox', upstox ? () => p.upstox(upstox) : null],
    ['moneycontrol', nse && p.moneycontrol ? () => p.moneycontrol!(nse) : null],
    ['groww', nse && p.groww ? () => p.groww!(nse) : null],
  ]

  for (const [source, run] of providers) {
    if (!run) continue
    try {
      const candles = await run()
      if (candles.length >= 2) return await finish(candles, source)
      attempts.push(`${source}: no bars`)
    } catch (err: any) {
      attempts.push(`${source}: ${err?.message || 'failed'}`)
    }
  }

  if (p.yahoo && nse) {
    try {
      const history = await fetchStockHistory(nse, p.yahoo.range, p.yahoo.interval)
      const candles: Candle[] = history.points.map((point) => {
        const t = Date.parse(`${point.date}T00:00:00+05:30`)
        return { t, o: point.close, h: point.close, l: point.close, c: point.close, v: 0 }
      })
      if (candles.length >= 2) return await finish(candles, 'yahoo', false)
      attempts.push('yahoo: no bars')
    } catch (err: any) {
      attempts.push(`yahoo: ${err?.message || 'failed'}`)
    }
  }

  const error = new Error(
    upstox || nse
      ? `No price history for ${symbol.toUpperCase()} (${attempts.join('; ') || 'no provider answered'})`
      : `${symbol.toUpperCase()} is not an NSE-listed symbol this app can chart`
  )
  ;(error as any).attempts = attempts
  throw error
}

/**
 * Daily closes for the last ~month, for tile sparklines and previous closes.
 * Cached for an hour: the shape of a month barely moves intraday.
 */
export async function fetchRecentCloses(symbol: string, days = 45): Promise<Candle[]> {
  const { upstox, nse } = instrumentKeys(symbol)
  if (upstox) {
    try {
      const candles = await upstoxCandles(upstox, 'days', 1, daysAgo(days), new Date(), 3600)
      if (candles.length >= 2) return candles
    } catch {
      // fall through to the next provider
    }
  }
  if (nse) {
    try {
      return await moneycontrolCandles(nse, '1D', daysAgo(days), new Date(), days, 3600)
    } catch {
      // no series; the caller renders the tile without a sparkline
    }
  }
  return []
}

export type { UpstoxUnit, McResolution }
