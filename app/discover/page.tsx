'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

  const filtered = filter === 'All' ? news : news.filter((n) => n.detected_sectors?.includes(filter))

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <header className="bg-white shadow sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <button onClick={() => router.push('/dashboard')} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
            ← Dashboard
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {refreshing ? 'Fetching...' : '↻ Refresh News'}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Market News &amp; Events</h1>
          <p className="text-gray-600">
            Live financial news, auto-categorized by sector. Pick one and analyze its market impact.
          </p>
          {refreshMsg && (
            <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-3">
              {refreshMsg}
            </p>
          )}
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {SECTOR_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium border ${
                filter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-10 text-center text-gray-500">
            <p className="text-lg mb-2">📰 No news cached yet</p>
            <p className="text-sm mb-6">
              Tap <strong>Refresh News</strong> above to fetch and categorize the latest financial headlines.
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg"
            >
              {refreshing ? 'Fetching...' : 'Refresh News'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((item) => (
              <div key={item.id} className="bg-white rounded-lg shadow p-5 hover:shadow-md transition">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lg font-semibold text-gray-900 hover:text-blue-600 hover:underline"
                    >
                      {item.title}
                    </a>
                    {item.description && (
                      <p className="text-gray-600 text-sm mt-1.5 line-clamp-2">{item.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                      {item.event_type && (
                        <span className="bg-purple-100 text-purple-700 px-2 py-0.5 text-xs rounded-full font-medium">
                          {item.event_type.replace(/_/g, ' ')}
                        </span>
                      )}
                      {item.detected_sectors?.map((sector) => (
                        <span key={sector} className="bg-blue-100 text-blue-700 px-2 py-0.5 text-xs rounded-full">
                          {sector}
                        </span>
                      ))}
                      {item.relevance_score != null && (
                        <span className="text-xs text-gray-400 ml-1">
                          relevance {item.relevance_score.toFixed(0)}/100
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      {item.source} &middot; {item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => analyzeNews(item)}
                    className="flex-shrink-0 bg-gray-900 hover:bg-black text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    Analyze
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
