'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import PriceChart, { PriceTable, type ChartCandle, type ChartMode } from '@/components/charts/PriceChart'
import Sparkline from '@/components/charts/Sparkline'
import CompanyLogo from '@/components/stock/CompanyLogo'
import PerformanceBars from '@/components/stock/PerformanceBars'
import RangeBar from '@/components/stock/RangeBar'
import TechnicalPanel from '@/components/stock/TechnicalPanel'
import {
  formatCount,
  formatDateIST,
  formatINR,
  formatINRCompact,
  formatPct,
  formatPrice,
  formatRatio,
  formatRelative,
  nseSessionState,
} from '@/lib/format'
import type { StockProfile } from '@/lib/market/stockProfile'
import { RENAMED_SYMBOLS } from '@/lib/market/indianEquities'
import type { User } from '@supabase/supabase-js'

type Range = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'max'

const RANGES: { id: Range; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1m', label: '1M' },
  { id: '6m', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
  { id: 'max', label: 'Max' },
]

const SOURCE_NAMES: Record<string, string> = {
  tradingview: 'TradingView screener',
  upstox: 'Upstox',
  moneycontrol: 'Moneycontrol',
  groww: 'Groww',
  yahoo: 'Yahoo Finance',
}

interface History {
  candles: ChartCandle[]
  interval: string
  intraday: boolean
  ohlc: boolean
  previousClose: number | null
  source: string
  range: Range
}

interface Peer {
  symbol: string
  name: string
  sector: string
  price: number
  changePct: number
  spark?: number[]
}

interface NewsItem {
  title: string
  url: string
  source: string
  publishedAt: string | null
}

interface Suggestion {
  symbol: string
  name: string
  inNifty50: boolean
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-2.5 flex items-baseline justify-between gap-3 border-b border-border last:border-b-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-right">
        <span className="mono-tabular text-sm font-semibold text-ink">{value}</span>
        {hint && <span className="block text-[10px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  )
}

function Signed({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-faint">—</span>
  return (
    <span className={value >= 0 ? 'text-up' : 'text-down'}>
      {value >= 0 ? '▲' : '▼'} {formatPct(value)}
    </span>
  )
}

function MarginBar({ label, value }: { label: string; value: number | null }) {
  const width = value === null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-ink-muted">{label}</span>
        <span className="mono-tabular font-semibold text-ink">{value === null ? '—' : formatPct(value, { signed: false })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: 'var(--chart-1)' }} />
      </div>
    </div>
  )
}

export default function StockProfilePage({ params }: { params: { symbol: string } }) {
  const router = useRouter()
  const supabase = createClient()
  const symbol = decodeURIComponent(params.symbol).toUpperCase()
  // Arrived by way of a renamed symbol (see the redirect below): keep the note.
  const [renamedFrom, setRenamedFrom] = useState<StockProfile['renamed'] | null>(null)
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from')?.toUpperCase() ?? ''
    const rename = RENAMED_SYMBOLS[from]
    setRenamedFrom(rename && rename.to === symbol ? { from, to: rename.to, note: rename.note } : null)
  }, [symbol])

  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<StockProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  const [range, setRange] = useState<Range>('1y')
  const [mode, setMode] = useState<ChartMode>('area')
  const [overlays, setOverlays] = useState({ ma50: false, ma200: false })
  const [showTable, setShowTable] = useState(false)
  const [history, setHistory] = useState<History | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyAttempt, setHistoryAttempt] = useState(0)

  const [stockId, setStockId] = useState<string | null>(null)
  const [watched, setWatched] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)
  const [watchError, setWatchError] = useState<string | null>(null)

  const [peers, setPeers] = useState<Peer[]>([])
  const [news, setNews] = useState<NewsItem[] | null>(null)

  // Profile, session and watch state for this symbol.
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setSuggestions([])
    setProfile(null)

    async function load() {
      const [{ user }, response] = await Promise.all([
        getSessionUser(),
        fetch(`/api/stocks/quote?symbol=${encodeURIComponent(symbol)}`).catch(() => null),
      ])
      if (!active) return
      setUser(user)

      if (!response) {
        setError('Could not reach the server for this quote.')
        setLoading(false)
        return
      }
      const data = await response.json().catch(() => ({}))
      if (!active) return
      if (!response.ok) {
        setError(data.error || 'Quote unavailable')
        setSuggestions(data.suggestions || [])
        setLoading(false)
        return
      }

      const p = data as StockProfile
      // An old symbol from saved history: move to the one it trades under now.
      // The old symbol rides along so the page can still say why it moved.
      if (p.renamed && p.symbol !== symbol) {
        router.replace(`/stocks/${encodeURIComponent(p.symbol)}?from=${encodeURIComponent(symbol)}`)
      }
      setProfile(p)
      setLoading(false)

      if (user) {
        try {
          const { data: row } = await supabase.from('stocks').select('id').eq('symbol', p.symbol).maybeSingle()
          if (!active) return
          setStockId(row?.id ?? null)
          if (row?.id) {
            const { data: w } = await supabase
              .from('watchlists')
              .select('id')
              .eq('user_id', user.id)
              .eq('stock_id', row.id)
              .maybeSingle()
            if (active) setWatched(!!w)
          } else {
            setWatched(false)
          }
        } catch {
          // The watch button falls back to creating the row on demand.
        }
      }
    }
    load()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  // The chart's series. The previous render stays on screen (dimmed) while a
  // new range loads, so switching ranges never blanks the chart.
  useEffect(() => {
    let active = true
    setHistoryLoading(true)
    setHistoryError(null)
    fetch(`/api/stocks/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!active) return
        if (!ok) {
          setHistoryError(body.error || 'Price history unavailable')
          return
        }
        setHistory({
          candles: body.candles || [],
          interval: body.interval,
          intraday: !!body.intraday,
          ohlc: body.ohlc !== false,
          previousClose: body.previousClose ?? null,
          source: body.source,
          range,
        })
      })
      .catch(() => active && setHistoryError('Could not reach the server for price history.'))
      .finally(() => active && setHistoryLoading(false))
    return () => {
      active = false
    }
  }, [symbol, range, historyAttempt])

  // Same-sector constituents, and recent headlines — both secondary, both optional.
  useEffect(() => {
    if (!profile) return
    let active = true
    if (profile.sector) {
      fetch('/api/market/equities')
        .then((r) => (r.ok ? r.json() : { quotes: [] }))
        .then((data) => {
          if (!active) return
          setPeers(
            (data.quotes || [])
              .filter((q: Peer) => q.sector === profile.sector && q.symbol !== profile.symbol)
              .slice(0, 6)
          )
        })
        .catch(() => {})
    } else {
      setPeers([])
    }
    setNews(null)
    fetch(`/api/news/company?symbol=${encodeURIComponent(profile.symbol)}&name=${encodeURIComponent(profile.name.replace(/\s*\(.*\)$/, ''))}`)
      .then((r) => r.json())
      .then((data) => active && setNews(data.items || []))
      .catch(() => active && setNews([]))
    return () => {
      active = false
    }
  }, [profile])

  async function toggleWatch() {
    if (!profile) return
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(`/stocks/${profile.symbol}`)}`)
      return
    }
    setWatchBusy(true)
    setWatchError(null)
    try {
      let id = stockId
      if (!id) {
        const response = await fetch('/api/stocks/ensure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: profile.symbol }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !body.id) throw new Error(body.error || 'Could not add this stock')
        id = body.id as string
        setStockId(id)
      }
      if (watched) {
        const { error } = await supabase.from('watchlists').delete().eq('user_id', user.id).eq('stock_id', id)
        if (error) throw error
        setWatched(false)
      } else {
        const { error } = await supabase.from('watchlists').insert({ user_id: user.id, stock_id: id })
        if (error && !/duplicate/i.test(error.message)) throw error
        setWatched(true)
      }
    } catch (err: any) {
      setWatchError(err?.message || 'Watchlist update failed')
    } finally {
      setWatchBusy(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const period = useMemo(() => {
    if (!history || history.candles.length < 2) return null
    const first = history.range === '1d' && history.previousClose ? history.previousClose : history.candles[0].c
    const last = history.candles[history.candles.length - 1].c
    // Name the span the data actually covers. A provider can return less
    // history than the range asked for (a recent listing, or a short feed),
    // and labelling two months of bars "over 1Y" misstates the return.
    const startedAt = history.candles[0].t
    const now = Date.now()
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
    const DAY = 86_400_000
    const expectedStart: Record<string, number | null> = {
      '1d': null,
      '5d': now - 9 * DAY,
      '1m': now - 31 * DAY,
      '6m': now - 183 * DAY,
      ytd: yearStart,
      '1y': now - 366 * DAY,
      '5y': now - 5 * 366 * DAY,
      max: null,
    }
    const expected = expectedStart[history.range] ?? null
    const span = expected === null ? 0 : now - expected
    const short = history.range === 'max' || (expected !== null && startedAt - expected > Math.max(7 * DAY, span * 0.2))
    const label =
      history.range === '1d'
        ? 'vs previous close'
        : short
          ? `since ${formatDateIST(startedAt)}`
          : `over ${RANGES.find((r) => r.id === history.range)?.label}`
    return { from: first, to: last, pct: first ? ((last - first) / first) * 100 : 0, label }
  }, [history])

  // The last request failed, for the range now selected: whatever chart is in
  // memory belongs to a different range and must not be shown as this one.
  const rangeFailed = Boolean(historyError) && !historyLoading && (!history || history.range !== range)

  const session = nseSessionState()
  const up = (profile?.changePct ?? 0) >= 0
  const canCandle = history?.ohlc !== false
  const maAvailable = history && !history.intraday

  // Hide overlays that cannot be drawn on this range rather than drawing nothing.
  const effectiveOverlays = maAvailable ? overlays : { ma50: false, ma200: false }

  const chartRef = useRef<HTMLDivElement>(null)

  return (
    <AppShell userEmail={user?.email} onLogout={user ? handleLogout : undefined} showTicker={false}>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-ink-faint mb-5" aria-label="Breadcrumb">
        <Link href="/markets" className="hover:text-ink transition">Markets</Link>
        <span aria-hidden="true">›</span>
        {profile?.inNifty50 ? (
          <>
            <Link href="/markets" className="hover:text-ink transition">NIFTY 50</Link>
            <span aria-hidden="true">›</span>
          </>
        ) : null}
        <span className="text-ink-muted">{profile?.symbol ?? symbol}</span>
      </nav>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-40" />
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="skeleton h-96 lg:col-span-2" />
            <div className="skeleton h-96" />
          </div>
        </div>
      ) : error ? (
        <div className="panel p-10 text-center fade-in">
          <p className="text-4xl mb-3" aria-hidden="true">🔎</p>
          <h1 className="text-xl font-bold text-ink mb-2">{error}</h1>
          {suggestions.length > 0 ? (
            <>
              <p className="text-sm text-ink-muted mb-5">Did you mean one of these?</p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <Link key={s.symbol} href={`/stocks/${encodeURIComponent(s.symbol)}`} className="chip">
                    <span className="font-mono font-bold text-ink">{s.symbol}</span>
                    <span className="text-ink-faint">{s.name}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Try the search in the header — it covers every NSE-listed company.</p>
          )}
        </div>
      ) : profile ? (
        <>
          {(profile.renamed ?? renamedFrom) && (
            <p className="text-xs text-ink-muted bg-surface-2 border border-border rounded-xl px-4 py-2.5 mb-4">
              <span className="font-semibold text-ink">{(profile.renamed ?? renamedFrom)!.from}</span> now trades as{' '}
              <span className="font-semibold text-ink">{(profile.renamed ?? renamedFrom)!.to}</span>.{' '}
              {(profile.renamed ?? renamedFrom)!.note}
            </p>
          )}

          {/* ── Header ─────────────────────────────────────────────── */}
          <section className="panel p-5 sm:p-7 mb-5 fade-in">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                <CompanyLogo name={profile.name} symbol={profile.symbol} url={profile.logoUrl} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h1 className="text-2xl sm:text-3xl font-bold text-ink tracking-tight">{profile.name}</h1>
                    {profile.inNifty50 && (
                      <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border border-accent-dim text-accent">NIFTY 50</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">
                    <span className="font-mono text-ink">NSE: {profile.symbol}</span>
                    {profile.industry ? ` · ${profile.industry}` : ''}
                    {profile.sector && profile.sector !== profile.industry ? ` · ${profile.sector}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button onClick={toggleWatch} disabled={watchBusy} className={watched ? 'btn btn-ghost' : 'btn btn-primary'}>
                  {watchBusy ? 'Saving…' : watched ? '✓ On your watchlist' : user ? '+ Add to watchlist' : 'Sign in to watch'}
                </button>
                <Link href={`/analyze?event=${encodeURIComponent(`${profile.name.replace(/\s*\(.*\)$/, '')}: `)}`} className="btn btn-ghost">
                  ⚡ Analyse an event
                </Link>
              </div>
            </div>
            {watchError && <p className="text-xs text-avoid mt-3">{watchError}</p>}

            <div className="mt-6 flex flex-col md:flex-row md:items-end gap-6 md:gap-10">
              <div>
                <p className="text-4xl sm:text-5xl font-bold text-ink tracking-tight">{formatINR(profile.price)}</p>
                <p className={`mono-tabular text-base font-semibold mt-1 ${up ? 'text-up' : 'text-down'}`}>
                  {up ? '▲' : '▼'} {profile.change !== null ? formatPrice(Math.abs(profile.change), 2) : '—'} ({formatPct(profile.changePct)}){' '}
                  <span className="text-ink-faint font-normal text-sm">today</span>
                </p>
                <p className="text-[11px] text-ink-faint mt-1.5 flex items-center gap-1.5">
                  {session.open && <span className="live-dot" aria-hidden="true" />}
                  {session.label} · via {SOURCE_NAMES[profile.source] ?? profile.source}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 flex-1 max-w-2xl">
                <RangeBar label="Day range" low={profile.dayLow} high={profile.dayHigh} value={profile.price} />
                <RangeBar label="52-week range" low={profile.week52Low} high={profile.week52High} value={profile.price} />
              </div>
            </div>
            {profile.notes.length > 0 && (
              <p className="text-[11px] text-hold bg-hold-dim rounded-lg px-3 py-2 mt-5">{profile.notes.join(' · ')}</p>
            )}
          </section>

          {/* ── Chart + key statistics ─────────────────────────────── */}
          <div className="grid lg:grid-cols-3 gap-5 mb-5">
            <section className="panel p-4 sm:p-6 lg:col-span-2 fade-in" ref={chartRef}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="segmented overflow-x-auto scrollbar-none max-w-full" role="group" aria-label="Chart range">
                  {RANGES.map((r) => (
                    <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="segmented" role="group" aria-label="Chart style">
                    <button onClick={() => setMode('area')} aria-pressed={mode === 'area' || !canCandle}>Line</button>
                    <button onClick={() => setMode('candle')} aria-pressed={mode === 'candle' && canCandle} disabled={!canCandle} title={canCandle ? undefined : 'This source gave closing prices only'}>
                      Candles
                    </button>
                  </div>
                  <button
                    className="chip"
                    aria-pressed={showTable}
                    onClick={() => setShowTable((v) => !v)}
                    title="Show the chart's data as a table"
                  >
                    Table
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
                {period && !rangeFailed && (
                  <p className="text-sm">
                    <span className={`mono-tabular font-semibold ${period.pct >= 0 ? 'text-up' : 'text-down'}`}>
                      {period.pct >= 0 ? '▲' : '▼'} {formatPct(period.pct)}
                    </span>{' '}
                    <span className="text-ink-faint text-xs">
                      {period.label} · {formatPrice(period.from)} →{' '}
                      {formatPrice(period.to)}
                    </span>
                  </p>
                )}
                {maAvailable && (
                  <div className="flex items-center gap-2" role="group" aria-label="Moving averages">
                    {(
                      [
                        ['ma50', 'MA 50', 'var(--chart-2)'],
                        ['ma200', 'MA 200', 'var(--chart-3)'],
                      ] as const
                    ).map(([key, label, color]) => (
                      <button
                        key={key}
                        className="chip"
                        aria-pressed={overlays[key]}
                        onClick={() => setOverlays((o) => ({ ...o, [key]: !o[key] }))}
                      >
                        <span className="inline-block w-3 h-0.5 rounded" style={{ background: color }} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Legend: only when more than one series is on the chart. */}
              {(effectiveOverlays.ma50 || effectiveOverlays.ma200) && (
                <div className="flex items-center gap-4 text-[11px] text-ink-muted mb-2">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 rounded" style={{ background: 'var(--chart-1)' }} /> Price
                  </span>
                  {effectiveOverlays.ma50 && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-0.5 rounded" style={{ background: 'var(--chart-2)' }} /> 50-bar average
                    </span>
                  )}
                  {effectiveOverlays.ma200 && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-0.5 rounded" style={{ background: 'var(--chart-3)' }} /> 200-bar average
                    </span>
                  )}
                </div>
              )}

              {rangeFailed ? (
                // The range the reader picked failed. Keeping the previous
                // range's chart under the new range's highlighted button
                // presented, say, a month of daily bars as the 1D chart.
                <div className="h-72 flex flex-col items-center justify-center text-center gap-2">
                  <p className="text-sm text-ink">
                    No {RANGES.find((r) => r.id === range)?.label} chart for {profile.symbol} right now
                  </p>
                  <p className="text-xs text-ink-faint max-w-sm" title={historyError ?? undefined}>
                    None of the price providers returned bars for this range just now.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    <button onClick={() => setHistoryAttempt((n) => n + 1)} className="btn btn-ghost text-xs">
                      Try again
                    </button>
                    {history && (
                      <button onClick={() => setRange(history.range)} className="btn btn-ghost text-xs">
                        Show {RANGES.find((r) => r.id === history.range)?.label} instead
                      </button>
                    )}
                  </div>
                </div>
              ) : !history ? (
                <div className="skeleton h-80" />
              ) : showTable ? (
                <PriceTable candles={history.candles} intraday={history.intraday} range={history.range} />
              ) : (
                <PriceChart
                  candles={history.candles}
                  range={history.range}
                  intraday={history.intraday}
                  mode={canCandle ? mode : 'area'}
                  previousClose={history.previousClose}
                  overlays={effectiveOverlays}
                  loading={historyLoading}
                  ohlc={history.ohlc}
                />
              )}
              {history && !rangeFailed && (
                <p className="text-[10px] text-ink-faint mt-3">
                  {history.interval} bars · times in IST · via {SOURCE_NAMES[history.source] ?? history.source}
                </p>
              )}
            </section>

            <section className="panel p-5 sm:p-6 fade-in">
              <h2 className="text-sm font-bold text-ink mb-2">Key statistics</h2>
              <dl>
                <Stat label="Market cap" value={formatINRCompact(profile.marketCap)} />
                <Stat label="P/E (TTM)" value={formatRatio(profile.peRatio, 1)} />
                <Stat label="EPS (TTM)" value={formatINR(profile.eps)} />
                <Stat label="Price / book" value={formatRatio(profile.pbRatio)} />
                <Stat label="Dividend yield" value={profile.dividendYieldPct === null ? '—' : formatPct(profile.dividendYieldPct, { signed: false })} />
                <Stat label="Beta (1Y)" value={formatRatio(profile.beta)} />
                <Stat label="Open" value={formatPrice(profile.open)} />
                <Stat label="Previous close" value={formatPrice(profile.previousClose)} />
                <Stat
                  label="Volume"
                  value={formatCount(profile.volume)}
                  hint={profile.relativeVolume !== null ? `${profile.relativeVolume.toFixed(2)}× the 10-day average` : undefined}
                />
                <Stat label="Avg volume (10D)" value={formatCount(profile.avgVolume10d)} />
              </dl>
            </section>
          </div>

          {/* ── Performance + technicals ───────────────────────────── */}
          <div className="grid lg:grid-cols-3 gap-5 mb-5">
            <section className="panel p-5 sm:p-6 fade-in">
              <h2 className="text-sm font-bold text-ink mb-1">Performance</h2>
              <p className="text-xs text-ink-faint mb-4">Price return over each period.</p>
              <PerformanceBars
                rows={[
                  { label: '1W', value: profile.performance.w1 },
                  { label: '1M', value: profile.performance.m1 },
                  { label: '3M', value: profile.performance.m3 },
                  { label: '6M', value: profile.performance.m6 },
                  { label: 'YTD', value: profile.performance.ytd },
                  { label: '1Y', value: profile.performance.y1 },
                  { label: '5Y', value: profile.performance.y5 },
                ]}
              />
            </section>
            <section className="panel p-5 sm:p-6 lg:col-span-2 fade-in">
              <h2 className="text-sm font-bold text-ink mb-4">Technicals</h2>
              <TechnicalPanel
                price={profile.price}
                rsi14={profile.rsi14}
                sma20={profile.sma20}
                sma50={profile.sma50}
                sma200={profile.sma200}
                macd={profile.macd}
                macdSignal={profile.macdSignal}
                adx={profile.adx}
                rating={profile.technicalRating}
              />
            </section>
          </div>

          {/* ── Financials + company ───────────────────────────────── */}
          <div className="grid lg:grid-cols-3 gap-5 mb-5">
            <section className="panel p-5 sm:p-6 lg:col-span-2 fade-in">
              <h2 className="text-sm font-bold text-ink mb-1">Financials</h2>
              <p className="text-xs text-ink-faint mb-5">Trailing twelve months, as last reported by the company.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  ['Revenue', profile.revenueTtm],
                  ['Net income', profile.netIncomeTtm],
                  ['EBITDA', profile.ebitdaTtm],
                  ['Free cash flow', profile.freeCashFlowTtm],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border border-border p-3.5">
                    <p className="stat-label mb-1.5">{label}</p>
                    <p className="text-lg font-bold text-ink">{formatINRCompact(value as number | null)}</p>
                  </div>
                ))}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-ink">Margins</p>
                  <MarginBar label="Gross margin" value={profile.grossMarginPct} />
                  <MarginBar label="Operating margin" value={profile.operatingMarginPct} />
                  <MarginBar label="Net margin" value={profile.netMarginPct} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink mb-2">Growth, returns and leverage</p>
                  <dl className="text-xs">
                    {[
                      ['Revenue growth (YoY)', <Signed key="r" value={profile.revenueGrowthPct} />],
                      ['Net income growth (YoY)', <Signed key="n" value={profile.netIncomeGrowthPct} />],
                      ['EPS growth (YoY)', <Signed key="e" value={profile.epsGrowthPct} />],
                      ['Return on equity', profile.roePct === null ? '—' : formatPct(profile.roePct, { signed: false })],
                      ['Return on assets', profile.roaPct === null ? '—' : formatPct(profile.roaPct, { signed: false })],
                      ['Debt / equity', formatRatio(profile.debtToEquity)],
                      ['Current ratio', formatRatio(profile.currentRatio)],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between py-1.5 border-b border-border last:border-b-0">
                        <dt className="text-ink-muted">{label}</dt>
                        <dd className="mono-tabular font-semibold text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </section>

            <section className="panel p-5 sm:p-6 fade-in">
              <h2 className="text-sm font-bold text-ink mb-3">Company</h2>
              <dl className="text-xs">
                {[
                  ['Exchange', `NSE · ${profile.symbol}`],
                  ['ISIN', profile.isin ?? '—'],
                  ['Industry', profile.industry ?? '—'],
                  ['Analysis sector', profile.sector ?? 'Not in the NIFTY 50 universe'],
                  ['Employees', profile.employees ? profile.employees.toLocaleString('en-IN') : '—'],
                  ['Shares outstanding', formatCount(profile.sharesOutstanding)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 py-2 border-b border-border last:border-b-0">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="text-ink text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 rounded-xl border border-accent-dim bg-surface-2 p-4">
                <p className="stat-label mb-1">Next results</p>
                {profile.nextEarnings ? (
                  <>
                    <p className="text-base font-bold text-ink">{formatDateIST(Date.parse(profile.nextEarnings))}</p>
                    <p className="text-[11px] text-ink-faint">
                      {(() => {
                        const days = Math.ceil((Date.parse(profile.nextEarnings) - Date.now()) / 86_400_000)
                        return days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : days === 0 ? 'today' : 'date passed'
                      })()}
                      {profile.lastEarnings ? ` · last reported ${formatDateIST(Date.parse(profile.lastEarnings))}` : ''}
                    </p>
                    <Link
                      href={`/analyze?event=${encodeURIComponent(`${profile.name.replace(/\s*\(.*\)$/, '')} quarterly results: `)}`}
                      className="text-xs text-accent font-semibold hover:underline mt-2 inline-block"
                    >
                      Analyse a results scenario →
                    </Link>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">No date announced yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* ── Peers + news ───────────────────────────────────────── */}
          <div className="grid lg:grid-cols-3 gap-5">
            {peers.length > 0 && (
              <section className="panel p-5 sm:p-6 fade-in">
                <h2 className="text-sm font-bold text-ink mb-1">{profile.sector} peers</h2>
                <p className="text-xs text-ink-faint mb-3">Other NIFTY 50 companies the analysis engine groups with this one.</p>
                <ul>
                  {peers.map((p) => (
                    <li key={p.symbol}>
                      <Link
                        href={`/stocks/${encodeURIComponent(p.symbol)}`}
                        className="flex items-center gap-3 py-2.5 border-b border-border last:border-b-0 hover:bg-surface-hover -mx-2 px-2 rounded-lg transition"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-ink truncate">{p.name}</span>
                          <span className="block text-[11px] font-mono text-ink-faint">{p.symbol}</span>
                        </span>
                        {p.spark && p.spark.length > 1 && <Sparkline values={p.spark} positive={p.changePct >= 0} width={56} height={22} />}
                        <span className="text-right">
                          <span className="block mono-tabular text-sm text-ink">{formatPrice(p.price)}</span>
                          <span className={`block mono-tabular text-[11px] font-semibold ${p.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                            {p.changePct >= 0 ? '▲' : '▼'} {formatPct(p.changePct)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className={`panel p-5 sm:p-6 fade-in ${peers.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-bold text-ink mb-3">Latest news</h2>
              {news === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-12" />
                  ))}
                </div>
              ) : news.length === 0 ? (
                <p className="text-sm text-ink-muted">No headlines about {profile.name} in the last week.</p>
              ) : (
                <ul>
                  {news.map((n) => (
                    <li key={n.url} className="py-2.5 border-b border-border last:border-b-0">
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm text-ink hover:text-accent transition leading-snug">
                        {n.title}
                      </a>
                      <p className="text-[11px] text-ink-faint mt-0.5">
                        {n.source}
                        {n.publishedAt ? ` · ${formatRelative(n.publishedAt)}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
