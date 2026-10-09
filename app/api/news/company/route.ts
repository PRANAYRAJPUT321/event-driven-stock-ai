import { NextRequest, NextResponse } from 'next/server'
import { fetchCompanyNews } from '@/lib/news/rssNews'

/**
 * Recent headlines about one company, for its stock page. Keyless (Google
 * News and Yahoo RSS) and public — nothing user-specific is involved.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') || '').trim().toUpperCase()
  const name = (request.nextUrl.searchParams.get('name') || '').trim().slice(0, 80)
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) {
    return NextResponse.json({ error: 'Provide an NSE symbol' }, { status: 400 })
  }
  try {
    const items = await fetchCompanyNews(symbol, name || undefined, 8)
    return NextResponse.json(
      { items, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } }
    )
  } catch (error: any) {
    return NextResponse.json({ items: [], error: error?.message || 'News feed unreachable' }, { status: 502 })
  }
}
