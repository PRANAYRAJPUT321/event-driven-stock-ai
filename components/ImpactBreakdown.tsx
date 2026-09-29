'use client'

import { useEffect, useState } from 'react'

interface EntityImpact {
  entity: string
  kind: 'sector' | 'company'
  sector: string
  direction: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL'
  confidence: number
  positives: string[]
  negatives: string[]
  mechanism: string
}

interface ImpactAnalysis {
  headline: string
  eventType: string
  economicVariable: string
  overallDirection: string
  magnitude: number
  mechanism: string
  sectorImpacts: EntityImpact[]
  companyImpacts: EntityImpact[]
  unrecognised: boolean
}

const DIRECTION_STYLE: Record<string, string> = {
  POSITIVE: 'text-buy bg-buy-dim border-buy-dim',
  NEGATIVE: 'text-avoid bg-avoid-dim border-avoid-dim',
  MIXED: 'text-hold bg-hold-dim border-hold-dim',
  NEUTRAL: 'text-ink-faint bg-surface-2 border-border',
}

function DirectionBadge({ direction }: { direction: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold border font-mono tracking-wide text-[10px] px-2 py-0.5 ${
        DIRECTION_STYLE[direction] || DIRECTION_STYLE.NEUTRAL
      }`}
    >
      {direction}
    </span>
  )
}

function ImpactCard({ impact }: { impact: EntityImpact }) {
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
          {impact.kind}
        </span>
        <span className="text-sm font-bold text-ink">{impact.entity}</span>
        <DirectionBadge direction={impact.direction} />
        <span className="text-[10px] font-mono text-ink-faint ml-auto">
          confidence {impact.confidence}
        </span>
      </div>

      {impact.positives.length === 0 && impact.negatives.length === 0 ? (
        <p className="text-xs text-ink-faint">{impact.mechanism}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-buy mb-2">
              Positive for {impact.entity}
            </p>
            {impact.positives.length === 0 ? (
              <p className="text-xs text-ink-faint">
                No offsetting benefit through this channel.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {impact.positives.map((point, i) => (
                  <li key={i} className="text-xs text-ink-muted leading-relaxed flex gap-2">
                    <span className="text-buy flex-shrink-0">+</span>
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-avoid mb-2">
              Negative for {impact.entity}
            </p>
            {impact.negatives.length === 0 ? (
              <p className="text-xs text-ink-faint">No material drag through this channel.</p>
            ) : (
              <ul className="space-y-1.5">
                {impact.negatives.map((point, i) => (
                  <li key={i} className="text-xs text-ink-muted leading-relaxed flex gap-2">
                    <span className="text-avoid flex-shrink-0">−</span>
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Both sides of an event's impact, per sector and per company.
 *
 * The score above this says how attractive the opportunity is; this says what
 * would actually have to happen for that to be right, and what would make it
 * wrong — through the same mechanism, which is the part a single direction
 * arrow cannot express.
 */
export default function ImpactBreakdown({
  title,
  description,
  sectors,
  companies,
}: {
  title: string
  description?: string
  sectors: string[]
  companies?: { symbol: string; name?: string; sector?: string }[]
}) {
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'sector' | 'company'>('sector')

  const sectorKey = sectors.join(',')
  const companyKey = (companies || []).map((c) => c.symbol).join(',')

  useEffect(() => {
    let active = true
    setLoading(true)

    async function load() {
      try {
        const response = await fetch('/api/news/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, sectors, companies }),
        })
        const data = await response.json()
        if (!active) return
        if (!response.ok) {
          setError(data.error || 'Could not analyse impact')
          return
        }
        setAnalysis(data.analysis)
        setError(null)
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not analyse impact')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, sectorKey, companyKey])

  if (loading) {
    return (
      <div className="panel p-7 mb-6">
        <div className="skeleton h-5 w-48 mb-4" />
        <div className="skeleton h-24" />
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="panel p-7 mb-6">
        <h2 className="text-sm font-bold text-ink mb-2">Sector &amp; Company Impact</h2>
        <p className="text-sm text-avoid">{error || 'No impact analysis available.'}</p>
      </div>
    )
  }

  const active = view === 'sector' ? analysis.sectorImpacts : analysis.companyImpacts

  return (
    <div className="panel p-7 mb-6 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="text-sm font-bold text-ink">Sector &amp; Company Impact</h2>
        <span className="font-mono text-[10px] text-ink-faint uppercase tracking-wider">
          {analysis.eventType.replace(/_/g, ' ')} · magnitude {analysis.magnitude}/100
        </span>
      </div>
      <p className="text-xs text-ink-faint mb-4 leading-relaxed">{analysis.mechanism}</p>

      {analysis.unrecognised ? (
        <p className="text-sm text-ink-muted">
          No standard transmission channel was recognised in this event, so no directional read is
          offered. That is deliberate — a guess here would flow straight into the scores above.
        </p>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {(['sector', 'company'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  view === v
                    ? 'bg-accent text-on-accent border-accent shadow-glow'
                    : 'bg-surface text-ink-muted border-border hover:border-accent-dim'
                }`}
              >
                By {v} ({v === 'sector' ? analysis.sectorImpacts.length : analysis.companyImpacts.length})
              </button>
            ))}
          </div>

          {active.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing identified at this level.</p>
          ) : (
            <div className="space-y-3">
              {active.map((impact) => (
                <ImpactCard key={`${impact.kind}-${impact.entity}`} impact={impact} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
