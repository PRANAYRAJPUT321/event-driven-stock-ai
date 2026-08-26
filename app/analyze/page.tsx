'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface NewsSource {
  id: string
  title: string
  description: string | null
  url: string
  source: string
  event_type: string | null
}

function AnalyzeForm() {
  const [eventText, setEventText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newsSource, setNewsSource] = useState<NewsSource | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const newsId = searchParams.get('news_id')
  const supabase = createClient()

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

      if (!response.ok) throw new Error('Analysis failed')
      const data = await response.json()

      // Redirect to results page with analysis ID
      router.push(`/events/${data.analysisId}`)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-blue-600 hover:text-blue-700 text-sm"
          >
            ← Back to Dashboard
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Analyze Financial Event</h1>
          <p className="text-gray-600 mb-8">
            Enter a financial event and our AI will analyze its impact on Indian stocks
          </p>

          {newsSource && (
            <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-4 mb-6">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">
                Analyzing from news source
              </p>
              <p className="font-semibold text-gray-900 text-sm">{newsSource.title}</p>
              <a
                href={newsSource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-xs mt-1 inline-block"
              >
                {newsSource.source} — read full article →
              </a>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleAnalyze} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Financial Event
              </label>
              <textarea
                value={eventText}
                onChange={(e) => setEventText(e.target.value)}
                placeholder="Example: RBI increases repo rate by 25 basis points to control inflation"
                className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <p className="text-gray-500 text-sm mt-2">
                Paste news, press release, or describe the event in your own words
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-lg transition"
            >
              {loading ? 'Analyzing... Please wait' : 'Analyze Event'}
            </button>
          </form>

          {/* Quick Examples */}
          {!newsSource && (
            <div className="mt-12 pt-8 border-t">
              <h3 className="font-semibold text-gray-900 mb-4">Recent Events</h3>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  'RBI raises repo rate by 25 basis points',
                  'Crude oil prices surge 10%',
                  'Major tech company announces Q3 earnings beat',
                  'Budget announcement increases tax on FDI',
                ].map((event, idx) => (
                  <button
                    key={idx}
                    onClick={() => setEventText(event)}
                    className="text-left p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                  >
                    <p className="text-sm text-gray-700">{event}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => router.push('/discover')}
              className="text-blue-600 hover:underline text-sm font-medium"
            >
              Or browse live market news →
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function Analyze() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <AnalyzeForm />
    </Suspense>
  )
}
