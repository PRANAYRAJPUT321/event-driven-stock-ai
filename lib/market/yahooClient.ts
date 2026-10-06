/**
 * Shared request layer for every Yahoo Finance call in the app.
 *
 * Why this exists: the market pages used to fetch each symbol with its own
 * request, all started at once through Promise.allSettled. With 52 NIFTY
 * constituents and 66 heatmap instruments that is over a hundred simultaneous
 * requests from one serverless function to one host, and Yahoo answers that
 * with HTTP 429 for nearly all of them. The site then showed "no usable
 * quotes for any NIFTY 50 constituent" — not because the feed was down, but
 * because we were asking for everything at once.
 *
 * Three things fix it, in order of how much they help:
 *
 *   1. Ask once for many symbols. v7/finance/quote takes a comma-separated
 *      list and returns every quote in one response, so 52 requests become 2.
 *      It needs a cookie + crumb session, which is cheap and cached.
 *   2. Bound the concurrency of whatever still has to go one-by-one.
 *   3. Retry a 429 or a 5xx after a short, jittered wait, on the other host.
 *
 * Must only be called server-side; none of these endpoints send CORS headers.
 */

export const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']

const TIMEOUT_MS = 7000
const MAX_ATTEMPTS = 3
/** Yahoo tolerates a handful of parallel requests; it does not tolerate fifty. */
export const DEFAULT_CONCURRENCY = 4
/** v7/finance/quote accepts a long list, but a shorter one fails less often. */
const BATCH_SIZE = 40

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `fn` over `items` with at most `limit` in flight at any moment.
 *
 * Results come back in input order, each either fulfilled or rejected, so
 * callers keep the partial-failure handling they already had.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  )
  return results
}

/**
 * A single Yahoo request with host rotation and backoff.
 *
 * `path` is everything after the host, starting with a slash. A 429 or 5xx is
 * retried on the other host after a jittered wait; a 404 is not, because the
 * symbol genuinely does not exist and waiting will not change that.
 */
