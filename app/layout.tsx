import type { Metadata } from 'next'
import { JetBrains_Mono, Manrope } from 'next/font/google'
import './globals.css'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Pulse — Event-Driven Stock Intelligence',
  description: 'AI-powered, event-driven investment analysis for the Indian equity market',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📡</text></svg>',
  },
}

// Runs before first paint, so the correct theme's tokens are in effect for the
// very first frame — without this the dark default would flash on a light-mode
// device (and vice versa) until React hydrated. Intentionally tiny, inline and
// dependency-free; the key must match THEME_STORAGE_KEY in ThemeToggle.tsx.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('pulse-theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
