'use client'

import { useEffect, useState } from 'react'
import { heatColor, heatInk, heatLegend, type HeatScale } from '@/lib/heat'

const STORAGE_KEY = 'pulse-heat-palette'

/** Applies the saved palette choice on load (the attribute lives on <html>). */
export function useHeatPalette(): [boolean, (v: boolean) => void] {
  const [cvd, setCvd] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) === 'cvd'
      setCvd(saved)
      if (saved) document.documentElement.dataset.heat = 'cvd'
    } catch {
      // Storage blocked: default palette.
    }
  }, [])
  const update = (value: boolean) => {
    setCvd(value)
    if (value) document.documentElement.dataset.heat = 'cvd'
    else delete document.documentElement.dataset.heat
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'cvd' : 'default')
    } catch {
      // Not persisted; still applied for this visit.
    }
  }
  return [cvd, update]
}

/**
 * The key for every heatmap: seven labelled steps from the largest loss to
 * the largest gain, plus a switch to a blue–orange palette for readers who
 * cannot separate red from green.
 */
export default function HeatLegend({ scale = 'equity' }: { scale?: HeatScale }) {
  const [cvd, setCvd] = useHeatPalette()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-stretch rounded-lg overflow-hidden border border-border" role="img" aria-label="Colour scale from largest loss to largest gain">
        {heatLegend(scale).map(({ step, label }) => (
          <span
            key={step}
            className="px-2 py-1 text-[10px] font-semibold mono-tabular whitespace-nowrap"
            style={{ background: heatColor(step), color: heatInk(step) }}
          >
            {label}
          </span>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-ink-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={cvd}
          onChange={(e) => setCvd(e.target.checked)}
          className="accent-[var(--accent)]"
        />
        Colour-blind-safe colours
      </label>
    </div>
  )
}
