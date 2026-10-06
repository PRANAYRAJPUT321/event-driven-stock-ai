/**
 * Stooq — a second, independent price source.
 *
 * Why a second source at all: Yahoo's endpoints are the only ones this app
 * used, and they rate-limit datacenter addresses hard. A serverless function
 * has exactly such an address, so a page that works from a laptop can return
 * nothing in production, which is precisely what happened to the NIFTY grid.
 * One provider with no alternative means one bad day is an outage.
 *
 * Why Stooq specifically: it is a different company on different
 * infrastructure, it needs no key, no signup and no session handshake, and it
 * answers a comma-free batch — several symbols in one URL, separated by `+`,
 * returned as CSV. Its quote endpoint is a plain file served from a static
 * cache, which is why it tolerates traffic that Yahoo's JSON APIs do not.
 *
 * Symbols: Stooq suffixes Indian listings with `.in` and US with `.us`. An
 * unknown symbol is not an error — the row comes back with N/D in the price
 * columns, which parses to null and simply falls through to the next source.
 *
 * Server-side only; the endpoint sends no CORS headers.
 */

const HOST = 'https://stooq.com'
const TIMEOUT_MS = 7000
/** Keeps each URL comfortably short and each response small. */
const BATCH_SIZE = 25

export interface StooqQuote {
  symbol: string
  price: number
  previousClose: number | null
  /** Session open/high/low, where Stooq reports them. */
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  asOf: string | null
}

function num(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  // Stooq writes N/D for a symbol it does not carry, and for a session that
  // has not opened yet.
  if (!trimmed || trimmed === 'N/D') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** NSE ticker to the form Stooq lists it under. */
export function toStooqSymbol(nseSymbol: string): string {
  return `${nseSymbol.toLowerCase().replace(/[^a-z0-9]/g, '')}.in`
}

/**
 * Parses Stooq's quote CSV.
 *
 * Exported so the parser can be tested without the network, which matters
 * because this feed cannot be reached from every environment the project is
 * developed in.
 */
export function parseStooqCsv(csv: string): Map<string, StooqQuote> {
  const out = new Map<string, StooqQuote>()
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return out

  const header = lines[0].toLowerCase().split(',')
  const col = (name: string) => header.indexOf(name)
  const iSymbol = col('symbol')
  const iDate = col('date')
  const iTime = col('time')
  const iOpen = col('open')
  const iHigh = col('high')
  const iLow = col('low')
  const iClose = col('close')
  const iVolume = col('volume')
  if (iSymbol === -1 || iClose === -1) return out

  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const symbol = cells[iSymbol]?.trim().toLowerCase()
    const price = num(cells[iClose])
    if (!symbol || price === null) continue

    const date = cells[iDate]?.trim()
    const time = cells[iTime]?.trim()
    const asOf =
      date && date !== 'N/D'
        ? new Date(`${date}T${time && time !== 'N/D' ? time : '00:00:00'}Z`).toISOString()
        : null

    out.set(symbol, {
      symbol,
      price,
      // The quote endpoint carries no previous close; the caller derives the
      // move from the daily series instead, or leaves it null rather than
      // inventing one.
      previousClose: null,
      open: num(cells[iOpen]),
      high: num(cells[iHigh]),
      low: num(cells[iLow]),
      volume: num(cells[iVolume]),
      asOf,
    })
  }
  return out
}

async function get(url: string, revalidateSeconds: number): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'text/csv,text/plain,*/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: revalidateSeconds },
  })
  if (!response.ok) throw new Error(`Stooq returned HTTP ${response.status}`)
  return response.text()
}

/**
 * Latest quote for a list of NSE symbols, batched.
 *
 * Returns a map keyed by the *NSE* symbol, not Stooq's, so callers never deal
 * with the suffix. A symbol Stooq does not carry is simply absent.
 */
export async function fetchStooqQuotes(
  nseSymbols: string[],
  revalidateSeconds = 60
): Promise<Map<string, StooqQuote>> {
  const result = new Map<string, StooqQuote>()
  if (nseSymbols.length === 0) return result

  const stooqToNse = new Map(nseSymbols.map((s) => [toStooqSymbol(s), s]))
  const batches: string[][] = []
  const stooqSymbols = Array.from(stooqToNse.keys())
  for (let i = 0; i < stooqSymbols.length; i += BATCH_SIZE) {
    batches.push(stooqSymbols.slice(i, i + BATCH_SIZE))
  }

  // Sequential rather than parallel: the whole point of this provider is to
  // be gentle, and two or three requests finish quickly anyway.
  for (const batch of batches) {
    try {
      const csv = await get(
        `${HOST}/q/l/?s=${encodeURIComponent(batch.join('+'))}&f=sd2t2ohlcv&h&e=csv`,
        revalidateSeconds
      )
      for (const [stooqSymbol, quote] of parseStooqCsv(csv)) {
        const nse = stooqToNse.get(stooqSymbol)
        if (nse) result.set(nse, quote)
      }
    } catch {
      // A failed batch costs those symbols, not the rest.
    }
  }

  return result
}

/**
 * Daily closes for one symbol, newest last.
 *
 * Used to derive the previous session's close, which the quote endpoint does
 * not carry — the alternative would be showing a price with no move beside
 * it, or inventing the move, and neither is acceptable.
 */
export async function fetchStooqDaily(
  nseSymbol: string,
  revalidateSeconds = 300
): Promise<number[]> {
  try {
    const csv = await get(
      `${HOST}/q/d/l/?s=${encodeURIComponent(toStooqSymbol(nseSymbol))}&i=d`,
      revalidateSeconds
    )
    const lines = csv.trim().split(/\r?\n/)
    if (lines.length < 2) return []
    const header = lines[0].toLowerCase().split(',')
    const iClose = header.indexOf('close')
    if (iClose === -1) return []
    return lines
      .slice(1)
      .map((line) => num(line.split(',')[iClose]))
      .filter((c): c is number => c !== null)
  } catch {
    return []
  }
}
