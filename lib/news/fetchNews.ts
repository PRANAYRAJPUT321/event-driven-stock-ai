export interface NewsApiArticle {
  title: string
  description: string | null
  url: string
  urlToImage: string | null
  publishedAt: string
  content: string | null
  source: { name: string }
}

const QUERY =
  '(RBI OR "Reserve Bank of India" OR Nifty OR Sensex OR "Indian stocks" OR "Indian economy" OR rupee) AND (market OR stocks OR shares OR economy OR bank OR rate)'

/**
 * Pulls recent financial news from NewsAPI's /v2/everything endpoint.
 * Free-tier NewsAPI does not support server-to-server calls from a deployed
 * production domain on some plans — if this throws, the caller should
 * surface a clear "news fetch unavailable" state rather than fail silently.
 */
export async function fetchFinancialNews(): Promise<NewsApiArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY
  if (!apiKey) {
    throw new Error('NEWSAPI_KEY is not configured')
  }

  const url = new URL('https://newsapi.org/v2/everything')
  url.searchParams.set('q', QUERY)
  url.searchParams.set('language', 'en')
  url.searchParams.set('sortBy', 'publishedAt')
  url.searchParams.set('pageSize', '20')

  const response = await fetch(url.toString(), {
    headers: { 'X-Api-Key': apiKey },
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`NewsAPI request failed (${response.status}): ${body.substring(0, 200)}`)
  }

  const data = await response.json()
  return (data.articles || []).filter((a: NewsApiArticle) => a.title && a.title !== '[Removed]')
}
