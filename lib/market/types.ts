/** Types shared by every quote provider and by the pages that render quotes. */

export type QuoteCategory = 'domestic' | 'international' | 'commodity' | 'currency'

export type QuoteSource =
  | 'tradingview'
  | 'upstox'
  | 'yahoo-spark'
  | 'yahoo-quote'
  | 'yahoo-chart'
  | 'stooq'
  | 'frankfurter'

export interface MarketQuote {
  symbol: string
  name: string
  category: QuoteCategory
  price: number
  previousClose: number
  change: number
  changePct: number
  currency: string
  /** The upstream timestamp for the quote, ISO-8601. */
  asOf: string | null
  /** Which provider served this quote. Surfaced so the UI can say so. */
  source?: QuoteSource
  /**
   * Recent closes, oldest first, for the tile sparkline. Present whenever a
   * provider returned a series; a quote-only provider leaves it undefined
   * rather than fabricating a shape.
   */
  spark?: number[]
}

export interface TrackedSymbol {
  /** The app's stable id for the instrument (Yahoo-style, e.g. ^NSEI). */
  symbol: string
  name: string
  category: QuoteCategory
  /** TradingView screener ticker, when the screener carries it. */
  tv?: string
}
