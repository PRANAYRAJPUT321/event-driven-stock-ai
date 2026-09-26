'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { MarketQuote, QuoteCategory } from '@/lib/market/yahooFinance'

const CATEGORY_ORDER: QuoteCategory[] = ['domestic', 'international', 'commodity', 'currency']

const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  domestic: 'India',
  international: 'Global',
  commodity: 'Commodities',
  currency: 'Currencies',
}

const REFRESH_MS = 60000

function formatPrice(q: MarketQuote): string {
  // FX pairs and sub-10 instruments need more precision than an index does,
  // otherwise USD/INR renders as a flat "88.00" all day.
  const digits = q.price < 10 ? 4 : 2
  return q.price.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/**
 * The live market bar: domestic and international indices, commodities and FX,
 * fetched server-side from Yahoo Finance (no API key) and refreshed on a timer.
 *
 * Rendered inside the sticky app header, so it's present on every page.
 */
export default function MarketBar() {
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Remembers the previous price per symbol so a refresh can flash the cells
  // that actually moved, rather than re-animating the whole bar.
  const previous = useRef<Record<string, number>>({})
  const [moved, setMoved] = useState<Record<string, 'up' | 'down'>>({})

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const response = await fetch('/api/market/live')
        const data = await response.json()
        if (!active) return
        if (!response.ok) {
          setError(data.error || 'Live market data unavailable')
          return
        }

        const next: Record<string, 'up' | 'down'> = {}
        for (const q of data.quotes as MarketQuote[]) {
          const before = previous.current[q.symbol]
          if (before !== undefined && before !== q.price) {
            next[q.symbol] = q.price > before ? 'up' : 'down'
          }
          previous.current[q.symbol] = q.price
        }

        setQuotes(data.quotes)
        setFetchedAt(data.fetchedAt)
        setMoved(next)
        setError(null)
      } catch (err: any) {
        if (active) setError(err?.message || 'Live market data unavailable')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (loading) {
    return (
      <div className="border-t border-border bg-surface/95 px-4 py-2 flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-4 w-28 flex-shrink-0" />
        ))}
      </div>
    )
  }

  if (error && quotes.length === 0) {
    return (
      <div className="border-t border-border bg-surface/95 px-4 py-1.5 text-[11px] text-ink-faint font-mono truncate">
        Market bar offline — {error}
      </div>
    )
  }

  // Group in a fixed order so the bar always reads India → Global →
  // Commodities → Currencies, whatever order the API happened to resolve in.
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: quotes.filter((q) => q.category === category),
  })).filter((g) => g.items.length > 0)

  const strip = (
    <>
      {grouped.map(({ category, items }) => (
        <span key={category} className="flex items-center flex-shrink-0">
          <span className="px-4 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            {CATEGORY_LABELS[category]}
          </span>
          {items.map((q) => {
            const up = q.changePct >= 0
            return (
              <span
                key={q.symbol}
                className={`flex items-center gap-2 px-3 flex-shrink-0 rounded ${
                  moved[q.symbol] === 'up'
                    ? 'flash-up'
                    : moved[q.symbol] === 'down'
                      ? 'flash-down'
                      : ''
                }`}
                title={`${q.name} · prev close ${q.previousClose.toFixed(2)}`}
              >
                <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                  {q.name}
                </span>
                <span className="mono-tabular text-xs text-ink">{formatPrice(q)}</span>
                <span className={`mono-tabular text-xs font-semibold ${up ? 'text-buy' : 'text-avoid'}`}>
                  {up ? '▲' : '▼'} {Math.abs(q.changePct).toFixed(2)}%
                </span>
              </span>
            )
          })}
        </span>
      ))}
    </>
  )

  return (
    <div className="border-t border-border bg-surface/95 flex items-stretch">
      <Link
        href="/markets"
        className="flex items-center gap-1.5 px-3 border-r border-border flex-shrink-0 hover:bg-surface-hover transition"
        title="Open the full markets view"
      >
        <span className="live-dot" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hidden sm:inline">
          Live
        </span>
      </Link>
      <div className="overflow-hidden flex-1 py-2">
        {/* Duplicated once so the -50% marquee translate loops seamlessly. */}
        <div className="flex whitespace-nowrap animate-marquee w-max">
          {strip}
          {strip}
        </div>
      </div>
      {fetchedAt && (
        <span className="hidden lg:flex items-center px-3 border-l border-border flex-shrink-0 font-mono text-[10px] text-ink-faint">
          {new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false })}
        </span>
      )}
    </div>
  )
}
