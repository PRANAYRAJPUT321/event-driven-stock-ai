'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import CommandPalette from '@/components/CommandPalette'
import MarketBar from '@/components/MarketBar'
import NewsTicker from '@/components/NewsTicker'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { createClient, getSessionUser } from '@/lib/supabase/client'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/analyze', label: 'Analyze' },
  { href: '/markets', label: 'Markets' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
]

export default function AppShell({
  children,
  userEmail,
  onLogout,
  showTicker = true,
}: {
  children: React.ReactNode
  userEmail?: string | null
  onLogout?: () => void
  showTicker?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [watchlistAlerts, setWatchlistAlerts] = useState(0)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Nav badge: count of analyzed events (since each stock was watchlisted)
  // whose affected sectors overlap the sectors currently on the user's
  // watchlist — same "relevant activity" signal shown per-row on the
  // Watchlist page itself, surfaced globally so it's visible from any page.
  useEffect(() => {
    const supabase = createClient()
    let active = true

    async function loadAlertCount() {
      // getSessionUser never throws. The previous unguarded getUser() call
      // rejected when Supabase was unreachable, and since nothing awaited
      // this function that surfaced as an unhandled rejection on every page.
      const { user } = await getSessionUser()
      if (!user) return

      const { data: watched } = await supabase
        .from('watchlists')
        .select('created_at, stocks(sector)')
        .eq('user_id', user.id)

      const sectors = Array.from(
        new Set((watched || []).map((w: any) => w.stocks?.sector).filter(Boolean))
      )
      const earliest = (watched || []).reduce(
        (min: string | null, w: any) => (!min || w.created_at < min ? w.created_at : min),
        null as string | null
      )
      if (sectors.length === 0 || !earliest) {
        if (active) setWatchlistAlerts(0)
        return
      }

      const { count } = await supabase
        .from('event_analysis')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .overlaps('affected_sectors', sectors)
        .gt('created_at', earliest)

      if (active) setWatchlistAlerts(count || 0)
    }

    // The badge is decoration; it must never break the shell around it.
    loadAlertCount().catch(() => {})
    return () => {
      active = false
    }
  }, [pathname])

  return (
    <div className="min-h-screen grid-backdrop font-sans text-ink">
      <header className="sticky top-0 z-40 border-b border-border header-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="font-mono text-lg font-bold tracking-tight neon-text">PULSE</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    pathname === item.href
                      ? 'bg-surface-2 text-accent shadow-glow'
                      : 'text-ink-muted hover:text-ink hover:bg-surface'
                  }`}
                >
                  {item.label}
                  {item.href === '/watchlist' && watchlistAlerts > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold font-mono">
                      {watchlistAlerts}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-ink-faint text-xs hover:border-border-bright hover:text-ink-muted transition"
            >
              <span>Quick jump</span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border">⌘K</kbd>
            </button>
            {userEmail && <span className="hidden lg:inline text-xs text-ink-faint font-mono">{userEmail}</span>}
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-ink-muted hover:border-avoid-dim hover:text-avoid transition"
              >
                Logout
              </button>
            )}
          </div>
        </div>
        <nav className="flex md:hidden items-center gap-1 px-4 pb-2 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition ${
                pathname === item.href
                  ? 'bg-surface-2 text-accent border-accent-dim'
                  : 'text-ink-muted border-border hover:text-ink hover:border-accent-dim'
              }`}
            >
              {item.label}
              {item.href === '/watchlist' && watchlistAlerts > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[14px] h-3.5 px-1 rounded-full bg-accent text-on-accent text-[9px] font-bold font-mono">
                  {watchlistAlerts}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {showTicker && (
          <>
            <MarketBar />
            {/* Prices are the priority on a phone: the header is already
                logo + nav + bar tall there, so the headline strip is desktop
                only (Discover and the dashboard carry the same stories). */}
            <div className="hidden md:block">
              <NewsTicker />
            </div>
          </>
        )}
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
