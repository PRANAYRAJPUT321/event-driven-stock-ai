// Probes market-data sources from a cloud machine (see
// .github/workflows/probe-sources.yml). Third pass: resolves the tickers the
// earlier passes could not — Indian sector indices, a few world indices, and
// symbols whose NSE spelling differs on TradingView. Development tool only.
import { mkdirSync, writeFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const TVH = { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }
const DAY = 86400
const ymd = (d) => d.toISOString().slice(0, 10)
mkdirSync('scripts/fixtures/market', { recursive: true })

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: '*/*', ...(init.headers || {}) }, signal: AbortSignal.timeout(20000) })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch {}
    return { status: res.status, text, body }
  } catch (e) {
    return { status: 0, text: String(e), body: null }
  }
}
const scan = (market, tickers, columns) =>
  get(`https://scanner.tradingview.com/${market}/scan`, { method: 'POST', headers: TVH, body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns }) })

// 1. Ask TradingView's own search what the index tickers are called.
console.log('## symbol search (indices)')
const searches = ['nifty auto', 'nifty pharma', 'nifty fmcg', 'nifty metal', 'nifty realty', 'nifty infra', 'nifty psu bank',
  'nifty media', 'nifty midcap 50', 'nifty private bank', 'nifty healthcare', 'nifty oil', 'nifty consumption', 'taiex', 'asx 200', 'klci', 'nifty 500']
const found = {}
for (const q of searches) {
  const r = await get(`https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(q)}&hl=0&lang=en&search_type=index&domain=production`, { headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' } })
  const syms = (r.body?.symbols || []).slice(0, 6).map((s) => `${s.prefix || s.exchange}:${s.symbol}`.replace(/<\/?em>/g, '') + ` (${(s.description || '').replace(/<\/?em>/g, '')})`)
  found[q] = syms
  console.log(`  ${q.padEnd(20)} ${r.status} ${syms.join(' | ')}`)
}

// 2. Confirm the scanner answers for the candidates search suggested, plus guesses.
console.log('\n## scanner check')
const guesses = ['NSE:BAJAJ_AUTO', 'NSE:BAJAJ-AUTO', 'NSE:M_M', 'NSE:M&M', 'NSE:CNXAUTO', 'NSE:CNXPHARMA', 'NSE:CNXFMCG', 'NSE:CNXMETAL',
  'NSE:CNXREALTY', 'NSE:CNXINFRA', 'NSE:CNXPSUBANK', 'NSE:CNXMEDIA', 'NSE:NIFTYAUTO', 'NSE:NIFTY_AUTO', 'NSE:NIFTYPHARMA', 'NSE:NIFTYFMCG',
  'NSE:NIFTYMETAL', 'NSE:NIFTYREALTY', 'NSE:NIFTYINFRA', 'NSE:NIFTYPSUBANK', 'NSE:NIFTYPVTBANK', 'NSE:NIFTY_MID_SELECT', 'NSE:NIFTYMIDCAP50',
  'NSE:CNX500', 'NSE:CNX100', 'TWSE:TAIEX', 'TVC:TAIEX', 'TWSE:IX0001', 'ASX:XJO', 'TVC:XJO', 'ASX:XAO', 'MYX:FBMKLCI', 'TVC:FBMKLCI', 'TVC:KLSE']
const fromSearch = Object.values(found).flat().map((s) => s.split(' ')[0]).filter((s) => /^[A-Z_]+:[A-Z0-9_!&.-]+$/.test(s))
const candidates = Array.from(new Set([...guesses, ...fromSearch]))
const answered = {}
for (const market of ['india', 'global']) {
  const r = await scan(market, candidates, ['description', 'close', 'change'])
  for (const d of r.body?.data || []) answered[d.s] = `${market}: ${d.d[0]} ${d.d[1]} ${d.d[2]?.toFixed?.(2)}`
}
for (const c of candidates) console.log(`  ${answered[c] ? 'ok ' : '-- '} ${c.padEnd(26)} ${answered[c] || ''}`)

// 3. Upstox names for NSE sector indices.
console.log('\n## upstox index names')
const to = ymd(new Date()), from = ymd(new Date(Date.now() - 10 * DAY * 1000))
const upNames = ['NSE_INDEX|Nifty Auto', 'NSE_INDEX|Nifty Pharma', 'NSE_INDEX|Nifty FMCG', 'NSE_INDEX|Nifty Metal', 'NSE_INDEX|Nifty Realty',
  'NSE_INDEX|Nifty Infra', 'NSE_INDEX|Nifty PSU Bank', 'NSE_INDEX|Nifty Media', 'NSE_INDEX|Nifty Energy', 'NSE_INDEX|Nifty Fin Service',
  'NSE_INDEX|Nifty Midcap 50', 'NSE_INDEX|NIFTY MIDCAP 100', 'NSE_INDEX|Nifty Next 50', 'NSE_INDEX|Nifty Pvt Bank', 'NSE_INDEX|NIFTY HEALTHCARE',
  'NSE_INDEX|Nifty Healthcare Index', 'NSE_INDEX|NIFTY OIL AND GAS', 'NSE_INDEX|Nifty Consumption', 'NSE_INDEX|Nifty 500', 'NSE_INDEX|Nifty 100',
  'NSE_INDEX|NIFTY SMLCAP 100', 'NSE_INDEX|Nifty Smallcap 100', 'NSE_INDEX|Nifty CPSE', 'NSE_INDEX|Nifty Commodities']
const upstoxOk = {}
for (const key of upNames) {
  const r = await get(`https://api.upstox.com/v3/historical-candle/${encodeURIComponent(key)}/days/1/${to}/${from}`, { headers: { Accept: 'application/json' } })
  const c = r.body?.data?.candles
  upstoxOk[key] = Array.isArray(c) && c.length > 0
  console.log(`  ${upstoxOk[key] ? 'ok ' : '-- '} ${key.padEnd(36)} ${r.status} ${c ? `${c.length} last=${JSON.stringify(c[0]).slice(0, 70)}` : r.text.slice(0, 120)}`)
}
const intr = await get(`https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent('NSE_INDEX|Nifty Auto')}/minutes/5`, { headers: { Accept: 'application/json' } })
console.log(`  intraday Nifty Auto ${intr.status} candles=${intr.body?.data?.candles?.length} ${JSON.stringify(intr.body?.data?.candles?.[0])}`)
writeFileSync('scripts/fixtures/market/probe3.json', JSON.stringify({ search: found, scanner: answered, upstox: upstoxOk }, null, 1))
console.log('\nDONE')
