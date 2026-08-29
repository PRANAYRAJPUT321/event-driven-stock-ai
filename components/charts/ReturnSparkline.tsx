'use client'

export default function ReturnSparkline({
  points,
  labels,
  color,
  width = 180,
  height = 44,
}: {
  points: number[]
  labels: string[]
  color: string
  width?: number
  height?: number
}) {
  if (points.length === 0) return null
  const pad = 4
  const max = Math.max(...points, 0)
  const min = Math.min(...points, 0)
  const range = max - min || 1
  const step = (width - pad * 2) / (points.length - 1 || 1)
  const coords = points.map((p, i) => {
    const x = pad + i * step
    const y = pad + (height - pad * 2) * (1 - (p - min) / range)
    return { x, y }
  })
  const zeroY = pad + (height - pad * 2) * (1 - (0 - min) / range)
  const polyPoints = coords.map((c) => `${c.x},${c.y}`).join(' ')

  return (
    <div>
      <svg width={width} height={height} className="overflow-visible">
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
        <polyline points={polyPoints} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="2.5" fill={color} />
        ))}
      </svg>
      <div className="flex justify-between mt-1" style={{ width }}>
        {labels.map((l) => (
          <span key={l} className="text-[9px] text-ink-faint font-mono">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
