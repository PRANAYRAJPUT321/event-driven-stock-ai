import { NextRequest, NextResponse } from 'next/server'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import { classifyEvent, generateCounterArgument } from '@/lib/ai/eventClassifier'
import { assessEvent, buildCounterArgumentFromRules, type EventAssessment } from '@/lib/ai/ruleClassifier'
import { analyseImpact, impactScore, type ImpactDirection } from '@/lib/ai/impactAnalyzer'
import { fetchStockMetricsMany, valuationBenchmarks, type StockMetrics } from '@/lib/market/realMetrics'
import {
  getHistoricalReactions,
  historicalReturnToScore,
  type HistoricalReactionSummary,
} from '@/lib/market/historicalEngine'
import {
  equitiesForSectors,
  findEquity,
  NIFTY_50,
  sectorsWithoutConstituents,
  type EquityConstituent,
} from '@/lib/market/indianEquities'
import {
  calculateCompositeFromAvailable,
  riskScoreToLevel,
  scoreFundamental,
  scoreRisk,
  scoreTechnical,
  recommendationFromComposite,
  scoreValuation,
} from '@/lib/scoring/scoreCalculator'

/** When the engine picks the companies itself. */
const MAX_STOCKS_ANALYZED = 6
/** When the user picks them, they get a larger budget — it is their request. */
const MAX_STOCKS_REQUESTED = 12

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const event = body?.event

    // An explicit company list beats the engine's own sector mapping: the
    // reader often knows which names they care about, and "RBI hikes rates"
    // scored against the first six banks is a weaker answer than the same
    // event scored against the six names they actually hold.
    const requestedSymbols: string[] = Array.isArray(body?.symbols)
      ? Array.from(
          new Set<string>(
            (body.symbols as unknown[])
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          )
        ).slice(0, MAX_STOCKS_REQUESTED)
      : []

    if (!event || typeof event !== 'string' || !event.trim()) {
      return NextResponse.json({ error: 'Event text is required' }, { status: 400 })
    }
    if (event.length > 2000) {
      return NextResponse.json({ error: 'Please keep the event to a short description (under 2,000 characters).' }, { status: 400 })
    }

    // Text the engine cannot trace is refused with the reason, instead of
    // being scored anyway: "I love you" used to fall through to a catch-all
    // "Diversified" sector and come back as a HOLD on Adani Enterprises, and
    // "Crude oil crashed by 25%" — whose verb the rules did not know — as a
    // crude SPIKE. See assessEvent for each verdict.
    const assessment = assessEvent(event)
    const ruleRead = assessment.classification
    const refusal = refusalFor(event, assessment, requestedSymbols.length > 0)
    if (refusal) return NextResponse.json(refusal, { status: 422 })

    // Whether we can persist is a separate question from whether we can
    // analyse. Nothing in the analysis below needs a database: classification
    // is deterministic and the per-stock metrics are seeded by symbol. So a
    // signed-out visitor, or a paused Supabase project, gets the full result
    // anyway — it just isn't saved.
    const supabase = isSupabaseConfigured ? createClient() : null

    let user = null
    if (supabase) {
      try {
        const { data } = await supabase.auth.getUser()
        user = data.user
      } catch {
        // Supabase unreachable — treated the same as signed out.
      }
    }

    // ── STEP 1: Event Classification ───────────────────────────────────
    // Only a signed-in request may spend model tokens. This endpoint is
    // reachable without a session so that the app keeps working when the
    // database is down, and an anonymous, unthrottled route that makes two
    // Claude calls per request is exactly the credit-exhaustion problem this
    // whole rebuild exists to remove. Anonymous requests get the rule engine,
    // which is what an unfunded key would have produced anyway.
    const classification = user
      ? await classifyEvent(event)
      : ruleRead

    let eventData: { id: string } | null = null
    let eventInsertError: string | null = null
    if (user && supabase) {
      const { data, error } = await supabase
        .from('events')
        .insert({
          user_id: user.id,
          title: event.substring(0, 200),
          description: event,
          event_type: classification.event_type,
          economic_variable: classification.economic_variable,
          direction: classification.direction,
          magnitude: classification.magnitude,
          confidence: classification.confidence,
          transmission_explanation: classification.transmission_explanation,
        })
        .select()
        .single()
      // A failed insert is no longer fatal — it costs persistence, not the
      // analysis — but it must not be reported as "ran without a database".
      eventData = data
      if (error) eventInsertError = error.message
    }

    // ── STEP 2: Historical Event Engine (deterministic, no AI numbers) ──
    const primarySector = classification.affected_sectors?.[0]
    // Historical evidence is the one part that genuinely requires the
    // database, and it is per sector: past airline returns after crude spikes
    // say nothing about producers. A sector with no matching history gets no
    // historical factor at all — it is excluded from that stock's composite
    // rather than filled with a neutral 50 that would count as evidence.
    let historyBySector = new Map<string, HistoricalReactionSummary>()
    if (user && supabase) {
      try {
        historyBySector = await getHistoricalReactions(
          supabase,
          classification.event_type,
          classification.economic_variable,
          classification.direction
        )
      } catch {
        historyBySector = new Map()
      }
    }
    // The headline evidence shown on the page is the primary sector's.
    const historical = (primarySector && historyBySector.get(primarySector)) || null

    // ── STEP 3: Affected Stocks ─────────────────────────────────────────
    // The NIFTY 50 constituent list (lib/market/indianEquities.ts) is the
    // universe, not the `stocks` table: the table was seeded with tickers that
    // do not resolve on any exchange, and every symbol here is fetched live
    // from Yahoo, where a wrong ticker is simply a 404.
    const sectors = classification.affected_sectors ?? []

    // Symbols the caller named that are not in the universe are reported
    // rather than silently dropped — a typo should say so.
    const requested = requestedSymbols
      .map((symbol) => findEquity(symbol))
      .filter((e): e is EquityConstituent => e !== undefined)
    const unknownSymbols = requestedSymbols.filter((symbol) => !findEquity(symbol))

    // News about particular companies is scored on those companies; a macro
    // event on its sectors, with any company the text names kept in. Peers
    // used to be scored with the named company's own event read, which put
    // Infosys at the top of "TCS announces a buyback".
    const candidates: EquityConstituent[] =
      requested.length > 0
        ? requested
        : assessment.scope === 'company' && assessment.companies.length > 0
          ? assessment.companies.slice(0, MAX_STOCKS_REQUESTED)
          : Array.from(
              new Map(
                [
                  ...assessment.companies,
                  ...(assessment.focus.length > 0
                    ? assessment.focus.map((s) => findEquity(s)).filter((e): e is EquityConstituent => !!e)
                    : equitiesForSectors(sectors, MAX_STOCKS_ANALYZED)),
                ].map((c) => [c.symbol, c])
              ).values()
            ).slice(0, Math.max(MAX_STOCKS_ANALYZED, assessment.companies.length))
    // Named by the classification but absent from this universe — reported so
    // the page can say "no NIFTY 50 name is exposed to Aviation" rather than
    // quietly showing an unrelated company in its place.
    const unmatchedSectors = sectorsWithoutConstituents(sectors)

    // Map to database ids where the table has them, so a signed-in analysis
    // can still be watchlisted and stored against a real row.
    const idBySymbol = new Map<string, string>()
    if (user && supabase) {
      try {
        const { data } = await supabase
          .from('stocks')
          .select('id, symbol')
          .in('symbol', candidates.map((c) => c.symbol))
        for (const row of data ?? []) idBySymbol.set(row.symbol, row.id)
      } catch {
        // Not fatal: without an id the stock is scored but not linkable.
      }
    }

    // ── STEP 4: Multi-Factor Scoring from real market data ──────────────
    // The event's net market direction, used for the headline and as the
    // fallback when no transmission channel was recognised.
    const eventImpactScore = Math.round(
      classification.direction === 'NEGATIVE'
        ? 50 - classification.magnitude / 2
        : classification.direction === 'POSITIVE'
          ? 50 + classification.magnitude / 2
          : 50
    )

    // Each company's own read of the event, from its sector's side of the
    // transmission channel: a crude spike is a cost shock to an airline and a
    // windfall to a producer, and one global direction scored both the same.
    const impact = analyseImpact({
      title: event,
      sectors,
      companies: candidates.map((c) => ({ symbol: c.symbol, name: c.name, sector: c.sector })),
    })
    const impactBySymbol = new Map(
      candidates.map((c, i) => {
        const read = impact.companyImpacts[i]
        if (impact.unrecognised || !read) {
          return [
            c.symbol,
            {
              score: eventImpactScore,
              direction: classification.direction as ImpactDirection,
              positives: [] as string[],
              negatives: [] as string[],
            },
          ] as const
        }
        return [
          c.symbol,
          {
            score: impactScore(read, classification.magnitude),
            direction: read.direction,
            positives: read.positives,
            negatives: read.negatives,
          },
        ] as const
      })
    )

    // One screener request covers every candidate's price, valuation and
    // fundamentals; each also gets a year of daily closes for volatility.
    // Valuation is relative, so each company is measured against its own
    // sector's median multiple in the NIFTY 50 (the whole index for sectors
    // too small to have one) — measured, not a hardcoded table, and not the
    // mix of unrelated companies a single event happens to touch.
    const [metricsBySymbol, benchmarkFor] = await Promise.all([
      fetchStockMetricsMany(candidates) as Promise<Map<string, StockMetrics>>,
      valuationBenchmarks(NIFTY_50),
    ])
    const indexBenchmark = benchmarkFor('')
    const peerMedianPe = indexBenchmark.pe
    const peerMedianPb = indexBenchmark.pb

    const stockResults = candidates.map((stock) => {
      const metrics = metricsBySymbol.get(stock.symbol) ?? null
      const eventRead = impactBySymbol.get(stock.symbol)!
      const sectorHistory = historyBySector.get(stock.sector) ?? null

      const fundamentalScore = scoreFundamental(metrics?.fundamental ?? null)
      const benchmark = benchmarkFor(stock.sector)
      const valuationScore = scoreValuation(metrics?.valuation ?? null, benchmark.pe, benchmark.pb)
      const technicalScore = scoreTechnical(metrics?.technical ?? null)
      const riskScoreValue = scoreRisk(metrics?.risk ?? null)

      const composite = calculateCompositeFromAvailable({
        eventImpact: eventRead.score,
        historicalReaction: sectorHistory ? historicalReturnToScore(sectorHistory.avgSectorReturn.d5) : null,
        fundamentalStrength: fundamentalScore,
        valuation: valuationScore,
        technicalCondition: technicalScore,
        riskScore: riskScoreValue,
      })

      return {
        stock: { ...stock, id: idBySymbol.get(stock.symbol) },
        metrics,
        eventRead,
        fundamentalScore,
        valuationScore,
        technicalScore,
        riskScoreValue,
        compositeScore: composite.score,
        coverage: composite.coverage,
        excludedFactors: composite.excluded,
        recommendation: recommendationFromComposite(composite),
      }
    })

    stockResults.sort((a, b) => b.compositeScore - a.compositeScore)

    // ── STEP 5: Counter-Argument Engine (AI explains the top stock only —
    // keeps latency/cost bounded while still delivering the explainability
    // and challenge-the-thesis requirement from spec section 20) ────────
    let counterArgument = null
    const topStock = stockResults[0]
    if (topStock) {
      const historicalSummary = historical
        ? `In ${historical.matchCount} similar historical events, ${primarySector} sector averaged ${historical.avgSectorReturn.d5}% return over 5 days and NIFTY averaged ${historical.avgNiftyReturn.d5}%.`
        : undefined

      const decisionInput = {
        eventReasoning: classification.reasoning,
        transmissionExplanation: classification.transmission_explanation,
        // This company's own read, not the market-wide one: the narrative for
        // an upstream producer on a crude spike must not call it a headwind.
        eventDirection:
          topStock.eventRead.score >= 55 ? 'POSITIVE' : topStock.eventRead.score <= 45 ? 'NEGATIVE' : 'NEUTRAL',
        eventPositives: topStock.eventRead.positives,
        eventNegatives: topStock.eventRead.negatives,
        eventMagnitude: classification.magnitude,
        stockSymbol: topStock.stock.symbol,
        compositeScore: topStock.compositeScore,
        fundamentalScore: topStock.fundamentalScore,
        valuationScore: topStock.valuationScore,
        technicalScore: topStock.technicalScore,
        riskScore: topStock.riskScoreValue,
        historicalSummary,
      }
      counterArgument = user
        ? await generateCounterArgument(decisionInput)
        : buildCounterArgumentFromRules(decisionInput)
    }

    // ── STEP 6: Persist, when there is somewhere to persist to ──────────
    let analysisId: string | null = null
    let persistError: string | null = eventInsertError

    if (user && supabase && eventData) {
      const { data: analysisData, error: analysisError } = await supabase
        .from('event_analysis')
        .insert({
          user_id: user.id,
          event_id: eventData.id,
          event_title: event.substring(0, 200),
          affected_sectors: classification.affected_sectors,
          opportunity_score: topStock?.compositeScore ?? classification.magnitude,
          composite_score: topStock?.compositeScore ?? null,
          recommendation: topStock?.recommendation ?? null,
          bull_case: counterArgument?.bullCase ?? null,
          bear_case: counterArgument?.bearCase ?? null,
          contradictory_evidence: counterArgument?.contradictoryEvidence ?? null,
          risks: counterArgument?.keyRisks ?? [],
          historical_summary: historical,
          analysis_json: classification,
        })
        .select()
        .single()

      if (analysisError || !analysisData) {
        persistError = analysisError?.message || 'Could not save this analysis'
      } else {
        analysisId = analysisData.id

        // ── STEP 7: Persist per-stock scores ─────────────────────────────
        // Only stocks that came from the database have an id to key on; the
        // built-in universe has none, which is another reason this step is
        // skipped entirely when the database is not in play.
        const scoreRows = stockResults
          .filter((r) => r.stock.id)
          .map((r) => ({
            event_analysis_id: analysisData.id,
            stock_id: r.stock.id,
            stock_symbol: r.stock.symbol,
            event_impact_score: r.eventRead.score,
            event_impact_direction: r.eventRead.direction,
            fundamental_score: r.fundamentalScore,
            valuation_score: r.valuationScore,
            technical_score: r.technicalScore,
            risk_score: r.riskScoreValue,
            risk_level: riskScoreToLevel(r.riskScoreValue),
            opportunity_score: r.compositeScore,
            recommendation: r.recommendation,
            confidence: classification.confidence,
          }))

        if (scoreRows.length > 0) {
          await supabase.from('stock_scores').insert(scoreRows)
        }
      }
    }

    // The full result is returned either way. With an analysisId the client
    // redirects to the saved page; without one it renders this payload
    // directly, so an unreachable database costs history, not the answer.
    return NextResponse.json({
      success: true,
      analysisId,
      persisted: analysisId !== null,
      persistError,
      result: {
        eventTitle: event.substring(0, 200),
        classification,
        historical,
        counterArgument,
        eventImpactScore,
        unmatchedSectors,
        unknownSymbols,
        /** Whether the caller chose the companies or the engine did. */
        selectionMode: requested.length > 0 ? 'requested' : 'derived',
        /**
         * Every constituent in the affected sectors, so the page can offer the
         * full choice rather than only the handful it happened to score.
         */
        sectorUniverse: NIFTY_50.filter((s) => sectors.includes(s.sector)).map((s) => ({
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
        })),
        stocks: stockResults.map((r) => ({
          symbol: r.stock.symbol,
          name: r.stock.name,
          sector: r.stock.sector,
          fundamentalScore: r.fundamentalScore,
          valuationScore: r.valuationScore,
          technicalScore: r.technicalScore,
          riskScore: r.riskScoreValue,
          riskLevel: riskScoreToLevel(r.riskScoreValue),
          // How the event reaches this company, from its own sector's side.
          eventImpactScore: r.eventRead.score,
          eventImpactDirection: r.eventRead.direction,
          eventPositives: r.eventRead.positives,
          eventNegatives: r.eventRead.negatives,
          opportunityScore: r.compositeScore,
          recommendation: r.recommendation,
          // How much of the default weighting had real data behind it, and
          // which factors were dropped for want of a source. Surfaced so the
          // UI can qualify a score instead of presenting every one as equally
          // well-evidenced.
          coverage: r.coverage,
          excludedFactors: r.excludedFactors,
          // The measured inputs themselves, so the page can show what the
          // score was actually computed from.
          price: r.metrics?.technical?.price ?? null,
          changePct: r.metrics?.technical?.changePct ?? null,
          peRatio: r.metrics?.valuation?.peRatio ?? null,
          pbRatio: r.metrics?.valuation?.pbRatio ?? null,
          marketCap: r.metrics?.valuation?.marketCap ?? null,
          returnOnEquityPct: r.metrics?.fundamental?.returnOnEquityPct ?? null,
          rsi14: r.metrics?.technical?.rsi14 ?? null,
          volatilityPct: r.metrics?.technical?.volatilityPct ?? null,
          dataNotes: r.metrics?.notes ?? ['No market data could be fetched for this stock'],
        })),
        peerMedianPe,
        peerMedianPb,
      },
      topStock: topStock?.stock.symbol,
      stockCount: stockResults.length,
    })
  } catch (error: any) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/** Example events, by channel, for a refusal that asks for a direction. */
