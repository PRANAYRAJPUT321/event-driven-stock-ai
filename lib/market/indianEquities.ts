/**
 * The NIFTY 50 constituents, as NSE publishes them.
 *
 * Source: nsearchives.nseindia.com/content/indices/ind_nifty50list.csv,
 * recorded in lib/market/data/nifty50.json. The index is rebalanced twice a
 * year and companies demerge and rename, so this list is dated: the 2025 list
 * it replaces still carried TATAMOTORS (now TMPV after the demerger), LTIM
 * (no longer listed under that symbol), and five names that had since left
 * the index. A stale ticker is not a cosmetic problem here — it is a tile that
 * never fills and a company the analysis engine silently cannot score.
 *
 * Sector labels are the ones the classification engine emits
 * (lib/ai/ruleClassifier.ts), so an event that names "Banking" resolves to
 * real banks without a translation table. `industry` is NSE's own label and
 * is what the UI shows alongside it.
 *
 * Imported by client components, so it stays small: the full NSE directory
 * lives in lib/market/nseDirectory.ts, which is server-only.
 */

export interface EquityConstituent {
  /** NSE trading symbol. */
  symbol: string
  name: string
  /** The classification engine's sector vocabulary. */
  sector: string
  /** NSE's industry label for the company. */
  industry?: string
  /** Needed by providers that key instruments by ISIN (Upstox). */
  isin?: string
}

/** When the constituent list was last taken from NSE. */
export const NIFTY_50_AS_OF = '2026-10-09'

export const NIFTY_50: EquityConstituent[] = [
  // Banking
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', industry: 'Financial Services', isin: 'INE040A01034' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', industry: 'Financial Services', isin: 'INE090A01021' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', industry: 'Financial Services', isin: 'INE062A01020' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', industry: 'Financial Services', isin: 'INE237A01036' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking', industry: 'Financial Services', isin: 'INE238A01034' },

  // Financial services
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Financials', industry: 'Financial Services', isin: 'INE296A01032' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Financials', industry: 'Financial Services', isin: 'INE918I01026' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance', sector: 'Financials', industry: 'Financial Services', isin: 'INE123W01016' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'Financials', industry: 'Financial Services', isin: 'INE795G01014' },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'Financials', industry: 'Financial Services', isin: 'INE721A01047' },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', sector: 'Financials', industry: 'Financial Services', isin: 'INE758E01017' },
  { symbol: 'BSE', name: 'BSE', sector: 'Financials', industry: 'Financial Services', isin: 'INE118H01025' },

  // Information technology
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', industry: 'Information Technology', isin: 'INE467B01029' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', industry: 'Information Technology', isin: 'INE009A01021' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', industry: 'Information Technology', isin: 'INE860A01027' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', industry: 'Information Technology', isin: 'INE669C01036' },

  // Energy & utilities
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', industry: 'Oil Gas & Consumable Fuels', isin: 'INE002A01018' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corporation', sector: 'Energy', industry: 'Oil Gas & Consumable Fuels', isin: 'INE213A01029' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Energy', industry: 'Oil Gas & Consumable Fuels', isin: 'INE522F01014' },
  { symbol: 'NTPC', name: 'NTPC', sector: 'Utilities', industry: 'Power', isin: 'INE733E01010' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation', sector: 'Utilities', industry: 'Power', isin: 'INE752E01010' },

  // Automobiles
  { symbol: 'MARUTI', name: 'Maruti Suzuki India', sector: 'Auto', industry: 'Automobile and Auto Components', isin: 'INE585B01010' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'Auto', industry: 'Automobile and Auto Components', isin: 'INE101A01026' },
  { symbol: 'TMPV', name: 'Tata Motors Passenger Vehicles', sector: 'Auto', industry: 'Automobile and Auto Components', isin: 'INE155A01022' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'Auto', industry: 'Automobile and Auto Components', isin: 'INE917I01010' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Auto', industry: 'Automobile and Auto Components', isin: 'INE066A01021' },

  // Consumer
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', industry: 'Fast Moving Consumer Goods', isin: 'INE030A01027' },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', industry: 'Fast Moving Consumer Goods', isin: 'INE154A01025' },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG', industry: 'Fast Moving Consumer Goods', isin: 'INE239A01024' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG', industry: 'Fast Moving Consumer Goods', isin: 'INE192A01025' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer', industry: 'Consumer Durables', isin: 'INE021A01026' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', industry: 'Consumer Durables', isin: 'INE280A01028' },
  { symbol: 'TRENT', name: 'Trent', sector: 'Retail', industry: 'Consumer Services', isin: 'INE849A01020' },
  { symbol: 'ETERNAL', name: 'Eternal (Zomato)', sector: 'Retail', industry: 'Consumer Services', isin: 'INE758T01015' },

  // Pharmaceuticals & healthcare
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma', industry: 'Healthcare', isin: 'INE044A01036' },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma', industry: 'Healthcare', isin: 'INE059A01026' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories", sector: 'Pharma', industry: 'Healthcare', isin: 'INE089A01031' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'Pharma', industry: 'Healthcare', isin: 'INE437A01024' },
  { symbol: 'MAXHEALTH', name: 'Max Healthcare', sector: 'Pharma', industry: 'Healthcare', isin: 'INE027H01010' },

  // Metals & materials
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', industry: 'Metals & Mining', isin: 'INE081A01020' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals', industry: 'Metals & Mining', isin: 'INE019A01038' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals', industry: 'Metals & Mining', isin: 'INE038A01020' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement', industry: 'Construction Materials', isin: 'INE481G01011' },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Chemicals', industry: 'Construction Materials', isin: 'INE047A01021' },

  // Industrials, telecom, transport & infrastructure
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Engineering', industry: 'Construction', isin: 'INE018A01030' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'Defence', industry: 'Capital Goods', isin: 'INE263A01024' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Diversified', industry: 'Metals & Mining', isin: 'INE423A01024' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'Ports', industry: 'Services', isin: 'INE742F01042' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', industry: 'Telecommunication', isin: 'INE397D01024' },
  { symbol: 'INDIGO', name: 'InterGlobe Aviation (IndiGo)', sector: 'Aviation', industry: 'Services', isin: 'INE646L01027' },
]

