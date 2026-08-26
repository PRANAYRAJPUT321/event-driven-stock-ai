import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// Structured-JSON-only calls use Sonnet — fast and reliable for classification/extraction.
const MODEL = 'claude-3-5-sonnet-20241022'

export interface EventClassification {
  event_type: string
  economic_variable: string
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  magnitude: number
  affected_sectors: string[]
  confidence: number
  reasoning: string
  transmission_explanation: string
}

function extractJson(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI response did not contain valid JSON')
  }
  return JSON.parse(jsonMatch[0])
}

export async function classifyEvent(eventText: string): Promise<EventClassification> {
  const prompt = `
You are a financial event classifier for an Indian equity market analysis platform.
Analyze this financial/economic event and extract structured information ONLY —
do not invent financial figures, stock prices, or historical returns; those come
from a separate deterministic data layer.

Event: "${eventText}"

Return ONLY valid JSON (no markdown, no code fences):
{
  "event_type": "MONETARY_POLICY|INFLATION|GDP|EMPLOYMENT|GOVERNMENT_POLICY|COMMODITY_SHOCK|CURRENCY|GEOPOLITICAL|EARNINGS|M&A|DIVIDEND|REGULATORY|CREDIT_RATING|MANAGEMENT_CHANGE|GLOBAL_MARKET_SHOCK|OTHER",
  "economic_variable": "INTEREST_RATE|OIL_PRICE|INFLATION|CURRENCY|GDP|CORPORATE|OTHER",
  "direction": "POSITIVE|NEGATIVE|NEUTRAL",
  "magnitude": 0-100,
  "affected_sectors": ["Banking", "IT", "Energy", "NBFC", "Realty", "Auto", "FMCG", "Pharma", "Financials", "Metals", "Telecom", "Utilities", "Engineering"],
  "confidence": 0-100,
  "reasoning": "2-3 sentence summary of the event and its likely market bias",
  "transmission_explanation": "One paragraph explaining the transmission mechanism: Event -> Economic Variable -> Financial Mechanism -> Sector -> Company, in plain English"
}
`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return extractJson(text)
}

export interface DecisionInput {
  eventReasoning: string
  transmissionExplanation: string
  eventDirection: string
  eventMagnitude: number
  stockSymbol: string
  compositeScore: number
  fundamentalScore: number
  valuationScore: number
  technicalScore: number
  riskScore: number
  historicalSummary?: string
}

export interface DecisionOutput {
  bullCase: string
  bearCase: string
  contradictoryEvidence: string
  keyRisks: string[]
  finalReasoning: string
}

/**
 * Generates ONLY the qualitative explainability layer (bull/bear/risks/reasoning).
 * All numeric scores are computed deterministically beforehand (lib/scoring) and
 * passed in here as context — the AI explains and challenges the numbers, it never
 * produces or overrides them (spec section 19 & 20).
 */
export async function generateCounterArgument(input: DecisionInput): Promise<DecisionOutput> {
  const prompt = `
You are the counter-argument and explainability layer of an event-driven equity
analysis platform. You are given DETERMINISTICALLY CALCULATED scores (not your own
estimates) and must explain and challenge them. Do not invent numbers, prices, or
returns — refer to the scores given.

Event summary: ${input.eventReasoning}
Transmission mechanism: ${input.transmissionExplanation}
Event direction: ${input.eventDirection} (magnitude ${input.eventMagnitude}/100)

Stock: ${input.stockSymbol}
Composite Event Opportunity Score: ${input.compositeScore}/100
Fundamental Score: ${input.fundamentalScore}/100
Valuation Score: ${input.valuationScore}/100
Technical Score: ${input.technicalScore}/100
Risk Score: ${input.riskScore}/100
${input.historicalSummary ? `Historical evidence: ${input.historicalSummary}` : 'Historical evidence: limited data available'}

Before concluding, actively try to challenge the thesis implied by the scores.

Return ONLY valid JSON:
{
  "bullCase": "2-3 sentences on why this could work, grounded in the scores above",
  "bearCase": "2-3 sentences on why the event may not produce the expected outcome",
  "contradictoryEvidence": "1-2 sentences on what data disagrees with the thesis",
  "keyRisks": ["risk 1", "risk 2", "risk 3"],
  "finalReasoning": "1-2 sentence synthesis explaining the recommendation implied by the composite score"
}
`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return extractJson(text)
}
