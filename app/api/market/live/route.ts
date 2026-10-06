import { NextResponse } from 'next/server'
import { fetchMarketBar, CATEGORY_LABELS, HEATMAP_SYMBOLS } from '@/lib/market/yahooFinance'

// Yahoo sends no CORS headers, so the browser can't call it directly — this
// route is the server-side proxy. Deliberately public (no auth): it returns
// nothing user-specific, and the market bar renders on the login page too.
//
// force-dynamic keeps Next from prerendering this at build time, which would
// otherwise bake whatever the build machine got (including a failure) into
// the deployment. Upstream load is throttled by the Cache-Control header
// below instead: the CDN serves one cached response to everyone for a
// minute, so Yahoo sees roughly one round of requests per minute in total,
// not one per visitor.
export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 60

export async function GET(request: Request) {
  try {
    // ?scope=full returns the whole heatmap set (~66 instruments); the default
    // is the compact list the header bar shows. Two scopes rather than one
    // because the bar is read at a glance and the heatmap is read deliberately
    // — and because the wide set costs proportionally more upstream requests.
    const scope = new URL(request.url).searchParams.get('scope')
    const { quotes, failed, failureReason, stale, staleAgeSeconds, fromMemory, fetchedAt } = await fetchMarketBar(
      REVALIDATE_SECONDS,
      scope === 'full' ? HEATMAP_SYMBOLS : undefined
    )

    if (quotes.length === 0) {
      return NextResponse.json(
        {
          error:
            'Yahoo Finance returned no usable quotes for any tracked symbol. ' +
            (failureReason
              ? `The upstream said: ${failureReason}`
              : 'This is usually upstream rate limiting — it normally clears on its own.'),
          failed,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        quotes,
        stale: stale ?? false,
        staleAgeSeconds: staleAgeSeconds ?? null,
        fromMemory: fromMemory ?? 0,
        // Surfaced rather than hidden: a permanently missing symbol should be
        // visible to whoever is debugging, not silently dropped.
        failed,
        fetchedAt,
        categoryLabels: CATEGORY_LABELS,
      },
      {
        headers: {
          // Serve from Vercel's edge cache for a minute, and keep serving the
          // last good payload for 5 more while it refreshes — so an upstream
          // hiccup doesn't empty the bar for everyone at once.
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=900`,
        },
      }
    )
  } catch (error: any) {
    console.error('Market live route error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch live market data' },
      { status: 500 }
    )
  }
}
