'use client'

import { useState } from 'react'

export interface PickableCompany {
  symbol: string
  name: string
  sector: string
}

/**
 * Lets the reader choose which companies an event is scored against.
 *
 * Shared by the saved and unsaved analysis pages. It used to live inside the
 * unsaved view only, which meant a signed-in user — the main path, since a
 * signed-in analysis is saved and redirects to its own page — never saw it.
 */
export default function CompanyPicker({
  universe,
  initial,
  onRun,
  running,
}: {
  /** Every constituent in the event's affected sectors. */
  universe: PickableCompany[]
  /** The companies currently scored, pre-selected. */
  initial: string[]
  onRun: (symbols: string[]) => void
  running?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>(initial)
  const toggle = (symbol: string) =>
    setPicked((prev) => (prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]))

  if (universe.length === 0) return null

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-accent-bright hover:border-accent-dim transition"
      >
        {open ? 'Close' : 'Choose companies'}
      </button>

      {open && (
        // Full-width row beneath the header the button sits in.
        <div className="basis-full border border-border rounded-lg p-4 mt-3 bg-surface-2">
          <p className="text-xs text-ink-muted mb-3">
            Pick the companies this event should be scored against. The transmission mechanism is
            the same; the numbers underneath it are each company&apos;s own.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {universe.map((c) => {
              const on = picked.includes(c.symbol)
              return (
                <button
                  key={c.symbol}
                  onClick={() => toggle(c.symbol)}
                  title={`${c.name} · ${c.sector}`}
                  className={`text-[11px] font-mono px-2.5 py-1 rounded-full border transition ${
                    on
                      ? 'bg-accent-dim text-accent-bright border-accent-dim'
                      : 'bg-surface text-ink-muted border-border hover:border-accent-dim'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {c.symbol}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onRun(picked)}
              disabled={picked.length === 0 || running}
              className="bg-accent hover:bg-accent-bright text-on-accent text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              {running
                ? 'Scoring…'
                : `Re-run on ${picked.length} compan${picked.length === 1 ? 'y' : 'ies'}`}
            </button>
            <button
              onClick={() => setPicked(universe.map((c) => c.symbol))}
              className="text-xs text-ink-muted hover:text-accent transition"
            >
              Select all
            </button>
            <button onClick={() => setPicked([])} className="text-xs text-ink-muted hover:text-accent transition">
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  )
}
