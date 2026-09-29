'use client'

import { useEffect, useState } from 'react'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import BackendDownNotice from '@/components/BackendDownNotice'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import ScoreGauge from '@/components/charts/ScoreGauge'
import TransmissionFlow from '@/components/charts/TransmissionFlow'
import ReturnSparkline from '@/components/charts/ReturnSparkline'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import NewsImpactPanel from '@/components/NewsImpactPanel'
import type { User } from '@supabase/supabase-js'
import type { MarketQuote } from '@/lib/market/yahooFinance'

interface StockScore {
  id: string
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

interface ClassificationJson {
  event_type: string
  economic_variable: string
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  transmission_explanation?: string
}

// Event types/economic variables where showing live global-market context
// alongside the AI's own transmission-mechanism explanation actually
// grounds the narrative in something real, rather than every event getting
// a market strip whether it's relevant or not.
const GLOBAL_CONTEXT_TRIGGERS = new Set(['GLOBAL_MARKET_SHOCK', 'CURRENCY', 'OIL_PRICE'])

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
  analysis_json: ClassificationJson | null
  created_at: string
}

const RISK_STYLE: Record<string, string> = {
  LOW: 'text-buy bg-buy-dim border-buy-dim',
  MODERATE: 'text-hold bg-hold-dim border-hold-dim',
  HIGH: 'text-avoid bg-avoid-dim border-avoid-dim',
  VERY_HIGH: 'text-avoid bg-avoid-dim border-avoid-dim',
}

