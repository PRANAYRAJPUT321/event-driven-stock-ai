/**
 * Number and date formatting for Indian markets, shared by every page.
 *
 * Money uses Indian units — crore (1e7) and lakh crore (1e12) — because that
 * is how the market reports company sizes ("₹16.3 lakh crore", not
 * "₹16.3 trillion"), and digit grouping follows the en-IN locale (12,34,567).
 * Times are shown in IST regardless of the reader's own zone: an NSE session
 * opens at 09:15 IST wherever you are.
 */

const IST = 'Asia/Kolkata'

export function formatPrice(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const d = digits ?? (Math.abs(value) < 10 ? 4 : 2)
  return value.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function formatINR(value: number | null | undefined, digits?: number): string {
  const p = formatPrice(value, digits)
  return p === '—' ? p : `₹${p}`
}

/** ₹16.33L Cr, ₹74,727 Cr, ₹4.2 L — the units Indian market data is read in. */
export function formatINRCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  const v = Math.abs(value)
  if (v >= 1e12) return `${sign}₹${(v / 1e12).toFixed(2)}L Cr`
  if (v >= 1e7) return `${sign}₹${Math.round(v / 1e7).toLocaleString('en-IN')} Cr`
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`
  return `${sign}₹${Math.round(v).toLocaleString('en-IN')}`
}

/** 1.39 Cr, 68.4 L, 12,345 — share counts and volumes. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const v = Math.abs(value)
  if (v >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`
  if (v >= 1e5) return `${(value / 1e5).toFixed(1)} L`
  return Math.round(value).toLocaleString('en-IN')
}

export function formatPct(value: number | null | undefined, { signed = true, digits = 2 } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const s = value.toFixed(digits)
  return signed && value > 0 ? `+${s}%` : `${s.replace('-', '−')}%`
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function directionGlyph(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '•'
  return value > 0 ? '▲' : '▼'
}

export function formatTimeIST(t: number): string {
  return new Date(t).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDateIST(t: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Date(t).toLocaleDateString('en-IN', { timeZone: IST, ...opts })
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Whether NSE's regular session is open right now (09:15–15:30 IST, Mon–Fri).
 * Exchange holidays are not modelled, so a holiday reads as "open" with a
 * stale price — the timestamp shown beside every quote covers that case.
 */
export function nseSessionState(now = Date.now()): { open: boolean; label: string } {
  const ist = new Date(now + 5.5 * 3600 * 1000)
  const day = ist.getUTCDay()
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  if (day === 0 || day === 6) return { open: false, label: 'Market closed · weekend' }
  if (minutes < 9 * 60) return { open: false, label: 'Pre-market' }
  if (minutes < 9 * 60 + 15) return { open: false, label: 'Pre-open session' }
  if (minutes <= 15 * 60 + 30) return { open: true, label: 'Market open' }
  return { open: false, label: 'Market closed' }
}
