'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface StockScore {
  stock_id: string
  stock_symbol: string
  opportunity_score: number
  recommendation: string
  confidence: number
  fundamental_score: number
  valuation_score: number
  technical_score: number
  risk_score: number
  risk_level: string
}

interface HistoricalSummary {
  matchCount: number
  avgNiftyReturn: { d1: number; d3: number; d5: number; d20: number }
  avgSectorReturn: { d1: number; d3: number; d5: number; d20: number }
  sampleEvents: string[]
}

interface Analysis {
  id: string
  event_title: string
  affected_sectors: string[]
  opportunity_score: number
  recommendation: string
  bull_case: string
  bear_case: string
  contradictory_evidence: string
  risks: string[]
  historical_summary: HistoricalSummary | null
  created_at: string
}

export default function EventDetails({ params }: { params: { id: string } }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [stocks, setStocks] = useState<StockScore[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set())
  const [watchingId, setWatchingId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/auth/login')
          return
        }
        setUserId(user.id)

        const { data: analysisData } = await supabase
          .from('event_analysis')
          .select('*')
          .eq('id', params.id)
          .single()

        if (analysisData) {
          setAnalysis(analysisData)

          const [{ data: stockData }, { data: savedRow }, { data: watchRows }] = await Promise.all([
            supabase
              .from('stock_scores')
              .select('*')
              .eq('event_analysis_id', params.id)
              .order('opportunity_score', { ascending: false })
              .limit(10),
            supabase
              .from('saved_analyses')
              .select('id')
              .eq('event_analysis_id', params.id)
              .eq('user_id', user.id)
              .maybeSingle(),
            supabase
              .from('watchlists')
              .select('stock_id')
              .eq('user_id', user.id),
          ])

          setStocks(stockData || [])
          setSaved(!!savedRow)
          setWatchedIds(new Set((watchRows || []).map((w: any) => w.stock_id)))
        }
      } catch (error) {
        console.error('Error fetching analysis:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnalysis()
  }, [params.id])

  async function handleSaveAnalysis() {
    if (!userId || !analysis || saved) return
    setSaving(true)
    const { error } = await supabase.from('saved_analyses').insert({
      user_id: userId,
      event_analysis_id: analysis.id,
      title: analysis.event_title,
      is_favorite: true,
    })
    if (!error) setSaved(true)
    setSaving(false)
  }

  async function handleWatch(stockId: string) {
    if (!userId || watchedIds.has(stockId)) return
    setWatchingId(stockId)
    const { error } = await supabase.from('watchlists').insert({
      user_id: userId,
      stock_id: stockId,
    })
    if (!error) {
      setWatchedIds((prev) => new Set(prev).add(stockId))
    }
    setWatchingId(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Analyzing event...</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Analysis not found</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-blue-600 hover:underline"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            ← Dashboard
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              saved
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'
            }`}
            onClick={handleSaveAnalysis}
            disabled={saved || saving}
          >
            {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save Analysis'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Event Summary */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{analysis.event_title}</h1>
          
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-gray-600 text-sm">Score</p>
              <p className="text-3xl font-bold text-blue-600">{(analysis.opportunity_score || 0).toFixed(0)}/100</p>
            </div>
            <div className={`p-4 rounded-lg ${
              analysis.recommendation === 'BUY' ? 'bg-green-50' :
              analysis.recommendation === 'HOLD' ? 'bg-yellow-50' : 'bg-red-50'
            }`}>
              <p className="text-gray-600 text-sm">View</p>
              <p className={`text-3xl font-bold ${
                analysis.recommendation === 'BUY' ? 'text-green-600' :
                analysis.recommendation === 'HOLD' ? 'text-yellow-600' : 'text-red-600'
              }`}>{analysis.recommendation || 'N/A'}</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <p className="text-gray-600 text-sm">Sectors</p>
              <p className="text-2xl font-bold text-purple-600">{analysis.affected_sectors?.length || 0}</p>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <p className="text-gray-600 text-sm">Date</p>
              <p className="text-sm font-semibold text-orange-600">
                {new Date(analysis.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Sectors */}
          {analysis.affected_sectors && analysis.affected_sectors.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Affected Sectors</h3>
              <div className="flex flex-wrap gap-2">
                {analysis.affected_sectors.map((sector: string, idx: number) => (
                  <span key={idx} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                    {sector}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Historical Event Evidence */}
        {analysis.historical_summary && analysis.historical_summary.matchCount > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">📊 Historical Event Evidence</h2>
            <p className="text-gray-600 text-sm mb-4">
              Based on {analysis.historical_summary.matchCount} similar historical event(s), average measured market reaction:
            </p>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">NIFTY 50 Average Return</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: '1D', val: analysis.historical_summary.avgNiftyReturn.d1 },
                    { label: '3D', val: analysis.historical_summary.avgNiftyReturn.d3 },
                    { label: '5D', val: analysis.historical_summary.avgNiftyReturn.d5 },
                    { label: '20D', val: analysis.historical_summary.avgNiftyReturn.d20 },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className={`font-bold ${item.val >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.val >= 0 ? '+' : ''}{item.val}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Sector Average Return</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: '1D', val: analysis.historical_summary.avgSectorReturn.d1 },
                    { label: '3D', val: analysis.historical_summary.avgSectorReturn.d3 },
                    { label: '5D', val: analysis.historical_summary.avgSectorReturn.d5 },
                    { label: '20D', val: analysis.historical_summary.avgSectorReturn.d20 },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className={`font-bold ${item.val >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.val >= 0 ? '+' : ''}{item.val}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {analysis.historical_summary.sampleEvents?.length > 0 && (
              <p className="text-xs text-gray-500 mt-4">
                Reference events: {analysis.historical_summary.sampleEvents.join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Bull/Bear Case */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <div className="bg-green-50 border-l-4 border-green-500 rounded-lg p-6">
            <h3 className="font-bold text-green-900 mb-3">📈 Bull Case</h3>
            <p className="text-green-800 text-sm leading-relaxed">
              {analysis.bull_case || 'Positive factors support this investment thesis...'}
            </p>
          </div>

          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-6">
            <h3 className="font-bold text-red-900 mb-3">📉 Bear Case</h3>
            <p className="text-red-800 text-sm leading-relaxed">
              {analysis.bear_case || 'Downside risks and contrarian arguments...'}
            </p>
          </div>
        </div>

        {/* Contradictory Evidence */}
        {analysis.contradictory_evidence && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8">
            <h3 className="font-bold text-gray-900 mb-3">🔍 Contradictory Evidence</h3>
            <p className="text-gray-700 text-sm leading-relaxed">{analysis.contradictory_evidence}</p>
          </div>
        )}

        {/* Key Risks */}
        {analysis.risks && analysis.risks.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
            <h3 className="font-bold text-yellow-900 mb-3">⚠️ Key Risks</h3>
            <ul className="space-y-2">
              {analysis.risks.map((risk: string, idx: number) => (
                <li key={idx} className="text-yellow-800 text-sm flex items-start">
                  <span className="mr-2">•</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top Affected Stocks */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Top Affected Stocks</h2>
          
          {stocks.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 text-gray-700 font-semibold">Stock</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Score</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">View</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Confidence</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Fundamentals</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Valuation</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Technical</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Risk</th>
                    <th className="text-center py-3 px-4 text-gray-700 font-semibold">Watch</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((stock, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4 font-semibold text-gray-900">{stock.stock_symbol}</td>
                      <td className="py-4 px-4 text-center">
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-bold">
                          {(stock.opportunity_score || 0).toFixed(0)}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                          stock.recommendation === 'BUY' ? 'bg-green-100 text-green-800' :
                          stock.recommendation === 'HOLD' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {stock.recommendation || 'N/A'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center text-gray-700 font-medium">{(stock.confidence || 0).toFixed(0)}%</td>
                      <td className="py-4 px-4 text-center text-gray-700">{(stock.fundamental_score || 0).toFixed(0)}/100</td>
                      <td className="py-4 px-4 text-center text-gray-700">{(stock.valuation_score || 0).toFixed(0)}/100</td>
                      <td className="py-4 px-4 text-center text-gray-700">{(stock.technical_score || 0).toFixed(0)}/100</td>
                      <td className="py-4 px-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          stock.risk_level === 'LOW' ? 'bg-green-100 text-green-700' :
                          stock.risk_level === 'MODERATE' ? 'bg-yellow-100 text-yellow-700' :
                          stock.risk_level === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {stock.risk_level || 'N/A'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => handleWatch(stock.stock_id)}
                          disabled={watchedIds.has(stock.stock_id) || watchingId === stock.stock_id}
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            watchedIds.has(stock.stock_id)
                              ? 'bg-green-100 text-green-700 cursor-default'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50'
                          }`}
                        >
                          {watchedIds.has(stock.stock_id)
                            ? '✓ Watching'
                            : watchingId === stock.stock_id
                              ? '...'
                              : '+ Watch'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No stock scores available yet.</p>
              <p className="text-sm">Analysis is being processed...</p>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="mt-8 bg-gray-100 border border-gray-200 rounded-lg p-5">
          <p className="text-xs text-gray-600 leading-relaxed">
            <strong>Disclaimer:</strong> This is an event-driven analytical view generated from
            deterministic scoring of fundamental, valuation, technical, and risk factors combined
            with historical event evidence. It is not a guarantee of future performance and should
            not be considered financial advice. Target prices are intentionally not shown — see the
            historical event evidence above for a range-based reference instead of a fabricated
            number. Please consult a qualified financial advisor before making investment decisions.
          </p>
        </div>
      </main>
    </div>
  )
}
