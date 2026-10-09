/**
 * The diverging colour scale for "how much did it move today": seven steps,
 * losses ← neutral → gains, defined as CSS tokens in app/globals.css so both
 * themes (and the colour-blind-safe alternative) re-skin every heatmap at once.
 *
 * Steps are bucketed rather than continuous on purpose: past about seven
 * classes adjacent shades blur, and a reader comparing two tiles should be
 * able to say "same bucket" or "not" at a glance. The signed number on each
 * tile carries the exact value.
 */

export type HeatStep = -3 | -2 | -1 | 0 | 1 | 2 | 3

/** Bucket edges in percent, per asset class: a 2% index day is large, a 2% crypto day is noise. */
export const HEAT_EDGES = {
  equity: [0.25, 1, 2.5],
  index: [0.15, 0.6, 1.5],
  commodity: [0.25, 1, 2.5],
  currency: [0.05, 0.25, 0.75],
  crypto: [0.5, 2.5, 6],
} as const

export type HeatScale = keyof typeof HEAT_EDGES

export function heatStep(changePct: number, scale: HeatScale = 'equity'): HeatStep {
  const [a, b, c] = HEAT_EDGES[scale]
  const m = Math.abs(changePct)
  const magnitude = m < a ? 0 : m < b ? 1 : m < c ? 2 : 3
  return (changePct < 0 ? -magnitude : magnitude) as HeatStep
}

export function heatColor(step: HeatStep): string {
  if (step === 0) return 'var(--heat-0)'
  return `var(--heat-${step < 0 ? 'n' : 'p'}${Math.abs(step)})`
}

/** Text on a heat fill: the strong ink only on the two outermost steps. */
export function heatInk(step: HeatStep): string {
  return Math.abs(step) === 3 ? 'var(--heat-ink-strong)' : 'var(--heat-ink)'
}

/** Legend labels for a scale, outermost loss to outermost gain. */
export function heatLegend(scale: HeatScale = 'equity'): { step: HeatStep; label: string }[] {
  const [a, b, c] = HEAT_EDGES[scale]
  return [
    { step: -3, label: `≤ −${c}%` },
    { step: -2, label: `−${b}%` },
    { step: -1, label: `−${a}%` },
    { step: 0, label: '0%' },
    { step: 1, label: `+${a}%` },
    { step: 2, label: `+${b}%` },
    { step: 3, label: `≥ +${c}%` },
  ]
}
