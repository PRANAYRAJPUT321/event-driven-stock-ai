import { NextRequest, NextResponse } from 'next/server'
import { fetchCompanyNews, fetchSectorNews, type RssNewsItem } from '@/lib/news/rssNews'

export const dynamic = 'force-dynamic'

// Each entry is one upstream RSS request (companies make two), so these caps
// bound how long a single page load can take. Three of each is enough to show
// where an event is landing without turning the panel into a news reader.
const MAX_SECTORS = 3
const MAX_COMPANIES = 3
const ITEMS_PER_GROUP = 5

interface CompanyRef {
  symbol: string
  name?: string
}

export interface ImpactGroup {
  key: string
  label: string
  kind: 'sector' | 'company'
  items: RssNewsItem[]
  /** Set when this group's feed failed, so the UI can say so per group. */
  error?: string
}

/**
 * Live news impact for one analysed event: what is being published right now
 * about the sectors the event transmits to, and about the specific companies
 * the analysis surfaced.
 *
 * This is the "is this actually happening" counterpart to the deterministic
 * transmission mechanism — the analysis says a repo-rate hike should press on
 * banks, this shows what is being written about banks and about HDFC Bank
 * today. Keyless: Google News and Yahoo RSS.
 */
export async function POST(request: NextRequest) {
  try {
    // Deliberately unauthenticated. This returns public RSS headlines and no
    // user data, and requiring a session meant a paused Supabase project took
    // the panel down with it — including on an analysis that ran fine without
    // a database. The caps below bound the work a single request can cause.
    const body = await request.json().catch(() => ({}))

    const sectors: string[] = Array.isArray(body?.sectors)
      ? body.sectors.filter((s: unknown) => typeof s === 'string' && s.trim() !== '').slice(0, MAX_SECTORS)
      : []

    const companies: CompanyRef[] = Array.isArray(body?.companies)
      ? body.companies
          .filter((c: any) => c && typeof c.symbol === 'string' && c.symbol.trim() !== '')
          .slice(0, MAX_COMPANIES)
      : []

    if (sectors.length === 0 && companies.length === 0) {
      return NextResponse.json(
        { error: 'Provide at least one sector or company to look up' },
        { status: 400 }
      )
    }

    // All feeds in parallel, each allowed to fail on its own — a sector whose
    // feed is empty should not cost you the company headlines next to it.
    const sectorResults = await Promise.allSettled(
      sectors.map((sector) => fetchSectorNews(sector, ITEMS_PER_GROUP))
    )
    const companyResults = await Promise.allSettled(
      companies.map((c) => fetchCompanyNews(c.symbol, c.name, ITEMS_PER_GROUP))
    )

    const sectorGroups: ImpactGroup[] = sectors.map((sector, i) => {
      const outcome = sectorResults[i]
      return {
        key: `sector:${sector}`,
        label: sector,
        kind: 'sector',
        items: outcome.status === 'fulfilled' ? outcome.value : [],
        error: outcome.status === 'rejected' ? String(outcome.reason?.message || outcome.reason) : undefined,
      }
    })

    const companyGroups: ImpactGroup[] = companies.map((company, i) => {
      const outcome = companyResults[i]
      return {
        key: `company:${company.symbol}`,
        label: company.name ? `${company.name} (${company.symbol})` : company.symbol,
        kind: 'company',
        items: outcome.status === 'fulfilled' ? outcome.value : [],
        error: outcome.status === 'rejected' ? String(outcome.reason?.message || outcome.reason) : undefined,
      }
    })

    const groups = [...sectorGroups, ...companyGroups]
    const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0)

    if (totalItems === 0 && groups.every((g) => g.error)) {
      return NextResponse.json(
        { error: `News feeds unavailable: ${groups[0].error}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ groups, totalItems, fetchedAt: new Date().toISOString() })
  } catch (error: any) {
    console.error('News impact error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
