import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { fetchMarketNews } from '@/lib/news/rssNews'
import { categorizeNewsByRules } from '@/lib/ai/ruleClassifier'

/**
 * The Discover feed, with nothing stored.
 *
 * /api/news/fetch pulls the same headlines but categorises them with the AI
 * path and writes them to news_feeds, so it needs both a session and a
 * reachable database. This route is the read-only twin: same RSS source,
 * categorised by the deterministic rule engine, returned straight to the
 * caller. No key, no session, no Postgres — so Discover keeps working when
 * the database is asleep, it just isn't building up a stored feed.
 */
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 300

export async function GET() {
  try {
    const articles = await fetchMarketNews(30)

    const items = articles
      .map((article) => {
        const categorization = categorizeNewsByRules(article.title, article.description || '')
        return {
          // Stable across refreshes for the same headline, so React keys and
          // any client-side dedupe behave. Not a database id — these rows do
          // not exist anywhere.
          id: crypto.createHash('sha256').update(article.title + article.url).digest('hex').slice(0, 16),
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.source,
          published_at: article.publishedAt,
          event_type: categorization.event_type,
          detected_sectors: categorization.affected_sectors,
          relevance_score: categorization.relevance_score,
          is_market_relevant: categorization.is_market_relevant,
        }
      })
      .filter((item) => item.is_market_relevant)
      .sort((a, b) => b.relevance_score - a.relevance_score)

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'No market-relevant headlines came back from the news feed just now.' },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { items, fetchedAt: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=900`,
        },
      }
    )
  } catch (error: any) {
    console.error('Live news error:', error)
    return NextResponse.json(
      { error: error?.message || 'Could not reach the news feed' },
      { status: 502 }
    )
  }
}
