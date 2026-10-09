import { NextRequest, NextResponse } from 'next/server'
import { CHART_RANGES, fetchPriceHistory, type ChartRange } from '@/lib/market/priceHistory'
import { deriveStats } from '@/lib/market/yahooStock'

/**
 * OHLCV history for one NSE stock or Indian index over a chart range
 * (1d, 5d, 1m, 6m, ytd, 1y, 5y, max), from the first provider that answers.
 */
export const dynamic = 'force-dynamic'

/** The ranges the page used to send, mapped onto the current set. */
const LEGACY_RANGES: Record<string, ChartRange> = { '1mo': '1m', '3mo': '6m', '6mo': '6m', '2y': '5y' }

const CACHE_SECONDS: Record<ChartRange, number> = {
  '1d': 60, '5d': 300, '1m': 900, '6m': 1800, ytd: 1800, '1y': 1800, '5y': 21600, max: 86400,
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const symbol = (params.get('symbol') || '').trim()
  const rawRange = (params.get('range') || '6m').trim().toLowerCase()
  const range = (LEGACY_RANGES[rawRange] ?? rawRange) as ChartRange

  if (!symbol) {
    return NextResponse.json({ error: 'Missing required query param: symbol' }, { status: 400 })
  }
  // Validated against an allow-list rather than passed through: these shape
  // the upstream request.
  if (!(CHART_RANGES as readonly string[]).includes(range)) {
    return NextResponse.json(
      { error: `Invalid range '${rawRange}'. Allowed: ${CHART_RANGES.join(', ')}` },
      { status: 400 }
    )
  }
  if (!/^[\^A-Z0-9&.\-]{1,20}$/i.test(symbol)) {
    return NextResponse.json({ error: `Invalid symbol '${symbol}'` }, { status: 400 })
  }

  try {
    const history = await fetchPriceHistory(symbol, range)
    const points = history.candles.map((c) => ({ date: new Date(c.t).toISOString().slice(0, 10), close: c.c }))
    return NextResponse.json(
      { ...history, stats: deriveStats(points) },
      { headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS[range]}, stale-while-revalidate=900` } }
    )
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch price history'
    const status = /not an NSE-listed/.test(message) ? 404 : /timed out|timeout|abort/i.test(message) ? 504 : 502
    return NextResponse.json({ error: message, attempts: error?.attempts ?? [] }, { status })
  }
}
