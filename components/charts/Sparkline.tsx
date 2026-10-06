/**
 * A tile-sized price line.
 *
 * Deliberately not a chart library: one of these renders per tile and there
 * are up to sixty-six on screen, so it is a single <path> with no axes, no
 * tooltip and no layout pass. It takes its colour from the move it is drawing,
 * so a grid of them reads as a shape before any number is read.
 */
export default function Sparkline({
  values,
  positive,
  width = 88,
  height = 26,
  className = '',
}: {
  values: number[]
  /** Drives the stroke colour; usually the tile's own day change. */
  positive: boolean
  width?: number
  height?: number
  className?: string
}) {
  // Two points is the minimum that makes a line; one would draw a dot that
  // looks like a flat session, which is a different claim.
  if (!values || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min

  // A dead-flat series would divide by zero; draw it down the middle instead.
  const y = (v: number) =>
    span === 0 ? height / 2 : height - ((v - min) / span) * (height - 2) - 1
  const x = (i: number) => (i / (values.length - 1)) * width

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const stroke = positive ? 'var(--buy)' : 'var(--avoid)'
  const gradientId = `spark-${positive ? 'up' : 'down'}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      // Decorative: the number beside it carries the same information.
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
