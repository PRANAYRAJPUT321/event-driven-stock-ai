'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface TickerItem {
  id: string
  title: string
  event_type: string | null
  detected_sectors: string[] | null
}

export default function MarketTicker() {
  const [items, setItems] = useState<TickerItem[]>([])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    async function load() {
      const { data } = await supabase
        .from('news_feeds')
        .select('id, title, event_type, detected_sectors')
        .order('published_at', { ascending: false })
        .limit(15)
      if (active) setItems(data || [])
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

  return (
    <div className="border-t border-border bg-surface/95 overflow-hidden">
      <div className="flex whitespace-nowrap py-2 animate-marquee w-max">
        {loop.map((item, idx) => (
          <span key={`${item.id}-${idx}`} className="flex items-center gap-2 px-6 text-xs flex-shrink-0">
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
          </span>
        ))}
      </div>
    </div>
  )
}
