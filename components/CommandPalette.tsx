'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

const ACTIONS = [
  { label: 'Go to Dashboard', href: '/dashboard', hint: 'Overview' },
  { label: 'Discover live market news', href: '/discover', hint: 'Browse & categorize' },
  { label: 'Analyze a new event', href: '/analyze', hint: 'Event → recommendation' },
  { label: 'Global markets & crypto heatmap', href: '/markets', hint: 'Indices & crypto' },
  { label: 'Open my watchlist', href: '/watchlist', hint: 'Tracked stocks' },
  { label: 'View simulated portfolio', href: '/portfolio', hint: 'Paper positions & P&L' },
  { label: 'View analysis history', href: '/history', hint: 'Past decisions' },
  { label: 'Open settings', href: '/settings', hint: 'Profile & preferences' },
]

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const router = useRouter()

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(
    () => ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase())),
    [query]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 overlay-blur"
      onClick={onClose}
    >
      <div className="w-full max-w-lg panel-elevated shadow-panel overflow-hidden fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="font-mono text-accent-bright text-sm">⌘K</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a screen…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-ink-faint text-ink"
          />
          <kbd className="text-[10px] font-mono text-ink-faint border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && <p className="px-4 py-6 text-sm text-ink-faint text-center">No matches</p>}
          {filtered.map((a) => (
            <button
              key={a.href}
              onClick={() => {
                router.push(a.href)
                onClose()
              }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-hover transition"
            >
              <span className="text-sm text-ink">{a.label}</span>
              <span className="text-xs text-ink-faint">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
