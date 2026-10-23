'use client'

import type { User } from '@supabase/supabase-js'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import { guestDb } from '@/lib/guestDb'

/**
 * Who is using the app and where their data lives.
 *
 * A signed-in user reads and writes the Supabase tables as before. Everyone
 * else — a visitor without an account, or anyone while the database is
 * unreachable — gets the full app in guest mode, with history, watchlist,
 * portfolio and settings kept in this browser. Nothing redirects to a login
 * page and nothing tells a visitor to "connect a database".
 */
export interface AppSession {
  user: User
  guest: boolean
  /** Accounts are reachable, so offering "Sign in to sync" is honest. */
  canSignIn: boolean
}

let mode: 'cloud' | 'guest' = 'guest'

function guestUser(): User {
  let name = ''
  try {
    const tables = JSON.parse(localStorage.getItem('pulse-guest-db-v1') || '{}')
    name = tables.profiles?.[0]?.full_name || ''
  } catch {}
  return {
    id: 'guest',
    email: undefined,
    app_metadata: {},
    user_metadata: name ? { full_name: name } : {},
    aud: 'guest',
    created_at: new Date(0).toISOString(),
  } as unknown as User
}

// The header, the page and the ticker all ask at once on every load; they
// share one check rather than each probing the database.
let inFlight: Promise<AppSession> | null = null

export function getAppSession(): Promise<AppSession> {
  if (!inFlight) {
    inFlight = resolveSession().finally(() => {
      setTimeout(() => (inFlight = null), 0)
    })
  }
  return inFlight
}

async function resolveSession(): Promise<AppSession> {
  const { user, backendDown } = await getSessionUser()
  if (user) {
    mode = 'cloud'
    return { user, guest: false, canSignIn: true }
  }
  mode = 'guest'
  return { user: guestUser(), guest: true, canSignIn: !backendDown }
}

/** The data source for the current session: Supabase or this browser. */
export function db(): any {
  return mode === 'cloud' ? createClient() : guestDb
}

export function isGuestMode(): boolean {
  return mode === 'guest'
}
