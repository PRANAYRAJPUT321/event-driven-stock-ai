import { NextRequest, NextResponse } from 'next/server'
import { DIRECTORY_SIZE, searchDirectory } from '@/lib/market/nseDirectory'
import { HEATMAP_SYMBOLS } from '@/lib/market/quotes'

/**
 * Search across every NSE-listed company (by symbol or name) and the indices
 * the app tracks. Backs the header search and the stock page's lookup.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 60)
  const limit = Math.min(20, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 8))
  if (!q) return NextResponse.json({ query: q, companies: [], indices: [], directorySize: DIRECTORY_SIZE })

  const lower = q.toLowerCase()
  const indices = HEATMAP_SYMBOLS.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.symbol.toLowerCase().replace('^', '').startsWith(lower.replace('^', ''))
  )
    .slice(0, 4)
    .map((s) => ({ symbol: s.symbol, name: s.name, category: s.category }))

  return NextResponse.json(
    { query: q, companies: searchDirectory(q, limit), indices, directorySize: DIRECTORY_SIZE },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
  )
}
