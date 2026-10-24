import { NIFTY_50, type EquityConstituent } from './indianEquities'

/**
 * Which listed companies a piece of text is about.
 *
 * The analysis used to read only sector words, so "Reliance announces a bonus
 * issue" scored Adani Enterprises (the catch-all "Diversified" sector) and
 * "TCS announces a buyback" put Infosys at the top with TCS's own event read.
 * A company event is about that company; this is how the engine knows which
 * one.
 *
 * Names are matched longest first and each match consumes its span, so "Tech
 * Mahindra" is not also read as Mahindra & Mahindra and "SBI Life" not also as
 * State Bank of India.
 */

/** Everyday names for each NIFTY 50 company, lower case. */
const ALIASES: Record<string, string[]> = {
  HDFCBANK: ['hdfc bank', 'hdfcbank'],
  ICICIBANK: ['icici bank', 'icicibank', 'icici'],
  SBIN: ['state bank of india', 'state bank', 'sbi', 'sbin'],
  KOTAKBANK: ['kotak mahindra bank', 'kotak bank', 'kotak'],
  AXISBANK: ['axis bank', 'axisbank'],
  BAJFINANCE: ['bajaj finance', 'bajfinance'],
  BAJAJFINSV: ['bajaj finserv', 'bajajfinsv'],
  SBILIFE: ['sbi life insurance', 'sbi life', 'sbilife'],
  HDFCLIFE: ['hdfc life insurance', 'hdfc life', 'hdfclife'],
  SHRIRAMFIN: ['shriram finance', 'shriramfin'],
  JIOFIN: ['jio financial services', 'jio financial', 'jio finance', 'jiofin'],
  BSE: ['bse ltd', 'bse limited', 'bse shares', 'bse stock', 'bse share price', 'f&o', 'futures and options'],
  TCS: ['tata consultancy services', 'tata consultancy', 'tcs'],
  INFY: ['infosys', 'infy'],
  HCLTECH: ['hcl technologies', 'hcl tech', 'hcltech', 'hcl'],
  TECHM: ['tech mahindra', 'techm'],
  RELIANCE: ['reliance industries', 'reliance jio', 'jio platforms', 'reliance retail', 'reliance', 'ril', 'mukesh ambani', 'jio'],
  ONGC: ['oil and natural gas corporation', 'oil & natural gas', 'ongc'],
  COALINDIA: ['coal india', 'coalindia'],
  NTPC: ['ntpc'],
  POWERGRID: ['power grid corporation', 'powergrid', 'power grid corp'],
  MARUTI: ['maruti suzuki', 'maruti'],
  'M&M': ['mahindra & mahindra', 'mahindra and mahindra', 'm&m', 'mahindra'],
  TMPV: ['tata motors', 'tmpv', 'jaguar land rover', 'jlr'],
  'BAJAJ-AUTO': ['bajaj auto', 'bajaj-auto'],
  EICHERMOT: ['eicher motors', 'eichermot', 'eicher', 'royal enfield'],
  HINDUNILVR: ['hindustan unilever', 'hindunilvr', 'hul'],
  ITC: ['itc'],
  NESTLEIND: ['nestle india', 'nestleind', 'nestle'],
  TATACONSUM: ['tata consumer products', 'tata consumer', 'tataconsum'],
  ASIANPAINT: ['asian paints', 'asianpaint'],
  TITAN: ['titan company', 'titan', 'tanishq'],
  TRENT: ['trent', 'zudio', 'westside'],
  ETERNAL: ['eternal ltd', 'eternal', 'zomato', 'blinkit'],
  SUNPHARMA: ['sun pharmaceutical', 'sun pharma', 'sunpharma'],
  CIPLA: ['cipla'],
  DRREDDY: ["dr. reddy's", "dr reddy's", 'dr reddys', 'dr. reddy', 'dr reddy', 'drreddy'],
  APOLLOHOSP: ['apollo hospitals', 'apollo hospital', 'apollohosp'],
  MAXHEALTH: ['max healthcare', 'maxhealth'],
  TATASTEEL: ['tata steel', 'tatasteel'],
  JSWSTEEL: ['jsw steel', 'jswsteel'],
  HINDALCO: ['hindalco', 'novelis'],
  ULTRACEMCO: ['ultratech cement', 'ultratech', 'ultracemco'],
  GRASIM: ['grasim'],
  LT: ['larsen & toubro', 'larsen and toubro', 'larsen', 'l&t'],
  BEL: ['bharat electronics', 'bel'],
  ADANIENT: ['adani enterprises', 'adanient'],
  ADANIPORTS: ['adani ports', 'adaniports', 'apsez'],
  BHARTIARTL: ['bharti airtel', 'bhartiartl', 'airtel'],
  INDIGO: ['interglobe aviation', 'interglobe', 'indigo'],
}

/** Names that mean several constituents at once. */
const GROUPS: Record<string, string[]> = {
  'adani group': ['ADANIENT', 'ADANIPORTS'],
  'adani stocks': ['ADANIENT', 'ADANIPORTS'],
  'adani shares': ['ADANIENT', 'ADANIPORTS'],
  'gautam adani': ['ADANIENT', 'ADANIPORTS'],
  adani: ['ADANIENT', 'ADANIPORTS'],
}

/**
 * Listed companies outside the NIFTY 50 that share a word with one inside it,
 * or that people commonly ask about. Matched first so "Reliance Power" is not
 * read as Reliance Industries, and reported so the answer can say the company
 * is outside the universe PULSE scores instead of ignoring it.
 */
