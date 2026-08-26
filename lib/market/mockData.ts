/**
 * Deterministic Mock Market Data Generator
 *
 * For MVP Stage 1, we generate realistic-looking fundamental/technical/valuation
 * data WITHOUT hitting a live API. Data is deterministic per stock symbol (seeded
 * hash) so the same stock always returns the same numbers within a session —
 * this is critical so the AI never "invents" numbers (see project spec section 19).
 * Swap this module for a real MarketDataProvider in Stage 2 without touching
 * any caller.
 */

function seededRandom(seed: string): () => number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 1 | h)
    h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
}

function range(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min)
}

export interface MockFundamentals {
  roe: number
  roce: number
  profitGrowth: number
  revenueGrowth: number
  debtEquity: number
  interestCoverage: number
}

export interface MockValuation {
  peRatio: number
  pbRatio: number
  sectorAvgPe: number
  sectorAvgPb: number
  dividendYield: number
}

export interface MockTechnical {
  price: number
  sma50: number
  sma200: number
  rsi: number
  volume: number
  avgVolume: number
}

export interface MockRisk {
  beta: number
  volatility: number
}

const SECTOR_PE_BENCHMARKS: Record<string, number> = {
  Banking: 19,
  IT: 24,
  Energy: 12,
  Auto: 20,
  FMCG: 32,
  Pharma: 24,
  Realty: 22,
  NBFC: 18,
  Financials: 22,
  Metals: 11,
  Telecom: 35,
  Utilities: 18,
  Engineering: 24,
  Cement: 24,
  Chemicals: 21,
  Consumer: 30,
  Retail: 36,
  Diversified: 20,
  Aviation: 25,
  Ports: 15,
}

export function getMockFundamentals(symbol: string): MockFundamentals {
  const rand = seededRandom(symbol + '-fund')
  return {
    roe: Number(range(rand, 6, 26).toFixed(1)),
    roce: Number(range(rand, 8, 28).toFixed(1)),
    profitGrowth: Number(range(rand, -8, 30).toFixed(1)),
    revenueGrowth: Number(range(rand, -3, 22).toFixed(1)),
    debtEquity: Number(range(rand, 0.05, 1.8).toFixed(2)),
    interestCoverage: Number(range(rand, 1.5, 12).toFixed(1)),
  }
}

export function getMockValuation(symbol: string, sector: string): MockValuation {
  const rand = seededRandom(symbol + '-val')
  const sectorAvgPe = SECTOR_PE_BENCHMARKS[sector] || 20
  return {
    peRatio: Number(range(rand, sectorAvgPe * 0.5, sectorAvgPe * 1.6).toFixed(1)),
    pbRatio: Number(range(rand, 0.6, 5).toFixed(2)),
    sectorAvgPe,
    sectorAvgPb: 2.2,
    dividendYield: Number(range(rand, 0, 4.5).toFixed(1)),
  }
}

export function getMockTechnical(symbol: string): MockTechnical {
  const rand = seededRandom(symbol + '-tech')
  const price = Number(range(rand, 150, 4200).toFixed(1))
  const trendBias = range(rand, -0.08, 0.08)
  const sma50 = Number((price * (1 - trendBias)).toFixed(1))
  const sma200 = Number((price * (1 - trendBias * 1.8)).toFixed(1))
  return {
    price,
    sma50,
    sma200,
    rsi: Number(range(rand, 25, 78).toFixed(0)),
    volume: Math.round(range(rand, 200000, 8000000)),
    avgVolume: Math.round(range(rand, 200000, 6000000)),
  }
}

export function getMockRisk(symbol: string): MockRisk {
  const rand = seededRandom(symbol + '-risk')
  return {
    beta: Number(range(rand, 0.5, 1.9).toFixed(2)),
    volatility: Number(range(rand, 12, 45).toFixed(1)),
  }
}

export function riskScoreToLevel(score: number): 'LOW' | 'MODERATE' | 'HIGH' | 'VERY HIGH' {
  if (score >= 70) return 'LOW'
  if (score >= 50) return 'MODERATE'
  if (score >= 30) return 'HIGH'
  return 'VERY HIGH'
}