export default function EventDetails({ params }: { params: { id: string } }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [stocks, setStocks] = useState<StockScore[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set())
  const [watchingId, setWatchingId] = useState<string | null>(null)
  const [positionedIds, setPositionedIds] = useState<Set<string>>(new Set())
  const [positioningId, setPositioningId] = useState<string | null>(null)
  const [marketContext, setMarketContext] = useState<MarketQuote[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()
  const [backendDown, setBackendDown] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const { user, backendDown: down } = await getSessionUser()
        if (down) {
          setBackendDown(true)
          setLoading(false)
          return
        }
        if (!user) {
          router.push('/auth/login')
          return
        }
        setUserId(user.id)
        setUser(user)

        const { data: analysisData } = await supabase
          .from('event_analysis')
          .select('*')
          .eq('id', params.id)
          .single()

        if (analysisData) {
          setAnalysis(analysisData)

          const [{ data: stockData }, { data: savedRow }, { data: watchRows }, { data: positionRows }] = await Promise.all([
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
            supabase.from('watchlists').select('stock_id').eq('user_id', user.id),
            supabase
              .from('portfolio_positions')
              .select('stock_scores_id')
              .eq('event_analysis_id', params.id)
              .eq('user_id', user.id),
          ])

          setStocks(stockData || [])
          setSaved(!!savedRow)
          setWatchedIds(new Set((watchRows || []).map((w: any) => w.stock_id)))
          setPositionedIds(new Set((positionRows || []).map((p: any) => p.stock_scores_id)))
        }
      } catch (error) {
        console.error('Error fetching analysis:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAnalysis()
  }, [params.id])

  useEffect(() => {
    const classification = analysis?.analysis_json
    if (!classification) return
    const triggered =
      GLOBAL_CONTEXT_TRIGGERS.has(classification.event_type) ||
      GLOBAL_CONTEXT_TRIGGERS.has(classification.economic_variable)
    if (!triggered) return

    async function loadMarketContext() {
      // Live from the keyless market endpoint rather than a cached table, so
      // the context shown next to an event is today's market, not whenever
      // someone last pressed a refresh button.
      try {
        const response = await fetch('/api/market/live')
        if (!response.ok) return
        const data = await response.json()
        const indices = ((data.quotes || []) as MarketQuote[]).filter(
          (q) => q.category === 'domestic' || q.category === 'international'
        )
        // Biggest absolute movers first — those are the ones worth showing.
        const sorted = [...indices].sort(
          (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)
        )
        setMarketContext(sorted.slice(0, 4))
      } catch {
        // Context is supplementary; a failure here must not break the page.
      }
    }

    loadMarketContext()
  }, [analysis])

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
    const { error } = await supabase.from('watchlists').insert({ user_id: userId, stock_id: stockId })
    if (!error) setWatchedIds((prev) => new Set(prev).add(stockId))
    setWatchingId(null)
  }

  async function handleSimulate(stock: StockScore) {
    if (!userId || !analysis || positionedIds.has(stock.id)) return
    setPositioningId(stock.id)
    // The entry price of a paper position has to be a real one — this used to
    // be getMockTechnical(), a hash of the ticker, which made every recorded
    // position and its later P&L fictional from the moment it was created.
    let entryPrice: number | null = null
    try {
      const response = await fetch(
        `/api/stocks/prices?symbols=${encodeURIComponent(stock.stock_symbol)}`
      )
      if (response.ok) {
        const data = await response.json()
        entryPrice = data.prices?.[stock.stock_symbol.toUpperCase()]?.price ?? null
      }
    } catch {
      // Handled below.
    }
    if (entryPrice === null) {
      setPositioningId(null)
      alert(
        `Could not fetch a live price for ${stock.stock_symbol}, so this position was not opened. ` +
          'Recording it at a made-up entry price would make its P&L meaningless.'
      )
      return
    }
    const { error } = await supabase.from('portfolio_positions').insert({
      user_id: userId,
      stock_scores_id: stock.id,
      event_analysis_id: analysis.id,
      stock_id: stock.stock_id,
      symbol: stock.stock_symbol,
      recommendation: stock.recommendation,
      entry_price: entryPrice,
    })
    if (!error) setPositionedIds((prev) => new Set(prev).add(stock.id))
    setPositioningId(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Supabase unreachable: this page's content lives in Postgres, so
  // there is nothing to show and nowhere useful to redirect to.
  if (backendDown) {
    return (
      <AppShell showTicker={false}>
        <BackendDownNotice feature="This analysis" />
      </AppShell>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen grid-backdrop flex items-center justify-center font-sans">
        <div className="text-center">
          <div className="live-dot mx-auto mb-4" />
          <p className="text-ink-muted text-sm">Loading analysis…</p>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="min-h-screen grid-backdrop flex items-center justify-center font-sans">
        <div className="text-center">
          <p className="text-avoid mb-4">Analysis not found</p>
          <button onClick={() => router.push('/dashboard')} className="text-accent-bright hover:underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const classification = analysis.analysis_json
  const topStock = stocks[0]

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
      <div className="flex justify-end items-center gap-3 mb-4">
        <button
          onClick={() => router.push('/portfolio')}
          className="text-accent-bright hover:underline text-sm font-medium"
        >
          View Portfolio →
        </button>
        <button
          onClick={handleSaveAnalysis}
          disabled={saved || saving}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            saved
              ? 'bg-buy-dim text-buy border border-buy-dim cursor-default'
              : 'bg-accent hover:bg-accent-bright text-on-accent disabled:opacity-50'
          }`}
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Analysis'}
        </button>
      </div>

      {/* Event Summary */}
      <div className="panel-elevated p-8 mb-6 fade-in">
        <div className="flex flex-col lg:flex-row lg:items-center gap-8">
          <div className="flex-1">
            <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">
              {new Date(analysis.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-4 leading-snug">{analysis.event_title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <RecommendationBadge rec={analysis.recommendation} />
              {analysis.affected_sectors?.map((sector) => (
                <span key={sector} className="bg-surface text-ink-muted border border-border px-2.5 py-1 rounded-full text-xs">
                  {sector}
                </span>
              ))}
            </div>
          </div>
          <ScoreGauge score={analysis.opportunity_score || 0} />
        </div>
      </div>

      {/* Transmission Mechanism */}
      {classification && (
        <div className="panel p-7 mb-6 fade-in">
          <h2 className="text-sm font-bold text-ink mb-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Transmission Mechanism
          </h2>
          <p className="text-xs text-ink-faint mb-2">How this event is expected to reach the stock price</p>
          <TransmissionFlow
            eventType={classification.event_type}
            economicVariable={classification.economic_variable}
            direction={classification.direction}
            sectors={analysis.affected_sectors || []}
            stockSymbol={topStock?.stock_symbol}
            explanation={classification.transmission_explanation}
          />
        </div>
      )}

      {/* Global Market Context */}
      {marketContext.length > 0 && (
        <div className="panel p-7 mb-6 fade-in">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-ink flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Global Market Context
            </h2>
            <button onClick={() => router.push('/markets')} className="text-[10px] text-accent-bright hover:underline">
              Full heatmap →
            </button>
          </div>
          <p className="text-xs text-ink-faint mb-4">
            This event&apos;s classification ({classification?.economic_variable || classification?.event_type}) is
            the kind that transmits through world markets — here&apos;s where the major indices are right now.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {marketContext.map((q) => (
              <div key={q.symbol} className="border border-border rounded-lg p-3 tile-hover">
                <p className="font-mono text-[10px] text-ink-faint uppercase truncate">
                  {q.category === 'domestic' ? 'India' : 'Global'}
                </p>
                <p className="font-semibold text-ink text-xs truncate" title={q.name}>
                  {q.name}
                </p>
                <p className={`mono-tabular text-sm font-bold ${q.changePct >= 0 ? 'text-buy' : 'text-avoid'}`}>
                  {q.changePct >= 0 ? '+' : ''}
                  {q.changePct.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live news impact: the mechanism above, checked against what is
          actually being published about those sectors and companies. */}
      <NewsImpactPanel
        sectors={analysis.affected_sectors || []}
        companies={stocks.slice(0, 3).map((stock) => ({ symbol: stock.stock_symbol }))}
      />

      {/* Historical Event Evidence */}
      {analysis.historical_summary && analysis.historical_summary.matchCount > 0 && (
        <div className="panel p-7 mb-6 fade-in">
          <h2 className="text-sm font-bold text-ink mb-1">Historical Event Evidence</h2>
          <p className="text-ink-faint text-xs mb-5">
            Based on {analysis.historical_summary.matchCount} similar historical event(s) — average measured market reaction
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-3">NIFTY 50 Average Return</p>
              <ReturnSparkline
                points={[
                  analysis.historical_summary.avgNiftyReturn.d1,
                  analysis.historical_summary.avgNiftyReturn.d3,
                  analysis.historical_summary.avgNiftyReturn.d5,
                  analysis.historical_summary.avgNiftyReturn.d20,
                ]}
                labels={['1D', '3D', '5D', '20D']}
                color="var(--accent-bright)"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-muted mb-3">Sector Average Return</p>
              <ReturnSparkline
                points={[
                  analysis.historical_summary.avgSectorReturn.d1,
                  analysis.historical_summary.avgSectorReturn.d3,
                  analysis.historical_summary.avgSectorReturn.d5,
                  analysis.historical_summary.avgSectorReturn.d20,
                ]}
                labels={['1D', '3D', '5D', '20D']}
                color={
                  analysis.historical_summary.avgSectorReturn.d5 >= 0 ? 'var(--buy)' : 'var(--avoid)'
                }
              />
            </div>
          </div>
          {analysis.historical_summary.sampleEvents?.length > 0 && (
            <p className="text-[11px] text-ink-faint mt-5 pt-4 border-t border-border">
              Reference events: {analysis.historical_summary.sampleEvents.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Bull/Bear Case */}
      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="panel p-6 border-l-2" style={{ borderLeftColor: 'var(--buy)' }}>
          <h3 className="font-bold text-buy mb-3 text-sm flex items-center gap-2">
            <span>▲</span> Bull Case
          </h3>
          <p className="text-ink-muted text-sm leading-relaxed">
            {analysis.bull_case || 'Positive factors support this investment thesis…'}
          </p>
        </div>
        <div className="panel p-6 border-l-2" style={{ borderLeftColor: 'var(--avoid)' }}>
          <h3 className="font-bold text-avoid mb-3 text-sm flex items-center gap-2">
            <span>▼</span> Bear Case
          </h3>
          <p className="text-ink-muted text-sm leading-relaxed">
            {analysis.bear_case || 'Downside risks and contrarian arguments…'}
          </p>
        </div>
      </div>

      {/* Contradictory Evidence */}
      {analysis.contradictory_evidence && (
        <div className="panel p-6 mb-6">
          <h3 className="font-bold text-ink mb-2 text-sm">Contradictory Evidence</h3>
          <p className="text-ink-muted text-sm leading-relaxed">{analysis.contradictory_evidence}</p>
        </div>
      )}

      {/* Key Risks */}
      {analysis.risks && analysis.risks.length > 0 && (
        <div className="panel p-6 mb-6 border-l-2" style={{ borderLeftColor: 'var(--hold)' }}>
          <h3 className="font-bold text-hold mb-3 text-sm">Key Risks</h3>
          <ul className="space-y-2">
            {analysis.risks.map((risk: string, idx: number) => (
              <li key={idx} className="text-ink-muted text-sm flex items-start">
                <span className="mr-2 text-hold">•</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top Affected Stocks */}
      <div className="panel p-7 mb-6">
        <h2 className="text-lg font-bold text-ink mb-6">Top Affected Stocks</h2>

        {stocks.length > 0 ? (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Stock</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Score</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">View</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Confidence</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Fundamentals</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Valuation</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Technical</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Risk</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Watch</th>
                  <th className="text-center py-3 px-2 text-ink-faint font-medium text-xs uppercase tracking-wide">Simulate</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock, idx) => (
                  <tr key={idx} className="border-b border-border hover:bg-surface-hover transition">
                    <td className="py-4 px-2">
                      <button
                        onClick={() => router.push(`/stocks/${stock.stock_symbol}`)}
                        className="font-mono font-semibold text-ink hover:text-accent-bright hover:underline"
                      >
                        {stock.stock_symbol}
                      </button>
                    </td>
                    <td className="py-4 px-2 text-center">
                      <ScoreChip score={stock.opportunity_score} size="sm" />
                    </td>
                    <td className="py-4 px-2 text-center">
                      <RecommendationBadge rec={stock.recommendation} size="sm" />
                    </td>
                    <td className="py-4 px-2 text-center text-ink-muted font-mono">{(stock.confidence || 0).toFixed(0)}%</td>
                    <td className="py-4 px-2 text-center text-ink-muted font-mono">{(stock.fundamental_score || 0).toFixed(0)}</td>
                    <td className="py-4 px-2 text-center text-ink-muted font-mono">{(stock.valuation_score || 0).toFixed(0)}</td>
                    <td className="py-4 px-2 text-center text-ink-muted font-mono">{(stock.technical_score || 0).toFixed(0)}</td>
                    <td className="py-4 px-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          RISK_STYLE[stock.risk_level] || 'text-ink-faint bg-surface-2 border-border'
                        }`}
                      >
                        {stock.risk_level || 'N/A'}
                      </span>
                    </td>
                    <td className="py-4 px-2 text-center">
                      <button
                        onClick={() => handleWatch(stock.stock_id)}
                        disabled={watchedIds.has(stock.stock_id) || watchingId === stock.stock_id}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition ${
                          watchedIds.has(stock.stock_id)
                            ? 'bg-buy-dim text-buy border-buy-dim cursor-default'
                            : 'bg-surface text-accent-bright border-border hover:border-accent-dim disabled:opacity-50'
                        }`}
                      >
                        {watchedIds.has(stock.stock_id) ? '✓ Watching' : watchingId === stock.stock_id ? '…' : '+ Watch'}
                      </button>
                    </td>
                    <td className="py-4 px-2 text-center">
                      <button
                        onClick={() => handleSimulate(stock)}
                        disabled={positionedIds.has(stock.id) || positioningId === stock.id}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition ${
                          positionedIds.has(stock.id)
                            ? 'bg-hold-dim text-hold border-hold-dim cursor-default'
                            : 'bg-surface text-accent-bright border-border hover:border-accent-dim disabled:opacity-50'
                        }`}
                      >
                        {positionedIds.has(stock.id) ? '✓ In Portfolio' : positioningId === stock.id ? '…' : '📊 Simulate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-ink-faint">
            <p>No stock scores available yet.</p>
            <p className="text-sm">Analysis is being processed…</p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="panel p-5">
        <p className="text-xs text-ink-faint leading-relaxed">
          <strong className="text-ink-muted">Disclaimer:</strong> This is an event-driven analytical view generated from
          deterministic scoring of fundamental, valuation, technical, and risk factors combined with historical event
          evidence. It is not a guarantee of future performance and should not be considered financial advice. Target
          prices are intentionally not shown — see the historical event evidence above for a range-based reference
          instead of a fabricated number. Please consult a qualified financial advisor before making investment
          decisions.
        </p>
      </div>
    </AppShell>
  )
}
