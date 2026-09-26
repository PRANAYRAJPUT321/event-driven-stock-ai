import { NextRequest, NextResponse } from 'next/server'
import { fetchStockQuote } from '@/lib/market/yahooStock'

// Replaces api/py/stock-quote.py. Public, like the other market endpoints:
// nothing user-specific, and the response is identical for every caller.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') || '').trim()
  if (!symbol) {
    return NextResponse.json({ error: 'Missing required query param: symbol' }, { status: 400 })
  }

  try {
    const quote = await fetchStockQuote(symbol)
    return NextResponse.json(quote, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch quote'
    // A timeout is upstream slowness, not a bad request — keep them distinct
    // so the page can say which happened.
    const status = /timed out|timeout|abort/i.test(message) ? 504 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
