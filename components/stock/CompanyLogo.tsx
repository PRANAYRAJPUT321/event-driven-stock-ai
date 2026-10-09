'use client'

import { useState } from 'react'

/**
 * The company's logo when the profile has one, otherwise a monogram — so a
 * missing or blocked image never leaves a broken-image icon in the header.
 */
export default function CompanyLogo({ name, symbol, url, size = 52 }: { name: string; symbol: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const initials =
    name
      .replace(/\(.*?\)/g, '')
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(ltd|limited|and|of|the|india)$/i.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || symbol.slice(0, 2)

  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="rounded-2xl bg-white border border-border flex-shrink-0 object-contain p-1.5"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="rounded-2xl bg-accent text-on-accent font-bold flex items-center justify-center flex-shrink-0 shadow-glow"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
