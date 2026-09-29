import { NextRequest, NextResponse } from 'next/server'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import { classifyEvent, generateCounterArgument } from '@/lib/ai/eventClassifier'
import { buildCounterArgumentFromRules, classifyEventByRules } from '@/lib/ai/ruleClassifier'
import { fetchStockMetrics, type StockMetrics } from '@/lib/market/realMetrics'
import {
  getHistoricalReaction,
  historicalReturnToScore,
} from '@/lib/market/historicalEngine'
import { equitiesForSectors, type EquityConstituent } from '@/lib/market/indianEquities'
import {
  calculateCompositeFromAvailable,
  riskScoreToLevel,
  median,
  scoreFundamental,
  scoreRisk,
  scoreTechnical,
  scoreToRecommendation,
  scoreValuation,
} from '@/lib/scoring/scoreCalculator'

const MAX_STOCKS_ANALYZED = 6

export async function POST(request: NextRequest) {
  try {
    const { event } = await request.json()

    if (!event || !event.trim()) {
      return NextResponse.json({ error: 'Event text is required' }, { status: 400 })
    }

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
      : classifyEventByRules(event)

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
    // database. Without it the engine already has a defined behaviour: a
    // neutral 50, stated as "limited data" rather than invented.
    let historical = null
    if (user && supabase) {
      try {
        historical = await getHistoricalReaction(
          supabase,
          classification.event_type,
          classification.economic_variable,
          classification.direction,
          primarySector
        )
      } catch {
        historical = null
      }
    }

    const historicalReactionScore = historical
      ? historicalReturnToScore(historical.avgSectorReturn.d5, classification.direction as any)
      : 50 // neutral fallback when no historical match exists

    // ── STEP 3: Affected Stocks ─────────────────────────────────────────
    // The NIFTY 50 constituent list (lib/market/indianEquities.ts) is the
    // universe, not the `stocks` table: the table was seeded with tickers that
    // do not resolve on any exchange, and every symbol here is fetched live
    // from Yahoo, where a wrong ticker is simply a 404.
    const sectors = classification.affected_sectors ?? []
    const candidates: EquityConstituent[] = equitiesForSectors(sectors, MAX_STOCKS_ANALYZED)

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
    const eventImpactScore = classification.direction === 'NEGATIVE'
      ? 50 - classification.magnitude / 2
      : classification.direction === 'POSITIVE'
        ? 50 + classification.magnitude / 2
        : 50

    // One fetch per candidate, in parallel. Each pulls a year of daily closes
    // (for technicals) and, where Yahoo's fundamentals tier answers, the
    // valuation and company figures.
    const metricsSettled = await Promise.allSettled(
      candidates.map((c) => fetchStockMetrics(c.symbol, c.name, c.sector))
    )
    const metricsBySymbol = new Map<string, StockMetrics>()
    metricsSettled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') metricsBySymbol.set(candidates[i].symbol, outcome.value)
    })

    // Valuation is relative, so the benchmark is the median of the peers
    // actually in this analysis — measured, rather than a hardcoded sector
    // table of assumed multiples.
    const allMetrics = candidates.map((c) => metricsBySymbol.get(c.symbol) ?? null)
    const peerMedianPe = median(allMetrics.map((m) => m?.valuation?.peRatio ?? null))
    const peerMedianPb = median(allMetrics.map((m) => m?.valuation?.pbRatio ?? null))

    const stockResults = candidates.map((stock) => {
      const metrics = metricsBySymbol.get(stock.symbol) ?? null

      const fundamentalScore = scoreFundamental(metrics?.fundamental ?? null)
      const valuationScore = scoreValuation(metrics?.valuation ?? null, peerMedianPe, peerMedianPb)
      const technicalScore = scoreTechnical(metrics?.technical ?? null)
      const riskScoreValue = scoreRisk(metrics?.risk ?? null)

      const composite = calculateCompositeFromAvailable({
        eventImpact: eventImpactScore,
        historicalReaction: historicalReactionScore,
        fundamentalStrength: fundamentalScore,
        valuation: valuationScore,
        technicalCondition: technicalScore,
        riskScore: riskScoreValue,
      })

      return {
        stock: { ...stock, id: idBySymbol.get(stock.symbol) },
        metrics,
        fundamentalScore,
        valuationScore,
        technicalScore,
        riskScoreValue,
        compositeScore: composite.score,
        coverage: composite.coverage,
        excludedFactors: composite.excluded,
        recommendation: scoreToRecommendation(composite.score),
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
        eventDirection: classification.direction,
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
            event_impact_score: eventImpactScore,
            event_impact_direction: classification.direction,
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
        stocks: stockResults.map((r) => ({
          symbol: r.stock.symbol,
          name: r.stock.name,
          sector: r.stock.sector,
          fundamentalScore: r.fundamentalScore,
          valuationScore: r.valuationScore,
          technicalScore: r.technicalScore,
          riskScore: r.riskScoreValue,
          riskLevel: riskScoreToLevel(r.riskScoreValue),
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
