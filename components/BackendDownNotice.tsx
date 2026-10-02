import Link from 'next/link'

/**
 * Shown on pages whose content lives in Postgres, when Supabase cannot be
 * reached. It replaces two worse behaviours: sitting on a loading skeleton
 * forever, and bouncing the visitor to a login page that cannot work either.
 *
 * It names the fix, because the fix is not in this app — a paused Supabase
 * project has to be resumed from the Supabase dashboard.
 */
export default function BackendDownNotice({ feature }: { feature: string }) {
  return (
    <div className="panel p-10 text-center max-w-xl mx-auto fade-in">
      <p className="text-xs font-mono uppercase tracking-widest text-hold mb-3">Database unavailable</p>
      <h2 className="text-xl font-bold text-ink mb-3">{feature} needs the database</h2>
      <p className="text-sm text-ink-muted mb-6 leading-relaxed">
        The app cannot reach its Supabase project, so anything stored per-user — saved analyses,
        watchlists, portfolio positions, sign-in itself — is unavailable. A Supabase free-tier
        project pauses after a period of inactivity and has to be resumed from the{' '}
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Supabase dashboard
        </a>
        . Nothing needs redeploying once it is back.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/markets"
          className="bg-accent hover:bg-accent-bright text-on-accent font-semibold px-4 py-2 rounded-lg text-sm transition"
        >
          Live markets (works without the database)
        </Link>
        <a
          href="/api/health"
          className="border border-border text-ink-muted hover:text-accent hover:border-accent-dim px-4 py-2 rounded-lg text-sm transition"
        >
          Run diagnostics
        </a>
      </div>
    </div>
  )
}
