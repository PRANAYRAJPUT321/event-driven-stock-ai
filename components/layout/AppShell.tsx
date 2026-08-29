'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import CommandPalette from '@/components/CommandPalette'
import MarketTicker from '@/components/MarketTicker'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/analyze', label: 'Analyze' },
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

  return (
    <div className="min-h-screen grid-backdrop font-sans text-ink">
      <header className="sticky top-0 z-40 border-b border-border header-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="font-mono text-lg font-bold tracking-tight text-ink">PULSE</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    pathname === item.href
                      ? 'bg-surface-2 text-ink'
                      : 'text-ink-muted hover:text-ink hover:bg-surface'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
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
                  ? 'bg-surface-2 text-ink border-border-bright'
                  : 'text-ink-muted border-border hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {showTicker && <MarketTicker />}
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10">{children}</main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
