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

  useEffect(() => {
    run()
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
