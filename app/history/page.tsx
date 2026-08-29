'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import type { User } from '@supabase/supabase-js'

interface AnalysisRow {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  affected_sectors: string[] | null
  created_at: string
}

const FILTERS = ['ALL', 'BUY', 'HOLD', 'AVOID'] as const

export default function History() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [rows, setRows] = useState<AnalysisRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }
      setUser(user)

      const { data, error } = await supabase
        .from('event_analysis')
        .select('id, event_title, recommendation, opportunity_score, affected_sectors, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (!error) setRows(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.recommendation === filter)

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="mb-6 fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Archive</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Analysis History</h1>
        <p className="text-ink-muted text-sm">Every event you&apos;ve analyzed, with its recommendation and score</p>
      </div>

      <div className="flex gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
              filter === f
                ? 'bg-accent text-[#0a0d14] border-accent'
                : 'bg-surface text-ink-muted border-border hover:border-border-bright'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="panel p-7">
        {loading ? (
          <div className="text-center py-16 text-ink-faint">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-ink text-lg">{rows.length === 0 ? 'No analyses yet' : 'No analyses match this filter'}</p>
            {rows.length === 0 && (
              <button
                onClick={() => router.push('/analyze')}
                className="mt-6 bg-accent hover:bg-accent-bright text-[#0a0d14] font-semibold px-6 py-2 rounded-lg transition"
              >
                Analyze First Event
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <button
                key={row.id}
                onClick={() => router.push(`/events/${row.id}`)}
                className="w-full text-left flex items-center justify-between border border-border rounded-lg p-4 hover:bg-surface-hover transition"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{row.event_title}</p>
                  <p className="text-xs text-ink-faint mt-1">
                    {row.affected_sectors?.join(', ') || 'No sectors identified'} &middot;{' '}
                    {new Date(row.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <ScoreChip score={row.opportunity_score} size="sm" />
                  <RecommendationBadge rec={row.recommendation} size="sm" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
