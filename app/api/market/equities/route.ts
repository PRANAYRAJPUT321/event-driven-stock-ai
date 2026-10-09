import { NextResponse } from 'next/server'
import { fetchEquityQuotes } from '@/lib/market/quotes'
import { NIFTY_50, NIFTY_50_AS_OF } from '@/lib/market/indianEquities'

/**
 * Live quotes for every NIFTY 50 constituent, for the Indian-equities heatmap
 * and for the scoring engine's technical inputs.
 *
 * Keyless, like the rest of the market layer: one screener request covers all
 * fifty, and one edge-cached response serves every visitor for a minute.
 */
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

export async function GET() {
  try {
    const { quotes, failed, failureReason, stale, staleAgeSeconds, fromMemory, fetchedAt } = await fetchEquityQuotes(
      NIFTY_50,
      REVALIDATE_SECONDS
    )

    if (quotes.length === 0) {
      return NextResponse.json(
        {
          error:
            'No market-data provider returned a usable quote for any NIFTY 50 constituent. ' +
            (failureReason ? `The first failure: ${failureReason}` : 'It normally clears on its own within a minute.'),
          failed,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        quotes,
        failed,
        stale: stale ?? false,
        staleAgeSeconds: staleAgeSeconds ?? null,
        fromMemory: fromMemory ?? 0,
        fetchedAt,
        total: NIFTY_50.length,
        constituentsAsOf: NIFTY_50_AS_OF,
      },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=900`,
        },
      }
    )
  } catch (error: any) {
    console.error('Equities route error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch equity quotes' },
      { status: 500 }
    )
  }
}
