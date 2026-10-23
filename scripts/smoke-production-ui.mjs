// Temporary: drives the deployed site in Chrome from a cloud runner and saves
// screenshots plus any page errors (see .github/workflows/smoke-production.yml).
import { chromium } from 'playwright-core'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const BASE = process.env.BASE || 'https://event-driven-stock-ai-wnj4.vercel.app'
const OUT = 'smoke-out'
const THUMBS = (process.env.THUMBS || '').split(',').filter(Boolean)
mkdirSync(OUT, { recursive: true })
const report = (line) => {
  console.log(line)
  appendFileSync(`${OUT}/ui.txt`, line + '\n')
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' })

async function visit(name, path, { width = 1440, height = 900, theme = 'dark', act } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('pulse-theme', t)
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)))
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`))
  const t0 = Date.now()
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(2500)
    if (act) await act(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    // A small JPEG of the first screen, printed into the job log in chunks:
    // the artifact store is not reachable from where these are reviewed.
    if (THUMBS.includes(name)) {
      // Small enough to travel as a check run's text (64 KB limit).
      const png = await page.screenshot()
      let b64 = ''
      for (const quality of [50, 40, 30, 20]) {
        b64 = (await sharp(png).resize({ width: 720, withoutEnlargement: true }).jpeg({ quality }).toBuffer()).toString('base64')
        if (b64.length < 60000) break
      }
      writeFileSync(`${OUT}/thumb-${name}.b64`, b64)
    }
    report(`${name.padEnd(28)} ${path} ${Date.now() - t0}ms overflowX=${overflow}px url=${new URL(page.url()).pathname}`)
  } catch (e) {
    report(`${name.padEnd(28)} ${path} FAILED: ${String(e).slice(0, 200)}`)
  }
  for (const e of [...new Set(errors)].slice(0, 8)) report('    ' + e)
  await ctx.close()
}

// The visitor journey in guest mode: no account, and no database needed.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)))
  const BAD = /unavailable|unreachable|database|supabase|schema\.sql|sign in to|not saved/i
  const deadline = Date.now() + 12 * 60_000
  for (;;) {
    await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(3000)
    if ((await page.locator('header').innerText().catch(() => '')).includes('Guest')) { report('guest build live'); break }
    if (Date.now() > deadline) { report('GUEST BUILD NOT LIVE after 12 minutes'); break }
    await page.waitForTimeout(20000)
  }
  const flag = async (label) => {
    const lines = (await page.locator('main').innerText().catch(() => '')).split('\n').filter((l) => BAD.test(l))
    report(`guest ${label.padEnd(10)} ${new URL(page.url()).pathname} ${lines.length ? 'FLAGGED ' + JSON.stringify(lines.slice(0, 3)) : 'clean'}`)
  }
  try {
    await flag('dashboard')
    await page.goto(BASE + '/analyze', { waitUntil: 'networkidle' })
    await page.locator('textarea').fill('Brent crude jumps 10% after supply cuts in the Middle East')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/events/**', { timeout: 90000 })
    await page.locator('text=Top Affected Stocks').waitFor({ timeout: 60000 })
    await page.waitForTimeout(2000)
    await flag('event')
    await page.locator('tbody tr').first().locator('button:has-text("+ Watch")').click()
    await page.locator('tbody tr').first().locator('button:has-text("Simulate")').click()
    await page.waitForTimeout(4000)
    report('guest row: ' + (await page.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ').slice(0, 120))
    for (const path of ['/watchlist', '/portfolio', '/history', '/settings']) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await flag(path.slice(1))
    }
    await page.goto(BASE + '/auth/login', { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    report('guest login: ' + ((await page.locator('text=No account needed').count()) ? 'offers guest access' : 'shows sign-in form'))
  } catch (e) {
    report('guest journey FAILED: ' + String(e).slice(0, 200))
  }
  for (const e of [...new Set(errors)].slice(0, 6)) report('    ' + e)
  await ctx.close()
}

await visit('markets-dark', '/markets')
await visit('markets-light', '/markets', { theme: 'light' })
await visit('markets-mobile', '/markets', { width: 390, height: 844 })
await visit('stock-reliance-1y', '/stocks/RELIANCE')
await visit('stock-reliance-1d', '/stocks/RELIANCE', {
  act: async (page) => {
    await page.click('button:text-is("1D")')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    report('    1D caption: ' + (await page.locator('p.text-sm:has(span.mono-tabular)').first().textContent().catch(() => '—')))
  },
})
await visit('stock-reliance-candles', '/stocks/RELIANCE', {
  act: async (page) => {
    await page.click('button:text-is("6M")')
    await page.waitForLoadState('networkidle')
    await page.click('button:text-is("Candles")')
    await page.waitForTimeout(1500)
  },
})
await visit('stock-tmpv-mobile', '/stocks/TATAMOTORS', { width: 390, height: 844 })
await visit('stock-hdfcbank-light', '/stocks/HDFCBANK', { theme: 'light' })
await visit('search-palette', '/markets', {
  act: async (page) => {
    await page.keyboard.press('Control+k')
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
    await page.keyboard.type('tata')
    await page.waitForTimeout(2000)
    const rows = await page.locator('[role="option"]').allTextContents()
    report('    search "tata": ' + rows.slice(0, 5).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 60)).join(' | '))
  },
})
await visit('analyze-anonymous', '/analyze', {
  act: async (page) => {
    await page.fill('textarea', 'Brent crude jumps 10% after supply cuts in the Middle East')
    await page.click('button[type="submit"]')
    await page.waitForSelector('text=Scored Stocks', { timeout: 60000 })
    await page.waitForTimeout(2500)
  },
})
await visit('discover', '/discover')
await visit('login', '/auth/login', { theme: 'light' })

await browser.close()
