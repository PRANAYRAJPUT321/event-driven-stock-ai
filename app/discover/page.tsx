'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import type { User } from '@supabase/supabase-js'

interface NewsItem {
  id: string
  title: string
  description: string | null
  url: string
  source: string
  event_type: string | null
  detected_sectors: string[] | null
  relevance_score: number | null
  published_at: string
}

const SECTOR_FILTERS = ['All', 'Banking', 'IT', 'Energy', 'Auto', 'NBFC', 'Realty', 'FMCG', 'Pharma']

export default function Discover() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    loadNews()
  }, [])

  async function loadNews() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/login')
      return
    }
    setUser(user)

    const { data } = await supabase
      .from('news_feeds')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(30)

    setNews(data || [])
    setLoading(false)
  }

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const response = await fetch('/api/news/fetch', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) {
        setRefreshMsg(result.error || 'Refresh failed')
      } else {
        setRefreshMsg(`Found ${result.inserted} new relevant item(s) from ${result.fetched} fetched`)
        await loadNews()
      }
    } catch (err: any) {
      setRefreshMsg(err.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  function analyzeNews(item: NewsItem) {
    router.push(`/analyze?news_id=${item.id}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const filtered = filter === 'All' ? news : news.filter((n) => n.detected_sectors?.includes(filter))

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Live feed</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Market News &amp; Events</h1>
          <p className="text-ink-muted text-sm">Auto-categorized by AI. Pick one and trace its market impact.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex-shrink-0 bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold px-4 py-2.5 rounded-lg text-sm transition"
        >
          {refreshing ? 'Fetching…' : '↻ Refresh News'}
        </button>
      </div>

      {refreshMsg && (
        <p className="text-sm text-accent-bright bg-accent-dim/40 border border-accent-dim rounded-lg px-3 py-2 mb-6">
          {refreshMsg}
        </p>
      )}

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {SECTOR_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition ${
              filter === s
                ? 'bg-accent text-[#0a0d14] border-accent'
                : 'bg-surface text-ink-muted border-border hover:border-border-bright'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-10 text-center text-ink-muted">
          <p className="text-lg mb-2 text-ink">No news cached yet</p>
          <p className="text-sm mb-6">
            Tap <strong className="text-ink">Refresh News</strong> above to fetch and categorize the latest financial headlines.
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold px-6 py-2 rounded-lg transition"
          >
            {refreshing ? 'Fetching…' : 'Refresh News'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div key={item.id} className="tile-hover panel p-5 hover:border-border-bright">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-semibold text-ink hover:text-accent-bright hover:underline"
                  >
                    {item.title}
                  </a>
                  {item.description && (
                    <p className="text-ink-muted text-sm mt-1.5 line-clamp-2">{item.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                    {item.event_type && (
                      <span className="bg-surface-2 text-accent-bright px-2 py-0.5 text-[10px] rounded-full font-mono uppercase tracking-wide border border-border">
                        {item.event_type.replace(/_/g, ' ')}
                      </span>
                    )}
                    {item.detected_sectors?.map((sector) => (
                      <span key={sector} className="bg-surface text-ink-muted px-2 py-0.5 text-[10px] rounded-full border border-border">
                        {sector}
                      </span>
                    ))}
                    {item.relevance_score != null && (
                      <span className="text-[10px] text-ink-faint font-mono ml-1">
                        relevance {item.relevance_score.toFixed(0)}/100
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-ink-faint mt-2 font-mono">
                    {item.source} &middot; {item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}
                  </p>
                </div>
                <button
                  onClick={() => analyzeNews(item)}
                  className="flex-shrink-0 bg-surface-2 hover:bg-accent hover:text-[#0a0d14] border border-border-bright text-ink text-sm font-medium px-4 py-2 rounded-lg transition"
                >
                  Analyze
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  )
}
