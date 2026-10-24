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

const REACHABLE_KEY = 'pulse-accounts-reachable'

/**
 * Whether this browser holds a Supabase sign-in at all. @supabase/ssr keeps
 * the session in `sb-<project>-auth-token` cookies (chunked as .0, .1 when
 * long); older builds used localStorage under the same name.
 */
function hasStoredSignIn(): boolean {
  try {
    if (/(?:^|;\s*)sb-[^=]*-auth-token(?:\.\d+)?=/.test(document.cookie)) return true
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || ''
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) return true
    }
  } catch {}
  return false
}

async function resolveSession(): Promise<AppSession> {
  // A visitor who never signed in is a guest, and knowing that needs no
  // network. Every page used to wait on a round trip to the server's health
  // check (and from there to the database) before loading its own data —
  // seconds on a phone, on every navigation, for an answer that was always
  // going to be "guest".
  if (!hasStoredSignIn()) {
    mode = 'guest'
    let canSignIn = false
    try {
      canSignIn = sessionStorage.getItem(REACHABLE_KEY) === '1'
    } catch {}
    // Whether "Sign in" is worth offering is found out in the background and
    // remembered for the rest of the visit.
    if (!probing) {
      probing = true
      getSessionUser()
        .then(({ backendDown }) => {
          try {
            sessionStorage.setItem(REACHABLE_KEY, backendDown ? '0' : '1')
          } catch {}
        })
        .catch(() => {})
    }
    return { user: guestUser(), guest: true, canSignIn }
  }

  const { user, backendDown } = await getSessionUser()
  if (user) {
    mode = 'cloud'
    return { user, guest: false, canSignIn: true }
  }
  mode = 'guest'
  return { user: guestUser(), guest: true, canSignIn: !backendDown }
}

let probing = false

/** The data source for the current session: Supabase or this browser. */
export function db(): any {
  return mode === 'cloud' ? createClient() : guestDb
}

export function isGuestMode(): boolean {
  return mode === 'guest'
}
