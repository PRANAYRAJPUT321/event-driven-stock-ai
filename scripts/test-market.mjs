#!/usr/bin/env node
// Tests the market-data layer against real responses recorded from each
// provider (scripts/fixtures/market). No network: providers are answered by
// the replay module, which serves only what was actually recorded.
//
//   npm run test:market
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const MODULES = [
  'lib/market/tradingView.ts',
  'lib/market/candles.ts',
  'lib/market/nseDirectory.ts',
  'lib/market/priceHistory.ts',
  'lib/market/quotes.ts',
  'lib/market/stockProfile.ts',
  'lib/market/realMetrics.ts',
  'lib/market/indianEquities.ts',
]

const out = mkdtempSync(path.join(process.cwd(), '.tsbuild-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
const tsconfigPath = path.join(out, 'tsconfig.json')
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    compilerOptions: {
      target: 'es2022', module: 'commonjs', moduleResolution: 'node', skipLibCheck: true, esModuleInterop: true,
      resolveJsonModule: true, baseUrl: process.cwd(), paths: { '@/*': ['./*'] }, outDir: out,
      rootDir: path.join(process.cwd(), 'lib'), noEmitOnError: false, types: [],
    },
    files: MODULES.map((m) => path.join(process.cwd(), m)),
  })
)
try {
  execSync(`./node_modules/.bin/tsc --project ${tsconfigPath}`, { stdio: 'pipe' })
} catch (err) {
  // Next's `next: { revalidate }` fetch option is unknown outside Next's
  // types; tsc still emits, so only a missing output is fatal.
  if (!existsSync(path.join(out, 'market/quotes.js'))) {
    console.error(String(err.stdout || '') + String(err.stderr || ''))
    process.exit(1)
  }
}

const require = createRequire(import.meta.url)
const replay = require('./fixtures/market/replay.cjs')
const realFetch = globalThis.fetch
// Every provider call in this file is answered from the recordings; any other
// host is refused, so a test can never quietly pass on live data.
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  const res = replay.respond(url, init || {})
  if (res) return res
  throw new TypeError(`fetch failed (not recorded: ${new URL(url).hostname})`)
}

const tv = require(path.join(out, 'market/tradingView.js'))
const candles = require(path.join(out, 'market/candles.js'))
const directory = require(path.join(out, 'market/nseDirectory.js'))
const history = require(path.join(out, 'market/priceHistory.js'))
const quotes = require(path.join(out, 'market/quotes.js'))
const profile = require(path.join(out, 'market/stockProfile.js'))
const metrics = require(path.join(out, 'market/realMetrics.js'))
const equities = require(path.join(out, 'market/indianEquities.js'))

const fixture = (name) => JSON.parse(readFileSync(path.join('scripts/fixtures/market', name), 'utf8'))
const official = JSON.parse(readFileSync('lib/market/data/nifty50.json', 'utf8')).constituents

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks++
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++
    console.log(`  FAIL ${label}\n       got:  ${JSON.stringify(actual)}\n       want: ${JSON.stringify(expected)}`)
  }
}
function checkThat(label, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}
const close = (a, b, tol = 1e-6) => a !== null && b !== null && Math.abs(a - b) <= tol
const section = (name) => console.log(`\n${name}`)

// ───────────────────────────── universe ─────────────────────────────
section('NIFTY 50 universe matches NSE’s published list')
check('fifty constituents', equities.NIFTY_50.length, 50)
check('same symbols as the official file', equities.NIFTY_50.map((c) => c.symbol).sort(), official.map((c) => c.symbol).sort())
checkThat('every ISIN matches the official file',
  equities.NIFTY_50.every((c) => official.find((o) => o.symbol === c.symbol)?.isin === c.isin))
checkThat('no departed constituent remains', !equities.NIFTY_50.some((c) => ['TATAMOTORS', 'LTIM', 'BPCL', 'BRITANNIA', 'INDUSINDBK', 'HEROMOTOCO', 'WIPRO'].includes(c.symbol)))
check('aviation now has a constituent', equities.equitiesForSectors(['Aviation'], 6).map((c) => c.symbol), ['INDIGO'])
check('every ranked sector gets a company before any gets a second',
  equities.equitiesForSectors(['Aviation', 'Chemicals', 'Auto', 'Energy'], 6).map((c) => c.symbol),
  ['INDIGO', 'GRASIM', 'MARUTI', 'RELIANCE', 'M&M', 'ONGC'])
