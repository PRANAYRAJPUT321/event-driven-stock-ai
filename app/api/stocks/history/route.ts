import { NextRequest, NextResponse } from 'next/server'
import {
  ALLOWED_INTERVALS,
  ALLOWED_RANGES,
  deriveStats,
  fetchStockHistory,
  type HistoryInterval,
  type HistoryRange,
} from '@/lib/market/yahooStock'

// Replaces api/py/stock-history.py.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const symbol = (params.get('symbol') || '').trim()
  const range = (params.get('range') || '6mo').trim()
  const interval = (params.get('interval') || '1d').trim()

  if (!symbol) {
    return NextResponse.json({ error: 'Missing required query param: symbol' }, { status: 400 })
  }
  // Validated against an allow-list rather than passed through: these go
  // straight into the upstream URL.
  if (!(ALLOWED_RANGES as readonly string[]).includes(range)) {
    return NextResponse.json(
      { error: `Invalid range '${range}'. Allowed: ${ALLOWED_RANGES.join(', ')}` },
      { status: 400 }
    )
  }
  if (!(ALLOWED_INTERVALS as readonly string[]).includes(interval)) {
    return NextResponse.json(
      { error: `Invalid interval '${interval}'. Allowed: ${ALLOWED_INTERVALS.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const history = await fetchStockHistory(symbol, range as HistoryRange, interval as HistoryInterval)
    return NextResponse.json(
      // Stats are derived here rather than in the browser so the same numbers
      // are available to any other caller of this endpoint.
      { ...history, stats: deriveStats(history.points) },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } }
    )
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch price history'
    const status = /timed out|timeout|abort/i.test(message) ? 504 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
