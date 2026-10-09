'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import Sparkline from '@/components/charts/Sparkline'
import MarketTreemap from '@/components/charts/MarketTreemap'
import HeatLegend from '@/components/charts/HeatLegend'
import { formatINRCompact, formatPct, formatPrice, nseSessionState } from '@/lib/format'
import { heatColor, heatInk, heatStep, type HeatScale } from '@/lib/heat'
import type { MarketQuote } from '@/lib/market/types'
import type { User } from '@supabase/supabase-js'

interface CryptoCoin {
  symbol: string
  name: string
  price: number
  changePct: number
  marketCap: number
}

interface EquityQuote {
  symbol: string
  name: string
  sector: string
  price: number
  changePct: number
  marketCap?: number | null
  spark?: number[]
  source?: string
}

type Tab = 'equities' | 'india' | 'world' | 'commodities' | 'currencies' | 'crypto'
type View = 'heatmap' | 'grid'

const TABS: { id: Tab; label: string }[] = [
  { id: 'equities', label: 'NIFTY 50' },
  { id: 'india', label: 'India indices' },
  { id: 'world', label: 'World' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'crypto', label: 'Crypto' },
]

const SCALE: Record<Tab, HeatScale> = {
  equities: 'equity',
  india: 'index',
  world: 'index',
  commodities: 'commodity',
  currencies: 'currency',
  crypto: 'crypto',
}

const SOURCE_LABELS: Record<string, string> = {
  tradingview: 'TradingView',
  upstox: 'Upstox',
  frankfurter: 'ECB rates',
  'yahoo-spark': 'Yahoo',
  'yahoo-quote': 'Yahoo',
  'yahoo-chart': 'Yahoo',
  stooq: 'Stooq',
}

interface Tile {
  key: string
  group: string
  name: string
  price: number
  changePct: number
  footnote?: string
  href?: string
  spark?: number[]
}

