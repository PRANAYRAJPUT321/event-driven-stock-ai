import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Where the root sends you.
 *
 * This used to redirect unconditionally to /auth/login, which was fine when
 * nothing worked without an account. It is actively wrong now: most of the
 * app needs neither a session nor a database, so sending every visitor to
 * the one page that can be blocked — by a signed-out state, or by a paused
 * Supabase project — makes a working app look broken at the front door.
 *
 * The check is a cookie read, not a session lookup: @supabase/ssr stores its
 * session under sb-<project-ref>-auth-token, and looking for that costs no
 * network call. That matters because the case this exists to handle is
 * precisely the one where Supabase does not answer — a getUser() here would
 * hang on the very request it is meant to route around. A stale cookie just
 * means /dashboard makes its own (already handled) decision.
 */
export default function Home() {
  const hasSupabaseSession = cookies()
    .getAll()
    .some((cookie) => /^sb-.*-auth-token/.test(cookie.name) && cookie.value)

  redirect(hasSupabaseSession ? '/dashboard' : '/markets')
}
