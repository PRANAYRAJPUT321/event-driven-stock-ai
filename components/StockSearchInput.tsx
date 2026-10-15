'use client'

import { useEffect, useRef, useState } from 'react'

export interface StockHit {
  symbol: string
  name: string
  sector: string | null
  inNifty50: boolean
}

/**
 * An inline company search: type a name or symbol, pick from every
 * NSE-listed equity. Used where the action is "add this stock to something"
 * rather than "go to it" (that is the header search's job).
 */
export default function StockSearchInput({
  onSelect,
  placeholder = 'Add a stock — search any NSE company',
  busy = false,
}: {
  onSelect: (hit: StockHit) => void
  placeholder?: string
  busy?: boolean
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StockHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`, { signal: controller.signal })
        const data = await r.json()
        setHits(data.companies || [])
        setActive(0)
        setOpen(true)
      } catch {
        // Aborted or offline: keep the previous list.
      }
    }, 120)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const choose = (hit: StockHit | undefined) => {
    if (!hit) return
    onSelect(hit)
    setQuery('')
    setHits([])
    setOpen(false)
  }

  return (
    <div ref={wrapper} className="relative">
      <div className="relative">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(hits.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(hits[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className="input !pl-9"
          disabled={busy}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="stock-search-list"
        />
      </div>
      {open && hits.length > 0 && (
        <ul id="stock-search-list" role="listbox" className="absolute z-30 left-0 right-0 mt-1.5 panel-elevated shadow-panel overflow-hidden py-1">
          {hits.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(h)}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left ${i === active ? 'bg-surface-hover' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{h.name}</span>
                  <span className="block text-[11px] font-mono text-ink-faint">
                    {h.symbol}
                    {h.sector ? ` · ${h.sector}` : ''}
                  </span>
                </span>
                {h.inNifty50 && <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border border-accent-dim text-accent">NIFTY 50</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
