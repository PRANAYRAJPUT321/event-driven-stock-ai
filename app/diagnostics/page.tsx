'use client'

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

/**
 * Which price sources this deployment can reach, in a form that can be read
 * on a phone and screenshotted.
 *
 * The grid has been blank twice for reasons that were invisible from inside
 * the app: a host that answers a home connection and refuses a datacenter one
 * looks exactly like a host that is down. This page shows the raw answer from
 * each candidate so the next fix is based on a measurement.
 */

interface Probe {
  label: string
  url: string
  ok: boolean
  status: number | null
  bytes: number
  ms: number
  sample: string
  usable?: boolean
  note?: string
}

export default function Diagnostics() {
  const [summary, setSummary] = useState<string>('')
  const [probes, setProbes] = useState<Probe[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [browserProbes, setBrowserProbes] = useState<Probe[]>([])
  const [browserLoading, setBrowserLoading] = useState(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/debug/sources', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
      setSummary(data.summary || '')
      setProbes(data.probes || [])
      setCheckedAt(data.checkedAt || null)
    } catch (err: any) {
      setError(err?.message || 'Could not run the probes')
    } finally {
      setLoading(false)
    }
  }

  /**
   * The same hosts, fetched by the browser instead of the server.
   *
   * This is the question that matters most. Yahoo rate-limits this
   * deployment's shared datacenter address, not the data itself — a home
   * connection is not rate-limited, which is why these pages load instantly
   * when opened directly. If the endpoint also sends CORS headers, the app
   * can fetch prices from each visitor's own address and the whole problem
   * disappears. A failure here is almost always CORS rather than the network,
   * and that distinction decides the next fix.
   */
  async function runBrowserProbes() {
    setBrowserLoading(true)
    const targets: { label: string; url: string }[] = [
      {
        label: 'Yahoo chart, from your browser',
        url: 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d',
      },
      {
        label: 'Yahoo spark, from your browser',
        url: 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=RELIANCE.NS,TCS.NS&range=5d&interval=1d',
      },
      { label: 'Stooq CSV, from your browser', url: 'https://stooq.com/q/l/?s=reliance.in&f=sd2t2ohlcv&h&e=csv' },
      {
        label: 'CoinGecko, from your browser (control)',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=inr',
      },
    ]

    const results: Probe[] = []
    for (const t of targets) {
      const started = Date.now()
      try {
        const response = await fetch(t.url, { cache: 'no-store' })
        const body = await response.text()
        results.push({
          label: t.label,
          url: t.url,
          ok: response.ok,
          status: response.status,
          bytes: body.length,
          ms: Date.now() - started,
          sample: body.slice(0, 180).replace(/\s+/g, ' '),
          usable: response.ok && body.length > 40,
          note: response.ok ? 'reachable from here' : undefined,
        })
      } catch (err: any) {
        results.push({
          label: t.label,
          url: t.url,
          ok: false,
          status: null,
          bytes: 0,
          ms: Date.now() - started,
          // A browser reports a CORS refusal as a generic network failure, so
          // say what it most likely means rather than leaving it cryptic.
          sample: `${err?.message || 'failed'} — usually means the host sends no CORS header, not that it is unreachable`,
        })
      }
    }
    setBrowserProbes(results)
    setBrowserLoading(false)
  }

  useEffect(() => {
    run()
    runBrowserProbes()
  }, [])

  const verdict = (p: Probe) =>
    p.usable === true
      ? { text: 'USABLE', cls: 'text-buy border-buy-dim bg-buy-dim' }
      : p.ok
        ? { text: 'ANSWERED', cls: 'text-hold border-hold-dim bg-hold-dim' }
        : { text: `FAILED${p.status ? ` ${p.status}` : ''}`, cls: 'text-avoid border-avoid-dim bg-avoid-dim' }

  return (
    <AppShell showTicker={false}>
      <div className="mb-6 fade-in">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-bright mb-2">
          Deployment diagnostics
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-1">Price source reachability</h1>
        <p className="text-ink-muted text-sm">
          What this server gets back from every candidate feed, right now. A source that works from
          your browser can still refuse this deployment — that difference is what this page exists
          to show.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          onClick={run}
          disabled={loading}
          className="bg-accent hover:bg-accent-bright text-on-accent text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          {loading ? 'Probing…' : 'Run again'}
        </button>
        {checkedAt && (
          <span className="text-xs font-mono text-ink-faint">
            {new Date(checkedAt).toLocaleTimeString('en-IN', { hour12: false })}
          </span>
        )}
      </div>

      {summary && (
        <div className="panel p-5 mb-5">
          <p className="text-sm text-ink">{summary}</p>
        </div>
      )}

      {error && (
        <div className="panel p-5 mb-5 border-avoid-dim">
          <p className="text-sm text-avoid">{error}</p>
        </div>
      )}

      <h2 className="text-sm font-bold text-ink mb-1 mt-2">From your browser</h2>
      <p className="text-xs text-ink-muted mb-3">
        Your connection is not rate-limited the way the server&apos;s is. If these succeed, the app
        can fetch prices from each visitor&apos;s own address instead.
      </p>
      <div className="space-y-2 mb-8">
        {browserLoading && browserProbes.length === 0 ? (
          <div className="skeleton h-20" />
        ) : (
          browserProbes.map((p) => {
            const v = verdict(p)
            return (
              <div key={p.label} className="panel p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${v.cls}`}>
                    {v.text}
                  </span>
                  <span className="text-sm font-semibold text-ink">{p.label}</span>
                  <span className="text-[11px] font-mono text-ink-faint ml-auto mono-tabular">
                    {p.ms}ms · {p.bytes}B
                  </span>
                </div>
                <p className="text-[11px] font-mono text-ink-muted break-all leading-relaxed">
                  {p.sample || '(empty response)'}
                </p>
              </div>
            )
          })
        )}
      </div>

      <h2 className="text-sm font-bold text-ink mb-1">From the server</h2>
      <p className="text-xs text-ink-muted mb-3">
        What the deployment itself gets back. This is what the app currently relies on.
      </p>

      {loading && probes.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {probes.map((p) => {
            const v = verdict(p)
            return (
              <div key={p.label} className="panel p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${v.cls}`}
                  >
                    {v.text}
                  </span>
                  <span className="text-sm font-semibold text-ink">{p.label}</span>
                  <span className="text-[11px] font-mono text-ink-faint ml-auto mono-tabular">
                    {p.ms}ms · {p.bytes}B{p.note ? ` · ${p.note}` : ''}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-ink-faint break-all mb-1.5">{p.url}</p>
                <p className="text-[11px] font-mono text-ink-muted break-all leading-relaxed">
                  {p.sample || '(empty response)'}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
