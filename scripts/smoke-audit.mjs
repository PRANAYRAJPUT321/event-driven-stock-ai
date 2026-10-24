// Temporary: an adversarial audit of the deployed site from a cloud runner
// (see .github/workflows/smoke-production.yml). Two parts:
//   1. what the analysis engine answers for the inputs a reviewer would try;
//   2. how long each page takes to show its content in a real Chrome, and
//      which requests hold it up.
// Read-only: the analyses are anonymous and never stored.
import { appendFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'https://event-driven-stock-ai-wnj4.vercel.app'
const OUT = 'smoke-out'
mkdirSync(OUT, { recursive: true })
const report = (line) => {
  console.log(line)
  appendFileSync(`${OUT}/audit.txt`, line + '\n')
}

report(`# Audit — ${BASE} — ${new Date().toISOString()}`)

// Wait for the build under test: the app's own 404 page ships with it, so
// until that text appears production is still serving the previous build.
{
  const deadline = Date.now() + 15 * 60_000
  for (;;) {
    const html = await fetch(BASE + '/no-such-page', { signal: AbortSignal.timeout(30000) })
      .then((r) => r.text())
      .catch(() => '')
    if (html.includes('nothing at this address')) {
      report('new build is live')
      break
    }
    if (Date.now() > deadline) {
      report('NEW BUILD NOT LIVE after 15 minutes — results below are for the previous build')
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000))
  }
}

// ── 1. Analysis battery ──
const EVENTS = [
  'Crude oil crashed by 25%', 'Crude oil prices rise', 'Brent crude jumps 10% after supply cuts in the Middle East',
  'RBI cuts the repo rate by 25 basis points', 'RBI hikes repo rate by 50 bps', 'RBI keeps repo rate unchanged', 'RBI does not cut rates',
  'US Fed signals higher-for-longer interest rates', 'US Fed raises interest rates', 'Fed cuts rates by 50 bps',
  'Rupee falls to 90 against the dollar', 'Gold prices hit record high', 'Sensex falls 1000 points', 'Nifty hits all time high',
  'War breaks out between India and Pakistan', 'Ceasefire announced between Israel and Iran', 'Covid lockdown announced again',
  'US imposes 50% tariffs on Indian goods', 'Infosys Q2 results beat estimates', 'HDFC Bank quarterly profit falls 10%',
  'Reliance announces bonus issue', 'TCS announces share buyback', 'Adani shares crash after fraud allegations',
  'Maruti Suzuki car sales jump 20% in October', 'Airtel raises mobile tariffs by 15%', 'Sun Pharma gets USFDA warning letter',
  'Infosys CEO resigns', 'Inflation rises to 7%', 'GDP growth slows to 5.4%', 'Monsoon rainfall at 92% of long period average',
  'I love you', 'I love HDFC Bank', 'Should I buy Reliance?', 'Tata Motors', 'Quarterly results season begins', 'hello',
  'Crude oil prices', 'Reliance Power shares surge 10%', 'Tech Mahindra wins a $500 million deal', 'OPEC+ announces output cut',
  'GST on cars cut from 28% to 18%', 'Union Budget raises railway capex by 20%', 'आरबीआई ने रेपो रेट घटाया',
]
for (const event of EVENTS) {
  const t0 = Date.now()
  try {
    const r = await fetch(BASE + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(60000),
    })
    const d = await r.json().catch(() => ({}))
    const ms = Date.now() - t0
    if (r.status !== 200) {
      report(`${event.slice(0, 48).padEnd(50)} ${r.status} ${ms}ms ${d.code || ''} ${(d.error || '').slice(0, 110)}`)
      continue
    }
    const c = d.result.classification
    const st = (d.result.stocks || []).map((s) => `${s.symbol}:${s.recommendation}${s.opportunityScore}/${(s.eventImpactDirection || '?').slice(0, 3)}${s.eventImpactScore}`)
    report(`${event.slice(0, 48).padEnd(50)} 200 ${ms}ms ${c.event_type}/${c.direction}/${c.magnitude} [${c.affected_sectors.join(',')}] ${st.join(' ')}`)
  } catch (e) {
    report(`${event.slice(0, 48).padEnd(50)} FAILED ${Date.now() - t0}ms ${String(e).slice(0, 100)}`)
  }
}

