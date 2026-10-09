/**
 * Live quotes for the market bar, the /markets heatmaps and the NIFTY 50
 * grid, resolved across providers in order of reliability from a server:
 *
 *   1. TradingView's screener — one request for every index, commodity and
 *      currency, and one for all fifty constituents.
 *   2. Upstox — the Indian sector indices the screener does not carry, and a
 *      per-stock fallback built from today's bars and the last daily close.
 *   3. The ECB's reference rates (Frankfurter), for currency pairs.
 *   4. Yahoo Finance — last, since it refuses Vercel's servers outright.
 *
 * Whatever a refresh does not resolve is filled from the last good quote per
 * symbol (up to 30 minutes old) and labelled as such, so a bad minute at one
 * provider thins nothing out.
 *
 * Server-side only.
 */
import { upstoxCandles, upstoxEquityKey, upstoxIntraday, UPSTOX_INDEX_KEYS, type Candle } from './candles'
import { fetchFxQuotes, FRANKFURTER_SYMBOLS } from './frankfurter'
import { isinFor } from './nseDirectory'
import { fetchRecentCloses } from './priceHistory'
import { QUOTE_COLUMNS, quoteFromRow, tvScan, tvTicker, num } from './tradingView'
import type { MarketQuote, QuoteCategory, TrackedSymbol } from './types'
import { mapWithConcurrency } from './yahooClient'
import { resolveYahooQuotes } from './yahooFinance'

export type { MarketQuote, QuoteCategory, QuoteSource, TrackedSymbol } from './types'

/**
 * The compact set shown in the always-on header bar. Kept deliberately short:
 * a marquee people can actually read beats an exhaustive one they cannot.
 * Domestic first, because this is an Indian-equity product.
 */
