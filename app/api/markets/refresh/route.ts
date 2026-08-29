import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchGlobalIndices } from '@/lib/market/indicesProvider'
import { fetchTopCrypto } from '@/lib/market/cryptoProvider'

export async function POST(request: NextRequest) {
  try {
    // Require a logged-in user to trigger a refresh (manual button), but
    // write with the admin client since market_snapshots isn't user-owned
    // data — same shape as app/api/news/fetch/route.ts.
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const warnings: string[] = []
    let indicesCount = 0
    let cryptoCount = 0

    // Indices and crypto come from two independent providers — one failing
    // (e.g. TWELVE_DATA_API_KEY not configured yet) shouldn't block the
    // other from refreshing.
    try {
      const indices = await fetchGlobalIndices()
      if (indices.length > 0) {
        const { error } = await admin.from('market_snapshots').upsert(
          indices.map((q) => ({
            asset_type: 'index',
            symbol: q.symbol,
            name: q.name,
            region: q.region,
            price: q.price,
            change_pct: q.changePct,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: 'asset_type,symbol' }
        )
        if (error) throw new Error(error.message)
        indicesCount = indices.length
      }
    } catch (err: any) {
      warnings.push(`Indices: ${err.message}`)
    }

    try {
      const crypto = await fetchTopCrypto()
      if (crypto.length > 0) {
        const { error } = await admin.from('market_snapshots').upsert(
          crypto.map((q) => ({
            asset_type: 'crypto',
            symbol: q.symbol,
            name: q.name,
            region: null,
            price: q.price,
            change_pct: q.changePct,
            market_cap: q.marketCap,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: 'asset_type,symbol' }
        )
        if (error) throw new Error(error.message)
        cryptoCount = crypto.length
      }
    } catch (err: any) {
      warnings.push(`Crypto: ${err.message}`)
    }

    if (indicesCount === 0 && cryptoCount === 0) {
      return NextResponse.json(
        { error: warnings.join('; ') || 'Both market data sources returned nothing' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      indices: indicesCount,
      crypto: cryptoCount,
      warnings: warnings.length > 0 ? warnings : undefined,
    })
  } catch (error: any) {
    console.error('Markets refresh error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