const DIRECTION_EXAMPLES: Record<string, string> = {
  crude: 'Crude oil falls 10% on weak demand',
  gold: 'Gold prices rise 3% to a record high',
  currency: 'Rupee falls to 90 against the dollar',
  inflation: 'CPI inflation rises to 6.2%',
  growth: 'GDP growth slows to 5.4%',
  fiscal: 'Union Budget raises capital expenditure by 11%',
  trade: 'US imposes 25% tariffs on Indian goods',
  global: 'Wall Street sell-off deepens on recession fears',
  market_move: 'Sensex falls 1,000 points',
  monsoon: 'Monsoon rainfall forecast at 105% of the long-period average',
  employment: 'Unemployment rises to 8%',
  ratings: 'Moody’s upgrades India’s sovereign rating',
}

function quote(event: string): string {
  const text = event.trim().replace(/\s+/g, ' ')
  return `“${text.length > 60 ? text.slice(0, 57) + '…' : text}”`
}

/**
 * Why an event cannot be analysed, in words a reader can act on, with the
 * company pages it names so the answer is a way forward rather than a wall.
 * null when the event is fine.
 */
function refusalFor(event: string, a: EventAssessment, symbolsChosen: boolean) {
  const q = quote(event)
  const suggestions = [
    ...a.companies.map((c) => ({ symbol: c.symbol, name: c.name })),
    ...a.outside.map((o) => ({ symbol: o.symbol, name: o.phrase.replace(/\b\w/g, (ch) => ch.toUpperCase()) })),
  ].slice(0, 4)
  const first = suggestions[0]
  const make = (code: string, error: string) => ({ code, error, suggestions })

  switch (a.verdict) {
    case 'ok':
      return null
    case 'non_english':
      return make('NOT_AN_EVENT', 'PULSE reads events written in English. Try, for example, “RBI cuts the repo rate by 25 bps”.')
    case 'not_event':
      return make(
        'NOT_AN_EVENT',
        first
          ? `${q} names ${first.name} but doesn’t describe anything that happened, so there is no event to trace. ` +
              `Open ${first.name} for its live price, chart and financials, or describe an event — for example “${first.name} Q2 profit rises 12%”.`
          : `${q} doesn’t look like a market event, so there is nothing to trace to stocks. ` +
              'Describe something that moves markets — a policy decision, a commodity or currency move, company results, or economic data. ' +
              'For example: “RBI cuts the repo rate by 25 bps”.'
      )
    case 'needs_company':
      return symbolsChosen
        ? null
        : make(
            'NEEDS_COMPANY',
            `${q} reads as ${a.label}${/news$/.test(a.label ?? '') ? '' : ' news'} but doesn’t name a company, and this kind of event reaches only the company it is about. ` +
              'Name one of the NIFTY 50 companies PULSE scores — for example “Infosys Q2 profit beats estimates”.'
          )
    case 'outside_universe':
      return make(
        'OUTSIDE_UNIVERSE',
        `${a.outside.map((o) => o.phrase.replace(/\b\w/g, (ch) => ch.toUpperCase())).join(', ')} ` +
          `${a.outside.length > 1 ? 'are' : 'is'} not in the NIFTY 50, the universe PULSE scores against events. ` +
          'Its live chart and financials are on its company page.'
      )
    case 'no_direction':
      return make(
        'NO_DIRECTION',
        `PULSE recognised the ${a.label} channel, but ${q} doesn’t say which way it moved — and the companies it reaches gain or lose depending on that. ` +
          `Add the direction, for example “${
            a.channel === 'company_news' && first ? `${first.name} shares jump 8% on a new order` : DIRECTION_EXAMPLES[a.channel ?? ''] ?? 'RBI cuts the repo rate by 25 bps'
          }”.`
      )
    case 'no_sector':
      return symbolsChosen
        ? null
        : make(
            'NO_SECTOR',
            `PULSE recognised ${q} as ${a.label}${/news$/.test(a.label ?? '') ? '' : ' news'} but couldn’t connect it to a NIFTY 50 sector. ` +
              'Name the sector or company it affects — for example “…; impact on FMCG companies”.'
          )
  }
}
