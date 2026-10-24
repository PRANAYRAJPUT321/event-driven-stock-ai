'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { db, getAppSession, isGuestMode } from '@/lib/appSession'
import BackendDownNotice from '@/components/BackendDownNotice'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import { formatDateIST } from '@/lib/format'
import { isStaleGuestAnalysis, refreshGuestAnalysis } from '@/lib/guestDb'
import type { User } from '@supabase/supabase-js'

interface AnalysisRow {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  affected_sectors: string[] | null
  created_at: string
  engine_version?: number
  invalid_reason?: string | null
}

const FILTERS = ['ALL', 'BUY', 'HOLD', 'AVOID'] as const

export default function History() {
  const router = useRouter()
  const [backendDown, setBackendDown] = useState(false)
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [rows, setRows] = useState<AnalysisRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL')
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function handleRemove(id: string, title: string) {
    if (!window.confirm(`Remove “${title.slice(0, 80)}” from your history?`)) return
    setRemoveError(null)
    await db().from('stock_scores').delete().eq('event_analysis_id', id)
    const { error } = await db().from('event_analysis').delete().eq('id', id)
    if (error) setRemoveError(`Could not remove it: ${error.message}`)
    else setRows((prev) => prev.filter((r) => r.id !== id))
  }

  useEffect(() => {
    const load = async () => {
      const { user } = await getAppSession()
      setUser(user)

      const query = () =>
        db()
          .from('event_analysis')
          .select('id, event_title, recommendation, opportunity_score, affected_sectors, created_at, engine_version, invalid_reason')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
      const { data, error } = await query()

      if (!error) setRows(data || [])
      setLoading(false)

      // Analyses this browser saved with an earlier engine are re-run in the
      // background, one at a time, so the list shows today's answers.
      const stale = ((data || []) as AnalysisRow[]).filter(isStaleGuestAnalysis)
      if (isGuestMode() && stale.length > 0) {
        for (const row of stale.slice(0, 12)) await refreshGuestAnalysis(row)
        const { data: fresh } = await query()
        setRows(fresh || [])
      }
    }
    load()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.recommendation === filter)

  // Supabase unreachable: this page's content lives in Postgres, so
  // there is nothing to show and nowhere useful to redirect to.
  if (backendDown) {
    return (
      <AppShell showTicker={false}>
        <BackendDownNotice feature="Your saved analyses" />
      </AppShell>
    )
  }

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
                ? 'bg-accent text-on-accent border-accent'
                : 'bg-surface text-ink-muted border-border hover:border-border-bright'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="panel p-7">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-ink text-lg">{rows.length === 0 ? 'No analyses yet' : 'No analyses match this filter'}</p>
            {rows.length === 0 && (
              <button
                onClick={() => router.push('/analyze')}
                className="mt-6 bg-accent hover:bg-accent-bright text-on-accent font-semibold px-6 py-2 rounded-lg transition"
              >
                Analyze First Event
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {removeError && <p className="text-xs text-avoid mb-2" role="status">{removeError}</p>}
            {filtered.map((row) => (
              <div
                key={row.id}
                className="tile-hover w-full flex items-center justify-between border border-border rounded-lg hover:bg-surface-hover"
              >
                <button
                  onClick={() => router.push(`/events/${row.id}`)}
                  className="min-w-0 flex-1 flex items-center justify-between text-left p-4"
                >
                <div className="min-w-0">
                  <p className="font-semibold text-ink line-clamp-2 sm:line-clamp-1 break-words" title={row.event_title}>{row.event_title}</p>
                  <p className="text-xs text-ink-faint mt-1">
                    {row.affected_sectors?.join(', ') || 'No sectors identified'} &middot;{' '}
                    {formatDateIST(Date.parse(row.created_at))}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {row.invalid_reason ? (
                    <span className="text-[11px] font-mono uppercase tracking-wide text-hold" title={row.invalid_reason}>
                      Not an event
                    </span>
                  ) : (
                    <>
                      <ScoreChip score={row.opportunity_score} size="sm" />
                      <RecommendationBadge rec={row.recommendation} size="sm" />
                    </>
                  )}
                </div>
                </button>
                <button
                  onClick={() => handleRemove(row.id, row.event_title)}
                  className="flex-shrink-0 self-stretch px-3 sm:px-4 text-ink-faint hover:text-avoid border-l border-border transition"
                  aria-label={`Remove ${row.event_title} from history`}
                  title="Remove from history"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
