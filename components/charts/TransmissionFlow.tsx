'use client'

interface TransmissionFlowProps {
  eventType: string
  economicVariable: string
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  sectors: string[]
  stockSymbol?: string
  explanation?: string
}

const DIRECTION_META: Record<string, { color: string; label: string }> = {
  POSITIVE: { color: '#34d399', label: 'Tailwind' },
  NEGATIVE: { color: '#f87171', label: 'Headwind' },
  NEUTRAL: { color: '#fbbf24', label: 'Mixed signal' },
}

function Node({ title, sub, color, glow }: { title: string; sub: string; color: string; glow?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center w-[104px] flex-shrink-0">
      <div
        className="w-3 h-3 rounded-full mb-2 border-2"
        style={{ background: glow ? color : 'var(--surface)', borderColor: color, boxShadow: glow ? `0 0 12px ${color}` : undefined }}
      />
      <p className="text-[11px] font-semibold text-ink leading-tight capitalize">{title.toLowerCase()}</p>
      <p className="text-[9px] text-ink-faint mt-0.5 uppercase tracking-wide">{sub}</p>
    </div>
  )
}

function Connector({ color }: { color: string }) {
  return (
    <div className="flex-1 min-w-[20px] flex items-center px-0.5 -mt-4">
      <svg width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full overflow-visible">
        <line x1="0" y1="4" x2="100" y2="4" stroke={color} strokeWidth="2" strokeDasharray="6 6" opacity="0.55">
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" />
        </line>
      </svg>
    </div>
  )
}

export default function TransmissionFlow({
  eventType,
  economicVariable,
  direction,
  sectors,
  stockSymbol,
  explanation,
}: TransmissionFlowProps) {
  const meta = DIRECTION_META[direction] || DIRECTION_META.NEUTRAL
  const sectorLabel = sectors.slice(0, 2).join(' / ') || 'Sector'

  const steps = [
    { title: (eventType || 'Event').replace(/_/g, ' '), sub: 'Event' },
    { title: (economicVariable || 'Variable').replace(/_/g, ' '), sub: 'Variable' },
    { title: meta.label, sub: 'Transmission' },
    { title: sectorLabel, sub: 'Sector' },
    ...(stockSymbol ? [{ title: stockSymbol, sub: 'Stock' }] : []),
  ]

  return (
    <div>
      <div className="flex items-start overflow-x-auto py-2 px-1 -mx-1">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-start flex-shrink-0">
            <Node title={step.title} sub={step.sub} color={meta.color} glow={idx === steps.length - 1} />
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
