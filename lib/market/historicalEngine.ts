import { SupabaseClient } from '@supabase/supabase-js'

export interface HistoricalReactionSummary {
  matchCount: number
  avgNiftyReturn: {
    d1: number
    d3: number
    d5: number
    d20: number
  }
  avgSectorReturn: {
    d1: number
    d3: number
    d5: number
    d20: number
  }
  sampleEvents: string[]
}

/**
 * Finds historical events matching the same event_type + economic_variable + direction
 * (optionally scoped to a sector) and averages their measured market reactions.
 * This is the deterministic "historical evidence" the platform cites instead of
 * letting the AI invent a number (spec section 11 + 19).
 */
export async function getHistoricalReaction(
  supabase: SupabaseClient,
  eventType: string,
  economicVariable: string,
  direction: string,
  sector?: string
): Promise<HistoricalReactionSummary | null> {
  let query = supabase
    .from('historical_event_reactions')
    .select('*')
    .eq('event_type', eventType)
    .eq('economic_variable', economicVariable)
    .eq('direction', direction)

  if (sector) {
    query = query.eq('sector', sector)
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    return null
  }

  const avg = (key: string) =>
    Number(
      (data.reduce((sum: number, row: any) => sum + (row[key] || 0), 0) / data.length).toFixed(2)
    )

  return {
    matchCount: data.length,
    avgNiftyReturn: {
      d1: avg('nifty_return_1d'),
      d3: avg('nifty_return_3d'),
      d5: avg('nifty_return_5d'),
      d20: avg('nifty_return_20d'),
    },
    avgSectorReturn: {
      d1: avg('sector_return_1d'),
      d3: avg('sector_return_3d'),
      d5: avg('sector_return_5d'),
      d20: avg('sector_return_20d'),
    },
    sampleEvents: data.map((row: any) => row.event_label),
  }
}

/**
 * Converts an average historical return magnitude into a 0-100 score component
 * for the composite score's "historical reaction" factor.
 */
export function historicalReturnToScore(
  avgReturn5d: number,
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
): number {
  // A positive event with a positive historical return is confirmatory (higher score).
  // A negative event with a negative historical return is also confirmatory
  // (the market reliably reacts negatively, which is itself useful signal — but for
  // opportunity scoring on the recommended side, we score how much the return supports
  // the stated direction).
  const magnitude = Math.min(Math.abs(avgReturn5d) * 10, 50) // cap contribution
  const supportsDirection =
    (direction === 'POSITIVE' && avgReturn5d > 0) ||
    (direction === 'NEGATIVE' && avgReturn5d < 0)

  const base = 50
  return Math.round(supportsDirection ? base + magnitude : base - magnitude)
}
