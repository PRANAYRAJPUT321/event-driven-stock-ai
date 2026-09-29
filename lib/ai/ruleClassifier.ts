import type {
  DecisionInput,
  DecisionOutput,
  EventClassification,
  NewsCategorization,
} from './eventClassifier'

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
 */

// Only sectors that actually have stocks seeded (database/seed.sql) are worth
// emitting: naming a sector with no listed companies yields an analysis with
// nothing to score.
type Sector =
  | 'Banking' | 'IT' | 'Energy' | 'Auto' | 'FMCG' | 'Pharma' | 'Financials'
  | 'Metals' | 'Telecom' | 'Utilities' | 'Engineering' | 'Cement' | 'Chemicals'
  | 'Consumer' | 'Retail' | 'Diversified' | 'Aviation' | 'Ports'

type Polarity = 'up' | 'down' | 'neutral'

interface Theme {
  id: string
  eventType: string
  economicVariable: string
  /** Matched case-insensitively against the whole text. */
  keywords: string[]
  /** Base magnitude before intensity/number boosts. */
  baseMagnitude: number
  /**
   * Given the direction the underlying variable moved, the market read.
   * `sectors` are the ones whose earnings this channel actually touches.
   */
  resolve: (polarity: Polarity) => {
    direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
    sectors: Sector[]
    mechanism: string
  }
}

const UP_WORDS = [
  'hike', 'hikes', 'hiked', 'raise', 'raises', 'raised', 'increase', 'increases',
  'increased', 'rise', 'rises', 'rising', 'rose', 'surge', 'surges', 'surged',
  'jump', 'jumps', 'jumped', 'climb', 'climbs', 'climbed', 'higher', 'gain',
  'gains', 'rally', 'rallies', 'spike', 'spikes', 'up', 'accelerate',
  'accelerates', 'beat', 'beats', 'strong', 'record high', 'expands', 'widens',
  'upgrade', 'upgrades', 'boost', 'tightening', 'tightens', 'quickens',
  'rebound', 'rebounds', 'recovers', 'improves', 'soars', 'soar', 'picks up',
]

const DOWN_WORDS = [
  'cut', 'cuts', 'slash', 'slashes', 'slashed', 'reduce', 'reduces', 'reduced',
  'lower', 'lowers', 'lowered', 'fall', 'falls', 'fell', 'falling', 'drop',
  'drops', 'dropped', 'decline', 'declines', 'declined', 'slump', 'slumps',
  'plunge', 'plunges', 'plunged', 'crash', 'crashes', 'tumble', 'tumbles',
  'down', 'weak', 'weakens', 'weaker', 'miss', 'misses', 'missed', 'contract',
  'contracts', 'shrink', 'shrinks', 'narrows', 'downgrade', 'downgrades',
  'ease', 'eases', 'eased', 'easing', 'cools', 'cooled', 'softens',
  'slow', 'slows', 'slowed', 'slowing', 'slowdown', 'moderates', 'moderated',
  'decelerate', 'decelerates', 'dips', 'sinks', 'sluggish', 'tepid', 'sags',
]

const INTENSITY_WORDS = [
  'sharp', 'sharply', 'record', 'historic', 'unprecedented', 'massive', 'steep',
  'crisis', 'shock', 'emergency', 'surprise', 'unexpected', 'biggest', 'worst',
  'best', 'soars', 'collapse', 'plummet',
]

const HOLD_WORDS = ['unchanged', 'holds', 'held', 'keeps', 'kept', 'status quo', 'pause', 'paused', 'maintains']

