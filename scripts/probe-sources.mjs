// Probes candidate market-data sources from a cloud machine and prints what
// each one actually returns. Run by .github/workflows/probe-sources.yml so the
// answers come from a datacenter IP, the same kind of network Vercel uses.
// Development tool only — the app never imports this.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const now = Math.floor(Date.now() / 1000)
const DAY = 86400

function ddmmyyyy(d) {
  return `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`
}
function ymd(d) {
  return d.toISOString().slice(0, 10)
}
function recentWeekdays(n) {
  const out = []
  const d = new Date()
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1)
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(new Date(d))
  }
  return out
}

async function probe(name, url, init = {}, { show = 700, grep } = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers || {}) },
      signal: AbortSignal.timeout(15000),
    })
    const body = await res.text()
    const ms = Date.now() - t0
    console.log(`\n### ${name}\n${res.status} ${ms}ms ${res.headers.get('content-type') || ''} len=${body.length}\nURL ${url}`)
    if (grep) {
      for (const re of grep) {
        const m = body.match(re)
        console.log(`  grep ${re} → ${m ? JSON.stringify(m.slice(0, 3)).slice(0, 300) : 'no match'}`)
      }
    }
    if (show) console.log(body.slice(0, show).replace(/\s+/g, ' '))
    return { status: res.status, body, headers: res.headers }
  } catch (e) {
    console.log(`\n### ${name}\nERROR ${Date.now() - t0}ms ${e?.cause?.code || ''} ${String(e).slice(0, 200)}\nURL ${url}`)
    return { status: 0, body: '' }
  }
}

console.log('runner', new Date().toISOString())
await probe('ipinfo', 'https://ipinfo.io/json', {}, { show: 400 })

