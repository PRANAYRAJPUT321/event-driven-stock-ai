/**
 * Event Opportunity Score Calculator
 * Combines multiple factors into a single 0-100 score
 */

import type {
  FundamentalMetrics,
  RiskMetrics,
  TechnicalMetrics,
  ValuationMetrics,
} from '@/lib/market/realMetrics'

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

export type Recommendation = 'BUY' | 'HOLD' | 'AVOID' | 'UNRATED'

export function scoreToRecommendation(score: number): 'BUY' | 'HOLD' | 'AVOID' {
  if (score >= 75) return 'BUY'
  if (score >= 60) return 'HOLD'
  return 'AVOID'
}

/**
 * The factors that say something about *this company* rather than about the
 * event. Event impact and historical reaction are identical for every name in
 * an affected sector, so a composite built from those alone ranks nothing and
 * distinguishes nothing.
 */
export const COMPANY_SPECIFIC_FACTORS = [
  'fundamentalStrength',
  'valuation',
  'technicalCondition',
  'riskScore',
] as const

/**
 * A recommendation, but only when there is company evidence behind it.
 *
 * Scoring a stock purely off the event leaves every candidate on the same
 * number — and because a bare event score usually lands below the HOLD line,
 * that number came out as a confident "AVOID" on companies the app had no
 * data for at all. Absence of data is not a negative verdict, so it now gets
 * its own state rather than borrowing the worst one.
 */
