'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
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
    sector: string
    pe_ratio: number
    dividend_yield: number
  } | null
  latestScore: {
    opportunity_score: number
    recommendation: string
    created_at: string
  } | null
  alerts: AlertEvent[]
}

export default function Watchlist() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [rows, setRows] = useState<WatchlistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    loadWatchlist()
  }, [])

  async function loadWatchlist() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/login')
      return
    }
    setUser(user)

    const { data, error } = await supabase
      .from('watchlists')
      .select('id, stock_id, created_at, stocks(symbol, name, sector, pe_ratio, dividend_yield)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load watchlist:', error)
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

        // Watchlist alerts: events analyzed since this stock was added whose
        // affected sectors overlap the stock's own sector — surfaces new
        // event-driven activity relevant to something already being tracked,
        // without needing a separate "alerts" table or read/unread state.
        let alerts: AlertEvent[] = []
        if (row.stocks?.sector) {
          const { data: alertData } = await supabase
            .from('event_analysis')
            .select('id, event_title, created_at')
            .eq('user_id', user.id)
            .overlaps('affected_sectors', [row.stocks.sector])
            .gt('created_at', row.created_at)
            .order('created_at', { ascending: false })
            .limit(3)
          alerts = alertData || []
        }

        return { ...row, latestScore: scoreData || null, alerts }
      })
    )

    setRows(withScores)
    setLoading(false)
  }

  async function handleRemove(watchlistId: string) {
    setRemovingId(watchlistId)
    const { error } = await supabase.from('watchlists').delete().eq('id', watchlistId)
    if (!error) setRows((prev) => prev.filter((r) => r.id !== watchlistId))
    setRemovingId(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="mb-6 fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Tracking</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">My Watchlist</h1>
        <p className="text-ink-muted text-sm">Stocks you&apos;re tracking, with their most recent event-driven score</p>
      </div>

      <div className="panel p-7">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-ink text-lg">Your watchlist is empty</p>
            <p className="text-ink-muted text-sm mt-2">Add stocks from an event analysis to monitor them here</p>
            <button
              onClick={() => router.push('/analyze')}
              className="mt-6 bg-accent hover:bg-accent-bright text-[#0a0d14] font-semibold px-6 py-2 rounded-lg transition"
            >
              Analyze an Event
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="tile-hover flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-border rounded-lg p-4 hover:bg-surface-hover"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => row.stocks?.symbol && router.push(`/stocks/${row.stocks.symbol}`)}
                      className="font-mono font-bold text-ink hover:text-accent-bright hover:underline"
                    >
                      {row.stocks?.symbol}
                    </button>
                    <span className="text-ink-muted text-sm">{row.stocks?.name}</span>
                    <span className="bg-surface-2 text-accent-bright text-[10px] px-2 py-0.5 rounded-full border border-border">
                      {row.stocks?.sector}
                    </span>
                  </div>
                  {row.latestScore ? (
                    <p className="text-xs text-ink-faint mt-1.5 flex items-center gap-2">
                      Last analyzed: score {row.latestScore.opportunity_score}/100
                      <RecommendationBadge rec={row.latestScore.recommendation} size="sm" />
                    </p>
                  ) : (
                    <p className="text-xs text-ink-faint mt-1.5">No event analysis yet for this stock</p>
                  )}
                  {row.alerts.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {row.alerts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => router.push(`/events/${a.id}`)}
                          className="text-[10px] bg-accent-dim/40 border border-accent-dim text-accent-bright px-2 py-1 rounded-full hover:bg-accent-dim transition"
                        >
                          🔔 {a.event_title.length > 40 ? a.event_title.slice(0, 40) + '…' : a.event_title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(row.id)}
                  disabled={removingId === row.id}
                  className="text-avoid hover:text-avoid text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-avoid-dim disabled:opacity-50 transition"
                >
                  {removingId === row.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
