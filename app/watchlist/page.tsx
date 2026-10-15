'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import BackendDownNotice from '@/components/BackendDownNotice'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import Sparkline from '@/components/charts/Sparkline'
import StockSearchInput, { type StockHit } from '@/components/StockSearchInput'
import { formatPct, formatPrice } from '@/lib/format'
import type { User } from '@supabase/supabase-js'

interface AlertEvent {
  id: string
  event_title: string
  created_at: string
}

interface WatchlistRow {
  id: string
  stock_id: string
  created_at: string
  stocks: {
    symbol: string
    name: string
    sector: string | null
  } | null
  latestScore: {
    opportunity_score: number
    recommendation: string
    created_at: string
  } | null
  alerts: AlertEvent[]
}

interface Live {
  price: number
  changePct: number
  spark?: number[]
}

export default function Watchlist() {
  const router = useRouter()
  const [backendDown, setBackendDown] = useState(false)
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [rows, setRows] = useState<WatchlistRow[]>([])
  const [live, setLive] = useState<Record<string, Live>>({})
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadWatchlist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPrices(symbols: string[]) {
    if (symbols.length === 0) {
      setLive({})
      return
    }
    try {
      const r = await fetch(`/api/stocks/prices?spark=1&symbols=${encodeURIComponent(symbols.join(','))}`)
      if (r.ok) setLive((await r.json()).prices || {})
    } catch {
      // Rows show "price unavailable" rather than a stale or invented number.
    }
  }

  async function loadWatchlist() {
    setLoading(true)
    const { user, backendDown: down } = await getSessionUser()
    if (down) {
      setBackendDown(true)
      setLoading(false)
      return
    }
    if (!user) {
      router.push('/auth/login?next=/watchlist')
      return
    }
    setUser(user)

    const { data, error } = await supabase
      .from('watchlists')
      .select('id, stock_id, created_at, stocks(symbol, name, sector)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      setMessage({ tone: 'error', text: `Could not load your watchlist: ${error.message}` })
      setLoading(false)
      return
    }

    const withScores: WatchlistRow[] = await Promise.all(
      (data || []).map(async (row: any) => {
        const { data: scoreData } = await supabase
          .from('stock_scores')
          .select('opportunity_score, recommendation, created_at')
          .eq('stock_id', row.stock_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Events analysed since this stock was added that touched its sector:
        // new activity relevant to something already being tracked.
        let alerts: AlertEvent[] = []
        if (row.stocks?.sector) {
          const { data: alertData } = await supabase
            .from('event_analysis')
            .select('id, event_title, created_at')
            .eq('user_id', user.id)
            .overlaps('affected_sectors', [row.stocks.sector])
            .gt('created_at', row.created_at)
            .order('created_at', { ascending: false })
            .limit(12)
          // The same event analysed again is one alert, not three: keep the
          // most recent run of each title.
          const seen = new Set<string>()
          alerts = (alertData || [])
            .filter((a) => {
              const key = a.event_title.trim().toLowerCase()
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            .slice(0, 3)
        }
        return { ...row, latestScore: scoreData || null, alerts }
      })
    )

    setRows(withScores)
    setLoading(false)
    loadPrices(withScores.map((r) => r.stocks?.symbol).filter(Boolean) as string[])
  }

  async function handleAdd(hit: StockHit) {
    if (!user) return
    if (rows.some((r) => r.stocks?.symbol === hit.symbol)) {
      setMessage({ tone: 'ok', text: `${hit.name} is already on your watchlist.` })
      return
    }
    setAdding(true)
    setMessage(null)
    try {
      const response = await fetch('/api/stocks/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: hit.symbol }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.id) throw new Error(body.error || 'Could not add this stock')
      const { error } = await supabase.from('watchlists').insert({ user_id: user.id, stock_id: body.id })
      if (error && !/duplicate/i.test(error.message)) throw error
      setMessage({ tone: 'ok', text: `Added ${hit.name}.` })
      await loadWatchlist()
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Could not add this stock' })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(watchlistId: string) {
    setRemovingId(watchlistId)
    const { error } = await supabase.from('watchlists').delete().eq('id', watchlistId)
    if (!error) setRows((prev) => prev.filter((r) => r.id !== watchlistId))
    else setMessage({ tone: 'error', text: `Could not remove: ${error.message}` })
    setRemovingId(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (backendDown) {
    return (
      <AppShell showTicker={false}>
        <BackendDownNotice feature="Your watchlist" />
      </AppShell>
    )
  }

  const priced = rows.map((r) => live[r.stocks?.symbol ?? '']).filter(Boolean)
  const upCount = priced.filter((p) => p.changePct > 0).length
  const downCount = priced.filter((p) => p.changePct < 0).length

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="eyebrow mb-2">Tracking</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight">Watchlist</h1>
          <p className="text-ink-muted text-sm mt-1.5">
            Live prices for the companies you follow, their latest event-driven score, and new analyses touching
            their sector.
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex gap-3 text-sm">
            <span className="chip">
              {rows.length} stock{rows.length === 1 ? '' : 's'}
            </span>
            {priced.length > 0 && (
              <>
                <span className="chip text-up">▲ {upCount} up today</span>
                <span className="chip text-down">▼ {downCount} down</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel p-4 sm:p-6">
        <div className="mb-5 max-w-xl">
          <StockSearchInput onSelect={handleAdd} busy={adding} />
          {message && (
            <p className={`text-xs mt-2 ${message.tone === 'ok' ? 'text-up' : 'text-avoid'}`} role="status">
              {message.text}
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-14">
            <p className="text-4xl mb-3" aria-hidden="true">👀</p>
            <p className="text-ink text-lg font-semibold">Your watchlist is empty</p>
            <p className="text-ink-muted text-sm mt-1.5 max-w-md mx-auto">
              Search any NSE company above to start tracking it, or add the companies an event analysis surfaces.
            </p>
            <Link href="/markets" className="btn btn-ghost mt-6">
              Browse the NIFTY 50 heatmap
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const symbol = row.stocks?.symbol ?? ''
              const q = live[symbol]
              const up = (q?.changePct ?? 0) >= 0
              return (
                <li
                  key={row.id}
                  className="tile-hover rounded-xl border border-border p-4 hover:bg-surface-hover flex flex-col md:flex-row md:flex-wrap md:items-center gap-4"
                >
                  <Link href={`/stocks/${encodeURIComponent(symbol)}`} className="flex-1 min-w-0 flex items-center gap-4">
                    <span className="w-11 h-11 rounded-xl bg-surface-2 border border-border flex items-center justify-center font-mono text-[10px] font-bold text-accent flex-shrink-0">
                      {symbol.slice(0, 5)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-ink truncate">{row.stocks?.name}</span>
                        {row.stocks?.sector && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-ink-muted">{row.stocks.sector}</span>
                        )}
                      </span>
                      <span className="block text-[11px] font-mono text-ink-faint mt-0.5">
                        NSE: {symbol}
                        {row.latestScore ? ` · last scored ${row.latestScore.opportunity_score}/100` : ' · not yet scored'}
                      </span>
                    </span>
                  </Link>

                  <div className="flex items-center gap-4 md:gap-6 justify-between md:justify-end">
                    {q?.spark && q.spark.length > 1 && (
                      <Sparkline values={q.spark} positive={up} width={96} height={32} />
                    )}
                    <div className="text-right min-w-[92px]">
                      {q ? (
                        <>
                          <p className="mono-tabular text-base font-semibold text-ink">₹{formatPrice(q.price)}</p>
                          <p className={`mono-tabular text-xs font-semibold ${up ? 'text-up' : 'text-down'}`}>
                            {up ? '▲' : '▼'} {formatPct(q.changePct)}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-ink-faint">price loading…</p>
                      )}
                    </div>
                    {row.latestScore && <RecommendationBadge rec={row.latestScore.recommendation} size="sm" />}
                    <button
                      onClick={() => handleRemove(row.id)}
                      disabled={removingId === row.id}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-ink-muted hover:border-avoid-dim hover:text-avoid disabled:opacity-50 transition"
                      aria-label={`Remove ${row.stocks?.name} from watchlist`}
                    >
                      {removingId === row.id ? '…' : 'Remove'}
                    </button>
                  </div>

                  {row.alerts.length > 0 && (
                    <div className="md:basis-full flex flex-wrap gap-1.5 md:order-last min-w-0">
                      {row.alerts.map((a) => (
                        <Link
                          key={a.id}
                          href={`/events/${a.id}`}
                          title={a.event_title}
                          className="max-w-full truncate text-[11px] bg-surface-2 border border-accent-dim text-accent px-2.5 py-1 rounded-full hover:bg-surface-hover transition"
                        >
                          🔔 {a.event_title}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
