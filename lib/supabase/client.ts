import { createBrowserClient } from '@supabase/ssr'

const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY = 'placeholder-anon-key'

/**
 * Whether this build actually has Supabase credentials baked into it.
 *
 * NEXT_PUBLIC_* values are inlined at BUILD time, not read at runtime — so if
 * they were missing when Vercel built this deployment, no amount of fixing
 * them in the dashboard changes this bundle. Only a rebuild does. Callers use
 * this to say so plainly instead of letting the request fail with a bare
 * "Failed to fetch" against a placeholder host.
 */
export const isSupabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

/** Host only — this is already public in the browser bundle. Never the key. */
export const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL).host
  } catch {
    return 'invalid-url'
  }
})()

// The placeholders exist for one reason: `next build` prerenders the static
// shell of every client-component page, which constructs this client even
// though nothing calls it (all real usage is inside useEffect or an event
// handler). Throwing here would fail the build over a client that is never
// used. They are NOT a runtime fallback — isSupabaseConfigured above is how
// callers detect that state, so a misconfigured deployment reports itself
// rather than silently talking to a domain that does not exist.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY
  )
}

/**
 * Turns a Supabase auth failure into something a person can act on.
 *
 * supabase-js surfaces an unreachable project as a bare `TypeError: Failed to
 * fetch`, which is indistinguishable from a wrong password in the UI. The
 * three states have completely different fixes, so they get different
 * messages.
 */
/**
 * True when the failure means Supabase could not be reached at all, rather
 * than reached and refused. Only the first makes signing in impossible, so
 * only the first justifies offering a way past the login page.
 */
export function isUnreachable(error: unknown): boolean {
  if (!isSupabaseConfigured) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(message)
}

export function describeAuthError(error: unknown): string {
  if (!isSupabaseConfigured) {
    return (
      'This deployment was built without Supabase credentials, so sign-in cannot work. ' +
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are read at build time — ' +
      'set them in the Vercel project and redeploy. Open /api/health for details.'
    )
  }

  const message = error instanceof Error ? error.message : String(error ?? '')

  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
    return (
      `Could not reach the authentication service at ${supabaseHost}. ` +
      'A Supabase free-tier project pauses after a period of inactivity and has to be resumed ' +
      'from the Supabase dashboard. Open /api/health to see exactly what the server gets back.'
    )
  }

  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.'
  }

  if (/email not confirmed/i.test(message)) {
    return 'This email has not been confirmed yet — check your inbox for the confirmation link.'
  }

  return message || 'An error occurred'
}

export interface SessionState {
  user: import('@supabase/supabase-js').User | null
  /**
   * True when Supabase could not be reached at all, as opposed to being
   * reached and reporting nobody signed in. The two need opposite handling:
   * a signed-out visitor should be sent to the login page, but someone whose
   * backend is down must not be — the login page cannot work either, so
   * redirecting there is a dead end that looks like the app is broken.
   */
  backendDown: boolean
}

/**
 * Reads the current user without ever throwing.
 *
 * supabase-js rejects when the project is unreachable (a paused free-tier
 * project does exactly this). Pages called `await supabase.auth.getUser()`
 * unguarded, so that rejection escaped the effect, `setLoading(false)` never
 * ran, and the page sat on its loading skeleton forever with nothing in the
 * UI to say why.
 */
export async function getSessionUser(): Promise<SessionState> {
  if (!isSupabaseConfigured) return { user: null, backendDown: true }

  try {
    const supabase = createClient()
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) return { user: data.user, backendDown: false }
  } catch {
    // Fall through to the probe — a thrown error and a returned one mean the
    // same thing here.
  }

  // Nobody is signed in, and the reason matters. Do not try to infer it from
  // the error text: with no stored session supabase-js short-circuits without
  // touching the network, and a refresh against a dead backend reports a
  // *token* error, so both unreachable cases read as "signed out". Ask the
  // server instead — it is same-origin, so no CORS, and authoritative.
  return { user: null, backendDown: !(await isBackendReachable()) }
}

async function isBackendReachable(): Promise<boolean> {
  try {
    const response = await fetch('/api/health?scope=supabase', { cache: 'no-store' })
    if (!response.ok) return false
    const data = await response.json()
    return Boolean(data?.checks?.supabaseAuth?.ok)
  } catch {
    return false
  }
}
