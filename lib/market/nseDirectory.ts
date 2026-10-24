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
import { findCompanies } from './companyMentions'

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

/** Words that start headlines without being company names. */
const GENERIC_SUBJECTS = new Set([
  'india', 'indian', 'sensex', 'nifty', 'markets', 'market', 'stock market', 'stocks', 'shares', 'rupee', 'gold',
  'silver', 'crude', 'oil', 'rbi', 'sebi', 'government', 'govt', 'centre', 'us', 'china', 'fed', 'fii', 'fiis',
  'fpi', 'fpis', 'live', 'breaking', 'stocks to watch', 'multibagger stock', 'top gainers', 'top losers',
  'q1', 'q2', 'q3', 'q4', 'earnings', 'results', 'budget', 'gst', 'ipo', 'bank', 'banks', 'it stocks',
  'update', 'new', 'top', 'why', 'how', 'what', 'watch', 'stock', 'opinion', 'video', 'explained', 'big', 'good',
  'great', 'news', 'report', 'analysis', 'exclusive', 'market recap', 'daily', 'weekly', 'green stocks', 'price action',
])

const SUBJECT_STOP =
  /\s(?:q[1-4]\w*|fy\d+|h[12]\b|shares?|share price|stocks?|posts?|reports?|reported|net profit|profits?|revenue|results?|earnings|announces?|declares?|bags?|wins?|won|secures?|gets?|receives?|to|says|plans?|launch\w*|signs?|raises?|cuts?|slides?|slumps?|jumps?|falls?|surges?|soars?|rises?|rose|hits?|sees?|board|ipo|orders?|arm|unit|parent|stake|sales|tanks?|plunges?|rallies|rally|gains?|drops?|declines?|crash\w*|surge|up|down|in|on|at|for|after|amid|as|vs)\b|['’]s\b|[,;:(|]/i

function phraseHit(phrase: string, allowPrefix: boolean): DirectoryEntry | null {
  const key = searchable(phrase)
  if (!key || GENERIC_SUBJECTS.has(key) || GENERIC_SUBJECTS.has(phrase.toLowerCase().trim())) return null
  const bySymbol = BY_SYMBOL.get(phrase.toUpperCase().replace(/\s+/g, ''))
  if (bySymbol && phrase.trim().length >= 3 && phrase === phrase.toUpperCase()) return bySymbol
  let best: DirectoryEntry | null = null
  // A prefix of a longer name is accepted only for specific phrases: "Union
  // Bank" for Union Bank of India, but never "Meta" for some Meta… Ltd.
  // Words may be abbreviated: "Alembic Pharma" is Alembic Pharmaceuticals.
  const prefixOk = allowPrefix && (key.includes(' ') || key.length >= 6)
  const keyWords = key.split(' ')
  for (const { row, name } of SEARCHABLE) {
    if (name === key) return row
    if (!prefixOk) continue
    const words = name.split(' ')
    const matches =
      words.length >= keyWords.length &&
      // Only the last of several words may be abbreviated; a single word must
      // be a whole word, so "Update" is never Updater Services.
      keyWords.every((w, i) =>
        i < keyWords.length - 1 || keyWords.length === 1 ? words[i] === w : words[i].startsWith(w) && w.length >= 4
      )
    if (matches && (!best || row.name.length < best.name.length)) best = row
  }
  return best
}

/**
 * Listed companies a headline is about, beyond the NIFTY 50 names the rule
 * engine already recognises: the headline's subject ("Union Bank of India Q2
 * net profit rises…", "Multibagger stock: PC Jeweller shares jump…"), plus any
 * capitalised name in it that is exactly a listed company ("SEBI continues
 * curbs on gold refiner Rajesh Exports"). Server-only, like the directory.
 */
export function findListedCompaniesIn(text: string, knownSymbols: string[] = []): DirectoryEntry[] {
  const found = new Map<string, DirectoryEntry>()
  for (const symbol of knownSymbols) {
    const row = BY_SYMBOL.get(symbol)
    if (row) found.set(row.symbol, row)
  }
  // "Zydus Lifesciences (NSE:ZYDUSLIFE) secures…" names its own ticker.
  for (const m of text.matchAll(/\bNSE:\s*([A-Z0-9&-]{2,20})\b/g)) {
    const row = BY_SYMBOL.get(m[1])
    if (row && !NIFTY_BY_SYMBOL.has(row.symbol)) found.set(row.symbol, row)
  }
  const clean = text.replace(/^\s*(live\s*\|?|breaking:?)\s*/i, '').replace(/^\s*india['’]s\s+/i, '')
  // The subject before the first verb or label, and the same after a colon
  // ("Multibagger stock: PC Jeweller shares jump").
  const segments = [clean, ...clean.split(':').slice(1, 2)]
  for (const segment of segments) {
    const subject = segment.trim().split(SUBJECT_STOP)[0].replace(/\b(ltd|limited)\.?$/i, '').trim()
    if (subject.length < 3 || subject.split(' ').length > 6) continue
    const hit = phraseHit(subject, true)
    if (hit && !NIFTY_BY_SYMBOL.has(hit.symbol)) found.set(hit.symbol, hit)
  }
  // Capitalised runs anywhere, matched exactly.
  for (const m of clean.matchAll(/\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)+)\b/g)) {
    const hit = phraseHit(m[1], false)
    if (hit && !NIFTY_BY_SYMBOL.has(hit.symbol)) found.set(hit.symbol, hit)
  }
  return Array.from(found.values()).slice(0, 4)
}

/**
 * The listed company a headline leads with, when it is outside the NIFTY 50:
 * "Avantel wins ₹20 crore order from L&T" is Avantel's news, though L&T is
 * the index name in it.
 */
export function listedSubjectOf(text: string): DirectoryEntry | null {
  const clean = text.replace(/^\s*(live\s*\|?|breaking:?)\s*/i, '').replace(/^\s*india['’]s\s+/i, '')
  const subject = clean.trim().split(SUBJECT_STOP)[0].replace(/\b(ltd|limited)\.?$/i, '').trim()
  if (subject.length < 3 || subject.split(' ').length > 6) return null
  // An index company's everyday name ("IndiGo") is that company, not a
  // listed namesake ("IndiGo Paints").
  if (findCompanies(subject).companies.length > 0) return null
  const hit = phraseHit(subject, true)
  return hit && !NIFTY_BY_SYMBOL.has(hit.symbol) ? hit : null
}