function formatUsdCompact(cap: number): string {
  if (!cap) return ''
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`
  return `$${(cap / 1e6).toFixed(0)}M`
}

function HeatTile({ tile, scale, index }: { tile: Tile; scale: HeatScale; index: number }) {
  const step = heatStep(tile.changePct, scale)
  const Tag = (tile.href ? Link : 'div') as any
  return (
    <Tag
      {...(tile.href ? { href: tile.href } : {})}
      style={{ background: heatColor(step), color: heatInk(step), animationDelay: `${Math.min(index * 20, 300)}ms` }}
      className={`fade-in rounded-xl p-3.5 block ${tile.href ? 'tile-hover' : ''}`}
      aria-label={`${tile.name}, ${formatPrice(tile.price)}, ${tile.changePct >= 0 ? 'up' : 'down'} ${Math.abs(tile.changePct).toFixed(2)}%`}
    >
      <p className="font-mono text-[10px] uppercase tracking-wide opacity-70 mb-0.5 truncate">{tile.group}</p>
      <p className="font-bold text-sm mb-2 truncate" title={tile.name}>
        {tile.name}
      </p>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="mono-tabular text-[17px] font-bold leading-tight">{formatPrice(tile.price)}</p>
          <p className="mono-tabular text-xs font-semibold opacity-90">
            {tile.changePct >= 0 ? '▲' : '▼'} {formatPct(tile.changePct)}
          </p>
        </div>
        {tile.spark && tile.spark.length > 1 && (
          <span className="flex-shrink-0 opacity-90">
            <Sparkline values={tile.spark} positive={tile.changePct >= 0} width={72} height={24} color="currentColor" />
          </span>
        )}
      </div>
      {tile.footnote && <p className="text-[10px] mt-1.5 font-mono opacity-60 truncate">{tile.footnote}</p>}
    </Tag>
  )
}

function MoverList({ title, items, positive }: { title: string; items: EquityQuote[]; positive: boolean }) {
  return (
    <div>
      <p className="stat-label mb-2">{title}</p>
      <ul>
        {items.map((q) => (
          <li key={q.symbol}>
            <Link
              href={`/stocks/${encodeURIComponent(q.symbol)}`}
              className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-hover -mx-2 px-2 rounded-lg transition"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink truncate">{q.name}</span>
                <span className="block text-[11px] font-mono text-ink-faint">{q.symbol}</span>
              </span>
              <span className="text-right flex-shrink-0">
                <span className="block mono-tabular text-sm text-ink">{formatPrice(q.price)}</span>
                <span className={`block mono-tabular text-xs font-semibold ${positive ? 'text-up' : 'text-down'}`}>
                  {q.changePct >= 0 ? '▲' : '▼'} {formatPct(q.changePct)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
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
  const [staleAgeSeconds, setStaleAgeSeconds] = useState<number | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('equities')
  const [view, setView] = useState<View>('heatmap')

  useEffect(() => {
    // The tab can be deep-linked (the header search links indices here).
    const fromUrl = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (fromUrl && TABS.some((t) => t.id === fromUrl)) setTab(fromUrl)
    // A treemap of fifty companies is unreadable on a phone; the grid is not.
    if (window.innerWidth < 640) setView('grid')

    let active = true
    async function init() {
      // No auth guard: every tab comes from keyless public feeds, so this page
      // stays usable signed out and while the database is unreachable.
      const { user } = await getSessionUser()
      if (active) setUser(user)
      await load(active)
    }
    init()
    const interval = setInterval(() => load(active), 60000)
    return () => {
      active = false
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectTab(next: Tab) {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'equities') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url.toString())
  }

  async function load(active = true) {
    // Three independent sources; one failing must not blank the others' tabs.
    const [marketRes, equityRes, cryptoRes] = await Promise.allSettled([
      fetch('/api/market/live?scope=full').then(async (r) => ({ ok: r.ok, body: await r.json() })),
      fetch('/api/market/equities').then(async (r) => ({ ok: r.ok, body: await r.json() })),
      fetch('/api/market/crypto').then(async (r) => ({ ok: r.ok, body: await r.json() })),
    ])
    if (!active) return

    const nextErrors: string[] = []
    const nextFailed: string[] = []
    const nextSources = new Set<string>()

    if (marketRes.status === 'fulfilled' && marketRes.value.ok) {
      const body = marketRes.value.body
      setQuotes(body.quotes || [])
      nextFailed.push(...(body.failed || []))
      setFetchedAt(body.fetchedAt || null)
      setStaleAgeSeconds(body.stale ? body.staleAgeSeconds ?? null : null)
      for (const q of body.quotes || []) if (q.source) nextSources.add(SOURCE_LABELS[q.source] ?? q.source)
    } else {
      nextErrors.push('Indices, commodities and currencies are unavailable right now.')
    }

    if (equityRes.status === 'fulfilled' && equityRes.value.ok) {
      const body = equityRes.value.body
      setEquities(body.quotes || [])
      nextFailed.push(...(body.failed || []))
      for (const q of body.quotes || []) if (q.source) nextSources.add(SOURCE_LABELS[q.source] ?? q.source)
    } else {
      nextErrors.push('NIFTY 50 quotes are unavailable right now.')
    }

    if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
      setCoins(cryptoRes.value.body.coins || [])
    } else {
      nextErrors.push('Crypto prices are unavailable right now.')
    }

    setFailed(nextFailed)
    setErrors(nextErrors)
    setSources(Array.from(nextSources))
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
      footnote: q.currency || undefined,
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
      footnote: `${e.symbol}${e.marketCap ? ` · ${formatINRCompact(e.marketCap)}` : ''}`,
      href: `/stocks/${encodeURIComponent(e.symbol)}`,
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
      footnote: formatUsdCompact(c.marketCap),
    })),
  }
  const counts: Record<Tab, number> = {
    equities: equities.length,
    india: byTab.india.length,
    world: byTab.world.length,
    commodities: byTab.commodities.length,
    currencies: byTab.currencies.length,
    crypto: coins.length,
  }
  const active = byTab[tab]
  const equitySectors = ['All', ...Array.from(new Set(equities.map((e) => e.sector))).sort()]

  const breadth = useMemo(() => {
    const up = equities.filter((e) => e.changePct > 0).length
    const down = equities.filter((e) => e.changePct < 0).length
    return { up, down, flat: equities.length - up - down }
  }, [equities])

  const movers = useMemo(() => {
    const sorted = [...equities].sort((a, b) => b.changePct - a.changePct)
    return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() }
  }, [equities])

  const headline = ['^NSEI', '^BSESN', '^NSEBANK', '^INDIAVIX']
    .map((s) => quotes.find((q) => q.symbol === s))
    .filter((q): q is MarketQuote => !!q)

  const session = nseSessionState()

  return (
    <AppShell userEmail={user?.email} onLogout={user ? handleLogout : undefined}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="eyebrow mb-2">Markets</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight">Live market heatmap</h1>
          <p className="text-ink-muted text-sm mt-1.5 max-w-2xl">
            Every NIFTY 50 company sized by market value and coloured by today&apos;s move, plus Indian sector indices,
            world markets, commodities, currencies and crypto. Refreshed every minute.
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-1 text-[11px] font-mono text-ink-faint flex-shrink-0">
          <span className="flex items-center gap-2">
            {session.open && <span className="live-dot" aria-hidden="true" />}
            {session.label}
            {fetchedAt &&
              ` · updated ${new Date(fetchedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST`}
          </span>
          {staleAgeSeconds !== null && (
            <span className="text-hold">Some tiles are up to {Math.max(1, Math.round(staleAgeSeconds / 60))} min old</span>
          )}
          {sources.length > 0 && <span>via {sources.join(' + ')}</span>}
        </div>
      </div>

      {/* Headline indices */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {loading && headline.length === 0
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-[92px]" />)
          : headline.map((q) => {
              const upMove = q.changePct >= 0
              return (
                <div key={q.symbol} className="panel p-4 fade-in">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="stat-label truncate">{q.name}</p>
                      <p className="text-xl font-bold text-ink mt-1">{formatPrice(q.price)}</p>
                      <p className={`mono-tabular text-xs font-semibold ${upMove ? 'text-up' : 'text-down'}`}>
                        {upMove ? '▲' : '▼'} {formatPrice(Math.abs(q.change), 2)} ({formatPct(q.changePct)})
                      </p>
                    </div>
                    {q.spark && q.spark.length > 1 && (
                      <span className="hidden sm:block">
                        <Sparkline values={q.spark} positive={upMove} width={84} height={34} />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
      </div>

      {errors.map((message) => (
        <p key={message} className="text-sm text-avoid bg-avoid-dim border border-avoid-dim rounded-xl px-4 py-2.5 mb-3">
          {message} It retries automatically every minute.
        </p>
      ))}

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label="Market">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={`chip !text-[13px] !px-4 !py-1.5 ${tab === t.id ? 'chip-active' : ''}`}
          >
            {t.label}
            <span className={`text-[10px] font-mono ${tab === t.id ? 'opacity-80' : 'text-ink-faint'}`}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {tab === 'equities' ? (
        <div className="grid xl:grid-cols-[1fr_300px] gap-5">
          <section className="panel p-4 sm:p-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="segmented" role="group" aria-label="View">
                <button onClick={() => setView('heatmap')} aria-pressed={view === 'heatmap'}>
                  Heatmap
                </button>
                <button onClick={() => setView('grid')} aria-pressed={view === 'grid'}>
                  Grid
                </button>
              </div>
              <HeatLegend scale="equity" />
            </div>

            {equities.length > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-[11px] font-mono mb-1.5">
                  <span className="text-up">▲ {breadth.up} advancing</span>
                  {breadth.flat > 0 && <span className="text-ink-faint">{breadth.flat} unchanged</span>}
                  <span className="text-down">{breadth.down} declining ▼</span>
                </div>
                <div
                  className="flex h-2 rounded-full overflow-hidden gap-[2px]"
                  role="img"
                  aria-label={`${breadth.up} advancing, ${breadth.down} declining`}
                >
                  <div style={{ flex: breadth.up, background: 'var(--buy)' }} />
                  {breadth.flat > 0 && <div style={{ flex: breadth.flat, background: 'var(--text-faint)' }} />}
                  <div style={{ flex: breadth.down, background: 'var(--avoid)' }} />
                </div>
              </div>
            )}

            {loading ? (
              <div className="skeleton h-[480px]" />
            ) : equities.length === 0 ? (
              <div className="py-16 text-center text-ink-muted">
                <p className="text-ink mb-1">No NIFTY 50 quotes right now</p>
                <p className="text-sm">Every provider was tried; this page retries every minute.</p>
              </div>
            ) : view === 'heatmap' ? (
              <MarketTreemap stocks={equities} />
            ) : (
              <>
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
                  {equitySectors.map((sector) => (
                    <button
                      key={sector}
                      onClick={() => setSectorFilter(sector)}
                      className={`chip ${sectorFilter === sector ? 'chip-active' : ''}`}
                    >
                      {sector}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {equityTiles.map((tile, i) => (
                    <HeatTile key={tile.key} tile={tile} scale="equity" index={i} />
                  ))}
                </div>
              </>
            )}
            {failed.length > 0 && (
              <details className="mt-3 text-[11px] text-ink-faint">
                <summary className="cursor-pointer">
                  {failed.length} instrument{failed.length === 1 ? '' : 's'} unavailable right now
                </summary>
                <p className="font-mono mt-1">{failed.join(', ')}</p>
              </details>
            )}
          </section>

          <aside className="panel p-4 sm:p-5 space-y-6">
            <MoverList title="Top gainers" items={movers.gainers} positive />
            <MoverList title="Top losers" items={movers.losers} positive={false} />
          </aside>
        </div>
      ) : (
        <section className="panel p-4 sm:p-5">
          <div className="flex justify-end mb-4">
            <HeatLegend scale={SCALE[tab]} />
          </div>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton h-28" />
              ))}
            </div>
          ) : active.length === 0 ? (
            <div className="py-16 text-center text-ink-muted">
              <p className="text-ink mb-1">No data for this market right now</p>
              <p className="text-sm">It refreshes automatically every minute.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {active.map((tile, i) => (
                <HeatTile key={tile.key} tile={tile} scale={SCALE[tab]} index={i} />
              ))}
            </div>
          )}
          {tab !== 'crypto' && failed.length > 0 && (
            <details className="mt-3 text-[11px] text-ink-faint">
              <summary className="cursor-pointer">Some instruments are unavailable right now</summary>
              <p className="font-mono mt-1">{failed.join(', ')}</p>
            </details>
          )}
        </section>
      )}
    </AppShell>
  )
}
