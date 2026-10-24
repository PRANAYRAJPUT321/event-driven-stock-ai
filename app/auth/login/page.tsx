'use client'

import { Suspense, useEffect, useState } from 'react'
import { createClient, describeAuthError, getSessionUser, isSupabaseConfigured, isUnreachable } from '@/lib/supabase/client'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Distinguishes "we cannot reach the service" from "wrong password": only
  // the former means signing in is impossible rather than merely failed.
  const [backendUnreachable, setBackendUnreachable] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const message = searchParams.get('message')
  // Where to return after signing in. Only same-site paths are honoured, so a
  // crafted link cannot bounce a fresh session to another origin.
  const nextParam = searchParams.get('next')
  const next =
    nextParam && /^\/(?![\/\\])/.test(nextParam) ? nextParam : '/dashboard'
  const supabase = createClient()
  // Whether accounts can be reached at all; null until known.
  const [accounts, setAccounts] = useState<boolean | null>(isSupabaseConfigured ? null : false)
  useEffect(() => {
    // Asked of the server directly: the shared session check answers
    // guests instantly and only learns this in the background.
    getSessionUser().then((s) => setAccounts(!s.backendDown)).catch(() => setAccounts(false))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBackendUnreachable(false)
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError(describeAuthError(authError))
        setBackendUnreachable(isUnreachable(authError))
        return
      }
      router.push(next)
    } catch (err: any) {
      setError(describeAuthError(err))
      setBackendUnreachable(isUnreachable(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen grid-backdrop flex items-center justify-center px-4 font-sans text-ink">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="live-dot" />
            <span className="font-mono text-2xl font-bold tracking-tight neon-text">PULSE</span>
          </div>
          <p className="text-ink-muted text-sm">Event-driven stock intelligence for Indian equities</p>
        </div>

        {accounts === false || backendUnreachable ? (
          // No account service to sign in to — and none is needed: everything
          // works as a guest, saved in this browser.
          <div className="panel-elevated shadow-panel p-8 text-center">
            <p className="text-ink font-semibold mb-2">No account needed</p>
            <p className="text-sm text-ink-muted mb-6">
              Use every part of PULSE right away. Your analyses, watchlist and paper portfolio are saved in
              this browser.
            </p>
            <Link
              href={next}
              className="block bg-accent hover:bg-accent-bright text-on-accent font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Continue as guest →
            </Link>
          </div>
        ) : (
        <div className="panel-elevated shadow-panel p-8">
          {message && (
            <div className="bg-accent-dim/40 border border-accent-dim text-accent-bright px-4 py-3 rounded-lg mb-5 text-sm">
              {message}
            </div>
          )}
          {error && (
            <div className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-5 text-sm">
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wide">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-on-accent font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-ink-muted">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-accent-bright hover:underline font-medium">
              Sign up
            </Link>
          </div>

          {/* The live-market pages need no account and no database, so there
              is somewhere useful to go even when sign-in is impossible. */}
          <div className="mt-3 text-center text-xs text-ink-faint">
            <Link href={next} className="hover:text-accent hover:underline">
              Or continue as a guest — no account needed →
            </Link>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

export default function Login() {
  return (
    <Suspense fallback={<div className="min-h-screen grid-backdrop flex items-center justify-center text-ink-muted">Loading…</div>}>
      <LoginForm />
    </Suspense>
  )
}
