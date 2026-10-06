import { NextResponse } from 'next/server'

/**
 * Which price sources this deployment can actually reach, and in what shape.
 *
 * This exists because the market grid has now been "fixed" twice against a
 * guess about what a serverless function can reach, and both guesses were
 * wrong — a browser on a home connection and a Vercel function on a shared
 * datacenter address get very different answers from the same URL, and
 * nothing in the app could tell them apart.
 *
 * So this probes every candidate from the server and reports the raw truth:
 * status, byte count, and the first slice of the body. Enough to tell "the
 * host refused us" from "the host answered but the symbol does not exist",
 * which look identical from the grid.
 *
 * Read-only, no secrets, no side effects.
 */
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 9000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

interface ProbeResult {
  label: string
  url: string
  ok: boolean
  status: number | null
  bytes: number
  ms: number
  /** Enough of the body to see whether it is data, an error page, or N/D. */
  sample: string
  /** Set when the body parsed as the shape the app expects. */
  usable?: boolean
  note?: string
}

async function probe(
  label: string,
  url: string,
  options: { headers?: Record<string, string>; judge?: (body: string) => { usable: boolean; note?: string } } = {}
): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = await response.text()
    const verdict = options.judge?.(body)
    return {
      label,
      url,
      ok: response.ok,
      status: response.status,
      bytes: body.length,
      ms: Date.now() - started,
      sample: body.slice(0, 180).replace(/\s+/g, ' '),
      usable: verdict?.usable,
      note: verdict?.note,
    }
  } catch (error: any) {
    return {
      label,
      url,
      ok: false,
      status: null,
      bytes: 0,
      ms: Date.now() - started,
      sample: error?.message || 'request failed',
    }
  }
}

/** A Stooq CSV row is usable only when its close column is a number. */
function judgeStooq(body: string): { usable: boolean; note?: string } {
  const lines = body.trim().split(/\r?\n/)
  if (lines.length < 2) return { usable: false, note: 'no rows' }
  const header = lines[0].toLowerCase().split(',')
  const iClose = header.indexOf('close')
  if (iClose === -1) return { usable: false, note: 'no close column' }
  const usableRows = lines
    .slice(1)
    .filter((line) => Number.isFinite(Number(line.split(',')[iClose]?.trim())))
  return {
    usable: usableRows.length > 0,
    note: `${usableRows.length}/${lines.length - 1} rows priced`,
  }
}

function judgeYahooChartish(body: string): { usable: boolean; note?: string } {
  try {
    const parsed = JSON.parse(body)
    const result = parsed?.chart?.result ?? parsed?.spark?.result ?? parsed?.quoteResponse?.result
    if (!Array.isArray(result)) return { usable: false, note: 'no result array' }
    return { usable: result.length > 0, note: `${result.length} entries` }
  } catch {
    return { usable: false, note: 'not JSON' }
  }
}

export async function GET() {
  const probes = await Promise.all([
    // ── Yahoo, every route the app knows ──
    probe(
      'Yahoo spark (batch, no session)',
      'https://query1.finance.yahoo.com/v7/finance/spark?symbols=RELIANCE.NS,TCS.NS&range=5d&interval=1d',
      { judge: judgeYahooChartish }
    ),
    probe(
      'Yahoo chart (single symbol)',
      'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d',
      { judge: judgeYahooChartish }
    ),
    probe(
      'Yahoo chart via query2',
      'https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d',
      { judge: judgeYahooChartish }
    ),
    probe('Yahoo crumb handshake', 'https://query1.finance.yahoo.com/v1/test/getcrumb'),

    // ── Stooq, across the symbol conventions it might list NSE names under.
    //    The grid falling through to Yahoo means none of these answered; this
    //    says which, if any, is the right spelling.
    probe('Stooq — reliance.in', 'https://stooq.com/q/l/?s=reliance.in&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq — ril.in', 'https://stooq.com/q/l/?s=ril.in&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq — reliance.ns', 'https://stooq.com/q/l/?s=reliance.ns&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq — bare reliance', 'https://stooq.com/q/l/?s=reliance&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq — NIFTY index ^nsei', 'https://stooq.com/q/l/?s=^nsei&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq — a US name, as a control', 'https://stooq.com/q/l/?s=aapl.us&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),

    // ── Stooq's other door. The .com quote path answers 404 with a landing
    //    page for every symbol including a US control, which points at the
    //    host refusing us rather than the symbols being wrong. These test
    //    whether a different path or the Polish domain behaves differently.
    probe('Stooq .pl — reliance.in', 'https://stooq.pl/q/l/?s=reliance.in&f=sd2t2ohlcv&h&e=csv', {
      judge: judgeStooq,
    }),
    probe('Stooq daily CSV path', 'https://stooq.com/q/d/l/?s=reliance.in&i=d', { judge: judgeStooq }),

    // ── Yahoo, but fetched by somebody else's server. Yahoo rate-limits this
    //    deployment's address, not the data; a public relay has a different
    //    address. No key, no account, and nothing private is being sent —
    //    these are public quote URLs.
    probe(
      'Yahoo via r.jina.ai relay',
      'https://r.jina.ai/https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d'
    ),
    probe(
      'Yahoo via allorigins relay',
      'https://api.allorigins.win/raw?url=' +
        encodeURIComponent(
          'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d'
        ),
      { judge: judgeYahooChartish }
    ),
    probe(
      'Yahoo via codetabs relay',
      'https://api.codetabs.com/v1/proxy?quest=' +
        encodeURIComponent(
          'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d'
        ),
      { judge: judgeYahooChartish }
    ),

    // ── The exchanges themselves.
    probe('NSE India quote API', 'https://www.nseindia.com/api/quote-equity?symbol=RELIANCE', {
      headers: { Referer: 'https://www.nseindia.com/', Accept: 'application/json' },
    }),
    probe(
      'BSE India',
      'https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=500325&seriesid=',
      { headers: { Referer: 'https://www.bseindia.com/', Accept: 'application/json' } }
    ),

    // ── Controls: sources already known to work from here, so a wholly red
    //    board can be told apart from one specific host refusing us.
    probe(
      'CoinGecko (known working)',
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=inr'
    ),
    probe('Frankfurter FX (ECB rates)', 'https://api.frankfurter.app/latest?from=USD&to=INR'),
  ])

  const working = probes.filter((p) => p.usable === true || (p.usable === undefined && p.ok))
  return NextResponse.json(
    {
      summary:
        working.length === 0
          ? 'Nothing answered. This deployment cannot reach any price source right now.'
          : `${working.length} of ${probes.length} sources answered usefully: ${working
              .map((p) => p.label)
              .join('; ')}.`,
      checkedAt: new Date().toISOString(),
      probes,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
