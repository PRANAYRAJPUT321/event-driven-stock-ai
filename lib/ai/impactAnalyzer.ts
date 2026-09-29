import { classifyEventByRules, detectPolarity, type Polarity } from './ruleClassifier'

/**
 * Two-sided impact analysis for a news item.
 *
 * The classifier answers "which way does this push the market", which is one
 * number and hides the more useful truth: almost every macro event helps some
 * companies and hurts others through the same mechanism. A crude spike is a
 * cost shock to an airline and a revenue windfall to an upstream producer. A
 * rate hike compresses loan demand and widens a bank's spread on floating-rate
 * assets. Reporting only the net direction throws that away.
 *
 * So each channel below carries both sides explicitly, and the per-entity read
 * is assembled from whichever side actually applies to that sector. An entity
 * with material points on both sides is reported MIXED rather than forced to a
 * direction.
 *
 * Deterministic and offline, like the classifier it sits on: no key, no
 * network, no per-request cost.
 */

export type ImpactDirection = 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL'

export interface ImpactPoint {
  /** The claim, written to stand on its own in a bullet list. */
  text: string
  /** Sectors this point applies to; empty means it applies broadly. */
  sectors: string[]
}

export interface EntityImpact {
  entity: string
  kind: 'sector' | 'company'
  sector: string
  direction: ImpactDirection
  /** 0-100. Lower when the channel is unrecognised or the sides are balanced. */
  confidence: number
  positives: string[]
  negatives: string[]
  /** One sentence on how the event reaches this entity at all. */
  mechanism: string
}

interface SidedImpact {
  positives: ImpactPoint[]
  negatives: ImpactPoint[]
  mechanism: string
}

/**
 * Both sides of each transmission channel, keyed by the theme id the
 * classifier reports and the direction the underlying variable moved.
 */
