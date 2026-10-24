import type {
  DecisionInput,
  DecisionOutput,
  EventClassification,
  NewsCategorization,
} from './eventClassifier'
import { findCompanies } from '../market/companyMentions'
import type { EquityConstituent } from '../market/indianEquities'

/**
 * Deterministic, offline event classifier.
 *
 * This exists because the LLM path is a single point of failure the app kept
 * dying on: an expired key or an empty credit balance took down Analyze AND
 * Discover at once, and a user has no way to tell that apart from a bug. The
 * rules here never rate-limit, never run out of credit, cost nothing and
 * answer in microseconds, so eventClassifier.ts can fall back to them on any
 * LLM failure and the product keeps working with no keys configured at all.
 *
 * It is not a replacement for the model's nuance — it is the floor. Every
 * mapping below is a standard, textbook transmission channel (policy rate to
 * lenders and rate-sensitive demand, crude to importers, rupee to exporters),
 * not a market view, and the confidence it reports is deliberately lower than
 * the model's so the UI can be honest about which produced an answer.
 *
 * Two rules matter more than any table entry:
 *   - the direction comes from what the text says, in any tense ("crashed",
 *     "plunges", "has risen"), and a negated move ("does not cut") is not a
 *     move; and
 *   - when the text does not say which way something moved, no direction is
 *     invented. "Crude oil crashed by 25%" used to miss the word "crashed",
 *     fall back to the crude-SPIKE read and recommend ONGC.
 */

type Sector =
  | 'Banking' | 'IT' | 'Energy' | 'Auto' | 'FMCG' | 'Pharma' | 'Financials'
  | 'Metals' | 'Telecom' | 'Utilities' | 'Engineering' | 'Defence' | 'Cement'
  | 'Chemicals' | 'Consumer' | 'Retail' | 'Diversified' | 'Aviation' | 'Ports'

export type Polarity = 'up' | 'down' | 'neutral'

/**
 * macro: a market-wide channel that reaches whole sectors.
 * company: news about particular companies, which reaches those companies
 * and not their peers.
 * mixed: company-scoped when it names a company (a USFDA warning letter to
 * Sun Pharma), macro otherwise (new SEBI rules for every broker).
 */
export type ThemeScope = 'macro' | 'company' | 'mixed'

interface Theme {
  id: string
  /** How the channel is named in prose. */
  label: string
  eventType: string
  economicVariable: string
  /** Matched case-insensitively against the whole text, plurals included. */
  keywords: string[]
  /** Count half: words that point at the channel but also mean other things. */
  weakKeywords?: string[]
  /** Base magnitude before intensity/number boosts. */
  baseMagnitude: number
  scope: ThemeScope
  /** Text where this channel would be the wrong reading despite a keyword. */
  excludeIf?: (text: string) => boolean
  /**
   * For channels whose direction is not said with "rises"/"falls" — a
   * monsoon forecast is "at 105% of the long-period average", a war "breaks
   * out" — the theme reads it itself. null falls back to the generic words.
   */
  polarity?: (text: string) => Polarity | null
  /** Whether "neutral" is a real state of this channel (rates held) rather than "not said". */
  hasNeutral?: boolean
  /**
   * The constituents this channel actually reaches, when that is narrower
   * than their sector: gold reaches a jeweller, not every consumer company.
   */
  focus?: string[]
  /**
   * Given the direction the underlying variable moved, the market read.
   * `sectors` are the ones whose earnings this channel actually touches.
   */
  resolve: (polarity: Polarity, text: string) => {
    direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
    sectors: Sector[]
    mechanism: string
  }
}

// ── Movement words, in every tense ──────────────────────────────────────

/** "drop" → drop, drops, dropped, dropping; "rally" → rallies, rallied… */
function inflect(phrase: string): string[] {
  const [head, ...tail] = phrase.split(' ')
  const rest = tail.length ? ' ' + tail.join(' ') : ''
  const forms = new Set<string>([head])
  if (/[^aeiou]y$/.test(head)) {
    const stem = head.slice(0, -1)
    forms.add(stem + 'ies').add(stem + 'ied').add(head + 'ing')
  } else if (head.endsWith('e')) {
    forms.add(head + 's').add(head + 'd').add(head.slice(0, -1) + 'ing')
  } else {
    forms.add(head + (/(s|sh|ch|x|z)$/.test(head) ? 'es' : 's')).add(head + 'ed').add(head + 'ing')
    if (/[^aeiou][aeiou][bdgmnprt]$/.test(head)) {
      const last = head.slice(-1)
      forms.add(head + last + 'ed').add(head + last + 'ing')
    }
  }
  return Array.from(forms).map((f) => f + rest)
}

const UP_VERBS = [
  'hike', 'raise', 'increase', 'rise', 'surge', 'jump', 'climb', 'gain', 'rally', 'spike', 'soar',
  'accelerate', 'beat', 'expand', 'widen', 'upgrade', 'boost', 'tighten', 'quicken', 'rebound',
  'recover', 'improve', 'strengthen', 'advance', 'skyrocket', 'zoom', 'appreciate', 'outperform',
  'exceed', 'double', 'triple', 'shoot up', 'go up', 'pick up', 'inch up', 'edge up', 'firm up', 'grow',
]
const UP_PLAIN = [
  'rose', 'risen', 'shot up', 'went up', 'gone up', 'grew', 'grown', 'tops', 'topped', 'higher', 'up',
  'strong', 'stronger', 'record high', 'all-time high', 'all time high', 'lifetime high', 'fresh high',
  'new high', '52-week high', 'bullish', 'uptick', 'upswing', 'upturn', 'boom', 'better than expected',
  'goes up', 'costlier', 'pricier', 'dearer',
  'above estimates', 'above expectations', 'ahead of estimates',
]
const DOWN_VERBS = [
  'cut', 'slash', 'reduce', 'lower', 'fall', 'drop', 'decline', 'slump', 'plunge', 'crash', 'tumble',
  'weaken', 'miss', 'shrink', 'narrow', 'downgrade', 'ease', 'cool', 'soften', 'slow', 'moderate',
  'decelerate', 'dip', 'sink', 'sag', 'slide', 'tank', 'plummet', 'collapse', 'erode', 'shed', 'lose',
  'depreciate', 'underperform', 'halve', 'trim', 'retreat', 'nosedive', 'skid', 'slip', 'deteriorate',
  'contract', 'go down', 'come down',
]
const DOWN_PLAIN = [
  'fell', 'fallen', 'sank', 'sunk', 'slid', 'lost', 'shrank', 'shrunk', 'went down', 'down', 'weak',
  'weaker', 'record low', 'all-time low', 'all time low', 'lifetime low', 'fresh low', 'new low',
  '52-week low', 'bearish', 'downturn', 'slowdown', 'selloff', 'sell-off', 'bloodbath', 'meltdown',
  'sluggish', 'tepid', 'worse than expected', 'below estimates', 'below expectations', 'contraction',
  'freefall', 'free fall', 'goes down', 'comes down', 'came down', 'slower', 'cheaper',
]
// "contracts" is also a noun ("L&T wins contracts"); the verb is read only as
// "contracted"/"contracting" via DOWN_PLAIN-style handling below.
const UP_WORDS = [...UP_VERBS.flatMap(inflect), ...UP_PLAIN]
const DOWN_WORDS = [
  ...DOWN_VERBS.filter((v) => v !== 'contract').flatMap(inflect),
  'contracted', 'contracting',
  ...DOWN_PLAIN,
]

const INTENSITY_WORDS = [
  'sharp', 'sharply', 'record', 'historic', 'unprecedented', 'massive', 'steep', 'steeply', 'crisis',
  'shock', 'emergency', 'surprise', 'surprising', 'unexpected', 'unexpectedly', 'biggest', 'worst',
  'best', 'huge', 'dramatic', 'severe', 'meltdown', 'bloodbath', 'freefall',
  ...['collapse', 'plummet', 'crash', 'plunge', 'soar', 'skyrocket', 'nosedive'].flatMap(inflect),
]

/** Rates held, a pause: the channel is in play but nothing moved. */
const HOLD_RE =
  /\b(unchanged|status quo|on hold|paus(e|es|ed|ing)|hold(s|ing)? steady|held steady|stays? put|remains? steady|no change)\b|\b(keeps?|kept|holds?|held|leaves?|left|maintains?|maintained|retains?|retained)\s+(the\s+)?(key\s+)?(repo\s+|policy\s+|interest\s+|benchmark\s+|lending\s+)?rates?\b/

