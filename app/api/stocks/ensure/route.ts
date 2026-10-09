import { NextRequest, NextResponse } from 'next/server'
import { findEquity } from '@/lib/market/indianEquities'
import { lookupEquity } from '@/lib/market/nseDirectory'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

/**
 * Returns the stocks-table id for an NSE symbol, creating the row if needed,
 * so any listed company can be watchlisted — not only the seeded NIFTY 50.
 *
 * The symbol is checked against NSE's equity list here, before anything is
 * written. The write itself goes through ensure_stock() (migration 008), a
 * narrowly scoped database function; on a database that predates it, the
 * service-role client is used if the deployment has one, and otherwise the
 * caller is told exactly what to run.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'No database is configured for this deployment.' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const symbol = String(body?.symbol || '').trim().toUpperCase()
  const constituent = findEquity(symbol)
  const listing = lookupEquity(symbol)
  if (!symbol || (!constituent && !listing)) {
    return NextResponse.json({ error: `${symbol || 'That'} is not an NSE-listed symbol.` }, { status: 404 })
  }

  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return NextResponse.json({ error: 'Sign in to build a watchlist.' }, { status: 401 })
  }

  const name = constituent?.name ?? listing!.name
  const sector = constituent?.sector ?? null

  const existing = await supabase.from('stocks').select('id').eq('symbol', symbol).maybeSingle()
  if (existing.data?.id) return NextResponse.json({ id: existing.data.id, created: false })

  const rpc = await supabase.rpc('ensure_stock', { p_symbol: symbol, p_name: name, p_sector: sector })
  if (!rpc.error && rpc.data) return NextResponse.json({ id: rpc.data, created: true })

  // The function is missing on a database set up before migration 008.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient()
    const inserted = await admin
      .from('stocks')
      .upsert({ symbol, name, sector }, { onConflict: 'symbol', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()
    const id =
      inserted.data?.id ?? (await admin.from('stocks').select('id').eq('symbol', symbol).maybeSingle()).data?.id
    if (id) return NextResponse.json({ id, created: true })
  }

  return NextResponse.json(
    {
      error:
        'This database predates watchlisting any NSE stock. Run database/schema.sql once more in the Supabase SQL editor (it is safe to re-run), then try again.',
      detail: rpc.error?.message ?? null,
    },
    { status: 503 }
  )
}