const THEMES: Theme[] = [
  {
    id: 'policy_rate',
    eventType: 'MONETARY_POLICY',
    economicVariable: 'INTEREST_RATE',
    keywords: [
      'repo rate', 'reverse repo', 'policy rate', 'interest rate', 'monetary policy',
      'rbi mpc', 'mpc', 'monetary policy committee', 'crr', 'cash reserve ratio',
      'slr', 'rate hike', 'rate cut', 'benchmark rate', 'lending rate', 'rbi policy',
    ],
    baseMagnitude: 70,
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
              sectors: ['Banking', 'Financials'],
              mechanism:
                'Rates held steady removes a near-term swing factor rather than creating one. The read-through is mostly in the accompanying commentary — guidance on inflation and liquidity — rather than in the rate itself.',
            },
  },
  {
    id: 'inflation',
    eventType: 'INFLATION',
    economicVariable: 'INFLATION',
    keywords: ['inflation', 'cpi', 'wpi', 'consumer price', 'wholesale price', 'price rise', 'retail inflation', 'food prices'],
    baseMagnitude: 60,
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
    id: 'crude',
    eventType: 'COMMODITY_SHOCK',
    economicVariable: 'OIL_PRICE',
    keywords: ['crude', 'crude oil', 'oil price', 'brent', 'wti', 'opec', 'petrol price', 'diesel price', 'fuel price', 'natural gas', 'lng'],
    baseMagnitude: 65,
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Aviation', 'Chemicals', 'Auto', 'Energy'],
            mechanism:
              'India imports most of its crude, so a higher oil price is an immediate cost shock for fuel-intensive businesses (airlines, logistics) and for petrochemical feedstock users. It also widens the current account deficit and pressures the rupee, importing inflation. Upstream producers are the exception — they realise higher prices.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Aviation', 'Chemicals', 'Auto', 'Energy'],
            mechanism:
              'Cheaper crude cuts fuel and feedstock costs straight through to operating margins for airlines, logistics and chemicals, and narrows the import bill, which supports the rupee and cools inflation. Upstream producers realise lower prices and are the offset.',
          },
  },
  {
    id: 'currency',
    eventType: 'CURRENCY',
    economicVariable: 'CURRENCY',
    keywords: ['rupee', 'usd/inr', 'usdinr', 'dollar index', 'forex', 'currency', 'depreciation', 'appreciation', 'exchange rate', 'forex reserves'],
    baseMagnitude: 55,
    resolve: (polarity) =>
      // A "falling rupee" is a weaker rupee: good for exporters, bad for
      // importers. The polarity here is the rupee's own direction.
      polarity === 'down'
        ? {
            direction: 'POSITIVE',
            sectors: ['IT', 'Pharma', 'Metals'],
            mechanism:
              'A weaker rupee raises the rupee value of every dollar billed, so exporters — IT services and generic pharma above all — see revenue and margin translate upward with no change in volume. The mirror image is importers and anyone with unhedged dollar debt, who pay more.',
          }
        : {
            direction: 'NEGATIVE',
            sectors: ['IT', 'Pharma', 'Energy'],
            mechanism:
              'A stronger rupee shrinks the rupee value of dollar revenue, compressing exporters’ realisations and margins. Importers and dollar-debt borrowers benefit, which is why the read is sector-split rather than market-wide.',
          },
  },
  {
    id: 'growth',
    eventType: 'GDP',
    economicVariable: 'GDP',
    keywords: ['gdp', 'economic growth', 'growth rate', 'iip', 'industrial production', 'pmi', 'manufacturing output', 'economic survey', 'recession', 'slowdown'],
    baseMagnitude: 60,
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
    eventType: 'GOVERNMENT_POLICY',
    economicVariable: 'OTHER',
    keywords: ['budget', 'union budget', 'fiscal deficit', 'capex', 'capital expenditure', 'pli', 'production linked incentive', 'subsidy', 'gst', 'infrastructure push', 'divestment', 'import duty', 'export duty', 'tariff'],
    baseMagnitude: 65,
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Engineering', 'Cement', 'Metals', 'Utilities'],
            mechanism:
              'Lower government spending or a harsher duty/tax regime removes demand that the infrastructure chain depends on: fewer tenders for capital goods, less cement and steel offtake, and slower utility capacity addition.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Engineering', 'Cement', 'Metals', 'Utilities'],
            mechanism:
              'Higher government capital spending or a favourable incentive/duty change flows into the infrastructure chain in order: capital-goods order books first, then cement and steel volumes, then the utilities and ports that carry the output.',
          },
  },
  {
    id: 'earnings',
    eventType: 'EARNINGS',
    economicVariable: 'CORPORATE',
    keywords: ['earnings', 'quarterly results', 'q1 results', 'q2 results', 'q3 results', 'q4 results', 'net profit', 'revenue', 'guidance', 'margin', 'ebitda', 'profit after tax', 'topline', 'bottomline', 'order book'],
    baseMagnitude: 50,
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Diversified'],
            mechanism:
              'Weaker reported earnings or guidance lowers the forward estimates the market capitalises, so the de-rating is a function of both the miss itself and how much of the growth was already in the price.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Diversified'],
            mechanism:
              'Stronger reported earnings or raised guidance pushes forward estimates up, and the re-rating depends on whether the beat is seen as a one-off or the start of a trend.',
          },
  },
  {
    id: 'global',
    eventType: 'GLOBAL_MARKET_SHOCK',
    economicVariable: 'OTHER',
    keywords: ['federal reserve', 'us fed', 'fomc', 'treasury yield', 'wall street', 'nasdaq', 'dow jones', 's&p 500', 'global markets', 'trade war', 'china economy', 'foreign investors', 'fii', 'fpi'],
    baseMagnitude: 60,
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
    eventType: 'GEOPOLITICAL',
    economicVariable: 'OTHER',
    keywords: ['war', 'conflict', 'sanctions', 'military', 'attack', 'border tension', 'strait', 'shipping route', 'red sea', 'geopolitical', 'invasion', 'ceasefire'],
    baseMagnitude: 65,
    resolve: (polarity) =>
      polarity === 'up'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Energy', 'Aviation', 'Ports', 'Chemicals'],
            mechanism:
              'Conflict and sanctions raise energy prices and freight/insurance costs and lengthen supply routes, so the cost shock reaches fuel-intensive and import-dependent businesses first. Risk premia rise across the market alongside it.',
          }
        : {
            direction: 'POSITIVE',
            sectors: ['Energy', 'Aviation', 'Ports'],
            mechanism:
              'De-escalation unwinds the energy and freight risk premium, lowering fuel and shipping costs and normalising trade routes for importers and logistics-linked businesses.',
          },
  },
  {
    id: 'regulatory',
    eventType: 'REGULATORY',
    economicVariable: 'OTHER',
    keywords: ['sebi', 'regulator', 'regulation', 'norms', 'penalty', 'probe', 'investigation', 'ban', 'compliance', 'licence', 'license', 'antitrust', 'cci', 'trai', 'usfda', 'import curb'],
    baseMagnitude: 55,
    resolve: () => ({
      direction: 'NEGATIVE',
      sectors: ['Banking', 'Financials', 'Pharma', 'Telecom'],
      mechanism:
        'Tighter regulation or an enforcement action raises compliance cost and caps a revenue line or a business practice, and the overhang usually persists until the scope of the order is known. Regulated sectors — lenders, pharma exporters facing the USFDA, telecom — carry the most of it.',
    }),
  },
  {
    id: 'ratings',
    eventType: 'CREDIT_RATING',
    economicVariable: 'OTHER',
    keywords: ['credit rating', 'moody', 'fitch', 's&p global ratings', 'crisil', 'icra', 'rating outlook', 'sovereign rating', 'downgrade', 'upgrade'],
    baseMagnitude: 50,
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
    id: 'ma',
    eventType: 'M&A',
    economicVariable: 'CORPORATE',
    keywords: ['acquisition', 'acquires', 'merger', 'merges', 'takeover', 'stake sale', 'buyout', 'open offer', 'demerger', 'joint venture'],
    baseMagnitude: 55,
    resolve: () => ({
      direction: 'POSITIVE',
      sectors: ['Diversified'],
      mechanism:
        'A transaction re-prices the target towards the deal value and changes the acquirer’s earnings mix and leverage. The market’s read depends on the price paid and how it is funded, so the acquirer and the target usually move in opposite directions.',
    }),
  },
  {
    id: 'capital_return',
    eventType: 'DIVIDEND',
    economicVariable: 'CORPORATE',
    keywords: ['dividend', 'buyback', 'bonus issue', 'stock split', 'special dividend', 'record date'],
    baseMagnitude: 35,
    resolve: () => ({
      direction: 'POSITIVE',
      sectors: ['Diversified'],
      mechanism:
        'Returning capital signals management’s confidence in cash generation and reduces the equity base in a buyback, but it is a distribution of value rather than creation of it — the earnings power of the business is unchanged.',
    }),
  },
  {
    id: 'management',
    eventType: 'MANAGEMENT_CHANGE',
    economicVariable: 'CORPORATE',
    keywords: ['ceo', 'managing director', 'resigns', 'resignation', 'steps down', 'appoints', 'appointment', 'chairman', 'cfo', 'board approves'],
    baseMagnitude: 40,
    resolve: (polarity) =>
      polarity === 'down'
        ? {
            direction: 'NEGATIVE',
            sectors: ['Diversified'],
            mechanism:
              'An unplanned senior departure creates execution and continuity risk, and the market discounts strategy until a successor and their mandate are known.',
          }
        : {
            direction: 'NEUTRAL',
            sectors: ['Diversified'],
            mechanism:
              'A leadership appointment matters through the strategy it signals rather than through near-term earnings; the re-rating, if any, follows the new management’s stated priorities.',
          },
  },
  {
    id: 'employment',
    eventType: 'EMPLOYMENT',
    economicVariable: 'OTHER',
    keywords: ['unemployment', 'jobs data', 'payrolls', 'hiring', 'layoff', 'layoffs', 'job cuts', 'employment rate'],
    baseMagnitude: 45,
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
]

