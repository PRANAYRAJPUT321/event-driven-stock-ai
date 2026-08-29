'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import type { User } from '@supabase/supabase-js'

interface Snapshot {
  id: string
  asset_type: 'index' | 'crypto'
  symbol: string
  name: string
  region: string | null
  price: number | null
  change_pct: number | null
  market_cap: number | null
  fetched_at: string
}

type Tab = 'index' | 'crypto'

// Heat intensity scales with |change_pct| up to this cap, so a routine ±0.3%
// index move and a routine ±5% crypto move both read as "mild" rather than
// crypto tiles being permanently maxed-out red/green.
const MAX_ABS_PCT: Record<Tab, number> = { index: 3, crypto: 8 }

function heatStyle(changePct: number | null, tab: Tab): React.CSSProperties {
  const pct = changePct ?? 0
  const alpha = Math.min(Math.abs(pct) / MAX_ABS_PCT[tab], 1) * 0.5 + 0.08
  const [r, g, b] = pct >= 0 ? [52, 211, 153] : [248, 113, 113]
  return {
    background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    borderColor: `rgba(${r}, ${g}, ${b}, ${Math.min(alpha + 0.25, 0.9)})`,
  }
}

function formatMarketCap(cap: number | null): string {
  if (!cap) return ''
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`
  return `$${cap.toFixed(0)}`
}

export default function Markets() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [tab, setTab] = useState<Tab>('index')

  useEffect(() => {
    loadSnapshots()
  }, [])

  async function loadSnapshots() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/login')
      return
    }
    setUser(user)

    const { data } = await supabase
      .from('market_snapshots')
      .select('*')
      .order('asset_type', { ascending: true })
      .order('market_cap', { ascending: false, nullsFirst: false })

    setSnapshots(data || [])
    setLoading(false)
  }

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const response = await fetch('/api/markets/refresh', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) {
        setRefreshMsg(result.error || 'Refresh failed')
      } else {
        const parts = [`${result.indices} indices`, `${result.crypto} crypto assets`]
        setRefreshMsg(
          `Updated ${parts.join(', ')}.` + (result.warnings ? ` (${result.warnings.join('; ')})` : '')
        )
        await loadSnapshots()
      }
    } catch (err: any) {
      setRefreshMsg(err.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const indices = snapshots.filter((s) => s.asset_type === 'index')
  const crypto = snapshots.filter((s) => s.asset_type === 'crypto')
  const active = tab === 'index' ? indices : crypto
  const lastUpdated = snapshots[0]?.fetched_at

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Global markets</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Indices &amp; Crypto Heatmap</h1>
          <p className="text-ink-muted text-sm">
            World indices and top crypto by market cap, color-scaled by 24h move.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex-shrink-0 bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold px-4 py-2.5 rounded-lg text-sm transition"
        >
          {refreshing ? 'Fetching…' : '↻ Refresh Markets'}
        </button>
      </div>

      {refreshMsg && (
        <p className="text-sm text-accent-bright bg-accent-dim/40 border border-accent-dim rounded-lg px-3 py-2 mb-6">
          {refreshMsg}
        </p>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['index', 'crypto'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                tab === t
                  ? 'bg-accent text-[#0a0d14] border-accent'
                  : 'bg-surface text-ink-muted border-border hover:border-border-bright'
              }`}
            >
              {t === 'index' ? `Indices (${indices.length})` : `Crypto (${crypto.length})`}
            </button>
          ))}
        </div>
        {lastUpdated && (
          <span className="text-[10px] font-mono text-ink-faint hidden sm:inline">
            Updated {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-faint">Loading…</div>
      ) : active.length === 0 ? (
        <div className="panel p-10 text-center text-ink-muted">
          <p className="text-lg mb-2 text-ink">No market data cached yet</p>
          <p className="text-sm mb-6">
            Tap <strong className="text-ink">Refresh Markets</strong> above to pull live
            {tab === 'index' ? ' index' : ' crypto'} data.
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold px-6 py-2 rounded-lg transition"
          >
            {refreshing ? 'Fetching…' : 'Refresh Markets'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {active.map((s) => (
            <div
              key={s.id}
              style={heatStyle(s.change_pct, tab)}
              className="rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-panel"
            >
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-faint mb-1">
                {s.region || s.symbol}
              </p>
              <p className="font-bold text-ink text-sm mb-2 truncate" title={s.name}>
                {s.name}
              </p>
              <p className="mono-tabular text-lg font-bold text-ink">
                {tab === 'crypto' && s.price != null && s.price < 1
                  ? s.price.toFixed(4)
                  : s.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
              <p className={`mono-tabular text-sm font-semibold ${(s.change_pct ?? 0) >= 0 ? 'text-buy' : 'text-avoid'}`}>
                {(s.change_pct ?? 0) >= 0 ? '+' : ''}
                {s.change_pct?.toFixed(2)}%
              </p>
              {s.market_cap != null && s.market_cap > 0 && (
                <p className="text-[10px] text-ink-faint mt-1 font-mono">{formatMarketCap(s.market_cap)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  )
}
