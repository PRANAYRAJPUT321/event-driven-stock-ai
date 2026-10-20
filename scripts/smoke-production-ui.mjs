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
