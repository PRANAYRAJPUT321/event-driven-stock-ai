import { NextRequest, NextResponse } from 'next/server'
import { searchDirectory } from '@/lib/market/nseDirectory'
import { fetchStockProfile, UnknownSymbolError } from '@/lib/market/stockProfile'

/**
 * The full profile for one NSE stock: quote, valuation, financials,
 * technicals and returns. Public, like the other market endpoints — nothing
 * user-specific, and the response is identical for every caller.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') || '').trim()
  if (!symbol) {
    return NextResponse.json({ error: 'Missing required query param: symbol' }, { status: 400 })
  }

  try {
    const profile = await fetchStockProfile(symbol)
    return NextResponse.json(profile, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (error: any) {
    if (error instanceof UnknownSymbolError) {
      // Not a listing — offer the closest real ones instead of a dead end.
      return NextResponse.json(
        { error: error.message, suggestions: searchDirectory(symbol, 6) },
        { status: 404 }
      )
    }
    const message = error?.message || 'Failed to fetch quote'
    const status = /timed out|timeout|abort/i.test(message) ? 504 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
