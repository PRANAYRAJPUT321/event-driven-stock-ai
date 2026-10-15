const STYLE: Record<string, { glyph: string; label: string; cls: string }> = {
  POSITIVE: { glyph: '▲', label: 'Helps', cls: 'text-buy border-buy-dim bg-buy-dim' },
  NEGATIVE: { glyph: '▼', label: 'Hurts', cls: 'text-avoid border-avoid-dim bg-avoid-dim' },
  MIXED: { glyph: '◆', label: 'Mixed', cls: 'text-hold border-hold-dim bg-hold-dim' },
  NEUTRAL: { glyph: '●', label: 'Neutral', cls: 'text-ink-muted border-border bg-surface-2' },
}

/**
 * How an event reaches one company, from its own sector's side of the
 * transmission channel. Glyph and word carry the direction, so the chip does
 * not rely on colour alone; the reasons are in the tooltip.
 */
export default function EventReadChip({
  direction,
  score,
  positives = [],
  negatives = [],
}: {
  direction?: string | null
  score?: number | null
  positives?: string[]
  negatives?: string[]
}) {
  const style = STYLE[direction ?? ''] ?? null
  if (!style) return null
  const reasons = [
    ...positives.map((p) => `+ ${p}`),
    ...negatives.map((n) => `− ${n}`),
  ].join('\n')
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style.cls}`}
      title={reasons || undefined}
    >
      <span aria-hidden="true">{style.glyph}</span>
      Event: {style.label}
      {typeof score === 'number' && <span className="mono-tabular opacity-80">{score}</span>}
    </span>
  )
}
