'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Catches a crash in any page so a visitor sees what happened and a way on,
 * not Next's blank "Application error: a client-side exception has occurred".
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Page error:', error)
  }, [error])

  return (
    <div className="min-h-screen grid-backdrop flex items-center justify-center px-4 font-sans">
      <div className="panel-elevated max-w-md w-full p-8 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-avoid mb-2">Something went wrong</p>
        <h1 className="text-xl font-bold text-ink mb-3">This page hit an unexpected error</h1>
        <p className="text-sm text-ink-muted mb-6">
          Usually a market-data source answered with something unexpected. Trying again normally fixes it.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={reset}
            className="bg-accent hover:bg-accent-bright text-on-accent font-semibold px-5 py-2.5 rounded-lg text-sm transition"
          >
            Try again
          </button>
          <Link
            href="/markets"
            className="border border-border hover:border-accent text-ink px-5 py-2.5 rounded-lg text-sm transition"
          >
            Go to markets
          </Link>
        </div>
      </div>
    </div>
  )
}
