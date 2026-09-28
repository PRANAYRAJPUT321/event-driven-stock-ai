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

// seed.sql predates this module being user-visible and carries three kinds of
// junk that only mattered once these rows started being rendered and linked to
// /stocks/[symbol], where a bad ticker is a 404 at Yahoo.

// Not NSE-listed. The US names are in an Indian-equity universe by accident;
// the other two are not real tickers for the companies they name.
const EXCLUDED = new Set(['MSFT', 'GOOGLE', 'APPLE', 'AMMWALE', 'AVENDIRAA'])

// Real NSE symbols for companies the seed spelled loosely. Applied before
// dedupe so the canonical symbol is the one that survives.
const SYMBOL_FIXES = {
  HDFC: 'HDFCBANK',
  SBI: 'SBIN',
  STATEBANK: 'SBIN',
  AXIS: 'AXISBANK',
  TATA: 'TATAMOTORS',
}

const bySymbol = new Map()
const byCompany = new Map()
for (const [, rawSymbol, name, sector, pe, pb, dy] of sql.matchAll(ROW)) {
  if (EXCLUDED.has(rawSymbol)) continue
  const symbol = SYMBOL_FIXES[rawSymbol] ?? rawSymbol
  // Two levels of dedupe: by symbol, matching what a UNIQUE(symbol) insert
  // would keep, and by company, because the seed lists State Bank of India
  // three times and Avenue Supermarts twice under different tickers — which
  // would otherwise score the same company twice in one analysis.
  if (bySymbol.has(symbol) || byCompany.has(name)) continue
  bySymbol.set(symbol, { symbol, name, sector, pe, pb, dy })
  byCompany.set(name, symbol)
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