/** A move preceded by one of these did not happen ("does not cut", "unlikely to hike"). */
const NEGATOR_RE =
  /\b(not|no|never|unlikely to|won't|wont|doesn't|didn't|isn't|aren't|wasn't|refuses? to|refused to|rules? out|ruled out|without|holds? off on|held off on|avoids?|avoided|fails? to|failed to)\s+(\w+\s+){0,2}$/

const boundary = (needle: string) => `(^|[^a-z0-9])${escapeRegExp(needle)}(?=$|[^a-z0-9])`

const MOVE_CACHE = new Map<string, RegExp>()
function moveRe(needle: string): RegExp {
  let re = MOVE_CACHE.get(needle)
  if (!re) {
    re = new RegExp(boundary(needle), 'gi')
    MOVE_CACHE.set(needle, re)
  }
  return re
}

interface MoveCount {
  count: number
  first: number
  negated: number
}

/** Matches of a word list, ignoring negated ones, with the earliest position. */
function countMoves(text: string, words: string[]): MoveCount {
  let count = 0
  let first = -1
  let negated = 0
  const seen = new Set<number>()
  for (const word of words) {
    const re = moveRe(word)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const at = m.index + m[1].length
      if (seen.has(at)) continue
      seen.add(at)
      if (NEGATOR_RE.test(text.slice(Math.max(0, at - 40), at))) {
        negated++
        continue
      }
      count++
      if (first === -1 || at < first) first = at
    }
  }
  return { count, first, negated }
}

