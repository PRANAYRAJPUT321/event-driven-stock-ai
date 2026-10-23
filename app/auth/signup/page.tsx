'use client'

import { useEffect, useState } from 'react'
import { createClient, describeAuthError, isSupabaseConfigured } from '@/lib/supabase/client'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { getAppSession } from '@/lib/appSession'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()
  // Whether accounts can be reached at all; null until known.
  const [accounts, setAccounts] = useState<boolean | null>(isSupabaseConfigured ? null : false)
  useEffect(() => {
    getAppSession().then((s) => setAccounts(s.canSignIn)).catch(() => setAccounts(false))
  }, [])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })

      if (authError) {
        setError(describeAuthError(authError))
        return
      }

      if (data.user) {
        router.push('/auth/login?message=Check your email to confirm your account')
      }
    } catch (err: any) {
      setError(describeAuthError(err))
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

        {accounts === false ? (
          <div className="panel-elevated shadow-panel p-8 text-center">
            <p className="text-ink font-semibold mb-2">No account needed</p>
            <p className="text-sm text-ink-muted mb-6">
              Use every part of PULSE right away. Your analyses, watchlist and paper portfolio are saved in
              this browser.
            </p>
            <Link
              href="/dashboard"
              className="block bg-accent hover:bg-accent-bright text-on-accent font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Continue as guest →
            </Link>
          </div>
        ) : (
        <div className="panel-elevated shadow-panel p-8">
          {error && (
            <div className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wide">Full name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent transition"
                placeholder="Your name"
              />
            </div>

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
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-ink-muted">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-accent-bright hover:underline font-medium">
              Sign in
            </Link>
          </div>
          <div className="mt-3 text-center text-xs text-ink-faint">
            <Link href="/dashboard" className="hover:text-accent hover:underline">
              Or continue as a guest — no account needed →
            </Link>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
