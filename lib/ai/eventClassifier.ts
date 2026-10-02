import Anthropic from '@anthropic-ai/sdk'
import {
  buildCounterArgumentFromRules,
  categorizeNewsByRules,
  classifyEventByRules,
} from './ruleClassifier'

// Constructed lazily: `new Anthropic()` throws when ANTHROPIC_API_KEY is
// unset, and this module must be importable — and usable, via the rule
// fallbacks below — on a deployment with no AI key configured at all.
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

/**
 * Whether the language model is even worth attempting. Without a key every
 * call is a guaranteed failure, so skipping it avoids a pointless round trip
 * on every single request.
 */
function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * The LLM is an enhancement, never a dependency.
 *
 * Analyze and Discover were both taken down by a single billing state
 * ("credit balance too low"), which is not a condition a user can diagnose or
 * a state the product should be unusable in. So every AI call now runs
 * through here: on any failure — no key, no credit, rate limit, timeout,
 * malformed JSON — the deterministic engine in ruleClassifier.ts answers
 * instead, and the request succeeds.
 *
 * The failure is logged, not swallowed silently, so a broken key is still
 * discoverable in the runtime logs.
 */
async function withRuleFallback<T>(
  label: string,
  attempt: () => Promise<T>,
  fallback: () => T
): Promise<T> {
  if (!llmConfigured()) return fallback()
  try {
    return await attempt()
  } catch (error: any) {
    console.warn(`[ai] ${label} fell back to rules: ${error?.message || error}`)
    return fallback()
  }
}

// Structured-JSON-only calls use Sonnet — fast and reliable for classification/extraction.
// claude-3-5-sonnet-20241022 (the prior pin) has been retired; claude-sonnet-5 is the
// current-generation equivalent for this cost/latency tier.
const MODEL = 'claude-sonnet-5'

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

export function extractJson(text: string): any {
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

  return withRuleFallback(
    'classifyEvent',
    async () => {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      return normalizeClassification(extractJson(text), eventText)
    },
    () => classifyEventByRules(eventText)
  )
}

/**
 * The model is asked for a fixed JSON shape but isn't guaranteed to honour it.
 * Anything missing or out of range is repaired from the rule engine's answer
 * for the same text, so a partially-valid response can't put a NaN score or an
 * unknown direction into the scoring engine.
 */
function normalizeClassification(raw: any, eventText: string): EventClassification {
  const rules = classifyEventByRules(eventText)
  const direction = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(raw?.direction)
    ? raw.direction
    : rules.direction
  const boundedNumber = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(100, Math.round(value)))
      : fallback

  const sectors = Array.isArray(raw?.affected_sectors)
    ? raw.affected_sectors.filter((s: unknown) => typeof s === 'string' && s.trim() !== '')
    : []

  return {
    event_type: typeof raw?.event_type === 'string' ? raw.event_type : rules.event_type,
    economic_variable:
      typeof raw?.economic_variable === 'string' ? raw.economic_variable : rules.economic_variable,
    direction,
    magnitude: boundedNumber(raw?.magnitude, rules.magnitude),
    affected_sectors: sectors.length > 0 ? sectors : rules.affected_sectors,
    confidence: boundedNumber(raw?.confidence, rules.confidence),
    reasoning: typeof raw?.reasoning === 'string' && raw.reasoning ? raw.reasoning : rules.reasoning,
    transmission_explanation:
      typeof raw?.transmission_explanation === 'string' && raw.transmission_explanation
        ? raw.transmission_explanation
        : rules.transmission_explanation,
  }
}

