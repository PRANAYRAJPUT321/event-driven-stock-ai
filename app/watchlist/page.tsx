'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
}

export default function Watchlist() {
  const router = useRouter()
  const supabase = createClient()
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

        return { ...row, latestScore: scoreData || null }
      })
    )

    setRows(withScores)
    setLoading(false)
  }

  async function handleRemove(watchlistId: string) {
    setRemovingId(watchlistId)
    const { error } = await supabase.from('watchlists').delete().eq('id', watchlistId)
    if (!error) {
      setRows((prev) => prev.filter((r) => r.id !== watchlistId))
    }
    setRemovingId(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <header className="bg-white shadow sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button onClick={() => router.push('/dashboard')} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
            ← Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Watchlist</h1>
          <p className="text-gray-600 mb-8">Track your favorite stocks and their most recent event-driven scores</p>

          {loading ? (
            <div className="text-center py-16 text-gray-500">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">📝 Your watchlist is empty</p>
              <p className="text-sm mt-2">Add stocks from an event analysis to monitor them here</p>
              <button
                onClick={() => router.push('/analyze')}
                className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
              >
                Analyze an Event
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-900">{row.stocks?.symbol}</span>
                      <span className="text-gray-500 text-sm">{row.stocks?.name}</span>
                      <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                        {row.stocks?.sector}
                      </span>
                    </div>
                    {row.latestScore ? (
                      <p className="text-xs text-gray-500 mt-1">
                        Last analyzed: score {row.latestScore.opportunity_score}/100 &middot;{' '}
                        <span className={
                          row.latestScore.recommendation === 'BUY' ? 'text-green-600 font-semibold' :
                          row.latestScore.recommendation === 'HOLD' ? 'text-yellow-600 font-semibold' :
                          'text-red-600 font-semibold'
                        }>{row.latestScore.recommendation}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">No event analysis yet for this stock</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(row.id)}
                    disabled={removingId === row.id}
                    className="text-red-500 hover:text-red-700 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  >
                    {removingId === row.id ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
