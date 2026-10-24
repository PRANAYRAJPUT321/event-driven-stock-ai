// Temporary: collects real market headlines from the feeds the app reads, so
// the analysis engine can be checked against news as it is actually written
// (see .github/workflows/smoke-production.yml). Read-only.
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE || 'https://event-driven-stock-ai-wnj4.vercel.app'
const QUERIES = [
  'Sensex Nifty today', 'stock market India', 'RBI repo rate', 'RBI monetary policy', 'crude oil prices India',
  'rupee dollar', 'gold price India', 'Q2 results profit', 'quarterly results net profit India', 'shares jump',
  'shares fall', 'SEBI', 'US Fed rate India markets', 'tariffs India exports', 'Union Budget capex', 'inflation CPI India',
  'GDP growth India', 'monsoon IMD', 'FII outflows', 'IPO listing NSE', 'Reliance Industries', 'HDFC Bank', 'Infosys',
  'TCS', 'Tata Motors', 'Adani', 'Bharti Airtel', 'Maruti Suzuki sales', 'IndiGo airline', 'ONGC', 'Sun Pharma USFDA',
  'L&T order', 'ITC', 'bank stocks', 'IT stocks', 'auto stocks', 'pharma stocks', 'metal stocks', 'geopolitical oil',
  'defence stocks India', 'brokerage target price', 'block deal', 'dividend record date', 'buyback',
]

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const seen = new Set()
const out = []
for (const q of QUERIES) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&hl=en-IN&gl=IN&ceid=IN:en`
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text()
    for (const item of xml.split('<item>').slice(1, 13)) {
      const raw = decode((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
      // Google appends " - Publisher"; keep the headline itself.
      const title = raw.replace(/\s+-\s+[^-]{2,60}$/, '').trim()
      const key = title.toLowerCase()
      if (title.length < 20 || seen.has(key)) continue
      seen.add(key)
      out.push({ q, t: title })
    }
  } catch (e) {
    console.log('feed failed', q, String(e).slice(0, 80))
  }
}

// What the app's own Discover feed shows right now.
try {
  const live = await (await fetch(BASE + '/api/news/live', { signal: AbortSignal.timeout(45000) })).json()
  for (const item of live.items || []) {
    const key = String(item.title || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ q: 'discover', t: item.title })
  }
} catch {}

mkdirSync('smoke-out', { recursive: true })
writeFileSync('smoke-out/headlines.json', JSON.stringify(out))
console.log(`${out.length} headlines`)
