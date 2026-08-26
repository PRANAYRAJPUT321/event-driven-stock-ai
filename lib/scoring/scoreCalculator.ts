/**
 * Event Opportunity Score Calculator
 * Combines multiple factors into a single 0-100 score
 */

export interface ScoreFactors {
  eventImpact: number // 0-100
  historicalReaction: number // 0-100
  fundamentalStrength: number // 0-100
  valuation: number // 0-100
  technicalCondition: number // 0-100
  riskScore: number // 0-100
}

export interface ScoringWeights {
  eventImpact: number
  historicalReaction: number
  fundamentalStrength: number
  valuation: number
  technicalCondition: number
  riskScore: number
}

// Default weights (can be overridden)
export const DEFAULT_WEIGHTS: ScoringWeights = {
  eventImpact: 0.25,
  historicalReaction: 0.20,
  fundamentalStrength: 0.20,
  valuation: 0.15,
  technicalCondition: 0.10,
  riskScore: 0.10,
}

export function calculateCompositeScore(
  factors: ScoreFactors,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  const score =
    factors.eventImpact * weights.eventImpact +
    factors.historicalReaction * weights.historicalReaction +
    factors.fundamentalStrength * weights.fundamentalStrength +
    factors.valuation * weights.valuation +
    factors.technicalCondition * weights.technicalCondition +
    factors.riskScore * weights.riskScore

  return Math.min(100, Math.max(0, Math.round(score)))
}

export function scoreToRecommendation(score: number): 'BUY' | 'HOLD' | 'AVOID' {
  if (score >= 75) return 'BUY'
  if (score >= 60) return 'HOLD'
  return 'AVOID'
}

export function scoreToOpportunityLevel(score: number): string {
  if (score >= 90) return 'Very Strong Opportunity'
  if (score >= 75) return 'Strong Opportunity'
  if (score >= 60) return 'Moderate Opportunity'
  if (score >= 40) return 'Neutral'
  return 'Weak'
}

export function calculateFundamentalScore(
  roe: number = 15,
  roce: number = 18,
  profitGrowth: number = 10,
  revenueGrowth: number = 8
): number {
  // Normalize scores based on Indian market benchmarks
  const roeScore = Math.min(100, (roe / 20) * 100) // 20% ROE = 100
  const roceScore = Math.min(100, (roce / 20) * 100) // 20% ROCE = 100
  const profitScore = Math.min(100, (profitGrowth / 20) * 100) // 20% growth = 100
  const revenueScore = Math.min(100, (revenueGrowth / 15) * 100) // 15% growth = 100

  return Math.round((roeScore + roceScore + profitScore + revenueScore) / 4)
}

export function calculateValuationScore(
  peRatio: number = 20,
  pbRatio: number = 2,
  sectorAvgPe: number = 20,
  sectorAvgPb: number = 2
): number {
  // PE comparison (lower is better, but not too low)
  const peScore = peRatio > 0 && sectorAvgPe > 0
    ? Math.max(0, 100 - Math.abs(peRatio - sectorAvgPe) / sectorAvgPe * 50)
    : 50

  // PB comparison
  const pbScore = pbRatio > 0 && sectorAvgPb > 0
    ? Math.max(0, 100 - Math.abs(pbRatio - sectorAvgPb) / sectorAvgPb * 50)
    : 50

  return Math.round((peScore + pbScore) / 2)
}

export function calculateTechnicalScore(
  price: number = 100,
  sma50: number = 95,
  sma200: number = 90,
  rsi: number = 50
): number {
  // Price above moving averages is positive
  const priceVsSma50 = price > sma50 ? 60 : 40
  const priceVsSma200 = price > sma200 ? 70 : 30

  // RSI: 30-70 is neutral, <30 is oversold (buy), >70 is overbought (sell)
  let rsiScore = 50
  if (rsi < 30) rsiScore = 75 // Oversold
  else if (rsi > 70) rsiScore = 25 // Overbought
  else rsiScore = 50 + (rsi - 50) * 0.5 // Neutral

  return Math.round((priceVsSma50 + priceVsSma200 + rsiScore) / 3)
}

export function calculateRiskScore(
  beta: number = 1,
  volatility: number = 20,
  debtEquity: number = 0.5,
  interestCoverage: number = 3
): number {
  // Beta > 1.5 = high risk
  const betaScore = Math.min(100, Math.max(0, 100 - (beta - 1) * 30))

  // Volatility > 30% = high risk
  const volScore = Math.max(0, 100 - volatility * 1.5)

  // High D/E = higher risk
  const deScore = Math.max(0, 100 - debtEquity * 30)

  // Low interest coverage = high risk
  const icScore = Math.min(100, Math.max(0, (interestCoverage / 5) * 100))

  return Math.round((betaScore + volScore + deScore + icScore) / 4)
}