// ── 2. Page timing in Chrome ──
const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' })

/**
 * Time until the page shows content: the main element has real text and no
 * loading skeleton is left on screen.
 */
async function timePage(name, path, { width = 1440, height = 900, mobile = false, act } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  const reqs = new Map()
  const slow = []
  const errors = []
  let bytes = 0
  page.on('request', (r) => reqs.set(r, Date.now()))
  page.on('requestfinished', async (r) => {
    const ms = Date.now() - (reqs.get(r) || Date.now())
    try {
      bytes += (await r.sizes()).responseBodySize || 0
    } catch {}
    if (ms > 1500) slow.push(`${ms}ms ${r.url().replace(BASE, '').slice(0, 90)}`)
  })
  page.on('requestfailed', (r) => errors.push(`failed ${r.url().replace(BASE, '').slice(0, 90)} ${r.failure()?.errorText || ''}`))
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 90)}`))
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 150)))
  const t0 = Date.now()
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const dcl = Date.now() - t0
    if (act) await act(page)
    await page
      .waitForFunction(
        () => {
          const main = document.querySelector('main') || document.body
          const busy = [...document.querySelectorAll('.animate-pulse, .skeleton')].some((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && r.top < window.innerHeight
          })
          return main.innerText.trim().length > 150 && !busy && !/Loading…|Loading\.\.\./.test(main.innerText.slice(0, 400))
        },
        null,
        { timeout: 45000, polling: 100 }
      )
      .catch(() => {})
    const content = Date.now() - t0
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const h1 = ((await page.locator('h1').first().textContent({ timeout: 500 }).catch(() => '')) || '').trim().slice(0, 40)
    report(`${name.padEnd(24)} ${path.padEnd(26)} DCL=${dcl}ms content=${content}ms requests=${reqs.size} kb=${Math.round(bytes / 1024)} ovf=${overflow} h1="${h1}"`)
  } catch (e) {
    report(`${name.padEnd(24)} ${path.padEnd(26)} FAILED ${String(e).slice(0, 150)}`)
  }
  for (const s of slow.sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 5)) report('      slow ' + s)
  for (const e of [...new Set(errors)].slice(0, 5)) report('      ' + e)
  await ctx.close()
}

report('\n## Page timing (fresh browser each time, so every visit is a first visit)')
for (const [name, path] of [
  ['markets', '/markets'], ['dashboard', '/dashboard'], ['analyze', '/analyze'], ['discover', '/discover'],
  ['watchlist', '/watchlist'], ['portfolio', '/portfolio'], ['history', '/history'], ['settings', '/settings'],
  ['stock RELIANCE', '/stocks/RELIANCE'], ['stock IRCTC (non-NIFTY)', '/stocks/IRCTC'], ['stock bad symbol', '/stocks/NOTASTOCK'],
  ['event bad id', '/events/does-not-exist'], ['404', '/no-such-page'], ['login', '/auth/login'],
]) {
  await timePage(name, path)
}
for (const [name, path] of [['phone markets', '/markets'], ['phone dashboard', '/dashboard'], ['phone stock', '/stocks/HDFCBANK'], ['phone analyze', '/analyze']]) {
  await timePage(name, path, { width: 390, height: 844, mobile: true })
}

// The full journey on a phone, timed: type an event, wait for the result page.
await timePage('phone analyse→result', '/analyze', {
  width: 390,
  height: 844,
  mobile: true,
  act: async (page) => {
    await page.locator('textarea').waitFor({ timeout: 30000 })
    await page.waitForTimeout(1000)
    const t = Date.now()
    await page.locator('textarea').fill('Crude oil crashed by 25%')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/events/**', { timeout: 90000 }).catch(() => {})
    await page.locator('text=Top Affected Stocks').waitFor({ timeout: 60000 }).catch(() => {})
    report(`      submit → result page ${Date.now() - t}ms; first row: ${((await page.locator('tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 100)}`)
  },
})

await browser.close()
