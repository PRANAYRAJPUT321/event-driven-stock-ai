'use client'

import { useEffect, useState } from 'react'

function zoneMeta(score: number) {
  if (score >= 90) return { color: '#34d399', label: 'Very Strong' }
  if (score >= 75) return { color: '#34d399', label: 'Strong' }
  if (score >= 60) return { color: '#fbbf24', label: 'Moderate' }
  if (score >= 40) return { color: '#fbbf24', label: 'Neutral' }
  return { color: '#f87171', label: 'Weak' }
}

export default function ScoreGauge({ score, size = 176 }: { score: number; size?: number }) {
  const [animated, setAnimated] = useState(0)
  const clamped = Math.max(0, Math.min(100, score || 0))
  const { color, label } = zoneMeta(clamped)
  const strokeWidth = 10
  const radius = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    const t = setTimeout(() => setAnimated(clamped), 100)
    return () => clearTimeout(t)
  }, [clamped])

  const offset = circumference - (animated / 100) * circumference

  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)',
            filter: `drop-shadow(0 0 6px ${color}aa)`,
          }}
        />
      </svg>
      <div className="relative flex flex-col items-center">
        <span className="font-mono text-4xl font-bold text-ink mono-tabular">{Math.round(animated)}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint mt-0.5">out of 100</span>
        <span className="mt-1.5 text-xs font-semibold" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  )
}