const CHANNEL_IMPACTS: Record<string, Partial<Record<Polarity, SidedImpact>>> = {
  policy_rate: {
    up: {
      mechanism:
        'A higher policy rate raises the cost of money, which reaches lenders through their funding costs and borrowers through their EMIs.',
      positives: [
        { text: 'Banks reprice floating-rate loans upward faster than they reprice deposits, so net interest margin widens in the first few quarters.', sectors: ['Banking'] },
        { text: 'Insurers and lenders earn more on the cash and bond portfolios they are required to hold.', sectors: ['Banking', 'Financials'] },
        { text: 'A higher rate differential can attract foreign debt flows, supporting the rupee and cheapening imported inputs.', sectors: ['Energy', 'Chemicals'] },
        { text: 'Companies with net cash on the balance sheet earn more on it and gain a relative advantage over leveraged competitors.', sectors: ['IT', 'FMCG'] },
      ],
      negatives: [
        { text: 'Loan growth slows as borrowing costs rise, shrinking the pool of new credit.', sectors: ['Banking', 'Financials'] },
        { text: 'Deposit costs catch up within two to three quarters, giving back the initial margin gain.', sectors: ['Banking'] },
        { text: 'EMI-driven demand for vehicles and homes is deferred, hitting volumes directly.', sectors: ['Auto', 'Realty', 'Consumer'] },
        { text: 'Highly leveraged balance sheets face higher interest costs, compressing net profit.', sectors: ['Utilities', 'Engineering', 'Metals'] },
        { text: 'Higher discount rates compress the valuation of long-duration growth stories.', sectors: ['IT', 'Consumer', 'Retail'] },
      ],
    },
    down: {
      mechanism:
        'A lower policy rate cheapens money, reviving credit demand and reducing interest costs across leveraged balance sheets.',
      positives: [
        { text: 'Credit demand revives and loan books grow, which matters more to lenders than the margin they give up.', sectors: ['Banking', 'Financials'] },
        { text: 'Rate-sensitive purchases — vehicles, homes, consumer durables — are pulled forward as EMIs fall.', sectors: ['Auto', 'Realty', 'Consumer'] },
        { text: 'Interest costs fall for leveraged companies, flowing straight to net profit.', sectors: ['Utilities', 'Engineering', 'Metals', 'Telecom'] },
        { text: 'Lower discount rates support the valuation of long-duration growth businesses.', sectors: ['IT', 'Consumer', 'Retail'] },
      ],
      negatives: [
        { text: 'Lending yields fall faster than deposit costs, compressing net interest margin in the near term.', sectors: ['Banking'] },
        { text: 'Returns on the bond and cash portfolios that insurers and lenders must hold decline.', sectors: ['Banking', 'Financials'] },
        { text: 'A narrower rate differential can weaken the rupee, raising the cost of imported inputs and dollar debt.', sectors: ['Energy', 'Chemicals', 'Auto'] },
        { text: 'Easing usually signals concern about growth, so the volume recovery may lag the rate cut considerably.', sectors: [] },
      ],
    },
  },

  crude: {
    up: {
      mechanism:
        'India imports most of its crude, so a higher oil price moves money from fuel consumers to producers and widens the import bill.',
      positives: [
        { text: 'Upstream producers realise a higher price on every barrel they lift, with costs largely unchanged.', sectors: ['Energy'] },
        { text: 'Refiners can see inventory gains on crude bought before the move.', sectors: ['Energy'] },
        { text: 'Alternatives become relatively cheaper, supporting renewables and gas-linked demand.', sectors: ['Utilities'] },
      ],
      negatives: [
        { text: 'Fuel is a third of an airline’s operating cost, so the hit to margin is immediate and large.', sectors: ['Aviation'] },
        { text: 'Crude derivatives are the feedstock for paints, packaging and specialty chemicals; input costs rise before prices can be passed on.', sectors: ['Chemicals', 'Consumer', 'FMCG'] },
        { text: 'Freight and logistics costs rise across every physical supply chain.', sectors: ['Retail', 'Auto', 'Ports'] },
        { text: 'A wider current account deficit pressures the rupee, importing further inflation.', sectors: [] },
        { text: 'Higher pump prices reduce household discretionary spending.', sectors: ['Consumer', 'Retail', 'Auto'] },
      ],
    },
    down: {
      mechanism:
        'Cheaper crude cuts input and freight costs for consumers of oil and narrows the import bill, at the expense of producers.',
      positives: [
        { text: 'Airline operating margins expand immediately, since fuel is the largest single cost line.', sectors: ['Aviation'] },
        { text: 'Petrochemical and paint feedstock costs fall, widening gross margin before any price change.', sectors: ['Chemicals', 'Consumer', 'FMCG'] },
        { text: 'A narrower import bill supports the rupee and cools headline inflation, easing pressure on policy rates.', sectors: ['Banking', 'Financials'] },
        { text: 'Lower fuel prices leave more household income for discretionary spending.', sectors: ['Consumer', 'Retail', 'Auto'] },
      ],
      negatives: [
        { text: 'Upstream producers realise less on every barrel, with costs unchanged.', sectors: ['Energy'] },
        { text: 'Refiners can take inventory losses on crude bought at higher prices.', sectors: ['Energy'] },
        { text: 'Sharply falling crude often signals weakening global demand, which reaches exporters next.', sectors: ['IT', 'Metals'] },
      ],
    },
  },

  currency: {
    down: {
      mechanism:
        'A weaker rupee raises the rupee value of every dollar earned and the rupee cost of every dollar spent.',
      positives: [
        { text: 'Exporters book more rupees per dollar of unchanged billing, lifting revenue and margin together.', sectors: ['IT', 'Pharma'] },
        { text: 'Domestic producers gain price competitiveness against imported substitutes.', sectors: ['Metals', 'Chemicals'] },
      ],
      negatives: [
        { text: 'Importers pay more in rupees for the same volume of crude, equipment and components.', sectors: ['Energy', 'Auto', 'Chemicals'] },
        { text: 'Companies with unhedged dollar debt face higher servicing costs and mark-to-market losses.', sectors: ['Telecom', 'Utilities', 'Metals'] },
        { text: 'Imported inflation feeds through to input costs across consumer supply chains.', sectors: ['FMCG', 'Consumer', 'Retail'] },
      ],
    },
    up: {
      mechanism:
        'A stronger rupee shrinks the rupee value of dollar revenue and cheapens every dollar-denominated cost.',
      positives: [
        { text: 'Importers pay less in rupees for crude, capital equipment and components.', sectors: ['Energy', 'Auto', 'Chemicals'] },
        { text: 'Dollar debt becomes cheaper to service and worth less in rupee terms.', sectors: ['Telecom', 'Utilities', 'Metals'] },
        { text: 'Imported input costs fall across consumer supply chains.', sectors: ['FMCG', 'Consumer', 'Retail'] },
      ],
      negatives: [
        { text: 'Exporters receive fewer rupees per dollar billed, compressing realisations and margin.', sectors: ['IT', 'Pharma'] },
        { text: 'Domestic producers lose price competitiveness against cheaper imports.', sectors: ['Metals', 'Chemicals'] },
      ],
    },
  },

  inflation: {
    up: {
      mechanism:
        'Rising prices squeeze household real income and raise input costs faster than most companies can pass them on.',
      positives: [
        { text: 'Companies with genuine pricing power can raise prices ahead of costs and expand margin.', sectors: ['FMCG', 'Consumer'] },
        { text: 'Producers of the commodities doing the inflating realise higher prices.', sectors: ['Metals', 'Energy'] },
        { text: 'Hard assets and real estate tend to hold value better in an inflationary period.', sectors: ['Realty'] },
      ],
      negatives: [
        { text: 'Input costs rise faster than selling prices, compressing gross margin where pricing power is weak.', sectors: ['FMCG', 'Consumer', 'Retail', 'Auto'] },
        { text: 'Real household income falls, so volumes weaken even where prices hold.', sectors: ['Retail', 'Consumer', 'Auto'] },
        { text: 'A tighter policy response becomes more likely, adding a second and slower drag.', sectors: ['Banking', 'Realty', 'Financials'] },
      ],
    },
    down: {
      mechanism:
        'Cooling inflation restores household purchasing power and relieves input-cost pressure.',
      positives: [
        { text: 'Gross margins recover as input costs stabilise while selling prices hold.', sectors: ['FMCG', 'Consumer', 'Retail'] },
        { text: 'Real household income improves, supporting volumes.', sectors: ['Retail', 'Consumer', 'Auto'] },
        { text: 'Room for easier policy opens up, which helps lenders and rate-sensitive demand.', sectors: ['Banking', 'Financials', 'Realty'] },
      ],
      negatives: [
        { text: 'Companies lose the cover that broad inflation gave them to raise prices.', sectors: ['FMCG', 'Consumer'] },
        { text: 'Producers of the cooling commodities realise lower prices.', sectors: ['Metals', 'Energy'] },
        { text: 'Disinflation driven by weak demand rather than easing supply is a warning, not a relief.', sectors: [] },
      ],
    },
  },

  fiscal: {
    up: {
      mechanism:
        'Higher government capital spending flows down the infrastructure chain in order: order books, then materials, then the assets that carry the output.',
      positives: [
        { text: 'Capital goods and construction order books fill first and with the longest visibility.', sectors: ['Engineering'] },
        { text: 'Cement and steel offtake follows the projects that get sanctioned.', sectors: ['Cement', 'Metals'] },
        { text: 'Ports, logistics and utilities see higher throughput as capacity is commissioned.', sectors: ['Ports', 'Utilities'] },
        { text: 'Incentive schemes directly subsidise domestic manufacturing economics.', sectors: ['Auto', 'Chemicals'] },
      ],
      negatives: [
        { text: 'A wider fiscal deficit pushes up government borrowing and therefore bond yields.', sectors: ['Banking', 'Financials'] },
        { text: 'Execution lags mean announced spending can take several years to become revenue.', sectors: ['Engineering', 'Cement'] },
        { text: 'Higher duties in the same package raise input costs for import-dependent manufacturers.', sectors: ['Auto', 'Chemicals'] },
      ],
    },
    down: {
      mechanism:
        'Lower government spending or a harsher duty regime removes demand the infrastructure chain depends on.',
      positives: [
        { text: 'Fiscal consolidation lowers government borrowing and eases bond yields.', sectors: ['Banking', 'Financials'] },
      ],
      negatives: [
        { text: 'Fewer tenders reach the capital goods order pipeline.', sectors: ['Engineering'] },
        { text: 'Cement and steel volumes fall with the project pipeline.', sectors: ['Cement', 'Metals'] },
        { text: 'Utility and port capacity additions slow.', sectors: ['Utilities', 'Ports'] },
      ],
    },
  },

  global: {
    down: {
      mechanism:
        'Global risk-off pulls foreign portfolio flows out of Indian equities and weakens the externally-exposed earnings first.',
      positives: [
        { text: 'Purely domestic demand businesses are relatively insulated and can outperform on a relative basis.', sectors: ['FMCG', 'Utilities', 'Telecom'] },
        { text: 'A weaker rupee alongside the outflow cushions exporters’ reported revenue.', sectors: ['IT', 'Pharma'] },
      ],
      negatives: [
        { text: 'Foreign portfolio outflows pressure index levels regardless of domestic fundamentals.', sectors: ['Banking', 'Financials'] },
        { text: 'A weaker global demand outlook reaches IT services budgets and industrial metal volumes first.', sectors: ['IT', 'Metals'] },
        { text: 'Risk premia rise across the market, compressing valuation multiples broadly.', sectors: [] },
      ],
    },
    up: {
      mechanism:
        'A friendlier global backdrop brings foreign flows back and lifts the externally-exposed earnings first.',
      positives: [
        { text: 'Foreign portfolio inflows support index levels and large-cap liquidity.', sectors: ['Banking', 'Financials'] },
        { text: 'Client technology budgets and industrial metal demand both improve.', sectors: ['IT', 'Metals'] },
      ],
      negatives: [
        { text: 'A stronger rupee alongside the inflow trims exporters’ reported revenue.', sectors: ['IT', 'Pharma'] },
        { text: 'Defensive domestic businesses tend to lag when risk appetite returns.', sectors: ['FMCG', 'Utilities'] },
      ],
    },
  },

  growth: {
    up: {
      mechanism: 'Faster growth lifts credit demand, industrial volumes and order inflows together.',
      positives: [
        { text: 'Credit demand rises and borrower cash flows improve, helping both loan growth and asset quality.', sectors: ['Banking', 'Financials'] },
        { text: 'Cyclical volumes — steel, cement, vehicles, capital goods — follow investment activity upward.', sectors: ['Metals', 'Cement', 'Auto', 'Engineering'] },
        { text: 'Discretionary consumption expands as employment and incomes improve.', sectors: ['Consumer', 'Retail'] },
      ],
      negatives: [
        { text: 'Strong growth raises the odds of policy tightening to contain demand.', sectors: ['Banking', 'Realty'] },
        { text: 'Input and labour costs rise with capacity utilisation.', sectors: ['Engineering', 'Auto'] },
      ],
    },
    down: {
      mechanism: 'Slower growth weakens credit demand, order books and cyclical volumes together.',
      positives: [
        { text: 'Defensive demand holds up better and can outperform on a relative basis.', sectors: ['FMCG', 'Pharma', 'Utilities'] },
        { text: 'A slowdown raises the likelihood of supportive policy easing.', sectors: ['Banking', 'Realty', 'Auto'] },
      ],
      negatives: [
        { text: 'Credit demand weakens and borrower cash flows deteriorate, worsening the asset-quality outlook.', sectors: ['Banking', 'Financials'] },
        { text: 'Cyclical volumes and order inflows contract.', sectors: ['Metals', 'Cement', 'Engineering', 'Auto'] },
        { text: 'Discretionary spending is deferred first.', sectors: ['Consumer', 'Retail'] },
      ],
    },
  },

  regulatory: {
    neutral: {
      mechanism:
        'Regulatory action raises compliance cost and caps a practice or a revenue line, and the overhang usually persists until the order’s scope is known.',
      positives: [
        { text: 'Incumbents with established compliance functions absorb the cost more easily than smaller competitors, consolidating share.', sectors: ['Banking', 'Financials', 'Pharma'] },
        { text: 'Clearer rules remove an uncertainty that was already being discounted.', sectors: [] },
      ],
      negatives: [
        { text: 'Compliance and remediation costs rise immediately and permanently.', sectors: ['Banking', 'Financials', 'Pharma', 'Telecom'] },
        { text: 'A capped fee, tariff or practice removes a revenue line outright.', sectors: ['Banking', 'Telecom'] },
        { text: 'The overhang suppresses the valuation multiple until the scope of the action is known.', sectors: [] },
      ],
    },
  },

  geopolitical: {
    up: {
      mechanism:
        'Conflict and sanctions raise energy, freight and insurance costs and lengthen supply routes.',
      positives: [
        { text: 'Defence and domestic capital goods order books expand on higher security spending.', sectors: ['Engineering'] },
        { text: 'Energy producers realise higher prices on the risk premium.', sectors: ['Energy'] },
        { text: 'Gold and hard assets attract safe-haven flows.', sectors: [] },
      ],
      negatives: [
        { text: 'Fuel, freight and insurance costs rise across every physical supply chain.', sectors: ['Aviation', 'Ports', 'Retail', 'Auto'] },
        { text: 'Longer shipping routes stretch working capital and delivery times.', sectors: ['Chemicals', 'Metals', 'Ports'] },
        { text: 'Risk premia rise market-wide, compressing valuations regardless of company fundamentals.', sectors: [] },
      ],
    },
  },

  earnings: {
    up: {
      mechanism: 'Reported results and guidance reset the forward estimates the market capitalises.',
      positives: [
        { text: 'Forward earnings estimates are revised upward, which is what actually drives the re-rating.', sectors: [] },
        { text: 'A beat driven by margin rather than one-offs tends to persist into following quarters.', sectors: [] },
      ],
      negatives: [
        { text: 'If the beat was already expected, the result can be sold regardless of the numbers.', sectors: [] },
        { text: 'One-off gains flatter a quarter without changing the earnings power of the business.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'A miss or cut guidance lowers the forward estimates the market capitalises.',
      positives: [
        { text: 'A miss driven by one-off costs can leave underlying earnings power intact.', sectors: [] },
        { text: 'A sharp de-rating on a temporary issue is where mispricing usually appears.', sectors: [] },
      ],
      negatives: [
        { text: 'Forward estimates are cut, and the de-rating compounds the earnings decline.', sectors: [] },
        { text: 'Lowered guidance damages management credibility beyond the quarter itself.', sectors: [] },
      ],
    },
  },
}

/** A point applies to an entity if it is broad, or names that entity's sector. */
function pointsFor(points: ImpactPoint[], sector: string): string[] {
  return points.filter((p) => p.sectors.length === 0 || p.sectors.includes(sector)).map((p) => p.text)
}

function resolveDirection(positives: string[], negatives: string[]): ImpactDirection {
  if (positives.length === 0 && negatives.length === 0) return 'NEUTRAL'
  if (positives.length === 0) return 'NEGATIVE'
  if (negatives.length === 0) return 'POSITIVE'
  // Both sides present: a clear majority decides, otherwise it is genuinely
  // mixed and saying so is more useful than picking one.
  const ratio = positives.length / (positives.length + negatives.length)
  if (ratio >= 0.67) return 'POSITIVE'
  if (ratio <= 0.33) return 'NEGATIVE'
  return 'MIXED'
}

export interface ImpactRequest {
  title: string
  description?: string
  sectors: string[]
  companies?: { symbol: string; name?: string; sector: string }[]
}

export interface ImpactAnalysis {
  headline: string
  eventType: string
  economicVariable: string
  overallDirection: string
  magnitude: number
  /** The mechanism sentence for the channel as a whole. */
  mechanism: string
  sectorImpacts: EntityImpact[]
  companyImpacts: EntityImpact[]
  /** Set when no known channel matched, so the UI can say so plainly. */
  unrecognised: boolean
}

export function analyseImpact(request: ImpactRequest): ImpactAnalysis {
  const text = `${request.title} ${request.description || ''}`
  const classification = classifyEventByRules(text)

  // classifyEventByRules reports the channel through event_type; map back to
  // the impact table, whose keys are the channel ids.
  const themeId = THEME_BY_EVENT_TYPE[classification.event_type]

  // The impact table is keyed by which way the underlying VARIABLE moved, not
  // by the market's reaction to it. Those are frequently opposite — crude
  // rising is a NEGATIVE market direction — so deriving polarity from
  // classification.direction selected the wrong side of every inverse channel.
  // Detect the variable's own direction from the text instead.
  const polarity: Polarity = detectPolarity(text.toLowerCase())

  const channel = themeId ? CHANNEL_IMPACTS[themeId] : undefined
  // Some channels are written from the variable's direction and some are
  // one-sided by nature (regulatory); fall back across the available keys
  // rather than returning nothing for a recognised event.
  const sided = channel?.[polarity] ?? channel?.up ?? channel?.down ?? channel?.neutral

  const sectors = request.sectors.length > 0 ? request.sectors : classification.affected_sectors

  if (!sided) {
    const empty = (entity: string, kind: 'sector' | 'company', sector: string): EntityImpact => ({
      entity,
      kind,
      sector,
      direction: 'NEUTRAL',
      confidence: 20,
      positives: [],
      negatives: [],
      mechanism:
        'No standard transmission channel was recognised in this headline, so no directional read is offered for this entity.',
    })
    return {
      headline: request.title,
      eventType: classification.event_type,
      economicVariable: classification.economic_variable,
      overallDirection: 'NEUTRAL',
      magnitude: classification.magnitude,
      mechanism:
        'This headline did not match a known macro or corporate transmission channel, so the engine offers no impact read rather than inventing one.',
      sectorImpacts: sectors.map((s) => empty(s, 'sector', s)),
      companyImpacts: (request.companies || []).map((c) => empty(c.name || c.symbol, 'company', c.sector)),
      unrecognised: true,
    }
  }

  const build = (entity: string, kind: 'sector' | 'company', sector: string): EntityImpact => {
    const positives = pointsFor(sided.positives, sector)
    const negatives = pointsFor(sided.negatives, sector)
    const direction = resolveDirection(positives, negatives)
    return {
      entity,
      kind,
      sector,
      direction,
      // Confidence tracks how lopsided the evidence is: a one-sided read is a
      // stronger claim than a balanced one.
      confidence: Math.min(
        90,
        Math.round(
          classification.confidence *
            (direction === 'MIXED' ? 0.7 : direction === 'NEUTRAL' ? 0.4 : 1)
        )
      ),
      positives,
      negatives,
      mechanism: sided.mechanism,
    }
  }

  return {
    headline: request.title,
    eventType: classification.event_type,
    economicVariable: classification.economic_variable,
    overallDirection: classification.direction,
    magnitude: classification.magnitude,
    mechanism: sided.mechanism,
    sectorImpacts: sectors.map((s) => build(s, 'sector', s)),
    companyImpacts: (request.companies || []).map((c) => build(c.name || c.symbol, 'company', c.sector)),
    unrecognised: false,
  }
}

/**
 * The classifier reports an event_type; the impact table is keyed by channel.
 * Kept as an explicit map so an unmapped event type degrades to "no read"
 * rather than silently matching the wrong channel.
 */
const THEME_BY_EVENT_TYPE: Record<string, string> = {
  MONETARY_POLICY: 'policy_rate',
  COMMODITY_SHOCK: 'crude',
  CURRENCY: 'currency',
  INFLATION: 'inflation',
  GOVERNMENT_POLICY: 'fiscal',
  GLOBAL_MARKET_SHOCK: 'global',
  GDP: 'growth',
  REGULATORY: 'regulatory',
  GEOPOLITICAL: 'geopolitical',
  EARNINGS: 'earnings',
}