/** Direct sector mentions add to whatever the theme implies. */
const SECTOR_KEYWORDS: Record<Sector, string[]> = {
  Banking: ['bank', 'banks', 'banking', 'hdfc bank', 'icici', 'sbi', 'axis bank', 'kotak'],
  IT: ['it sector', 'it stocks', 'software', 'infosys', 'tcs', 'wipro', 'hcl tech', 'tech mahindra', 'it services'],
  Energy: ['oil and gas', 'refiner', 'reliance industries', 'ongc', 'coal india', 'ntpc', 'energy sector'],
  Auto: ['auto', 'automobile', 'car sales', 'maruti', 'two-wheeler', 'passenger vehicle', 'bajaj auto'],
  FMCG: ['fmcg', 'consumer goods', 'itc', 'nestle', 'britannia', 'hindustan unilever'],
  Pharma: ['pharma', 'pharmaceutical', 'drug', 'sun pharma', 'usfda', 'generic'],
  Financials: ['nbfc', 'financial services', 'bajaj finance', 'insurance', 'lending'],
  Metals: ['steel', 'metal', 'aluminium', 'copper', 'tata steel', 'jsw steel', 'hindalco'],
  Telecom: ['telecom', 'airtel', 'jio', 'vodafone idea', 'spectrum', 'tariff hike'],
  Utilities: ['power sector', 'electricity', 'power grid', 'discom', 'renewable'],
  Engineering: ['capital goods', 'larsen', 'l&t', 'infrastructure', 'construction', 'engineering'],
  Cement: ['cement', 'ultratech', 'shree cement', 'ambuja'],
  Chemicals: ['chemical', 'specialty chemicals', 'petrochemical', 'fertiliser', 'fertilizer'],
  Consumer: ['consumer demand', 'discretionary', 'consumption', 'asian paints', 'paints'],
  Retail: ['retail', 'dmart', 'avenue supermarts', 'quick commerce', 'e-commerce'],
  Diversified: ['conglomerate', 'group companies'],
  Aviation: ['aviation', 'airline', 'indigo', 'air india', 'air fares'],
  Ports: ['port', 'ports', 'shipping', 'cargo', 'adani ports', 'logistics'],
}

