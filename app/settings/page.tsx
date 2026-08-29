'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import type { User } from '@supabase/supabase-js'

export default function Settings() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/auth/login')
        return
      }
      setUser(session.user)
    }
    init()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
      <div className="max-w-2xl mx-auto fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Account</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-8">Settings</h1>

        <div className="panel p-8 space-y-8">
          <div className="pb-8 border-b border-border">
            <h3 className="text-sm font-bold text-ink mb-1">Profile</h3>
            <p className="text-ink-faint text-xs mb-4 font-mono">{user?.email}</p>
            <button className="text-accent-bright hover:underline text-sm font-medium">Edit Profile →</button>
          </div>

          <div className="pb-8 border-b border-border">
            <h3 className="text-sm font-bold text-ink mb-4">Investment Preferences</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-2 uppercase tracking-wide">Risk Profile</label>
                <select className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent">
                  <option>Conservative</option>
                  <option>Moderate</option>
                  <option>Aggressive</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-2 uppercase tracking-wide">Investment Horizon</label>
                <select className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent">
                  <option>Short-term (0-6 months)</option>
                  <option>Medium-term (6-12 months)</option>
                  <option>Long-term (1+ years)</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-ink mb-4">Account</h3>
            <button
              onClick={handleLogout}
              className="bg-avoid-dim hover:bg-avoid hover:text-[#0a0d14] text-avoid border border-avoid-dim px-4 py-2 rounded-lg font-medium text-sm transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
