'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.recommendation === filter)

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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Analysis History</h1>
          <p className="text-gray-600 mb-6">Every event you've analyzed, with its recommendation and score</p>

          <div className="flex gap-2 mb-8">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border ${
                  filter === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">📋 {rows.length === 0 ? 'No analyses yet' : 'No analyses match this filter'}</p>
              {rows.length === 0 && (
                <button
                  onClick={() => router.push('/analyze')}
                  className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
                >
                  Analyze First Event
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((row) => (
                <button
                  key={row.id}
                  onClick={() => router.push(`/events/${row.id}`)}
                  className="w-full text-left flex items-center justify-between border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{row.event_title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {row.affected_sectors?.join(', ') || 'No sectors identified'} &middot;{' '}
                      {new Date(row.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <span className="bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full text-xs font-bold">
                      {(row.opportunity_score || 0).toFixed(0)}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      row.recommendation === 'BUY' ? 'bg-green-100 text-green-800' :
                      row.recommendation === 'HOLD' ? 'bg-yellow-100 text-yellow-800' :
                      row.recommendation === 'AVOID' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {row.recommendation || 'PENDING'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
