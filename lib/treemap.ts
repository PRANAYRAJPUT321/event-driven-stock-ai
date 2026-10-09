/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
 *
 * Lays out weighted items in a rectangle so each item's area is proportional
 * to its weight and the tiles stay as close to square as possible — long
 * slivers are unreadable and hard to hover. Pure geometry, no DOM, so it is
 * unit-tested directly (scripts/test-market.mjs).
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed<T> {
  item: T
  rect: Rect
}

/** The worst (largest) aspect ratio in a row laid along a side of length `side`. */
function worstRatio(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0)
  if (sum <= 0 || side <= 0) return Infinity
  let max = -Infinity
  let min = Infinity
  for (const v of row) {
    if (v > max) max = v
    if (v < min) min = v
  }
  const s2 = sum * sum
  const side2 = side * side
  return Math.max((side2 * max) / s2, s2 / (side2 * min))
}

export function squarify<T>(items: { weight: number; item: T }[], bounds: Rect): Placed<T>[] {
  const positive = items.filter((i) => i.weight > 0).sort((a, b) => b.weight - a.weight)
  const total = positive.reduce((s, i) => s + i.weight, 0)
  if (positive.length === 0 || total <= 0 || bounds.w <= 0 || bounds.h <= 0) return []

  const scale = (bounds.w * bounds.h) / total
  const areas = positive.map((i) => i.weight * scale)
  const out: Placed<T>[] = []
  let remaining: Rect = { ...bounds }
  let row: number[] = []
  let rowStart = 0

  const placeRow = () => {
    const sum = row.reduce((a, b) => a + b, 0)
    if (remaining.w >= remaining.h) {
      // Wide: the row becomes a column on the left.
      const colW = sum / remaining.h
      let y = remaining.y
      row.forEach((area, k) => {
        const h = area / colW
        out.push({ item: positive[rowStart + k].item, rect: { x: remaining.x, y, w: colW, h } })
        y += h
      })
      remaining = { x: remaining.x + colW, y: remaining.y, w: remaining.w - colW, h: remaining.h }
    } else {
      // Tall: the row becomes a strip along the top.
      const rowH = sum / remaining.w
      let x = remaining.x
      row.forEach((area, k) => {
        const w = area / rowH
        out.push({ item: positive[rowStart + k].item, rect: { x, y: remaining.y, w, h: rowH } })
        x += w
      })
      remaining = { x: remaining.x, y: remaining.y + rowH, w: remaining.w, h: remaining.h - rowH }
    }
    rowStart += row.length
    row = []
  }

  let i = 0
  while (i < areas.length) {
    const side = Math.min(remaining.w, remaining.h)
    const candidate = [...row, areas[i]]
    if (row.length === 0 || worstRatio(candidate, side) <= worstRatio(row, side)) {
      row = candidate
      i++
    } else {
      placeRow()
    }
  }
  if (row.length) placeRow()
  return out
}

/** Shrinks a rectangle by `pad` on every side, never below zero size. */
export function inset(rect: Rect, pad: number, top = pad): Rect {
  return {
    x: rect.x + pad,
    y: rect.y + top,
    w: Math.max(0, rect.w - pad * 2),
    h: Math.max(0, rect.h - top - pad),
  }
}
