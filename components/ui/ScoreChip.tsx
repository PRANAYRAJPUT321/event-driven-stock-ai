export default function ScoreChip({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' }) {
  const sizeCls = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'

  // A factor with no sourced data used to fall back to 0, which renders in the
  // "avoid" colour and reads as a company scoring zero out of a hundred. It
  // scored nothing at all — the chip now says so.
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return (
      <span
        className={`inline-flex items-center rounded-full font-bold font-mono mono-tabular border border-border text-ink-faint ${sizeCls}`}
        title="Not sourced"
      >
        —
      </span>
    )
  }

  const color = score >= 75 ? 'var(--buy)' : score >= 40 ? 'var(--hold)' : 'var(--avoid)'
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold font-mono mono-tabular border ${sizeCls}`}
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {score.toFixed(0)}
    </span>
  )
}
