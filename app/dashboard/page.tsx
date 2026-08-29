'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import { getSimulatedPrice } from '@/lib/market/mockData'

interface RecentAnalysis {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  created_at: string
}

interface SectorTilt {
  sector: string
  count: number
  buy: number
  hold: number
  avoid: number
  tilt: number // (buy - avoid) / count, -1..1
}

const NAV_CARDS = [
  {
    href: '/analyze',
    title: 'Analyze New Event',
    desc: 'Enter a financial event and get a deterministic, event-driven recommendation.',
    tag: 'Core',
  },
  {
    href: '/discover',
    title: 'Discover Market News',
    desc: 'Live, AI-categorized financial headlines — pick one and trace its impact.',
    tag: 'Live feed',
  },
  {
    href: '/watchlist',
    title: 'My Watchlist',
    desc: 'Stocks you are tracking, with their most recent event-driven score.',
    tag: 'Tracking',
  },
  {
    href: '/history',
    title: 'Analysis History',
    desc: 'Every event you have analyzed, filterable by recommendation.',
    tag: 'Archive',
  },
]

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [recent, setRecent] = useState<RecentAnalysis[]>([])
  const [stats, setStats] = useState({ total: 0, buy: 0, hold: 0, avoid: 0, avgScore: 0 })
  const [sectorTilts, setSectorTilts] = useState<SectorTilt[]>([])
  const [trackRecord, setTrackRecord] = useState<{
    total: number
    positive: number
    byRec: Record<string, { count: number; positive: number }>
  } | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      setUser(session.user)

      const { data } = await supabase
        .from('event_analysis')
        .select('id, event_title, recommendation, opportunity_score, affected_sectors, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100)

      const all = data || []
      setRecent(all.slice(0, 5))

      const buy = all.filter((r) => r.recommendation === 'BUY').length
      const hold = all.filter((r) => r.recommendation === 'HOLD').length
      const avoid = all.filter((r) => r.recommendation === 'AVOID').length
      const avgScore = all.length
        ? all.reduce((sum, r) => sum + (r.opportunity_score || 0), 0) / all.length
        : 0
      setStats({ total: all.length, buy, hold, avoid, avgScore })

      // Sector heatmap: credit every sector an analysis touched with that
      // analysis's overall recommendation, tallying how often each sector
      // has come up bullish vs. bearish across everything this user has
      // analyzed — reuses data already fetched above, no extra query.
      const bySector = new Map<string, { count: number; buy: number; hold: number; avoid: number }>()
      for (const r of all) {
        for (const sector of r.affected_sectors || []) {
          const entry = bySector.get(sector) || { count: 0, buy: 0, hold: 0, avoid: 0 }
          entry.count++
          if (r.recommendation === 'BUY') entry.buy++
          else if (r.recommendation === 'HOLD') entry.hold++
          else if (r.recommendation === 'AVOID') entry.avoid++
          bySector.set(sector, entry)
        }
      }
      const tilts: SectorTilt[] = Array.from(bySector.entries())
        .map(([sector, v]) => ({ sector, ...v, tilt: v.count ? (v.buy - v.avoid) / v.count : 0 }))
        .sort((a, b) => b.count - a.count)
      setSectorTilts(tilts)

      // Track record / calibration: how simulated paper positions (from the
      // "Simulate" action on event detail pages) actually moved against
      // this project's own deterministic price model, grouped by the
      // recommendation that prompted each one — the explainability
      // differentiator this project's README calls out, made concrete.
      const { data: positions } = await supabase
        .from('portfolio_positions')
        .select('symbol, recommendation, entry_price, entry_date')
        .eq('user_id', session.user.id)

      if (positions && positions.length > 0) {
        const byRec: Record<string, { count: number; positive: number }> = {}
        let positive = 0
        for (const p of positions) {
          const current = getSimulatedPrice(p.symbol, p.entry_price, p.entry_date)
          const isPositive = current >= p.entry_price
          if (isPositive) positive++
          const rec = p.recommendation || 'UNKNOWN'
          const entry = byRec[rec] || { count: 0, positive: 0 }
          entry.count++
          if (isPositive) entry.positive++
          byRec[rec] = entry
        }
        setTrackRecord({ total: positions.length, positive, byRec })
      }

      setLoading(false)
    }
    getUser()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen grid-backdrop flex items-center justify-center text-ink-muted font-sans">
        Loading…
      </div>
    )
  }

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="mb-8 fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Welcome back</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink">{user?.email?.split('@')[0]}</h1>
        <p className="text-ink-muted text-sm mt-1">Here&apos;s where your event-driven intelligence stands.</p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 fade-in">
        <div className="panel p-5">
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Events analyzed</p>
          <p className="font-mono text-2xl font-bold text-ink mono-tabular">{stats.total}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">Avg. opportunity score</p>
          <p className="font-mono text-2xl font-bold text-accent-bright mono-tabular">{stats.avgScore.toFixed(0)}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">BUY calls</p>
          <p className="font-mono text-2xl font-bold text-buy mono-tabular">{stats.buy}</p>
        </div>
        <div className="panel p-5">
          <p className="text-xs text-ink-faint uppercase tracking-wide mb-1">AVOID calls</p>
          <p className="font-mono text-2xl font-bold text-avoid mono-tabular">{stats.avoid}</p>
        </div>
      </div>

      {/* Nav cards */}
      <div className="grid md:grid-cols-2 gap-5 mb-8">
        {NAV_CARDS.map((card) => (
          <Link key={card.href} href={card.href}>
            <div className="panel p-7 hover:border-border-bright hover:bg-surface-hover transition cursor-pointer group h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-widest text-accent-bright border border-accent-dim rounded-full px-2 py-0.5">
                  {card.tag}
                </span>
                <span className="text-ink-faint group-hover:text-accent-bright group-hover:translate-x-0.5 transition text-sm">
                  →
                </span>
              </div>
              <h2 className="text-lg font-bold text-ink mb-1.5">{card.title}</h2>
              <p className="text-ink-muted text-sm leading-relaxed">{card.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Analyses */}
      <div className="panel p-7 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink">Recent Analyses</h2>
          {recent.length > 0 && (
            <Link href="/history" className="text-accent-bright hover:underline text-xs font-medium">
              View all →
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-ink-muted text-sm py-4">
            No analyses yet —{' '}
            <Link href="/analyze" className="text-accent-bright hover:underline">
              analyze your first event
            </Link>{' '}
            to see it here.
          </p>
        ) : (
          <div className="space-y-1">
            {recent.map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/events/${r.id}`)}
                className="w-full text-left flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover transition"
              >
                <span className="text-ink text-sm truncate mr-3">{r.event_title}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ScoreChip score={r.opportunity_score} size="sm" />
                  <RecommendationBadge rec={r.recommendation} size="sm" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Track Record */}
      {trackRecord && trackRecord.total > 0 && (
        <div className="panel p-7 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-ink">Track Record</h2>
            <Link href="/portfolio" className="text-accent-bright hover:underline text-xs font-medium">
              View portfolio →
            </Link>
          </div>
          <p className="text-ink-muted text-xs mb-5">
            Of {trackRecord.total} simulated position{trackRecord.total === 1 ? '' : 's'},{' '}
            <span className="text-buy font-semibold">
              {Math.round((trackRecord.positive / trackRecord.total) * 100)}%
            </span>{' '}
            moved positive against this project&apos;s simulated price model.
          </p>
          <div className="grid grid-cols-3 gap-4">
            {(['BUY', 'HOLD', 'AVOID'] as const).map((rec) => {
              const entry = trackRecord.byRec[rec]
              return (
                <div key={rec} className="border border-border rounded-lg p-4">
                  <RecommendationBadge rec={rec} size="sm" />
                  <p className="font-mono text-xl font-bold text-ink mono-tabular mt-2">
                    {entry ? `${Math.round((entry.positive / entry.count) * 100)}%` : '—'}
                  </p>
                  <p className="text-[10px] text-ink-faint font-mono">
                    {entry ? `${entry.positive}/${entry.count} positive` : 'no simulated positions'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sector Heatmap */}
      {sectorTilts.length > 0 && (
        <div className="panel p-7 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-ink">Sector Heatmap</h2>
            <Link href="/markets" className="text-accent-bright hover:underline text-xs font-medium">
              World markets →
            </Link>
          </div>
          <p className="text-ink-muted text-xs mb-5">
            How every sector your analyses have touched has tilted, by recommendation.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {sectorTilts.map((s) => {
              const alpha = Math.min(Math.abs(s.tilt), 1) * 0.5 + 0.08
              const [r, g, b] = s.tilt >= 0 ? [52, 211, 153] : [248, 113, 113]
              return (
                <div
                  key={s.sector}
                  style={{
                    background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
                    borderColor: `rgba(${r}, ${g}, ${b}, ${Math.min(alpha + 0.25, 0.9)})`,
                  }}
                  className="rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-panel"
                >
                  <p className="font-bold text-ink text-sm mb-1 truncate" title={s.sector}>
                    {s.sector}
                  </p>
                  <p className="text-[10px] text-ink-faint font-mono">
                    {s.count} analysis{s.count === 1 ? '' : 'es'}
                  </p>
                  <p className={`mono-tabular text-xs font-semibold mt-1 ${s.tilt >= 0 ? 'text-buy' : 'text-avoid'}`}>
                    {s.buy} BUY · {s.hold} HOLD · {s.avoid} AVOID
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="panel p-7">
        <h2 className="text-lg font-bold text-ink mb-5">How It Works</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { num: '01', title: 'Enter Event', desc: 'Paste live news or describe an event in your own words' },
            { num: '02', title: 'AI Classification', desc: 'The event is mapped to a type, variable, and direction' },
            { num: '03', title: 'Deterministic Scoring', desc: 'Fundamentals, valuation, technicals & risk are scored' },
            { num: '04', title: 'Recommendation', desc: 'A BUY / HOLD / AVOID view, with a counter-argument' },
          ].map((item) => (
            <div key={item.num}>
              <p className="font-mono text-accent-dim text-xs mb-2">{item.num}</p>
              <p className="font-semibold text-ink text-sm mb-1">{item.title}</p>
              <p className="text-xs text-ink-muted leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
