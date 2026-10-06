'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import Sparkline from '@/components/charts/Sparkline'
import type { User } from '@supabase/supabase-js'
import type { MarketQuote } from '@/lib/market/yahooFinance'

interface CryptoCoin {
  symbol: string
  name: string
  price: number
  changePct: number
  marketCap: number
}

type Tab = 'equities' | 'india' | 'world' | 'commodities' | 'currencies' | 'crypto'

const TABS: { id: Tab; label: string }[] = [
  { id: 'equities', label: 'NIFTY 50 Stocks' },
  { id: 'india', label: 'India Indices' },
  { id: 'world', label: 'World Indices' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'crypto', label: 'Crypto' },
]

/** Human names for the provider ids the API reports. */
const SOURCE_LABELS: Record<string, string> = {
  'yahoo-spark': 'Yahoo (batch)',
  'yahoo-quote': 'Yahoo (quote)',
  'yahoo-chart': 'Yahoo (chart)',
  stooq: 'Stooq',
}

interface EquityQuote {
  symbol: string
  name: string
  sector: string
  price: number
  changePct: number
  spark?: number[]
  source?: string
}

// Heat intensity scales with |change| up to this cap, so a routine ±0.3%
// index move and a routine ±5% crypto move both read as "mild" rather than
// crypto tiles being permanently maxed-out red/green.
// Each asset class has its own idea of a big day: a 2% index move is large,
// a 2% crypto move is noise. Scaling per tab keeps the colour meaningful
// instead of leaving crypto permanently saturated.
const MAX_ABS_PCT: Record<Tab, number> = {
  equities: 4,
  india: 2.5,
  world: 2.5,
  commodities: 3,
  currencies: 1.2,
  crypto: 8,
}

function heatStyle(changePct: number, tab: Tab): React.CSSProperties {
  const alpha = Math.min(Math.abs(changePct) / MAX_ABS_PCT[tab], 1) * 0.42 + 0.06
  // Reads the live theme tokens so tiles re-tint in light mode instead of
  // painting dark-mode neon onto a white page.
  const base = changePct >= 0 ? 'var(--buy)' : 'var(--avoid)'
  return {
    background: `color-mix(in srgb, ${base} ${Math.round(alpha * 100)}%, transparent)`,
    borderColor: `color-mix(in srgb, ${base} ${Math.round(
      Math.min(alpha + 0.3, 0.9) * 100
    )}%, transparent)`,
  }
}

