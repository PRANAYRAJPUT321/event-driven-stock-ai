'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/layout/AppShell'
import type { User } from '@supabase/supabase-js'

interface Quote {
  symbol: string
  name: string | null
  currency: string | null
  price: number | null
  changePct: number | null
  marketCap: number | null
  peRatio: number | null
  pbRatio: number | null
  dividendYield: number | null
  week52High: number | null
  week52Low: number | null
  analystRecommendationKey: string | null
  analystRecommendationMean: number | null
  analystCount: number | null
  targetMean: number | null
  targetHigh: number | null
  targetLow: number | null
  recommendationBreakdown: {
    strongBuy: number | null
    buy: number | null
    hold: number | null
    sell: number | null
    strongSell: number | null
  }
}

interface HistoryPoint {
  date: string
  close: number
}

const QUICK_SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK']

const RECOMMENDATION_STYLE: Record<string, string> = {
  strong_buy: 'text-buy bg-buy-dim border-buy-dim',
  buy: 'text-buy bg-buy-dim border-buy-dim',
  hold: 'text-hold bg-hold-dim border-hold-dim',
  sell: 'text-avoid bg-avoid-dim border-avoid-dim',
  strong_sell: 'text-avoid bg-avoid-dim border-avoid-dim',
}

function formatMarketCap(cap: number | null): string {
  if (!cap) return '—'
  if (cap >= 1e12) return `₹${(cap / 1e12).toFixed(2)}T`
  if (cap >= 1e9) return `₹${(cap / 1e9).toFixed(2)}B`
  if (cap >= 1e7) return `₹${(cap / 1e7).toFixed(2)}Cr`
  return `₹${cap.toFixed(0)}`
}

