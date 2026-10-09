'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/client'

/**
 * The app-wide search: every NSE-listed company (by symbol or name), the
 * indices the app tracks, your own saved analyses, and the app's pages — in
 * one box, reachable from the header, ⌘K / Ctrl+K, or "/".
 *
 * Typing a headline instead of a name offers to analyse it as an event, so
 * the search box doubles as the quickest way into the analysis engine.
 */

interface CompanyHit {
  symbol: string
  name: string
  sector: string | null
  inNifty50: boolean
  renamedFrom?: string
}
interface IndexHit {
  symbol: string
  name: string
  category: 'domestic' | 'international' | 'commodity' | 'currency'
}
interface AnalysisHit {
  id: string
  title: string
  recommendation: string | null
  created_at: string
}

type Item =
  | { kind: 'company'; key: string; hit: CompanyHit }
  | { kind: 'index'; key: string; hit: IndexHit }
  | { kind: 'analysis'; key: string; hit: AnalysisHit }
  | { kind: 'page'; key: string; label: string; href: string; hint: string }
  | { kind: 'event'; key: string; text: string }
  | { kind: 'recent'; key: string; hit: CompanyHit }

const PAGES = [
  { label: 'Dashboard', href: '/dashboard', hint: 'Your overview' },
  { label: 'Markets — live heatmaps', href: '/markets', hint: 'NIFTY 50, indices, commodities, FX, crypto' },
  { label: 'Analyze an event', href: '/analyze', hint: 'Event → affected companies' },
  { label: 'Discover market news', href: '/discover', hint: 'Live headlines' },
  { label: 'Watchlist', href: '/watchlist', hint: 'Stocks you track' },
  { label: 'Simulated portfolio', href: '/portfolio', hint: 'Paper positions & P&L' },
  { label: 'Analysis history', href: '/history', hint: 'Every event you analysed' },
  { label: 'Settings', href: '/settings', hint: 'Profile & preferences' },
]

const POPULAR: CompanyHit[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', inNifty50: true },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', inNifty50: true },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', inNifty50: true },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', inNifty50: true },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', inNifty50: true },
]

const INDEX_TAB: Record<IndexHit['category'], string> = {
  domestic: 'india',
  international: 'world',
  commodity: 'commodities',
  currency: 'currencies',
}

const RECENT_KEY = 'pulse-recent-searches'

function readRecent(): CompanyHit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.slice(0, 5) : []
  } catch {
    return []
  }
}

