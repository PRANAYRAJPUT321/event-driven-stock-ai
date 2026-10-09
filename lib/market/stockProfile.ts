/**
 * Everything the stock profile page shows about one company, in one object.
 *
 * TradingView's screener supplies the quote, valuation, financials,
 * technicals and returns in a single request. When it cannot answer, the
 * quote falls back to Upstox candles and then Yahoo, and the profile says
 * which fields are missing and why rather than rendering blanks as zeroes.
 *
 * Server-side only.
 */
import { upstoxEquityKey } from './candles'
import { findEquity, RENAMED_SYMBOLS } from './indianEquities'
import { isinFor, lookupEquity } from './nseDirectory'
import { upstoxQuote } from './quotes'
import { num, PROFILE_COLUMNS, str, technicalRatingLabel, tvScan, tvTicker, type TvRow } from './tradingView'
import { fetchStockQuote } from './yahooStock'

export interface StockProfile {
  symbol: string
  name: string
  exchange: 'NSE'
  isin: string | null
  currency: string
  /** The analysis engine's sector, for NIFTY 50 members. */
  sector: string | null
  /** NSE's industry label (NIFTY 50) or TradingView's classification. */
  industry: string | null
  tvSector: string | null
  inNifty50: boolean

  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  open: number | null
  dayHigh: number | null
  dayLow: number | null
  volume: number | null
  avgVolume10d: number | null
  relativeVolume: number | null

  marketCap: number | null
  enterpriseValue: number | null
  peRatio: number | null
  eps: number | null
  pbRatio: number | null
  psRatio: number | null
  dividendYieldPct: number | null
  beta: number | null
  week52High: number | null
  week52Low: number | null

  roePct: number | null
  roaPct: number | null
  debtToEquity: number | null
  currentRatio: number | null
  revenueTtm: number | null
  netIncomeTtm: number | null
  ebitdaTtm: number | null
  freeCashFlowTtm: number | null
  grossMarginPct: number | null
  operatingMarginPct: number | null
  netMarginPct: number | null
  revenueGrowthPct: number | null
  netIncomeGrowthPct: number | null
  epsGrowthPct: number | null
  employees: number | null
  sharesOutstanding: number | null

  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  adx: number | null

  performance: { w1: number | null; m1: number | null; m3: number | null; m6: number | null; ytd: number | null; y1: number | null; y5: number | null }

  /** TradingView's indicator summary, -1 … +1. Not an analyst opinion. */
  technicalRating: { value: number | null; label: string | null; movingAverages: number | null; oscillators: number | null }

  nextEarnings: string | null
  lastEarnings: string | null
  logoUrl: string | null

  source: 'tradingview' | 'upstox' | 'yahoo'
  asOf: string
  /** What could not be sourced, in plain words. */
  notes: string[]
  /** Set when the requested symbol now trades under another one. */
  renamed?: { from: string; to: string; note: string }
}

export class UnknownSymbolError extends Error {}

function round(value: number | null, digits = 2): number | null {
  return value === null ? null : Number(value.toFixed(digits))
}

function isoFromEpochSeconds(value: unknown): string | null {
  const n = num(value)
  return n === null ? null : new Date(n * 1000).toISOString()
}

function empty(symbol: string, name: string, isin: string | null): StockProfile {
  const constituent = findEquity(symbol)
  return {
    symbol,
    name,
    exchange: 'NSE',
    isin,
    currency: 'INR',
    sector: constituent?.sector ?? null,
    industry: constituent?.industry ?? null,
    tvSector: null,
    inNifty50: !!constituent,
    price: null, previousClose: null, change: null, changePct: null, open: null, dayHigh: null, dayLow: null,
    volume: null, avgVolume10d: null, relativeVolume: null,
    marketCap: null, enterpriseValue: null, peRatio: null, eps: null, pbRatio: null, psRatio: null,
    dividendYieldPct: null, beta: null, week52High: null, week52Low: null,
    roePct: null, roaPct: null, debtToEquity: null, currentRatio: null, revenueTtm: null, netIncomeTtm: null,
    ebitdaTtm: null, freeCashFlowTtm: null, grossMarginPct: null, operatingMarginPct: null, netMarginPct: null,
    revenueGrowthPct: null, netIncomeGrowthPct: null, epsGrowthPct: null, employees: null, sharesOutstanding: null,
    sma20: null, sma50: null, sma200: null, rsi14: null, macd: null, macdSignal: null, adx: null,
    performance: { w1: null, m1: null, m3: null, m6: null, ytd: null, y1: null, y5: null },
    technicalRating: { value: null, label: null, movingAverages: null, oscillators: null },
    nextEarnings: null,
    lastEarnings: null,
    logoUrl: null,
    source: 'tradingview',
    asOf: new Date().toISOString(),
    notes: [],
  }
}