check('the demerged Tata Motors resolves', equities.RENAMED_SYMBOLS.TATAMOTORS.to, 'TMPV')

// ───────────────────────────── directory ─────────────────────────────
section('NSE directory search')
checkThat('directory holds the full listing', directory.DIRECTORY_SIZE > 2000, `size=${directory.DIRECTORY_SIZE}`)
check('isin for RELIANCE', directory.isinFor('RELIANCE'), 'INE002A01018')
check('isin for a non-NIFTY listing', directory.isinFor('WIPRO'), 'INE075A01022')
check('exact symbol ranks first', directory.searchDirectory('RELIANCE', 3)[0].symbol, 'RELIANCE')
check('name search finds the bank', directory.searchDirectory('hdfc bank', 3)[0].symbol, 'HDFCBANK')
check('lower-case symbol search', directory.searchDirectory('infy', 3)[0].symbol, 'INFY')
{
  const tata = directory.searchDirectory('tata', 6).map((h) => h.symbol)
  checkThat('“tata” surfaces the NIFTY Tata companies first',
    ['TCS', 'TMPV', 'TATASTEEL', 'TATACONSUM'].every((s) => tata.slice(0, 5).includes(s)), JSON.stringify(tata))
}
{
  const renamed = directory.searchDirectory('TATAMOTORS', 3)[0]
  check('old symbol finds its successor', [renamed.symbol, renamed.renamedFrom], ['TMPV', 'TATAMOTORS'])
}
check('“zomato” finds Eternal', directory.searchDirectory('zomato', 3)[0].symbol, 'ETERNAL')
check('nonsense finds nothing', directory.searchDirectory('qqqzzzxx', 5), [])
checkThat('hits carry NIFTY membership', directory.searchDirectory('reliance', 1)[0].inNifty50 === true)
checkThat('non-NIFTY hits are marked as such', directory.searchDirectory('WIPRO', 1)[0].inNifty50 === false)

// ───────────────────────────── TradingView ─────────────────────────────
section('TradingView screener parsing')
check('hyphenated NSE symbols are translated', tv.tvTicker('BAJAJ-AUTO'), 'NSE:BAJAJ_AUTO')
check('ampersand symbols pass through', tv.tvTicker('M&M'), 'NSE:M&M')
{
  const rows = await tv.tvScan('india', ['NSE:RELIANCE', 'NSE:TCS', 'NSE:NOTREAL'], ['close', 'change', 'change_abs', 'currency'])
  check('unknown tickers are absent, not errors', [rows.has('NSE:RELIANCE'), rows.has('NSE:NOTREAL')], [true, false])
  const q = tv.quoteFromRow(rows.get('NSE:RELIANCE'))
  const rec = replay.rows.get('NSE:RELIANCE')
  checkThat('previous close = close − absolute change', close(q.previousClose, rec.close - rec.change_abs))
  checkThat('day move is the screener’s percentage', close(q.changePct, rec.change))
  check('currency read from the row', q.currency, 'INR')
}
check('rating buckets', [0.6, 0.2, 0, -0.2, -0.6].map(tv.technicalRatingLabel), ['Strong buy', 'Buy', 'Neutral', 'Sell', 'Strong sell'])
check('no rating, no label', tv.technicalRatingLabel(null), null)

// ───────────────────────────── candles ─────────────────────────────
section('Candle parsers against recorded responses')
{
  const up = candles.parseUpstox(fixture('upstox-days-1y.json'))
  check('upstox: every bar parsed', up.length, fixture('upstox-days-1y.json').data.candles.length)
  checkThat('upstox: sorted oldest first', up.every((c, i) => i === 0 || c.t > up[i - 1].t))
  const newest = fixture('upstox-days-1y.json').data.candles[0]
  check('upstox: newest bar intact', [up.at(-1).o, up.at(-1).h, up.at(-1).l, up.at(-1).c], newest.slice(1, 5))
  checkThat('upstox: high ≥ low on every bar', up.every((c) => c.h >= c.l))
}
{
  const mc = candles.parseUdf(fixture('moneycontrol-1y.json'))
  check('moneycontrol: every bar parsed', mc.length, fixture('moneycontrol-1y.json').t.length)
  check('moneycontrol: no_data is empty, not an error', candles.parseUdf({ s: 'no_data' }), [])
}
{
  const gw = candles.parseGroww(fixture('groww-1y.json'))
  check('groww: every bar parsed', gw.length, fixture('groww-1y.json').candles.length)
  checkThat('groww: epoch seconds became milliseconds', gw[0].t > 1e12)
}
{
  const weekly = candles.parseUpstox(fixture('upstox-weeks-5y.json'))
  const gaps = weekly.slice(1).map((c, i) => (c.t - weekly[i].t) / 86_400_000)
  checkThat('upstox weekly bars are a week apart', gaps.every((g) => g >= 6 && g <= 8), JSON.stringify(gaps.filter((g) => g < 6 || g > 8)))
}

