import { assessEvent, type Polarity } from './ruleClassifier'

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
  /**
   * Net weight of the two sides, from −1 (only harm) to +1 (only benefit).
   * Points specific to this entity's sector count fully; broad, market-wide
   * points count half, because they apply to every company alike and should
   * not outvote the channel that actually reaches this one.
   */
  balance: number
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
        { text: 'New deposits and premiums are invested at higher yields, lifting investment income over the following quarters.', sectors: ['Banking', 'Financials'] },
        { text: 'A higher rate differential can attract foreign debt flows, supporting the rupee and cheapening imported inputs.', sectors: ['Energy', 'Chemicals'] },
        { text: 'Companies with net cash on the balance sheet earn more on it and gain a relative advantage over leveraged competitors.', sectors: ['IT', 'FMCG'] },
      ],
      negatives: [
        { text: 'Loan growth slows as borrowing costs rise, shrinking the pool of new credit.', sectors: ['Banking', 'Financials'] },
        { text: 'Deposit costs catch up within two to three quarters, giving back the initial margin gain.', sectors: ['Banking'] },
        { text: 'Rising yields mark down the government bonds lenders are required to hold, booking treasury losses in the quarter.', sectors: ['Banking', 'Financials'] },
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
        { text: 'Falling yields lift the value of the government bonds lenders hold, booking treasury gains in the quarter.', sectors: ['Banking', 'Financials'] },
        { text: 'Lenders that borrow in the bond market rather than from depositors — NBFCs — see funding costs fall faster than their loan yields, widening spreads.', sectors: ['Financials'] },
        { text: 'Rate-sensitive purchases — vehicles, homes, consumer durables — are pulled forward as EMIs fall.', sectors: ['Auto', 'Realty', 'Consumer'] },
        { text: 'Interest costs fall for leveraged companies, flowing straight to net profit.', sectors: ['Utilities', 'Engineering', 'Metals', 'Telecom'] },
        { text: 'Lower discount rates support the valuation of long-duration growth businesses.', sectors: ['IT', 'Consumer', 'Retail'] },
      ],
      negatives: [
        { text: 'Lending yields fall faster than deposit costs, compressing net interest margin in the near term.', sectors: ['Banking'] },
        { text: 'New money is invested at lower yields, trimming insurers’ investment income over time.', sectors: ['Financials'] },
        { text: 'A narrower rate differential can weaken the rupee, raising the cost of imported inputs and dollar debt.', sectors: ['Energy', 'Chemicals'] },
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
        { text: 'Execution lags mean announced spending can take several years to become revenue.', sectors: [] },
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
        { text: 'A slowdown raises the likelihood of supportive policy easing.', sectors: [] },
      ],
      negatives: [
        { text: 'Credit demand weakens and borrower cash flows deteriorate, worsening the asset-quality outlook.', sectors: ['Banking', 'Financials'] },
        { text: 'Cyclical volumes and order inflows contract.', sectors: ['Metals', 'Cement', 'Engineering', 'Auto'] },
        { text: 'Discretionary spending is deferred first.', sectors: ['Consumer', 'Retail'] },
      ],
    },
  },

  monsoon: {
    up: {
      mechanism:
        'A good monsoon raises farm output and rural incomes, and rural India buys roughly half of the country’s consumer staples and two-wheelers.',
      positives: [
        { text: 'Rural volumes for soaps, biscuits, tea and other staples recover with farm incomes, and rural is the slower-growing half of the market.', sectors: ['FMCG'] },
        { text: 'A big harvest cheapens farm inputs such as wheat, edible oils and milk, widening staples makers’ margins.', sectors: ['FMCG'] },
        { text: 'Tractor and two-wheeler demand tracks the harvest closely, so order books fill ahead of the festive season.', sectors: ['Auto'] },
        { text: 'More disposable income in rural households lifts discretionary purchases such as paint, jewellery and appliances.', sectors: ['Consumer'] },
        { text: 'Ample food supply cools inflation, which leaves room for lower interest rates.', sectors: ['Banking', 'Financials'] },
        { text: 'Rural borrowers repay more reliably after a good harvest, improving microfinance and farm-loan asset quality.', sectors: ['Banking', 'Financials'] },
      ],
      negatives: [
        { text: 'How the rain is spread across regions and weeks matters as much as the seasonal total; a good average can hide local deficits.', sectors: [] },
      ],
    },
    down: {
      mechanism:
        'A weak monsoon cuts farm output and rural incomes, and lifts food prices for everyone.',
      positives: [
        { text: 'Companies with strong brands can pass on higher food and input costs, protecting margin even as volumes slow.', sectors: ['FMCG'] },
      ],
      negatives: [
        { text: 'Rural demand for staples weakens with farm incomes, hitting volume growth.', sectors: ['FMCG'] },
        { text: 'Tractor and entry-level two-wheeler sales fall with the harvest.', sectors: ['Auto'] },
        { text: 'Discretionary purchases are deferred in rural households.', sectors: ['Consumer'] },
        { text: 'Higher food inflation delays rate cuts and strains rural loan repayment.', sectors: ['Banking', 'Financials'] },
        { text: 'A demand slowdown in rural India reaches the wider economy within a few quarters.', sectors: [] },
      ],
    },
  },

  // A hold is a channel in its own right, not "the hike side by default":
  // that fallback used to give "RBI keeps the repo rate unchanged" the
  // rate-HIKE read for every lender.
  policy_rate_neutral: {
    neutral: {
      mechanism: 'Rates held steady leave funding costs and EMIs where they are, so the read comes from the guidance rather than the decision.',
      positives: [
        { text: 'Lending margins face no repricing pressure in either direction this cycle.', sectors: ['Banking'] },
        { text: 'Policy stability removes a swing factor and lets earnings drive prices.', sectors: [] },
      ],
      negatives: [
        { text: 'Credit growth gets no boost from cheaper loans.', sectors: ['Banking'] },
        { text: 'Borrowers waiting for cheaper EMIs wait longer, so rate-sensitive demand gets no new support.', sectors: ['Auto', 'Consumer', 'Realty'] },
        { text: 'Bond-funded lenders get no relief on funding costs from a cut.', sectors: ['Financials'] },
      ],
    },
  },

  fed: {
    up: {
      mechanism: 'Higher US rates pull foreign money out of emerging markets, weaken the rupee and tighten global financing.',
      positives: [
        { text: 'A weaker rupee alongside the outflow lifts the rupee value of exporters’ dollar revenue.', sectors: ['IT', 'Pharma'] },
      ],
      negatives: [
        { text: 'Foreign portfolio investors sell Indian equities as US yields rise, and banks and financials are their largest holdings.', sectors: ['Banking', 'Financials'] },
        { text: 'Tighter global financing slows demand for industrial metals.', sectors: ['Metals'] },
        { text: 'US clients trim discretionary technology budgets when borrowing costs rise.', sectors: ['IT'] },
        { text: 'Higher global discount rates compress equity valuations broadly.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Lower US rates send foreign money back to emerging markets, support the rupee and ease global financing.',
      positives: [
        { text: 'Foreign portfolio inflows return to Indian equities, led by the large banks and financials they hold most.', sectors: ['Banking', 'Financials'] },
        { text: 'Easier global financing supports industrial-metal demand.', sectors: ['Metals'] },
        { text: 'Cheaper money supports US clients’ technology budgets.', sectors: ['IT'] },
        { text: 'Lower global discount rates support equity valuations broadly.', sectors: [] },
      ],
      negatives: [
        { text: 'A stronger rupee trims the rupee value of exporters’ dollar revenue.', sectors: ['IT', 'Pharma'] },
      ],
    },
    neutral: {
      mechanism: 'A US rate pause leaves foreign-flow conditions unchanged; the guidance on future moves carries the read.',
      positives: [{ text: 'No new outflow pressure from a further rise in US yields.', sectors: ['Banking', 'Financials'] }],
      negatives: [{ text: 'No relief either: foreign flows wait for the first cut.', sectors: ['Banking', 'Financials', 'IT'] }],
    },
  },

  gold: {
    up: {
      mechanism: 'Higher gold prices revalue jewellers’ inventory but price buyers out, and usually mean investors are moving to safety.',
      positives: [
        { text: 'Jewellers hold large gold inventories, which are revalued upward and lift reported margins in the quarter.', sectors: ['=TITAN'] },
      ],
      negatives: [
        { text: 'Buyers defer or downsize jewellery purchases at record prices, so volumes fall.', sectors: ['=TITAN'] },
        { text: 'A gold rally usually reflects risk aversion, which is a headwind for equities broadly.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Cheaper gold brings jewellery buyers back and signals money moving from safe havens into risk assets.',
      positives: [
        { text: 'Lower prices bring jewellery buyers back, lifting volumes.', sectors: ['=TITAN'] },
        { text: 'Money leaving safe havens tends to flow into equities.', sectors: [] },
      ],
      negatives: [
        { text: 'Jewellers’ gold inventories are revalued lower, trimming reported margins in the quarter.', sectors: ['=TITAN'] },
      ],
    },
  },

  fiscal_tax: {
    down: {
      mechanism: 'A lower tax on consumption or income leaves households more to spend.',
      positives: [
        { text: 'Lower GST or income tax puts money back in household budgets, lifting volumes for everyday goods.', sectors: ['FMCG', 'Consumer', 'Retail'] },
        { text: 'Big-ticket purchases such as vehicles become cheaper outright when the tax on them falls.', sectors: ['Auto'] },
      ],
      negatives: [
        { text: 'Lower tax revenue can widen the fiscal deficit and push bond yields up.', sectors: ['Banking', 'Financials'] },
        { text: 'Companies may not pass the full cut on to buyers, limiting the volume gain.', sectors: [] },
      ],
    },
    up: {
      mechanism: 'A higher tax on consumption or income takes spending power out of households.',
      positives: [
        { text: 'Higher tax revenue narrows the fiscal deficit, easing pressure on bond yields.', sectors: ['Banking', 'Financials'] },
      ],
      negatives: [
        { text: 'Higher GST or income tax squeezes household budgets, and discretionary purchases are cut first.', sectors: ['FMCG', 'Consumer', 'Retail'] },
        { text: 'Vehicles become more expensive outright when the tax on them rises.', sectors: ['Auto'] },
      ],
    },
  },

  trade: {
    up: {
      mechanism: 'Higher barriers abroad make Indian exports less competitive in that market and raise the risk premium on Indian assets.',
      positives: [
        { text: 'A weaker rupee in response cushions exporters’ rupee realisations.', sectors: ['IT'] },
      ],
      negatives: [
        { text: 'Exporters to the tariffing market lose price competitiveness, so orders and margins fall.', sectors: ['Pharma', 'Auto', 'Metals', 'Chemicals'] },
        { text: 'Supply shut out of one market is dumped in others, depressing global prices for metals and chemicals.', sectors: ['Metals', 'Chemicals'] },
        { text: 'Trade friction and visa restrictions weigh on US clients’ outsourcing decisions and raise onsite costs.', sectors: ['IT'] },
        { text: 'Trade conflict raises risk premia and can trigger foreign portfolio outflows.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Lower barriers reopen export markets and lower the risk premium on Indian assets.',
      positives: [
        { text: 'Lower tariffs or a trade deal restore exporters’ price competitiveness and reopen orders.', sectors: ['Pharma', 'Auto', 'Metals', 'Chemicals', 'IT'] },
        { text: 'Easing trade tension lowers risk premia and supports foreign inflows.', sectors: [] },
      ],
      negatives: [
        { text: 'Cheaper imports under a trade deal compete with domestic producers.', sectors: ['Metals', 'Chemicals'] },
      ],
    },
  },

  regulatory: {
    up: {
      mechanism:
        'Regulatory action raises compliance cost and caps a practice or a revenue line, and the overhang usually persists until the order’s scope is known.',
      positives: [
        { text: 'Incumbents with established compliance functions absorb the cost more easily than smaller competitors, consolidating share.', sectors: ['Banking', 'Financials', 'Pharma'] },
        { text: 'Clearer rules remove an uncertainty that was already being discounted.', sectors: [] },
      ],
      negatives: [
        { text: 'The action restricts this company’s business directly, and the overhang lasts until its scope and duration are known.', sectors: ['@named'] },
        { text: 'Remediation, penalties and compliance costs fall on this company first.', sectors: ['@named'] },
        { text: 'Compliance and remediation costs rise immediately and permanently.', sectors: ['Banking', 'Financials', 'Pharma', 'Telecom', 'Aviation', 'FMCG'] },
        { text: 'A capped fee, tariff or practice removes a revenue line outright.', sectors: ['Banking', 'Financials', 'Telecom'] },
        { text: 'The overhang suppresses the valuation multiple until the scope of the action is known.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Regulatory relief reopens a restricted business line or lowers compliance cost.',
      positives: [
        { text: 'The relief reopens the restricted business line for this company directly.', sectors: ['@named'] },
        { text: 'Lifting the restriction or easing the rule restores a revenue line and lowers compliance cost.', sectors: ['Banking', 'Financials', 'Pharma', 'Telecom', 'Aviation', 'FMCG'] },
        { text: 'An overhang the market was discounting is removed.', sectors: [] },
      ],
      negatives: [
        { text: 'Easier rules can invite new competition into the business.', sectors: [] },
      ],
    },
  },

  ratings: {
    up: {
      mechanism: 'A rating upgrade lowers the cost of refinancing and widens the pool of lenders.',
      positives: [
        { text: 'The upgrade lowers this company’s borrowing costs and widens its pool of lenders.', sectors: ['@named'] },
        { text: 'Lower sovereign risk premia cut borrowing costs for lenders and leveraged utilities.', sectors: ['Banking', 'Financials', 'Utilities'] },
      ],
      negatives: [{ text: 'An upgrade the market expected is often already in the price.', sectors: [] }],
    },
    down: {
      mechanism: 'A rating downgrade raises the cost of refinancing and narrows the pool of lenders.',
      positives: [{ text: 'A downgrade the market expected is often already in the price.', sectors: [] }],
      negatives: [
        { text: 'The downgrade raises this company’s borrowing costs, and some lenders can no longer hold its paper.', sectors: ['@named'] },
        { text: 'Higher sovereign risk premia raise borrowing costs for lenders and leveraged utilities.', sectors: ['Banking', 'Financials', 'Utilities'] },
      ],
    },
  },

  geopolitical: {
    up: {
      mechanism:
        'Conflict and sanctions raise energy, freight and insurance costs and lengthen supply routes.',
      positives: [
        { text: 'Defence order books expand as governments raise security spending.', sectors: ['Defence'] },
        { text: 'Energy producers realise higher prices on the risk premium.', sectors: ['Energy'] },
      ],
      negatives: [
        { text: 'Fuel, freight and insurance costs rise across every physical supply chain.', sectors: ['Aviation', 'Ports', 'Retail', 'Auto'] },
        { text: 'Airspace closures and diversions add flying time and fuel to every affected route.', sectors: ['Aviation'] },
        { text: 'Longer shipping routes stretch working capital and delivery times.', sectors: ['Chemicals', 'Metals', 'Ports'] },
        { text: 'Risk premia rise market-wide, compressing valuations regardless of company fundamentals.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'De-escalation unwinds the energy, freight and insurance risk premium and normalises trade routes.',
      positives: [
        { text: 'Fuel, freight and insurance costs ease and routes normalise.', sectors: ['Aviation', 'Ports', 'Chemicals', 'Auto', 'Retail'] },
        { text: 'Lower risk premia bring foreign investors back to Indian equities.', sectors: [] },
      ],
      negatives: [
        { text: 'Energy prices give back the war risk premium.', sectors: ['Energy'] },
        { text: 'Defence names lose the urgency premium on new orders.', sectors: ['Defence'] },
      ],
    },
  },

  pandemic: {
    up: {
      mechanism: 'Movement restrictions shut travel, stores and plants while fixed costs continue.',
      positives: [
        { text: 'Demand for medicines, diagnostics and hospital care rises.', sectors: ['Pharma'] },
        { text: 'Remote work and digitisation accelerate technology spending.', sectors: ['IT'] },
        { text: 'Households stock up on staples.', sectors: ['FMCG'] },
      ],
      negatives: [
        { text: 'Flights are grounded or restricted, so revenue collapses while aircraft and staff costs remain.', sectors: ['Aviation'] },
        { text: 'Store footfall and discretionary spending fall under movement restrictions.', sectors: ['Retail', 'Consumer'] },
        { text: 'Plants and dealerships shut and big-ticket purchases are deferred.', sectors: ['Auto'] },
        { text: 'Borrowers’ cash flows are disrupted, raising repayment stress and credit costs.', sectors: ['Banking', 'Financials'] },
        { text: 'Economic activity contracts broadly while restrictions last.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Lifting restrictions brings back travel, footfall and big-ticket purchases.',
      positives: [
        { text: 'Travel demand returns quickly once restrictions lift.', sectors: ['Aviation'] },
        { text: 'Store footfall and discretionary spending recover.', sectors: ['Retail', 'Consumer'] },
        { text: 'Plants reopen and deferred vehicle purchases come back.', sectors: ['Auto'] },
        { text: 'Economic activity normalises broadly.', sectors: [] },
      ],
      negatives: [
        { text: 'Pandemic-related demand for medicines and diagnostics fades.', sectors: ['Pharma'] },
        { text: 'Emergency digitisation spending normalises.', sectors: ['IT'] },
      ],
    },
  },

  employment: {
    up: {
      mechanism: 'More jobs add household income, which reaches consumption and retail credit.',
      positives: [
        { text: 'Rising household income supports discretionary spending.', sectors: ['Consumer', 'Retail'] },
        { text: 'Retail loan demand and repayment quality both improve.', sectors: ['Banking', 'Financials'] },
      ],
      negatives: [{ text: 'Tight labour markets raise wage costs.', sectors: ['IT'] }],
    },
    down: {
      mechanism: 'Fewer jobs reduce household income, reaching consumption first and retail credit after.',
      positives: [{ text: 'Softer wage pressure eases staff costs.', sectors: ['IT'] }],
      negatives: [
        { text: 'Falling household income cuts discretionary spending first.', sectors: ['Consumer', 'Retail'] },
        { text: 'Retail loan stress rises as borrowers lose income.', sectors: ['Banking', 'Financials'] },
      ],
    },
  },

  market_move: {
    up: {
      mechanism: 'A broad rally is carried by the heaviest index constituents, which attract the first foreign and passive buying.',
      positives: [
        { text: 'Banks and financials are about a third of the NIFTY 50, so they carry most of a broad rally and draw the first foreign flows.', sectors: ['Banking', 'Financials'] },
        { text: 'Exchanges, brokers and asset managers earn more as trading volumes and inflows rise.', sectors: ['Financials'] },
        { text: 'Index heavyweights see passive and foreign buying along with the index.', sectors: ['IT', 'Energy'] },
      ],
      negatives: [
        { text: 'Defensive businesses lag when risk appetite returns, as money rotates into cyclicals.', sectors: ['FMCG', 'Pharma', 'Utilities'] },
        { text: 'A rally driven by flows rather than earnings stretches valuations, raising the risk of a pullback.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'A broad sell-off is carried by the heaviest index constituents, which take the bulk of foreign and passive selling.',
      positives: [
        { text: 'Defensive businesses tend to fall less and attract money rotating out of cyclicals.', sectors: ['FMCG', 'Pharma', 'Utilities'] },
      ],
      negatives: [
        { text: 'Banks and financials carry most of a broad sell-off and see the heaviest foreign selling.', sectors: ['Banking', 'Financials'] },
        { text: 'Index heavyweights fall with passive and foreign outflows.', sectors: ['IT', 'Energy'] },
        { text: 'Exchanges, brokers and asset managers lose fee income as volumes and inflows fall.', sectors: ['Financials'] },
        { text: 'A broad sell-off drags almost every stock down; defensive names fall less, but they still fall.', sectors: [] },
      ],
    },
  },

  // ── Company channels: '@named' points reach only the companies the
  // text is about; peers in the same sector are not credited with them. ──
  earnings: {
    up: {
      mechanism: 'Results ahead of expectations reset the forward estimates the market capitalises.',
      positives: [
        { text: 'Profit or revenue ahead of expectations pushes forward earnings estimates up, which is what re-rates a stock.', sectors: ['@named'] },
        { text: 'A beat driven by margins rather than one-offs tends to carry into the following quarters.', sectors: ['@named'] },
      ],
      negatives: [
        { text: 'If the beat was already expected, the stock can still be sold on the news.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'A miss or cut guidance lowers the forward estimates the market capitalises.',
      positives: [
        { text: 'A miss driven by one-off costs can leave underlying earnings power intact.', sectors: [] },
      ],
      negatives: [
        { text: 'Forward earnings estimates are cut, and the de-rating compounds the decline in profit.', sectors: ['@named'] },
        { text: 'Weaker results or guidance dent management credibility beyond the quarter itself.', sectors: ['@named'] },
      ],
    },
    neutral: {
      mechanism: 'The results are named but not how they compared with expectations.',
      positives: [{ text: 'A result in line with expectations removes uncertainty.', sectors: ['@named'] }],
      negatives: [{ text: 'Until the numbers are out, estimates and the stock can move either way.', sectors: ['@named'] }],
    },
  },

  capital_return: {
    up: {
      mechanism: 'Returning capital signals confidence in cash generation without changing the business’s earnings power.',
      positives: [
        { text: 'Returning cash signals management’s confidence in future cash generation.', sectors: ['@named'] },
        { text: 'Shareholders receive cash or extra shares directly, and a buyback lifts earnings per share for those who stay.', sectors: ['@named'] },
      ],
      negatives: [
        { text: 'The distribution moves value to shareholders rather than creating it; the earnings power of the business is unchanged.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Cancelling or deferring a payout signals caution about cash.',
      positives: [{ text: 'Retained cash stays available for the business.', sectors: [] }],
      negatives: [
        { text: 'Cancelling or deferring a payout signals that management wants to conserve cash.', sectors: ['@named'] },
        { text: 'Income-focused shareholders sell when an expected payout is withdrawn.', sectors: ['@named'] },
      ],
    },
  },

  ma: {
    neutral: {
      mechanism: 'A deal changes the acquirer’s earnings mix and leverage and re-prices the target towards the deal value.',
      positives: [
        { text: 'The deal adds revenue, capacity or market access that would take years to build.', sectors: ['@named'] },
      ],
      negatives: [
        { text: 'Paying a premium and funding it with debt or new shares weighs on returns until the synergies arrive.', sectors: ['@named'] },
        { text: 'Integration risk is real: many acquisitions take longer to pay off than planned.', sectors: [] },
      ],
    },
  },

  management: {
    up: {
      mechanism: 'A leadership appointment matters through the strategy it signals.',
      positives: [
        { text: 'A credible new leader can bring a clearer strategy and renewed execution focus.', sectors: ['@named'] },
      ],
      negatives: [
        { text: 'Strategy changes take quarters to show in earnings, and transitions carry execution risk.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'An unplanned senior departure creates execution and continuity risk.',
      positives: [
        { text: 'A well-prepared successor or a respected interim leader can limit the disruption.', sectors: [] },
      ],
      negatives: [
        { text: 'An unplanned departure creates execution and continuity risk until a successor and their mandate are known.', sectors: ['@named'] },
        { text: 'Investors discount the existing strategy while its owner is leaving.', sectors: ['@named'] },
      ],
    },
  },

  company_news: {
    up: {
      mechanism: 'Company-specific good news feeds that company’s forward estimates directly.',
      positives: [
        { text: 'New business, pricing power or a favourable development raises this company’s earnings outlook directly.', sectors: ['@named'] },
        { text: 'Positive news flow tends to draw buying interest until the next result tests it.', sectors: ['@named'] },
      ],
      negatives: [
        { text: 'Part of the good news may already be in the price.', sectors: [] },
      ],
    },
    down: {
      mechanism: 'Company-specific bad news hits that company through its earnings outlook and the discount investors apply.',
      positives: [
        { text: 'If the issue proves contained, the sell-off can overshoot the actual damage.', sectors: [] },
      ],
      negatives: [
        { text: 'The setback hits this company’s earnings outlook or governance standing directly.', sectors: ['@named'] },
        { text: 'Investors apply a discount until the issue is resolved, so the overhang can outlast the news.', sectors: ['@named'] },
      ],
    },
  },
}

/** Tag for points that reach only the companies an event names. */
const NAMED = '@named'

/**
 * A point applies to an entity if it is broad, or names that entity's
 * sector; '@named' points apply only to entities the event is about.
 */
function applicable(points: ImpactPoint[], sector: string, companyScope: boolean, symbol?: string): ImpactPoint[] {
  // For news about a particular company, the sector-wide points describe a
  // different event (a rule for every lender, not an order against one).
  // '=SYMBOL' points are about one company's business within its sector — a
  // jeweller on a gold move, not every consumer-durables maker.
  return points.filter((p) =>
    p.sectors.length === 0
      ? true
      : companyScope
        ? p.sectors.includes(NAMED)
        : p.sectors.includes(sector) || (symbol !== undefined && p.sectors.includes(`=${symbol}`))
  )
}

/** Broad points weigh half a sector-specific one; see EntityImpact.balance. */
function weight(points: ImpactPoint[]): number {
  return points.reduce((sum, p) => sum + (p.sectors.length === 0 ? 0.5 : 1), 0)
}

function balanceOf(positives: ImpactPoint[], negatives: ImpactPoint[]): number {
  const up = weight(positives)
  const down = weight(negatives)
  return up + down === 0 ? 0 : (up - down) / (up + down)
}

function resolveDirection(positives: ImpactPoint[], negatives: ImpactPoint[]): ImpactDirection {
  if (positives.length === 0 && negatives.length === 0) return 'NEUTRAL'
  if (positives.length === 0) return 'NEGATIVE'
  if (negatives.length === 0) return 'POSITIVE'
  // Both sides present: a clear majority decides, otherwise it is genuinely
  // mixed and saying so is more useful than picking one. Weighted like the
  // score (broad points count half), so a label never contradicts its number:
  // one direct benefit against one market-wide caveat is a benefit, not a tie.
  const ratio = weight(positives) / (weight(positives) + weight(negatives))
  if (ratio > 0.6) return 'POSITIVE'
  if (ratio < 0.4) return 'NEGATIVE'
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
  const text = `${request.title} ${request.description || ''}`.trim()
  const read = assessEvent(text)
  const classification = read.classification

  // The impact table is keyed by which way the underlying VARIABLE moved, not
  // by the market's reaction to it. Those are frequently opposite — crude
  // rising is a NEGATIVE market direction — so the polarity comes from the
  // assessment of the text, not from classification.direction.
  const polarity: Polarity = read.polarity
  const channelKey =
    classification.channel === 'policy_rate' && polarity === 'neutral'
      ? 'policy_rate_neutral'
      : classification.channel ?? THEME_BY_EVENT_TYPE[classification.event_type]
  const channel = channelKey ? CHANNEL_IMPACTS[channelKey] : undefined
  // Only the side the text actually describes. A channel with no side for
  // "neutral" gets no read at all — never the "up" side by default, which is
  // how "Crude oil crashed by 25%" came back as a crude spike.
  const sided = channel?.[polarity] ?? (polarity === 'neutral' ? undefined : channel?.neutral)

  const sectors = request.sectors.length > 0 ? request.sectors : classification.affected_sectors

  // Who the event is about. For a company channel only these are touched;
  // for a macro channel everyone in an affected sector is.
  const namedSymbols = new Set(read.companies.map((c) => c.symbol))
  const namedSectors = new Set<string>(
    read.companies.length > 0 ? read.companies.map((c) => c.sector) : read.mentionedSectors
  )
  const companyScope = read.scope === 'company'
  const targetedCompany = (symbol: string, sector: string) =>
    namedSymbols.size > 0 ? namedSymbols.has(symbol) : namedSectors.has(sector)
  const subject = read.companies.map((c) => c.name).slice(0, 3).join(', ')

  const empty = (entity: string, kind: 'sector' | 'company', sector: string, mechanism: string): EntityImpact => ({
    entity,
    kind,
    sector,
    direction: 'NEUTRAL',
    confidence: 20,
    positives: [],
    negatives: [],
    balance: 0,
    mechanism,
  })

  if (!sided) {
    const why = !channel
      ? 'No standard transmission channel was recognised in this headline, so no directional read is offered for this entity.'
      : `The headline points to the ${read.label} channel but does not say which way it moved, so no direction is assigned.`
    return {
      headline: request.title,
      eventType: classification.event_type,
      economicVariable: classification.economic_variable,
      overallDirection: 'NEUTRAL',
      magnitude: classification.magnitude,
      mechanism: !channel
        ? 'This headline did not match a known macro or corporate transmission channel, so the engine offers no impact read rather than inventing one.'
        : `The headline points to the ${read.label} channel without saying which way it moved, so the engine offers no direction rather than guessing one.`,
      sectorImpacts: sectors.map((s) => empty(s, 'sector', s, why)),
      companyImpacts: (request.companies || []).map((c) => empty(c.name || c.symbol, 'company', c.sector, why)),
      unrecognised: !channel,
    }
  }

  const build = (entity: string, kind: 'sector' | 'company', sector: string, symbol?: string): EntityImpact => {
    const targeted = kind === 'company' && symbol ? targetedCompany(symbol, sector) : namedSectors.has(sector)
    if (companyScope && !targeted) {
      return empty(
        entity,
        kind,
        sector,
        subject
          ? `This is news about ${subject}; ${entity} is not directly affected by it.`
          : `This is company news; ${entity} is not directly affected by it.`
      )
    }
    const up = applicable(sided.positives, sector, companyScope, symbol)
    const down = applicable(sided.negatives, sector, companyScope, symbol)
    const positives = up.map((p) => p.text)
    const negatives = down.map((p) => p.text)
    const direction = resolveDirection(up, down)
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
      balance: balanceOf(up, down),
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
    companyImpacts: (request.companies || []).map((c) => build(c.name || c.symbol, 'company', c.sector, c.symbol)),
    unrecognised: false,
  }
}

/**
 * For classifications that carry no channel id (the language-model path),
 * the event type picks the impact table. An unmapped type degrades to "no
 * read" rather than silently matching the wrong channel.
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
  AGRICULTURE: 'monsoon',
  EMPLOYMENT: 'employment',
  CREDIT_RATING: 'ratings',
  'M&A': 'ma',
  DIVIDEND: 'capital_return',
  MANAGEMENT_CHANGE: 'management',
  TRADE_POLICY: 'trade',
  PANDEMIC: 'pandemic',
  MARKET_MOVE: 'market_move',
  CORPORATE_NEWS: 'company_news',
}

/**
 * The 0-100 "event impact" factor for one entity, from its own two-sided read.
 *
 * 50 is no net effect. The event's magnitude sets how far a one-sided read can
 * move from there, and the entity's balance scales it: an airline facing only
 * cost points on a crude spike takes the full move down, an upstream producer
 * with two direct benefits and one broad caveat most of the move up, and an
 * evenly balanced read stays at 50.
 *
 * Scoring every company off the event's single market direction instead put
 * ONGC on AVOID for a crude spike, which is the one event that pays it.
 */
export function impactScore(impact: Pick<EntityImpact, 'balance'>, magnitude: number): number {
  const balance = Math.max(-1, Math.min(1, impact.balance))
  return Math.round(50 + balance * (Math.max(0, Math.min(100, magnitude)) / 2))
}