export default function StockProfile({ params }: { params: { symbol: string } }) {
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stockId, setStockId] = useState<string | null>(null)
  const [watched, setWatched] = useState(false)
  const [watching, setWatching] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const symbol = decodeURIComponent(params.symbol).toUpperCase()

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }
      setUser(user)

      // Look up whether this symbol exists in the scored universe, so we
      // know whether "Add to Watchlist" is possible (watchlists FK requires
      // a real stock_id — this profile page also works for tickers outside
      // that seeded set, since Yahoo Finance isn't limited to it).
      const [{ data: stockRow }, { data: watchRow }] = await Promise.all([
        supabase.from('stocks').select('id').eq('symbol', symbol).maybeSingle(),
        Promise.resolve({ data: null as any }),
      ])
      if (stockRow) {
        setStockId(stockRow.id)
        const { data: existingWatch } = await supabase
          .from('watchlists')
          .select('id')
          .eq('user_id', user.id)
          .eq('stock_id', stockRow.id)
          .maybeSingle()
        setWatched(!!existingWatch)
      } else {
        setStockId(null)
      }

      try {
        const [quoteRes, historyRes] = await Promise.all([
          fetch(`/api/py/stock-quote?symbol=${encodeURIComponent(symbol)}`),
          fetch(`/api/py/stock-history?symbol=${encodeURIComponent(symbol)}&range=6mo&interval=1d`),
        ])
        const quoteData = await quoteRes.json()
        const historyData = await historyRes.json()

        if (!quoteRes.ok) throw new Error(quoteData.error || 'Failed to fetch quote')
        if (!historyRes.ok) throw new Error(historyData.error || 'Failed to fetch price history')

        setQuote(quoteData)
        setHistory(historyData.points || [])
      } catch (err: any) {
        setError(err.message || 'Failed to load live stock data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [symbol])

  async function handleWatch() {
    if (!user || !stockId || watched) return
    setWatching(true)
    const { error } = await supabase.from('watchlists').insert({ user_id: user.id, stock_id: stockId })
    if (!error) setWatched(true)
    setWatching(false)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (searchInput.trim()) router.push(`/stocks/${encodeURIComponent(searchInput.trim().toUpperCase())}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const upside = quote?.price && quote?.targetMean ? ((quote.targetMean - quote.price) / quote.price) * 100 : null

  return (
    <AppShell userEmail={user?.email} onLogout={handleLogout} showTicker={false}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 fade-in">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">Live stock profile</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">{symbol}</h1>
          <p className="text-ink-muted text-sm">Real-time price, fundamentals, and analyst view via Yahoo Finance</p>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Look up a symbol…"
            className="w-40 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-dim focus:border-accent transition"
          />
          <button
            type="submit"
            className="bg-accent hover:bg-accent-bright text-[#0a0d14] font-semibold px-4 py-2 rounded-lg text-sm transition"
          >
            Go
          </button>
        </form>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {QUICK_SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => router.push(`/stocks/${s}`)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition ${
              s === symbol
                ? 'bg-accent text-[#0a0d14] border-accent'
                : 'bg-surface text-ink-muted border-border hover:border-border-bright'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-avoid-dim border border-avoid-dim text-avoid px-4 py-3 rounded-lg mb-6 text-sm break-words">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-32" />
          <div className="skeleton h-64" />
          <div className="skeleton h-40" />
        </div>
      ) : quote ? (
        <>
          {/* Price header */}
          <div className="panel-elevated p-8 mb-6 fade-in">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-ink-muted text-sm mb-1">{quote.name || symbol}</p>
                <p className="mono-tabular text-4xl font-bold text-ink">
                  {quote.currency === 'INR' ? '₹' : ''}
                  {quote.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
                <p className={`mono-tabular text-lg font-semibold mt-1 ${(quote.changePct ?? 0) >= 0 ? 'text-buy' : 'text-avoid'}`}>
                  {(quote.changePct ?? 0) >= 0 ? '+' : ''}
                  {((quote.changePct ?? 0) * 100).toFixed(2)}% today
                </p>
              </div>
              {stockId ? (
                <button
                  onClick={handleWatch}
                  disabled={watched || watching}
                  className={`text-sm font-medium px-4 py-2 rounded-lg border transition ${
                    watched
                      ? 'bg-buy-dim text-buy border-buy-dim cursor-default'
                      : 'bg-surface text-accent-bright border-border hover:border-accent-dim disabled:opacity-50'
                  }`}
                >
                  {watched ? '✓ Watching' : watching ? '…' : '+ Add to Watchlist'}
                </button>
              ) : (
                <p className="text-xs text-ink-faint max-w-[220px] text-right">
                  Not in the scored universe yet — watchlisting works for stocks from an event analysis.
                </p>
              )}
            </div>
          </div>

          {/* Price chart */}
          {history.length > 0 && (
            <div className="panel p-7 mb-6 fade-in">
              <h2 className="text-sm font-bold text-ink mb-4">6-Month Price History</h2>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-bright)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent-bright)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-faint)' }}
                    tickLine={false}
                    axisLine={false}
                    domain={['auto', 'auto']}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-bright)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text-muted)' }}
                    itemStyle={{ color: 'var(--text)' }}
                  />
                  <Area type="monotone" dataKey="close" stroke="var(--accent-bright)" strokeWidth={2} fill="url(#priceFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Fundamentals */}
          <div className="panel p-7 mb-6 fade-in">
            <h2 className="text-sm font-bold text-ink mb-4">Fundamentals</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                ['Market Cap', formatMarketCap(quote.marketCap)],
                ['P/E Ratio', quote.peRatio?.toFixed(1) ?? '—'],
                ['P/B Ratio', quote.pbRatio?.toFixed(2) ?? '—'],
                ['Dividend Yield', quote.dividendYield != null ? `${(quote.dividendYield * 100).toFixed(2)}%` : '—'],
                ['52-Week High', quote.week52High?.toLocaleString() ?? '—'],
                ['52-Week Low', quote.week52Low?.toLocaleString() ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="border border-border rounded-lg p-4">
                  <p className="text-[10px] text-ink-faint uppercase tracking-wide mb-1">{label}</p>
                  <p className="mono-tabular text-lg font-bold text-ink">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Analyst view */}
          <div className="panel p-7">
            <h2 className="text-sm font-bold text-ink mb-1">Analyst View</h2>
            <p className="text-xs text-ink-faint mb-5">
              Consensus rating and price targets aggregated from sell-side analysts covering this stock, via Yahoo Finance.
            </p>
            {quote.analystCount ? (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <span
                    className={`inline-flex items-center rounded-full font-bold border font-mono tracking-wide text-xs px-2.5 py-1 uppercase ${
                      RECOMMENDATION_STYLE[quote.analystRecommendationKey || ''] || 'text-ink-faint bg-surface-2 border-border'
                    }`}
                  >
                    {(quote.analystRecommendationKey || 'N/A').replace(/_/g, ' ')}
                  </span>
                  <span className="text-ink-muted text-sm">
                    Based on {quote.analystCount} analyst{quote.analystCount === 1 ? '' : 's'}
                  </span>
                  {upside != null && (
                    <span className={`text-sm font-semibold ${upside >= 0 ? 'text-buy' : 'text-avoid'}`}>
                      {upside >= 0 ? '+' : ''}
                      {upside.toFixed(1)}% to mean target
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-[10px] text-ink-faint uppercase tracking-wide mb-1">Target Low</p>
                    <p className="mono-tabular text-lg font-bold text-ink">{quote.targetLow?.toLocaleString() ?? '—'}</p>
                  </div>
                  <div className="border border-accent-dim rounded-lg p-4 bg-accent-dim/20">
                    <p className="text-[10px] text-accent-bright uppercase tracking-wide mb-1">Target Mean</p>
                    <p className="mono-tabular text-lg font-bold text-ink">{quote.targetMean?.toLocaleString() ?? '—'}</p>
                  </div>
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-[10px] text-ink-faint uppercase tracking-wide mb-1">Target High</p>
                    <p className="mono-tabular text-lg font-bold text-ink">{quote.targetHigh?.toLocaleString() ?? '—'}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-ink-faint text-sm">No analyst coverage data available for this stock.</p>
            )}
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
