import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchFinancialNews } from '@/lib/news/fetchNews'
import { categorizeNewsItem } from '@/lib/ai/eventClassifier'
import crypto from 'crypto'

const MAX_TO_CATEGORIZE = 12

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

    let articles
    try {
      articles = await fetchFinancialNews()
    } catch (fetchError: any) {
      return NextResponse.json(
        { error: `News source unavailable: ${fetchError.message}` },
        { status: 502 }
      )
    }

    // Skip articles already in the DB (by hash) before spending AI calls on them.
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
    let categorizeFailures = 0
    let lastCategorizeError: any = null
    for (const { article, hash } of fresh) {
      let categorization
      try {
        categorization = await categorizeNewsItem(article.title, article.description || '')
      } catch (err) {
        // Skip articles the AI fails to categorize rather than failing the whole
        // batch — but if EVERY article in this batch fails, that's a systemic
        // problem (bad API key, no credits, model unavailable), not 12 unlucky
        // articles, and the caller needs to see that instead of a silent "0
        // relevant" result.
        categorizeFailures++
        lastCategorizeError = err
        continue
      }

      if (!categorization.is_market_relevant) continue

      const { error: insertError } = await admin.from('news_feeds').insert({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source?.name || 'Unknown',
        image_url: article.urlToImage,
        published_at: article.publishedAt,
        content: article.content,
        event_type: categorization.event_type,
        detected_sectors: categorization.affected_sectors,
        relevance_score: categorization.relevance_score,
        source_hash: hash,
      })

      if (!insertError) inserted++
    }

    if (fresh.length > 0 && categorizeFailures === fresh.length) {
      return NextResponse.json(
        { error: `AI categorization failed for every article: ${lastCategorizeError?.message || 'unknown error'}` },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      fetched: articles.length,
      alreadyKnown: hashed.length - fresh.length,
      inserted,
    })
  } catch (error: any) {
    console.error('News fetch error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
