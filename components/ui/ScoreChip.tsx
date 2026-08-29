export default function ScoreChip({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' }) {
  const v = score ?? 0
  const color = v >= 75 ? 'var(--buy)' : v >= 40 ? 'var(--hold)' : 'var(--avoid)'
  const sizeCls = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold font-mono mono-tabular border ${sizeCls}`}
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {v.toFixed(0)}
    </span>
  )
}
