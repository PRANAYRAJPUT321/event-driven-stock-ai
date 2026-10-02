'use client'

import { useEffect, useState } from 'react'

interface ImpactItem {
  title: string
  description: string | null
  url: string
  publishedAt: string
  source: string
}

interface ImpactGroup {
  key: string
  label: string
  kind: 'sector' | 'company'
  items: ImpactItem[]
  error?: string
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Live news impact for an analysed event.
 *
 * The analysis above it explains a transmission mechanism in theory — this
 * shows what is actually being published, right now, about the sectors that
 * mechanism runs through and about the specific companies it surfaced. Fed by
 * /api/news/impact (Google News + Yahoo RSS, no API key).
 */
export default function NewsImpactPanel({
  sectors,
  companies,
}: {
  sectors: string[]
  companies: { symbol: string; name?: string }[]
}) {
  const [groups, setGroups] = useState<ImpactGroup[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  // Stringified so the effect doesn't re-run on every render just because the
  // parent rebuilt the array identity.
  const sectorKey = sectors.join(',')
  const companyKey = companies.map((c) => c.symbol).join(',')

  useEffect(() => {
    if (sectors.length === 0 && companies.length === 0) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    async function load() {
      try {
        const response = await fetch('/api/news/impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectors, companies }),
        })
        const data = await response.json()
        if (!active) return
        if (!response.ok) {
          setError(data.error || 'Could not load news impact')
          return
        }
        const loaded: ImpactGroup[] = data.groups || []
        setGroups(loaded)
        // Open on the first tab that actually has something in it.
        setActiveKey((loaded.find((g) => g.items.length > 0) || loaded[0])?.key ?? null)
        setFetchedAt(data.fetchedAt || null)
        setError(null)
      } catch (err: any) {
        if (active) setError(err?.message || 'Could not load news impact')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorKey, companyKey])

  if (!loading && !error && groups.length === 0) return null

  const active = groups.find((g) => g.key === activeKey) || null

  return (
    <div className="panel p-7 mb-6 fade-in">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-sm font-bold text-ink flex items-center gap-2">
          <span className="live-dot" />
          Live News Impact
        </h2>
        {fetchedAt && (
          <span className="font-mono text-[10px] text-ink-faint flex-shrink-0">
            {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false })}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-faint mb-5">
        What is being published right now about the sectors this event transmits through, and about
        the companies it surfaced — so you can check the mechanism above against what the market is
        actually reading.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-avoid bg-avoid-dim border border-avoid-dim rounded-lg px-3 py-2">
          {error}
        </p>
      ) : (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {groups.map((group) => (
              <button
                key={group.key}
                onClick={() => setActiveKey(group.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  group.key === activeKey
                    ? 'bg-accent text-on-accent border-accent shadow-glow'
                    : 'bg-surface text-ink-muted border-border hover:border-accent-dim'
                }`}
              >
                <span className="font-mono text-[9px] uppercase tracking-wider opacity-70 mr-1.5">
                  {group.kind}
                </span>
                {group.label}
                <span className="ml-1.5 mono-tabular opacity-70">{group.items.length}</span>
              </button>
            ))}
          </div>

          {active && active.items.length === 0 ? (
            <p className="text-sm text-ink-faint">
              {active.error
                ? `Feed unavailable for ${active.label}: ${active.error}`
                : `No recent headlines found for ${active.label}.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {active?.items.map((item, idx) => (
                <li key={`${item.url}-${idx}`}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-border rounded-lg p-3 tile-hover"
                  >
                    <p className="text-sm text-ink font-medium leading-snug">{item.title}</p>
                    <p className="font-mono text-[10px] text-ink-faint mt-1.5">
                      {item.source}
                      {relativeTime(item.publishedAt) && ` · ${relativeTime(item.publishedAt)}`}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
