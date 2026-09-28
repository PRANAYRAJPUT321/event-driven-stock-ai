/**
 * Offline test harness for the deterministic engines.
 *
 *   npm run test:rules
 *
 * These are the parts of the app that must keep working with no API keys and
 * no network, so their tests deliberately need neither: the modules are
 * compiled with the project's own tsc into a temp directory and exercised
 * directly. No test framework, no new dependencies.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'

const MODULES = ['lib/ai/ruleClassifier.ts', 'lib/news/rssNews.ts', 'lib/market/yahooFinance.ts']

// Emitted inside the project so Node resolves the project's node_modules.
const out = mkdtempSync(path.join(process.cwd(), '.tsbuild-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))

try {
  execSync(
    `./node_modules/.bin/tsc ${MODULES.join(' ')} ` +
      `--target es2022 --module es2022 --moduleResolution bundler --skipLibCheck --outDir ${out}`,
    { stdio: 'pipe' }
  )
} catch (err) {
  // tsc flags Next's `next: { revalidate }` fetch option outside the Next type
  // environment. It still emits, so only bail if nothing came out.
  const stderr = String(err.stdout || '') + String(err.stderr || '')
  if (!stderr.includes("'next' does not exist in type 'RequestInit'")) {
    console.error(stderr)
    process.exit(1)
  }
}

const { classifyEventByRules, categorizeNewsByRules, buildCounterArgumentFromRules } =
  await import(path.join(out, 'ai/ruleClassifier.js'))
const { parseRssFeed } = await import(path.join(out, 'news/rssNews.js'))
const { parseChart } = await import(path.join(out, 'market/yahooFinance.js'))

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks++
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.log(`  FAIL ${label}\n       got:  ${JSON.stringify(actual)}\n       want: ${JSON.stringify(expected)}`)
  }
}

function checkThat(label, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

// ─────────────────────────── rule classifier ───────────────────────────
section('classifyEventByRules — transmission channels')

const repoHike = classifyEventByRules('RBI hikes repo rate by 25 bps to 6.75% citing sticky inflation')
check('repo hike event_type', repoHike.event_type, 'MONETARY_POLICY')
check('repo hike variable', repoHike.economic_variable, 'INTEREST_RATE')
check('repo hike direction', repoHike.direction, 'NEGATIVE')
checkThat('repo hike hits lenders', repoHike.affected_sectors.includes('Banking'), JSON.stringify(repoHike.affected_sectors))
checkThat('repo hike magnitude is material', repoHike.magnitude >= 60, `magnitude=${repoHike.magnitude}`)

const repoCut = classifyEventByRules('RBI cuts repo rate by 50 basis points to revive growth')
check('repo cut direction', repoCut.direction, 'POSITIVE')
check('repo cut variable', repoCut.economic_variable, 'INTEREST_RATE')

const repoHold = classifyEventByRules('RBI keeps repo rate unchanged at 6.5%, maintains stance')
check('repo hold direction', repoHold.direction, 'NEUTRAL')
checkThat('repo hold magnitude is lower than a move', repoHold.magnitude < repoHike.magnitude,
  `hold=${repoHold.magnitude} hike=${repoHike.magnitude}`)

const crudeUp = classifyEventByRules('Brent crude surges past $95 a barrel after OPEC output cut')
check('crude spike event_type', crudeUp.event_type, 'COMMODITY_SHOCK')
check('crude spike variable', crudeUp.economic_variable, 'OIL_PRICE')
check('crude spike direction', crudeUp.direction, 'NEGATIVE')
checkThat('crude spike hits fuel-intensive sectors', crudeUp.affected_sectors.includes('Aviation'),
  JSON.stringify(crudeUp.affected_sectors))

const crudeDown = classifyEventByRules('Crude oil prices fall sharply to $68 on weak demand')
check('crude slump direction', crudeDown.direction, 'POSITIVE')

const rupeeWeak = classifyEventByRules('Rupee falls to record low of 89 against the US dollar')
check('weak rupee event_type', rupeeWeak.event_type, 'CURRENCY')
check('weak rupee helps exporters', rupeeWeak.direction, 'POSITIVE')
checkThat('weak rupee names IT', rupeeWeak.affected_sectors.includes('IT'), JSON.stringify(rupeeWeak.affected_sectors))

const rupeeStrong = classifyEventByRules('Rupee rises sharply, gains against the dollar on strong inflows')
check('strong rupee hurts exporters', rupeeStrong.direction, 'NEGATIVE')

const inflationUp = classifyEventByRules('Retail inflation rises to 6.8% in September, above RBI tolerance band')
check('inflation up event_type', inflationUp.event_type, 'INFLATION')
check('inflation up direction', inflationUp.direction, 'NEGATIVE')

const inflationDown = classifyEventByRules('CPI inflation eases to 4.1%, cools for a third straight month')
check('inflation cooling direction', inflationDown.direction, 'POSITIVE')

const budget = classifyEventByRules('Union Budget raises capital expenditure by 11% with a big infrastructure push')
check('budget event_type', budget.event_type, 'GOVERNMENT_POLICY')
check('budget direction', budget.direction, 'POSITIVE')
checkThat('budget hits the infra chain', budget.affected_sectors.includes('Engineering'),
  JSON.stringify(budget.affected_sectors))

const earnings = classifyEventByRules('Infosys Q2 net profit beats estimates, raises FY guidance')
check('earnings event_type', earnings.event_type, 'EARNINGS')
check('earnings beat direction', earnings.direction, 'POSITIVE')
checkThat('earnings picks up the named sector', earnings.affected_sectors.includes('IT'),
  JSON.stringify(earnings.affected_sectors))

const gdpSlow = classifyEventByRules('India GDP growth slows to 5.4% in the second quarter')
check('gdp slowdown event_type', gdpSlow.event_type, 'GDP')
check('gdp slowdown direction', gdpSlow.direction, 'NEGATIVE')

const regulatory = classifyEventByRules('SEBI imposes penalty and launches probe into broker compliance lapses')
check('regulatory event_type', regulatory.event_type, 'REGULATORY')
check('regulatory direction', regulatory.direction, 'NEGATIVE')

section('classifyEventByRules — refuses to guess')

const nonsense = classifyEventByRules('The weather in Mumbai was pleasant today')
check('unmatched event_type', nonsense.event_type, 'OTHER')
check('unmatched direction is neutral, not invented', nonsense.direction, 'NEUTRAL')
checkThat('unmatched confidence is low', nonsense.confidence <= 30, `confidence=${nonsense.confidence}`)
checkThat('unmatched still names a sector to score against', nonsense.affected_sectors.length > 0)

checkThat('every classification stays in range', [repoHike, crudeUp, rupeeWeak, budget, nonsense].every(
  (c) => c.magnitude >= 0 && c.magnitude <= 100 && c.confidence >= 0 && c.confidence <= 100))
checkThat('rules never claim LLM-level confidence', [repoHike, crudeUp, budget].every((c) => c.confidence <= 78))

section('word-boundary matching')
// "upstream" must not read as the word "up"; "execute" must not read as "cut".
const upstream = classifyEventByRules('Upstream oil producers execute new drilling contracts')
checkThat('substring words do not flip polarity', upstream.direction === 'NEUTRAL' || upstream.event_type === 'COMMODITY_SHOCK',
  JSON.stringify(upstream))

section('categorizeNewsByRules')
const relevant = categorizeNewsByRules('RBI cuts repo rate by 25 bps', 'The move is expected to lift credit growth in India')
check('indian macro headline is relevant', relevant.is_market_relevant, true)
check('indian macro headline event_type', relevant.event_type, 'MONETARY_POLICY')
checkThat('indian macro headline scores highly', relevant.relevance_score >= 50, `score=${relevant.relevance_score}`)

const irrelevant = categorizeNewsByRules('Local football club wins a friendly match', 'Sports roundup')
check('sports headline is not market relevant', irrelevant.is_market_relevant, false)

const globalMacro = categorizeNewsByRules('Brent crude jumps 4% after OPEC surprise', 'Oil markets react')
check('global commodity headline is relevant to Indian equities', globalMacro.is_market_relevant, true)

checkThat('relevance score stays in range',
  [relevant, irrelevant, globalMacro].every((c) => c.relevance_score >= 0 && c.relevance_score <= 100))

section('buildCounterArgumentFromRules')
const decision = buildCounterArgumentFromRules({
  eventReasoning: 'Repo rate hike', transmissionExplanation: 'Higher funding costs',
  eventDirection: 'NEGATIVE', eventMagnitude: 72, stockSymbol: 'HDFCBANK',
  compositeScore: 63, fundamentalScore: 71, valuationScore: 42, technicalScore: 55, riskScore: 66,
})
checkThat('bull case cites the composite score', decision.bullCase.includes('63'), decision.bullCase)
checkThat('bull case names the stock', decision.bullCase.includes('HDFCBANK'))
checkThat('bear case is non-empty', decision.bearCase.length > 40)
checkThat('weak valuation surfaces as the contradiction', decision.contradictoryEvidence.includes('42'),
  decision.contradictoryEvidence)
checkThat('three risks are returned', decision.keyRisks.length === 3, JSON.stringify(decision.keyRisks))
checkThat('final reasoning cites the score', decision.finalReasoning.includes('63'))

const strong = buildCounterArgumentFromRules({
  eventReasoning: 'Rate cut', transmissionExplanation: 'Cheaper funding', eventDirection: 'POSITIVE',
  eventMagnitude: 60, stockSymbol: 'INFY', compositeScore: 82,
  fundamentalScore: 80, valuationScore: 75, technicalScore: 70, riskScore: 78,
})
checkThat('an all-strong profile still produces a bear case', strong.bearCase.length > 40, strong.bearCase)
checkThat('an all-strong profile still produces a contradiction', strong.contradictoryEvidence.length > 30)

// ───────────────────────────── RSS parsing ─────────────────────────────
section('parseRssFeed')
const googleFeed = `<rss><channel>
<item><title>RBI holds repo rate at 6.5% - The Economic Times</title>
<link>https://news.google.com/rss/articles/abc</link>
<pubDate>Fri, 26 Sep 2025 06:30:00 GMT</pubDate>
<description>&lt;a href="x"&gt;story&lt;/a&gt;&amp;nbsp;text</description>
<source url="https://et.com">The Economic Times</source></item>
</channel></rss>`
const g = parseRssFeed(googleFeed, 'Google News')
check('publisher split out of the title', g[0].title, 'RBI holds repo rate at 6.5%')
check('publisher becomes the source', g[0].source, 'The Economic Times')
check('description is stripped of markup', g[0].description, 'story text')
check('pubDate normalised to ISO', g[0].publishedAt, new Date('Fri, 26 Sep 2025 06:30:00 GMT').toISOString())

check('empty feed yields no items', parseRssFeed('<rss><channel></channel></rss>', 'X'), [])
check('non-RSS input yields no items', parseRssFeed('<html>nope</html>', 'X'), [])
check('item without a link is dropped', parseRssFeed('<rss><channel><item><title>t</title></item></channel></rss>', 'X'), [])
check('single item still parses as a list',
  parseRssFeed('<rss><channel><item><title>Only one</title><link>http://a</link></item></channel></rss>', 'X').length, 1)

// ──────────────────────── Yahoo chart parsing ─────────────────────────
section('parseChart')
const T = { symbol: '^NSEI', name: 'NIFTY 50', category: 'domestic' }
const idx = parseChart({ chart: { result: [{ meta: {
  currency: 'INR', regularMarketPrice: 24600, chartPreviousClose: 24400, regularMarketTime: 1727337600 },
  indicators: { quote: [{ close: [24350, 24400, 24600] }] } }] } }, T)
check('index price', idx.price, 24600)
check('index change percent', Number(idx.changePct.toFixed(4)), 0.8197)

const fx = parseChart({ chart: { result: [{ meta: { regularMarketPrice: 88.5, previousClose: 88.0 } }] } },
  { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' })
check('previousClose fallback used when chartPreviousClose is absent', Number(fx.changePct.toFixed(4)), 0.5682)

const fb = parseChart({ chart: { result: [{ meta: { regularMarketPrice: 105 },
  indicators: { quote: [{ close: [null, 100, 105] }] } }] } }, T)
check('series close used when neither previous-close field is set', fb.previousClose, 100)

const zero = parseChart({ chart: { result: [{ meta: { regularMarketPrice: 10, chartPreviousClose: 0 } }] } }, T)
check('zero previous close cannot produce Infinity', zero.changePct, 0)

// The bar requests range=5d, where meta.chartPreviousClose is the close
// BEFORE those five days. Using it would report a five-day move as today's.
// The prior session is the second-to-last point of the daily series.
const fiveDay = parseChart({ chart: { result: [{
  meta: { regularMarketPrice: 105, chartPreviousClose: 100, previousClose: 104 },
  indicators: { quote: [{ close: [100, 101, 102, 104, 105] }] },
}] } }, T)
check('prior session close comes from the series, not the range start', fiveDay.previousClose, 104)
check('so the change is one session, not five', Number(fiveDay.changePct.toFixed(4)), 0.9615)

// A thin feed with no usable series still has to produce something.
const thin = parseChart({ chart: { result: [{
  meta: { regularMarketPrice: 50, previousClose: 49 },
  indicators: { quote: [{ close: [null] }] },
}] } }, T)
check('meta is the fallback when the series is unusable', thin.previousClose, 49)

check('yahoo error payload yields null', parseChart({ chart: { result: null, error: { code: 'Not Found' } } }, T), null)
check('empty body yields null', parseChart({}, T), null)
check('response without a price yields null', parseChart({ chart: { result: [{ meta: { currency: 'USD' } }] } }, T), null)

console.log(
  failures === 0
    ? `\n✓ ${checks} checks passed`
    : `\n✗ ${failures} of ${checks} checks failed`
)
process.exit(failures === 0 ? 0 : 1)
