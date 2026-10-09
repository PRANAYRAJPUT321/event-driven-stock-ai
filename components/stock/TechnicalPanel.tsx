import { formatPct, formatPrice } from '@/lib/format'

interface Props {
  price: number | null
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  macd: number | null
  macdSignal: number | null
  adx: number | null
  rating: { value: number | null; label: string | null; movingAverages: number | null; oscillators: number | null }
}

const ZONES = ['Strong sell', 'Sell', 'Neutral', 'Buy', 'Strong buy']

/** A -1…+1 reading on a five-zone track. */
function RatingMeter({ label, value }: { label: string; value: number | null }) {
  const position = value === null ? null : ((value + 1) / 2) * 100
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="text-xs font-semibold text-ink">{value === null ? '—' : value.toFixed(2)}</span>
      </div>
      <div
        className="relative h-2 rounded-full"
        style={{ background: 'linear-gradient(90deg, var(--avoid) 0%, var(--hold) 50%, var(--buy) 100%)', opacity: 0.85 }}
        aria-hidden="true"
      >
        {position !== null && (
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-ink border-2 border-surface"
            style={{ left: `${position}%` }}
          />
        )}
      </div>
    </div>
  )
}

function maDistance(price: number | null, ma: number | null): number | null {
  if (price === null || ma === null || ma === 0) return null
  return ((price - ma) / ma) * 100
}

/**
 * Indicator readings from TradingView's screener, presented as what they are:
 * mechanical signals from price and volume, not a recommendation. The panel
 * says so in words, because a "Strong buy" label next to a stock is easy to
 * mistake for advice.
 */
export default function TechnicalPanel(p: Props) {
  const rsiZone =
    p.rsi14 === null ? null : p.rsi14 >= 70 ? 'Overbought (≥ 70)' : p.rsi14 <= 30 ? 'Oversold (≤ 30)' : 'Neutral range (30–70)'
  const mas: [string, number | null][] = [
    ['20-day', p.sma20],
    ['50-day', p.sma50],
    ['200-day', p.sma200],
  ]
  const macdCross = p.macd !== null && p.macdSignal !== null ? (p.macd >= p.macdSignal ? 'above' : 'below') : null

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-xs font-semibold text-ink">Indicator summary</p>
          <p className={`text-sm font-bold ${p.rating.value === null ? 'text-ink-faint' : p.rating.value >= 0.1 ? 'text-up' : p.rating.value <= -0.1 ? 'text-down' : 'text-hold'}`}>
            {p.rating.label ?? '—'}
          </p>
        </div>
        <div className="relative h-2.5 rounded-full mb-1" style={{ background: 'linear-gradient(90deg, var(--avoid) 0%, var(--hold) 50%, var(--buy) 100%)', opacity: 0.9 }} aria-hidden="true">
          {p.rating.value !== null && (
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-ink border-[3px] border-surface"
              style={{ left: `${((p.rating.value + 1) / 2) * 100}%` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-ink-faint">
          {ZONES.map((z) => (
            <span key={z}>{z}</span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <RatingMeter label="Moving averages" value={p.rating.movingAverages} />
          <RatingMeter label="Oscillators" value={p.rating.oscillators} />
        </div>
        <p className="text-[11px] text-ink-faint mt-3 leading-relaxed">
          A mechanical summary of moving-average and oscillator signals, computed by TradingView from price and volume.
          It is not an analyst rating and not advice.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold text-ink mb-2">RSI (14)</p>
          <div className="relative h-2.5 rounded-full bg-surface-2 border border-border overflow-hidden" aria-hidden="true">
            <div className="absolute inset-y-0" style={{ left: 0, width: '30%', background: 'var(--buy-dim)' }} />
            <div className="absolute inset-y-0" style={{ left: '70%', width: '30%', background: 'var(--avoid-dim)' }} />
            {p.rsi14 !== null && (
              <span className="absolute top-0 bottom-0 w-1 -translate-x-1/2 bg-accent rounded" style={{ left: `${Math.min(100, Math.max(0, p.rsi14))}%` }} />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-ink-faint mt-1 mono-tabular">
            <span>0</span>
            <span>30</span>
            <span>70</span>
            <span>100</span>
          </div>
          <p className="text-sm mt-2">
            <span className="mono-tabular font-bold text-ink">{p.rsi14 === null ? '—' : p.rsi14.toFixed(1)}</span>
            {rsiZone && <span className="text-ink-muted"> · {rsiZone}</span>}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-ink mb-2">Price vs moving averages</p>
          <ul className="space-y-1.5">
            {mas.map(([label, ma]) => {
              const d = maDistance(p.price, ma)
              return (
                <li key={label} className="flex items-center justify-between text-xs">
                  <span className="text-ink-muted">
                    {label} <span className="mono-tabular text-ink-faint">{formatPrice(ma)}</span>
                  </span>
                  <span className={`mono-tabular font-semibold ${d === null ? 'text-ink-faint' : d >= 0 ? 'text-up' : 'text-down'}`}>
                    {d === null ? '—' : `${d >= 0 ? 'above' : 'below'} ${formatPct(Math.abs(d), { signed: false })}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="rounded-xl border border-border p-3">
          <p className="stat-label mb-1">MACD</p>
          <p className="mono-tabular text-sm font-bold text-ink">{p.macd === null ? '—' : p.macd.toFixed(2)}</p>
          <p className="text-ink-faint mt-0.5">
            {macdCross ? `${macdCross} its signal line (${p.macdSignal!.toFixed(2)})` : 'Signal unavailable'}
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="stat-label mb-1">ADX · trend strength</p>
          <p className="mono-tabular text-sm font-bold text-ink">{p.adx === null ? '—' : p.adx.toFixed(1)}</p>
          <p className="text-ink-faint mt-0.5">
            {p.adx === null ? '' : p.adx >= 25 ? 'A strong trend is in place' : p.adx >= 20 ? 'A trend may be forming' : 'No clear trend'}
          </p>
        </div>
      </div>
    </div>
  )
}
