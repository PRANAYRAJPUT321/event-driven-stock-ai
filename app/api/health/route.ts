import { NextResponse } from 'next/server'

/**
 * Deployment diagnostics.
 *
 * Exists because "sign-in fails" has several completely different causes that
 * all look identical in the browser: credentials missing from the build, a
 * paused Supabase project, a rotated key, or simply a wrong password. This
 * endpoint distinguishes them from the server side and says which.
 *
 * It reports presence booleans, hostnames and HTTP status codes only. No key,
 * token or secret value is ever included in the response — the Supabase URL
 * is already public in the browser bundle, the keys are not and stay out.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 8000

/**
 * Every table the application reads or writes. Probing them turns "my history
 * is empty and I don't know why" into a definite answer: either the schema
 * was never created, or it was and the page is genuinely empty.
 */
const REQUIRED_TABLES = [
  'profiles',
  'events',
  'event_analysis',
  'stocks',
  'stock_scores',
  'watchlists',
  'saved_analyses',
  'news_feeds',
  'portfolio_positions',
  'historical_event_reactions',
] as const

interface Probe {
  ok: boolean
  status: number | null
  detail: string
}

async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = (await response.text()).slice(0, 200)
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? 'reachable' : body || response.statusText,
    }
  } catch (error: any) {
    return { ok: false, status: null, detail: error?.message || 'request failed' }
  }
}

export async function GET(request: Request) {
  // ?scope=supabase skips the upstream probes. The browser uses it to ask
  // one narrow question — "is the database reachable?" — without paying for
  // two more cross-internet round trips.
  const scope = new URL(request.url).searchParams.get('scope')
  const supabaseOnly = scope === 'supabase'

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(anonKey),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Optional by design — the app falls back to its offline rule engine.
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
  }

  let supabaseHost: string | null = null
  if (url) {
    try {
      supabaseHost = new URL(url).host
    } catch {
      supabaseHost = 'invalid URL'
    }
  }

  const checks: Record<string, Probe> = {}

  if (url && anonKey) {
    // GoTrue's health endpoint answers without auth; a paused project does
    // not answer at all, which is the difference we are looking for.
    checks.supabaseAuth = await probe(`${url}/auth/v1/health`, { apikey: anonKey })
    // A 200/401 here tells us whether the anon key itself is still valid —
    // a rotated key returns 401 with "Invalid API key".
    checks.supabaseRest = await probe(`${url}/rest/v1/`, {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    })
  }

  // The keyless upstreams the rest of the app depends on. Checking them here
  // means one URL answers "is anything reachable from this deployment".
  if (!supabaseOnly) {
    checks.yahooFinance = await probe(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1d',
      { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    )
    // Which Yahoo paths this deployment can actually use. They fail
    // independently: the crumbed endpoints routinely refuse datacenter IPs
    // while the keyless ones answer, and knowing which is which is the
    // difference between "the feed is down" and "we asked the wrong way".
    checks.yahooSparkBatch = await probe(
      'https://query1.finance.yahoo.com/v7/finance/spark?symbols=RELIANCE.NS,TCS.NS&range=5d&interval=1d',
      { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    )
    // The second price provider. Independent of Yahoo in company and
    // infrastructure, so it is the one that matters when Yahoo refuses.
    checks.stooq = await probe(
      'https://stooq.com/q/l/?s=reliance.in+tcs.in&f=sd2t2ohlcv&h&e=csv',
      { Accept: 'text/csv' }
    )
    checks.googleNewsRss = await probe(
      'https://news.google.com/rss/search?q=nifty&hl=en-IN&gl=IN&ceid=IN:en',
      { 'User-Agent': 'Mozilla/5.0' }
    )
  }

  // Which tables exist. PostgREST answers 404 with code PGRST205 for a table
  // it does not know about, which is exactly the "migration never run" case.
  let schema: { ok: boolean; missing: string[]; checked: number } | null = null
  if (!supabaseOnly && url && anonKey && checks.supabaseRest?.ok) {
    const missing: string[] = []
    await Promise.all(
      REQUIRED_TABLES.map(async (table) => {
        try {
          const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
              // Ask for the count only; RLS still applies, and an empty result
              // from a table that exists is a 200, not a 404.
              Prefer: 'count=exact',
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: 'no-store',
          })
          if (response.status === 404) missing.push(table)
        } catch {
          // A network blip here should not be reported as a missing table.
        }
      })
    )
    schema = { ok: missing.length === 0, missing, checked: REQUIRED_TABLES.length }
  }

  const missingEnv = Object.entries(env)
    .filter(([key, present]) => !present && key !== 'ANTHROPIC_API_KEY')
    .map(([key]) => key)

  const failedChecks = Object.entries(checks)
    .filter(([, probe]) => !probe.ok)
    .map(([name]) => name)

  // One plain-English line, so the answer doesn't require reading the JSON.
  let summary: string
  if (missingEnv.length > 0) {
    summary =
      `This deployment is missing ${missingEnv.join(', ')}. ` +
      'Set them on the Vercel project and REDEPLOY — NEXT_PUBLIC_* values are ' +
      'baked in at build time, so changing them without a rebuild has no effect.'
  } else if (checks.supabaseAuth && !checks.supabaseAuth.ok) {
    summary =
      `Supabase at ${supabaseHost} did not respond to a health check. ` +
      'A free-tier project pauses after inactivity — resume it from the Supabase dashboard.'
  } else if (checks.supabaseRest && !checks.supabaseRest.ok) {
    summary =
      'Supabase is reachable but rejected the anon key — it was most likely rotated. ' +
      'Copy the current anon key from the Supabase dashboard into Vercel and redeploy.'
  } else if (schema && !schema.ok) {
    summary =
      `Supabase is reachable but ${schema.missing.length} of ${schema.checked} tables do not exist ` +
      `(${schema.missing.join(', ')}). Run database/schema.sql in the Supabase SQL editor — ` +
      'it creates everything in one go and is safe to run twice.'
  } else if (failedChecks.length > 0) {
    summary = `Supabase is healthy. Unreachable from this deployment: ${failedChecks.join(', ')}.`
  } else {
    summary = 'All checks passed. Sign-in failures are credentials, not configuration.'
  }

  return NextResponse.json(
    { summary, env, supabaseHost, checks, schema, checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
