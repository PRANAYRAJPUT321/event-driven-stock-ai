import { NextResponse } from 'next/server'
import { fetchTopCrypto } from '@/lib/market/cryptoProvider'

// CoinGecko's public API needs no key. Proxied server-side anyway so the
// browser isn't subject to their per-IP rate limit and the response can be
// cached once at the edge for everyone. Same force-dynamic + s-maxage shape
// as /api/market/live.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 120

export async function GET() {
  try {
    const coins = await fetchTopCrypto(16)
    if (coins.length === 0) {
      return NextResponse.json({ error: 'CoinGecko returned no coins' }, { status: 502 })
    }
    return NextResponse.json(
      { coins, fetchedAt: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=600`,
        },
      }
    )
  } catch (error: any) {
    console.error('Crypto route error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch crypto prices' },
      { status: 502 }
    )
  }
}
