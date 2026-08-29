'use client'

import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const message = searchParams.get('message')
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError(authError.message)
        return
      }
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid-backdrop flex items-center justify-center px-4 font-sans text-ink">
      <div className="w-full max-w-md fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="live-dot" />
            <span className="font-mono text-2xl font-bold tracking-tight">PULSE</span>
          </div>
          <p className="text-ink-muted text-sm">Event-driven stock intelligence for Indian equities</p>
        </div>

        <div className="panel-elevated shadow-panel p-8">
          {message && (
            <div className="bg-accent-dim/40 border border-accent-dim text-accent-bright px-4 py-3 rounded-lg mb-5 text-sm">
              {message}
            </div>
          )}
          {error && (
            <div className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-5 text-sm">
              {error}
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
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-bright disabled:opacity-50 text-[#0a0d14] font-semibold py-2.5 px-4 rounded-lg transition"
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
        </div>
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