const OUTSIDE: Record<string, string> = {
  'reliance power': 'RPOWER', 'reliance infrastructure': 'RELINFRA', 'reliance infra': 'RELINFRA',
  'reliance capital': 'RELCAPITAL', 'reliance communications': 'RCOM', 'adani power': 'ADANIPOWER',
  'adani green': 'ADANIGREEN', 'adani total gas': 'ATGL', 'adani energy': 'ADANIENSOL', 'adani wilmar': 'AWL',
  'tata power': 'TATAPOWER', 'tata chemicals': 'TATACHEM', 'tata elxsi': 'TATAELXSI', 'tata communications': 'TATACOMM',
  'tata technologies': 'TATATECH', 'tata motors commercial': 'TMCV', 'tata motors cv': 'TMCV', 'bajaj housing finance': 'BAJAJHFL',
  'bajaj electricals': 'BAJAJELEC', 'hdfc amc': 'HDFCAMC', 'icici prudential': 'ICICIPRULI', 'icici lombard': 'ICICIGI',
  'sbi card': 'SBICARD', 'sbi cards': 'SBICARD', 'jsw energy': 'JSWENERGY', 'jsw infrastructure': 'JSWINFRA',
  'mahindra finance': 'M&MFIN', 'apollo tyres': 'APOLLOTYRE', 'max financial': 'MFSL', 'hindustan aeronautics': 'HAL',
  hal: 'HAL', 'hindustan zinc': 'HINDZINC', 'hindustan copper': 'HINDCOPPER', wipro: 'WIPRO', 'hero motocorp': 'HEROMOTOCO',
  britannia: 'BRITANNIA', 'indusind bank': 'INDUSINDBK', 'bank of baroda': 'BANKBARODA', 'punjab national bank': 'PNB', pnb: 'PNB',
  'canara bank': 'CANBK', 'yes bank': 'YESBANK', 'idfc first': 'IDFCFIRSTB', lic: 'LICI', 'life insurance corporation': 'LICI',
  irctc: 'IRCTC', paytm: 'PAYTM', nykaa: 'NYKAA', swiggy: 'SWIGGY', 'ola electric': 'OLAELEC', vedanta: 'VEDL', bpcl: 'BPCL',
  'indian oil': 'IOC', hpcl: 'HINDPETRO', gail: 'GAIL', 'vodafone idea': 'IDEA', suzlon: 'SUZLON', ireda: 'IREDA', rvnl: 'RVNL',
  irfc: 'IRFC', bhel: 'BHEL', sail: 'SAIL', nmdc: 'NMDC', dlf: 'DLF', 'divis': 'DIVISLAB', "divi's": 'DIVISLAB', lupin: 'LUPIN',
  'tvs motor': 'TVSMOTOR', 'ashok leyland': 'ASHOKLEY', 'avenue supermarts': 'DMART', dmart: 'DMART', 'info edge': 'NAUKRI',
  'muthoot finance': 'MUTHOOTFIN', 'shree cement': 'SHREECEM', ambuja: 'AMBUJACEM', 'pidilite': 'PIDILITIND', dabur: 'DABUR',
  'godrej consumer': 'GODREJCP', havells: 'HAVELLS', siemens: 'SIEMENS', polycab: 'POLYCAB', dixon: 'DIXON', biocon: 'BIOCON',
}

interface Pattern {
  phrase: string
  symbols: string[]
  outside?: string
}

const PATTERNS: (Pattern & { re: RegExp })[] = ([
  ...Object.entries(ALIASES).flatMap(([symbol, names]) => names.map((phrase) => ({ phrase, symbols: [symbol] }))),
  ...Object.entries(GROUPS).map(([phrase, symbols]) => ({ phrase, symbols })),
  ...Object.entries(OUTSIDE).map(([phrase, symbol]) => ({ phrase, symbols: [] as string[], outside: symbol })),
  ] as Pattern[])
  // Longest first: the specific name wins over any shorter one inside it.
  .sort((a, b) => b.phrase.length - a.phrase.length)
  .map((p) => ({ ...p, re: new RegExp(`(^|[^a-z0-9&])${escape(p.phrase)}(?:'s|s)?(?=$|[^a-z0-9&])`, 'g') }))

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CompanyMentions {
  /** NIFTY 50 constituents named in the text, in the order they appear. */
  companies: EquityConstituent[]
  /** NSE symbols of companies named in the text that are not in the NIFTY 50. */
  outside: { symbol: string; phrase: string }[]
}

export function findCompanies(text: string): CompanyMentions {
  // Curly apostrophes and full stops inside names ("Dr. Reddy’s") normalised
  // so one spelling of each alias is enough.
  let rest = ` ${text.toLowerCase().replace(/[’‘]/g, "'")} `
  const found: { at: number; symbols: string[] }[] = []
  const outside: { at: number; symbol: string; phrase: string }[] = []
  for (const p of PATTERNS) {
    p.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.re.exec(rest))) {
      const at = m.index + m[1].length
      if (p.outside) outside.push({ at, symbol: p.outside, phrase: p.phrase })
      else found.push({ at, symbols: p.symbols })
      // Blank the span so shorter names inside it do not match again.
      rest = rest.slice(0, at) + ' '.repeat(m[0].length - m[1].length) + rest.slice(at + m[0].length - m[1].length)
      p.re.lastIndex = at + 1
    }
  }
  const order = found.sort((a, b) => a.at - b.at).flatMap((f) => f.symbols)
  const symbols = Array.from(new Set(order))
  return {
    companies: symbols.map((s) => NIFTY_50.find((c) => c.symbol === s)).filter((c): c is EquityConstituent => !!c),
    outside: Array.from(new Map(outside.sort((a, b) => a.at - b.at).map((o) => [o.symbol, { symbol: o.symbol, phrase: o.phrase }])).values()),
  }
}
