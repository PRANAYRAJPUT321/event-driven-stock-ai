import { NextRequest, NextResponse } from 'next/server'
import { analyseImpact } from '@/lib/ai/impactAnalyzer'
import { NIFTY_50, equitiesForSectors } from '@/lib/market/indianEquities'
import { assessEvent } from '@/lib/ai/ruleClassifier'

/**
 * Two-sided impact read for one headline.
 *
 * Unauthenticated and free to run: the analysis is deterministic and offline,
 * so there is no key to protect and no per-request cost to meter.
 */
export const dynamic = 'force-dynamic'

const MAX_COMPANIES = 6

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'A headline title is required' }, { status: 400 })
    }

    const description = typeof body?.description === 'string' ? body.description : ''
    const suppliedSectors: string[] = Array.isArray(body?.sectors)
      ? body.sectors.filter((s: unknown) => typeof s === 'string' && s.trim() !== '')
      : []

    // A caller that names no sectors is not asking about every sector; it is
    // leaving the read to us. Deriving them from the headline keeps the
    // company list tied to the event — without this the empty list used to
    // fall through to the first six names of the index, so a crude-oil story
    // came back reporting an impact on six banks.
    const read = assessEvent(`${title} ${description}`.trim())
    const sectors: string[] = suppliedSectors.length > 0 ? suppliedSectors : read.classification.affected_sectors ?? []

    // Companies may be named explicitly, or derived from the affected sectors
    // so a headline about "Banking" still produces a per-company read.
    let companies: { symbol: string; name?: string; sector: string }[] = []
    if (Array.isArray(body?.companies) && body.companies.length > 0) {
      companies = body.companies
        .filter((c: any) => c && typeof c.symbol === 'string')
        .slice(0, MAX_COMPANIES)
        .map((c: any) => ({
          symbol: c.symbol,
          name: c.name,
          sector:
            c.sector ||
            NIFTY_50.find((s) => s.symbol === String(c.symbol).toUpperCase())?.sector ||
            '',
        }))
    } else {
      // The companies a headline names come first, and for news about a
      // company they are the only ones it reaches.
      const named = read.companies
      const pool =
        read.scope === 'company' && named.length > 0
          ? named
          : [
              ...named,
              ...(read.focus.length > 0
                ? NIFTY_50.filter((s) => read.focus.includes(s.symbol))
                : equitiesForSectors(sectors, MAX_COMPANIES)),
            ]
      companies = Array.from(new Map(pool.map((c) => [c.symbol, c])).values())
        .slice(0, MAX_COMPANIES)
        .map((c) => ({ symbol: c.symbol, name: c.name, sector: c.sector }))
    }

    // Companies the caller names for company news that names no index
    // company (Union Bank of India's results, scored on Union Bank) are the
    // ones the news is about.
    const named =
      read.scope === 'company' && read.companies.length === 0 && Array.isArray(body?.companies) && companies.length > 0
        ? companies.map((c) => ({ symbol: c.symbol, name: c.name || c.symbol, sector: c.sector }))
        : undefined
    const analysis = analyseImpact({ title, description, sectors, companies, ...(named ? { named } : {}) })

    return NextResponse.json(
      { analysis, analysedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } }
    )
  } catch (error: any) {
    console.error('News analyze error:', error)
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 })
  }
}
