'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'

interface RecentAnalysis {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  created_at: string
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [recent, setRecent] = useState<RecentAnalysis[]>([])
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
        .limit(5)

      setRecent(data || [])
      setLoading(false)
    }
    getUser()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📊 MarketAI</h1>
            <p className="text-gray-600 text-sm">Event-Driven Stock Intelligence</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-700">Welcome, {user?.email}</span>
            <button
              onClick={handleLogout}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Analyze Event Card */}
          <Link href="/analyze">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition cursor-pointer">
              <div className="text-4xl mb-4">⚡</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Analyze New Event</h2>
              <p className="text-gray-600">Enter a financial event and get AI-powered stock recommendations</p>
            </div>
          </Link>

          {/* Watchlist Card */}
          <Link href="/watchlist">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition cursor-pointer">
              <div className="text-4xl mb-4">⭐</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">My Watchlist</h2>
              <p className="text-gray-600">Track your favorite stocks and recent event-driven analyses</p>
            </div>
          </Link>

          {/* History Card */}
          <Link href="/history">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition cursor-pointer">
              <div className="text-4xl mb-4">📋</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Analysis History</h2>
              <p className="text-gray-600">View all your past event analyses and recommendations</p>
            </div>
          </Link>

          {/* Settings Card */}
          <Link href="/settings">
            <div className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition cursor-pointer">
              <div className="text-4xl mb-4">⚙️</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Settings</h2>
              <p className="text-gray-600">Manage your profile and preferences</p>
            </div>
          </Link>
        </div>

        {/* Recent Analyses */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Recent Analyses</h2>
            {recent.length > 0 && (
              <Link href="/history" className="text-blue-600 hover:underline text-sm font-medium">
                View all →
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="text-gray-500 text-sm py-4">
              No analyses yet — <Link href="/analyze" className="text-blue-600 hover:underline">analyze your first event</Link> to see it here.
            </p>
          ) : (
            <div className="space-y-2">
              {recent.map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/events/${r.id}`)}
                  className="w-full text-left flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition"
                >
                  <span className="text-gray-800 text-sm">{r.event_title}</span>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-bold">
                      {(r.opportunity_score || 0).toFixed(0)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      r.recommendation === 'BUY' ? 'bg-green-100 text-green-800' :
                      r.recommendation === 'HOLD' ? 'bg-yellow-100 text-yellow-800' :
                      r.recommendation === 'AVOID' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {r.recommendation || 'PENDING'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { num: '1', title: 'Enter Event', desc: 'Paste financial news or select from suggestions' },
              { num: '2', title: 'AI Analysis', desc: 'System classifies and analyzes the event' },
              { num: '3', title: 'Stock Impact', desc: 'Identifies affected stocks and sectors' },
              { num: '4', title: 'Recommendation', desc: 'Get BUY/HOLD/AVOID views with reasoning' },
            ].map((item) => (
              <div key={item.num} className="text-center">
                <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold mx-auto mb-2">
                  {item.num}
                </div>
                <p className="font-semibold text-gray-900">{item.title}</p>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
