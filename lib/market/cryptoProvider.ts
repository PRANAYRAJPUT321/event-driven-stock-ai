export interface CryptoQuote {
  symbol: string
  name: string
  price: number
  changePct: number
  marketCap: number
}

/**
 * Top cryptocurrencies by market cap from CoinGecko's free public API —
 * no signup, no key, generous rate limit for a manual-refresh use case
 * like this one.
 */
export async function fetchTopCrypto(limit = 12): Promise<CryptoQuote[]> {
  const url = new URL('https://api.coingecko.com/api/v3/coins/markets')
  url.searchParams.set('vs_currency', 'usd')
  url.searchParams.set('order', 'market_cap_desc')
  url.searchParams.set('per_page', String(limit))
  url.searchParams.set('page', '1')
  url.searchParams.set('price_change_percentage', '24h')

  const response = await fetch(url.toString(), { cache: 'no-store' })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`CoinGecko request failed (${response.status}): ${body.substring(0, 200)}`)
  }

  const data = await response.json()
  return (data as any[])
    .filter((c) => c.current_price != null && c.price_change_percentage_24h != null)
    .map((c) => ({
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name,
      price: c.current_price,
      changePct: c.price_change_percentage_24h,
      marketCap: c.market_cap || 0,
    }))
}
