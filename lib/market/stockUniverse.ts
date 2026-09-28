/**
 * The scored stock universe, as code.
 *
 * These are the same rows database/seed.sql inserts into the `stocks` table.
 * They live here as well so the analysis engine has a universe to score
 * against when Postgres cannot be read — a paused Supabase project should not
 * be able to stop an event from being analysed, because nothing about the
 * analysis actually needs a database: classification is deterministic
 * (lib/ai/ruleClassifier.ts) and the per-stock metrics are seeded by symbol
 * (lib/market/mockData.ts).
 *
 * The database remains the source of truth when it is reachable: /api/analyze
 * queries it first and only falls back to this list. Regenerate with
 * scripts/generate-stock-universe.mjs if seed.sql changes.
 */

export interface UniverseStock {
  /** No `id` — rows here are not database rows and have no foreign key. */
  symbol: string
  name: string
  sector: string
  peRatio: number
  pbRatio: number
  dividendYield: number
}

export const STOCK_UNIVERSE: UniverseStock[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', peRatio: 24.5, pbRatio: 1.8, dividendYield: 0.8 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', peRatio: 22.1, pbRatio: 3.2, dividendYield: 1.2 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', peRatio: 19.8, pbRatio: 2.9, dividendYield: 1.5 },
  { symbol: 'HDFC', name: 'HDFC Bank', sector: 'Banking', peRatio: 21.3, pbRatio: 1.6, dividendYield: 1.1 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', peRatio: 20.5, pbRatio: 1.5, dividendYield: 1.0 },
  { symbol: 'SBI', name: 'State Bank of India', sector: 'Banking', peRatio: 18.2, pbRatio: 0.9, dividendYield: 1.8 },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Engineering', peRatio: 23.4, pbRatio: 1.7, dividendYield: 0.9 },
  { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG', peRatio: 25.6, pbRatio: 2.1, dividendYield: 4.2 },
  { symbol: 'AXIS', name: 'Axis Bank', sector: 'Banking', peRatio: 20.1, pbRatio: 1.4, dividendYield: 1.0 },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', peRatio: 18.5, pbRatio: 2.5, dividendYield: 1.3 },
  { symbol: 'ONGC', name: 'Oil and Natural Gas Corp', sector: 'Energy', peRatio: 8.2, pbRatio: 0.5, dividendYield: 3.5 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto', peRatio: 19.3, pbRatio: 1.9, dividendYield: 1.1 },
  { symbol: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma', peRatio: 22.8, pbRatio: 2.6, dividendYield: 0.8 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Financials', peRatio: 24.2, pbRatio: 3.1, dividendYield: 0.5 },
  { symbol: 'POWERGRID', name: 'Power Grid', sector: 'Utilities', peRatio: 22.5, pbRatio: 1.4, dividendYield: 4.1 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', peRatio: 21.9, pbRatio: 2.3, dividendYield: 1.2 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer', peRatio: 30.5, pbRatio: 3.5, dividendYield: 0.6 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', peRatio: 17.2, pbRatio: 2.1, dividendYield: 1.4 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', peRatio: 45.2, pbRatio: 2.8, dividendYield: 1.6 },
  { symbol: 'NESTLEIND', name: 'Nestlé India', sector: 'FMCG', peRatio: 35.8, pbRatio: 6.2, dividendYield: 1.8 },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', peRatio: 16.5, pbRatio: 1.8, dividendYield: 1.2 },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Energy', peRatio: 9.1, pbRatio: 0.7, dividendYield: 4.5 },
  { symbol: 'M&MFIN', name: 'Mahindra & Mahindra Fin', sector: 'Financials', peRatio: 14.2, pbRatio: 1.2, dividendYield: 1.5 },
  { symbol: 'UPL', name: 'UPL Limited', sector: 'Chemicals', peRatio: 20.3, pbRatio: 1.6, dividendYield: 0.9 },
  { symbol: 'LTTS', name: 'L&T Technology Services', sector: 'IT', peRatio: 26.4, pbRatio: 2.2, dividendYield: 0.7 },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries', sector: 'FMCG', peRatio: 32.1, pbRatio: 3.8, dividendYield: 0.8 },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Diversified', peRatio: 21.5, pbRatio: 1.9, dividendYield: 1.0 },
  { symbol: 'STATEBANK', name: 'State Bank of India', sector: 'Banking', peRatio: 18.2, pbRatio: 0.9, dividendYield: 1.8 },
  { symbol: 'INDIGO', name: 'InterGlobe Aviation', sector: 'Aviation', peRatio: 35.2, pbRatio: 1.2, dividendYield: 0.0 },
  { symbol: 'ADANIGREEN', name: 'Adani Green Energy', sector: 'Energy', peRatio: 45.3, pbRatio: 1.1, dividendYield: 0.0 },
  { symbol: 'ADANIPORTS', name: 'Adani Ports and SEZ', sector: 'Ports', peRatio: 12.5, pbRatio: 0.8, dividendYield: 2.5 },
  { symbol: 'NTPC', name: 'NTPC Limited', sector: 'Energy', peRatio: 11.8, pbRatio: 0.9, dividendYield: 5.2 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals', peRatio: 13.2, pbRatio: 0.9, dividendYield: 2.1 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals', peRatio: 9.5, pbRatio: 0.8, dividendYield: 1.8 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', peRatio: 18.2, pbRatio: 0.9, dividendYield: 1.8 },
  { symbol: 'SHREECEM', name: 'Shree Cement', sector: 'Cement', peRatio: 25.3, pbRatio: 1.6, dividendYield: 0.9 },
  { symbol: 'DMART', name: 'Avenue Supermarts', sector: 'Retail', peRatio: 38.5, pbRatio: 2.8, dividendYield: 0.5 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG', peRatio: 42.2, pbRatio: 3.6, dividendYield: 0.5 },
  { symbol: 'SIEMENS', name: 'Siemens', sector: 'Engineering', peRatio: 28.3, pbRatio: 2.4, dividendYield: 1.3 },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'Energy', peRatio: 7.8, pbRatio: 0.5, dividendYield: 4.2 },
  { symbol: 'IDFCFIRST', name: 'IDFC First Bank', sector: 'Banking', peRatio: 22.5, pbRatio: 1.1, dividendYield: 0.0 },
  { symbol: 'AMMWALE', name: 'Amara Raja Batteries', sector: 'Auto', peRatio: 24.1, pbRatio: 1.8, dividendYield: 0.6 },
  { symbol: 'AVENDIRAA', name: 'Avenue Supermarts', sector: 'Retail', peRatio: 38.5, pbRatio: 2.8, dividendYield: 0.5 },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'IT', peRatio: 32.1, pbRatio: 10.5, dividendYield: 0.7 },
  { symbol: 'GOOGLE', name: 'Alphabet', sector: 'IT', peRatio: 25.3, pbRatio: 5.2, dividendYield: 0.0 },
  { symbol: 'APPLE', name: 'Apple', sector: 'Consumer', peRatio: 28.5, pbRatio: 35.2, dividendYield: 0.4 },
  { symbol: 'TATA', name: 'Tata Motors', sector: 'Auto', peRatio: 4.2, pbRatio: 0.3, dividendYield: 0.0 },
]

/** Sectors that actually have listed companies to score. */
export const UNIVERSE_SECTORS: string[] = Array.from(
  new Set(STOCK_UNIVERSE.map((s) => s.sector))
).sort()

export function stocksForSectors(sectors: string[], limit: number): UniverseStock[] {
  if (sectors.length === 0) return STOCK_UNIVERSE.slice(0, limit)
  const matched = STOCK_UNIVERSE.filter((s) => sectors.includes(s.sector))
  // Never return an empty set: a sector with no listed names would otherwise
  // produce an analysis with nothing in it.
  return (matched.length > 0 ? matched : STOCK_UNIVERSE).slice(0, limit)
}
