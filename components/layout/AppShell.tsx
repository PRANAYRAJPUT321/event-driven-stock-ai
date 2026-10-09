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

  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // "/" opens search, as on most sites — unless the reader is typing.
      const target = e.target as HTMLElement | null
      const typing =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setPaletteOpen(true)
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
          <div className="flex items-center gap-6 min-w-0">
            <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0" aria-label="PULSE home">
              <span className="relative w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow-glow" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h4l3-7 4 14 3-7h4" />
                </svg>
              </span>
              <span className="font-mono text-lg font-bold tracking-tight neon-text">PULSE</span>
            </Link>
            <nav className="hidden xl:flex items-center gap-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition ${
                    pathname === item.href || pathname?.startsWith(`${item.href}/`)
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
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2.5 w-56 lg:w-64 xl:w-56 2xl:w-64 px-3 py-2 rounded-xl border border-border bg-surface text-ink-faint text-sm hover:border-border-bright hover:text-ink-muted transition"
              aria-label="Search stocks, indices and pages"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <span className="flex-1 text-left truncate">Search stocks, indices…</span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border">
                {isMac ? '⌘K' : 'Ctrl K'}
              </kbd>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-border text-ink-muted hover:text-ink transition"
              aria-label="Search"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </button>
            <ThemeToggle />
            {userEmail && (
              <span
                className="hidden lg:flex w-8 h-8 rounded-full items-center justify-center bg-surface-2 border border-border-bright text-xs font-bold text-accent"
                title={userEmail}
              >
                {userEmail.slice(0, 1).toUpperCase()}
              </span>
            )}
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
        <nav className="flex xl:hidden items-center gap-1 px-4 pb-2 overflow-x-auto scrollbar-none max-w-7xl mx-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition ${
                pathname === item.href || pathname?.startsWith(`${item.href}/`)
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">{children}</main>
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 pb-10 pt-2">
        <div className="border-t border-border pt-5 flex flex-col sm:flex-row gap-2 sm:items-center justify-between text-[11px] text-ink-faint">
          <p>
            Market data: TradingView screener, Upstox and NSE&apos;s published lists · News: Google News · Crypto:
            CoinGecko
          </p>
          <p>For research and education. Not investment advice.</p>
        </div>
      </footer>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
