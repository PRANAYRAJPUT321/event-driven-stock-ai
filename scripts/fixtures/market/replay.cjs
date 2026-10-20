// Answers market-data requests from the responses recorded in this folder,
// for tests and for running the app offline (the development sandbox cannot
// reach the providers). Everything served here was returned by the real
// endpoint on the recording date; nothing is invented. Requests the
// recordings cannot answer get the same shape the provider uses for "no
// data", so the app's fallbacks are exercised honestly.
//
//   node --require ./scripts/fixtures/market/replay.cjs …   (patches fetch)
//   const { respond } = require('./replay.cjs')            (tests)
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const dir = __dirname
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
const tvEquities = load('tv-equities.json')
const tvTickers = load('tv-tickers.json')
const sparks = load('upstox-sparks.json')
const upstoxDaily = load('upstox-days-1y.json')
const upstoxWeekly = load('upstox-weeks-5y.json')
const upstoxIntraday = load('upstox-intraday-5m.json')
const upstoxNifty = load('upstox-index-nifty-1y.json')
const moneycontrol = load('moneycontrol-1y.json')
const groww = load('groww-1y.json')
const nifty = load('../../../lib/market/data/nifty50.json').constituents
const isinToSymbol = new Map(nifty.map((c) => [c.isin, c.symbol]))

// Every recorded screener row, keyed by ticker, as a column → value record.
const rows = new Map()
tvEquities.response.data.forEach((d) => {
  const rec = {}
  tvEquities.columns.forEach((c, i) => (rec[c] = d.d[i]))
  rows.set(d.s, rec)
})
const tickerColumns = ['description', 'close', 'change', 'change_abs', 'currency', 'high', 'low', 'open']
for (const market of Object.values(tvTickers)) {
  for (const d of market.response?.data || []) {
    if (rows.has(d.s)) continue
    const rec = {}
    tickerColumns.forEach((c, i) => (rec[c] = d.d[i]))
    rows.set(d.s, rec)
  }
}

// Exact responses recorded from the live providers for a specific run of the
// app (see record-requests.mjs): served before anything above, keyed by
// request. Absent until recorded.
const recordingsFile = path.join(dir, 'http-recordings.json')
const recordings = new Map(
  fs.existsSync(recordingsFile)
    ? JSON.parse(fs.readFileSync(recordingsFile, 'utf8')).entries.map((e) => [e.key, e])
    : []
)

/**
 * The identity of a request for matching against a recording. Upstox history
 * URLs carry today's date range, so they match on instrument, unit and
 * interval; a POST also matches on its body.
 */
function requestKey(method, url, body) {
  let u = url
  const m = url.match(/^(https:\/\/api\.upstox\.com\/v3\/historical-candle\/(?!intraday)[^/]+\/\w+\/\d+)\/[\d-]+\/[\d-]+/)
  if (m) u = m[1]
  const hash = body ? crypto.createHash('sha1').update(String(body)).digest('hex').slice(0, 16) : ''
  return `${(method || 'GET').toUpperCase()} ${u}${hash ? ' #' + hash : ''}`
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Candles in Upstox's shape (newest first) from [isoDate, close] pairs. */
function upstoxFromCloses(pairs) {
  return { status: 'success', data: { candles: pairs.map(([d, c]) => [`${d}T00:00:00+05:30`, c, c, c, c, 0, 0]).reverse() } }
}

function respond(url, init = {}) {
  const u = new URL(url)
  if (u.hostname === 'scanner.tradingview.com') {
    let body = {}
    try { body = JSON.parse(init.body || '{}') } catch {}
    const tickers = body?.symbols?.tickers || []
    const columns = body?.columns || []
    const data = tickers.filter((t) => rows.has(t)).map((t) => ({ s: t, d: columns.map((c) => (c in rows.get(t) ? rows.get(t)[c] : null)) }))
    return json({ totalCount: data.length, data })
  }
  if (u.hostname === 'api.upstox.com') {
    const m = u.pathname.match(/historical-candle\/(?:intraday\/)?([^/]+)\/(\w+)\/(\d+)/)
    const key = m ? decodeURIComponent(m[1]) : ''
    const unit = m?.[2]
    const intraday = u.pathname.includes('/intraday/')
    const isin = key.startsWith('NSE_EQ|') ? key.slice(7) : null
    const symbol = isin ? isinToSymbol.get(isin) : null
    if (intraday) return json(symbol === 'RELIANCE' ? upstoxIntraday : { status: 'success', data: { candles: [] } })
    if (key === 'NSE_INDEX|Nifty 50' && unit === 'days') return json(upstoxNifty)
    if (symbol === 'RELIANCE' && unit === 'days') return json(upstoxDaily)
    if (symbol === 'RELIANCE' && unit === 'weeks') return json(upstoxWeekly)
    if (symbol && sparks[symbol] && unit === 'days') return json(upstoxFromCloses(sparks[symbol]))
    return json({ status: 'success', data: { candles: [] } })
  }
  if (u.hostname === 'priceapi.moneycontrol.com') {
    const sym = u.searchParams.get('symbol')
    if (sym === 'RELIANCE' && u.searchParams.get('resolution') === '1D') return json(moneycontrol)
    return json({ s: 'no_data' })
  }
  if (u.hostname === 'groww.in') {
    return u.pathname.endsWith('/RELIANCE') ? json(groww) : json({ candles: [] })
  }
  return null
}

const HOSTS = new Set(['scanner.tradingview.com', 'api.upstox.com', 'priceapi.moneycontrol.com', 'groww.in'])
// Hosts the sandbox cannot reach anyway; refusing them fast keeps the
// fallback chain from waiting out timeouts.
const REFUSE = /(^|\.)(yahoo\.com|stooq\.com|nseindia\.com|bseindia\.com|frankfurter\.app|coingecko\.com|news\.google\.com)$/

// Never logged: credentials travel to these, and they are not market data.
const PRIVATE = /(^|\.)(supabase\.co|anthropic\.com|localhost|127\.0\.0\.1)$/

function install() {
  const realFetch = globalThis.fetch
  const logFile = process.env.REPLAY_LOG
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    let host = ''
    try { host = new URL(url).hostname } catch {}
    const method = (init?.method || 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : undefined
    if (logFile && host && !PRIVATE.test(host)) {
      const headers = {}
      new Headers(init?.headers || {}).forEach((v, k) => {
        if (!/authorization|cookie|api-key|apikey|token/i.test(k)) headers[k] = v
      })
      fs.appendFileSync(logFile, JSON.stringify({ method, url, headers, body }) + '\n')
    }
    const recorded = recordings.get(requestKey(method, url, body))
    if (recorded) {
      return new Response(recorded.body, {
        status: recorded.status,
        headers: { 'content-type': recorded.contentType || 'application/octet-stream' },
      })
    }
    if (HOSTS.has(host)) return respond(url, init || {})
    if (REFUSE.test(host)) throw new TypeError(`fetch failed (replay: ${host} not recorded)`)
    return realFetch(input, init)
  }
}

module.exports = { respond, install, rows, requestKey, recordings }
if (require.main !== module && process.env.MARKET_REPLAY !== '0') install()
