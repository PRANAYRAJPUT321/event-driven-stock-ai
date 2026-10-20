'use client'

import { useEffect, useState } from 'react'
import { nseSessionState } from './format'

export type NseSession = ReturnType<typeof nseSessionState>

/**
 * The NSE session state, worked out in the browser and refreshed each minute.
 *
 * Calling nseSessionState() during render made the server and the browser
 * disagree: /markets is prerendered at build time, so its HTML carried
 * whatever the session was then ("Market closed · weekend"), the browser
 * rendered the current one ("Market open"), and React threw away the whole
 * server render (errors #418/#423) to recover. Until mounted this is null and
 * the label is simply not drawn.
 */
export function useNseSession(): NseSession | null {
  const [session, setSession] = useState<NseSession | null>(null)
  useEffect(() => {
    const tick = () => setSession(nseSessionState())
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])
  return session
}
