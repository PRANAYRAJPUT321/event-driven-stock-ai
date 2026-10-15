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

function summarise(rows: any[]): HistoricalReactionSummary {
  const avg = (key: string) =>
    Number((rows.reduce((sum: number, row: any) => sum + (row[key] || 0), 0) / rows.length).toFixed(2))

  return {
    matchCount: rows.length,
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
    sampleEvents: rows.map((row: any) => row.event_label),
  }
}

/**
 * Finds historical events matching the same event_type + economic_variable +
 * direction and averages their measured market reactions, separately for each
 * sector the reference set covers. This is the deterministic "historical
 * evidence" the platform cites instead of letting the AI invent a number
 * (spec section 11 + 19).
 *
 * Grouped by sector because one event moves sectors in opposite directions:
 * the airline average after past crude spikes says nothing about how upstream
 * producers fared, and applying it to them is worse than having no evidence.
 * A sector with no matching rows is simply absent from the map.
 */
export async function getHistoricalReactions(
  supabase: SupabaseClient,
  eventType: string,
  economicVariable: string,
  direction: string
): Promise<Map<string, HistoricalReactionSummary>> {
  const bySector = new Map<string, HistoricalReactionSummary>()
  const { data, error } = await supabase
    .from('historical_event_reactions')
    .select('*')
    .eq('event_type', eventType)
    .eq('economic_variable', economicVariable)
    .eq('direction', direction)

  if (error || !data || data.length === 0) return bySector

  const groups = new Map<string, any[]>()
  for (const row of data) {
    if (!row.sector) continue
    groups.set(row.sector, [...(groups.get(row.sector) ?? []), row])
  }
  for (const [sector, rows] of Array.from(groups)) bySector.set(sector, summarise(rows))
  return bySector
}

/**
 * Converts a sector's average 5-day return after similar past events into the
 * 0-100 "historical reaction" factor: 50 is no reaction, and each percentage
 * point of average move is worth 10 points, capped at the ends of the scale.
 *
 * This used to score how well the history "supported the event's direction",
 * which made a negative event whose sector reliably fell afterwards score
 * *higher* — the opposite of what an opportunity score should say about it.
 */
export function historicalReturnToScore(avgReturn5d: number): number {
  return Math.round(50 + Math.max(-50, Math.min(50, avgReturn5d * 10)))
}
