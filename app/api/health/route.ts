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

export async function GET() {
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
  checks.yahooFinance = await probe(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1d',
    { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
  )
  checks.googleNewsRss = await probe(
    'https://news.google.com/rss/search?q=nifty&hl=en-IN&gl=IN&ceid=IN:en',
    { 'User-Agent': 'Mozilla/5.0' }
  )

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
  } else if (failedChecks.length > 0) {
    summary = `Supabase is healthy. Unreachable from this deployment: ${failedChecks.join(', ')}.`
  } else {
    summary = 'All checks passed. Sign-in failures are credentials, not configuration.'
  }

  return NextResponse.json(
    { summary, env, supabaseHost, checks, checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
