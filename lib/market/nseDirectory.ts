/**
 * Every equity listed on the NSE, for search and for providers that key
 * instruments by ISIN.
 *
 * Source: nsearchives.nseindia.com/content/equities/EQUITY_L.csv, recorded in
 * lib/market/data/nse-equities.json (about 2,600 companies). Server-only: the
 * file is ~150 KB, which is fine inside a function and wasteful in a page
 * bundle. Clients reach it through /api/search.
 */
import directory from './data/nse-equities.json'
import { NIFTY_50, RENAMED_SYMBOLS, type EquityConstituent } from './indianEquities'

export interface DirectoryEntry {
  symbol: string
  name: string
  isin: string
}

export interface SearchHit extends DirectoryEntry {
  /** Set for NIFTY 50 constituents, which the analysis engine can score. */
  sector: string | null
  inNifty50: boolean
  /** Present when the query matched an old symbol that now trades as this one. */
  renamedFrom?: string
}

const ROWS: DirectoryEntry[] = (directory.rows as [string, string, string][]).map(([symbol, name, isin]) => ({
  symbol,
  name: tidyName(name),
  isin,
}))
const BY_SYMBOL = new Map(ROWS.map((r) => [r.symbol, r]))
const NIFTY_BY_SYMBOL = new Map<string, EquityConstituent>(NIFTY_50.map((c) => [c.symbol, c]))

export const DIRECTORY_AS_OF: string = directory.asOf
export const DIRECTORY_SIZE = ROWS.length

/** "RELIANCE INDUSTRIES LIMITED" and "Reliance Industries Ltd" read the same. */
function tidyName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim()
  // A handful of rows are entirely upper case; title-case those so search
  // results do not shout. Mixed-case names are left exactly as filed.
  if (cleaned === cleaned.toUpperCase() && /[A-Z]{4}/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\b(Ltd|Limited)\b/gi, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase())
  }
  return cleaned
}

/** Strips the words every listed company shares, so they do not dominate matching. */
function searchable(name: string): string {
  return name.toLowerCase().replace(/\b(limited|ltd|the|india|of|and|&)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
const SEARCHABLE = ROWS.map((r) => ({ row: r, name: searchable(r.name), full: r.name.toLowerCase() }))

export function lookupEquity(symbol: string): DirectoryEntry | null {
  return BY_SYMBOL.get(symbol.toUpperCase().trim()) ?? null
}

/** ISIN for a symbol: the NIFTY list first (it is the curated one), then the directory. */
export function isinFor(symbol: string): string | null {
  const upper = symbol.toUpperCase()
  return NIFTY_BY_SYMBOL.get(upper)?.isin ?? BY_SYMBOL.get(upper)?.isin ?? null
}

function toHit(row: DirectoryEntry, renamedFrom?: string): SearchHit {
  const constituent = NIFTY_BY_SYMBOL.get(row.symbol)
  return {
    ...row,
    sector: constituent?.sector ?? null,
    inNifty50: !!constituent,
    ...(renamedFrom ? { renamedFrom } : {}),
  }
}

/**
 * Ranked search over symbol and company name.
 *
 * Order of preference: an exact symbol, then a symbol that starts with the
 * query, then a company whose name starts with it, then any word of the name
 * that does, then a plain substring. NIFTY 50 members get a small lift at
 * each level, because those are the companies the rest of the app can score
 * — someone typing "tata" most likely wants Tata Motors or TCS, not one of
 * the dozen smaller Tata-named listings.
 */
export function searchDirectory(query: string, limit = 10): SearchHit[] {
  const raw = query.trim()
  if (!raw) return []
  const upper = raw.toUpperCase().replace(/\s+/g, '')
  const lower = raw.toLowerCase()
  const lowerWords = searchable(raw)

  const scored: { hit: SearchHit; score: number }[] = []

  const renamed = RENAMED_SYMBOLS[upper]
  if (renamed) {
    const target = BY_SYMBOL.get(renamed.to)
    if (target) scored.push({ hit: toHit(target, upper), score: 2000 })
  }

  for (const { row, name, full } of SEARCHABLE) {
    let score = 0
    if (row.symbol === upper) score = 1000
    else if (row.symbol.startsWith(upper)) score = 800 - (row.symbol.length - upper.length) * 2
    else if (lowerWords && name.startsWith(lowerWords)) score = 780
    else if (full.startsWith(lower)) score = 770
    else if (lowerWords && (` ${name}`).includes(` ${lowerWords}`)) score = 650
    else if (lowerWords.length >= 3 && name.includes(lowerWords)) score = 400
    else if (upper.length >= 3 && row.symbol.includes(upper)) score = 350
    if (score === 0) continue
    if (NIFTY_BY_SYMBOL.has(row.symbol)) score += 100
    scored.push({ hit: toHit(row), score })
  }

  scored.sort((a, b) => b.score - a.score || a.hit.symbol.localeCompare(b.hit.symbol))
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const { hit } of scored) {
    if (seen.has(hit.symbol)) continue
    seen.add(hit.symbol)
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}