// ── Official constituents and the all-equities list (also gives ISINs) ──
for (const u of [
  'https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv',
  'https://archives.nseindia.com/content/indices/ind_nifty50list.csv',
  'https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv',
]) {
  const r = await probe('nifty50 list', u, {}, { show: 300 })
  if (r.status === 200 && r.body.includes('ISIN')) {
    console.log('NIFTY50_LIST_BEGIN\n' + r.body.trim() + '\nNIFTY50_LIST_END')
    break
  }
}
const eq = await probe('EQUITY_L', 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', {}, { show: 300 })
if (eq.status === 200) console.log(`EQUITY_L rows: ${eq.body.trim().split('\n').length}`)

// ── NSE bhavcopy: end-of-day prices for every NSE stock in one file ──
for (const d of recentWeekdays(3)) {
  await probe(`bhavcopy ${ddmmyyyy(d)}`, `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`, {}, { show: 400 })
}

// ── NSE API (cookie handshake first) ──
{
  const home = await probe('nse home', 'https://www.nseindia.com/', { headers: { Accept: 'text/html' } }, { show: 0 })
  const cookies = home.headers?.getSetCookie?.() || []
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ')
  console.log(`  nse cookies: ${cookies.length}`)
  const h = { Cookie: cookie, Referer: 'https://www.nseindia.com/', Accept: 'application/json' }
  await probe('nse quote-equity', 'https://www.nseindia.com/api/quote-equity?symbol=RELIANCE', { headers: h })
  await probe('nse nifty50 index', 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050', { headers: h })
  await probe('nse chart', 'https://www.nseindia.com/api/chart-databyindex?index=RELIANCEEQN', { headers: h })
}

// ── TradingView scanner: quotes + fundamentals for many symbols per call ──
const tvBasic = ['name', 'description', 'close', 'change', 'change_abs', 'volume', 'market_cap_basic', 'price_earnings_ttm', 'sector', 'industry', 'currency']
const tvExtended = [
  'price_52_week_high', 'price_52_week_low', 'dividend_yield_recent', 'earnings_per_share_basic_ttm', 'price_book_fq',
  'return_on_equity', 'debt_to_equity', 'beta_1_year', 'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD',
  'SMA50', 'SMA200', 'RSI', 'Volatility.D', 'Volatility.M', 'total_revenue', 'net_income', 'average_volume_10d_calc',
  'exchange', 'logoid', 'High.All', 'Low.All', 'gross_margin', 'net_margin', 'operating_margin', 'enterprise_value_fq',
  'price_sales_current', 'dividends_yield_current', 'return_on_assets', 'current_ratio', 'open', 'high', 'low',
  'premarket_change', 'Recommend.All', 'float_shares_outstanding', 'total_shares_outstanding', 'earnings_release_next_date',
]
const tvTickers = ['NSE:RELIANCE', 'NSE:TCS', 'NSE:HDFCBANK', 'NSE:TMPV', 'NSE:TATAMOTORS', 'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY', 'NSE:CNXIT']
const tvHeaders = { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }
await probe('tv scan basic', 'https://scanner.tradingview.com/india/scan', {
  method: 'POST', headers: tvHeaders, body: JSON.stringify({ symbols: { tickers: tvTickers, query: { types: [] } }, columns: tvBasic }),
}, { show: 3000 })
const ext = await probe('tv scan extended', 'https://scanner.tradingview.com/india/scan', {
  method: 'POST', headers: tvHeaders, body: JSON.stringify({ symbols: { tickers: ['NSE:RELIANCE'], query: { types: [] } }, columns: tvExtended }),
}, { show: 3000 })
if (ext.status !== 200) {
  for (const c of tvExtended) {
    const r = await fetch('https://scanner.tradingview.com/india/scan', {
      method: 'POST', headers: { 'User-Agent': UA, ...tvHeaders },
      body: JSON.stringify({ symbols: { tickers: ['NSE:RELIANCE'], query: { types: [] } }, columns: [c] }),
    }).then(async (x) => `${x.status} ${(await x.text()).slice(0, 120)}`).catch((e) => `ERR ${e}`)
    console.log(`  tv column ${c}: ${r}`)
  }
}
await probe('tv scan market list', 'https://scanner.tradingview.com/india/scan', {
  method: 'POST', headers: tvHeaders,
  body: JSON.stringify({
    filter: [{ left: 'type', operation: 'equal', right: 'stock' }, { left: 'exchange', operation: 'equal', right: 'NSE' }],
    options: { lang: 'en' }, markets: ['india'], columns: ['name', 'description', 'sector', 'market_cap_basic', 'close'],
    sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 5],
  }),
}, { show: 1500 })
await probe('tv global indices', 'https://scanner.tradingview.com/global/scan', {
  method: 'POST', headers: tvHeaders,
  body: JSON.stringify({ symbols: { tickers: ['SP:SPX', 'NASDAQ:IXIC', 'DJ:DJI', 'TVC:UKX', 'XETR:DAX', 'TVC:NI225', 'TVC:HSI', 'TVC:GOLD', 'TVC:USOIL', 'FX_IDC:USDINR'], query: { types: [] } }, columns: ['name', 'description', 'close', 'change', 'change_abs'] }),
}, { show: 2500 })
await probe('tv symbol search', 'https://symbol-search.tradingview.com/symbol_search/v3/?text=tata&hl=1&exchange=NSE&lang=en&search_type=stocks&domain=production', {
  headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
}, { show: 1200 })

// ── Moneycontrol chart API (TradingView UDF format) ──
await probe('mc stock history', `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=RELIANCE&resolution=1D&from=${now - 400 * DAY}&to=${now}&countback=300&currencyCode=INR`, {
  headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' },
}, { show: 600 })
await probe('mc index history', `https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history?symbol=in%3BNSX&resolution=1D&from=${now - 30 * DAY}&to=${now}&countback=20&currencyCode=INR`, {
  headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' },
}, { show: 600 })
await probe('mc intraday', `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=RELIANCE&resolution=5&from=${now - 4 * DAY}&to=${now}&countback=100&currencyCode=INR`, {
  headers: { Origin: 'https://www.moneycontrol.com', Referer: 'https://www.moneycontrol.com/' },
}, { show: 400 })
await probe('mc pricefeed', 'https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI', {}, { show: 900 })

// ── Google Finance HTML ──
await probe('gfinance stock', 'https://www.google.com/finance/quote/RELIANCE:NSE?hl=en', {}, {
  show: 0, grep: [/data-last-price="([\d.]+)"/, /Previous close<\/div>.{0,200}?([\d,]+\.\d+)/s, /data-currency-code="(\w+)"/],
})
await probe('gfinance index', 'https://www.google.com/finance/quote/NIFTY_50:INDEXNSE?hl=en', {}, { show: 0, grep: [/data-last-price="([\d.]+)"/] })

// ── Upstox public historical candles ──
const to = ymd(new Date()); const from = ymd(new Date(Date.now() - 370 * DAY * 1000))
await probe('upstox v2 daily', `https://api.upstox.com/v2/historical-candle/NSE_EQ%7CINE002A01018/day/${to}/${from}`, { headers: { Accept: 'application/json' } }, { show: 500 })
await probe('upstox v3 daily', `https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/days/1/${to}/${from}`, { headers: { Accept: 'application/json' } }, { show: 500 })
await probe('upstox intraday', 'https://api.upstox.com/v2/historical-candle/intraday/NSE_EQ%7CINE002A01018/30minute', { headers: { Accept: 'application/json' } }, { show: 500 })
await probe('upstox index daily', `https://api.upstox.com/v2/historical-candle/NSE_INDEX%7CNifty%2050/day/${to}/${from}`, { headers: { Accept: 'application/json' } }, { show: 400 })

// ── Yahoo, for comparison with what Vercel sees ──
await probe('yahoo chart q1', 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d', {}, { show: 300 })
await probe('yahoo chart q2', 'https://query2.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=5d&interval=1d', {}, { show: 300 })
await probe('yahoo spark', 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=RELIANCE.NS,TCS.NS&range=5d&interval=1d', {}, { show: 300 })

// ── Others ──
await probe('groww chart', `https://groww.in/v1/api/charting_service/v2/chart/exchange/NSE/segment/CASH/RELIANCE?endTimeInMillis=${Date.now()}&intervalInMinutes=1440&startTimeInMillis=${Date.now() - 30 * DAY * 1000}`, {}, { show: 400 })
await probe('bse header', 'https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=500325&seriesid=', {
  headers: { Referer: 'https://www.bseindia.com/', Origin: 'https://www.bseindia.com' },
}, { show: 500 })
await probe('stooq', 'https://stooq.com/q/d/l/?s=reliance.in&i=d', {}, { show: 200 })
await probe('google news rss', 'https://news.google.com/rss/search?q=RBI+repo+rate&hl=en-IN&gl=IN&ceid=IN:en', {}, { show: 200 })
await probe('coingecko', 'https://api.coingecko.com/api/v3/ping', {}, { show: 200 })
console.log('\nDONE')
