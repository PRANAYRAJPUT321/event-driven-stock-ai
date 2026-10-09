// Probes market-data sources from a cloud machine and records what they
// return. Run by .github/workflows/probe-sources.yml so the answers come from
// a datacenter IP, the same kind of network Vercel uses. Writes:
//   lib/market/data/nse-equities.json   every NSE-listed equity (search, ISINs)
//   lib/market/data/nifty50.json        the official NIFTY 50 constituents
//   scripts/fixtures/market/*.json      real responses for parser tests
// Development tool only — the app never imports this script.
import { mkdirSync, writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const DAY = 86400
const FIX = 'scripts/fixtures/market'
const DATA = 'lib/market/data'
mkdirSync(FIX, { recursive: true })
mkdirSync(DATA, { recursive: true })

const ymd = (d) => d.toISOString().slice(0, 10)
const save = (path, value) => {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
  console.log(`  saved ${path} (${(typeof value === 'string' ? value : JSON.stringify(value)).length} bytes)`)
}

async function get(url, init = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers || {}) },
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    return { status: res.status, text, ms: Date.now() - t0 }
  } catch (e) {
    return { status: 0, text: String(e), ms: Date.now() - t0 }
  }
}
const json = (r) => { try { return JSON.parse(r.text) } catch { return null } }