const KEYWORD_CACHE = new Map<string, RegExp>()
/** Whole-word, plural-tolerant match: "interest rate" also finds "interest rates". */
function keywordRe(needle: string): RegExp {
  let re = KEYWORD_CACHE.get(needle)
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(?:s|es)?(?=$|[^a-z0-9])`, 'i')
    KEYWORD_CACHE.set(needle, re)
  }
  return re
}

function countKeywords(text: string, needles: string[]): number {
  let count = 0
  for (const needle of needles) if (keywordRe(needle).test(text)) count++
  return count
}

function has(text: string, needles: string[]): boolean {
  return countKeywords(text, needles) > 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which way the event's underlying variable moved, from the generic movement
 * words. Exported for the tests; channels with their own reading go through
 * polarityFor.
 */
export function detectPolarity(text: string): Polarity {
  const lower = text.toLowerCase()
  const up = countMoves(lower, UP_WORDS)
  const down = countMoves(lower, DOWN_WORDS)
  // "Held unchanged" beats any incidental word in the same sentence, unless
  // the text also says something actually moved ("keeps rates unchanged but
  // cuts CRR" still reads as a cut).
  if (HOLD_RE.test(lower) && up.count === 0 && down.count === 0) return 'neutral'
  if (HOLD_RE.test(lower) && countMoves(lower, inflect('hike').concat(inflect('cut'), inflect('raise'))).count === 0) {
    return 'neutral'
  }
  if (up.count === 0 && down.count === 0) return 'neutral'
  if (up.count !== down.count) return up.count > down.count ? 'up' : 'down'
  // Equal counts: headlines lead with the move and trail with its cause
  // ("Brent crude surges after OPEC output cut"), so the word that appears
  // first is the one describing the event.
  if (up.first === down.first) return 'neutral'
  return up.first < down.first ? 'up' : 'down'
}

/** Counts of positive and negative event words for a company channel. */
function tally(text: string, positive: RegExp, negative: RegExp): Polarity | null {
  const pos = (text.match(positive) || []).length
  const neg = (text.match(negative) || []).length
  if (pos === neg) return null
  return pos > neg ? 'up' : 'down'
}

const FOREIGN_CENTRAL_BANK = /\b(fed|federal reserve|fomc|powell|ecb|european central bank|bank of england|bank of japan|boj|pboc|us central bank)\b/
const INDIAN_POLICY = /\b(rbi|reserve bank|repo|mpc|india|indian|crr|slr|das|malhotra)\b/

// ── Channels ────────────────────────────────────────────────────────────

const THEMES: Theme[] = [
  {
    id: 'policy_rate',
    label: 'RBI policy rate',
    eventType: 'MONETARY_POLICY',
    economicVariable: 'INTEREST_RATE',
    keywords: [
      'repo rate', 'reverse repo', 'policy rate', 'interest rate', 'monetary policy', 'rbi mpc', 'mpc',
      'monetary policy committee', 'crr', 'cash reserve ratio', 'slr', 'rate hike', 'rate cut',
      'benchmark rate', 'lending rate', 'rbi policy', 'repo', 'rate decision', 'policy review', 'key rate',
      'cuts rates', 'cut rates', 'hikes rates', 'hike rates', 'raises rates', 'raise rates',
    ],
    weakKeywords: ['rbi', 'rates', 'reserve bank'],
    baseMagnitude: 70,
    scope: 'macro',
    hasNeutral: true,
    excludeIf: (text) => FOREIGN_CENTRAL_BANK.test(text) && !INDIAN_POLICY.test(text),
    polarity: (text) => (/\bhawkish\b/.test(text) ? 'up' : /\b(dovish|accommodative)\b/.test(text) ? 'down' : null),
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Banking', 'Financials', 'Auto', 'Consumer'],
            mechanism:
              'A higher policy rate raises banks’ cost of funds and the EMI on every new loan, so credit growth slows and rate-sensitive demand (housing, vehicles, consumer finance) is deferred. Lenders see margin pressure at the margin and slower loan books; discretionary-demand sectors see volumes soften.',
          }
        : polarity === 'down'
          ? {
              direction: 'POSITIVE',
              sectors: ['Banking', 'Financials', 'Auto', 'Consumer'],
              mechanism:
                'A lower policy rate cuts banks’ funding costs and loan EMIs, which revives credit demand and pulls forward rate-sensitive purchases such as homes and vehicles. Lenders get cheaper deposits and a larger loan book; leveraged borrowers see interest costs fall.',
            }
          : {
              direction: 'NEUTRAL',
              sectors: ['Banking', 'Financials', 'Auto'],
              mechanism:
                'Rates held steady removes a near-term swing factor rather than creating one. The read-through is mostly in the accompanying commentary — guidance on inflation and liquidity — rather than in the rate itself.',
            },
  },
  {
    id: 'fed',
    label: 'US Fed and global interest rates',
    eventType: 'GLOBAL_MARKET_SHOCK',
    economicVariable: 'INTEREST_RATE',
    keywords: [
      'federal reserve', 'us fed', 'the fed', 'fed', 'fomc', 'powell', 'fed chair', 'treasury yield',
      'us bond yield', 'us yields', 'ecb', 'european central bank', 'bank of england', 'bank of japan', 'boj',
    ],
    weakKeywords: ['interest rate', 'rates', 'rate hike', 'rate cut', 'bond yield'],
    baseMagnitude: 62,
    scope: 'macro',
    hasNeutral: true,
    polarity: (text) =>
      /\b(hawkish|higher[- ]for[- ]longer|tighter for longer)\b/.test(text)
        ? 'up'
        : /\b(dovish|pivot|easing cycle)\b/.test(text)
          ? 'down'
          : null,
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Banking', 'Financials', 'IT', 'Metals'],
            mechanism:
              'Higher US rates pull foreign portfolio money out of emerging markets such as India, weaken the rupee and slow global demand. Banks and financials, the largest foreign holdings, take the outflow first; exporters are partly cushioned by the weaker rupee.',
          }
        : polarity === 'down'
          ? {
              direction: 'POSITIVE',
              sectors: ['Banking', 'Financials', 'IT', 'Metals'],
              mechanism:
                'Lower US rates send foreign portfolio money back to emerging markets such as India, support the rupee and ease global financing conditions, lifting the large financials that foreign investors hold most.',
            }
          : {
              direction: 'NEUTRAL',
              sectors: ['Banking', 'IT'],
              mechanism:
                'A US rate pause leaves foreign-flow conditions where they were; the read-through comes from the guidance on future moves rather than from the decision itself.',
            },
  },
  {
    id: 'crude',
    label: 'crude oil price',
    eventType: 'COMMODITY_SHOCK',
    economicVariable: 'OIL_PRICE',
    keywords: [
      'crude', 'crude oil', 'oil price', 'brent', 'wti', 'opec', 'opec+', 'petrol price', 'diesel price',
      'fuel price', 'petrol', 'diesel', 'natural gas', 'lng', 'jet fuel', 'atf', 'barrel',
    ],
    weakKeywords: ['oil'],
    baseMagnitude: 65,
    scope: 'macro',
    excludeIf: (text) => /\b(edible|palm|cooking|mustard|vegetable|sunflower|soybean) oil\b/.test(text),
    // "OPEC cuts output" means crude goes UP: a supply cut is a price rise.
    polarity: (text) => {
      const supplyCut =
        /\b(output|production|supply|supplies)\s+(cut|cuts|curb|curbs|reduction)\b|\b(cut|cuts|curb|curbs|reduce|reduces|slash|slashes)\s+(oil\s+|crude\s+)?(output|production|supply)\b/
      const supplyRise =
        /\b(raise|raises|boost|boosts|increase|increases|hike|hikes)\s+(oil\s+|crude\s+)?(output|production|supply)\b|\b(output|production|supply)\s+(hike|increase|boost)\b/
      const stripped = text.replace(supplyCut, ' ').replace(supplyRise, ' ')
      const generic = detectPolarity(stripped)
      if (generic !== 'neutral') return generic
      if (supplyCut.test(text)) return 'up'
      if (supplyRise.test(text)) return 'down'
      return null
    },
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Aviation', 'Energy', 'Chemicals', 'Auto'],
            mechanism:
              'India imports most of its crude, so a higher oil price is an immediate cost shock for fuel-intensive businesses (airlines, logistics) and for petrochemical feedstock users. It also widens the current account deficit and pressures the rupee, importing inflation. Upstream producers are the exception — they realise higher prices.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Aviation', 'Energy', 'Chemicals', 'Auto'],
            mechanism:
              'Cheaper crude cuts fuel and feedstock costs straight through to operating margins for airlines, logistics and chemicals, and narrows the import bill, which supports the rupee and cools inflation. Upstream producers realise lower prices and are the offset.',
          },
  },
  {
    id: 'gold',
    label: 'gold price',
    eventType: 'COMMODITY_SHOCK',
    economicVariable: 'GOLD_PRICE',
    keywords: ['gold', 'gold price', 'silver', 'bullion', 'precious metal'],
    baseMagnitude: 50,
    scope: 'macro',
    focus: ['TITAN'],
    excludeIf: (text) => /\bgold medal\b/.test(text),
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Consumer'],
            mechanism:
              'A gold rally revalues jewellers’ inventory upward but prices buyers out of new purchases, and it usually reflects investors moving to safety — a headwind for equities as a whole.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Consumer'],
            mechanism:
              'Cheaper gold brings jewellery buyers back and signals investors moving out of safe havens into risk assets, though jewellers book lower inventory values.',
          },
  },
  {
    id: 'currency',
    label: 'rupee exchange rate',
    eventType: 'CURRENCY',
    economicVariable: 'CURRENCY',
    keywords: ['rupee', 'usd/inr', 'usdinr', 'dollar index', 'forex', 'currency', 'depreciation', 'appreciation', 'exchange rate', 'forex reserves'],
    baseMagnitude: 55,
    scope: 'macro',
    // A "falling rupee" is a weaker rupee: good for exporters, bad for
    // importers. The polarity here is the rupee's own direction; "rupee
    // depreciates" and "dollar strengthens against the rupee" both mean down.
    polarity: (text) => {
      if (/\bdepreciat/.test(text)) return 'down'
      if (/\bappreciat/.test(text)) return 'up'
      if (/\bdollar\b[^.]{0,25}\b(strengthen|gain|rise|rises|rose|jump|surge)/.test(text) && !/\brupee\b[^.]{0,15}\b(rise|rises|rose|gain|strengthen)/.test(text)) return 'down'
      return null
    },
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors: ['IT', 'Pharma', 'Metals', 'Energy'],
            mechanism:
              'A weaker rupee raises the rupee value of every dollar billed, so exporters — IT services and generic pharma above all — see revenue and margin translate upward with no change in volume. The mirror image is importers and anyone with unhedged dollar debt, who pay more.',
          }
        : {
            direction: 'NEGATIVE',
            sectors: ['IT', 'Pharma', 'Energy', 'Metals'],
            mechanism:
              'A stronger rupee shrinks the rupee value of dollar revenue, compressing exporters’ realisations and margins. Importers and dollar-debt borrowers benefit, which is why the read is sector-split rather than market-wide.',
          },
  },
  {
    id: 'inflation',
    label: 'inflation',
    eventType: 'INFLATION',
    economicVariable: 'INFLATION',
    keywords: ['inflation', 'cpi', 'wpi', 'consumer price', 'wholesale price', 'price rise', 'retail inflation', 'food prices'],
    baseMagnitude: 60,
    scope: 'macro',
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['FMCG', 'Consumer', 'Retail', 'Auto'],
            mechanism:
              'Rising inflation squeezes household real income and raises input costs faster than most companies can pass them on, compressing gross margins in consumer-facing businesses. It also pushes the central bank towards tighter policy, which is a second, slower drag on rate-sensitive demand.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['FMCG', 'Consumer', 'Retail', 'Banking'],
            mechanism:
              'Cooling inflation restores household purchasing power and eases input-cost pressure, so consumer volumes and gross margins both improve. It also opens the door to easier monetary policy, which helps lenders and rate-sensitive demand.',
          },
  },
  {
    id: 'monsoon',
    label: 'monsoon rainfall',
    eventType: 'AGRICULTURE',
    economicVariable: 'RAINFALL',
    keywords: [
      'monsoon', 'rainfall', 'long-period average', 'long period average', 'lpa', 'imd',
      'kharif', 'rabi', 'sowing', 'drought', 'el nino', 'la nina',
    ],
    baseMagnitude: 55,
    scope: 'macro',
    // IMD's own bands: below 96% of the long-period average is below normal
    // or deficient; 96% and above is normal or better.
    polarity: (text) => {
      const pct = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:%|per ?cent)\s*(?:of\s*(?:the\s*)?)?(?:long[- ]period average|lpa)/)
      if (pct) return Number(pct[1]) >= 96 ? 'up' : 'down'
      if (/deficien|below[- ]normal|deficit|drought|delayed|weak monsoon|erratic|dry spell|el nino|failed monsoon/.test(text)) return 'down'
      if (/above[- ]normal|surplus|excess|normal monsoon|good monsoon|bountiful|la nina|early onset|healthy/.test(text)) return 'up'
      return null
    },
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['FMCG', 'Auto', 'Consumer'],
            mechanism:
              'A weak monsoon cuts farm output and rural incomes, so demand for everyday consumer goods, two-wheelers and tractors softens where half of India’s consumption happens. Food prices rise, which keeps inflation up and delays rate cuts.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['FMCG', 'Auto', 'Consumer'],
            mechanism:
              'A good monsoon lifts farm output and rural incomes, which drive demand for everyday consumer goods, two-wheelers and tractors. Ample food supply also cools inflation, leaving room for lower interest rates.',
          },
  },
  {
    id: 'growth',
    label: 'economic growth',
    eventType: 'GDP',
    economicVariable: 'GDP',
    keywords: ['gdp', 'economic growth', 'growth rate', 'iip', 'industrial production', 'pmi', 'manufacturing output', 'economic survey', 'recession'],
    weakKeywords: ['economy'],
    baseMagnitude: 60,
    scope: 'macro',
    polarity: (text) => (/\brecession\b/.test(text) && !/\b(avoid|exit|end)s?\b[^.]{0,15}recession/.test(text) ? 'down' : null),
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Banking', 'Metals', 'Engineering', 'Auto'],
            mechanism:
              'Slower growth means weaker credit demand, thinner order books for capital goods, and softer volumes for cyclicals such as metals and vehicles. Banks additionally face a worse asset-quality outlook as borrowers’ cash flows deteriorate.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Banking', 'Metals', 'Engineering', 'Auto'],
            mechanism:
              'Faster growth lifts credit demand, industrial volumes and order inflows together — the classic cyclical upswing. Banks lend more against improving borrower cash flows, and capital-goods and metals volumes follow investment activity.',
          },
  },
  {
    id: 'fiscal',
    label: 'government spending and taxes',
    eventType: 'GOVERNMENT_POLICY',
    economicVariable: 'FISCAL',
    keywords: ['budget', 'union budget', 'fiscal deficit', 'capex', 'capital expenditure', 'pli', 'production linked incentive', 'subsidy', 'gst', 'infrastructure push', 'divestment', 'import duty', 'customs duty', 'excise duty', 'government spending', 'public spending', 'tax cut', 'income tax'],
    baseMagnitude: 65,
    scope: 'macro',
    resolve: (polarity, text) => {
      // A consumption tax cut reaches households, not the infrastructure chain.
      const consumption = /\b(gst|income tax|tax cut|excise)\b/.test(text)
      const sectors: Sector[] = consumption ? ['FMCG', 'Consumer', 'Auto', 'Retail'] : ['Engineering', 'Cement', 'Metals', 'Utilities']
      return polarity === 'down'
        ? {
            direction: consumption ? 'POSITIVE' : 'NEGATIVE',
            sectors,
            mechanism: consumption
              ? 'A lower tax on consumption or income leaves households with more to spend, lifting volumes for consumer goods, vehicles and retail.'
              : 'Lower government spending or a harsher duty/tax regime removes demand that the infrastructure chain depends on: fewer tenders for capital goods, less cement and steel offtake, and slower utility capacity addition.',
          }
        : {
            direction: consumption ? 'NEGATIVE' : 'POSITIVE',
            sectors,
            mechanism: consumption
              ? 'A higher tax on consumption or income takes spending power out of households, which shows up first in discretionary purchases.'
              : 'Higher government capital spending or a favourable incentive/duty change flows into the infrastructure chain in order: capital-goods order books first, then cement and steel volumes, then the utilities and ports that carry the output.',
          }
    },
  },
  {
    id: 'trade',
    label: 'trade barriers and tariffs',
    eventType: 'TRADE_POLICY',
    economicVariable: 'TRADE',
    keywords: [
      'tariff', 'trade war', 'trade deal', 'trade agreement', 'free trade agreement', 'fta', 'anti-dumping',
      'export ban', 'export curb', 'trade talks', 'trade tension', 'reciprocal tariff', 'h-1b', 'h1b',
      'work visa', 'sanctions on india',
    ],
    baseMagnitude: 62,
    scope: 'macro',
    // The variable is the height of the barrier: tariffs imposed is up, a
    // deal or a rollback is down.
    polarity: (text) =>
      tally(
        text,
        /\b(impose|imposes|imposed|imposing|slap|slaps|hike|hikes|raise|raises|raised|higher|new tariff|ban|bans|curb|curbs|war|tension|tensions|threaten|threatens|fee)\b/g,
        /\b(deal|agreement|fta|roll ?back|rolls back|remove|removes|removed|lift|lifts|lifted|exempt|exempts|exemption|cut|cuts|lower|lowers|reduce|reduces|truce|pause|paused)\b/g
      ),
    resolve: (polarity, text) => {
      const services = /\b(h-?1b|visa|outsourcing|services)\b/.test(text)
      const sectors: Sector[] = services ? ['IT'] : ['Pharma', 'Auto', 'Metals', 'Chemicals', 'IT']
      return polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors,
            mechanism:
              'Lower trade barriers reopen export markets and restore price competitiveness for Indian exporters, and easing trade tension lowers the risk premium on Indian equities.',
          }
        : {
            direction: 'NEGATIVE',
            sectors,
            mechanism:
              'Higher barriers abroad make Indian exports less competitive in that market, so exporters lose orders or margin, and the tension itself raises the risk premium and can trigger foreign outflows.',
          }
    },
  },
  {
    id: 'global',
    label: 'global markets',
    eventType: 'GLOBAL_MARKET_SHOCK',
    economicVariable: 'GLOBAL_RISK',
    keywords: ['wall street', 'nasdaq', 'dow jones', 's&p 500', 'global markets', 'global stocks', 'world markets', 'asian markets', 'us markets', 'us stocks', 'china economy', 'foreign investors', 'fii', 'fpi', 'global sell-off', 'us recession'],
    baseMagnitude: 60,
    scope: 'macro',
    polarity: (text) => (/\b(outflows?|sell-?off|recession)\b/.test(text) ? 'down' : /\binflows?\b/.test(text) ? 'up' : null),
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['IT', 'Metals', 'Banking'],
            mechanism:
              'Global risk-off pulls foreign portfolio flows out of Indian equities and weakens the rupee, while a weaker US/global demand outlook hits the externally-exposed sectors first — IT services revenue and industrial-metal volumes — before it reaches domestic earnings.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['IT', 'Metals', 'Banking'],
            mechanism:
              'A friendlier global backdrop brings foreign flows back into Indian equities and supports the externally-exposed sectors: IT services client spending and industrial-metal demand both improve before domestic earnings move.',
          },
  },
  {
    id: 'geopolitical',
    label: 'geopolitical risk',
    eventType: 'GEOPOLITICAL',
    economicVariable: 'GEOPOLITICAL_RISK',
    keywords: [
      'war', 'conflict', 'sanctions', 'military', 'attack', 'border tension', 'strait', 'shipping route', 'red sea',
      'geopolitical', 'invasion', 'ceasefire', 'truce', 'peace talks', 'peace deal', 'missile', 'airstrike',
      'terror attack', 'escalation', 'de-escalation', 'hostilities', 'blockade', 'border clash', 'tensions',
      'military strike', 'missile strike', 'air strike',
    ],
    weakKeywords: ['israel', 'iran', 'russia', 'ukraine', 'pakistan', 'gaza', 'hamas', 'hezbollah', 'houthi', 'taiwan', 'middle east'],
    baseMagnitude: 68,
    scope: 'macro',
    // A war does not "rise"; it breaks out. The variable is the level of
    // risk: escalation is up, a ceasefire or peace is down.
    polarity: (text) => {
      const calmer = /\b(ceasefire|cease-fire|truce|peace|de-?escalat\w*|ends? (the )?war|withdraw\w*|lifts? sanctions|sanctions (lifted|eased)|talks progress|accord)\b/.test(text)
      const worse = /\b(war|attack\w*|invasion|invades?|missiles?|airstrikes?|strikes?|struck|escalat\w*|hostilities|blockade|clash\w*|tensions? (rise|rises|escalate|flare)|sanctions|terror\w*|conflict|military action)\b/.test(text)
      if (calmer) return 'down'
      if (worse) return 'up'
      return null
    },
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors: ['Aviation', 'Ports', 'Chemicals', 'Energy', 'Defence'],
            mechanism:
              'De-escalation unwinds the energy and freight risk premium, lowering fuel and shipping costs and normalising trade routes for importers and logistics-linked businesses; producers and defence names give back the premium they had gained.',
          }
        : {
            direction: 'NEGATIVE',
            sectors: ['Defence', 'Aviation', 'Energy', 'Ports', 'Chemicals'],
            mechanism:
              'Conflict raises energy prices and freight and insurance costs and lengthens supply routes, so the cost shock reaches fuel-intensive and import-dependent businesses first, and risk premia rise across the market. Defence suppliers are the exception, on higher security spending.',
          },
  },
  {
    id: 'pandemic',
    label: 'public-health shock',
    eventType: 'PANDEMIC',
    economicVariable: 'PUBLIC_HEALTH',
    keywords: ['covid', 'covid-19', 'coronavirus', 'pandemic', 'lockdown', 'outbreak', 'epidemic', 'virus', 'quarantine', 'new variant', 'mpox'],
    baseMagnitude: 70,
    scope: 'macro',
    polarity: (text) =>
      /\b(lifted|lifts|eases?|eased|ends?|ended|unlock\w*|reopen\w*|vaccine|vaccination|cases (fall|decline|drop)|recovery|contained)\b/.test(text)
        ? 'down'
        : 'up',
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors: ['Aviation', 'Retail', 'Auto', 'Consumer', 'Pharma'],
            mechanism:
              'Lifting restrictions brings back travel, store footfall and big-ticket purchases, so the businesses that closed first recover first; pandemic-related demand for drugs and diagnostics fades.',
          }
        : {
            direction: 'NEGATIVE',
            sectors: ['Aviation', 'Retail', 'Auto', 'Pharma', 'IT'],
            mechanism:
              'Restrictions on movement ground flights, empty stores and shut plants while fixed costs continue, so travel, retail and vehicles take the hit first. Pharmaceuticals and digital services see demand rise.',
          },
  },
  {
    id: 'regulatory',
    label: 'regulation and enforcement',
    eventType: 'REGULATORY',
    economicVariable: 'REGULATION',
    keywords: [
      'sebi', 'regulator', 'regulation', 'regulatory', 'norms', 'penalty', 'probe', 'investigation', 'ban', 'banned',
      'compliance', 'licence', 'license', 'antitrust', 'cci', 'trai', 'usfda', 'fda', 'import curb', 'warning letter',
      'import alert', 'fine', 'fined', 'crackdown', 'irdai', 'dgca', 'cdsco', 'fssai', 'show cause', 'restrictions',
    ],
    baseMagnitude: 55,
    scope: 'mixed',
    // Tighter rules or an enforcement action is up; relief is down.
    polarity: (text) =>
      /\b(relax\w*|eases? norms|eased norms|lifts? (the )?ban|lifted|removes? curbs|approv\w*|clears?|cleared|allows?|allowed|permits?|exempt\w*|relief|withdraws? (the )?(order|notice))\b/.test(text)
        ? 'down'
        : 'up',
    resolve: (polarity, text) => {
      const sectors: Sector[] = []
      if (/\b(sebi|f&o|derivatives|mutual funds?|stock exchanges?|brokers?|trading)\b/.test(text)) sectors.push('Financials')
      if (/\b(usfda|fda|cdsco|drugs?|warning letter|import alert|pharma\w*)\b/.test(text)) sectors.push('Pharma')
      if (/\b(trai|dot|spectrum|telecom)\b/.test(text)) sectors.push('Telecom')
      if (/\b(rbi|reserve bank|banks?|banking|nbfcs?|lenders?|loans?)\b/.test(text)) sectors.push('Banking', 'Financials')
      if (/\b(irdai|insurers?|insurance)\b/.test(text)) sectors.push('Financials')
      if (/\b(dgca|airlines?|aviation)\b/.test(text)) sectors.push('Aviation')
      if (/\b(fssai|food)\b/.test(text)) sectors.push('FMCG')
      return polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors: Array.from(new Set(sectors)),
            mechanism:
              'Regulatory relief reopens a restricted business line or lowers compliance cost, and removes an overhang the market had been discounting.',
          }
        : {
            direction: 'NEGATIVE',
            sectors: Array.from(new Set(sectors)),
            mechanism:
              'Tighter regulation or an enforcement action raises compliance cost and caps a revenue line or a business practice, and the overhang usually persists until the scope of the order is known.',
          }
    },
  },
  {
    id: 'ratings',
    label: 'credit rating',
    eventType: 'CREDIT_RATING',
    economicVariable: 'CREDIT',
    keywords: ['credit rating', 'moody', "moody's", 'fitch', 's&p global ratings', 'crisil', 'icra', 'rating outlook', 'sovereign rating'],
    baseMagnitude: 50,
    scope: 'mixed',
    polarity: (text) =>
      /\bdowngrad\w*|outlook (to|at) negative|negative outlook\b/.test(text)
        ? 'down'
        : /\bupgrad\w*|outlook (to|at) positive|positive outlook\b/.test(text)
          ? 'up'
          : null,
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Banking', 'Financials', 'Utilities'],
            mechanism:
              'A rating downgrade raises the cost at which the issuer — or, for a sovereign action, everyone borrowing against it — can refinance. Leveraged and funding-dependent businesses feel it first through wider spreads.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Banking', 'Financials', 'Utilities'],
            mechanism:
              'A rating upgrade lowers refinancing costs and widens the pool of lenders willing to hold the paper, which is worth most to leveraged, funding-dependent balance sheets.',
          },
  },
  {
    id: 'employment',
    label: 'jobs and incomes',
    eventType: 'EMPLOYMENT',
    economicVariable: 'EMPLOYMENT',
    keywords: ['unemployment', 'jobs data', 'payrolls', 'employment rate', 'job creation'],
    baseMagnitude: 45,
    scope: 'macro',
    // Unemployment rising is employment falling.
    polarity: (text) => {
      const p = detectPolarity(text)
      return /\bunemployment\b/.test(text) && p !== 'neutral' ? (p === 'up' ? 'down' : 'up') : null
    },
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Consumer', 'Retail', 'Banking'],
            mechanism:
              'Weaker employment reduces aggregate household income, which shows up in discretionary consumption first and in retail credit quality shortly after.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Consumer', 'Retail', 'Banking'],
            mechanism:
              'Stronger employment adds household income, supporting discretionary consumption volumes and retail credit demand and quality.',
          },
  },
  {
    id: 'market_move',
    label: 'broad market move',
    eventType: 'MARKET_MOVE',
    economicVariable: 'MARKET',
    keywords: [
      'sensex', 'nifty', 'nifty 50', 'bank nifty', 'stock market', 'share market', 'equity market', 'equities',
      'dalal street', 'market crash', 'bull run', 'bear market', 'market correction', 'india vix',
    ],
    weakKeywords: ['markets', 'market'],
    baseMagnitude: 55,
    scope: 'macro',
    polarity: (text) => (/\b(bull run|bull market)\b/.test(text) ? 'up' : /\b(bear market|correction|crash)\b/.test(text) ? 'down' : null),
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Banking', 'Financials', 'IT', 'Energy'],
            mechanism:
              'A broad sell-off is carried by the heaviest index constituents — banks, financials, IT and energy — which take the bulk of foreign and passive selling, while defensive businesses fall less.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Banking', 'Financials', 'IT', 'Energy'],
            mechanism:
              'A broad rally is carried by the heaviest index constituents — banks, financials, IT and energy — which attract the first foreign and passive buying, while defensive businesses lag.',
          },
  },

  // ── Company channels: about the companies named, not their sectors ──
  {
    id: 'earnings',
    label: 'company results',
    eventType: 'EARNINGS',
    economicVariable: 'CORPORATE',
    keywords: [
      'earnings', 'results', 'quarterly results', 'q1', 'q2', 'q3', 'q4', 'quarter', 'net profit', 'profit',
      'revenue', 'guidance', 'margin', 'ebitda', 'profit after tax', 'topline', 'bottomline', 'net loss',
      'estimates', 'eps', 'quarterly profit', 'annual results',
    ],
    weakKeywords: ['loss', 'pat'],
    baseMagnitude: 55,
    scope: 'company',
    hasNeutral: true,
    polarity: (text) => {
      if (/\bloss(es)?\b[^.]{0,30}\b(widen\w*|ris\w*|rose|jump\w*|surg\w*|increas\w*|doubl\w*)/.test(text)) return 'down'
      if (/\bloss(es)?\b[^.]{0,30}\b(narrow\w*|shrink\w*|shrank|halv\w*|reduc\w*)/.test(text)) return 'up'
      if (/\b(swings?|swung|slips?|slipped) (in)?to (a )?(net )?loss|\b(posts?|reports?|posted|reported) (a )?(net )?loss|\binto the red\b/.test(text)) return 'down'
      if (/\b(swings?|swung|returns?|returned) to (a )?profit|\bturns? profitable\b/.test(text)) return 'up'
      const verdict = tally(
        text,
        /\b(beat|beats|tops|topped|above (street )?(estimates|expectations)|better than expected|record (profit|revenue)|raises? (its )?guidance|upgrades? guidance)\b/g,
        /\b(miss|misses|missed|below (street )?(estimates|expectations)|worse than expected|disappoint\w*|cuts? (its )?guidance|lowers? (its )?guidance|warns?|profit warning)\b/g
      )
      return verdict
    },
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'POSITIVE',
            sectors: [],
            mechanism:
              'Results ahead of expectations push forward earnings estimates up, and the re-rating depends on whether the beat is seen as a one-off or the start of a trend.',
          }
        : polarity === 'down'
          ? {
              direction: 'NEGATIVE',
              sectors: [],
              mechanism:
                'Weaker results or guidance lower the forward estimates the market capitalises, so the de-rating reflects both the miss and how much growth was already in the price.',
            }
          : {
              direction: 'NEUTRAL',
              sectors: [],
              mechanism:
                'The text names the results but not how they compared with expectations, so the read waits on the numbers themselves.',
            },
  },
  {
    id: 'capital_return',
    label: 'dividend, buyback or bonus',
    eventType: 'DIVIDEND',
    economicVariable: 'CORPORATE',
    keywords: ['dividend', 'buyback', 'bonus issue', 'bonus share', 'stock split', 'share split', 'special dividend', 'record date', 'interim dividend'],
    weakKeywords: ['bonus'],
    baseMagnitude: 40,
    scope: 'company',
    hasNeutral: true,
    polarity: (text) => (/\b(cancel\w*|scrap\w*|defer\w*|skip\w*|omit\w*)\b/.test(text) ? 'down' : 'up'),
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: [],
            mechanism: 'Cancelling or deferring a payout signals that management wants to conserve cash, which the market reads as caution about the business.',
          }
        : {
            direction: 'POSITIVE',
            sectors: [],
            mechanism:
              'Returning capital signals management’s confidence in cash generation and, in a buyback, shrinks the share count — but it distributes value rather than creating it, so the earnings power of the business is unchanged.',
          },
  },
  {
    id: 'ma',
    label: 'merger or acquisition',
    eventType: 'M&A',
    economicVariable: 'CORPORATE',
    keywords: ['acquisition', 'acquires', 'acquire', 'acquired', 'merger', 'merges', 'takeover', 'stake sale', 'buyout', 'open offer', 'demerger', 'joint venture', 'buys stake', 'to buy', 'buys', 'stake'],
    baseMagnitude: 55,
    scope: 'company',
    hasNeutral: true,
    polarity: () => 'neutral',
    resolve: () => ({
      direction: 'NEUTRAL',
      sectors: [],
      mechanism:
        'A transaction re-prices the target towards the deal value and changes the acquirer’s earnings mix and leverage. The market’s read depends on the price paid and how it is funded, so the acquirer and the target usually move in opposite directions.',
    }),
  },
  {
    id: 'management',
    label: 'leadership change',
    eventType: 'MANAGEMENT_CHANGE',
    economicVariable: 'CORPORATE',
    keywords: ['ceo', 'managing director', 'resigns', 'resignation', 'steps down', 'appoints', 'appointment', 'chairman', 'cfo', 'chief executive', 'successor', 'quits'],
    baseMagnitude: 45,
    scope: 'company',
    hasNeutral: true,
    polarity: (text) =>
      /\b(resign\w*|steps? down|stepped down|quits?|quit|sacked|fired|ousted|removed|exits?|abrupt\w*|arrest\w*)\b/.test(text) ? 'down' : 'up',
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: [],
            mechanism:
              'An unplanned senior departure creates execution and continuity risk, and the market discounts strategy until a successor and their mandate are known.',
          }
        : {
            direction: 'POSITIVE',
            sectors: [],
            mechanism:
              'A leadership appointment matters through the strategy it signals rather than through near-term earnings; the re-rating, if any, follows the new management’s stated priorities.',
          },
  },
  {
    id: 'company_news',
    label: 'company news',
    eventType: 'CORPORATE_NEWS',
    economicVariable: 'CORPORATE',
    keywords: [
      'shares', 'share price', 'stock price', 'stock', 'order', 'order win', 'contract', 'deal', 'launch', 'sales',
      'volumes', 'deliveries', 'fraud', 'allegation', 'scam', 'raid', 'default', 'fire', 'strike', 'outage', 'recall',
      'plant', 'expansion', 'capacity', 'tariff hike', 'price hike', 'mobile tariff', 'subscribers', 'market share',
      'ipo', 'listing', 'block deal', 'promoter', 'pledge', 'insolvency', 'bankruptcy', 'lawsuit', 'short seller',
      'hindenburg', 'target price', 'layoff', 'job cuts', 'shutdown', 'factory', 'new product',
    ],
    weakKeywords: ['company', 'announces', 'firm'],
    baseMagnitude: 50,
    scope: 'company',
    polarity: (text) => {
      const lower = text
      const events = tally(
        lower,
        /\b(wins?|won|bags?|bagged|secures?|secured|order wins?|new orders?|launch\w*|expan\w*|approv\w*|record (sales|volumes|deliveries)|tariff hikes?|price hikes?|raises? (\w+ )?(prices|tariffs)|hikes? (\w+ )?(prices|tariffs)|upgrade\w*|buy rating|target (price )?raised|market share gains?|profit jumps?)\b/g,
        /\b(fraud\w*|allegations?|scam|raids?|probe|defaults?|fire|strike|outage|recall\w*|penalt\w*|fined?|lawsuit|short seller|hindenburg|downgrade\w*|sell rating|target (price )?cut|pledge\w*|insolvency|bankruptcy|resign\w*|layoffs?|job cuts|shutdown|halts?|suspend\w*|warning letter|import alert|banned|loses|lost|cuts? (\w+ )?prices)\b/g
      )
      const moves = detectPolarity(lower)
      if (moves !== 'neutral') return moves
      return events
    },
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'POSITIVE',
            sectors: [],
            mechanism:
              'Company-specific good news — new business, pricing power or a favourable development — feeds forward estimates for that company directly; peers are affected only to the extent the market reads it across.',
          }
        : polarity === 'down'
          ? {
              direction: 'NEGATIVE',
              sectors: [],
              mechanism:
                'Company-specific bad news — a governance question, an operational setback or lost business — hits that company directly through its earnings outlook and the discount investors apply until it is resolved.',
            }
          : {
              direction: 'NEUTRAL',
              sectors: [],
              mechanism: 'The text describes a development at the company without saying whether it helps or hurts, so no direction is assigned.',
            },
  },
]

/** Direct sector mentions add to whatever the channel implies. */
const SECTOR_KEYWORDS: Record<Sector, string[]> = {
  Banking: ['bank', 'banking', 'lender', 'psu bank', 'private bank', 'bank stock', 'banking stock'],
  IT: ['it sector', 'it stock', 'it companies', 'it services', 'it firms', 'software', 'tech stock', 'information technology', 'tech companies'],
  Energy: ['oil and gas', 'refiner', 'refining', 'oil marketing', 'omc', 'energy sector', 'energy stock', 'upstream', 'oil producer', 'oil companies'],
  Auto: ['auto', 'car', 'auto sector', 'auto stock', 'automobile', 'automaker', 'carmaker', 'car sales', 'two-wheeler', 'passenger vehicle', 'electric vehicle', 'vehicle sales', 'tractor'],
  FMCG: ['fmcg', 'consumer goods', 'staples', 'consumer staples', 'packaged food'],
  Pharma: ['pharma', 'pharmaceutical', 'drugmaker', 'healthcare', 'hospital', 'generic drug', 'medicine'],
  Financials: ['nbfc', 'financial services', 'insurance', 'insurer', 'lending', 'broker', 'brokerage', 'mutual fund', 'asset management', 'stock exchange', 'capital market', 'fintech', 'microfinance'],
  Metals: ['steel', 'metal', 'aluminium', 'aluminum', 'copper', 'iron ore', 'mining', 'zinc', 'steelmaker'],
  Telecom: ['telecom', 'telco', 'spectrum', 'mobile tariff', '5g'],
  Utilities: ['power sector', 'electricity', 'power demand', 'discom', 'renewable', 'solar', 'power tariff', 'power generation'],
  Engineering: ['capital goods', 'infrastructure', 'construction', 'engineering', 'railway', 'road', 'highway', 'metro rail'],
  Defence: ['defence', 'defense', 'military', 'armed forces', 'army', 'missile', 'drone', 'fighter jet'],
  Cement: ['cement'],
  Chemicals: ['chemical', 'specialty chemicals', 'petrochemical', 'fertiliser', 'fertilizer'],
  Consumer: ['consumer demand', 'discretionary', 'consumption', 'paint', 'jewellery', 'jewelry', 'consumer durables'],
  Retail: ['retailer', 'retail sector', 'retail sales', 'retail stock', 'quick commerce', 'e-commerce', 'food delivery', 'apparel'],
  Diversified: ['conglomerate'],
  Aviation: ['aviation', 'airline', 'air fare', 'airfare', 'air travel', 'airport', 'flight'],
  Ports: ['port', 'shipping', 'cargo', 'logistics', 'freight'],
}

/** Words that mean this text is about Indian markets at all. */
const INDIA_MARKET_KEYWORDS = [
  'india', 'indian', 'nifty', 'sensex', 'rbi', 'sebi', 'nse', 'bse', 'rupee',
  'mumbai', 'dalal street', 'crore', 'lakh', 'gst',
]

function detectSectors(text: string): Sector[] {
  const found: Sector[] = []
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS) as [Sector, string[]][]) {
    if (has(text, keywords)) found.push(sector)
  }
  return found
}

interface ThemeMatch {
  theme: Theme
  score: number
}

function bestTheme(text: string, companiesNamed: boolean): ThemeMatch | null {
  let best: ThemeMatch | null = null
  for (const theme of THEMES) {
    if (theme.excludeIf?.(text)) continue
    let score = countKeywords(text, theme.keywords) + countKeywords(text, theme.weakKeywords ?? []) * 0.5
    if (score === 0) continue
    // Named companies tip a tie towards the company channels: "Airtel raises
    // mobile tariffs" is Airtel's pricing, not trade policy.
    if (companiesNamed && theme.scope !== 'macro') score += 0.5
    if (!best || score > best.score) best = { theme, score }
  }
  return best
}

/** A percentage or basis-point figure signals a concrete, sized event. */
function hasFigure(text: string): boolean {
  return /\d+(\.\d+)?\s*(%|per cent|percent|bps|basis points)/i.test(text)
}

/** Bigger moves are bigger events: a 25% crude crash is not a 2% drift. */
function sizeBoost(text: string): number {
  const pcts = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per ?cent)/g)).map((m) => Number(m[1]))
  const bps = Array.from(text.matchAll(/(\d+)\s*(?:bps|basis points)/g)).map((m) => Number(m[1]))
  const pct = Math.max(0, ...pcts.filter((p) => p < 1000))
  const bp = Math.max(0, ...bps)
  return (pct >= 20 ? 14 : pct >= 10 ? 9 : pct >= 5 ? 5 : 0) + (bp >= 50 ? 6 : 0)
}

/** Words that describe something happening, for text that names no channel. */
const EVENT_SIGNAL_RE =
  /\b(announc\w*|launch\w*|reports?|reported|posts?|posted|results?|profits?|loss(es)?|revenue|sales|orders?|contracts?|deals?|wins?|won|bags?|secures?|signs?|approv\w*|ipo|listing|stake|fire|strike|recall\w*|fraud|allegations?|raids?|probe|defaults?|outage|shutdown|expansion|capacity|merger|acquir\w*|bankruptcy|insolvency|fined?|penalty|resign\w*|appoint\w*|hikes?|cuts?|tariffs?|prices?|ban(s|ned)?|crash\w*|rall(y|ies|ied))\b/

/** Text asking for advice rather than describing an event. */
const ADVICE_RE =
  /\b(should i|shall i|can i|is it (a )?(good|right|safe|wise)|good time to|worth (buying|investing)|buy or sell|recommend|which stock|best stock|what about)\b/

export type EventVerdict =
  /** A recognised event with somewhere to trace it. */
  | 'ok'
  /** No market event in the text at all. */
  | 'not_event'
  /** Not written in a language the rules read. */
  | 'non_english'
  /** A company channel ("results season begins") with no company or sector named. */
  | 'needs_company'
  /** Names only companies outside the NIFTY 50 universe. */
  | 'outside_universe'
  /** A channel whose direction the text never states ("crude oil prices"). */
  | 'no_direction'
  /** A recognised channel that reaches no sector of the universe. */
  | 'no_sector'

export interface EventAssessment {
  verdict: EventVerdict
  classification: EventClassification
  /** The channel id, or null when nothing matched. */
  channel: string | null
  label: string | null
  polarity: Polarity
  /** Whether the channel reaches the named companies or whole sectors. */
  scope: 'company' | 'macro'
  /** NIFTY 50 companies the text names, in order. */
  companies: EquityConstituent[]
  /** Named companies outside the NIFTY 50. */
  outside: { symbol: string; phrase: string }[]
  /** Sectors the text names outright. */
  mentionedSectors: string[]
  /** Symbols the channel reaches when narrower than its sectors. */
  focus: string[]
}

const ASSESS_CACHE = new Map<string, EventAssessment>()

export function assessEvent(eventText: string): EventAssessment {
  const cached = ASSESS_CACHE.get(eventText)
  if (cached) return cached
  const result = assess(eventText)
  if (ASSESS_CACHE.size > 500) ASSESS_CACHE.clear()
  ASSESS_CACHE.set(eventText, result)
  return result
}

function assess(eventText: string): EventAssessment {
  const text = eventText.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
  const { companies, outside } = findCompanies(text)
  const mentionedSectors = detectSectors(text)
  const latin = /[a-z]/.test(text)
  // Letters of another script, and none of ours: Hindi, say. Digits or
  // emoji alone are not a language, just not an event.
  const otherScript = !latin && /\p{L}/u.test(text)

  let match = bestTheme(text, companies.length > 0 || outside.length > 0)
  const genericPolarity = detectPolarity(text)
  const eventSignal = EVENT_SIGNAL_RE.test(text) || genericPolarity !== 'neutral'

  // "Infosys jumps 6%" names no channel word but is plainly company news.
  if (!match && (companies.length > 0 || outside.length > 0) && eventSignal) {
    match = { theme: THEMES.find((t) => t.id === 'company_news')!, score: 0.5 }
  }

  const base = {
    companies,
    outside,
    mentionedSectors,
    focus: [] as string[],
  }

  if (!match) {
    return {
      ...base,
      verdict: otherScript ? 'non_english' : 'not_event',
      classification: unrecognised(mentionedSectors),
      channel: null,
      label: null,
      polarity: 'neutral',
      scope: 'macro',
    }
  }

  const { theme } = match
  const themed = theme.polarity?.(text) ?? null
  const polarity: Polarity = themed ?? genericPolarity
  let outcome = theme.resolve(polarity, text)

  const scope: 'company' | 'macro' =
    theme.scope === 'company' || (theme.scope === 'mixed' && companies.length > 0) ? 'company' : 'macro'

  // Whether "neutral" is a real state for this channel or just "not said".
  const directionSensitive = theme.resolve('up', text).direction !== theme.resolve('down', text).direction
  const unstated = polarity === 'neutral' && directionSensitive && !theme.hasNeutral
  if (unstated) {
    outcome = {
      direction: 'NEUTRAL',
      sectors: outcome.sectors,
      mechanism:
        `The text points to the ${theme.label} channel but does not say which way it moved, so no direction can be assigned. ` +
        (outcome.sectors.length > 0
          ? `${outcome.sectors.slice(0, 3).join(', ')} are the sectors this channel reaches; which way it pushes them depends on the direction of the move.`
          : ''),
    }
  }

  // Company channels reach the companies named; failing that, the sectors
  // named ("bank earnings beat estimates"). Macro channels reach their own
  // sectors plus any the text names, plus the named companies' sectors.
  const companySectors = companies.map((c) => c.sector as Sector)
  const sectors: Sector[] =
    scope === 'company'
      ? Array.from(new Set<Sector>(companies.length > 0 ? companySectors : (mentionedSectors as Sector[])))
      : // A tax change on a named product reaches that product's makers only:
        // a GST cut on cars is not a tailwind for soap.
        theme.id === 'fiscal' && /\b(gst|income tax|tax cut|excise)\b/.test(text) && mentionedSectors.length > 0
        ? Array.from(new Set<Sector>([...(mentionedSectors as Sector[]), ...companySectors]))
        : // Sectors the text names lead: it is telling us where to look.
          Array.from(new Set<Sector>([...(mentionedSectors as Sector[]), ...companySectors, ...outcome.sectors]))

  const intensity = countMoves(text, INTENSITY_WORDS).count
  const magnitude = clamp(
    theme.baseMagnitude +
      Math.min(intensity, 3) * 6 +
      (hasFigure(text) ? 5 : 0) +
      sizeBoost(text) +
      (outcome.direction === 'NEUTRAL' && theme.id !== 'ma' ? -20 : 0),
    10,
    95
  )

  // Confidence rises with how strongly the text matched and whether the
  // direction is actually determined, and is capped below the LLM's ceiling
  // so a rules answer never presents as more certain than a reasoned one.
  const confidence = clamp(
    38 + Math.min(match.score, 3) * 9 + (polarity === 'neutral' ? 0 : 10) + (hasFigure(text) ? 5 : 0),
    30,
    78
  )

  const directionWord =
    outcome.direction === 'POSITIVE' ? 'a tailwind' : outcome.direction === 'NEGATIVE' ? 'a headwind' : 'broadly neutral'
  const subject =
    scope === 'company' && companies.length > 0
      ? companies.map((c) => c.name).slice(0, 3).join(', ')
      : sectors.slice(0, 3).join(', ')

  const classification: EventClassification = {
    event_type: theme.eventType,
    economic_variable: theme.economicVariable,
    direction: outcome.direction,
    magnitude,
    affected_sectors: sectors,
    confidence,
    reasoning:
      `Read as ${theme.label === 'company news' ? 'company news' : `the ${theme.label} channel`}` +
      (polarity === 'neutral' ? (unstated ? ', with no direction stated' : ', with nothing moving') : `, moving ${polarity}`) +
      `. That is ${directionWord} for ${subject || 'the market'}. ` +
      'Classified offline by deterministic rules, so the direction reflects the standard transmission mechanism rather than a judgement about this particular instance.',
    transmission_explanation: outcome.mechanism,
    // The impact table's key: a tax change reaches households, a capex
    // change the infrastructure chain, though both are "fiscal".
    channel: theme.id === 'fiscal' && /\b(gst|income tax|tax cut|excise)\b/.test(text) ? 'fiscal_tax' : theme.id,
    scope,
    companies: companies.map((c) => c.symbol),
  }

  let verdict: EventVerdict = 'ok'
  if (scope === 'company' && companies.length === 0 && mentionedSectors.length === 0) {
    verdict = outside.length > 0 ? 'outside_universe' : 'needs_company'
  } else if (unstated) {
    verdict = 'no_direction'
  } else if (sectors.length === 0) {
    verdict = outside.length > 0 ? 'outside_universe' : 'no_sector'
  } else if (
    // A question about a company ("should I buy Reliance?") that happens to
    // contain a channel word is still a request for advice, not an event.
    ADVICE_RE.test(text) &&
    match.score < 1.5 &&
    polarity === 'neutral'
  ) {
    verdict = 'not_event'
  }

  return {
    ...base,
    focus: theme.focus ?? [],
    verdict,
    classification,
    channel: theme.id,
    label: theme.label,
    polarity,
    scope,
  }
}

function unrecognised(mentionedSectors: string[]): EventClassification {
  // Nothing recognised. Say so plainly rather than guessing a direction — a
  // fabricated NEGATIVE here would flow straight into the scoring engine.
  const sectors = mentionedSectors.length > 0 ? mentionedSectors : ['Diversified']
  return {
    event_type: 'OTHER',
    economic_variable: 'OTHER',
    direction: 'NEUTRAL',
    magnitude: 30,
    affected_sectors: sectors,
    confidence: 25,
    reasoning:
      'This event did not match any known transmission channel in the offline rule engine, so it is treated as low-magnitude and directionally neutral. ' +
      (mentionedSectors.length > 0
        ? `Sector exposure is taken from the companies and sectors named in the text (${mentionedSectors.join(', ')}).`
        : 'No specific sector was identified in the text.'),
    transmission_explanation:
      'No standard macro or corporate transmission channel was recognised in this text. Without an identified economic variable there is no mechanism to trace from event to sector to company, so the scores below rest on company fundamentals and valuation rather than on event impact.',
  }
}

/**
 * Which way the event's underlying variable moved, using the matched
 * channel's own reading where it has one (see Theme.polarity).
 */
export function polarityFor(text: string): Polarity {
  return assessEvent(text).polarity
}

export function classifyEventByRules(eventText: string): EventClassification {
  return assessEvent(eventText).classification
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function categorizeNewsByRules(title: string, description: string): NewsCategorization {
  const text = `${title} ${description || ''}`.toLowerCase()
  const read = assessEvent(text)
  const indiaHits = countKeywords(text, INDIA_MARKET_KEYWORDS)
  const matched = read.channel !== null

  // Relevant if it names an Indian-market subject or company, or matches a
  // macro channel that transmits into Indian equities regardless of where it
  // happened.
  const isRelevant =
    indiaHits > 0 ||
    read.companies.length > 0 ||
    (matched && read.mentionedSectors.length > 0) ||
    ['crude', 'global', 'fed', 'gold', 'trade', 'geopolitical'].includes(read.channel ?? '')

  return {
    is_market_relevant: isRelevant,
    event_type: matched ? read.classification.event_type : 'OTHER',
    affected_sectors: matched ? read.classification.affected_sectors : read.mentionedSectors,
    relevance_score: clamp(
      (matched ? 45 : 15) + indiaHits * 8 + read.mentionedSectors.length * 6 + read.companies.length * 6 +
        (matched ? read.classification.magnitude / 10 : 0),
      0,
      100
    ),
  }
}

/** "Fuel is…" → "fuel is…", leaving acronyms such as "NBFCs" alone. */
function lowerFirst(text: string): string {
  return /^[A-Z](?![A-Z])/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

/**
 * Deterministic stand-in for the LLM's bull/bear/risk narrative.
 *
 * Everything it says is derived from the scores it is handed — it states what
 * the numbers are and what would have to be true for them to be wrong. It
 * invents no figures, which is the same constraint the LLM path is under.
 */
export function buildCounterArgumentFromRules(input: DecisionInput): DecisionOutput {
  const {
    stockSymbol, compositeScore, fundamentalScore, valuationScore,
    technicalScore, riskScore, eventDirection, eventMagnitude,
    eventPositives = [], eventNegatives = [],
  } = input

  const strengths: string[] = []
  const weaknesses: string[] = []
  const unavailable: string[] = []
  const add = (label: string, score: number | null, high: string, low: string) => {
    // A factor with no sourced data is neither a strength nor a weakness; it
    // is a gap, and naming it is more honest than quietly omitting it.
    if (score === null) {
      unavailable.push(label)
      return
    }
    if (score >= 60) strengths.push(`${label} ${score}/100 — ${high}`)
    else if (score <= 45) weaknesses.push(`${label} ${score}/100 — ${low}`)
  }

  add('fundamentals', fundamentalScore, 'returns on capital and growth are holding up', 'profitability or growth is below par')
  add('valuation', valuationScore, 'it trades below its sector multiple', 'it already trades at a premium to its sector')
  add('technicals', technicalScore, 'price is above its moving averages with supportive momentum', 'price momentum is against the thesis')
  add('risk', riskScore, 'leverage and volatility are contained', 'leverage or volatility is elevated')

  // Every company-level factor missing is a different situation from every
  // one of them scoring mid-range, and the two used to read identically.
  const nothingScored = strengths.length === 0 && weaknesses.length === 0 && unavailable.length === 4

  const directionPhrase =
    eventDirection === 'POSITIVE' ? 'a tailwind' : eventDirection === 'NEGATIVE' ? 'a headwind' : 'directionally neutral'

  const verdict =
    compositeScore >= 70 ? 'supports acting on the event'
      : compositeScore >= 50 ? 'is balanced enough to warrant watching rather than acting'
        : 'does not support acting on the event'

  return {
    bullCase:
      `The composite score of ${compositeScore}/100 for ${stockSymbol} sits against an event read as ${directionPhrase} ` +
      `at magnitude ${eventMagnitude}/100` +
      (eventPositives.length > 0 ? ` — ${lowerFirst(eventPositives[0])} ` : '. ') +
      (strengths.length > 0
        ? `The supporting components are ${strengths.join('; ')}.`
        : nothingScored
          ? 'No company-level component could be scored at all, so there is no company-specific case here — only the event read.'
          : 'No individual component scores strongly here, so the case rests on the event rather than on the company.'),
    bearCase:
      (eventNegatives.length > 0 ? `Through the event itself, ${lowerFirst(eventNegatives[0])} ` : '') +
      (weaknesses.length > 0
        ? `The case breaks where ${weaknesses.join('; ')}. Any of those can absorb the event’s benefit before it reaches shareholders.`
        : nothingScored
          ? 'The risk is the missing evidence itself: with no fundamental, valuation, technical or risk input sourced, nothing here distinguishes this company from any other name in the same sector.'
          : `No component scores poorly, which is itself the risk: with nothing obviously cheap or mispriced, much of the event may already be in the price, and the ${eventMagnitude}/100 magnitude may be the market’s estimate rather than an edge.`) +
      (unavailable.length > 0
        ? ` Note also that ${unavailable.join(' and ')} could not be sourced for this stock, so the composite rests on less evidence than a full score would.`
        : ''),
    contradictoryEvidence:
      valuationScore !== null && valuationScore <= 45
        ? `Valuation at ${valuationScore}/100 disagrees with the thesis — the market is already paying up for this name, so the event has to exceed expectations, not merely meet them.`
        : technicalScore !== null && technicalScore <= 45
          ? `Technicals at ${technicalScore}/100 disagree with the thesis — price is not yet behaving as though the event helps, which either means the market disputes the mechanism or it has not reacted yet.`
          : riskScore !== null && riskScore <= 45
            ? `Risk at ${riskScore}/100 disagrees with the thesis — the balance sheet or volatility profile makes this name a poor vehicle for the view even if the view is right.`
            : nothingScored
              ? 'Nothing can contradict the thesis here, because no company-level component was scored — which is itself the weakest possible footing for a view.'
              : 'No component contradicts the thesis outright; the strongest counterpoint is that a well-scored, well-known name is where an event is most likely to already be priced in.',
    keyRisks: [
      eventDirection === 'NEGATIVE'
        ? 'The event may prove milder or shorter-lived than the magnitude implies, making the sell-off the opportunity rather than the risk.'
        : eventDirection === 'POSITIVE' && eventNegatives.length > 0
          ? 'The offsetting channel may dominate: the costs this event also imposes can arrive faster than the benefit is realised.'
        : 'The event may already be priced in, leaving no move even if the mechanism plays out exactly as described.',
      riskScore !== null && riskScore <= 55
        ? `Elevated leverage or volatility (risk ${riskScore}/100) amplifies the downside if the event goes the other way.`
        : 'Company-specific execution can override a correct sector call.',
      'Transmission from a macro event to a single company is indirect: the mechanism can hold at sector level while this particular name diverges.',
    ],
    finalReasoning:
      `On the deterministic scores alone, ${stockSymbol} at ${compositeScore}/100 ${verdict}. ` +
      'This narrative was generated offline from those scores rather than by the language model, so it summarises the numbers and their weak points without adding outside judgement.',
  }
}
