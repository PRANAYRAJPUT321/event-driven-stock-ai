/**
 * Keyless quotes from Yahoo Finance — now the last provider tried.
 *
 * Yahoo's chart, spark and quote endpoints were this app's only market feed
 * until they began refusing Vercel's servers with HTTP 429 on every request.
 * TradingView's screener and Upstox now serve quotes and history (see
 * lib/market/quotes.ts and priceHistory.ts); this module remains as a
 * fallback because it still answers from most other networks and costs
 * nothing to try.
 *
 * It is an unofficial, undocumented endpoint: it can rate-limit, change field
 * names, or go away. Everything here is therefore read defensively.
 *
 * Must only be called server-side (the endpoint sends no CORS headers).
 */

import {
  DEFAULT_CONCURRENCY,
  fetchQuotesBatch,
  fetchSparkBatch,
  mapWithConcurrency,
  yahooRequest,
  YAHOO_HOSTS,
  type BatchQuote,
} from './yahooClient'
import { fetchStooqDaily, fetchStooqQuotes, type StooqQuote } from './stooq'
import type { MarketQuote, QuoteCategory, QuoteSource, TrackedSymbol } from './types'

export type { MarketQuote, QuoteCategory, QuoteSource, TrackedSymbol } from './types'

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
export function parseChart(
  body: any,
  tracked: TrackedSymbol,
  source: QuoteSource = 'yahoo-chart'
): MarketQuote | null {
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
    source,
    spark: closes.map(num).filter((c): c is number => c !== null),
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
    source: 'yahoo-quote',
  }
}

/** Where the next throttled sweep begins. See the rotation note below. */
let fallbackCursor = 0

/** Previous closes keyed by NSE symbol. Valid for the session, not the minute. */
const stooqPrevClose = new Map<string, { value: number; series: number[]; at: number }>()
const PREV_CLOSE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Builds a quote from Stooq's price plus a previous close taken from its daily
 * series. The series is cached for hours because it only moves once a day, so
 * a refresh costs one batched request rather than one per symbol.
 */
async function fromStooq(
  tracked: TrackedSymbol,
  nseSymbol: string,
  row: StooqQuote
): Promise<MarketQuote | null> {
  let cached = stooqPrevClose.get(nseSymbol)
  if (!cached || Date.now() - cached.at > PREV_CLOSE_TTL_MS) {
    const series = await fetchStooqDaily(nseSymbol)
    if (series.length >= 2) {
      cached = { value: series[series.length - 2], series, at: Date.now() }
      stooqPrevClose.set(nseSymbol, cached)
    }
  }

  // No previous close means no honest percentage, so this symbol is left to
  // the next provider rather than shown with a fabricated move.
  if (!cached) return null

  const change = row.price - cached.value
  return {
    symbol: tracked.symbol,
    name: tracked.name,
    category: tracked.category,
    price: row.price,
    previousClose: cached.value,
    change,
    changePct: cached.value !== 0 ? (change / cached.value) * 100 : 0,
    currency: 'INR',
    asOf: row.asOf,
    source: 'stooq',
    spark: cached.series.slice(-30),
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
export async function resolveYahooQuotes(
  tracked: TrackedSymbol[],
  revalidateSeconds: number
): Promise<{ quotes: MarketQuote[]; failed: string[]; failureReason?: string }> {
  const quotes: MarketQuote[] = []
  const failed: string[] = []
  let failureReason: string | undefined

  let pending = tracked

  // 1. Spark first: one request per forty symbols, no session required. This
  //    is the path that keeps the grid inside Yahoo's tolerance.
  try {
    const spark = await fetchSparkBatch(
      tracked.map((t) => t.symbol),
      '5d',
      '1d',
      revalidateSeconds
    )
    if (spark) {
      const remaining: TrackedSymbol[] = []
      for (const t of pending) {
        const payload = spark.get(t.symbol)
        const quote = payload ? parseChart(payload, t, 'yahoo-spark') : null
        if (quote) quotes.push(quote)
        else remaining.push(t)
      }
      pending = remaining
    }
  } catch (err: any) {
    failureReason ??= `spark batch failed: ${err?.message || 'unknown error'}`
  }

  // 2. Stooq, for whatever spark did not answer for. A different company on
  //    different infrastructure, so a bad day at Yahoo is not an outage here.
  //    Only equities carry the .NS suffix this can map; indices and futures
  //    are left to the Yahoo paths.
  if (pending.length > 0) {
    const mappable = pending.filter((t) => t.symbol.endsWith('.NS'))
    if (mappable.length > 0) {
      try {
        const nseFor = new Map(mappable.map((t) => [t.symbol, t.symbol.replace(/\.NS$/, '')]))
        const rows = await fetchStooqQuotes(Array.from(nseFor.values()))
        if (rows.size > 0) {
          const resolved = await mapWithConcurrency(mappable, DEFAULT_CONCURRENCY, async (t) => {
            const nse = nseFor.get(t.symbol)!
            const row = rows.get(nse)
            return row ? await fromStooq(t, nse, row) : null
          })
          const got = new Set<string>()
          resolved.forEach((outcome, i) => {
            if (outcome.status === 'fulfilled' && outcome.value) {
              quotes.push(outcome.value)
              got.add(mappable[i].symbol)
            }
          })
          if (got.size > 0) pending = pending.filter((t) => !got.has(t.symbol))
        }
      } catch (err: any) {
        failureReason ??= `stooq failed: ${err?.message || 'unknown error'}`
      }
    }
  }

  // 3. The crumbed quote endpoint, for whatever is still missing.
  //    Kept because it carries fields spark does not and still works from
  //    some networks, but it is no longer the only batch path.
  if (pending.length > 0) {
    try {
      const batch = await fetchQuotesBatch(pending.map((t) => t.symbol))
      if (batch) {
        const remaining: TrackedSymbol[] = []
        for (const t of pending) {
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
  }

  // 4. Last resort: one request per symbol, throttled — and rotated.
  //
  //    Rotation matters more than it looks. An upstream that accepts only the
  //    first few requests of each burst will otherwise answer the same few
  //    symbols forever, because the list is always walked in the same order:
  //    the first five tiles fill and the other forty-seven never get a turn,
  //    however long you wait. Starting at a moving offset gives every symbol
  //    its share, so with the per-symbol memory above the grid fills in over
  //    successive refreshes instead of being permanently five tiles wide.
  if (pending.length > 0) {
    const offset = fallbackCursor % pending.length
    fallbackCursor = (fallbackCursor + Math.max(1, DEFAULT_CONCURRENCY)) % Math.max(1, pending.length)
    const rotated = [...pending.slice(offset), ...pending.slice(0, offset)]

    const settled = await mapWithConcurrency(rotated, DEFAULT_CONCURRENCY, (t) =>
      fetchOne(t, revalidateSeconds)
    )
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') quotes.push(outcome.value)
      else {
        failed.push(rotated[i].symbol)
        failureReason ??= String((outcome.reason as any)?.message ?? outcome.reason)
      }
    })
  }

  return { quotes, failed, failureReason }
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