export interface DecisionInput {
  eventReasoning: string
  transmissionExplanation: string
  eventDirection: string
  eventMagnitude: number
  stockSymbol: string
  compositeScore: number
  /**
   * null when the factor had no sourced input and was excluded from the
   * composite — see calculateCompositeFromAvailable. The narrative says so
   * instead of treating a missing input as a neutral score.
   */
  fundamentalScore: number | null
  valuationScore: number | null
  technicalScore: number | null
  riskScore: number | null
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
/** Renders a factor for the prompt without inventing a value for a missing one. */
function fmtScore(score: number | null): string {
  return score === null ? 'not available' : `${score}/100`
}

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
Fundamental Score: ${fmtScore(input.fundamentalScore)}
Valuation Score: ${fmtScore(input.valuationScore)}
Technical Score: ${fmtScore(input.technicalScore)}
Risk Score: ${fmtScore(input.riskScore)}
Factors marked "not available" could not be sourced and were excluded from the
composite entirely. Do not guess at them or treat them as average.
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

  return withRuleFallback(
    'generateCounterArgument',
    async () => {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const raw = extractJson(text)
      const rules = buildCounterArgumentFromRules(input)
      const str = (value: unknown, fallback: string) =>
        typeof value === 'string' && value.trim() !== '' ? value : fallback
      return {
        bullCase: str(raw?.bullCase, rules.bullCase),
        bearCase: str(raw?.bearCase, rules.bearCase),
        contradictoryEvidence: str(raw?.contradictoryEvidence, rules.contradictoryEvidence),
        keyRisks:
          Array.isArray(raw?.keyRisks) && raw.keyRisks.length > 0
            ? raw.keyRisks.filter((r: unknown) => typeof r === 'string')
            : rules.keyRisks,
        finalReasoning: str(raw?.finalReasoning, rules.finalReasoning),
      }
    },
    () => buildCounterArgumentFromRules(input)
  )
}

export interface NewsCategorization {
  is_market_relevant: boolean
  event_type: string
  affected_sectors: string[]
  relevance_score: number
}

/**
 * Lightweight categorization for a raw news headline/description, used by the
 * news discovery feed. Deliberately cheaper than classifyEvent() (smaller
 * prompt, fewer tokens) since this runs on every fetched article, not just
 * ones the user chooses to analyze.
 */
export async function categorizeNewsItem(
  title: string,
  description: string
): Promise<NewsCategorization> {
  const prompt = `
Classify this news headline for an Indian equity market intelligence platform.

Title: "${title}"
Description: "${description || 'N/A'}"

Return ONLY valid JSON (no markdown):
{
  "is_market_relevant": true or false — is this relevant to Indian financial markets/economy?,
  "event_type": "MONETARY_POLICY|INFLATION|GDP|EMPLOYMENT|GOVERNMENT_POLICY|COMMODITY_SHOCK|CURRENCY|GEOPOLITICAL|EARNINGS|M&A|DIVIDEND|REGULATORY|CREDIT_RATING|MANAGEMENT_CHANGE|GLOBAL_MARKET_SHOCK|OTHER",
  "affected_sectors": ["Banking", "IT", "Energy", "NBFC", "Realty", "Auto", "FMCG", "Pharma", "Financials", "Metals", "Telecom", "Utilities", "Engineering"],
  "relevance_score": 0-100 — how relevant/actionable this is for an Indian equity investor
}
`

  return withRuleFallback(
    'categorizeNewsItem',
    async () => {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const raw = extractJson(text)
      const rules = categorizeNewsByRules(title, description)
      return {
        is_market_relevant:
          typeof raw?.is_market_relevant === 'boolean'
            ? raw.is_market_relevant
            : rules.is_market_relevant,
        event_type: typeof raw?.event_type === 'string' ? raw.event_type : rules.event_type,
        affected_sectors: Array.isArray(raw?.affected_sectors)
          ? raw.affected_sectors.filter((s: unknown) => typeof s === 'string')
          : rules.affected_sectors,
        relevance_score:
          typeof raw?.relevance_score === 'number' && Number.isFinite(raw.relevance_score)
            ? Math.max(0, Math.min(100, Math.round(raw.relevance_score)))
            : rules.relevance_score,
      }
    },
    () => categorizeNewsByRules(title, description)
  )
}
