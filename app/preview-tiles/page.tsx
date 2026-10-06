/**
 * A static render of the heatmap tile, for looking at the design without a
 * live feed. Not linked from anywhere; it exists so the tile can be reviewed
 * in both themes from an environment that cannot reach a price source.
 */
import AppShell from '@/components/layout/AppShell'
import Sparkline from '@/components/charts/Sparkline'

const SAMPLES = [
  { group: 'Banking', name: 'HDFC Bank', symbol: 'HDFCBANK', price: 1684.2, changePct: 1.42,
    spark: [1642, 1651, 1638, 1660, 1672, 1665, 1684] },
  { group: 'IT', name: 'Tata Consultancy Services', symbol: 'TCS', price: 3198.75, changePct: -0.86,
    spark: [3260, 3241, 3255, 3230, 3218, 3225, 3199] },
  { group: 'Energy', name: 'Reliance Industries', symbol: 'RELIANCE', price: 1412.3, changePct: 0.31,
    spark: [1398, 1402, 1395, 1408, 1401, 1407, 1412] },
  { group: 'Auto', name: 'Maruti Suzuki India', symbol: 'MARUTI', price: 12840.0, changePct: -2.14,
    spark: [13220, 13180, 13050, 12990, 12910, 12880, 12840] },
  { group: 'Pharma', name: 'Sun Pharmaceutical', symbol: 'SUNPHARMA', price: 1742.6, changePct: 0.08,
    spark: [1740, 1738, 1744, 1741, 1739, 1743, 1742.6] },
  { group: 'Metals', name: 'Tata Steel', symbol: 'TATASTEEL', price: 168.45, changePct: 3.67,
    spark: [161, 162.4, 161.8, 163.9, 165.2, 166.8, 168.45] },
]

function heat(changePct: number) {
  const intensity = Math.min(Math.abs(changePct) / 3, 1)
  const token = changePct >= 0 ? 'var(--buy)' : 'var(--avoid)'
  return {
    background: `color-mix(in srgb, ${token} ${(intensity * 14).toFixed(1)}%, var(--surface))`,
    borderColor: `color-mix(in srgb, ${token} ${(intensity * 45).toFixed(1)}%, var(--border))`,
  }
}

export default function PreviewTiles() {
  return (
    <AppShell showTicker={false}>
      <h1 className="text-2xl font-bold text-ink mb-1">Tile preview</h1>
      <p className="text-ink-muted text-sm mb-6">
        Static sample data. Used to review the heatmap tile in both themes.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {SAMPLES.map((t) => (
          <div key={t.symbol} style={heat(t.changePct)} className="tile-hover rounded-xl border p-4 block">
            <p className="font-mono text-[10px] uppercase tracking-wide text-ink-faint mb-1">{t.group}</p>
            <p className="font-bold text-ink text-sm mb-2 truncate">{t.name}</p>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="mono-tabular text-lg font-bold text-ink leading-tight">
                  {t.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`mono-tabular text-sm font-semibold ${t.changePct >= 0 ? 'text-buy' : 'text-avoid'}`}>
                  {t.changePct >= 0 ? '▲' : '▼'} {Math.abs(t.changePct).toFixed(2)}%
                </p>
              </div>
              <Sparkline values={t.spark} positive={t.changePct >= 0} className="flex-shrink-0 opacity-90" />
            </div>
            <p className="text-[10px] text-ink-faint mt-1.5 font-mono">{t.symbol}</p>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
