'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatCount, formatDateIST, formatPct, formatPrice, formatTimeIST } from '@/lib/format'

export interface ChartCandle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export type ChartMode = 'area' | 'candle'

interface Props {
  candles: ChartCandle[]
  /** One of 1d, 5d, 1m, 6m, ytd, 1y, 5y, max — drives axis labels. */
  range: string
  intraday: boolean
  mode: ChartMode
  previousClose?: number | null
  overlays?: { ma50: boolean; ma200: boolean }
  /** Held at reduced opacity while a new range loads, instead of blanking. */
  loading?: boolean
  /** False when the provider gave closes only (no candle bodies to draw). */
  ohlc?: boolean
}

const MARGIN = { left: 6, right: 66, top: 14 }
const VOLUME_H = 58
const AXIS_H = 24
const PANE_GAP = 10

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min
  if (!(span > 0)) return [min]
  const rough = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / magnitude
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)))
  return ticks
}

function movingAverage(closes: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= window) sum -= closes[i - window]
    if (i >= window - 1) out[i] = sum / window
  }
  return out
}

/** The calendar key a bar belongs to at this range's label granularity. */
function tickKey(t: number, range: string): string {
  const ist = new Date(t + 5.5 * 3600 * 1000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth()
  const d = ist.getUTCDate()
  switch (range) {
    case '1d':
      return `${d}-${ist.getUTCHours()}`
    case '5d':
      return `${y}-${m}-${d}`
    case '1m':
      return `${y}-${m}-${Math.floor((d - 1) / 7)}`
    case '6m':
    case 'ytd':
    case '1y':
      return `${y}-${m}`
    case '5y':
      return `${y}-${Math.floor(m / 6)}`
    default:
      return `${y}`
  }
}

function tickLabel(t: number, range: string): string {
  switch (range) {
    case '1d':
      return formatTimeIST(t)
    case '5d':
      return formatDateIST(t, { weekday: 'short', day: 'numeric' })
    case '1m':
      return formatDateIST(t, { day: 'numeric', month: 'short' })
    case '6m':
    case 'ytd':
    case '1y': {
      const month = formatDateIST(t, { month: 'short' })
      return month === 'Jan' ? formatDateIST(t, { year: 'numeric' }) : month
    }
    case '5y':
      return formatDateIST(t, { month: 'short', year: '2-digit' })
    default:
      return formatDateIST(t, { year: 'numeric' })
  }
}

function pointLabel(t: number, intraday: boolean, range: string): string {
  if (intraday) return `${formatDateIST(t, { day: 'numeric', month: 'short' })} · ${formatTimeIST(t)} IST`
  if (range === 'max') return formatDateIST(t, { month: 'long', year: 'numeric' })
  if (range === '5y') return `Week of ${formatDateIST(t)}`
  return formatDateIST(t, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The stock page's price chart: line-with-area or candlesticks, a volume pane,
 * optional moving averages, a previous-close baseline for the one-day view,
 * and a crosshair that snaps to the nearest bar.
 *
 * Bars are spaced by index, not by time, so weekends, holidays and the
 * overnight gap do not open holes in the line — the convention every trading
 * chart follows. Hand-rolled SVG rather than a chart library because the
 * candle bodies, the separate volume scale and the snapping crosshair are
 * exactly the parts libraries make awkward.
 */
export default function PriceChart({
  candles,
  range,
  intraday,
  mode,
  previousClose = null,
  overlays = { ma50: false, ma200: false },
  loading = false,
  ohlc = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = `price-fill-${useId().replace(/:/g, '')}`

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A new series invalidates the hovered index.
  useEffect(() => setHover(null), [candles])

  const compact = width < 560
  const priceH = compact ? 220 : 300
  const height = MARGIN.top + priceH + PANE_GAP + VOLUME_H + AXIS_H
  const plotW = Math.max(10, width - MARGIN.left - MARGIN.right)
  const n = candles.length
  const step = n > 0 ? plotW / n : plotW
  const xAt = useCallback((i: number) => MARGIN.left + (i + 0.5) * step, [step])

  const closes = useMemo(() => candles.map((c) => c.c), [candles])
  const ma50 = useMemo(() => (overlays.ma50 ? movingAverage(closes, 50) : []), [closes, overlays.ma50])
  const ma200 = useMemo(() => (overlays.ma200 ? movingAverage(closes, 200) : []), [closes, overlays.ma200])
  const showCandles = mode === 'candle' && ohlc

  const { lo, hi } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const c of candles) {
      lo = Math.min(lo, showCandles ? c.l : c.c)
      hi = Math.max(hi, showCandles ? c.h : c.c)
    }
    for (const series of [ma50, ma200]) {
      for (const v of series) {
        if (v === null) continue
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
    if (previousClose !== null && intraday) {
      lo = Math.min(lo, previousClose)
      hi = Math.max(hi, previousClose)
    }
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1
    return { lo: lo - pad, hi: hi + pad }
  }, [candles, showCandles, ma50, ma200, previousClose, intraday])

  const yAt = useCallback((v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo)) * priceH, [lo, hi, priceH])
  const volTop = MARGIN.top + priceH + PANE_GAP
  const maxVol = useMemo(() => Math.max(1, ...candles.map((c) => c.v)), [candles])
  const hasVolume = candles.some((c) => c.v > 0)

  const yTicks = useMemo(() => niceTicks(lo, hi, compact ? 4 : 5), [lo, hi, compact])

  const xTicks = useMemo(() => {
    const picks: number[] = []
    let lastKey = ''
    candles.forEach((c, i) => {
      const key = tickKey(c.t, range)
      if (key !== lastKey) {
        if (i > 0) picks.push(i)
        lastKey = key
      }
    })
    const maxLabels = Math.max(2, Math.floor(plotW / (compact ? 64 : 84)))
    const stride = Math.ceil(picks.length / maxLabels) || 1
    return picks.filter((_, k) => k % stride === 0)
  }, [candles, range, plotW, compact])

  const linePath = useMemo(() => {
    if (n < 2) return ''
    return closes.map((c, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join('')
  }, [closes, n, xAt, yAt])

  const areaPath = useMemo(() => {
    if (!linePath) return ''
    const baseY = MARGIN.top + priceH
    return `${linePath}L${xAt(n - 1).toFixed(1)},${baseY}L${xAt(0).toFixed(1)},${baseY}Z`
  }, [linePath, n, xAt, priceH])

  const maPath = (series: (number | null)[]) => {
    let d = ''
    let pen = false
    series.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  const onPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    const x = event.clientX - rect.left
    const i = Math.round((x - MARGIN.left) / step - 0.5)
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + delta)))
    } else if (event.key === 'Home') {
      setHover(0)
    } else if (event.key === 'End') {
      setHover(n - 1)
    } else if (event.key === 'Escape') {
      setHover(null)
    }
  }

  if (n < 2) {
    return (
      <div ref={containerRef} className="flex items-center justify-center text-sm text-ink-faint" style={{ height: 260 }}>
        No price data for this range.
      </div>
    )
  }

  const first = closes[0]
  const last = closes[n - 1]
  const changePct = first ? ((last - first) / first) * 100 : 0
  const active = hover !== null ? candles[hover] : null
  const activeX = hover !== null ? xAt(hover) : 0
  const tooltipLeft = hover !== null && activeX > width * 0.58

  const ariaLabel =
    `Price chart, ${range.toUpperCase()}: from ${formatPrice(first)} to ${formatPrice(last)} ` +
    `(${formatPct(changePct)}). Use the left and right arrow keys to read individual ${intraday ? 'bars' : 'sessions'}.`

  return (
    <div
      ref={containerRef}
      className="relative select-none outline-none"
      tabIndex={0}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      aria-label={ariaLabel}
      role="img"
    >
      <svg
        width={width}
        height={height}
        className="block transition-opacity duration-200"
        style={{ opacity: loading ? 0.45 : 1 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid and price axis (right-hand, as trading charts are read). */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={yAt(v)} y2={yAt(v)} stroke="var(--chart-grid)" strokeWidth={1} />
            {/* The last-price tag owns its slice of the axis; a tick label
                underneath it would print two numbers on top of each other. */}
            {Math.abs(yAt(v) - yAt(last)) > 14 && (
              <text
                x={MARGIN.left + plotW + 8}
                y={yAt(v)}
                dy="0.32em"
                fontSize={10}
                fill="var(--chart-axis)"
                className="mono-tabular"
              >
                {formatPrice(v, v >= 1000 ? 0 : v >= 10 ? 1 : 2)}
              </text>
            )}
          </g>
        ))}

        {/* Previous session's close: the one-day chart's reference line. */}
        {intraday && range === '1d' && previousClose !== null && (
          <g>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={yAt(previousClose)}
              y2={yAt(previousClose)}
              stroke="var(--text-faint)"
              strokeWidth={1}
            />
            <text x={MARGIN.left + 4} y={yAt(previousClose) - 5} fontSize={10} fill="var(--text-muted)">
              Prev close {formatPrice(previousClose)}
            </text>
          </g>
        )}

        {/* Price */}
        {showCandles ? (
          candles.map((c, i) => {
            const x = xAt(i)
            const up = c.c >= c.o
            const color = up ? 'var(--buy)' : 'var(--avoid)'
            const bodyTop = yAt(Math.max(c.o, c.c))
            const bodyH = Math.max(1, Math.abs(yAt(c.o) - yAt(c.c)))
            const bodyW = Math.max(1, Math.min(step * 0.7, 12))
            return (
              <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.85}>
                <line x1={x} x2={x} y1={yAt(c.h)} y2={yAt(c.l)} stroke={color} strokeWidth={1} />
                <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} rx={bodyW > 4 ? 1 : 0} />
              </g>
            )
          })
        ) : (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}

        {overlays.ma50 && <path d={maPath(ma50)} fill="none" stroke="var(--chart-2)" strokeWidth={1.5} strokeLinejoin="round" />}
        {overlays.ma200 && <path d={maPath(ma200)} fill="none" stroke="var(--chart-3)" strokeWidth={1.5} strokeLinejoin="round" />}

        {/* Last price tag on the axis. */}
        <g>
          <rect
            x={MARGIN.left + plotW + 2}
            y={yAt(last) - 9}
            width={MARGIN.right - 4}
            height={18}
            rx={4}
            fill="var(--chart-1)"
          />
          <text
            x={MARGIN.left + plotW + 8}
            y={yAt(last)}
            dy="0.34em"
            fontSize={10}
            fontWeight={700}
            fill="var(--on-accent)"
            className="mono-tabular"
          >
            {formatPrice(last, last >= 1000 ? 1 : 2)}
          </text>
        </g>

        {/* Volume pane: its own scale, below the price — never a second axis on the same plot. */}
        {hasVolume && (
          <g>
            {candles.map((c, i) => {
              const h = (c.v / maxVol) * VOLUME_H
              const w = Math.max(1, Math.min(step * 0.7, 10))
              return (
                <rect
                  key={c.t}
                  x={xAt(i) - w / 2}
                  y={volTop + VOLUME_H - h}
                  width={w}
                  height={Math.max(0, h)}
                  fill="var(--chart-axis)"
                  opacity={hover === i ? 0.85 : 0.32}
                />
              )
            })}
            <text x={MARGIN.left + plotW + 8} y={volTop + 9} fontSize={9} fill="var(--chart-axis)">
              VOL
            </text>
          </g>
        )}
        <line
          x1={MARGIN.left}
          x2={MARGIN.left + plotW}
          y1={volTop + VOLUME_H + 0.5}
          y2={volTop + VOLUME_H + 0.5}
          stroke="var(--chart-grid)"
        />

        {/* Time axis */}
        {xTicks.map((i) => (
          <text
            key={candles[i].t}
            x={xAt(i)}
            y={volTop + VOLUME_H + 16}
            fontSize={10}
            fill="var(--chart-axis)"
            textAnchor="middle"
          >
            {tickLabel(candles[i].t, range)}
          </text>
        ))}

        {/* Crosshair */}
        {active && (
          <g pointerEvents="none">
            <line x1={activeX} x2={activeX} y1={MARGIN.top} y2={volTop + VOLUME_H} stroke="var(--text-faint)" strokeWidth={1} />
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotW}
              y1={yAt(active.c)}
              y2={yAt(active.c)}
              stroke="var(--text-faint)"
              strokeWidth={1}
              opacity={0.6}
            />
            <circle cx={activeX} cy={yAt(active.c)} r={4.5} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}

        {/* Hit layer: the whole plot, so the reader aims at a date, not a 2px line. */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={priceH + PANE_GAP + VOLUME_H}
          fill="transparent"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
          style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
        />
      </svg>

      {active && hover !== null && (
        <div
          className="chart-tooltip"
          style={{
            top: MARGIN.top + 4,
            left: tooltipLeft ? undefined : Math.min(activeX + 14, width - 170),
            right: tooltipLeft ? Math.max(4, width - activeX + 14) : undefined,
          }}
        >
          <p className="mono-tabular text-[15px] font-bold text-ink leading-tight">₹{formatPrice(active.c)}</p>
          <p className="text-[11px] text-ink-faint mb-1.5">{pointLabel(active.t, intraday, range)}</p>
          {showCandles || ohlc ? (
            <p className="mono-tabular text-[11px] text-ink-muted">
              O {formatPrice(active.o)} · H {formatPrice(active.h)} · L {formatPrice(active.l)}
            </p>
          ) : null}
          {active.v > 0 && <p className="mono-tabular text-[11px] text-ink-muted">Vol {formatCount(active.v)}</p>}
          {(() => {
            const vsStart = first ? ((active.c - first) / first) * 100 : 0
            return (
              <p className={`mono-tabular text-[11px] font-semibold mt-1 ${vsStart >= 0 ? 'text-up' : 'text-down'}`}>
                {vsStart >= 0 ? '▲' : '▼'} {formatPct(vsStart)} <span className="font-normal text-ink-faint">since start of range</span>
              </p>
            )
          })()}
          {overlays.ma50 && ma50[hover] !== null && (
            <p className="mono-tabular text-[11px] text-ink-muted flex items-center gap-1.5 mt-1">
              <span className="inline-block w-3 h-0.5 rounded" style={{ background: 'var(--chart-2)' }} /> MA 50 {formatPrice(ma50[hover])}
            </p>
          )}
          {overlays.ma200 && ma200[hover] !== null && (
            <p className="mono-tabular text-[11px] text-ink-muted flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded" style={{ background: 'var(--chart-3)' }} /> MA 200 {formatPrice(ma200[hover])}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Accessible twin of the chart: the most recent bars as a table. */
export function PriceTable({ candles, intraday, range }: { candles: ChartCandle[]; intraday: boolean; range: string }) {
  const rows = candles.slice(-30).reverse()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-faint text-left">
            <th className="py-2 pr-4 font-semibold">{intraday ? 'Time' : 'Date'}</th>
            <th className="py-2 pr-4 font-semibold text-right">Open</th>
            <th className="py-2 pr-4 font-semibold text-right">High</th>
            <th className="py-2 pr-4 font-semibold text-right">Low</th>
            <th className="py-2 pr-4 font-semibold text-right">Close</th>
            <th className="py-2 font-semibold text-right">Volume</th>
          </tr>
        </thead>
        <tbody className="mono-tabular">
          {rows.map((c) => (
            <tr key={c.t} className="border-t border-border">
              <td className="py-1.5 pr-4 text-ink-muted whitespace-nowrap">{pointLabel(c.t, intraday, range)}</td>
              <td className="py-1.5 pr-4 text-right text-ink">{formatPrice(c.o)}</td>
              <td className="py-1.5 pr-4 text-right text-ink">{formatPrice(c.h)}</td>
              <td className="py-1.5 pr-4 text-right text-ink">{formatPrice(c.l)}</td>
              <td className="py-1.5 pr-4 text-right text-ink font-semibold">{formatPrice(c.c)}</td>
              <td className="py-1.5 text-right text-ink-muted">{c.v > 0 ? formatCount(c.v) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-ink-faint mt-2">Most recent {rows.length} bars, newest first.</p>
    </div>
  )
}