/**
 * Symbols that existed when earlier analyses were saved but no longer trade
 * under that name. Links from old history rows resolve through this instead
 * of landing on an empty page.
 */
export const RENAMED_SYMBOLS: Record<string, { to: string; note: string }> = {
  TATAMOTORS: { to: 'TMPV', note: 'Tata Motors demerged in 2025; the passenger-vehicle business trades as TMPV and the commercial-vehicle business as TMCV.' },
  ZOMATO: { to: 'ETERNAL', note: 'Zomato Ltd renamed itself Eternal Ltd in 2025.' },
}

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
  // Round-robin across the sectors, in the order the classifier ranked them,
  // largest company first within each. Taking constituents in index-list
  // order instead let the earlier sectors fill every slot: a crude-oil shock
  // led with Aviation and still scored no airline, because Energy and Auto
  // came first in the list and six names were enough to crowd it out.
  const queues = sectors.map((sector) => NIFTY_50.filter((s) => s.sector === sector))
  const picked: EquityConstituent[] = []
  for (let round = 0; picked.length < limit; round++) {
    let added = false
    for (const queue of queues) {
      if (round < queue.length && picked.length < limit) {
        picked.push(queue[round])
        added = true
      }
    }
    if (!added) break
  }
  return picked
}

/** Affected sectors that no constituent of this universe belongs to. */
export function sectorsWithoutConstituents(sectors: string[]): string[] {
  return sectors.filter((sector) => !NIFTY_50.some((s) => s.sector === sector))
}

export function findEquity(symbol: string): EquityConstituent | undefined {
  const upper = symbol.toUpperCase()
  return NIFTY_50.find((s) => s.symbol === upper)
}
