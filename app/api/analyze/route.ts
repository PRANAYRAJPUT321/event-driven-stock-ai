import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { classifyEvent, generateCounterArgument } from '@/lib/ai/eventClassifier'
import {
  getMockFundamentals,
  getMockValuation,
  getMockTechnical,
  getMockRisk,
  riskScoreToLevel,
} from '@/lib/market/mockData'
import {
  getHistoricalReaction,
  historicalReturnToScore,
} from '@/lib/market/historicalEngine'
import {
  calculateCompositeScore,
  calculateFundamentalScore,
  calculateValuationScore,
  calculateTechnicalScore,
  calculateRiskScore,
  scoreToRecommendation,
} from '@/lib/scoring/scoreCalculator'

const MAX_STOCKS_ANALYZED = 6

export async function POST(request: NextRequest) {
  try {
    const { event } = await request.json()

    if (!event || !event.trim()) {
      return NextResponse.json({ error: 'Event text is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── STEP 1: AI Event Classification ────────────────────────────────
    const classification = await classifyEvent(event)

    const { data: eventData, error: eventError } = await supabase
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

    if (eventError || !eventData) {
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 })
    }

    // ── STEP 2: Historical Event Engine (deterministic, no AI numbers) ──
    const primarySector = classification.affected_sectors?.[0]
    const historical = await getHistoricalReaction(
      supabase,
      classification.event_type,
      classification.economic_variable,
      classification.direction,
      primarySector
    )

    const historicalReactionScore = historical
      ? historicalReturnToScore(historical.avgSectorReturn.d5, classification.direction as any)
      : 50 // neutral fallback when no historical match exists

    // ── STEP 3: Affected Stocks (from seeded stock universe) ───────────
    let stocksQuery = supabase.from('stocks').select('*')
    if (classification.affected_sectors && classification.affected_sectors.length > 0) {
      stocksQuery = stocksQuery.in('sector', classification.affected_sectors)
    }
    const { data: candidateStocks } = await stocksQuery.limit(MAX_STOCKS_ANALYZED)
    const affectedStocks = candidateStocks && candidateStocks.length > 0 ? candidateStocks : []

    // ── STEP 4: Deterministic Multi-Factor Scoring per stock ────────────
    const eventImpactScore = classification.direction === 'NEGATIVE'
      ? 50 - classification.magnitude / 2
      : classification.direction === 'POSITIVE'
        ? 50 + classification.magnitude / 2
        : 50

    const stockResults = affectedStocks.map((stock: any) => {
      const fundamentals = getMockFundamentals(stock.symbol)
      const valuation = getMockValuation(stock.symbol, stock.sector)
      const technical = getMockTechnical(stock.symbol)
      const risk = getMockRisk(stock.symbol)

      const fundamentalScore = calculateFundamentalScore(
        fundamentals.roe,
        fundamentals.roce,
        fundamentals.profitGrowth,
        fundamentals.revenueGrowth
      )
      const valuationScore = calculateValuationScore(
        valuation.peRatio,
        valuation.pbRatio,
        valuation.sectorAvgPe,
        valuation.sectorAvgPb
      )
      const technicalScore = calculateTechnicalScore(
        technical.price,
        technical.sma50,
        technical.sma200,
        technical.rsi
      )
      const riskScoreValue = calculateRiskScore(
        risk.beta,
        risk.volatility,
        fundamentals.debtEquity,
        fundamentals.interestCoverage
      )

      const compositeScore = calculateCompositeScore({
        eventImpact: eventImpactScore,
        historicalReaction: historicalReactionScore,
        fundamentalStrength: fundamentalScore,
        valuation: valuationScore,
        technicalCondition: technicalScore,
        riskScore: riskScoreValue,
      })

      return {
        stock,
        fundamentals,
        valuation,
        technical,
        risk,
        fundamentalScore,
        valuationScore,
        technicalScore,
        riskScoreValue,
        compositeScore,
        recommendation: scoreToRecommendation(compositeScore),
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

      counterArgument = await generateCounterArgument({
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
      })
    }

    // ── STEP 6: Persist event_analysis (parent record) ──────────────────
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
      return NextResponse.json({ error: 'Failed to create analysis' }, { status: 500 })
    }

    // ── STEP 7: Persist per-stock scores ─────────────────────────────────
    if (stockResults.length > 0) {
      const scoreRows = stockResults.map((r) => ({
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

      await supabase.from('stock_scores').insert(scoreRows)
    }

    return NextResponse.json({
      success: true,
      analysisId: analysisData.id,
      classification,
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
