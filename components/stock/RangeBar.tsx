import { formatPrice } from '@/lib/format'

/**
 * Where a price sits between a low and a high — the day's range or the
 * 52-week range. The marker carries the position; both ends are labelled.
 */
export default function RangeBar({
  label,
  low,
  high,
  value,
}: {
  label: string
  low: number | null
  high: number | null
  value: number | null
}) {
  const valid = low !== null && high !== null && value !== null && high > low
  const position = valid ? Math.min(100, Math.max(0, ((value! - low!) / (high! - low!)) * 100)) : null
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="stat-label">{label}</span>
        {position !== null && <span className="text-[11px] text-ink-faint mono-tabular">{position.toFixed(0)}% of range</span>}
      </div>
      <div className="relative h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, var(--avoid-dim), var(--surface-2) 50%, var(--buy-dim))' }}>
        {position !== null && (
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent border-2 border-surface shadow-glow"
            style={{ left: `${position}%` }}
            title={`₹${formatPrice(value)}`}
          />
        )}
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] mono-tabular text-ink-muted">
        <span>{formatPrice(low)}</span>
        <span>{formatPrice(high)}</span>
      </div>
    </div>
  )
}
