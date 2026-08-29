export default function RecommendationBadge({ rec, size = 'md' }: { rec: string | null; size?: 'sm' | 'md' }) {
  const map: Record<string, string> = {
    BUY: 'text-buy bg-buy-dim border-buy-dim',
    HOLD: 'text-hold bg-hold-dim border-hold-dim',
    AVOID: 'text-avoid bg-avoid-dim border-avoid-dim',
  }
  const cls = map[rec || ''] || 'text-ink-faint bg-surface-2 border-border'
  const sizeCls = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
  return (
    <span className={`inline-flex items-center rounded-full font-bold border font-mono tracking-wide ${cls} ${sizeCls}`}>
      {rec || 'PENDING'}
    </span>
  )
}