export async function yahooRequest(
  path: string,
  options: { cookie?: string; revalidate?: number; attempts?: number } = {}
): Promise<Response> {
  const attempts = options.attempts ?? MAX_ATTEMPTS
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const host = YAHOO_HOSTS[attempt % YAHOO_HOSTS.length]
    try {
      const response = await fetch(`https://${host}${path}`, {
        headers: {
          'User-Agent': YAHOO_USER_AGENT,
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(options.revalidate !== undefined && !options.cookie
          ? { next: { revalidate: options.revalidate } }
          : { cache: 'no-store' as RequestCache }),
      })

      // Retry only what a retry can fix.
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} from ${host}`)
        if (attempt < attempts - 1) {
          // 250ms, 600ms, … plus jitter, so parallel workers do not all wake
          // together and reproduce the burst that caused the 429.
          await sleep(250 * Math.pow(2.2, attempt) + Math.random() * 200)
          continue
        }
        return response
      }
      return response
    } catch (err: any) {
      lastError = new Error(err?.message || 'request failed')
      if (attempt < attempts - 1) await sleep(200 * (attempt + 1) + Math.random() * 150)
    }
  }

  throw lastError ?? new Error('Yahoo request failed')
}

// ── Session (cookie + crumb) ────────────────────────────────────────────────
// Shared by the batch quote endpoint and the fundamentals endpoint, so the
// handshake happens at most once per lambda per ten minutes.

let cachedSession: { cookie: string; crumb: string; at: number } | null = null
const SESSION_TTL_MS = 10 * 60 * 1000

export async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedSession && Date.now() - cachedSession.at < SESSION_TTL_MS) {
    return { cookie: cachedSession.cookie, crumb: cachedSession.crumb }
  }
  try {
    const seed = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YAHOO_USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      cache: 'no-store',
    })
    const setCookies =
      typeof (seed.headers as any).getSetCookie === 'function'
        ? (seed.headers as any).getSetCookie()
        : ([seed.headers.get('set-cookie')].filter(Boolean) as string[])
    const cookie = setCookies
      .map((c: string) => c.split(';')[0])
      .filter(Boolean)
      .join('; ')
    if (!cookie) return null

    const crumbResponse = await yahooRequest('/v1/test/getcrumb', { cookie, attempts: 2 })
    if (!crumbResponse.ok) return null
    const crumb = (await crumbResponse.text()).trim()
    if (!crumb || crumb.length > 64 || crumb.includes('<')) return null

    cachedSession = { cookie, crumb, at: Date.now() }
    return { cookie, crumb }
  } catch {
    return null
  }
}

/** Drops the cached session so the next caller re-handshakes. */
export function invalidateYahooSession(): void {
  cachedSession = null
}

// ── Batch quotes ────────────────────────────────────────────────────────────

export interface BatchQuote {
  symbol: string
  price: number | null
  previousClose: number | null
  currency: string | null
  marketTimeSeconds: number | null
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One request per 40 symbols instead of one per symbol.
 *
 * Returns only what the endpoint actually answered for; the caller fills the
 * gaps from the chart endpoint. A null return means the session handshake
 * failed, i.e. the batch path is unavailable right now and everything must
 * fall back.
 */
export async function fetchQuotesBatch(symbols: string[]): Promise<Map<string, BatchQuote> | null> {
  if (symbols.length === 0) return new Map()
  const session = await getYahooSession()
  if (!session) return null

  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    chunks.push(symbols.slice(i, i + BATCH_SIZE))
  }

  const found = new Map<string, BatchQuote>()
  // Two in flight at most: these are large responses and the point of this
  // path is to stop flooding the host.
  const settled = await mapWithConcurrency(chunks, 2, async (chunk) => {
    const path =
      `/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}` +
      `&crumb=${encodeURIComponent(session.crumb)}`
    const response = await yahooRequest(path, { cookie: session.cookie, attempts: 2 })
    if (response.status === 401 || response.status === 403) {
      // The crumb went stale mid-flight; drop it so the next call re-handshakes.
      invalidateYahooSession()
      throw new Error(`quote batch rejected: HTTP ${response.status}`)
    }
    if (!response.ok) throw new Error(`quote batch: HTTP ${response.status}`)
    const body = await response.json()
    const rows: any[] = body?.quoteResponse?.result ?? []
    return rows
  })

  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    for (const row of outcome.value) {
      const symbol = typeof row?.symbol === 'string' ? row.symbol : null
      if (!symbol) continue
      const price =
        numeric(row.regularMarketPrice) ??
        numeric(row.postMarketPrice) ??
        numeric(row.preMarketPrice)
      if (price === null) continue
      found.set(symbol, {
        symbol,
        price,
        previousClose:
          numeric(row.regularMarketPreviousClose) ?? numeric(row.chartPreviousClose),
        currency: typeof row.currency === 'string' ? row.currency : null,
        marketTimeSeconds: numeric(row.regularMarketTime),
      })
    }
  }

  return found
}

// ── Last-good cache ─────────────────────────────────────────────────────────

/**
 * Keeps the most recent successful payload per key for the lifetime of the
 * lambda, so a rate-limited minute shows slightly stale prices with their age
 * rather than an empty grid. Stale data that says it is stale is far more
 * useful here than nothing at all — but it is never passed off as live: every
 * caller surfaces `asOf` so the page can label it.
 */
const lastGood = new Map<string, { value: unknown; at: number }>()
const LAST_GOOD_TTL_MS = 15 * 60 * 1000

export function rememberLastGood<T>(key: string, value: T): void {
  lastGood.set(key, { value, at: Date.now() })
}

export function recallLastGood<T>(key: string): { value: T; ageSeconds: number } | null {
  const entry = lastGood.get(key)
  if (!entry) return null
  const age = Date.now() - entry.at
  if (age > LAST_GOOD_TTL_MS) {
    lastGood.delete(key)
    return null
  }
  return { value: entry.value as T, ageSeconds: Math.round(age / 1000) }
}
