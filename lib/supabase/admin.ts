import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * SERVER-ONLY. Never import this from a 'use client' component or expose
 * SUPABASE_SERVICE_ROLE_KEY to the browser. Use it only for operations that
 * are legitimately not scoped to the requesting user's own rows — e.g.
 * writing to news_feeds, which is shared system-populated data rather than
 * per-user data. For anything user-owned, use lib/supabase/server.ts instead
 * so RLS keeps enforcing "users can only touch their own rows."
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
