'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { db, getAppSession, isGuestMode } from '@/lib/appSession'
import BackendDownNotice from '@/components/BackendDownNotice'
import AppShell from '@/components/layout/AppShell'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useHeatPalette } from '@/components/charts/HeatLegend'
import type { User } from '@supabase/supabase-js'

const RISK_PROFILES = ['Conservative', 'Moderate', 'Aggressive']
const HORIZONS = ['Short-term (0-6 months)', 'Medium-term (6-12 months)', 'Long-term (1+ years)']
const EXPERIENCE = ['New to investing', 'Some experience', 'Experienced']

interface Profile {
  full_name: string
  risk_profile: string
  investment_horizon: string
  investment_experience: string
}

const EMPTY: Profile = { full_name: '', risk_profile: '', investment_horizon: '', investment_experience: '' }

export default function Settings() {
  const router = useRouter()
  const [backendDown, setBackendDown] = useState(false)
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [saved, setSaved] = useState<Profile>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [cvd, setCvd] = useHeatPalette()
  const [guest, setGuest] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { user: sessionUser, guest: isGuest } = await getAppSession()
      setUser(sessionUser)
      setGuest(isGuest)
      const { data, error } = await db()
        .from('profiles')
        .select('full_name, risk_profile, investment_horizon, investment_experience')
        .eq('id', sessionUser.id)
        .maybeSingle()
      if (error) {
        setMessage({ tone: 'error', text: `Could not load your profile: ${error.message}` })
      } else {
        const loaded: Profile = {
          full_name: data?.full_name ?? sessionUser.user_metadata?.full_name ?? '',
          risk_profile: data?.risk_profile ?? '',
          investment_horizon: data?.investment_horizon ?? '',
          investment_experience: data?.investment_experience ?? '',
        }
        setProfile(loaded)
        setSaved(loaded)
      }
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = (Object.keys(profile) as (keyof Profile)[]).some((k) => profile[k] !== saved[k])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setMessage(null)
    const update = {
      full_name: profile.full_name.trim() || null,
      risk_profile: profile.risk_profile || null,
      investment_horizon: profile.investment_horizon || null,
      investment_experience: profile.investment_experience || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await db().from('profiles').update(update).eq('id', user.id).select('id')
    if (error) {
      setMessage({ tone: 'error', text: `Could not save: ${error.message}` })
    } else if (!data || data.length === 0) {
      // RLS lets a user update only their own row, and the row is created by
      // the signup trigger. An account made before that trigger existed has
      // none, and the update silently matches nothing — say so.
      setMessage({
        tone: 'error',
        text: 'No profile row exists for this account, so nothing was saved. Run database/schema.sql in Supabase to create it.',
      })
    } else {
      // Keep the name the header greets with in step with the profile.
      if (update.full_name && !isGuestMode()) await supabase.auth.updateUser({ data: { full_name: update.full_name } }).catch(() => {})
      setSaved(profile)
      setMessage({ tone: 'ok', text: 'Saved to your profile.' })
    }
    setSaving(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Supabase unreachable: this page's content lives in Postgres, so
  // there is nothing to show and nowhere useful to redirect to.
  if (backendDown) {
    return (
      <AppShell showTicker={false}>
        <BackendDownNotice feature="Settings" />
      </AppShell>
    )
  }

  const field = (key: keyof Profile) => ({
    value: profile[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [key]: e.target.value })),
    disabled: loading,
  })

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
      <div className="max-w-2xl mx-auto fade-in">
        <p className="eyebrow mb-2">Account</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight mb-8">Settings</h1>

        <section className="panel p-5 sm:p-7 mb-5" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-sm font-bold text-ink mb-1">
            Profile
          </h2>
          <p className="text-xs text-ink-faint mb-5">
            Your name is used to greet you on the dashboard.
            {guest && ' Everything here is saved in this browser.'}
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="full-name" className="stat-label block mb-1.5">
                Name
              </label>
              <input id="full-name" type="text" className="input w-full" autoComplete="name" {...field('full_name')} />
            </div>
            <div>
              <label htmlFor="email" className="stat-label block mb-1.5">
                Email
              </label>
              <input id="email" type="email" className="input w-full opacity-70" value={user?.email ?? (guest ? 'Guest — no account needed' : '')} readOnly />
            </div>
          </div>

          <h2 className="text-sm font-bold text-ink mt-8 mb-1">Investment preferences</h2>
          <p className="text-xs text-ink-faint mb-5">Stored with your profile for your own reference.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="risk" className="stat-label block mb-1.5">
                Risk profile
              </label>
              <select id="risk" className="input w-full" {...field('risk_profile')}>
                <option value="">Not set</option>
                {RISK_PROFILES.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="horizon" className="stat-label block mb-1.5">
                Horizon
              </label>
              <select id="horizon" className="input w-full" {...field('investment_horizon')}>
                <option value="">Not set</option>
                {HORIZONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="experience" className="stat-label block mb-1.5">
                Experience
              </label>
              <select id="experience" className="input w-full" {...field('investment_experience')}>
                <option value="">Not set</option>
                {EXPERIENCE.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button onClick={handleSave} disabled={!dirty || saving || loading} className="btn btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {message && (
              <p className={`text-xs ${message.tone === 'ok' ? 'text-up' : 'text-avoid'}`} role="status">
                {message.text}
              </p>
            )}
          </div>
        </section>

        <section className="panel p-5 sm:p-7 mb-5" aria-labelledby="display-heading">
          <h2 id="display-heading" className="text-sm font-bold text-ink mb-1">
            Display
          </h2>
          <p className="text-xs text-ink-faint mb-5">Saved in this browser.</p>
          <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
            <div>
              <p className="text-sm text-ink">Theme</p>
              <p className="text-xs text-ink-faint">Light or dark.</p>
            </div>
            <ThemeToggle />
          </div>
          <label className="flex items-center justify-between gap-4 py-3 cursor-pointer">
            <span>
              <span className="block text-sm text-ink">Colour-blind-safe heatmaps</span>
              <span className="block text-xs text-ink-faint">Blue for gains and orange for losses, instead of green and red.</span>
            </span>
            <input
              type="checkbox"
              checked={cvd}
              onChange={(e) => setCvd(e.target.checked)}
              className="w-4 h-4 accent-[var(--accent)] flex-shrink-0"
            />
          </label>
        </section>

        {!guest && (
        <section className="panel p-5 sm:p-7" aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-sm font-bold text-ink mb-4">
            Session
          </h2>
          <button
            onClick={handleLogout}
            className="bg-avoid-dim hover:bg-avoid hover:text-on-accent text-avoid border border-avoid-dim px-4 py-2 rounded-lg font-medium text-sm transition"
          >
            Log out
          </button>
        </section>
        )}
      </div>
    </AppShell>
  )
}