export function recommendationFromComposite(result: CompositeResult): Recommendation {
  const hasCompanyEvidence = result.contributions.some((c) =>
    (COMPANY_SPECIFIC_FACTORS as readonly string[]).includes(c.factor)
  )
  if (!hasCompanyEvidence) return 'UNRATED'
  return scoreToRecommendation(result.score)
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

/* ===========================================================================
   Scoring from real, sourced metrics.
   ---------------------------------------------------------------------------
   The functions above take plain numbers with default parameter values, which
   was workable when every input came from the mock generator and was therefore
   always present. With real data a factor can genuinely be unavailable — Yahoo
   refuses its fundamentals endpoint, or a newly listed stock has no 200-day
   average yet — and a default value is an invented one. These return null
   instead, and calculateCompositeFromAvailable re-weights over whatever was
   actually sourced.
   ========================================================================= */

function clamp01to100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Averages the sub-scores that had inputs; null if none did. */
function averageAvailable(parts: (number | null)[]): number | null {
  const present = parts.filter((p): p is number => p !== null)
  if (present.length === 0) return null
  return clamp01to100(present.reduce((sum, p) => sum + p, 0) / present.length)
}

export function scoreTechnical(t: TechnicalMetrics | null): number | null {
  if (!t) return null

  const vsSma50 = t.sma50 === null ? null : t.price > t.sma50 ? 65 : 35
  const vsSma200 = t.sma200 === null ? null : t.price > t.sma200 ? 70 : 30

  let rsiScore: number | null = null
  if (t.rsi14 !== null) {
    // Oversold reads as opportunity, overbought as stretched; the middle band
    // is scaled gently rather than treated as a cliff.
    if (t.rsi14 < 30) rsiScore = 75
    else if (t.rsi14 > 70) rsiScore = 25
    else rsiScore = 50 + (t.rsi14 - 50) * 0.5
  }

  // Where the price sits in its own 52-week range.
  let rangeScore: number | null = null
  if (t.week52High !== null && t.week52Low !== null && t.week52High > t.week52Low) {
    const position = (t.price - t.week52Low) / (t.week52High - t.week52Low)
    rangeScore = clamp01to100(100 - position * 60)
  }

  return averageAvailable([vsSma50, vsSma200, rsiScore, rangeScore])
}

/**
 * Valuation is relative, so it needs a peer benchmark. The caller passes the
 * median of the stocks actually being compared in this analysis rather than a
 * hardcoded sector table — a measured peer group rather than an assumed one.
 */
export function scoreValuation(
  v: ValuationMetrics | null,
  peerMedianPe: number | null,
  peerMedianPb: number | null
): number | null {
  if (!v) return null

  let peScore: number | null = null
  if (v.peRatio !== null && v.peRatio > 0 && peerMedianPe !== null && peerMedianPe > 0) {
    // Cheaper than peers scores higher, capped so a distressed single-digit
    // multiple does not read as a perfect score.
    const ratio = v.peRatio / peerMedianPe
    peScore = clamp01to100(100 - (ratio - 1) * 50)
  }

  let pbScore: number | null = null
  if (v.pbRatio !== null && v.pbRatio > 0 && peerMedianPb !== null && peerMedianPb > 0) {
    const ratio = v.pbRatio / peerMedianPb
    pbScore = clamp01to100(100 - (ratio - 1) * 50)
  }

  let yieldScore: number | null = null
  if (v.dividendYieldPct !== null) {
    // 4% is a strong yield for an Indian large cap.
    yieldScore = clamp01to100((v.dividendYieldPct / 4) * 100)
  }

  return averageAvailable([peScore, pbScore, yieldScore])
}

export function scoreFundamental(f: FundamentalMetrics | null): number | null {
  if (!f) return null

  // Benchmarks are the usual large-cap Indian reference points: 20% ROE,
  // 15% revenue growth, 20% earnings growth, 10% net margin.
  const roe = f.returnOnEquityPct === null ? null : clamp01to100((f.returnOnEquityPct / 20) * 100)
  const revenue = f.revenueGrowthPct === null ? null : clamp01to100(50 + f.revenueGrowthPct * 3.3)
  const earnings = f.earningsGrowthPct === null ? null : clamp01to100(50 + f.earningsGrowthPct * 2.5)
  const margin = f.profitMarginPct === null ? null : clamp01to100((f.profitMarginPct / 10) * 100)

  return averageAvailable([roe, revenue, earnings, margin])
}

export function scoreRisk(r: RiskMetrics | null): number | null {
  if (!r) return null

  const betaScore = r.beta === null ? null : clamp01to100(100 - (r.beta - 1) * 40)
  // 30% annualised volatility is the point where an Indian large cap reads as
  // genuinely volatile.
  const volScore = r.volatilityPct === null ? null : clamp01to100(100 - r.volatilityPct * 1.6)
  // Yahoo reports debtToEquity as a percentage (75 = 0.75x).
  const deScore = r.debtToEquity === null ? null : clamp01to100(100 - r.debtToEquity / 2)

  return averageAvailable([betaScore, volScore, deScore])
}

export interface AvailableFactors {
  /** Derived from the event classification, so always present. */
  eventImpact: number
  historicalReaction: number | null
  fundamentalStrength: number | null
  valuation: number | null
  technicalCondition: number | null
  riskScore: number | null
}

export interface CompositeResult {
  score: number
  contributions: { factor: string; score: number; weight: number }[]
  /** Factors with no sourced input, excluded from the score entirely. */
  excluded: string[]
  /** Share of the default weighting that had real data behind it, 0-1. */
  coverage: number
}

/**
 * Composite over whatever was actually sourced, with the remaining weights
 * renormalised to sum to 1.
 *
 * The alternative — substituting a neutral 50 for a missing factor — looks
 * harmless and is not: it drags every score toward the middle and hides the
 * fact that the number rests on less evidence than it appears to. Reporting
 * `coverage` and `excluded` lets the UI say how much of the picture it had.
 */
export function calculateCompositeFromAvailable(
  factors: AvailableFactors,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): CompositeResult {
  const entries: { factor: keyof AvailableFactors; score: number | null }[] = [
    { factor: 'eventImpact', score: factors.eventImpact },
    { factor: 'historicalReaction', score: factors.historicalReaction },
    { factor: 'fundamentalStrength', score: factors.fundamentalStrength },
    { factor: 'valuation', score: factors.valuation },
    { factor: 'technicalCondition', score: factors.technicalCondition },
    { factor: 'riskScore', score: factors.riskScore },
  ]

  const available = entries.filter(
    (e): e is { factor: keyof AvailableFactors; score: number } => e.score !== null
  )
  const excluded = entries.filter((e) => e.score === null).map((e) => e.factor)

  const totalWeight = available.reduce((sum, e) => sum + weights[e.factor], 0)
  if (totalWeight === 0) {
    return { score: 50, contributions: [], excluded, coverage: 0 }
  }

  const contributions = available.map((e) => ({
    factor: e.factor,
    score: e.score,
    weight: Number((weights[e.factor] / totalWeight).toFixed(4)),
  }))

  const score = contributions.reduce((sum, c) => sum + c.score * c.weight, 0)

  return {
    score: clamp01to100(score),
    contributions,
    excluded,
    coverage: Number(totalWeight.toFixed(4)),
  }
}

/** Median of the sourced values, or null when nothing was sourced. */
export function median(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (present.length === 0) return null
  const mid = Math.floor(present.length / 2)
  return present.length % 2 === 0
    ? Number(((present[mid - 1] + present[mid]) / 2).toFixed(2))
    : present[mid]
}

/**
 * Label for a risk score. Lives here rather than in the old mockData module,
 * which has been deleted: it is a presentation helper, not data.
 */
export function riskScoreToLevel(
  score: number | null
): 'LOW' | 'MODERATE' | 'HIGH' | 'VERY HIGH' | 'UNKNOWN' {
  // null means the risk factor had no sourced input. Reporting that as
  // "VERY HIGH" would be a fabricated judgement about the company.
  if (score === null) return 'UNKNOWN'
  if (score >= 70) return 'LOW'
  if (score >= 50) return 'MODERATE'
  if (score >= 30) return 'HIGH'
  return 'VERY HIGH'
}
