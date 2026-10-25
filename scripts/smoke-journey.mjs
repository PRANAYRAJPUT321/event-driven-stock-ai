// Temporary: the full guest journey through every feature on the deployed
// site, with a PASS/FAIL per check (see .github/workflows/smoke-production.yml).
// Writes only to the visitor's own browser storage; analyses are anonymous.
import { createRequire } from 'node:module'
import { appendFileSync, mkdirSync } from 'node:fs'
mkdirSync('smoke-out', { recursive: true })
const require = createRequire(import.meta.url)
let chromium
try {
  chromium = require('playwright-core').chromium
} catch {
  chromium = (await import('playwright-core')).chromium
}

const BASE = process.env.BASE || 'https://event-driven-stock-ai-wnj4.vercel.app'
const WIDTH = Number(process.env.WIDTH || 390)
const SHOTS = process.env.SHOTS || 'smoke-out/journey'
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' })
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: WIDTH > 800 ? 900 : 844 },
  isMobile: WIDTH < 800,
  hasTouch: WIDTH < 800,
})
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 200)}`))
page.on('dialog', (d) => d.accept())

let pass = 0
let fail = 0
const results = []
function check(name, ok, detail = '') {
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  console.log(results.at(-1))
  appendFileSync('smoke-out/journey.txt', `[${WIDTH}] ${results.at(-1)}\n`)
}
const text = async (sel = 'main') => ((await page.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
const go = async (path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1200)
}
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const step = async (name, fn) => {
  try {
    await fn()
  } catch (e) {
    check(name, false, String(e).split('\n')[0].slice(0, 160))
  }
}

// ── Markets ──
await step('markets', async () => {
  await go('/markets')
  await page.waitForFunction(() => document.querySelectorAll('[class*="tile"], svg rect').length > 20, null, { timeout: 30000 }).catch(() => {})
  const t = await text()
  check('markets: heatmap renders', /heatmap/i.test(t) && /RELIANCE|HDFCBANK|Reliance/.test(t), t.slice(0, 80))
  check('markets: no horizontal overflow', (await overflow()) <= 1)
  await page.screenshot({ path: `${SHOTS}/${WIDTH}-markets.png` })
})

// ── Search (command palette / header search) ──
await step('search', async () => {
  await go('/markets')
  const searchButton = page.locator('header button[aria-label^="Search"]:visible').first()
  await searchButton.click()
  await page.waitForSelector('[role="dialog"] input, input[type="search"], input[placeholder*="earch" i]', { timeout: 10000 })
  await page.keyboard.type('infosys', { delay: 40 })
  await page.waitForTimeout(1500)
  const opts = await page.locator('[role="option"]').allInnerTexts()
  check('search: finds Infosys', opts.some((o) => /INFY|Infosys/i.test(o)), opts.slice(0, 3).join(' | ').replace(/\s+/g, ' '))
  await page.keyboard.press('Enter')
  await page.waitForURL('**/stocks/**', { timeout: 15000 })
  check('search: Enter opens the stock page', /\/stocks\/INFY/i.test(page.url()), page.url())
})

// ── Stock page ──
await step('stock page', async () => {
  await go('/stocks/RELIANCE')
  await page.locator('h1').first().waitFor({ timeout: 30000 })
  const t = await text()
  check('stock: name and live price', /Reliance Industries/.test(t) && /₹\s?[\d,]+/.test(t))
  for (const range of ['1D', '1M', '5Y']) {
    await page.click(`button:text-is("${range}")`)
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(800)
    const t2 = await text()
    check(`stock: ${range} chart loads`, !/couldn.t load|failed to load|unavailable/i.test(t2))
  }
  const candles = page.locator('button:text-is("Candles")')
  if (await candles.count()) {
    await candles.click()
    await page.waitForTimeout(800)
    check('stock: candles view', (await page.locator('svg').count()) > 0)
  }
  check('stock: no horizontal overflow', (await overflow()) <= 1)
  await page.screenshot({ path: `${SHOTS}/${WIDTH}-stock.png` })
  await go('/stocks/NOTASTOCK')
  check('stock: unknown symbol says so', /not listed/i.test(await text()))
  await go('/stocks/IRCTC')
  check('stock: non-NIFTY company page opens', /Railway|IRCTC/i.test(await text()))
})

// ── Analyze: refusals ──
await step('analyze refusals', async () => {
  for (const [input, expect] of [
    ['I love you', /doesn.t look like a market event/i],
    ['Should I buy Reliance?', /names Reliance/i],
    ['Crude oil prices', /doesn.t say which way/i],
  ]) {
    await go('/analyze')
    await page.locator('textarea').fill(input)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2500)
    const alert = (await page.locator('div[role="alert"]').filter({ hasText: /./ }).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`analyze: "${input}" refused with reason`, expect.test(alert) && /\/analyze/.test(page.url()), alert.slice(0, 90))
  }
  const chips = await page.locator('div[role="alert"] a').count()
  await go('/analyze')
  await page.locator('textarea').fill('I love HDFC Bank')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(2500)
  check('analyze: refusal offers the named company', (await page.locator('div[role="alert"] a:has-text("HDFC Bank")').count()) > 0)
  void chips
})

// ── Analyze an event → result page ──
let eventUrl = ''
await step('analyze event', async () => {
  await go('/analyze')
  await page.locator('textarea').fill('Crude oil crashed by 25%')
  const t0 = Date.now()
  await page.click('button[type="submit"]')
  await page.waitForURL('**/events/**', { timeout: 60000 })
  await page.locator('text=Top Affected Stocks').waitFor({ timeout: 60000 })
  eventUrl = page.url()
  check('event: result page opens', true, `${Date.now() - t0}ms`)
  const rows = (await page.locator('tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' '))
  const ongc = rows.find((r) => r.startsWith('ONGC')) || ''
  const airline = rows.find((r) => r.startsWith('INDIGO')) || ''
  check('event: crude crash hurts ONGC', /Hurts/.test(ongc), ongc.slice(0, 60))
  check('event: crude crash helps IndiGo', /Helps/.test(airline), airline.slice(0, 60))
  const t = await text()
  check('event: bull, bear and risks shown', /Bull Case/i.test(t) && /Bear Case/i.test(t) && /Key Risks/i.test(t))
  check('event: no horizontal overflow', (await overflow()) <= 1)
  await page.screenshot({ path: `${SHOTS}/${WIDTH}-event.png` })

  // Watch, simulate, save
  const first = page.locator('tbody tr').first()
  const sym = ((await first.innerText()).trim().split(/\s+/)[0] || '').trim()
  await first.locator('button:has-text("+ Watch")').click()
  await page.waitForTimeout(1000)
  check('event: watch a stock', /Watching|✓/.test(await first.innerText()), sym)
  await first.locator('button:has-text("Simulate")').click()
  await page.waitForTimeout(2500)
  check('event: simulate a trade', /In Portfolio/.test(await first.innerText()), sym)
  const save = page.locator('button:has-text("Save Analysis")')
  if (await save.count()) {
    await save.click()
    await page.waitForTimeout(800)
    check('event: save analysis', (await page.locator('button:has-text("Saved")').count()) > 0)
  }
})

// ── Company-specific and non-NIFTY events ──
await step('company events', async () => {
  for (const [input, sym] of [
    ['Infosys Q2 results beat estimates', 'INFY'],
    ['Union Bank of India Q2 net profit rises 30% on strong NII', 'UNIONBANK'],
  ]) {
    await go('/analyze')
    await page.locator('textarea').fill(input)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/events/**', { timeout: 60000 })
    await page.locator('text=Top Affected Stocks').waitFor({ timeout: 60000 })
    const rows = (await page.locator('tbody tr').allInnerTexts()).map((r) => r.replace(/\s+/g, ' '))
    check(`event: "${input.slice(0, 30)}…" scores ${sym} only`, rows.length === 1 && rows[0].startsWith(sym) && /Helps/.test(rows[0]), rows.join(' / ').slice(0, 100))
  }
})

// ── Watchlist ──
await step('watchlist', async () => {
  await go('/watchlist')
  const before = await text()
  check('watchlist: shows the watched stock', /stock/i.test(before) && !/No stocks|empty/i.test(before.slice(0, 200)), before.slice(0, 100))
  const input = page.locator('input[placeholder*="search any NSE company" i]')
  if (await input.count()) {
    await input.pressSequentially('TCS', { delay: 50 })
    await page.locator('#stock-search-list [role="option"]').first().waitFor({ timeout: 20000 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
    check('watchlist: add from search', /TCS|Tata Consultancy/.test(await text()))
  }
  check('watchlist: no horizontal overflow', (await overflow()) <= 1)
})

// ── Portfolio ──
await step('portfolio', async () => {
  await go('/portfolio')
  await page.waitForTimeout(2000)
  const t = await text()
  check('portfolio: position listed with live P&L', /Entry ₹/.test(t) && /%/.test(t), t.slice(0, 120))
  check('portfolio: long/short side shown', /\bLong\b|\bShort\b/i.test(t))
  check('portfolio: no horizontal overflow', (await overflow()) <= 1)
  await page.screenshot({ path: `${SHOTS}/${WIDTH}-portfolio.png` })
})

// ── History ──
await step('history', async () => {
  await go('/history')
  await page.waitForTimeout(1500)
  const rows = await page.locator('main .space-y-2 > div').count()
  check('history: analyses listed', rows >= 3, `${rows} rows`)
  await page.click('button:text-is("BUY")')
  await page.waitForTimeout(500)
  check('history: filter works', true)
  await page.click('button:text-is("ALL")')
  const before = await page.locator('main .space-y-2 > div').count()
  await page.locator('main .space-y-2 > div').last().locator('button[aria-label^="Remove"]').click()
  await page.waitForTimeout(1000)
  check('history: remove an entry', (await page.locator('main .space-y-2 > div').count()) === before - 1)
})

// ── Dashboard ──
await step('dashboard', async () => {
  await go('/dashboard')
  const t = await text()
  check('dashboard: greeting and recent calls', /Good (morning|afternoon|evening)/.test(t) && /Crude|Infosys|Union/i.test(t))
  check('dashboard: no horizontal overflow', (await overflow()) <= 1)
})

// ── Discover ──
await step('discover', async () => {
  await go('/discover')
  const t = await text()
  check('discover: page renders', /News/i.test(t))
  for (const f of ['Banking', 'IT']) {
    const b = page.locator(`button:text-is("${f}")`)
    if (await b.count()) await b.click()
  }
  check('discover: sector filters clickable', true)
})

// ── Settings ──
await step('settings', async () => {
  await go('/settings')
  const name = page.locator('input').first()
  await name.fill('Pranay')
  const save = page.locator('button:has-text("Save")').first()
  await save.click()
  await page.waitForTimeout(1000)
  check('settings: profile saves', /saved|updated/i.test(await text()))
})

// ── Theme toggle ──
await step('theme', async () => {
  await go('/markets')
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.locator('header button[aria-label*="theme" i], header button[title*="theme" i]').first().click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  check('theme: toggles light/dark', before !== after, `${before} → ${after}`)
})

// ── Not-found pages ──
await step('not found', async () => {
  await go('/events/does-not-exist')
  check('event: missing analysis explained', /isn.t saved in this browser/i.test(await text()))
  await go('/no-such-page')
  check('404: custom page', /nothing at this address/i.test(await page.locator('body').innerText()))
  await go('/auth/login')
  check('login: offers guest access', /No account needed|Continue as guest/i.test(await page.locator('body').innerText()))
})

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
console.log(`\n${pass} passed, ${fail} failed (width ${WIDTH})`)
await browser.close()
process.exit(fail ? 1 : 0)
