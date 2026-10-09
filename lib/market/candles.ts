/**
 * OHLCV candles for Indian equities and indices, from three independent
 * providers. Each was verified to answer a datacenter IP and its response
 * recorded in scripts/fixtures/market, which the parsers here are tested
 * against (scripts/test-market.mjs).
 *
 *   Upstox      — a documented public API (no key for historical candles).
 *                 Keys instruments by ISIN, so it covers every NSE listing.
 *   Moneycontrol — the TradingView-format feed behind moneycontrol.com's
 *                 charts. Keyed by NSE symbol.
 *   Groww       — the feed behind groww.in's charts. Keyed by NSE symbol.
 *
 * Server-side only.
 */

export interface Candle {
  /** Epoch milliseconds of the bar's open. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export type CandleSource = 'upstox' | 'moneycontrol' | 'groww' | 'yahoo'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const TIMEOUT_MS = 8000

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

async function getJson(url: string, headers: Record<string, string>, revalidate: number): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate },
    })
  } catch (err: any) {
    throw new Error(`unreachable (${err?.cause?.code || err?.name || 'network error'})`)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// ── Upstox ────────────────────────────────────────────────────────────────

export type UpstoxUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months'

/** Index instrument keys, by the ids the rest of the app uses for them. */
export const UPSTOX_INDEX_KEYS: Record<string, string> = {
  '^NSEI': 'NSE_INDEX|Nifty 50',
  '^BSESN': 'BSE_INDEX|SENSEX',
  '^NSEBANK': 'NSE_INDEX|Nifty Bank',
  '^CNXIT': 'NSE_INDEX|Nifty IT',
  '^CNXAUTO': 'NSE_INDEX|Nifty Auto',
  '^CNXPHARMA': 'NSE_INDEX|Nifty Pharma',
  '^CNXFMCG': 'NSE_INDEX|Nifty FMCG',
  '^CNXMETAL': 'NSE_INDEX|Nifty Metal',
  '^CNXENERGY': 'NSE_INDEX|Nifty Energy',
  '^CNXREALTY': 'NSE_INDEX|Nifty Realty',
  '^CNXINFRA': 'NSE_INDEX|Nifty Infra',
  '^CNXPSUBANK': 'NSE_INDEX|Nifty PSU Bank',
  '^CNXMEDIA': 'NSE_INDEX|Nifty Media',
  '^CNXFIN': 'NSE_INDEX|Nifty Fin Service',
  '^CNXPVTBANK': 'NSE_INDEX|Nifty Pvt Bank',
  '^CNXHEALTH': 'NSE_INDEX|NIFTY HEALTHCARE',
  '^CNXOILGAS': 'NSE_INDEX|NIFTY OIL AND GAS',
  '^CNXCONSUM': 'NSE_INDEX|Nifty Consumption',
  '^NSEMDCP50': 'NSE_INDEX|Nifty Midcap 50',
  '^CNXMIDCAP': 'NSE_INDEX|NIFTY MIDCAP 100',
  '^CNXSMALLCAP': 'NSE_INDEX|NIFTY SMLCAP 100',
  '^NSMIDCP': 'NSE_INDEX|Nifty Next 50',
  '^CRSLDX': 'NSE_INDEX|Nifty 500',
  '^INDIAVIX': 'NSE_INDEX|India VIX',
}

export function upstoxEquityKey(isin: string): string {
  return `NSE_EQ|${isin}`
}

/** Upstox candle rows are [iso, open, high, low, close, volume, oi], newest first. */
export function parseUpstox(body: any): Candle[] {
  const rows: unknown[] = Array.isArray(body?.data?.candles) ? body.data.candles : []
  const candles: Candle[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const t = Date.parse(String(row[0]))
    const [o, h, l, c, v] = row.slice(1, 6)
    if (!Number.isFinite(t) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) continue
    candles.push({ t, o, h, l, c, v: finite(v) ? v : 0 })
  }
  return candles.sort((a, b) => a.t - b.t)
}

function ymdIST(date: Date): string {
  // Upstox's date parameters are calendar dates in India.
  return new Date(date.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function upstoxCandles(
  key: string,
  unit: UpstoxUnit,
  interval: number,
  from: Date,
  to: Date,
  revalidate: number
): Promise<Candle[]> {
  const url =
    `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(key)}` +
    `/${unit}/${interval}/${ymdIST(to)}/${ymdIST(from)}`
  return parseUpstox(await getJson(url, {}, revalidate))
}

/** Today's bars so far. Empty before the open and on holidays. */
export async function upstoxIntraday(key: string, interval: number, revalidate: number): Promise<Candle[]> {
  const url = `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(key)}/minutes/${interval}`
  return parseUpstox(await getJson(url, {}, revalidate))
}

// ── Moneycontrol ──────────────────────────────────────────────────────────

export type McResolution = '1' | '5' | '15' | '30' | '60' | '1D' | '1W'

/** UDF format: parallel arrays t/o/h/l/c/v, t in epoch seconds, oldest first. */
export function parseUdf(body: any): Candle[] {
  if (body?.s !== 'ok' || !Array.isArray(body.t)) return []
  const candles: Candle[] = []
  for (let i = 0; i < body.t.length; i++) {
    const t = body.t[i] * 1000
    const o = body.o?.[i], h = body.h?.[i], l = body.l?.[i], c = body.c?.[i], v = body.v?.[i]
    if (!Number.isFinite(t) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) continue
    candles.push({ t, o, h, l, c, v: finite(v) ? v : 0 })
  }
  return candles.sort((a, b) => a.t - b.t)
}

export async function moneycontrolCandles(
  nseSymbol: string,
  resolution: McResolution,
  from: Date,
  to: Date,
  countback: number,
  revalidate: number
): Promise<Candle[]> {
  const url =
    `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(nseSymbol)}&resolution=${resolution}` +
    `&from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}` +
    `&countback=${countback}&currencyCode=INR`
  return parseUdf(
    await getJson(url, { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' }, revalidate)
  )
}

// ── Groww ─────────────────────────────────────────────────────────────────

/** Groww rows are [epochSeconds, open, high, low, close, volume], oldest first. */
export function parseGroww(body: any): Candle[] {
  const rows: unknown[] = Array.isArray(body?.candles) ? body.candles : []
  const candles: Candle[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const [ts, o, h, l, c, v] = row
    if (!finite(ts) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) continue
    candles.push({ t: ts * 1000, o, h, l, c, v: finite(v) ? v : 0 })
  }
  return candles.sort((a, b) => a.t - b.t)
}

export async function growwCandles(
  nseSymbol: string,
  intervalMinutes: number,
  from: Date,
  to: Date,
  revalidate: number
): Promise<Candle[]> {
  const url =
    `https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE/segment/CASH/${encodeURIComponent(nseSymbol)}` +
    `?endTimeInMillis=${to.getTime()}&intervalInMinutes=${intervalMinutes}&startTimeInMillis=${from.getTime()}`
  return parseGroww(await getJson(url, {}, revalidate))
}
