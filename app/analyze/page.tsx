'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAppSession, isGuestMode } from '@/lib/appSession'
import { saveGuestAnalysis } from '@/lib/guestDb'
import AnalysisResult, { type AnalysisPayload } from '@/components/AnalysisResult'
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

/** Prompts, not news: each one exercises a different transmission channel. */
const EXAMPLES = [
  'RBI cuts the repo rate by 25 basis points to support growth',
  'Brent crude jumps 10% after supply cuts in the Middle East',
  'Infosys Q2 profit beats estimates and raises guidance',
  'Rupee falls past 97 against the US dollar',
  'Government raises capital-expenditure outlay in the Union Budget',
  'US Fed signals higher-for-longer interest rates',
  'Monsoon rainfall forecast at 105% of the long-period average',
  'Sensex falls 1,000 points on heavy foreign selling',
]

/** Longest event the engine accepts; the API refuses anything longer. */
const MAX_EVENT_LENGTH = 2000

function AnalyzeForm() {
  const [eventText, setEventText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Companies a refused text named, offered as a way forward.
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string }[]>([])
  const [newsSource, setNewsSource] = useState<NewsSource | null>(null)
  // Set when an analysis completed but could not be stored — the result is
  // rendered in place instead of redirecting to a saved page that does not
  // exist.
  const [unsavedResult, setUnsavedResult] = useState<AnalysisPayload | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const newsId = searchParams.get('news_id')
  // Discover passes the headline itself when it is showing live, unstored
  // items that have no database row to look up.
  const presetEvent = searchParams.get('event')
  const supabase = createClient()

  useEffect(() => {
    const init = async () => {
      // No guard here: the analysis engine is deterministic and needs no
      // database, so this page works signed out and while Supabase is down.
      // The session only decides whether the result can be saved.
      const { user: sessionUser } = await getAppSession()
      setUser(sessionUser)
    }
    init()
  }, [])

  useEffect(() => {
    if (presetEvent) {
      setEventText(presetEvent)
      return
    }
    if (!newsId) return
    const loadNews = async () => {
      const { data } = await supabase.from('news_feeds').select('*').eq('id', newsId).single()
      if (data) {
        setNewsSource(data)
        setEventText(`${data.title}${data.description ? '\n\n' + data.description : ''}`)
      }
    }
    loadNews()
  }, [newsId, presetEvent])

  const handleAnalyze = async (e: React.FormEvent, symbols?: string[]) => {
    e.preventDefault()
    if (!eventText.trim()) {
      setError('Please enter an event')
      return
    }

    setLoading(true)
    setError('')
    setSuggestions([])

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: eventText,
          ...(symbols && symbols.length > 0 ? { symbols } : {}),
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
        throw new Error(data.error || 'The analysis could not be completed. Please try again.')
      }
      if (data.persisted && data.analysisId) {
        router.push(`/events/${data.analysisId}`)
        return
      }
      // Guest: kept in this browser, and opened exactly like a saved one.
      if (isGuestMode() && data.result) {
        router.push(`/events/${await saveGuestAnalysis(data.result)}`)
        return
      }
      // No database to save to — show the result rather than discarding it.
      setUnsavedResult(data.result)
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

  if (unsavedResult) {
    return (
      <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => setUnsavedResult(null)}
            className="text-xs text-ink-muted hover:text-accent mb-4 transition"
          >
            ← Analyze another event
          </button>
          <AnalysisResult
            payload={unsavedResult}
            onReanalyse={(symbols) =>
              handleAnalyze({ preventDefault: () => {} } as React.FormEvent, symbols)
            }
            reanalysing={loading}
          />
        </div>
      </AppShell>
    )
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
            <div role="alert" className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-6 text-sm">
              <p>{error}</p>
              {suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <a
                      key={s.symbol}
                      href={`/stocks/${encodeURIComponent(s.symbol)}`}
                      className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink hover:border-accent hover:text-accent transition"
                    >
                      Open {s.name} →
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleAnalyze} className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-2 uppercase tracking-wide">Financial Event</label>
              <textarea
                value={eventText}
                maxLength={MAX_EVENT_LENGTH}
                onChange={(e) => {
                  setEventText(e.target.value)
                  if (error) setError('')
                }}
                placeholder="Example: RBI increases repo rate by 25 basis points to control inflation"
                className="w-full h-32 px-4 py-3 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent resize-none transition"
              />
              <div className="flex items-start justify-between gap-3 mt-2">
                <p className="text-ink-faint text-xs">
                  Describe something that happened — a policy decision, a price move, company results — or paste a headline.
                </p>
                {eventText.length > MAX_EVENT_LENGTH * 0.8 && (
                  <span className="text-ink-faint text-xs font-mono shrink-0">
                    {eventText.length}/{MAX_EVENT_LENGTH}
                  </span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !eventText.trim()}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-on-accent font-semibold py-3 px-6 rounded-lg transition"
            >
              {loading ? 'Classifying event, scoring stocks…' : 'Analyze Event'}
            </button>
          </form>

          {!newsSource && (
            <div className="mt-10 pt-8 border-t border-border">
              <h3 className="font-semibold text-ink text-sm mb-1">Try an example</h3>
              <p className="text-xs text-ink-faint mb-4">Each one moves the economy through a different channel.</p>
              <div className="grid md:grid-cols-2 gap-3">
                {EXAMPLES.map((event, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setEventText(event)
                      setError('')
                      setSuggestions([])
                    }}
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