function formatMarketCap(cap: number): string {
  if (!cap) return ''
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`
  return `$${cap.toFixed(0)}`
}

interface Tile {
  key: string
  group: string
  name: string
  price: number
  changePct: number
  footnote?: string
  /** Set for tiles that link somewhere — equities link to their profile. */
  href?: string
  /** Recent closes, for the tile's own price line. */
  spark?: number[]
}

export default function Markets() {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [equities, setEquities] = useState<EquityQuote[]>([])
  const [coins, setCoins] = useState<CryptoCoin[]>([])
  const [sectorFilter, setSectorFilter] = useState('All')
  const [failed, setFailed] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  // Set when the upstream rate-limited and the server served its last good
  // payload instead. Shown rather than hidden: slightly old prices labelled as
  // old are useful; the same prices passed off as live are not.
  const [staleAgeSeconds, setStaleAgeSeconds] = useState<number | null>(null)
  // Which upstream actually served the prices on screen. Worth showing: the
  // app falls back across several, and "which feed answered" has been the
  // single most useful thing to know when the grid looked wrong.
  const [sources, setSources] = useState<string[]>([])
  // How many tiles came from memory rather than this refresh. A rate-limited
  // feed fills the grid gradually, and saying so is better than implying
  // every tile is a second old.
  const [remembered, setRemembered] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('equities')

  useEffect(() => {
    let active = true

    async function init() {
      // Deliberately no auth guard: every tab on this page comes from keyless
      // public feeds, so it stays usable signed out — and, more to the point,
      // while the database is unreachable. The session lookup is only for the
      // header's email/logout affordance.
      const { user } = await getSessionUser()
      if (active) setUser(user)
      await load(active)
    }

    init()
    // Same cadence as the market bar. The routes are edge-cached, so this is
    // cheap regardless of how many tabs are open.
    const interval = setInterval(() => load(active), 60000)
    return () => {
      active = false
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load(active = true) {
    // Three independent sources; one being rate-limited must not blank the
    // others' tabs, so each is settled and reported separately.
    const [marketRes, equityRes, cryptoRes] = await Promise.allSettled([
      fetch('/api/market/live?scope=full').then(async (r) => ({ ok: r.ok, body: await r.json() })),
      fetch('/api/market/equities').then(async (r) => ({ ok: r.ok, body: await r.json() })),
      fetch('/api/market/crypto').then(async (r) => ({ ok: r.ok, body: await r.json() })),
    ])
    if (!active) return

    const nextErrors: string[] = []
    const nextFailed: string[] = []

    if (marketRes.status === 'fulfilled' && marketRes.value.ok) {
      setQuotes(marketRes.value.body.quotes || [])
      nextFailed.push(...(marketRes.value.body.failed || []))
      setFetchedAt(marketRes.value.body.fetchedAt || null)
      setStaleAgeSeconds(
        marketRes.value.body.stale ? marketRes.value.body.staleAgeSeconds ?? null : null
      )
      setRemembered(marketRes.value.body.fromMemory ?? 0)
      setSources(
        Array.from(
          new Set(
            [...(marketRes.value.body.quotes || [])]
              .map((q: MarketQuote) => q.source)
              .filter(Boolean) as string[]
          )
        )
      )
    } else {
      const reason =
        marketRes.status === 'fulfilled' ? marketRes.value.body?.error : (marketRes.reason as Error)?.message
      nextErrors.push(`Indices, commodities & FX: ${reason || 'unavailable'}`)
    }

    if (equityRes.status === 'fulfilled' && equityRes.value.ok) {
      setEquities(equityRes.value.body.quotes || [])
      nextFailed.push(...(equityRes.value.body.failed || []))
    } else {
      const reason =
        equityRes.status === 'fulfilled' ? equityRes.value.body?.error : (equityRes.reason as Error)?.message
      nextErrors.push(`NIFTY 50 stocks: ${reason || 'unavailable'}`)
    }

    if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
      setCoins(cryptoRes.value.body.coins || [])
    } else {
      const reason =
        cryptoRes.status === 'fulfilled' ? cryptoRes.value.body?.error : (cryptoRes.reason as Error)?.message
      nextErrors.push(`Crypto: ${reason || 'unavailable'}`)
    }

    setFailed(nextFailed)
    setErrors(nextErrors)
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const tilesFor = (predicate: (q: MarketQuote) => boolean, group: (q: MarketQuote) => string): Tile[] =>
    quotes.filter(predicate).map((q) => ({
      key: q.symbol,
      group: group(q),
      name: q.name,
      price: q.price,
      changePct: q.changePct,
      footnote: q.currency,
      spark: q.spark,
    }))

  const equityTiles: Tile[] = equities
    .filter((e) => sectorFilter === 'All' || e.sector === sectorFilter)
    .map((e) => ({
      key: e.symbol,
      group: e.sector,
      name: e.name,
      price: e.price,
      changePct: e.changePct,
      footnote: e.symbol,
      href: `/stocks/${e.symbol}`,
      spark: e.spark,
    }))

  const byTab: Record<Tab, Tile[]> = {
    equities: equityTiles,
    india: tilesFor((q) => q.category === 'domestic', () => 'India'),
    world: tilesFor((q) => q.category === 'international', () => 'Global'),
    commodities: tilesFor((q) => q.category === 'commodity', () => 'Commodity'),
    currencies: tilesFor((q) => q.category === 'currency', () => 'FX'),
    crypto: coins.map((c) => ({
      key: c.symbol,
      group: c.symbol,
      name: c.name,
      price: c.price,
      changePct: c.changePct,
      footnote: formatMarketCap(c.marketCap),
    })),
  }
  const active = byTab[tab]

  // Sector filter chips, only meaningful on the equities tab.
  const equitySectors = ['All', ...Array.from(new Set(equities.map((e) => e.sector))).sort()]

  // A breadth count says more about a session than any single tile.
  const advancing = active.filter((t) => t.changePct > 0).length
  const declining = active.filter((t) => t.changePct < 0).length

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-accent mb-2">Global markets</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Live Market Heatmap</h1>
          <p className="text-ink-muted text-sm">
            Every NIFTY 50 stock, Indian sector indices, the major exchanges of every region,
            the commodity complex, INR crosses and the top 50 cryptocurrencies — colour-scaled by
            today&apos;s move. Fetched live from keyless public feeds, refreshed every minute.
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5 flex-shrink-0">
          {fetchedAt && (
            <span
              className={`flex items-center gap-2 text-[10px] font-mono ${
                staleAgeSeconds !== null ? 'text-hold' : 'text-ink-faint'
              }`}
              title={
                staleAgeSeconds !== null
                  ? 'The upstream feed is rate-limiting. These are the last prices it served.'
                  : undefined
              }
            >
              {staleAgeSeconds === null && <span className="live-dot" />}
              {staleAgeSeconds !== null
                ? `${remembered} tile${remembered === 1 ? '' : 's'} up to ${
                    staleAgeSeconds < 90
                      ? `${staleAgeSeconds}s`
                      : `${Math.round(staleAgeSeconds / 60)}m`
                  } old`
                : `Updated ${new Date(fetchedAt).toLocaleTimeString('en-IN', { hour12: false })}`}
            </span>
          )}
          {sources.length > 0 && (
            <span className="text-[10px] font-mono text-ink-faint">
              via {sources.map((s) => SOURCE_LABELS[s] ?? s).join(' + ')}
            </span>
          )}
          {!loading && active.length > 0 && (
            <span className="text-[11px] font-mono mono-tabular">
              <span className="text-buy">{advancing} advancing</span>
              <span className="text-ink-faint"> · </span>
              <span className="text-avoid">{declining} declining</span>
            </span>
          )}
        </div>
      </div>

      {errors.map((message) => (
        <p
          key={message}
          className="text-sm text-avoid bg-avoid-dim border border-avoid-dim rounded-lg px-3 py-2 mb-3"
        >
          {message}
        </p>
      ))}

      {failed.length > 0 && (
        <p className="text-xs text-ink-faint font-mono mb-4">
          No data for: {failed.join(', ')}
        </p>
      )}

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition ${
              tab === t.id
                ? 'bg-accent text-on-accent border-accent shadow-glow'
                : 'bg-surface text-ink-muted border-border hover:border-accent-dim'
            }`}
          >
            {t.label} ({byTab[t.id].length})
          </button>
        ))}
      </div>

      {tab === 'equities' && equitySectors.length > 1 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {equitySectors.map((sector) => (
            <button
              key={sector}
              onClick={() => setSectorFilter(sector)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition ${
                sectorFilter === sector
                  ? 'bg-surface-2 text-accent border-accent-dim'
                  : 'bg-surface text-ink-muted border-border hover:border-accent-dim'
              }`}
            >
              {sector}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-28" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <div className="panel p-10 text-center text-ink-muted">
          <p className="text-lg mb-2 text-ink">No data for this tab right now</p>
          <p className="text-sm">
            The upstream feed is rate-limiting or unreachable. It refreshes automatically every
            minute — no key or manual refresh needed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {active.map((tile, idx) => {
            // Equity tiles are links to the stock's own page; index and
            // commodity tiles have nowhere more specific to go.
            const Tag = (tile.href ? 'a' : 'div') as any
            return (
            <Tag
              key={tile.key}
              {...(tile.href ? { href: tile.href } : {})}
              style={{ ...heatStyle(tile.changePct, tab), animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              className="tile-hover fade-in rounded-xl border p-4 block"
            >
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-faint mb-1">
                {tile.group}
              </p>
              <p className="font-bold text-ink text-sm mb-2 truncate" title={tile.name}>
                {tile.name}
              </p>
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="mono-tabular text-lg font-bold text-ink leading-tight">
                    {tile.price.toLocaleString('en-IN', {
                      minimumFractionDigits: tile.price < 10 ? 4 : 2,
                      maximumFractionDigits: tile.price < 10 ? 4 : 2,
                    })}
                  </p>
                  <p
                    className={`mono-tabular text-sm font-semibold ${
                      tile.changePct >= 0 ? 'text-buy' : 'text-avoid'
                    }`}
                  >
                    {tile.changePct >= 0 ? '▲' : '▼'} {Math.abs(tile.changePct).toFixed(2)}%
                  </p>
                </div>
                {tile.spark && tile.spark.length > 1 && (
                  <Sparkline
                    values={tile.spark}
                    positive={tile.changePct >= 0}
                    className="flex-shrink-0 opacity-90"
                  />
                )}
              </div>
              {tile.footnote && (
                <p className="text-[10px] text-ink-faint mt-1.5 font-mono">{tile.footnote}</p>
              )}
            </Tag>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
