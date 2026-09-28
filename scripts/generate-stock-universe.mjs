/**
 * Regenerates lib/market/stockUniverse.ts from database/seed.sql.
 *
 *   node scripts/generate-stock-universe.mjs
 *
 * The universe exists in two places on purpose — the `stocks` table is the
 * source of truth when the database is reachable, and the generated module is
 * the fallback when it is not. Generating one from the other keeps them from
 * drifting.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const sql = readFileSync('database/seed.sql', 'utf8')
const ROW = /\('([A-Z0-9&]+)',\s*'([^']+)',\s*'([A-Za-z]+)',\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g

const bySymbol = new Map()
for (const [, symbol, name, sector, pe, pb, dy] of sql.matchAll(ROW)) {
  // seed.sql contains genuine duplicates (SBI/STATEBANK/SBIN for the same
  // bank, and BAJAJFINSV reused for three different companies). First
  // spelling wins, matching what a UNIQUE(symbol) insert would keep.
  if (!bySymbol.has(symbol)) {
    bySymbol.set(symbol, { symbol, name, sector, pe, pb, dy })
  }
}

const rows = [...bySymbol.values()]
  .map(
    (s) =>
      `  { symbol: '${s.symbol}', name: '${s.name.replace(/'/g, "\\'")}', ` +
      `sector: '${s.sector}', peRatio: ${s.pe}, pbRatio: ${s.pb}, dividendYield: ${s.dy} },`
  )
  .join('\n')

const file = readFileSync('lib/market/stockUniverse.ts', 'utf8')
const updated = file.replace(
  /(export const STOCK_UNIVERSE: UniverseStock\[\] = \[\n)[\s\S]*?(\n\])/,
  `$1${rows}$2`
)
writeFileSync('lib/market/stockUniverse.ts', updated)
console.log(`Wrote ${rows.split('\n').length} stocks to lib/market/stockUniverse.ts`)
