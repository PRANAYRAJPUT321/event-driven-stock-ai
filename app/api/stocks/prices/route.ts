import { NextRequest, NextResponse } from 'next/server'
import { fetchEquityQuotes } from '@/lib/market/yahooFinance'

/**
 * Current prices for a caller-supplied list of NSE symbols.
 *
 * Exists so the paper portfolio can be marked to the real market. It used to
 * be valued with lib/market/mockData.ts's getSimulatedPrice — a seeded random
 * walk forward from the entry price — which meant the "track record" the
 * dashboard reported was a simulation presented as a result.
 */
export const dynamic = 'force-dynamic'

const MAX_SYMBOLS = 40
const REVALIDATE_SECONDS = 60

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('symbols') || ''
  const symbols = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, MAX_SYMBOLS)

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'Provide a comma-separated symbols list' }, { status: 400 })
  }

  try {
    const { quotes, failed, fetchedAt } = await fetchEquityQuotes(
      symbols.map((symbol) => ({ symbol, name: symbol, sector: '' })),
      REVALIDATE_SECONDS
    )

    // Keyed by symbol so callers can look up without scanning.
    const prices: Record<string, { price: number; changePct: number }> = {}
    for (const quote of quotes) {
      prices[quote.symbol] = { price: quote.price, changePct: quote.changePct }
    }

    return NextResponse.json(
      { prices, failed, fetchedAt },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=300`,
        },
      }
    )
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch prices' }, { status: 502 })
  }
}
