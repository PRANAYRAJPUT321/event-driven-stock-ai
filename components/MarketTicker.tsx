'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface NewsTickerItem {
  kind: 'news'
  id: string
  title: string
  event_type: string | null
  detected_sectors: string[] | null
}

interface MarketTickerItem {
  kind: 'market'
  id: string
  symbol: string
  name: string
  change_pct: number | null
}

type TickerItem = NewsTickerItem | MarketTickerItem

export default function MarketTicker() {
  const router = useRouter()
  const [items, setItems] = useState<TickerItem[]>([])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    async function load() {
      const [{ data: news }, { data: markets }] = await Promise.all([
        supabase
          .from('news_feeds')
          .select('id, title, event_type, detected_sectors')
          .order('published_at', { ascending: false })
          .limit(10),
        supabase
          .from('market_snapshots')
          .select('id, symbol, name, change_pct')
          .order('fetched_at', { ascending: false })
          .limit(10),
      ])

      // Interleave news and market items rather than showing all of one
      // kind first, so the ticker always reads as one live feed — and each
      // item deep-links into the page that can actually act on it.
      const newsItems: TickerItem[] = (news || []).map((n) => ({ kind: 'news', ...n }))
      const marketItems: TickerItem[] = (markets || []).map((m) => ({ kind: 'market', ...m }))
      const merged: TickerItem[] = []
      const max = Math.max(newsItems.length, marketItems.length)
      for (let i = 0; i < max; i++) {
        if (marketItems[i]) merged.push(marketItems[i])
        if (newsItems[i]) merged.push(newsItems[i])
      }

      if (active) setItems(merged)
    }

    load()
    const interval = setInterval(load, 90000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (items.length === 0) return null

  const loop = [...items, ...items]

  function handleClick(item: TickerItem) {
    if (item.kind === 'news') router.push(`/analyze?news_id=${item.id}`)
    else router.push('/markets')
  }

  return (
    <div className="border-t border-border bg-surface/95 overflow-hidden">
      <div className="flex whitespace-nowrap py-2 animate-marquee w-max">
        {loop.map((item, idx) =>
          item.kind === 'news' ? (
            <button
              key={`news-${item.id}-${idx}`}
              onClick={() => handleClick(item)}
              className="flex items-center gap-2 px-6 text-xs flex-shrink-0 hover:opacity-80 transition"
            >
              <span className="live-dot" />
              <span className="font-mono text-[10px] text-ink-faint uppercase tracking-wide">
                {item.event_type?.replace(/_/g, ' ') || 'MARKET'}
              </span>
              <span className="text-ink-muted">{item.title}</span>
              {item.detected_sectors?.slice(0, 2).map((s) => (
                <span key={s} className="text-accent-bright font-mono text-[10px]">
                  #{s}
                </span>
              ))}
            </button>
          ) : (
            <button
              key={`mkt-${item.id}-${idx}`}
              onClick={() => handleClick(item)}
              className="flex items-center gap-2 px-6 text-xs flex-shrink-0 hover:opacity-80 transition"
            >
              <span className="font-mono text-[10px] text-ink-faint uppercase tracking-wide">{item.symbol}</span>
              <span
                className={`mono-tabular font-semibold ${
                  (item.change_pct ?? 0) >= 0 ? 'text-buy' : 'text-avoid'
                }`}
              >
                {(item.change_pct ?? 0) >= 0 ? '+' : ''}
                {item.change_pct?.toFixed(2)}%
              </span>
            </button>
          )
        )}
      </div>
    </div>
  )
}
