'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatINRCompact, formatPct, formatPrice } from '@/lib/format'
import { heatColor, heatInk, heatStep } from '@/lib/heat'
import { inset, squarify, type Rect } from '@/lib/treemap'

export interface TreemapStock {
  symbol: string
  name: string
  sector: string
  price: number
  changePct: number
  marketCap?: number | null
}

interface Hovered {
  stock: TreemapStock
  /** Tile centre and edges, for placing the tooltip beside it. */
  x: number
  top: number
  bottom: number
}

const SECTOR_HEADER = 18
const GAP = 1

/**
 * The NIFTY 50 as a treemap: each company's area is its market value, its
 * colour is today's move, and companies sit inside their sector — so the
 * shape of the market (a few banks and Reliance are most of the index) reads
 * before any number does. Every tile links to the company's page; values
 * that do not fit on a small tile are in its tooltip and in the grid view.
 */
export default function MarketTreemap({ stocks }: { stocks: TreemapStock[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(960)
  const [hovered, setHovered] = useState<Hovered | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const height = Math.round(Math.min(640, Math.max(width < 640 ? 520 : 400, width * 0.56)))

  const layout = useMemo(() => {
    // A company without a reported market value still deserves a tile; the
    // median keeps it visible without pretending to know its size.
    const caps = stocks.map((s) => s.marketCap ?? 0).filter((c) => c > 0).sort((a, b) => a - b)
    const fallback = caps.length ? caps[Math.floor(caps.length / 2)] : 1
    const weight = (s: TreemapStock) => (s.marketCap && s.marketCap > 0 ? s.marketCap : fallback)

    const bySector = new Map<string, TreemapStock[]>()
    for (const s of stocks) {
      const key = s.sector || 'Other'
      if (!bySector.has(key)) bySector.set(key, [])
      bySector.get(key)!.push(s)
    }

    const sectors = Array.from(bySector.entries()).map(([sector, members]) => {
      const total = members.reduce((sum, s) => sum + weight(s), 0)
      const weightedMove = members.reduce((sum, s) => sum + weight(s) * s.changePct, 0) / (total || 1)
      return { sector, members, total, weightedMove }
    })

    const placedSectors = squarify(
      sectors.map((s) => ({ weight: s.total, item: s })),
      { x: 0, y: 0, w: width, h: height }
    )

    return placedSectors.map(({ item, rect }) => {
      const showHeader = rect.h > 56 && rect.w > 64
      const inner = inset(rect, GAP + 1, showHeader ? SECTOR_HEADER + 1 : GAP + 1)
      const tiles = squarify(
        item.members.map((m) => ({ weight: weight(m), item: m })),
        inner
      )
      return { ...item, rect, showHeader, tiles }
    })
  }, [stocks, width, height])

  const onEnter = (stock: TreemapStock, rect: Rect) => {
    setHovered({ stock, x: rect.x + rect.w / 2, top: rect.y, bottom: rect.y + rect.h })
  }

  return (
    <div ref={ref} className="relative w-full rounded-xl overflow-hidden bg-surface" style={{ height }}>
      {layout.map((sector) => (
        <div key={sector.sector}>
          {sector.showHeader && (
            <div
              className="absolute flex items-center justify-between gap-2 px-1.5 overflow-hidden"
              style={{ left: sector.rect.x + 2, top: sector.rect.y + 1, width: sector.rect.w - 4, height: SECTOR_HEADER }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted truncate">{sector.sector}</span>
              {sector.rect.w > 120 && (
                <span className={`mono-tabular text-[10px] font-semibold ${sector.weightedMove >= 0 ? 'text-up' : 'text-down'}`}>
                  {sector.weightedMove >= 0 ? '▲' : '▼'} {formatPct(sector.weightedMove)}
                </span>
              )}
            </div>
          )}
          {sector.tiles.map(({ item: s, rect }) => {
            const step = heatStep(s.changePct, 'equity')
            const r = inset(rect, GAP / 2)
            const size = Math.sqrt(r.w * r.h)
            // Sized by area, but never wider than the tile: a symbol cut to
            // "BAJAJF…" is worse than the same symbol a point smaller.
            const fitWidth = (r.w - 8) / (s.symbol.length * 0.64)
            const fontSize = Math.max(8, Math.min(22, size / 5.2, fitWidth))
            const showSymbol = r.w > 26 && r.h > 16
            const showChange = r.h > 32 && r.w > 40
            const showName = r.w > 120 && r.h > 78
            const showPrice = r.w > 76 && r.h > 58
            return (
              <Link
                key={s.symbol}
                href={`/stocks/${encodeURIComponent(s.symbol)}`}
                className="absolute flex flex-col items-center justify-center text-center rounded-[4px] overflow-hidden transition-[filter,box-shadow] duration-150 hover:brightness-125 focus-visible:brightness-125 focus-visible:z-10"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: heatColor(step), color: heatInk(step) }}
                onPointerEnter={() => onEnter(s, r)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => onEnter(s, r)}
                onBlur={() => setHovered(null)}
                aria-label={`${s.name}, ₹${formatPrice(s.price)}, ${s.changePct >= 0 ? 'up' : 'down'} ${Math.abs(s.changePct).toFixed(2)}% today`}
              >
                {showSymbol && (
                  <span className="font-bold leading-tight px-1 truncate max-w-full" style={{ fontSize }}>
                    {s.symbol}
                  </span>
                )}
                {showName && (
                  <span className="text-[11px] leading-tight opacity-80 px-2 truncate max-w-full">{s.name}</span>
                )}
                {showChange && (
                  <span className="mono-tabular font-semibold leading-tight" style={{ fontSize: Math.max(9, fontSize * 0.62) }}>
                    {formatPct(s.changePct)}
                  </span>
                )}
                {showPrice && (
                  <span className="mono-tabular leading-tight opacity-75" style={{ fontSize: Math.max(9, fontSize * 0.5) }}>
                    ₹{formatPrice(s.price)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}

      {hovered && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.max(6, Math.min(width - 206, hovered.x - 100)),
            // Below the tile, unless that would run off the map — then above it.
            ...(hovered.bottom + 118 > height ? { bottom: height - hovered.top + 6 } : { top: hovered.bottom + 6 }),
            width: 200,
          }}
        >
          <p className="mono-tabular text-[15px] font-bold text-ink leading-tight">₹{formatPrice(hovered.stock.price)}</p>
          <p className={`mono-tabular text-xs font-semibold ${hovered.stock.changePct >= 0 ? 'text-up' : 'text-down'}`}>
            {hovered.stock.changePct >= 0 ? '▲' : '▼'} {formatPct(hovered.stock.changePct)} today
          </p>
          <p className="text-xs text-ink mt-1.5 font-semibold leading-snug">{hovered.stock.name}</p>
          <p className="text-[11px] text-ink-faint">
            {hovered.stock.symbol} · {hovered.stock.sector}
            {hovered.stock.marketCap ? ` · ${formatINRCompact(hovered.stock.marketCap)}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
