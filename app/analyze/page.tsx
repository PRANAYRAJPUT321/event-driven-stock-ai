'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import type { User } from '@supabase/supabase-js'

interface NewsSource {
  id: string
  title: string
  description: string | null
  url: string
  source: string
  event_type: string | null
}

const EXAMPLES = [
  'RBI raises repo rate by 25 basis points',
  'Crude oil prices surge 10%',
  'Major tech company announces Q3 earnings beat',
  'Budget announcement increases tax on FDI',
]

function AnalyzeForm() {
  const [eventText, setEventText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newsSource, setNewsSource] = useState<NewsSource | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const newsId = searchParams.get('news_id')
  const supabase = createClient()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      setUser(session.user)
    }
    init()
  }, [])

  useEffect(() => {
    if (!newsId) return
    const loadNews = async () => {
      const { data } = await supabase.from('news_feeds').select('*').eq('id', newsId).single()
      if (data) {
        setNewsSource(data)
        setEventText(`${data.title}${data.description ? '\n\n' + data.description : ''}`)
      }
    }
    loadNews()
  }, [newsId])

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!eventText.trim()) {
      setError('Please enter an event')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventText }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Analysis failed')
      router.push(`/events/${data.analysisId}`)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
      <div className="max-w-3xl mx-auto fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Step 01 · Event input</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-2">Analyze a Financial Event</h1>
        <p className="text-ink-muted mb-8 text-sm">
          Every recommendation this platform produces is tied to a specific event — never a generic stock call.
        </p>

        <div className="panel-elevated p-7 shadow-panel">
          {newsSource && (
            <div className="bg-accent-dim/40 border-l-2 border-accent rounded-lg p-4 mb-6">
              <p className="text-[10px] text-accent-bright font-mono uppercase tracking-wide mb-1">Analyzing from live news source</p>
              <p className="font-semibold text-ink text-sm">{newsSource.title}</p>
              <a
                href={newsSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-bright hover:underline text-xs mt-1.5 inline-block"
              >
                {newsSource.source} — read full article →
              </a>
            </div>
          )}

          {error && (
            <div className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleAnalyze} className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-2 uppercase tracking-wide">Financial Event</label>
              <textarea
                value={eventText}
                onChange={(e) => setEventText(e.target.value)}
                placeholder="Example: RBI increases repo rate by 25 basis points to control inflation"
                className="w-full h-32 px-4 py-3 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent resize-none transition"
              />
              <p className="text-ink-faint text-xs mt-2">Paste news, a press release, or describe the event in your own words</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold py-3 px-6 rounded-lg transition"
            >
              {loading ? 'Classifying event, scoring stocks…' : 'Analyze Event'}
            </button>
          </form>

          {!newsSource && (
            <div className="mt-10 pt-8 border-t border-border">
              <h3 className="font-semibold text-ink text-sm mb-4">Recent Events</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {EXAMPLES.map((event, idx) => (
                  <button
                    key={idx}
                    onClick={() => setEventText(event)}
                    className="text-left p-3 bg-surface border border-border rounded-lg hover:border-border-bright hover:bg-surface-hover transition"
                  >
                    <p className="text-sm text-ink-muted">{event}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 text-center">
            <button onClick={() => router.push('/discover')} className="text-accent-bright hover:underline text-sm font-medium">
              Or browse live market news →
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default function Analyze() {
  return (
    <Suspense fallback={<div className="min-h-screen grid-backdrop flex items-center justify-center text-ink-muted">Loading…</div>}>
      <AnalyzeForm />
    </Suspense>
  )
}
