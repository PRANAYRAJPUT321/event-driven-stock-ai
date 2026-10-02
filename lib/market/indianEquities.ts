/**
 * The NIFTY 50 constituents, with the symbols the NSE actually uses.
 *
 * This replaces the universe derived from database/seed.sql, which carried
 * Microsoft, Alphabet and Apple in an Indian-equity product, invented tickers
 * ("AMMWALE", "AVENDIRAA"), and listed State Bank of India three times. Those
 * were survivable while the rows only fed Postgres; they are not survivable
 * now that each row is scored, rendered, and resolved against Yahoo Finance as
 * `${symbol}.NS` — a wrong ticker is simply a 404.
 *
 * Sector labels are the ones the classification engine emits
 * (lib/ai/ruleClassifier.ts), so an event that names "Banking" resolves to
 * real banks here without a translation table.
 */

export interface EquityConstituent {
  /** NSE trading symbol. Append .NS for Yahoo. */
  symbol: string
  name: string
  sector: string
}

export const NIFTY_50: EquityConstituent[] = [
  // Banking & financial services
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Financials' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Financials' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance', sector: 'Financials' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'Financials' },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'Financials' },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', sector: 'Financials' },

  // Information technology
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT' },
  { symbol: 'LTIM', name: 'LTIMindtree', sector: 'IT' },

  // Energy & utilities
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corporation', sector: 'Energy' },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'Energy' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Energy' },
  { symbol: 'NTPC', name: 'NTPC', sector: 'Utilities' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation', sector: 'Utilities' },

  // Automobiles
  { symbol: 'MARUTI', name: 'Maruti Suzuki India', sector: 'Auto' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'Auto' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'Auto' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Auto' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'Auto' },

  // Consumer & retail
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG' },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG' },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer' },
  { symbol: 'TRENT', name: 'Trent', sector: 'Retail' },

  // Pharmaceuticals & healthcare
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma' },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories", sector: 'Pharma' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'Pharma' },

  // Metals & materials
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement' },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Chemicals' },

  // Industrials, telecom & infrastructure
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Engineering' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'Engineering' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Diversified' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'Ports' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
]

/** Sectors that actually have constituents, for filters and validation. */
export const EQUITY_SECTORS: string[] = Array.from(
  new Set(NIFTY_50.map((s) => s.sector))
).sort()

/**
 * The constituents that actually sit in the given sectors.
 *
 * This used to fall back to the first `limit` names of the index whenever the
 * sector list was empty or matched nothing — which meant a crude-oil event,
 * whose affected sectors are Aviation and Energy, came back as six banks, and
 * those banks were then shown with the event's impact attached to them. An
 * empty answer is the correct one: the caller can say that no constituent is
 * exposed, which is true, instead of naming companies that are not.
 */
export function equitiesForSectors(sectors: string[], limit: number): EquityConstituent[] {
  if (sectors.length === 0) return []
  return NIFTY_50.filter((s) => sectors.includes(s.sector)).slice(0, limit)
}

/** Affected sectors that no constituent of this universe belongs to. */
export function sectorsWithoutConstituents(sectors: string[]): string[] {
  return sectors.filter((sector) => !NIFTY_50.some((s) => s.sector === sector))
}

export function findEquity(symbol: string): EquityConstituent | undefined {
  const upper = symbol.toUpperCase()
  return NIFTY_50.find((s) => s.symbol === upper)
}
