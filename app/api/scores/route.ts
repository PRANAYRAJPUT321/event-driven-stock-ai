import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  calculateCompositeScore,
  calculateFundamentalScore,
  calculateValuationScore,
  calculateTechnicalScore,
  calculateRiskScore,
  scoreToRecommendation,
} from '@/lib/scoring/scoreCalculator'

export async function POST(request: NextRequest) {
  try {
    const { eventAnalysisId, stocks } = await request.json()

    if (!eventAnalysisId || !stocks || stocks.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    // Create scores for each stock
    const scores = stocks.map((stock: any) => {
      const fundamentalScore = calculateFundamentalScore(
        stock.roe,
        stock.roce,
        stock.profitGrowth,
        stock.revenueGrowth
      )
      const valuationScore = calculateValuationScore(
        stock.peRatio,
        stock.pbRatio,
        stock.sectorAvgPe || stock.peRatio,
        stock.sectorAvgPb || stock.pbRatio
      )
      const technicalScore = calculateTechnicalScore(
        stock.price,
        stock.sma50,
        stock.sma200,
        stock.rsi
      )
      const riskScore = calculateRiskScore(
        stock.beta,
        stock.volatility,
        stock.debtEquity,
        stock.interestCoverage
      )

      const eventImpactScore = (stock.eventImpact || 0) * 10 // 0-5 scale → 0-50
      const historicalReaction = (stock.historicalReaction || 0) * 10 // 0-5 scale → 0-50

      const compositeScore = calculateCompositeScore({
        eventImpact: eventImpactScore,
        historicalReaction: historicalReaction,
        fundamentalStrength: fundamentalScore,
        valuation: valuationScore,
        technicalCondition: technicalScore,
        riskScore: riskScore,
      })

      return {
        event_analysis_id: eventAnalysisId,
        stock_id: stock.stockId,
        stock_symbol: stock.symbol,
        event_impact_score: eventImpactScore,
        fundamental_score: fundamentalScore,
        valuation_score: valuationScore,
        technical_score: technicalScore,
        risk_score: riskScore,
        opportunity_score: compositeScore,
        recommendation: scoreToRecommendation(compositeScore),
        confidence: Math.round(60 + Math.random() * 30), // 60-90% confidence
      }
    })

    // Save all scores
    const { data, error } = await supabase
      .from('stock_scores')
      .insert(scores)
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
