'use client'

interface TransmissionFlowProps {
  eventType: string
  economicVariable: string
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  sectors: string[]
  stockSymbol?: string
  /**
   * The stock's own event-impact score (50 = no net effect) and sector. When
   * given, the chain is drawn from that company's side: a crude spike is a
   * headwind for the market and a tailwind for an upstream producer, and
   * colouring the producer red because the market fell was simply wrong.
   */
  stockImpactScore?: number | null
  stockSector?: string
  explanation?: string
}

const DIRECTION_META: Record<string, { color: string; label: string }> = {
  POSITIVE: { color: 'var(--buy)', label: 'Tailwind' },
  NEGATIVE: { color: 'var(--avoid)', label: 'Headwind' },
  NEUTRAL: { color: 'var(--hold)', label: 'Mixed signal' },
}

function Node({ title, sub, color, glow, raw }: { title: string; sub: string; color: string; glow?: boolean; raw?: boolean }) {
  return (
    <div className="flex sm:flex-col items-center sm:text-center gap-3 sm:gap-0 sm:w-[104px] flex-shrink-0">
      <div
        className="w-3 h-3 rounded-full sm:mb-2 border-2 flex-shrink-0"
        style={{ background: glow ? color : 'var(--surface)', borderColor: color, boxShadow: glow ? `0 0 12px ${color}` : undefined }}
      />
      <div>
        <p className={`text-[11px] font-semibold text-ink leading-tight ${raw ? 'font-mono' : 'capitalize'}`}>
          {raw ? title : title.toLowerCase()}
        </p>
        <p className="text-[9px] text-ink-faint mt-0.5 uppercase tracking-wide">{sub}</p>
      </div>
    </div>
  )
}

/** Horizontal from `sm` up; a short vertical rule on phones, where five nodes do not fit across. */
function Connector({ color }: { color: string }) {
  return (
    <>
      <div className="sm:hidden ml-[5px] h-5 border-l-2 border-dashed" style={{ borderColor: color, opacity: 0.55 }} />
      <div className="hidden sm:flex flex-1 min-w-[20px] items-center px-0.5 mt-[2px]">
        <svg width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full overflow-visible">
          <line x1="0" y1="4" x2="100" y2="4" stroke={color} strokeWidth="2" strokeDasharray="6 6" opacity="0.55">
            <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" />
          </line>
        </svg>
      </div>
    </>
  )
}

export default function TransmissionFlow({
  eventType,
  economicVariable,
  direction,
  sectors,
  stockSymbol,
  stockImpactScore,
  stockSector,
  explanation,
}: TransmissionFlowProps) {
  const fromStock = Boolean(stockSymbol) && typeof stockImpactScore === 'number'
  const stockDirection = !fromStock
    ? direction
    : stockImpactScore! >= 55
      ? 'POSITIVE'
      : stockImpactScore! <= 45
        ? 'NEGATIVE'
        : 'NEUTRAL'
  const meta = DIRECTION_META[stockDirection] || DIRECTION_META.NEUTRAL
  const sectorLabel = (fromStock && stockSector) || sectors.slice(0, 2).join(' / ') || 'Sector'

  const steps: { title: string; sub: string; raw?: boolean }[] = [
    { title: (eventType || 'Event').replace(/_/g, ' '), sub: 'Event' },
    { title: (economicVariable || 'Variable').replace(/_/g, ' '), sub: 'Variable' },
    { title: meta.label, sub: fromStock ? `For ${stockSymbol}` : 'Transmission' },
    { title: sectorLabel, sub: 'Sector' },
    ...(stockSymbol ? [{ title: stockSymbol, sub: 'Stock', raw: true }] : []),
  ]

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start py-2">
        {steps.map((step, idx) => (
          <div key={idx} className={`flex flex-col sm:flex-row sm:items-start ${idx < steps.length - 1 ? 'sm:flex-1' : ''}`}>
            <Node title={step.title} sub={step.sub} color={meta.color} glow={idx === steps.length - 1} raw={step.raw} />
            {idx < steps.length - 1 && <Connector color={meta.color} />}
          </div>
        ))}
      </div>
      {explanation && (
        <p className="text-xs text-ink-muted leading-relaxed mt-3 pt-3 border-t border-border">{explanation}</p>
      )}
    </div>
  )
}