// ───────────────────────────── price history ─────────────────────────────
section('Price history: ranges and provider fallback')
{
  const h = await history.fetchPriceHistory('RELIANCE', '1y')
  check('1y comes from Upstox', h.source, 'upstox')
  check('1y is daily bars', [h.interval, h.intraday, h.ohlc], ['1 day', false, true])
  checkThat('1y has a year of sessions', h.candles.length >= 240, `bars=${h.candles.length}`)
}
{
  // The daily series stops at the previous session while the market is open;
  // today's intraday bars must be folded into one real bar at the end.
  const h = await history.fetchPriceHistory('RELIANCE', '6m')
  const intra = candles.parseUpstox(fixture('upstox-intraday-5m.json'))
  const last = h.candles.at(-1)
  const istDay = (t) => new Date(t + 19800000).toISOString().slice(0, 10)
  check('daily chart ends with today', istDay(last.t), istDay(intra.at(-1).t))
  check('today’s bar closes at the latest intraday price', last.c, intra.at(-1).c)
  check('today’s bar opens at the first intraday price', last.o, intra[0].o)
  check('today’s high is the session high', last.h, Math.max(...intra.map((c) => c.h)))
  check('only one bar per day', new Set(h.candles.map((c) => istDay(c.t))).size, h.candles.length)
}
{
  const h = await history.fetchPriceHistory('RELIANCE', '1d')
  check('1d is intraday', [h.intraday, h.interval], [true, '5 min'])
  check('1d keeps one session', new Set(h.candles.map((c) => new Date(c.t + 19800000).toISOString().slice(0, 10))).size, 1)
  checkThat('1d has a previous-close baseline', typeof h.previousClose === 'number', String(h.previousClose))
}
{
  const h = await history.fetchPriceHistory('RELIANCE', '5y')
  check('5y uses weekly bars', [h.source, h.interval], ['upstox', '1 week'])
}
{
  // TCS has no recorded 1y Upstox series (only a month), so 6m must still
  // resolve from what Upstox does return, and say where it came from.
  const h = await history.fetchPriceHistory('TCS', '1m')
  check('another constituent charts too', h.source, 'upstox')
}
{
  const h = await history.fetchPriceHistory('^NSEI', '1y')
  check('indices chart via their Upstox key', [h.source, h.candles.length > 200], ['upstox', true])
}
{
  let message = ''
  try { await history.fetchPriceHistory('NOTALISTING', '1y') } catch (e) { message = e.message }
  checkThat('an unlisted symbol is refused plainly', /not an NSE-listed symbol/.test(message), message)
}
{
  // Upstox answering nothing must fall through to Moneycontrol.
  const saved = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('api.upstox.com')) return new Response('{"status":"error"}', { status: 500 })
    return saved(input, init)
  }
  const h = await history.fetchPriceHistory('RELIANCE', '1y')
  globalThis.fetch = saved
  check('falls back to Moneycontrol when Upstox fails', h.source, 'moneycontrol')
  checkThat('and records why', h.attempts.some((a) => a.startsWith('upstox: HTTP 500')), JSON.stringify(h.attempts))
}

