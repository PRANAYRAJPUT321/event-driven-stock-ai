'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'

interface RecentAnalysis {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  created_at: string
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
        .select('id, event_title, recommendation, opportunity_score, created_at')
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
