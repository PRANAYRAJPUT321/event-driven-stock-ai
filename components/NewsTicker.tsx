'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface NewsTickerItem {
  id: string
  title: string
  event_type: string | null
  detected_sectors: string[] | null
}

/**
 * Scrolling strip of the latest categorised headlines. Each one deep-links
 * into Analyze pre-loaded with that story, so the ticker is a way into the
 * product rather than decoration.
 *
 * Split out of the old combined MarketTicker: live prices now have their own
 * bar (MarketBar) fed by a keyless live API, while this stays on the cached
 * news_feeds table.
 */
export default function NewsTicker() {
  const router = useRouter()
  const [items, setItems] = useState<NewsTickerItem[]>([])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    async function load() {
      const { data } = await supabase
        .from('news_feeds')
        .select('id, title, event_type, detected_sectors')
        .order('published_at', { ascending: false })
        .limit(14)
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
    <div className="border-t border-border bg-bg-elevated/95 overflow-hidden">
      <div className="flex whitespace-nowrap py-1.5 animate-marquee w-max">
        {loop.map((item, idx) => (
          <button
            key={`${item.id}-${idx}`}
            onClick={() => router.push(`/analyze?news_id=${item.id}`)}
            className="flex items-center gap-2 px-6 text-xs flex-shrink-0 hover:opacity-80 transition"
          >
            <span className="font-mono text-[10px] text-accent2 uppercase tracking-wide">
              {item.event_type?.replace(/_/g, ' ') || 'NEWS'}
            </span>
            <span className="text-ink-muted">{item.title}</span>
            {item.detected_sectors?.slice(0, 2).map((s) => (
              <span key={s} className="text-accent-bright font-mono text-[10px]">
                #{s}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}
