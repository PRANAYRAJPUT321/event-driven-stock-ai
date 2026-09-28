import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchMarketNews } from '@/lib/news/rssNews'
import { categorizeNewsItem } from '@/lib/ai/eventClassifier'
import crypto from 'crypto'

// Categorisation is now free when no LLM key is configured (the rule engine
// answers instead), so this is no longer a per-article cost ceiling — it's
// just a bound on how much work one request does.
const MAX_TO_CATEGORIZE = 20

export async function POST(request: NextRequest) {
  try {
    // Require a logged-in user to trigger a fetch (manual "Refresh" button),
    // but write with the admin client since news_feeds isn't user-owned data.
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Google News RSS — no key, and unlike NewsAPI's free tier it does not
    // refuse server-to-server calls from a deployed domain, which is why the
    // feed never populated in production before.
    let articles
    try {
      articles = await fetchMarketNews()
    } catch (fetchError: any) {
      return NextResponse.json(
        { error: `News source unavailable: ${fetchError.message}` },
        { status: 502 }
      )
    }

    if (articles.length === 0) {
      return NextResponse.json(
        { error: 'The news feed returned no articles. This is usually a transient upstream issue.' },
        { status: 502 }
      )
    }

    // Skip articles already stored (by hash) before doing any work on them.
    const hashed = articles.map((a) => ({
      article: a,
      hash: crypto.createHash('sha256').update(a.title + (a.url || '')).digest('hex'),
    }))

    const { data: existing } = await admin
      .from('news_feeds')
      .select('source_hash')
      .in('source_hash', hashed.map((h) => h.hash))

    const existingHashes = new Set((existing || []).map((r: any) => r.source_hash))
    const fresh = hashed.filter((h) => !existingHashes.has(h.hash)).slice(0, MAX_TO_CATEGORIZE)

    let inserted = 0
    let skippedIrrelevant = 0
    const insertErrors: string[] = []

    for (const { article, hash } of fresh) {
      // categorizeNewsItem falls back to the offline rule engine on any AI
      // failure, so it resolves even with no ANTHROPIC_API_KEY set at all —
      // this loop can no longer fail wholesale on a billing state.
      const categorization = await categorizeNewsItem(article.title, article.description || '')

      if (!categorization.is_market_relevant) {
        skippedIrrelevant++
        continue
      }

      const { error: insertError } = await admin.from('news_feeds').insert({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source,
        image_url: article.imageUrl,
        published_at: article.publishedAt,
        content: article.description,
        event_type: categorization.event_type,
        detected_sectors: categorization.affected_sectors,
        relevance_score: categorization.relevance_score,
        source_hash: hash,
      })

      if (insertError) insertErrors.push(insertError.message)
      else inserted++
    }

    // Every article that was *attempted* failing to insert means a schema or
    // permission problem, not unlucky articles — surface it rather than
    // reporting "0 new items". Articles filtered as not market-relevant were
    // never attempted, so a batch where everything was filtered is a normal
    // success, not a failure: without the `insertErrors.length > 0` guard
    // that case compared 0 === 0 and returned a 502 citing an undefined error.
    if (insertErrors.length > 0 && inserted === 0) {
      return NextResponse.json(
        { error: `Could not store any article: ${insertErrors[0]}` },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      fetched: articles.length,
      alreadyKnown: hashed.length - fresh.length,
      skippedIrrelevant,
      inserted,
    })
  } catch (error: any) {
    console.error('News fetch error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
