'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import { getSimulatedPrice } from '@/lib/market/mockData'
import type { User } from '@supabase/supabase-js'

interface Position {
  id: string
  symbol: string
  recommendation: string | null
  entry_price: number
  entry_date: string
  event_analysis_id: string | null
}

interface PositionWithPnl extends Position {
  currentPrice: number
  pnlPct: number
}

export default function Portfolio() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [positions, setPositions] = useState<PositionWithPnl[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    loadPositions()
  }, [])

  async function loadPositions() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/login')
      return
    }
    setUser(user)

    const { data } = await supabase
      .from('portfolio_positions')
      .select('id, symbol, recommendation, entry_price, entry_date, event_analysis_id')
      .eq('user_id', user.id)
      .order('entry_date', { ascending: false })

    const withPnl: PositionWithPnl[] = (data || []).map((p: Position) => {
      const currentPrice = getSimulatedPrice(p.symbol, p.entry_price, p.entry_date)
      return { ...p, currentPrice, pnlPct: ((currentPrice - p.entry_price) / p.entry_price) * 100 }
    })

    setPositions(withPnl)
    setLoading(false)
  }

  async function handleRemove(id: string) {
    setRemovingId(id)
    const { error } = await supabase.from('portfolio_positions').delete().eq('id', id)
    if (!error) setPositions((prev) => prev.filter((p) => p.id !== id))
    setRemovingId(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const positive = positions.filter((p) => p.pnlPct >= 0).length
  const avgPnl = positions.length
    ? positions.reduce((sum, p) => sum + p.pnlPct, 0) / positions.length
    : 0

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="mb-6 fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Paper trading</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Simulated Portfolio</h1>
        <p className="text-ink-muted text-sm">
          Hypothetical positions from &quot;Simulate&quot; on an event&apos;s recommended stocks, tracked against
          this project&apos;s own deterministic price model — not real market performance.
        </p>
      </div>

      {positions.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6 fade-in">
          <div className="panel p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Positions</p>
            <p className="font-mono text-2xl font-bold text-ink mono-tabular">{positions.length}</p>
          </div>
          <div className="panel p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Positive</p>
            <p className="font-mono text-2xl font-bold text-buy mono-tabular">
              {positions.length ? Math.round((positive / positions.length) * 100) : 0}%
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Avg. P&amp;L</p>
            <p className={`font-mono text-2xl font-bold mono-tabular ${avgPnl >= 0 ? 'text-buy' : 'text-avoid'}`}>
              {avgPnl >= 0 ? '+' : ''}
              {avgPnl.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      <div className="panel p-7">
        {loading ? (
          <div className="text-center py-16 text-ink-faint">Loading…</div>
        ) : positions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-ink text-lg">No simulated positions yet</p>
            <p className="text-ink-muted text-sm mt-2">
              Open an event analysis and tap &quot;Simulate&quot; on a recommended stock to track it here.
            </p>
            <button
              onClick={() => router.push('/analyze')}
              className="mt-6 bg-accent hover:bg-accent-bright text-[#0a0d14] font-semibold px-6 py-2 rounded-lg transition"
            >
              Analyze an Event
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border border-border rounded-lg p-4 hover:bg-surface-hover transition"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-ink">{p.symbol}</span>
                    <RecommendationBadge rec={p.recommendation} size="sm" />
                    {p.event_analysis_id && (
                      <button
                        onClick={() => router.push(`/events/${p.event_analysis_id}`)}
                        className="text-[10px] text-accent-bright hover:underline"
                      >
                        View analysis →
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-ink-faint mt-1.5 mono-tabular">
                    Entry ₹{p.entry_price.toFixed(2)} on {new Date(p.entry_date).toLocaleDateString()} · Simulated now ₹
                    {p.currentPrice.toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`mono-tabular text-lg font-bold ${p.pnlPct >= 0 ? 'text-buy' : 'text-avoid'}`}>
                    {p.pnlPct >= 0 ? '+' : ''}
                    {p.pnlPct.toFixed(1)}%
                  </span>
                  <button
                    onClick={() => handleRemove(p.id)}
                    disabled={removingId === p.id}
                    className="text-avoid hover:text-avoid text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-avoid-dim disabled:opacity-50 transition"
                  >
                    {removingId === p.id ? 'Removing…' : 'Close'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