export const TRACKED_SYMBOLS: TrackedSymbol[] = [
  { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic', tv: 'NSE:NIFTY' },
  { symbol: '^BSESN', name: 'SENSEX', category: 'domestic', tv: 'BSE:SENSEX' },
  { symbol: '^NSEBANK', name: 'BANK NIFTY', category: 'domestic', tv: 'NSE:BANKNIFTY' },
  { symbol: '^CNXIT', name: 'NIFTY IT', category: 'domestic', tv: 'NSE:CNXIT' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX', category: 'domestic', tv: 'NSE:INDIAVIX' },

  { symbol: '^GSPC', name: 'S&P 500', category: 'international', tv: 'SP:SPX' },
  { symbol: '^IXIC', name: 'NASDAQ', category: 'international', tv: 'NASDAQ:IXIC' },
  { symbol: '^DJI', name: 'DOW JONES', category: 'international', tv: 'DJ:DJI' },
  { symbol: '^FTSE', name: 'FTSE 100', category: 'international', tv: 'TVC:UKX' },
  { symbol: '^N225', name: 'NIKKEI 225', category: 'international', tv: 'TVC:NI225' },
  { symbol: '^HSI', name: 'HANG SENG', category: 'international', tv: 'TVC:HSI' },

  { symbol: 'GC=F', name: 'GOLD', category: 'commodity', tv: 'TVC:GOLD' },
  { symbol: 'SI=F', name: 'SILVER', category: 'commodity', tv: 'TVC:SILVER' },
  { symbol: 'CL=F', name: 'WTI CRUDE', category: 'commodity', tv: 'NYMEX:CL1!' },
  { symbol: 'BZ=F', name: 'BRENT CRUDE', category: 'commodity', tv: 'ICEEUR:BRN1!' },

  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency', tv: 'FX_IDC:USDINR' },
  { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency', tv: 'FX_IDC:EURINR' },
]

/**
 * The full set behind the /markets heatmaps. Every ticker here was checked
 * against the provider that serves it (scripts/fixtures/market/probe3.json);
 * entries with no `tv` are Indian sector indices served by Upstox.
 */
export const HEATMAP_SYMBOLS: TrackedSymbol[] = [
  // ── India: headline and sector indices ──────────────────────────────
  { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic', tv: 'NSE:NIFTY' },
  { symbol: '^BSESN', name: 'SENSEX', category: 'domestic', tv: 'BSE:SENSEX' },
  { symbol: '^NSEBANK', name: 'BANK NIFTY', category: 'domestic', tv: 'NSE:BANKNIFTY' },
  { symbol: '^NSMIDCP', name: 'NIFTY NEXT 50', category: 'domestic', tv: 'NSE:NIFTYJR' },
  { symbol: '^CNXMIDCAP', name: 'NIFTY MIDCAP 100', category: 'domestic', tv: 'NSE:CNXMIDCAP' },
  { symbol: '^CNXSMALLCAP', name: 'NIFTY SMALLCAP 100', category: 'domestic', tv: 'NSE:CNXSMALLCAP' },
  { symbol: '^CNXIT', name: 'NIFTY IT', category: 'domestic', tv: 'NSE:CNXIT' },
  { symbol: '^CNXFIN', name: 'NIFTY FIN SERVICE', category: 'domestic', tv: 'NSE:CNXFINANCE' },
  { symbol: '^CNXENERGY', name: 'NIFTY ENERGY', category: 'domestic', tv: 'NSE:CNXENERGY' },
  { symbol: '^CNXAUTO', name: 'NIFTY AUTO', category: 'domestic' },
  { symbol: '^CNXPHARMA', name: 'NIFTY PHARMA', category: 'domestic' },
  { symbol: '^CNXFMCG', name: 'NIFTY FMCG', category: 'domestic' },
  { symbol: '^CNXMETAL', name: 'NIFTY METAL', category: 'domestic' },
  { symbol: '^CNXREALTY', name: 'NIFTY REALTY', category: 'domestic' },
  { symbol: '^CNXINFRA', name: 'NIFTY INFRA', category: 'domestic' },
  { symbol: '^CNXPSUBANK', name: 'NIFTY PSU BANK', category: 'domestic' },
  { symbol: '^CNXPVTBANK', name: 'NIFTY PVT BANK', category: 'domestic' },
  { symbol: '^CNXMEDIA', name: 'NIFTY MEDIA', category: 'domestic' },
  { symbol: '^CNXOILGAS', name: 'NIFTY OIL & GAS', category: 'domestic' },
  { symbol: '^CNXHEALTH', name: 'NIFTY HEALTHCARE', category: 'domestic' },
  { symbol: '^INDIAVIX', name: 'INDIA VIX', category: 'domestic', tv: 'NSE:INDIAVIX' },

  // ── Americas ────────────────────────────────────────────────────────
  { symbol: '^GSPC', name: 'S&P 500', category: 'international', tv: 'SP:SPX' },
  { symbol: '^IXIC', name: 'NASDAQ COMPOSITE', category: 'international', tv: 'NASDAQ:IXIC' },
  { symbol: '^DJI', name: 'DOW JONES', category: 'international', tv: 'DJ:DJI' },
  { symbol: '^RUT', name: 'RUSSELL 2000', category: 'international', tv: 'TVC:RUT' },
  { symbol: '^VIX', name: 'CBOE VIX', category: 'international', tv: 'CBOE:VIX' },
  { symbol: '^GSPTSE', name: 'TSX COMPOSITE', category: 'international', tv: 'TSX:TSX' },
  { symbol: '^BVSP', name: 'BOVESPA', category: 'international', tv: 'BMFBOVESPA:IBOV' },
  { symbol: '^MXX', name: 'IPC MEXICO', category: 'international', tv: 'BMV:ME' },

  // ── Europe ──────────────────────────────────────────────────────────
  { symbol: '^FTSE', name: 'FTSE 100', category: 'international', tv: 'TVC:UKX' },
  { symbol: '^GDAXI', name: 'DAX', category: 'international', tv: 'XETR:DAX' },
  { symbol: '^FCHI', name: 'CAC 40', category: 'international', tv: 'EURONEXT:PX1' },
  { symbol: '^STOXX50E', name: 'EURO STOXX 50', category: 'international', tv: 'TVC:SX5E' },
  { symbol: '^IBEX', name: 'IBEX 35', category: 'international', tv: 'BME:IBC' },
  { symbol: 'FTSEMIB.MI', name: 'FTSE MIB', category: 'international', tv: 'INDEX:FTSEMIB' },
  { symbol: '^AEX', name: 'AEX', category: 'international', tv: 'EURONEXT:AEX' },
  { symbol: '^SSMI', name: 'SMI', category: 'international', tv: 'SIX:SMI' },

  // ── Asia-Pacific & Middle East ──────────────────────────────────────
  { symbol: '^N225', name: 'NIKKEI 225', category: 'international', tv: 'TVC:NI225' },
  { symbol: '^HSI', name: 'HANG SENG', category: 'international', tv: 'TVC:HSI' },
  { symbol: '000001.SS', name: 'SHANGHAI COMPOSITE', category: 'international', tv: 'SSE:000001' },
  { symbol: '399001.SZ', name: 'SHENZHEN COMPONENT', category: 'international', tv: 'SZSE:399001' },
  { symbol: '^KS11', name: 'KOSPI', category: 'international', tv: 'KRX:KOSPI' },
  { symbol: '^TWII', name: 'TAIWAN WEIGHTED', category: 'international', tv: 'TWSE:IX0001' },
  { symbol: '^STI', name: 'STRAITS TIMES', category: 'international', tv: 'TVC:STI' },
  { symbol: '^JKSE', name: 'JAKARTA COMPOSITE', category: 'international', tv: 'IDX:COMPOSITE' },
  { symbol: '^KLSE', name: 'FTSE BURSA MALAYSIA', category: 'international', tv: 'FTSEMYX:FBMKLCI' },
  { symbol: '^TA125.TA', name: 'TA-125 ISRAEL', category: 'international', tv: 'TASE:TA125' },

  // ── Commodities ─────────────────────────────────────────────────────
  { symbol: 'GC=F', name: 'GOLD', category: 'commodity', tv: 'TVC:GOLD' },
  { symbol: 'SI=F', name: 'SILVER', category: 'commodity', tv: 'TVC:SILVER' },
  { symbol: 'PL=F', name: 'PLATINUM', category: 'commodity', tv: 'TVC:PLATINUM' },
  { symbol: 'PA=F', name: 'PALLADIUM', category: 'commodity', tv: 'TVC:PALLADIUM' },
  { symbol: 'HG=F', name: 'COPPER', category: 'commodity', tv: 'COMEX:HG1!' },
  { symbol: 'CL=F', name: 'WTI CRUDE', category: 'commodity', tv: 'NYMEX:CL1!' },
  { symbol: 'BZ=F', name: 'BRENT CRUDE', category: 'commodity', tv: 'ICEEUR:BRN1!' },
  { symbol: 'NG=F', name: 'NATURAL GAS', category: 'commodity', tv: 'NYMEX:NG1!' },
  { symbol: 'RB=F', name: 'GASOLINE', category: 'commodity', tv: 'NYMEX:RB1!' },
  { symbol: 'ZC=F', name: 'CORN', category: 'commodity', tv: 'CBOT:ZC1!' },
  { symbol: 'ZW=F', name: 'WHEAT', category: 'commodity', tv: 'CBOT:ZW1!' },
  { symbol: 'ZS=F', name: 'SOYBEAN', category: 'commodity', tv: 'CBOT:ZS1!' },
  { symbol: 'SB=F', name: 'SUGAR', category: 'commodity', tv: 'ICEUS:SB1!' },
  { symbol: 'KC=F', name: 'COFFEE', category: 'commodity', tv: 'ICEUS:KC1!' },
  { symbol: 'CT=F', name: 'COTTON', category: 'commodity', tv: 'ICEUS:CT1!' },

  // ── Currencies ──────────────────────────────────────────────────────
  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency', tv: 'FX_IDC:USDINR' },
  { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency', tv: 'FX_IDC:EURINR' },
  { symbol: 'GBPINR=X', name: 'GBP/INR', category: 'currency', tv: 'FX_IDC:GBPINR' },
  { symbol: 'JPYINR=X', name: 'JPY/INR', category: 'currency', tv: 'FX_IDC:JPYINR' },
  { symbol: 'AEDINR=X', name: 'AED/INR', category: 'currency', tv: 'FX_IDC:AEDINR' },
  { symbol: 'CNYINR=X', name: 'CNY/INR', category: 'currency', tv: 'FX_IDC:CNYINR' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', category: 'currency', tv: 'FX:EURUSD' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', category: 'currency', tv: 'FX:GBPUSD' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', category: 'currency', tv: 'FX:USDJPY' },
  { symbol: 'DX-Y.NYB', name: 'DOLLAR INDEX', category: 'currency', tv: 'TVC:DXY' },
]

export const CATEGORY_LABELS: Record<QuoteCategory, string> = {
  domestic: 'India',
  international: 'Global',
  commodity: 'Commodities',
  currency: 'Currencies',
}

// ── Per-symbol memory ──────────────────────────────────────────────────────

/**
 * The last good quote for each symbol. A provider that answers for some
 * symbols and not others no longer thins the grid: the gaps are filled from
 * here, each with its own age, and the response says how many were.
 */
const quoteMemory = new Map<string, { quote: MarketQuote; at: number }>()
const QUOTE_MEMORY_TTL_MS = 30 * 60 * 1000

function mergeWithMemory(
  tracked: { symbol: string }[],
  fresh: MarketQuote[]
): { quotes: MarketQuote[]; fromMemory: number; oldestAgeSeconds: number } {
  const now = Date.now()
  const freshBySymbol = new Map(fresh.map((q) => [q.symbol, q]))
  for (const quote of fresh) quoteMemory.set(quote.symbol, { quote, at: now })

  const quotes: MarketQuote[] = []
  let fromMemory = 0
  let oldest = 0
  for (const t of tracked) {
    const justFetched = freshBySymbol.get(t.symbol)
    if (justFetched) {
      quotes.push(justFetched)
      continue
    }
    const remembered = quoteMemory.get(t.symbol)
    if (!remembered) continue
    const age = now - remembered.at
    if (age > QUOTE_MEMORY_TTL_MS) {
      quoteMemory.delete(t.symbol)
      continue
    }
    quotes.push(remembered.quote)
    fromMemory++
    oldest = Math.max(oldest, age)
  }
  return { quotes, fromMemory, oldestAgeSeconds: Math.round(oldest / 1000) }
}

// ── Upstox quote: today's last bar against the previous session's close ────

/** The calendar date of a bar, in India. */
function istDate(t: number): string {
  return new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * A quote built from candles: the latest intraday bar's close (or, outside
 * market hours, the last daily close) against the close of the session
 * before it. Also returns the daily closes, which double as the sparkline.
 */
export async function upstoxQuote(
  key: string
): Promise<{ price: number; previousClose: number; asOf: string; spark: number[] } | null> {
  const [daily, intraday] = await Promise.all([
    upstoxCandles(key, 'days', 1, new Date(Date.now() - 45 * 86_400_000), new Date(), 1800),
    upstoxIntraday(key, 1, 60).catch(() => [] as Candle[]),
  ])
  if (daily.length === 0 && intraday.length === 0) return null

  const lastBar = intraday[intraday.length - 1]
  if (lastBar) {
    const today = istDate(lastBar.t)
    const before = daily.filter((d) => istDate(d.t) < today)
    const previousClose = before.length ? before[before.length - 1].c : intraday[0].o
    return {
      price: lastBar.c,
      previousClose,
      asOf: new Date(lastBar.t).toISOString(),
      spark: [...before.map((d) => d.c), lastBar.c].slice(-30),
    }
  }
  if (daily.length < 2) return null
  const last = daily[daily.length - 1]
  return {
    price: last.c,
    previousClose: daily[daily.length - 2].c,
    asOf: new Date(last.t).toISOString(),
    spark: daily.map((d) => d.c).slice(-30),
  }
}

function toQuote(
  tracked: TrackedSymbol,
  price: number,
  previousClose: number,
  source: MarketQuote['source'],
  extra: Partial<MarketQuote> = {}
): MarketQuote {
  const change = price - previousClose
  return {
    symbol: tracked.symbol,
    name: tracked.name,
    category: tracked.category,
    price,
    previousClose,
    change,
    changePct: previousClose !== 0 ? (change / previousClose) * 100 : 0,
    currency: tracked.category === 'domestic' ? 'INR' : '',
    asOf: new Date().toISOString(),
    source,
    ...extra,
  }
}

/**
 * Resolves a list of indices, commodities and currencies across providers.
 * Never throws; whatever no provider answered for is reported in `failed`.
 */
async function resolveQuotes(
  tracked: TrackedSymbol[],
  revalidateSeconds: number
): Promise<{ quotes: MarketQuote[]; failed: string[]; failureReason?: string }> {
  const quotes: MarketQuote[] = []
  const reasons: string[] = []
  let pending = tracked

  // 1. TradingView: everything with a screener ticker, in one request.
  const withTv = pending.filter((t) => t.tv)
  if (withTv.length > 0) {
    try {
      const rows = await tvScan('global', withTv.map((t) => t.tv!), QUOTE_COLUMNS, { ttlSeconds: revalidateSeconds })
      const got = new Set<string>()
      for (const t of withTv) {
        const row = rows.get(t.tv!)
        const q = row ? quoteFromRow(row) : null
        if (!q) continue
        quotes.push({
          ...toQuote(t, q.price, q.previousClose, 'tradingview'),
          changePct: q.changePct,
          change: q.change,
          currency: q.currency,
        })
        got.add(t.symbol)
      }
      pending = pending.filter((t) => !got.has(t.symbol))
    } catch (err: any) {
      reasons.push(err?.message || 'TradingView failed')
    }
  }

  // 2. Upstox: Indian indices the screener does not carry (or did not answer for).
  const withUpstox = pending.filter((t) => UPSTOX_INDEX_KEYS[t.symbol])
  if (withUpstox.length > 0) {
    const settled = await mapWithConcurrency(withUpstox, 6, (t) => upstoxQuote(UPSTOX_INDEX_KEYS[t.symbol]))
    const got = new Set<string>()
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled' && outcome.value) {
        const u = outcome.value
        quotes.push(toQuote(withUpstox[i], u.price, u.previousClose, 'upstox', { asOf: u.asOf, spark: u.spark }))
        got.add(withUpstox[i].symbol)
      } else if (outcome.status === 'rejected') {
        reasons.push(`Upstox: ${(outcome.reason as Error)?.message || 'failed'}`)
      }
    })
    pending = pending.filter((t) => !got.has(t.symbol))
  }

  // 3. The ECB's daily reference rates, for currency pairs still missing.
  const fxWanted = pending.filter((t) => FRANKFURTER_SYMBOLS.has(t.symbol))
  if (fxWanted.length > 0) {
    try {
      const fx = await fetchFxQuotes(fxWanted)
      quotes.push(...fx)
      const got = new Set(fx.map((q) => q.symbol))
      pending = pending.filter((t) => !got.has(t.symbol))
    } catch (err: any) {
      reasons.push(`ECB rates: ${err?.message || 'failed'}`)
    }
  }

  // 4. Yahoo, for whatever is left.
  let failed: string[] = []
  if (pending.length > 0) {
    const yahoo = await resolveYahooQuotes(pending, revalidateSeconds)
    quotes.push(...yahoo.quotes)
    failed = yahoo.failed
    if (yahoo.failureReason) reasons.push(yahoo.failureReason)
  }

  // Sparklines for Indian indices that came from the screener (which has no
  // series). Daily closes are cached for an hour, so this is cheap.
  const needSpark = quotes.filter((q) => !q.spark && UPSTOX_INDEX_KEYS[q.symbol])
  if (needSpark.length > 0) {
    const settled = await mapWithConcurrency(needSpark, 6, (q) => fetchRecentCloses(q.symbol, 45))
    settled.forEach((outcome, i) => {
      if (outcome.status !== 'fulfilled' || outcome.value.length < 2) return
      needSpark[i].spark = withLivePoint(outcome.value, needSpark[i].price)
    })
  }

  return { quotes, failed, failureReason: reasons[0] }
}

/**
 * Daily closes ending in the live price. During a session the daily series
 * stops at yesterday, so today's price is appended; after the close, today's
 * bar is already the last one and nothing is added.
 */
function withLivePoint(candles: Candle[], livePrice: number): number[] {
  const closes = candles.map((c) => c.c)
  const lastDate = istDate(candles[candles.length - 1].t)
  const today = istDate(Date.now())
  if (lastDate < today && isWeekdayIST()) closes.push(livePrice)
  return closes.slice(-30)
}

function isWeekdayIST(): boolean {
  const day = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay()
  return day !== 0 && day !== 6
}

export interface MarketBarData {
  quotes: MarketQuote[]
  /** Symbols no provider answered for, so the UI can be honest about gaps. */
  failed: string[]
  /** Why the first failure happened, for diagnosis. */
  failureReason?: string
  /** True when some tiles came from memory rather than this fetch. */
  stale?: boolean
  staleAgeSeconds?: number
  fromMemory?: number
  fetchedAt: string
}

export async function fetchMarketBar(
  revalidateSeconds = 60,
  symbols: TrackedSymbol[] = TRACKED_SYMBOLS
): Promise<MarketBarData> {
  const { quotes: fresh, failed, failureReason } = await resolveQuotes(symbols, revalidateSeconds)
  const { quotes, fromMemory, oldestAgeSeconds } = mergeWithMemory(symbols, fresh)
  const remembered = new Set(quotes.map((q) => q.symbol))
  return {
    quotes,
    failed: failed.filter((s) => !remembered.has(s)),
    failureReason,
    stale: fromMemory > 0,
    staleAgeSeconds: fromMemory > 0 ? oldestAgeSeconds : undefined,
    fromMemory,
    fetchedAt: new Date().toISOString(),
  }
}

export interface EquityQuote extends MarketQuote {
  sector: string
  industry?: string
  marketCap?: number | null
}

/**
 * Live quotes for a list of NSE equities, with a month of daily closes each
 * for the tile sparkline and the market capitalisation that sizes the
 * treemap.
 */
export async function fetchEquityQuotes(
  constituents: { symbol: string; name: string; sector: string; industry?: string }[],
  revalidateSeconds = 60,
  { withSparks = true }: { withSparks?: boolean } = {}
): Promise<{
  quotes: EquityQuote[]
  failed: string[]
  failureReason?: string
  stale?: boolean
  staleAgeSeconds?: number
  fromMemory?: number
  fetchedAt: string
}> {
  const tracked: TrackedSymbol[] = constituents.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    category: 'domestic' as const,
    tv: tvTicker(c.symbol),
  }))
  const meta = new Map(constituents.map((c) => [c.symbol, c]))
  const fresh: EquityQuote[] = []
  const reasons: string[] = []
  let pending = tracked

  // 1. TradingView: all constituents, one request.
  try {
    const rows = await tvScan('india', tracked.map((t) => t.tv!), [...QUOTE_COLUMNS, 'market_cap_basic'], {
      ttlSeconds: revalidateSeconds,
    })
    const got = new Set<string>()
    for (const t of tracked) {
      const row = rows.get(t.tv!)
      const q = row ? quoteFromRow(row) : null
      if (!q) continue
      fresh.push({
        ...toQuote(t, q.price, q.previousClose, 'tradingview'),
        change: q.change,
        changePct: q.changePct,
        currency: q.currency,
        sector: meta.get(t.symbol)?.sector ?? '',
        industry: meta.get(t.symbol)?.industry,
        marketCap: num(row!.market_cap_basic),
      })
      got.add(t.symbol)
    }
    pending = pending.filter((t) => !got.has(t.symbol))
  } catch (err: any) {
    reasons.push(err?.message || 'TradingView failed')
  }

  // 2. Upstox, per stock, for anything the screener missed.
  const upstoxable = pending.filter((t) => isinFor(t.symbol))
  if (upstoxable.length > 0) {
    const settled = await mapWithConcurrency(upstoxable, 6, (t) => upstoxQuote(upstoxEquityKey(isinFor(t.symbol)!)))
    const got = new Set<string>()
    settled.forEach((outcome, i) => {
      const t = upstoxable[i]
      if (outcome.status === 'fulfilled' && outcome.value) {
        const u = outcome.value
        fresh.push({
          ...toQuote(t, u.price, u.previousClose, 'upstox', { asOf: u.asOf, spark: u.spark }),
          sector: meta.get(t.symbol)?.sector ?? '',
          industry: meta.get(t.symbol)?.industry,
        })
        got.add(t.symbol)
      } else if (outcome.status === 'rejected') {
        reasons.push(`Upstox: ${(outcome.reason as Error)?.message || 'failed'}`)
      }
    })
    pending = pending.filter((t) => !got.has(t.symbol))
  }

  // 3. Yahoo, for the remainder.
  let failed: string[] = []
  if (pending.length > 0) {
    const yahooTracked = pending.map((t) => ({ ...t, symbol: `${t.symbol}.NS` }))
    const yahoo = await resolveYahooQuotes(yahooTracked, revalidateSeconds)
    for (const q of yahoo.quotes) {
      const nse = q.symbol.replace(/\.NS$/, '')
      fresh.push({ ...q, symbol: nse, sector: meta.get(nse)?.sector ?? '', industry: meta.get(nse)?.industry })
    }
    failed = yahoo.failed.map((s) => s.replace(/\.NS$/, ''))
    if (yahoo.failureReason) reasons.push(yahoo.failureReason)
  }

  // Sparklines: a month of daily closes per stock, cached for an hour.
  if (withSparks) {
    const needSpark = fresh.filter((q) => !q.spark)
    const settled = await mapWithConcurrency(needSpark, 8, (q) => fetchRecentCloses(q.symbol, 45))
    settled.forEach((outcome, i) => {
      if (outcome.status !== 'fulfilled' || outcome.value.length < 2) return
      needSpark[i].spark = withLivePoint(outcome.value, needSpark[i].price)
    })
  }

  const merged = mergeWithMemory(tracked, fresh)
  const quotes = merged.quotes as EquityQuote[]
  const have = new Set(quotes.map((q) => q.symbol))
  return {
    quotes,
    failed: failed.filter((s) => !have.has(s)),
    failureReason: reasons[0],
    stale: merged.fromMemory > 0,
    staleAgeSeconds: merged.fromMemory > 0 ? merged.oldestAgeSeconds : undefined,
    fromMemory: merged.fromMemory,
    fetchedAt: new Date().toISOString(),
  }
}
