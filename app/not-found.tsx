import Link from 'next/link'

/** Any URL that matches no page: say so in the app's own look, with a way back. */
export default function NotFound() {
  return (
    <div className="min-h-screen grid-backdrop flex items-center justify-center px-4 font-sans">
      <div className="panel-elevated max-w-md w-full p-8 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">404 · Page not found</p>
        <h1 className="text-xl font-bold text-ink mb-3">There’s nothing at this address</h1>
        <p className="text-sm text-ink-muted mb-6">
          The link may be mistyped, or the page may have moved. Everything in PULSE is a click away from the markets
          page.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/markets"
            className="bg-accent hover:bg-accent-bright text-on-accent font-semibold px-5 py-2.5 rounded-lg text-sm transition"
          >
            Go to markets
          </Link>
          <Link
            href="/analyze"
            className="border border-border hover:border-accent text-ink px-5 py-2.5 rounded-lg text-sm transition"
          >
            Analyze an event
          </Link>
        </div>
      </div>
    </div>
  )
}
