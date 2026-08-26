import { createBrowserClient } from '@supabase/ssr'

// Falls back to placeholders when the env vars are unset. This only matters
// during `next build`'s static-shell prerender of client-component pages,
// where createBrowserClient() runs but nothing calls the client (all real
// usage is inside useEffect, which never executes during that pass) — so a
// hard throw here would fail the whole build over a client that's never
// used. In the browser, correctly configured env vars are used as normal;
// if they're still missing there, calls fail at the point of use instead of
// crashing the page outright.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
  )
}
