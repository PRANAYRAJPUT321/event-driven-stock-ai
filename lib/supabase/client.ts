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
