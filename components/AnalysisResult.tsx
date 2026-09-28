'use client'

import Link from 'next/link'
import ScoreGauge from '@/components/charts/ScoreGauge'
import TransmissionFlow from '@/components/charts/TransmissionFlow'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import NewsImpactPanel from '@/components/NewsImpactPanel'

export interface AnalysisPayload {
  eventTitle: string
  classification: {
    event_type: string
    economic_variable: string
    direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
    magnitude: number
    confidence: number
    affected_sectors: string[]
    reasoning: string
    transmission_explanation: string
  }
  historical: {
    matchCount: number
    avgSectorReturn: { d5: number }
    avgNiftyReturn: { d5: number }
  } | null
  counterArgument: {
    bullCase: string
    bearCase: string
    contradictoryEvidence: string
    keyRisks: string[]
    finalReasoning: string
  } | null
  stocks: {
    symbol: string
    name: string
    sector: string
    fundamentalScore: number
    valuationScore: number
    technicalScore: number
    riskScore: number
    riskLevel: string
    opportunityScore: number
    recommendation: string
  }[]
}

/**
 * Renders a completed analysis that was never written to the database.
 *
 * The engine is fully deterministic, so it produces a real answer whether or
 * not there is anywhere to store it. This view shows that answer, and is
 * explicit that it is not saved — the alternative (refusing to analyse
 * because the database is asleep) withholds a result the app already has.
 */
export default function AnalysisResult({ payload }: { payload: AnalysisPayload }) {
  const { classification, historical, counterArgument, stocks } = payload
  const top = stocks[0]

  return (
    <div className="fade-in">
      <div className="panel-elevated shadow-panel p-6 mb-6 flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-hold">Not saved</span>
        <p className="text-sm text-ink-muted flex-1 min-w-[260px]">
          This analysis ran without a database, so it is not in your history and cannot be
          watchlisted. Sign in with the database available and run it again to keep it.
        </p>
        <a
          href="/api/health"
          className="text-xs border border-border text-ink-muted hover:text-accent hover:border-accent-dim px-3 py-1.5 rounded-lg transition"
        >
          Why?
        </a>
      </div>

      <p className="text-xs font-mono uppercase tracking-widest text-accent mb-2">Event analysis</p>
      <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-6">{payload.eventTitle}</h1>

      <div className="panel p-7 mb-6 flex flex-wrap items-center gap-8">
        <ScoreGauge score={top?.opportunityScore ?? classification.magnitude} />
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-3 mb-3">
            <RecommendationBadge rec={top?.recommendation ?? null} />
            {top && <span className="font-mono text-sm text-ink">{top.symbol}</span>}
            <span className="text-xs text-ink-faint font-mono">
              confidence {classification.confidence}/100
            </span>
          </div>
          <p className="text-sm text-ink-muted leading-relaxed">{classification.reasoning}</p>
        </div>
      </div>

      <div className="panel p-7 mb-6">
        <h2 className="text-sm font-bold text-ink mb-4">Transmission Mechanism</h2>
        <TransmissionFlow
          eventType={classification.event_type}
          economicVariable={classification.economic_variable}
          direction={classification.direction}
          sectors={classification.affected_sectors || []}
          stockSymbol={top?.symbol}
          explanation={classification.transmission_explanation}
        />
      </div>

      {historical && historical.matchCount > 0 && (
        <div className="panel p-7 mb-6">
          <h2 className="text-sm font-bold text-ink mb-1">Historical Event Evidence</h2>
          <p className="text-ink-faint text-xs mb-4">
            Across {historical.matchCount} similar past event(s), measured 5-day reaction.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <div className="border border-border rounded-lg p-4">
              <p className="text-[10px] text-ink-faint uppercase tracking-wide mb-1">Sector 5d</p>
              <p className="mono-tabular text-lg font-bold text-ink">
                {historical.avgSectorReturn.d5}%
              </p>
            </div>
            <div className="border border-border rounded-lg p-4">
              <p className="text-[10px] text-ink-faint uppercase tracking-wide mb-1">NIFTY 5d</p>
              <p className="mono-tabular text-lg font-bold text-ink">
                {historical.avgNiftyReturn.d5}%
              </p>
            </div>
          </div>
        </div>
      )}

      {counterArgument && (
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="panel p-7">
            <h2 className="text-sm font-bold text-buy mb-3">Bull Case</h2>
            <p className="text-sm text-ink-muted leading-relaxed">{counterArgument.bullCase}</p>
          </div>
          <div className="panel p-7">
            <h2 className="text-sm font-bold text-avoid mb-3">Bear Case</h2>
            <p className="text-sm text-ink-muted leading-relaxed">{counterArgument.bearCase}</p>
          </div>
          <div className="panel p-7 md:col-span-2">
            <h2 className="text-sm font-bold text-hold mb-3">Contradictory Evidence</h2>
            <p className="text-sm text-ink-muted leading-relaxed mb-5">
              {counterArgument.contradictoryEvidence}
            </p>
            <h3 className="text-xs font-bold text-ink uppercase tracking-wide mb-2">Key Risks</h3>
            <ul className="space-y-1.5">
              {counterArgument.keyRisks.map((risk, i) => (
                <li key={i} className="text-sm text-ink-muted flex gap-2">
                  <span className="text-avoid flex-shrink-0">•</span>
                  {risk}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="panel p-7 mb-6">
        <h2 className="text-sm font-bold text-ink mb-4">Scored Stocks ({stocks.length})</h2>
        <div className="space-y-2">
          {stocks.map((stock) => (
            <Link
              key={stock.symbol}
              href={`/stocks/${stock.symbol}`}
              className="flex flex-wrap items-center gap-3 border border-border rounded-lg p-4 tile-hover"
            >
              <div className="min-w-[150px] flex-1">
                <p className="font-mono text-sm font-bold text-ink">{stock.symbol}</p>
                <p className="text-xs text-ink-faint truncate">
                  {stock.name} · {stock.sector}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ScoreChip score={stock.fundamentalScore} size="sm" />
                <ScoreChip score={stock.valuationScore} size="sm" />
                <ScoreChip score={stock.technicalScore} size="sm" />
                <ScoreChip score={stock.riskScore} size="sm" />
              </div>
              <div className="flex items-center gap-3 ml-auto">
                <span className="mono-tabular text-lg font-bold text-ink">
                  {stock.opportunityScore}
                </span>
                <RecommendationBadge rec={stock.recommendation} size="sm" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      <NewsImpactPanel
        sectors={classification.affected_sectors || []}
        companies={stocks.slice(0, 3).map((s) => ({ symbol: s.symbol, name: s.name }))}
      />
    </div>
  )
}