/** Fills a profile from one screener row. Exported for the fixture tests. */
export function profileFromScreener(base: StockProfile, row: TvRow): StockProfile {
  const price = num(row.close)
  const changeAbs = num(row.change_abs)
  const previousClose = price !== null && changeAbs !== null ? price - changeAbs : null
  const rating = num(row['Recommend.All'])
  const logoid = str(row.logoid)
  return {
    ...base,
    name: base.inNifty50 ? base.name : str(row.description) ?? base.name,
    currency: str(row.currency) ?? 'INR',
    industry: base.industry ?? str(row.industry),
    tvSector: str(row.sector),
    price,
    previousClose: round(previousClose),
    change: round(changeAbs),
    changePct: round(num(row.change)),
    open: num(row.open),
    dayHigh: num(row.high),
    dayLow: num(row.low),
    volume: num(row.volume),
    avgVolume10d: round(num(row.average_volume_10d_calc), 0),
    relativeVolume: round(num(row.relative_volume_10d_calc)),
    marketCap: num(row.market_cap_basic),
    enterpriseValue: num(row.enterprise_value_current),
    peRatio: round(num(row.price_earnings_ttm)),
    eps: round(num(row.earnings_per_share_diluted_ttm)),
    pbRatio: round(num(row.price_book_ratio)),
    psRatio: round(num(row.price_sales_current)),
    dividendYieldPct: round(num(row.dividends_yield_current)),
    beta: round(num(row.beta_1_year)),
    week52High: num(row.price_52_week_high),
    week52Low: num(row.price_52_week_low),
    roePct: round(num(row.return_on_equity) ?? num(row.return_on_equity_fy)),
    roaPct: round(num(row.return_on_assets)),
    debtToEquity: round(num(row.debt_to_equity) ?? num(row.debt_to_equity_fy)),
    currentRatio: round(num(row.current_ratio)),
    revenueTtm: num(row.total_revenue_ttm),
    netIncomeTtm: num(row.net_income_ttm),
    ebitdaTtm: num(row.ebitda_ttm),
    freeCashFlowTtm: num(row.free_cash_flow_ttm),
    grossMarginPct: round(num(row.gross_margin)),
    operatingMarginPct: round(num(row.operating_margin)),
    netMarginPct: round(num(row.net_margin)),
    revenueGrowthPct: round(num(row.total_revenue_yoy_growth_ttm)),
    netIncomeGrowthPct: round(num(row.net_income_yoy_growth_ttm)),
    epsGrowthPct: round(num(row.earnings_per_share_diluted_yoy_growth_ttm)),
    employees: num(row.number_of_employees),
    sharesOutstanding: num(row.total_shares_outstanding),
    sma20: round(num(row.SMA20)),
    sma50: round(num(row.SMA50)),
    sma200: round(num(row.SMA200)),
    rsi14: round(num(row.RSI), 1),
    macd: round(num(row['MACD.macd'])),
    macdSignal: round(num(row['MACD.signal'])),
    adx: round(num(row.ADX), 1),
    performance: {
      w1: round(num(row['Perf.W'])),
      m1: round(num(row['Perf.1M'])),
      m3: round(num(row['Perf.3M'])),
      m6: round(num(row['Perf.6M'])),
      ytd: round(num(row['Perf.YTD'])),
      y1: round(num(row['Perf.Y'])),
      y5: round(num(row['Perf.5Y'])),
    },
    technicalRating: {
      value: round(rating, 3),
      label: technicalRatingLabel(rating),
      movingAverages: round(num(row['Recommend.MA']), 3),
      oscillators: round(num(row['Recommend.Other']), 3),
    },
    nextEarnings: isoFromEpochSeconds(row.earnings_release_next_date),
    lastEarnings: isoFromEpochSeconds(row.earnings_release_date),
    logoUrl: logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : null,
    source: 'tradingview',
  }
}

/**
 * The profile for an NSE symbol. Throws UnknownSymbolError when the symbol is
 * not an NSE listing at all, so the route can answer 404 with suggestions.
 */
export async function fetchStockProfile(rawSymbol: string): Promise<StockProfile> {
  let symbol = rawSymbol.toUpperCase().trim()
  let renamed: StockProfile['renamed']
  const rename = RENAMED_SYMBOLS[symbol]
  if (rename && !lookupEquity(symbol)) {
    renamed = { from: symbol, to: rename.to, note: rename.note }
    symbol = rename.to
  }

  const listing = lookupEquity(symbol)
  const constituent = findEquity(symbol)
  if (!listing && !constituent) throw new UnknownSymbolError(`${symbol} is not listed on the NSE`)

  const isin = isinFor(symbol)
  const base = { ...empty(symbol, constituent?.name ?? listing!.name, isin), ...(renamed ? { renamed } : {}) }

  // 1. The screener: everything at once.
  try {
    const rows = await tvScan('india', [tvTicker(symbol)], PROFILE_COLUMNS, { ttlSeconds: 60 })
    const row = rows.get(tvTicker(symbol))
    if (row && num(row.close) !== null) return profileFromScreener(base, row)
    base.notes.push('The screener has no data for this symbol')
  } catch (err: any) {
    base.notes.push(`Screener unavailable: ${err?.message || 'unknown error'}`)
  }

  // 2. Upstox: price and day move from candles; no fundamentals.
  if (isin) {
    try {
      const q = await upstoxQuote(upstoxEquityKey(isin))
      if (q) {
        const change = q.price - q.previousClose
        return {
          ...base,
          price: q.price,
          previousClose: q.previousClose,
          change: round(change),
          changePct: round(q.previousClose ? (change / q.previousClose) * 100 : 0),
          source: 'upstox',
          asOf: q.asOf,
          notes: [...base.notes, 'Valuation and company figures are unavailable right now; price and chart are live.'],
        }
      }
    } catch (err: any) {
      base.notes.push(`Upstox unavailable: ${err?.message || 'unknown error'}`)
    }
  }

  // 3. Yahoo, last.
  const yahoo = await fetchStockQuote(symbol)
  return {
    ...base,
    price: yahoo.price,
    changePct: yahoo.changePct,
    marketCap: yahoo.marketCap,
    peRatio: yahoo.peRatio,
    pbRatio: yahoo.pbRatio,
    dividendYieldPct: yahoo.dividendYield !== null ? round(yahoo.dividendYield * 100) : null,
    week52High: yahoo.week52High,
    week52Low: yahoo.week52Low,
    source: 'yahoo',
    notes: [...base.notes, ...(yahoo.fundamentalsError ? [yahoo.fundamentalsError] : [])],
  }
}
