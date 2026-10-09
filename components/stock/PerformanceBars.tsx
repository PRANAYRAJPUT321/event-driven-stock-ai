import { formatPct } from '@/lib/format'

/**
 * Returns over several horizons as diverging bars around a zero line: the
 * job is "above or below where it started", so bars grow left or right from
 * the same baseline and every bar carries its signed value — colour is never
 * the only cue.
 */
export default function PerformanceBars({ rows }: { rows: { label: string; value: number | null }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value ?? 0)))
  return (
    <div className="space-y-2.5" role="table" aria-label="Price performance by period">
      {rows.map((r) => {
        const v = r.value
        const width = v === null ? 0 : (Math.abs(v) / max) * 50
        return (
          <div key={r.label} className="grid grid-cols-[42px_1fr_68px] items-center gap-3" role="row">
            <span className="text-xs font-semibold text-ink-muted" role="rowheader">{r.label}</span>
            <div className="relative h-5" aria-hidden="true">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border-bright" />
              {v !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3"
                  style={{
                    width: `${width}%`,
                    left: v >= 0 ? '50%' : `${50 - width}%`,
                    background: v >= 0 ? 'var(--buy)' : 'var(--avoid)',
                    opacity: 0.85,
                    borderRadius: v >= 0 ? '0 4px 4px 0' : '4px 0 0 4px',
                  }}
                />
              )}
            </div>
            <span
              className={`mono-tabular text-xs font-semibold text-right ${v === null ? 'text-ink-faint' : v >= 0 ? 'text-up' : 'text-down'}`}
              role="cell"
            >
              {v === null ? '—' : `${v >= 0 ? '▲' : '▼'} ${formatPct(v)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
