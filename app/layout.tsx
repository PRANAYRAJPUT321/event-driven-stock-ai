import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Event-Driven Stock Market Intelligence',
  description: 'AI-powered investment analysis for Indian equity market',
  icons: {
    icon: '📊',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
