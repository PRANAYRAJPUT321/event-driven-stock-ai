// Temporary: exercises the deployed site from a cloud runner and prints what
// every endpoint and page actually returned (see .github/workflows/smoke-production.yml).
// Read-only apart from one anonymous POST /api/analyze, which is never saved.
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'https://event-driven-stock-ai-wnj4.vercel.app'
const out = []
const log = (...a) => {
  const line = a.join(' ')
  out.push(line)
  console.log(line)
}

async function get(path, init) {
  const t0 = Date.now()
  try {
    const r = await fetch(BASE + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(45000) })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: r.status, ms: Date.now() - t0, text, json, location: r.headers.get('location') }
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: String(e), json: null }
  }
}

const short = (v, n = 220) => JSON.stringify(v)?.slice(0, n)

log(`# Production smoke test — ${BASE} — ${new Date().toISOString()}`)

// Wait for the build under test: renamed symbols chart only from this commit
// on, so a 200 here means production is serving it rather than the last one.
if (process.env.WAIT_FOR_DEPLOY) {
  const deadline = Date.now() + 12 * 60_000
  for (;;) {
    const r = await get('/api/stocks/history?symbol=TATAMOTORS&range=1m')
    if (r.status === 200) {
      log(`new build is live (TATAMOTORS history → 200)`)
      break
    }
    if (Date.now() > deadline) {
      log(`NEW BUILD NOT LIVE after 12 minutes (last status ${r.status}) — results below are for the previous build`)
      break
    }
    await new Promise((res) => setTimeout(res, 20_000))
  }
}

// ── Health ──
{
  const r = await get('/api/health')
  log(`\n## /api/health → ${r.status} (${r.ms}ms)`)
  log(short(r.json, 1500))
  // Whether the database host exists at all: a paused project and a deleted
  // one look the same from inside the app ("fetch failed").
  const host = r.json?.supabaseHost
  if (host) {
    const { lookup } = await import('node:dns/promises')
    try {
      const a = await lookup(host)
      log(`  DNS ${host} → ${a.address}`)
    } catch (e) {
      log(`  DNS ${host} → ${e.code || e.message}`)
    }
    for (const path of ['/auth/v1/health', '/rest/v1/']) {
      try {
        const res = await fetch(`https://${host}${path}`, { signal: AbortSignal.timeout(15000) })
        log(`  https://${host}${path} → ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`)
      } catch (e) {
        log(`  https://${host}${path} → ${e.cause?.code || e.message}`)
      }
    }
  }
}

