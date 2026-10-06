import { XMLParser } from 'fast-xml-parser'

/**
 * Keyless news via RSS.
 *
 * Replaces NewsAPI, whose free tier requires a key AND forbids server-to-server
 * calls from a deployed domain — which is why the news feed never populated in
 * production. Google News and Yahoo Finance both publish open RSS: no key, no
 * signup, no per-domain restriction.
 *
 * Two feeds, for two different questions:
 *   - Google News search RSS answers "what is being written about X right now",
 *     where X can be the market, a sector, or a company.
 *   - Yahoo's per-symbol headline RSS answers "what is tagged to this ticker",
 *     which is tighter but sparser for Indian names.
 *
 * Server-side only: neither feed sends CORS headers.
 */

export interface RssNewsItem {
  title: string
  description: string | null
  url: string
  /** ISO-8601. Falls back to now when a feed omits or mangles pubDate. */
  publishedAt: string
  source: string
  imageUrl: string | null
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const TIMEOUT_MS = 8000

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Feeds are inconsistent about whether a single <item> is a list; this keeps
  // the shape predictable so callers don't have to check.
  isArray: (name) => name === 'item',
  processEntities: true,
  trimValues: true,
})

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

/** Strips tags and decodes the handful of entities these feeds actually use. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.replace(/<[^>]*>/g, ' ')
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char)
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  return text.replace(/\s+/g, ' ').trim()
}

function toIso(pubDate: unknown): string {
  if (typeof pubDate === 'string') {
    const parsed = new Date(pubDate)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

/**
 * Google News puts the publisher in the title as "Headline - Publisher".
 * Splitting it back out gives a usable source name and a cleaner headline;
 * if the pattern doesn't hold, the title is left exactly as-is.
 */
function splitPublisher(title: string, fallbackSource: string): { title: string; source: string } {
  const idx = title.lastIndexOf(' - ')
  if (idx > 20 && idx > title.length - 60) {
    return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() }
  }
  return { title, source: fallbackSource }
}

/** Split out from the fetch so the feed shapes can be tested without network. */
/**
 * Google News sets `description` to a link whose text is the headline again,
 * so the stripped description is usually the title verbatim, sometimes with
 * the publisher appended. Carried through, that produced analysis pages
 * headed "RBI may hike repo rate by 25 bps in October meet: Economists RBI
 * may hike repo rate by 25 bps in October meet: Economists Fortune India" —
 * the same sentence three times over.
 *
 * A description is kept only when it says something the title does not.
 */
function usefulDescription(description: string | null, title: string): string | null {
  if (!description) return null
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const d = norm(description)
  const t = norm(title)
  if (!d || d === t) return null
  // A description that is the title plus a publisher name adds nothing.
  if (d.startsWith(t) && d.length - t.length < 40) return null
  if (t.startsWith(d)) return null
  return description
}

export function parseRssFeed(xml: string, fallbackSource: string): RssNewsItem[] {
  const parsed = parser.parse(xml)
  const items: any[] = parsed?.rss?.channel?.item ?? []

  return items
    .map((item): RssNewsItem | null => {
      const rawTitle = clean(item?.title)
      if (!rawTitle) return null

      const link = typeof item?.link === 'string' ? item.link : ''
      if (!link) return null

      const sourceTag = clean(item?.source?.['#text'] ?? item?.source)
      const { title, source } = splitPublisher(rawTitle, sourceTag || fallbackSource)

      const enclosure = item?.enclosure?.['@_url']
      const media = item?.['media:content']?.['@_url']

      return {
        title,
        description: usefulDescription(clean(item?.description), title),
        url: link,
        publishedAt: toIso(item?.pubDate),
        source: source || fallbackSource,
        imageUrl: typeof enclosure === 'string' ? enclosure : typeof media === 'string' ? media : null,
      }
    })
    .filter((item): item is RssNewsItem => item !== null)
}

async function fetchFeed(url: string, fallbackSource: string): Promise<RssNewsItem[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`RSS request failed (${response.status}) for ${new URL(url).host}`)
  }
  return parseRssFeed(await response.text(), fallbackSource)
}

function googleNewsUrl(query: string): string {
  const url = new URL('https://news.google.com/rss/search')
  // en-IN / IN / IN:en keeps results on Indian outlets and Indian editions of
  // the wires, which is what this product is about.
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'en-IN')
  url.searchParams.set('gl', 'IN')
  url.searchParams.set('ceid', 'IN:en')
  return url.toString()
}