/** Words that mean this text is about Indian markets at all. */
const INDIA_MARKET_KEYWORDS = [
  'india', 'indian', 'nifty', 'sensex', 'rbi', 'sebi', 'nse', 'bse', 'rupee',
  'mumbai', 'dalal street', 'crore', 'lakh', 'gst',
]

function countMatches(haystack: string, needles: string[]): number {
  let count = 0
  for (const needle of needles) {
    // Word-boundary match so "up" doesn't fire inside "upstream" and "cut"
    // doesn't fire inside "execute".
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, 'i')
    if (pattern.test(haystack)) count++
  }
  return count
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Index of the earliest whole-word match, or -1. */
function firstMatchIndex(haystack: string, needles: string[]): number {
  let earliest = -1
  for (const needle of needles) {
    const match = haystack.match(
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`, 'i')
    )
    if (match?.index !== undefined && (earliest === -1 || match.index < earliest)) {
      earliest = match.index
    }
  }
  return earliest
}

function detectPolarity(text: string): Polarity {
  // "Held unchanged" beats any incidental up/down word in the same sentence.
  if (countMatches(text, HOLD_WORDS) > 0 && countMatches(text, ['hike', 'cut', 'raise']) === 0) {
    return 'neutral'
  }
  const up = countMatches(text, UP_WORDS)
  const down = countMatches(text, DOWN_WORDS)
  if (up === 0 && down === 0) return 'neutral'
  if (up !== down) return up > down ? 'up' : 'down'

  // Equal counts: headlines lead with the move and trail with its cause
  // ("Brent crude surges after OPEC output cut"), so the word that appears
  // first is the one describing the event.
  const upAt = firstMatchIndex(text, UP_WORDS)
  const downAt = firstMatchIndex(text, DOWN_WORDS)
  if (upAt === -1 || downAt === -1 || upAt === downAt) return 'neutral'
  return upAt < downAt ? 'up' : 'down'
}

function detectSectors(text: string): Sector[] {
  const found: Sector[] = []
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS) as [Sector, string[]][]) {
    if (countMatches(text, keywords) > 0) found.push(sector)
  }
  return found
}

interface ThemeMatch {
  theme: Theme
  score: number
}

function bestTheme(text: string): ThemeMatch | null {
  let best: ThemeMatch | null = null
  for (const theme of THEMES) {
    const score = countMatches(text, theme.keywords)
    if (score > 0 && (!best || score > best.score)) best = { theme, score }
  }
  return best
}

/** A percentage or basis-point figure signals a concrete, sized event. */
function hasFigure(text: string): boolean {
  return /\d+(\.\d+)?\s*(%|per cent|percent|bps|basis points)/i.test(text)
}

export function classifyEventByRules(eventText: string): EventClassification {
  const text = eventText.toLowerCase()
  const match = bestTheme(text)
  const polarity = detectPolarity(text)
  const mentionedSectors = detectSectors(text)

  const intensity = countMatches(text, INTENSITY_WORDS)

  if (!match) {
    // Nothing recognised. Say so plainly rather than guessing a direction —
    // a fabricated NEGATIVE here would flow straight into the scoring engine.
    const sectors = mentionedSectors.length > 0 ? mentionedSectors : ['Diversified' as Sector]
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

  const { theme } = match
  let outcome = theme.resolve(polarity)

  // A theme whose read flips with the variable's direction must not answer
  // POSITIVE or NEGATIVE when the text never said which way it moved — that
  // would be a coin flip fed straight into the scoring engine. Themes that
  // handle 'neutral' themselves (policy rate) keep their own answer.
  const directionSensitive = theme.resolve('up').direction !== theme.resolve('down').direction
  if (polarity === 'neutral' && directionSensitive && outcome.direction !== 'NEUTRAL') {
    outcome = {
      direction: 'NEUTRAL',
      sectors: outcome.sectors,
      mechanism:
        `The text points to the ${theme.economicVariable.toLowerCase().replace(/_/g, ' ')} channel but does not ` +
        `say which way the variable moved, so no direction can be assigned to it. ` +
        `${outcome.sectors.slice(0, 3).join(', ')} are the sectors this channel transmits to; which way it ` +
        'pushes them depends on the direction of the move.',
    }
  }

  // Union of the channel's own sectors and any the text named directly.
  const sectors = Array.from(new Set<Sector>([...outcome.sectors, ...mentionedSectors]))

  const magnitude = clamp(
    theme.baseMagnitude +
      intensity * 8 +
      (hasFigure(text) ? 6 : 0) +
      (outcome.direction === 'NEUTRAL' ? -25 : 0),
    10,
    95
  )

  // Confidence rises with how strongly the text matched and whether the
  // direction is actually determined, and is capped below the LLM's ceiling
  // so a rules answer never presents as more certain than a reasoned one.
  const confidence = clamp(
    38 + match.score * 9 + (polarity === 'neutral' ? 0 : 10) + (hasFigure(text) ? 5 : 0),
    30,
    78
  )

  const directionWord =
    outcome.direction === 'POSITIVE' ? 'a tailwind' : outcome.direction === 'NEGATIVE' ? 'a headwind' : 'broadly neutral'

  return {
    event_type: theme.eventType,
    economic_variable: theme.economicVariable,
    direction: outcome.direction,
    magnitude,
    affected_sectors: sectors,
    confidence,
    reasoning:
      `Matched the ${theme.economicVariable.toLowerCase().replace(/_/g, ' ')} channel from the event text, ` +
      `with the variable moving ${polarity === 'neutral' ? 'sideways' : polarity}. ` +
      `That is ${directionWord} for ${sectors.slice(0, 3).join(', ')}. ` +
      'Classified offline by deterministic rules, so the direction reflects the standard transmission mechanism rather than a judgement about this particular instance.',
    transmission_explanation: outcome.mechanism,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function categorizeNewsByRules(title: string, description: string): NewsCategorization {
  const text = `${title} ${description || ''}`.toLowerCase()
  const match = bestTheme(text)
  const sectors = detectSectors(text)
  const indiaHits = countMatches(text, INDIA_MARKET_KEYWORDS)

  // Relevant if it names an Indian-market subject, or matches a macro channel
  // that transmits into Indian equities regardless of where it happened.
  const isRelevant = indiaHits > 0 || (match !== null && sectors.length > 0) || match?.theme.id === 'crude' || match?.theme.id === 'global'

  const classification = match ? classifyEventByRules(text) : null

  return {
    is_market_relevant: isRelevant,
    event_type: classification?.event_type ?? 'OTHER',
    affected_sectors: classification?.affected_sectors ?? sectors,
    relevance_score: clamp(
      (match ? 45 : 15) + indiaHits * 8 + sectors.length * 6 + (classification ? classification.magnitude / 10 : 0),
      0,
      100
    ),
  }
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

  const directionPhrase =
    eventDirection === 'POSITIVE' ? 'a tailwind' : eventDirection === 'NEGATIVE' ? 'a headwind' : 'directionally neutral'

  const verdict =
    compositeScore >= 70 ? 'supports acting on the event'
      : compositeScore >= 50 ? 'is balanced enough to warrant watching rather than acting'
        : 'does not support acting on the event'

  return {
    bullCase:
      `The composite score of ${compositeScore}/100 for ${stockSymbol} sits against an event read as ${directionPhrase} ` +
      `at magnitude ${eventMagnitude}/100. ` +
      (strengths.length > 0
        ? `The supporting components are ${strengths.join('; ')}.`
        : 'No individual component scores strongly here, so the case rests on the event rather than on the company.'),
    bearCase:
      (weaknesses.length > 0
        ? `The case breaks where ${weaknesses.join('; ')}. Any of those can absorb the event’s benefit before it reaches shareholders.`
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
            : 'No component contradicts the thesis outright; the strongest counterpoint is that a well-scored, well-known name is where an event is most likely to already be priced in.',
    keyRisks: [
      eventDirection === 'NEGATIVE'
        ? 'The event may prove milder or shorter-lived than the magnitude implies, making the sell-off the opportunity rather than the risk.'
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