// ───────────────────────────── quotes ─────────────────────────────
section('Quotes: market bar and NIFTY 50 grid')
{
  const bar = await quotes.fetchMarketBar(60, quotes.HEATMAP_SYMBOLS)
  const by = new Map(bar.quotes.map((q) => [q.symbol, q]))
  check('NIFTY 50 index from the screener', by.get('^NSEI')?.source, 'tradingview')
  // No Nifty Auto series was recorded, so it must be reported missing — the
  // recordings never stand in for a provider that was not asked.
  check('an unrecorded sector index is reported, not invented', [by.has('^CNXAUTO'), bar.failed.includes('^CNXAUTO')], [false, true])
  check('gold resolves', by.get('GC=F')?.source, 'tradingview')
  check('USD/INR resolves live', by.get('USDINR=X')?.source, 'tradingview')
  checkThat('world indices resolve', ['^GSPC', '^FTSE', '^N225', '^GDAXI', '^HSI'].every((s) => by.has(s)))
  checkThat('the index tile has a sparkline', (by.get('^NSEI')?.spark?.length ?? 0) > 10, String(by.get('^NSEI')?.spark?.length))
  checkThat('every tracked ticker that was recorded resolves',
    quotes.HEATMAP_SYMBOLS.filter((s) => s.tv && replay.rows.has(s.tv)).every((s) => by.has(s.symbol)))
}
{
  const eq = await quotes.fetchEquityQuotes(equities.NIFTY_50, 60)
  const by = new Map(eq.quotes.map((q) => [q.symbol, q]))
  check('all fifty constituents resolve', eq.quotes.length, 50)
  check('BAJAJ-AUTO, absent from the recording, falls back to Upstox', by.get('BAJAJ-AUTO')?.source, 'upstox')
  checkThat('screener quotes carry market cap', (by.get('RELIANCE')?.marketCap ?? 0) > 1e12)
  checkThat('every tile has a sparkline', eq.quotes.every((q) => (q.spark?.length ?? 0) >= 10),
    eq.quotes.filter((q) => (q.spark?.length ?? 0) < 10).map((q) => q.symbol).join(','))
  checkThat('sectors are attached', eq.quotes.every((q) => q.sector))
  check('nothing failed', eq.failed, [])
}

// ───────────────────────────── metrics & profile ─────────────────────────────
section('Scoring inputs and the stock profile')
{
  const many = await metrics.fetchStockMetricsMany([
    { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' },
  ])
  const rel = many.get('RELIANCE')
  const rec = replay.rows.get('NSE:RELIANCE')
  checkThat('P/E from the screener', close(rel.valuation.peRatio, Number(rec.price_earnings_ttm.toFixed(2))))
  check('ROE falls back to the fiscal-year figure', rel.fundamental.returnOnEquityPct, Number(rec.return_on_equity_fy.toFixed(2)))
  check('debt/equity converted to the percentage the score expects', rel.fundamental.debtToEquity, Number((rec.debt_to_equity_fy * 100).toFixed(2)))
  checkThat('volatility computed from a year of closes', rel.technical.volatilityPct > 5 && rel.technical.volatilityPct < 80, String(rel.technical.volatilityPct))
  check('RSI from the screener', rel.technical.rsi14, Number(rec.RSI.toFixed(1)))
  const hdfc = many.get('HDFCBANK')
  check('HDFC Bank uses the latest-quarter D/E', hdfc.fundamental.debtToEquity, Number((replay.rows.get('NSE:HDFCBANK').debt_to_equity * 100).toFixed(2)))
}
{
  const p = await profile.fetchStockProfile('RELIANCE')
  check('profile source', p.source, 'tradingview')
  check('NIFTY name kept', p.name, 'Reliance Industries')
  checkThat('price and previous close', p.price > 0 && p.previousClose > 0)
  checkThat('52-week range', p.week52High > p.week52Low)
  checkThat('performance block', p.performance.y1 !== null && p.performance.ytd !== null)
  checkThat('technical rating labelled', typeof p.technicalRating.label === 'string')
  checkThat('logo URL built', /^https:\/\/s3-symbol-logo\.tradingview\.com\/.+--big\.svg$/.test(p.logoUrl))
  checkThat('next earnings date', typeof p.nextEarnings === 'string')
}
{
  const p = await profile.fetchStockProfile('TATAMOTORS')
  check('a renamed symbol opens its successor', [p.symbol, p.renamed?.from], ['TMPV', 'TATAMOTORS'])
}
{
  let name = ''
  try { await profile.fetchStockProfile('NOTALISTING') } catch (e) { name = e.constructor.name }
  check('an unknown symbol is a typed error', name, 'UnknownSymbolError')
}

globalThis.fetch = realFetch
console.log(failures === 0 ? `\n✓ ${checks} checks passed` : `\n✗ ${failures} of ${checks} checks failed`)
process.exit(failures === 0 ? 0 : 1)