/** De-duplicates by normalised headline, keeping the earliest-listed copy. */
function dedupe(items: RssNewsItem[]): RssNewsItem[] {
  const seen = new Set<string>()
  const out: RssNewsItem[] = []
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function newestFirst(items: RssNewsItem[]): RssNewsItem[] {
  return [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

const MARKET_QUERY =
  '(RBI OR Sensex OR Nifty OR "Indian stock market" OR "Indian economy" OR rupee OR SEBI) when:2d'

/** Broad Indian-market headlines — the feed behind Discover. */
export async function fetchMarketNews(limit = 24): Promise<RssNewsItem[]> {
  const items = await fetchFeed(googleNewsUrl(MARKET_QUERY), 'Google News')
  return newestFirst(dedupe(items)).slice(0, limit)
}

/**
 * Sector queries are hand-written rather than just the sector's name: searching
 * "IT" or "Consumer" on its own returns almost nothing about the Indian market.
 */
const SECTOR_QUERIES: Record<string, string> = {
  Banking: '(Indian banks OR "bank stocks India" OR RBI banking OR "private banks" India)',
  Financials: '("NBFC India" OR "financial services India" OR "lending India")',
  NBFC: '("NBFC India" OR "non-banking financial company" India)',
  IT: '("Indian IT sector" OR Infosys OR TCS OR Wipro OR "IT services India")',
  Energy: '("oil India" OR "Indian energy sector" OR ONGC OR "crude oil" India)',
  Auto: '("Indian auto sector" OR "car sales India" OR Maruti OR "auto stocks India")',
  FMCG: '("FMCG India" OR "consumer goods India" OR ITC OR "Hindustan Unilever")',
  Pharma: '("Indian pharma" OR "pharma stocks India" OR USFDA India)',
  Metals: '("metal stocks India" OR "steel India" OR "Tata Steel" OR JSW)',
  Realty: '("Indian real estate" OR "realty stocks India" OR "housing sales India")',
  Telecom: '("Indian telecom" OR Airtel OR Jio OR "telecom tariff India")',
  Utilities: '("power sector India" OR NTPC OR "electricity demand India")',
  Cement: '("cement India" OR "cement prices India" OR UltraTech)',
  Chemicals: '("Indian chemicals sector" OR "specialty chemicals India")',
  Engineering: '("capital goods India" OR "Larsen & Toubro" OR "infrastructure India")',
  Consumer: '("consumer demand India" OR "consumption India" OR "urban demand India")',
  Retail: '("retail India" OR "quick commerce India" OR DMart OR "Reliance Retail")',
  Aviation: '("Indian aviation" OR IndiGo OR "air fares India")',
  Ports: '("Indian ports" OR "Adani Ports" OR "cargo volumes India")',
  Diversified: '("Indian conglomerate" OR "diversified group India")',
}

export async function fetchSectorNews(sector: string, limit = 6): Promise<RssNewsItem[]> {
  const query = SECTOR_QUERIES[sector] || `"${sector}" India stock market`
  const items = await fetchFeed(googleNewsUrl(`${query} when:7d`), 'Google News')
  return newestFirst(dedupe(items)).slice(0, limit)
}

/**
 * Company headlines from both feeds. Yahoo's ticker feed is precise but thin
 * for NSE names, and Google's is broad but can drift onto same-named companies
 * elsewhere — together they cover each other, and a failure of either still
 * returns the other's results.
 */
export async function fetchCompanyNews(
  symbol: string,
  companyName?: string,
  limit = 6
): Promise<RssNewsItem[]> {
  const yahooSymbol = symbol.toUpperCase().endsWith('.NS')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}.NS`

  const yahooUrl =
    'https://feeds.finance.yahoo.com/rss/2.0/headline' +
    `?s=${encodeURIComponent(yahooSymbol)}&region=IN&lang=en-IN`

  const googleQuery = companyName
    ? `("${companyName}" OR "${symbol}") (share OR stock OR results OR NSE) when:7d`
    : `"${symbol}" India stock when:7d`

  const settled = await Promise.allSettled([
    fetchFeed(yahooUrl, 'Yahoo Finance'),
    fetchFeed(googleNewsUrl(googleQuery), 'Google News'),
  ])

  const merged = settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? outcome.value : []
  )
  return newestFirst(dedupe(merged)).slice(0, limit)
}