function pushRecent(hit: CompanyHit) {
  try {
    const next = [hit, ...readRecent().filter((r) => r.symbol !== hit.symbol)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Private mode or blocked storage: recents are a convenience.
  }
}

/** Bolds the part of `text` that matches the query, for scanning results quickly. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const index = text.toLowerCase().indexOf(q.toLowerCase())
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent text-accent font-bold">{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  )
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [companies, setCompanies] = useState<CompanyHit[]>([])
  const [indices, setIndices] = useState<IndexHit[]>([])
  const [analyses, setAnalyses] = useState<AnalysisHit[]>([])
  const [recent, setRecent] = useState<CompanyHit[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setRecent(readRecent())
    } else {
      setQuery('')
      setCompanies([])
      setIndices([])
      setAnalyses([])
      setActive(0)
    }
  }, [open])

  // Companies and indices from the server's NSE directory, debounced, with
  // the previous request cancelled so a slow answer never overwrites a newer one.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setCompanies([])
      setIndices([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`, { signal: controller.signal })
        const data = await response.json()
        setCompanies(data.companies || [])
        setIndices(data.indices || [])
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setCompanies([])
          setIndices([])
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 110)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open])

  // The reader's own analyses, when signed in. Row-level security already
  // limits this to their rows; a failure just leaves the section out.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 3) {
      setAnalyses([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const { user } = await getSessionUser()
        if (!user || cancelled) return
        const { data } = await createClient()
          .from('event_analysis')
          .select('id, event_title, recommendation, created_at')
          .ilike('event_title', `%${q.replace(/[%_]/g, '')}%`)
          .order('created_at', { ascending: false })
          .limit(4)
        if (!cancelled) {
          setAnalyses(
            (data || []).map((r: any) => ({
              id: r.id,
              title: r.event_title,
              recommendation: r.recommendation,
              created_at: r.created_at,
            }))
          )
        }
      } catch {
        if (!cancelled) setAnalyses([])
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, open])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    const out: Item[] = []
    if (!q) {
      for (const hit of recent) out.push({ kind: 'recent', key: `recent-${hit.symbol}`, hit })
      for (const hit of POPULAR) {
        if (!recent.some((r) => r.symbol === hit.symbol)) out.push({ kind: 'company', key: `pop-${hit.symbol}`, hit })
      }
      for (const page of PAGES) out.push({ kind: 'page', key: page.href, ...page })
      return out
    }
    for (const hit of companies) out.push({ kind: 'company', key: `co-${hit.symbol}`, hit })
    for (const hit of indices) out.push({ kind: 'index', key: `ix-${hit.symbol}`, hit })
    for (const hit of analyses) out.push({ kind: 'analysis', key: `an-${hit.id}`, hit })
    const lower = q.toLowerCase()
    for (const page of PAGES) {
      if (page.label.toLowerCase().includes(lower) || page.hint.toLowerCase().includes(lower)) {
        out.push({ kind: 'page', key: page.href, ...page })
      }
    }
    // A sentence rather than a name: offer to analyse it as an event.
    if (q.split(/\s+/).length >= 3 || companies.length === 0) {
      out.push({ kind: 'event', key: 'event', text: q })
    }
    return out
  }, [query, companies, indices, analyses, recent])

  useEffect(() => setActive(0), [items.length, query])

  const choose = useCallback(
    (item: Item | undefined) => {
      if (!item) return
      switch (item.kind) {
        case 'company':
        case 'recent':
          pushRecent(item.hit)
          router.push(`/stocks/${encodeURIComponent(item.hit.symbol)}`)
          break
        case 'index':
          router.push(`/markets?tab=${INDEX_TAB[item.hit.category]}`)
          break
        case 'analysis':
          router.push(`/events/${item.hit.id}`)
          break
        case 'page':
          router.push(item.href)
          break
        case 'event':
          router.push(`/analyze?event=${encodeURIComponent(item.text)}`)
          break
      }
      onClose()
    },
    [router, onClose]
  )

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(items.length - 1, a + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(0, a - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        choose(items[active])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, active, choose, onClose])

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const q = query.trim()
  let lastGroup = ''
  const groupOf = (item: Item): string => {
    switch (item.kind) {
      case 'recent':
        return 'Recent'
      case 'company':
        return q ? 'Companies' : 'Popular'
      case 'index':
        return 'Indices & markets'
      case 'analysis':
        return 'Your analyses'
      case 'page':
        return 'Go to'
      case 'event':
        return 'Analyse'
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[14vh] px-3 overlay-blur"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl panel-elevated shadow-panel overflow-hidden fade-in"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent flex-shrink-0" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 2,600+ NSE companies, indices, pages — or type a headline"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-ink-faint text-ink min-w-0"
            aria-label="Search"
            aria-controls="search-results"
            aria-activedescendant={items[active] ? `search-item-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          {loading && <span className="w-4 h-4 rounded-full border-2 border-accent-dim border-t-accent animate-spin flex-shrink-0" aria-hidden="true" />}
          <kbd className="hidden sm:inline text-[10px] font-mono text-ink-faint border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-1.5">
          {items.length === 0 && !loading && (
            <p className="px-4 py-8 text-sm text-ink-faint text-center">No matches for “{q}”.</p>
          )}
          {items.map((item, index) => {
            const group = groupOf(item)
            const header = group !== lastGroup ? group : null
            lastGroup = group
            const selected = index === active
            return (
              <div key={item.key}>
                {header && (
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-faint">{header}</p>
                )}
                <button
                  id={`search-item-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    selected ? 'bg-surface-hover' : ''
                  }`}
                >
                  {(item.kind === 'company' || item.kind === 'recent') && (
                    <>
                      <span className="w-9 h-9 rounded-lg bg-surface-2 border border-border flex items-center justify-center font-mono text-[10px] font-bold text-accent flex-shrink-0">
                        {item.hit.symbol.slice(0, 4)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">
                          <Highlight text={item.hit.name} query={q} />
                        </span>
                        <span className="block text-[11px] text-ink-faint font-mono truncate">
                          NSE: <Highlight text={item.hit.symbol} query={q} />
                          {item.hit.renamedFrom ? ` · formerly ${item.hit.renamedFrom}` : ''}
                          {item.hit.sector ? ` · ${item.hit.sector}` : ''}
                        </span>
                      </span>
                      {item.hit.inNifty50 && (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border border-accent-dim text-accent flex-shrink-0">
                          NIFTY 50
                        </span>
                      )}
                    </>
                  )}
                  {item.kind === 'index' && (
                    <>
                      <span className="w-9 h-9 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-accent flex-shrink-0" aria-hidden="true">
                        ◷
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">
                          <Highlight text={item.hit.name} query={q} />
                        </span>
                        <span className="block text-[11px] text-ink-faint">Open on the Markets heatmap</span>
                      </span>
                    </>
                  )}
                  {item.kind === 'analysis' && (
                    <>
                      <span className="w-9 h-9 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-accent-bright flex-shrink-0" aria-hidden="true">
                        ⌁
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">
                          <Highlight text={item.hit.title} query={q} />
                        </span>
                        <span className="block text-[11px] text-ink-faint">
                          {new Date(item.hit.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {item.hit.recommendation ? ` · ${item.hit.recommendation}` : ''}
                        </span>
                      </span>
                    </>
                  )}
                  {item.kind === 'page' && (
                    <>
                      <span className="w-9 h-9 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-ink-muted flex-shrink-0" aria-hidden="true">
                        →
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink">{item.label}</span>
                        <span className="block text-[11px] text-ink-faint">{item.hint}</span>
                      </span>
                    </>
                  )}
                  {item.kind === 'event' && (
                    <>
                      <span className="w-9 h-9 rounded-lg bg-accent text-on-accent flex items-center justify-center font-bold flex-shrink-0" aria-hidden="true">
                        ⚡
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink">Analyse this as an event</span>
                        <span className="block text-[11px] text-ink-faint truncate">“{item.text}”</span>
                      </span>
                    </>
                  )}
                  {selected && <kbd className="hidden sm:inline text-[10px] font-mono text-ink-faint border border-border rounded px-1.5 py-0.5 flex-shrink-0">↵</kbd>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-border text-[10px] text-ink-faint font-mono">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">All 2,603 NSE equities · NSE equity list, 9 Oct 2026</span>
        </div>
      </div>
    </div>
  )
}
