'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import BackendDownNotice from '@/components/BackendDownNotice'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import AppShell from '@/components/layout/AppShell'
import RecommendationBadge from '@/components/ui/RecommendationBadge'
import ScoreChip from '@/components/ui/ScoreChip'
import Sparkline from '@/components/charts/Sparkline'
import { formatPct, formatPrice, formatRelative, nseSessionState } from '@/lib/format'
import { heatColor, heatInk, type HeatStep } from '@/lib/heat'
import type { MarketQuote } from '@/lib/market/types'

interface RecentAnalysis {
  id: string
  event_title: string
  recommendation: string | null
  opportunity_score: number | null
  created_at: string
}

interface SectorTilt {
  sector: string
  count: number
  buy: number
  hold: number
  avoid: number
  tilt: number // (buy - avoid) / count, -1..1
}

interface Mover {
  symbol: string
  name: string
  price: number
  changePct: number
}

interface WatchRow {
  symbol: string
  name: string
  price: number | null
  changePct: number | null
}

const INDEX_CARDS = ['^NSEI', '^BSESN', '^NSEBANK', '^CNXIT']

function greeting(): string {
  const hour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** A sector's net lean, -1 (all AVOID) … +1 (all BUY), bucketed onto the heat scale. */
function tiltStep(tilt: number): HeatStep {
  const m = Math.abs(tilt)
  const magnitude = m < 0.15 ? 0 : m < 0.4 ? 1 : m < 0.75 ? 2 : 3
  return (tilt < 0 ? -magnitude : magnitude) as HeatStep
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [recent, setRecent] = useState<RecentAnalysis[]>([])
  const [stats, setStats] = useState({ total: 0, buy: 0, hold: 0, avoid: 0, unrated: 0, avgScore: 0 })
  const [sectorTilts, setSectorTilts] = useState<SectorTilt[]>([])
  const [trackRecord, setTrackRecord] = useState<{
    total: number
    positive: number
    byRec: Record<string, { count: number; positive: number }>
  } | null>(null)
  const [indices, setIndices] = useState<MarketQuote[]>([])
  const [movers, setMovers] = useState<{ gainers: Mover[]; losers: Mover[] } | null>(null)
  const [watch, setWatch] = useState<WatchRow[] | null>(null)
  const [eventText, setEventText] = useState('')
  const router = useRouter()
  const [backendDown, setBackendDown] = useState(false)
  const supabase = createClient()

  // Market context: public data, loaded in parallel with the user's own.
  useEffect(() => {
    let active = true
    fetch('/api/market/live')
      .then((r) => (r.ok ? r.json() : { quotes: [] }))
      .then((data) => {
        if (!active) return
        const bySymbol = new Map((data.quotes || []).map((q: MarketQuote) => [q.symbol, q]))
        setIndices(INDEX_CARDS.map((s) => bySymbol.get(s)).filter(Boolean) as MarketQuote[])
      })
      .catch(() => {})
    fetch('/api/market/equities')
      .then((r) => (r.ok ? r.json() : { quotes: [] }))
      .then((data) => {
        if (!active) return
        const sorted = [...(data.quotes || [])].sort((a: Mover, b: Mover) => b.changePct - a.changePct)
        if (sorted.length) setMovers({ gainers: sorted.slice(0, 3), losers: sorted.slice(-3).reverse() })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const getUser = async () => {
      const { user: sessionUser, backendDown: down } = await getSessionUser()
      if (down) {
        setBackendDown(true)
        return
      }
      if (!sessionUser) {
        router.push('/auth/login')
        return
      }
      setUser(sessionUser)

      const { data } = await supabase
        .from('event_analysis')
        .select('id, event_title, recommendation, opportunity_score, affected_sectors, created_at')
        .eq('user_id', sessionUser.id)
        .order('created_at', { ascending: false })
        .limit(100)

      const all = data || []
      setRecent(all.slice(0, 6))

      const buy = all.filter((r) => r.recommendation === 'BUY').length
      const hold = all.filter((r) => r.recommendation === 'HOLD').length
      const avoid = all.filter((r) => r.recommendation === 'AVOID').length
      const scored = all.filter((r) => typeof r.opportunity_score === 'number')
      const avgScore = scored.length ? scored.reduce((sum, r) => sum + (r.opportunity_score || 0), 0) / scored.length : 0
      setStats({ total: all.length, buy, hold, avoid, unrated: all.length - buy - hold - avoid, avgScore })

      // Sector tilt: every sector an analysis touched, credited with that
      // analysis's overall recommendation — reuses the rows fetched above.
      const bySector = new Map<string, { count: number; buy: number; hold: number; avoid: number }>()
      for (const r of all) {
        for (const sector of r.affected_sectors || []) {
          const entry = bySector.get(sector) || { count: 0, buy: 0, hold: 0, avoid: 0 }
          entry.count++
          if (r.recommendation === 'BUY') entry.buy++
          else if (r.recommendation === 'HOLD') entry.hold++
          else if (r.recommendation === 'AVOID') entry.avoid++
          bySector.set(sector, entry)
        }
      }
      setSectorTilts(
        Array.from(bySector.entries())
          .map(([sector, v]) => ({ sector, ...v, tilt: v.count ? (v.buy - v.avoid) / v.count : 0 }))
          .sort((a, b) => b.count - a.count)
      )

      // Watchlist snapshot and the paper portfolio's track record, both
      // marked to live prices in one request.
      const [{ data: watched }, { data: positions }] = await Promise.all([
        supabase.from('watchlists').select('stocks(symbol, name)').eq('user_id', sessionUser.id).limit(6),
        supabase.from('portfolio_positions').select('symbol, recommendation, entry_price').eq('user_id', sessionUser.id),
      ])
      const watchedStocks = (watched || [])
        .map((w: any) => w.stocks)
        .filter(Boolean) as { symbol: string; name: string }[]
      const symbols = Array.from(new Set([...watchedStocks.map((s) => s.symbol), ...(positions || []).map((p: any) => p.symbol)]))

      let prices: Record<string, { price: number; changePct: number }> = {}
      if (symbols.length > 0) {
        try {
          const response = await fetch(`/api/stocks/prices?symbols=${encodeURIComponent(symbols.join(','))}`)
          if (response.ok) prices = (await response.json()).prices || {}
        } catch {
          // Rows then show as unpriced rather than as zero.
        }
      }

      setWatch(
        watchedStocks.map((s) => ({
          symbol: s.symbol,
          name: s.name,
          price: prices[s.symbol]?.price ?? null,
          changePct: prices[s.symbol]?.changePct ?? null,
        }))
      )

      if (positions && positions.length > 0) {
        // Whether each call went the way it said, at today's market price:
        // a BUY is right if the price rose, an AVOID if it fell, a HOLD if it
        // stayed within 3%. Positions without a live price are left out of
        // the record rather than counted either way.
        const byRec: Record<string, { count: number; positive: number }> = {}
        let positive = 0
        let priced = 0
        for (const p of positions) {
          const current = prices[p.symbol]?.price
          if (current === undefined || !p.entry_price) continue
          priced++
          const move = (current - p.entry_price) / p.entry_price
          const rec = p.recommendation || 'UNKNOWN'
          const right = rec === 'BUY' ? move >= 0 : rec === 'AVOID' ? move < 0 : Math.abs(move) <= 0.03
          if (right) positive++
          const entry = byRec[rec] || { count: 0, positive: 0 }
          entry.count++
          if (right) entry.positive++
          byRec[rec] = entry
        }
        if (priced > 0) setTrackRecord({ total: priced, positive, byRec })
      }

      setLoading(false)
    }
    getUser()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const session = nseSessionState()
  const name = useMemo(() => {
    // The first name from the profile (set at signup or in Settings), then
    // the email's local part as a fallback.
    const fullName = String(user?.user_metadata?.full_name ?? '').trim()
    if (fullName) return fullName.split(/\s+/)[0]
    const local = user?.email?.split('@')[0] || ''
    return local ? local[0].toUpperCase() + local.slice(1) : ''
  }, [user])

  if (backendDown) {
    return (
      <AppShell showTicker={false}>
        <BackendDownNotice feature="Your dashboard" />
      </AppShell>
    )
  }

  const recTotal = Math.max(1, stats.buy + stats.hold + stats.avoid + stats.unrated)

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout}>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden panel p-6 sm:p-8 mb-6 fade-in">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 80% at 100% 0%, var(--aurora-2), transparent 70%), radial-gradient(ellipse 50% 70% at 0% 100%, var(--aurora-1), transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="relative grid lg:grid-cols-[1fr_minmax(0,460px)] gap-6 items-center">
          <div>
            <p className="eyebrow mb-2 flex items-center gap-2">
              {session.open && <span className="live-dot" aria-hidden="true" />}
              {session.label}
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-ink tracking-tight">
              {greeting()}
              {name ? `, ${name}` : ''}
            </h1>
            <p className="text-ink-muted text-sm mt-2 max-w-lg">
              Something moved the market? Describe it, and PULSE traces it from the economy to the sectors and
              companies it reaches — with the case for and against.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (eventText.trim()) router.push(`/analyze?event=${encodeURIComponent(eventText.trim())}`)
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
              placeholder="e.g. RBI cuts repo rate by 25 bps"
              className="input !py-3"
              aria-label="Describe a market event"
            />
            <button type="submit" className="btn btn-primary !py-3" disabled={!eventText.trim()}>
              ⚡ Analyse
            </button>
          </form>
        </div>
      </section>

      {/* ── Market pulse ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {indices.length === 0
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-[104px]" />)
          : indices.map((q) => {
              const upMove = q.changePct >= 0
              return (
                <Link key={q.symbol} href="/markets?tab=india" className="panel p-4 tile-hover fade-in block">
                  <p className="stat-label">{q.name}</p>
                  <div className="flex items-end justify-between gap-2 mt-1">
                    <div className="min-w-0">
                      <p className="text-xl font-bold text-ink">{formatPrice(q.price)}</p>
                      <p className={`mono-tabular text-xs font-semibold ${upMove ? 'text-up' : 'text-down'}`}>
                        {upMove ? '▲' : '▼'} {formatPct(q.changePct)}
                      </p>
                    </div>
                    {q.spark && q.spark.length > 1 && (
                      <span className="hidden sm:block">
                        <Sparkline values={q.spark} positive={upMove} width={90} height={36} />
                      </span>
                    )}
                  </div>
                </Link>
              )
            })}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        {/* ── Your activity ───────────────────────────────────── */}
        <section className="panel p-5 sm:p-6 lg:col-span-2 fade-in">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-ink">Your activity</h2>
            <Link href="/history" className="text-xs font-semibold text-accent hover:underline">
              Full history →
            </Link>
          </div>
          {loading ? (
            <div className="skeleton h-40" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  ['Events analysed', String(stats.total), 'text-ink'],
                  ['Avg. opportunity', stats.total ? stats.avgScore.toFixed(0) : '—', 'text-accent'],
                  ['BUY calls', String(stats.buy), 'text-up'],
                  ['AVOID calls', String(stats.avoid), 'text-down'],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-xl border border-border p-3.5">
                    <p className="stat-label mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>
              {stats.total > 0 && (
                <div>
                  <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Share of calls by recommendation">
                    {stats.buy > 0 && <div style={{ flex: stats.buy, background: 'var(--buy)' }} />}
                    {stats.hold > 0 && <div style={{ flex: stats.hold, background: 'var(--hold)' }} />}
                    {stats.avoid > 0 && <div style={{ flex: stats.avoid, background: 'var(--avoid)' }} />}
                    {stats.unrated > 0 && <div style={{ flex: stats.unrated, background: 'var(--text-faint)' }} />}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-muted">
                    {(
                      [
                        ['BUY', stats.buy, 'var(--buy)'],
                        ['HOLD', stats.hold, 'var(--hold)'],
                        ['AVOID', stats.avoid, 'var(--avoid)'],
                        ['UNRATED', stats.unrated, 'var(--text-faint)'],
                      ] as const
                    )
                      .filter(([, n]) => n > 0)
                      .map(([label, n, color]) => (
                        <span key={label} className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />
                          {label} {n} ({Math.round((n / recTotal) * 100)}%)
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="mt-6">
                <p className="stat-label mb-2">Recent analyses</p>
                {recent.length === 0 ? (
                  <p className="text-ink-muted text-sm py-3">
                    No analyses yet —{' '}
                    <Link href="/analyze" className="text-accent hover:underline">
                      analyse your first event
                    </Link>
                    .
                  </p>
                ) : (
                  <ul>
                    {recent.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/events/${r.id}`}
                          className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-b-0 hover:bg-surface-hover -mx-2 px-2 rounded-lg transition"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm text-ink truncate">{r.event_title}</span>
                            <span className="block text-[11px] text-ink-faint">{formatRelative(r.created_at)}</span>
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <ScoreChip score={r.opportunity_score} size="sm" />
                            <RecommendationBadge rec={r.recommendation} size="sm" />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>

        {/* ── Movers ──────────────────────────────────────────── */}
        <section className="panel p-5 sm:p-6 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">NIFTY 50 movers</h2>
            <Link href="/markets" className="text-xs font-semibold text-accent hover:underline">
              Heatmap →
            </Link>
          </div>
          {!movers ? (
            <div className="skeleton h-56" />
          ) : (
            (['gainers', 'losers'] as const).map((key) => (
              <div key={key} className="mb-4 last:mb-0">
                <p className="stat-label mb-1.5">{key === 'gainers' ? 'Top gainers' : 'Top losers'}</p>
                {movers[key].map((m) => (
                  <Link
                    key={m.symbol}
                    href={`/stocks/${encodeURIComponent(m.symbol)}`}
                    className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-hover -mx-2 px-2 rounded-lg transition"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink truncate">{m.name}</span>
                      <span className="block text-[11px] font-mono text-ink-faint">{m.symbol}</span>
                    </span>
                    <span className={`mono-tabular text-sm font-semibold ${m.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                      {m.changePct >= 0 ? '▲' : '▼'} {formatPct(m.changePct)}
                    </span>
                  </Link>
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        {/* ── Watchlist snapshot ──────────────────────────────── */}
        <section className="panel p-5 sm:p-6 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-ink">Watchlist</h2>
            <Link href="/watchlist" className="text-xs font-semibold text-accent hover:underline">
              Manage →
            </Link>
          </div>
          {watch === null ? (
            <div className="skeleton h-40" />
          ) : watch.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing tracked yet. Search any company with <kbd className="font-mono text-[11px] border border-border rounded px-1">/</kbd> and
              add it from its page.
            </p>
          ) : (
            <ul>
              {watch.map((w) => (
                <li key={w.symbol}>
                  <Link
                    href={`/stocks/${encodeURIComponent(w.symbol)}`}
                    className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-hover -mx-2 px-2 rounded-lg transition"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink truncate">{w.name}</span>
                      <span className="block text-[11px] font-mono text-ink-faint">{w.symbol}</span>
                    </span>
                    <span className="text-right">
                      <span className="block mono-tabular text-sm text-ink">{formatPrice(w.price)}</span>
                      {w.changePct !== null && (
                        <span className={`block mono-tabular text-[11px] font-semibold ${w.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                          {w.changePct >= 0 ? '▲' : '▼'} {formatPct(w.changePct)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Sector tilt ─────────────────────────────────────── */}
        <section className="panel p-5 sm:p-6 lg:col-span-2 fade-in">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-ink">Sector tilt</h2>
            <span className="text-[11px] text-ink-faint">From your analyses</span>
          </div>
          <p className="text-xs text-ink-faint mb-4">
            Each sector your analyses touched, coloured by whether the calls on it leaned BUY or AVOID.
          </p>
          {loading ? (
            <div className="skeleton h-32" />
          ) : sectorTilts.length === 0 ? (
            <p className="text-sm text-ink-muted">Analyse a few events and the sectors they reach will appear here.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {sectorTilts.map((s, idx) => {
                const step = tiltStep(s.tilt)
                return (
                  <div
                    key={s.sector}
                    style={{ background: heatColor(step), color: heatInk(step), animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                    className="fade-in rounded-xl p-3.5"
                  >
                    <p className="font-bold text-sm truncate" title={s.sector}>
                      {s.sector}
                    </p>
                    <p className="text-[10px] font-mono opacity-75">
                      {s.count} analys{s.count === 1 ? 'is' : 'es'}
                    </p>
                    <p className="mono-tabular text-[11px] font-semibold mt-1 opacity-90 flex flex-wrap gap-x-2">
                      <span className="whitespace-nowrap">{s.buy} BUY</span>
                      <span className="whitespace-nowrap">{s.hold} HOLD</span>
                      <span className="whitespace-nowrap">{s.avoid} AVOID</span>
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Track record ──────────────────────────────────────── */}
      {trackRecord && trackRecord.total > 0 && (
        <section className="panel p-5 sm:p-6 mb-6 fade-in">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-ink">Track record</h2>
            <Link href="/portfolio" className="text-xs font-semibold text-accent hover:underline">
              Portfolio →
            </Link>
          </div>
          <p className="text-xs text-ink-faint mb-4">
            Of {trackRecord.total} simulated position{trackRecord.total === 1 ? '' : 's'},{' '}
            <span className="font-semibold text-ink">
              {trackRecord.positive} ({Math.round((trackRecord.positive / trackRecord.total) * 100)}%)
            </span>{' '}
            moved the way the call said at today&apos;s prices — BUY calls up, AVOID calls down, HOLD calls within 3%.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['BUY', 'HOLD', 'AVOID'] as const).map((rec) => {
              const entry = trackRecord.byRec[rec]
              return (
                <div key={rec} className="rounded-xl border border-border p-4">
                  <RecommendationBadge rec={rec} size="sm" />
                  <p className="text-2xl font-bold text-ink mt-2">
                    {entry ? `${Math.round((entry.positive / entry.count) * 100)}%` : '—'}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {entry ? `${entry.positive} of ${entry.count} went the way of the call` : 'No positions'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="panel p-5 sm:p-6">
        <h2 className="text-base font-bold text-ink mb-4">How PULSE works</h2>
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { num: '01', title: 'Describe an event', desc: 'Paste a headline or write what happened in your own words.' },
            { num: '02', title: 'Classify it', desc: 'Event type, the economic variable it moves, direction and size.' },
            { num: '03', title: 'Score companies', desc: 'Live fundamentals, valuation, technicals and risk for each exposed stock.' },
            { num: '04', title: 'Weigh both sides', desc: 'A BUY / HOLD / AVOID view with the bull case, bear case and counter-evidence.' },
          ].map((item) => (
            <li key={item.num} className="flex gap-3">
              <span className="w-8 h-8 rounded-lg bg-surface-2 border border-border-bright flex items-center justify-center font-mono text-[11px] font-bold text-accent flex-shrink-0">
                {item.num}
              </span>
              <span>
                <span className="block font-semibold text-ink text-sm mb-0.5">{item.title}</span>
                <span className="block text-xs text-ink-muted leading-relaxed">{item.desc}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  )
}
