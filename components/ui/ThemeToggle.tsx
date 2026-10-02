'use client'

import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

/** Shared with the inline anti-FOUC script in app/layout.tsx — keep in sync. */
export const THEME_STORAGE_KEY = 'pulse-theme'

function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * Neon light/dark switch.
 *
 * The theme is already on <html data-theme> before React hydrates (the inline
 * script in the root layout does it), so this component's only job is to read
 * that value back and flip it. It deliberately does NOT apply a theme on mount
 * — doing so would fight the script and cause a visible flash.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  // `null` until mounted so the two states can't render different markup on
  // the server than in the browser (hydration mismatch).
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || systemTheme()
    setTheme(current)

    // Follow the OS only while the user hasn't made an explicit choice.
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    function onSystemChange(e: MediaQueryListEvent) {
      let stored: string | null = null
      try {
        stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      } catch {
        // Storage can throw in locked-down/private browsing contexts.
      }
      if (stored === 'dark' || stored === 'light') return
      const next: Theme = e.matches ? 'light' : 'dark'
      applyTheme(next)
      setTheme(next)
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Non-fatal: the theme still applies for this page load.
    }
  }

  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border text-ink-muted hover:text-accent hover:border-accent-dim hover:shadow-glow transition ${className}`}
    >
      {/* Rendered only after mount, so SSR markup matches the first client
          render regardless of which theme the script picked. */}
      {theme === null ? (
        <span className="w-4 h-4" aria-hidden />
      ) : isLight ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {/* moon */}
          <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.8 6.8 0 0 0 11 11Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {/* sun */}
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      )}
    </button>
  )
}