/** Minimal CSV parser that honours quoted fields. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.map((r) => r.map((f) => f.trim()))
}

// ── 1. Reference data ─────────────────────────────────────────────────────
console.log('## reference data')
const n50 = await get('https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv')
const n50rows = parseCsv(n50.text).slice(1).filter((r) => r.length >= 5)
const nifty50 = n50rows.map(([name, industry, symbol, series, isin]) => ({ symbol, name, industry, isin }))
console.log(`nifty50 ${n50.status} rows=${nifty50.length}`)
if (nifty50.length >= 45) save(`${DATA}/nifty50.json`, { asOf: ymd(new Date()), source: 'nsearchives.nseindia.com/content/indices/ind_nifty50list.csv', constituents: nifty50 })

const eqL = await get('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv')
const eqRows = parseCsv(eqL.text).slice(1).filter((r) => r.length >= 7)
// [symbol, name, isin]; series kept out — the app treats every listed equity alike.
const equities = eqRows.map((r) => [r[0], r[1], r[6]]).filter(([s, n, i]) => s && n && /^IN[A-Z0-9]{10}$/.test(i))
console.log(`EQUITY_L ${eqL.status} rows=${equities.length}`)
if (equities.length > 1500) save(`${DATA}/nse-equities.json`, { asOf: ymd(new Date()), source: 'nsearchives.nseindia.com/content/equities/EQUITY_L.csv', fields: ['symbol', 'name', 'isin'], rows: equities })
const isinOf = new Map(equities.map(([s, , i]) => [s, i]))

// ── 2. TradingView scanner: columns ───────────────────────────────────────
console.log('\n## tradingview columns')
const TVH = { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }
async function tvScan(market, tickers, columns) {
  const r = await get(`https://scanner.tradingview.com/${market}/scan`, {
    method: 'POST', headers: TVH, body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns }),
  })
  return { ...r, body: json(r) }
}
const CANDIDATE_COLUMNS = [
  'name', 'description', 'close', 'change', 'change_abs', 'open', 'high', 'low', 'volume', 'currency', 'exchange', 'type',
  'market_cap_basic', 'price_earnings_ttm', 'earnings_per_share_basic_ttm', 'earnings_per_share_diluted_ttm',
  'price_book_ratio', 'price_book_fq', 'book_value_per_share_fq', 'price_sales_current', 'price_revenue_ttm',
  'dividends_yield_current', 'dividends_yield', 'dividend_yield_recent', 'dividends_per_share_fq',
  'return_on_equity', 'return_on_equity_fq', 'return_on_equity_fy', 'return_on_assets', 'return_on_assets_fq',
  'return_on_invested_capital_fq', 'debt_to_equity', 'debt_to_equity_fq', 'debt_to_equity_fy', 'total_debt', 'total_debt_fq',
  'net_debt', 'net_debt_fq', 'current_ratio', 'current_ratio_fq', 'quick_ratio_fq',
  'total_revenue', 'total_revenue_ttm', 'net_income', 'net_income_ttm', 'gross_margin', 'net_margin', 'operating_margin',
  'gross_margin_ttm', 'net_margin_ttm', 'operating_margin_ttm', 'ebitda', 'ebitda_ttm', 'free_cash_flow_ttm',
  'total_revenue_yoy_growth_ttm', 'total_revenue_yoy_growth_fy', 'net_income_yoy_growth_ttm', 'net_income_yoy_growth_fy',
  'earnings_per_share_diluted_yoy_growth_ttm', 'earnings_per_share_diluted_yoy_growth_fy',
  'enterprise_value_fq', 'enterprise_value_current', 'enterprise_value_ebitda_ttm', 'number_of_employees',
  'beta_1_year', 'price_52_week_high', 'price_52_week_low', 'High.All', 'Low.All',
  'SMA20', 'SMA50', 'SMA200', 'EMA20', 'EMA50', 'EMA200', 'RSI', 'MACD.macd', 'MACD.signal', 'ADX', 'ATR', 'Mom',
  'Volatility.D', 'Volatility.W', 'Volatility.M', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD', 'Perf.5Y',
  'average_volume_10d_calc', 'average_volume_30d_calc', 'relative_volume_10d_calc',
  'Recommend.All', 'Recommend.MA', 'Recommend.Other', 'sector', 'industry', 'country', 'logoid',
  'earnings_release_next_date', 'earnings_release_date', 'float_shares_outstanding', 'total_shares_outstanding',
]
const validColumns = []
for (const c of CANDIDATE_COLUMNS) {
  const r = await tvScan('india', ['NSE:RELIANCE', 'NSE:HDFCBANK', 'NSE:TCS'], [c])
  const vals = r.body?.data?.map((d) => d.d[0])
  const ok = r.status === 200 && Array.isArray(vals)
  if (ok) validColumns.push(c)
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${c.padEnd(42)} ${ok ? JSON.stringify(vals) : r.text.slice(0, 90)}`)
}

// ── 3. TradingView tickers for indices, commodities, currencies ───────────
console.log('\n## tradingview tickers')
const TICKER_CANDIDATES = [
  // India
  'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY', 'NSE:CNXIT', 'NSE:CNXAUTO', 'NSE:CNXPHARMA', 'NSE:CNXFMCG', 'NSE:CNXMETAL',
  'NSE:CNXENERGY', 'NSE:CNXREALTY', 'NSE:CNXINFRA', 'NSE:CNXPSUBANK', 'NSE:CNXFINANCE', 'NSE:CNXMEDIA', 'NSE:NIFTYMIDCAP50',
  'NSE:NIFTY_MIDCAP_50', 'NSE:CNXMIDCAP', 'NSE:NIFTYMIDCAP150', 'NSE:CNXSMALLCAP', 'NSE:NIFTYSMLCAP100', 'NSE:INDIAVIX',
  'NSE:NIFTY_HEALTHCARE', 'NSE:CNXCONSUMPTION', 'NSE:NIFTYPVTBANK', 'NSE:CNXPSE', 'NSE:NIFTY_OIL_AND_GAS', 'NSE:NIFTYJR',
  // Americas
  'SP:SPX', 'NASDAQ:IXIC', 'NASDAQ:NDX', 'DJ:DJI', 'TVC:RUT', 'RUSSELL:RUT', 'CBOE:VIX', 'TVC:VIX', 'TSX:TSX', 'BMFBOVESPA:IBOV', 'BMV:ME',
  // Europe
  'TVC:UKX', 'XETR:DAX', 'EURONEXT:PX1', 'TVC:CAC40', 'TVC:SX5E', 'BME:IBC', 'TVC:IBEX35', 'INDEX:FTSEMIB', 'TVC:FTSEMIB', 'MIL:FTSEMIB',
  'EURONEXT:AEX', 'TVC:AEX', 'SIX:SMI', 'TVC:SMI',
  // Asia-Pacific
  'TVC:NI225', 'TVC:HSI', 'HSI:HSI', 'SSE:000001', 'SZSE:399001', 'KRX:KOSPI', 'TWSE:TAIEX', 'ASX:XJO', 'TVC:STI', 'IDX:COMPOSITE',
  'MYX:FBMKLCI', 'TASE:TA125',
  // Commodities
  'TVC:GOLD', 'TVC:SILVER', 'TVC:PLATINUM', 'TVC:PALLADIUM', 'COMEX:HG1!', 'TVC:COPPER', 'TVC:USOIL', 'TVC:UKOIL', 'NYMEX:CL1!',
  'ICEEUR:BRN1!', 'NYMEX:NG1!', 'TVC:NATURALGAS', 'NYMEX:RB1!', 'CBOT:ZC1!', 'CBOT:ZW1!', 'CBOT:ZS1!', 'ICEUS:SB1!', 'ICEUS:KC1!',
  'ICEUS:CT1!', 'COMEX:GC1!', 'COMEX:SI1!', 'NYMEX:PL1!', 'NYMEX:PA1!',
  // Currencies
  'FX_IDC:USDINR', 'FX_IDC:EURINR', 'FX_IDC:GBPINR', 'FX_IDC:JPYINR', 'FX_IDC:AEDINR', 'FX_IDC:CNYINR', 'FX:EURUSD', 'FX:GBPUSD',
  'FX:USDJPY', 'FX_IDC:EURUSD', 'TVC:DXY',
]
const tickerMarkets = {}
for (const market of ['india', 'global', 'america', 'cfd', 'futures', 'forex']) {
  const r = await tvScan(market, TICKER_CANDIDATES, ['description', 'close', 'change', 'currency'])
  const got = r.body?.data ?? []
  console.log(`  market ${market}: ${r.status} returned ${got.length}`)
  for (const d of got) {
    tickerMarkets[d.s] ??= []
    tickerMarkets[d.s].push(market)
  }
}
for (const t of TICKER_CANDIDATES) console.log(`  ${tickerMarkets[t] ? 'ok ' : '-- '} ${t.padEnd(24)} ${(tickerMarkets[t] || []).join(',')}`)

// ── 4. Recordings for parser tests and offline development ───────────────
console.log('\n## recordings')
const wantEquityColumns = validColumns
const niftyTickers = nifty50.map((c) => `NSE:${c.symbol}`)
const eqScan = await tvScan('india', niftyTickers, wantEquityColumns)
console.log(`  equities scan ${eqScan.status} ${eqScan.ms}ms rows=${eqScan.body?.data?.length}`)
if (eqScan.body) save(`${FIX}/tv-equities.json`, { columns: wantEquityColumns, response: eqScan.body })

const okTickers = TICKER_CANDIDATES.filter((t) => tickerMarkets[t])
const byMarket = {}
for (const t of okTickers) (byMarket[tickerMarkets[t][0]] ??= []).push(t)
const tickerScans = {}
for (const [market, tickers] of Object.entries(byMarket)) {
  const r = await tvScan(market, tickers, ['description', 'close', 'change', 'change_abs', 'currency', 'high', 'low', 'open'])
  tickerScans[market] = { tickers, response: r.body }
}
save(`${FIX}/tv-tickers.json`, tickerScans)

const symbolSearch = await get('https://symbol-search.tradingview.com/symbol_search/v3/?text=tata&hl=1&exchange=NSE&lang=en&search_type=stocks&domain=production', { headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' } })
save(`${FIX}/tv-search.json`, json(symbolSearch))

// Upstox: ranges the stock chart offers.
const today = new Date()
const ago = (days) => ymd(new Date(Date.now() - days * DAY * 1000))
const UP = (key, path) => `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(key)}/${path}`
const rel = `NSE_EQ|${isinOf.get('RELIANCE') || 'INE002A01018'}`
const upstoxChecks = {
  'days-1y': UP(rel, `days/1/${ymd(today)}/${ago(366)}`),
  'days-5y': UP(rel, `days/1/${ymd(today)}/${ago(5 * 366)}`),
  'weeks-5y': UP(rel, `weeks/1/${ymd(today)}/${ago(5 * 366)}`),
  'weeks-max': UP(rel, `weeks/1/${ymd(today)}/2000-01-01`),
  'months-max': UP(rel, `months/1/${ymd(today)}/2000-01-01`),
  'minutes30-5d': UP(rel, `minutes/30/${ymd(today)}/${ago(7)}`),
  'intraday-5m': `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(rel)}/minutes/5`,
  'index-nifty-1y': UP('NSE_INDEX|Nifty 50', `days/1/${ymd(today)}/${ago(366)}`),
  'index-bank': UP('NSE_INDEX|Nifty Bank', `days/1/${ymd(today)}/${ago(30)}`),
  'index-it': UP('NSE_INDEX|Nifty IT', `days/1/${ymd(today)}/${ago(30)}`),
  'index-sensex': UP('BSE_INDEX|SENSEX', `days/1/${ymd(today)}/${ago(30)}`),
  'index-vix': UP('NSE_INDEX|India VIX', `days/1/${ymd(today)}/${ago(30)}`),
}
for (const [name, url] of Object.entries(upstoxChecks)) {
  const r = await get(url, { headers: { Accept: 'application/json' } })
  const body = json(r)
  const candles = body?.data?.candles
  console.log(`  upstox ${name.padEnd(14)} ${r.status} ${r.ms}ms candles=${candles?.length ?? '-'} first=${JSON.stringify(candles?.[candles.length - 1])?.slice(0, 80)} ${body?.errors ? JSON.stringify(body.errors).slice(0, 160) : ''}`)
  if (['days-1y', 'intraday-5m', 'index-nifty-1y', 'weeks-5y'].includes(name) && body) save(`${FIX}/upstox-${name}.json`, body)
}

// Sparkline series for every constituent: one month of daily closes each.
const sparks = {}
for (const c of nifty50) {
  const r = await get(UP(`NSE_EQ|${c.isin}`, `days/1/${ymd(today)}/${ago(45)}`), { headers: { Accept: 'application/json' } })
  const candles = json(r)?.data?.candles
  sparks[c.symbol] = Array.isArray(candles) ? candles.map((k) => [k[0].slice(0, 10), k[4]]).reverse() : null
  if (!Array.isArray(candles)) console.log(`  spark ${c.symbol} ${r.status} ${r.text.slice(0, 100)}`)
}
console.log(`  sparks: ${Object.values(sparks).filter(Boolean).length}/${nifty50.length}`)
save(`${FIX}/upstox-sparks.json`, sparks)

// Moneycontrol and Groww as fallbacks for history.
const now = Math.floor(Date.now() / 1000)
const mc = await get(`https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=RELIANCE&resolution=1D&from=${now - 370 * DAY}&to=${now}&countback=260&currencyCode=INR`, { headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' } })
console.log(`  moneycontrol 1y ${mc.status} ${mc.ms}ms points=${json(mc)?.t?.length}`)
if (json(mc)) save(`${FIX}/moneycontrol-1y.json`, json(mc))
const mcw = await get(`https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=RELIANCE&resolution=1W&from=${now - 5 * 366 * DAY}&to=${now}&countback=300&currencyCode=INR`, { headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' } })
console.log(`  moneycontrol 5y weekly ${mcw.status} points=${json(mcw)?.t?.length} ${mcw.text.slice(0, 80)}`)
const mcm = await get(`https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=M%26M&resolution=1D&from=${now - 30 * DAY}&to=${now}&countback=30&currencyCode=INR`, { headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' } })
console.log(`  moneycontrol M&M ${mcm.status} points=${json(mcm)?.t?.length} ${mcm.text.slice(0, 80)}`)
const gw = await get(`https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE/segment/CASH/RELIANCE?endTimeInMillis=${Date.now()}&intervalInMinutes=1440&startTimeInMillis=${Date.now() - 370 * DAY * 1000}`)
console.log(`  groww 1y ${gw.status} candles=${json(gw)?.candles?.length}`)
if (json(gw)) save(`${FIX}/groww-1y.json`, json(gw))

// Logos, if the ids are usable.
const logoIds = eqScan.body?.data?.slice(0, 3).map((d) => d.d[wantEquityColumns.indexOf('logoid')]).filter(Boolean) ?? []
for (const id of logoIds) {
  const r = await get(`https://s3-symbol-logo.tradingview.com/${id}.svg`)
  console.log(`  logo ${id}: ${r.status} ${r.text.slice(0, 60)}`)
}

console.log('\nDONE')