// ── Market bar and heatmaps ──
{
  const r = await get('/api/market/live')
  const q = r.json?.quotes || []
  log(`\n## /api/market/live → ${r.status} (${r.ms}ms) quotes=${q.length} failed=${short(r.json?.failed)} stale=${r.json?.stale}`)
  for (const s of ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT', 'BZ=F', 'USDINR=X', '^GSPC'])
    log(`  ${s}: ${short(q.find((x) => x.symbol === s) && { p: q.find((x) => x.symbol === s).price, c: q.find((x) => x.symbol === s).changePct, src: q.find((x) => x.symbol === s).source, spark: q.find((x) => x.symbol === s).spark?.length })}`)
  const h = r.json?.heatmap || r.json?.heatmapQuotes
  if (h) log(`  heatmap entries: ${h.length}`)
}
{
  const r = await get('/api/market/equities')
  const q = r.json?.quotes || []
  log(`\n## /api/market/equities → ${r.status} (${r.ms}ms) quotes=${q.length} failed=${short(r.json?.failed)}`)
  log(`  sample: ${short(q.slice(0, 3).map((x) => ({ s: x.symbol, p: x.price, c: x.changePct, cap: x.marketCap, src: x.source, spark: x.spark?.length })), 500)}`)
  log(`  with marketCap: ${q.filter((x) => x.marketCap).length}, with spark: ${q.filter((x) => x.spark?.length > 1).length}`)
}
{
  const r = await get('/api/market/crypto')
  log(`\n## /api/market/crypto → ${r.status} (${r.ms}ms) coins=${r.json?.coins?.length} ${r.status !== 200 ? short(r.json || r.text) : ''}`)
}

// ── Search ──
for (const q of ['tata', 'reliance', 'hdfc bank', 'TATAMOTORS', 'zomato', 'nifty']) {
  const r = await get(`/api/search?q=${encodeURIComponent(q)}`)
  const c = r.json?.companies || r.json?.results || []
  log(`\n## /api/search?q=${q} → ${r.status} (${r.ms}ms) companies=${c.length} indices=${r.json?.indices?.length ?? '-'}`)
  log(`  top: ${c.slice(0, 4).map((x) => x.symbol).join(', ')}`)
}

// ── Stock profile, history (every range), prices ──
for (const sym of ['RELIANCE', 'TMPV', 'ONGC', 'IRCTC']) {
  const r = await get(`/api/stocks/quote?symbol=${sym}`)
  const p = r.json || {}
  log(`\n## /api/stocks/quote?symbol=${sym} → ${r.status} (${r.ms}ms) price=${p.price} chg=${p.changePct} pe=${p.peRatio} cap=${p.marketCap} src=${p.source} name=${p.name} ${r.status !== 200 ? short(p) : ''}`)
}
for (const sym of ['RELIANCE', 'TMPV']) {
  for (const range of ['1d', '5d', '1m', '6m', 'ytd', '1y', '5y', 'max']) {
    const r = await get(`/api/stocks/history?symbol=${sym}&range=${range}`)
    const c = r.json?.candles || []
    const first = c[0]?.t ? new Date(c[0].t).toISOString().slice(0, 16) : '-'
    const last = c.at(-1)?.t ? new Date(c.at(-1).t).toISOString().slice(0, 16) : '-'
    log(`  history ${sym} ${range.padEnd(3)} → ${r.status} (${r.ms}ms) bars=${c.length} ${r.json?.interval ?? ''} src=${r.json?.source ?? ''} ${first}→${last} lastClose=${c.at(-1)?.c ?? ''} ${r.status !== 200 ? short(r.json?.error) : ''}`)
  }
}
{
  const r = await get('/api/stocks/prices?spark=1&symbols=HDFCBANK,TCS,RELIANCE,AXISBANK')
  log(`\n## /api/stocks/prices → ${r.status} (${r.ms}ms) ${short(Object.fromEntries(Object.entries(r.json?.prices || {}).map(([k, v]) => [k, { p: v.price, c: v.changePct, spark: v.spark?.length }])), 500)}`)
}

// ── News ──
{
  const r = await get('/api/news/live')
  log(`\n## /api/news/live → ${r.status} (${r.ms}ms) items=${r.json?.items?.length} ${r.status !== 200 ? short(r.json || r.text) : ''}`)
  log(`  first: ${short(r.json?.items?.slice(0, 2).map((i) => [i.title, i.source, i.published_at]))}`)
}
{
  const r = await get('/api/news/company?symbol=RELIANCE&name=Reliance%20Industries')
  log(`\n## /api/news/company → ${r.status} (${r.ms}ms) ${short(r.json, 400)}`)
}
{
  const r = await get('/api/news/impact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectors: ['Energy', 'Aviation'], companies: [{ symbol: 'ONGC', name: 'Oil & Natural Gas Corporation' }] }),
  })
  log(`\n## /api/news/impact → ${r.status} (${r.ms}ms) ${short(r.json, 400)}`)
}

// ── Analysis (anonymous, rule engine, never stored) ──
for (const event of ['Brent crude jumps 10% after supply cuts in the Middle East', 'RBI cuts the repo rate by 25 basis points to support growth']) {
  const r = await get('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  const st = r.json?.result?.stocks || []
  log(`\n## /api/analyze "${event}" → ${r.status} (${r.ms}ms) persisted=${r.json?.persisted} sectors=${short(r.json?.result?.classification?.affected_sectors)}`)
  for (const s of st)
    log(`  ${s.symbol.padEnd(11)} ${String(s.recommendation).padEnd(7)} score=${s.opportunityScore} event=${s.eventImpactDirection}:${s.eventImpactScore} F=${s.fundamentalScore} V=${s.valuationScore} T=${s.technicalScore} R=${s.riskScore} cov=${s.coverage} ₹${s.price} pe=${s.peRatio}`)
  if (r.status !== 200) log('  ' + short(r.json || r.text, 400))
}

// ── Pages ──
for (const [path, expect] of [
  ['/', ''],
  ['/auth/login', 'PULSE'],
  ['/markets', 'heatmap'],
  ['/analyze', 'Analy'],
  ['/discover', 'News'],
  ['/stocks/RELIANCE', ''],
  ['/stocks/TATAMOTORS', ''],
  ['/dashboard', ''],
  ['/watchlist', ''],
  ['/preview-tiles', ''],
]) {
  const r = await get(path)
  log(`page ${path.padEnd(20)} → ${r.status}${r.location ? ' → ' + r.location : ''} (${r.ms}ms) ${expect ? (r.text.includes(expect) ? `contains "${expect}"` : `MISSING "${expect}"`) : ''}`)
}

mkdirSync('smoke-out', { recursive: true })
writeFileSync('smoke-out/report.txt', out.join('\n'))
