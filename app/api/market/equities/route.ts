import { NextResponse } from 'next/server'
import { fetchEquityQuotes } from '@/lib/market/yahooFinance'
import { NIFTY_50 } from '@/lib/market/indianEquities'

/**
 * Live quotes for every NIFTY 50 constituent, for the Indian-equities heatmap
 * and for the scoring engine's technical inputs.
 *
 * Keyless, like the rest of the market layer: Yahoo's chart endpoint answers
 * anonymous callers, and one edge-cached response serves every visitor for a
 * minute rather than each of them triggering fifty upstream requests.
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
            'Yahoo Finance returned no usable quotes for any NIFTY 50 constituent. ' +
            (failureReason
              ? `The upstream said: ${failureReason}`
              : 'This is usually upstream rate limiting and normally clears on its own.'),
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
