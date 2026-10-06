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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const MODULES = [
  'lib/ai/ruleClassifier.ts',
  'lib/ai/impactAnalyzer.ts',
  'lib/news/rssNews.ts',
  'lib/market/yahooFinance.ts',
  'lib/market/indianEquities.ts',
  'lib/scoring/scoreCalculator.ts',
  'lib/market/yahooClient.ts',
  'lib/market/stooq.ts',
  'lib/market/frankfurter.ts',
]

// Emitted inside the project so Node resolves the project's node_modules.
const out = mkdtempSync(path.join(process.cwd(), '.tsbuild-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))

// A throwaway tsconfig rather than bare CLI flags: the modules under test
// import each other through the project's "@/*" alias, which tsc can only
// resolve when baseUrl and paths are supplied — and those two have no
// command-line equivalent.
const tsconfigPath = path.join(out, 'tsconfig.json')
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    compilerOptions: {
      target: 'es2022',
      module: 'commonjs',
      moduleResolution: 'node',
      skipLibCheck: true,
      esModuleInterop: true,
      baseUrl: process.cwd(),
      paths: { '@/*': ['./*'] },
      outDir: out,
      rootDir: path.join(process.cwd(), 'lib'),
      noEmitOnError: false,
      types: [],
    },
    files: MODULES.map((m) => path.join(process.cwd(), m)),
  })
)

try {
  execSync(`./node_modules/.bin/tsc --project ${tsconfigPath}`, { stdio: 'pipe' })
} catch (err) {
  // tsc flags Next's `next: { revalidate }` fetch option outside the Next type
  // environment, and DOM lib types the harness does not need. It still emits,
  // so bail only when nothing usable came out.
  const stderr = String(err.stdout || '') + String(err.stderr || '')
  if (!existsSync(path.join(out, 'ai/ruleClassifier.js'))) {
    console.error(stderr)
    process.exit(1)
  }
}

const require = createRequire(import.meta.url)
const { classifyEventByRules, categorizeNewsByRules, buildCounterArgumentFromRules } =
  require(path.join(out, 'ai/ruleClassifier.js'))
const { parseRssFeed } = require(path.join(out, 'news/rssNews.js'))
const { parseChart } = require(path.join(out, 'market/yahooFinance.js'))
const { analyseImpact } = require(path.join(out, 'ai/impactAnalyzer.js'))
const { equitiesForSectors, sectorsWithoutConstituents } =
  require(path.join(out, 'market/indianEquities.js'))
const { calculateCompositeFromAvailable, recommendationFromComposite } =
  require(path.join(out, 'scoring/scoreCalculator.js'))
const { mapWithConcurrency, yahooRequest, fetchSparkBatch } =
  require(path.join(out, 'market/yahooClient.js'))
const { parseStooqCsv, toStooqSymbol } = require(path.join(out, 'market/stooq.js'))
const { fetchFxQuotes, FRANKFURTER_SYMBOLS } = require(path.join(out, 'market/frankfurter.js'))

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

// ─────────────────── two-sided impact analysis ───────────────────
section('analyseImpact — winners and losers from the same event')

const crudeUpImpact = analyseImpact({
  title: 'Brent crude surges past $95 a barrel after OPEC output cut',
  sectors: ['Aviation', 'Energy'],
})
const aviationUp = crudeUpImpact.sectorImpacts.find((s) => s.entity === 'Aviation')
const energyUp = crudeUpImpact.sectorImpacts.find((s) => s.entity === 'Energy')

// The regression this pins: the impact table is keyed by which way the
// VARIABLE moved, but classification.direction is the MARKET's reaction, and
// for crude those are opposite. Deriving polarity from the market direction
// selected the cheaper-crude points for a crude spike — an exactly inverted
// answer that still looked plausible.
check('crude spike hurts airlines', aviationUp.direction, 'NEGATIVE')
checkThat('crude spike names fuel cost as the mechanism',
  aviationUp.negatives.some((t) => /fuel/i.test(t)), JSON.stringify(aviationUp.negatives))
check('crude spike is two-sided for energy', energyUp.direction, 'MIXED')
checkThat('crude spike helps upstream producers',
  energyUp.positives.some((t) => /upstream|higher price/i.test(t)), JSON.stringify(energyUp.positives))

const crudeDownImpact = analyseImpact({
  title: 'Crude oil prices fall sharply to $68 on weak demand',
  sectors: ['Aviation', 'Energy'],
})
check('cheaper crude helps airlines',
  crudeDownImpact.sectorImpacts.find((s) => s.entity === 'Aviation').direction, 'POSITIVE')
check('cheaper crude hurts producers',
  crudeDownImpact.sectorImpacts.find((s) => s.entity === 'Energy').direction, 'NEGATIVE')

const hike = analyseImpact({
  title: 'RBI hikes repo rate by 25 bps to 6.75% citing sticky inflation',
  sectors: ['Banking', 'Auto'],
})
const banking = hike.sectorImpacts.find((s) => s.entity === 'Banking')
// A rate hike is genuinely both for a bank: margin widens on floating-rate
// assets while loan growth slows. Forcing one direction loses the real answer.
check('rate hike is mixed for banks', banking.direction, 'MIXED')
checkThat('rate hike names the margin benefit',
  banking.positives.some((t) => /margin|reprice/i.test(t)), JSON.stringify(banking.positives))
checkThat('rate hike names the volume cost',
  banking.negatives.some((t) => /loan growth|deposit/i.test(t)), JSON.stringify(banking.negatives))
check('rate hike hurts autos', hike.sectorImpacts.find((s) => s.entity === 'Auto').direction, 'NEGATIVE')

const weakRupee = analyseImpact({
  title: 'Rupee falls to record low of 89 against the US dollar',
  sectors: ['IT', 'Energy'],
})
check('weak rupee helps exporters',
  weakRupee.sectorImpacts.find((s) => s.entity === 'IT').direction, 'POSITIVE')
check('weak rupee hurts importers',
  weakRupee.sectorImpacts.find((s) => s.entity === 'Energy').direction, 'NEGATIVE')

const unknown = analyseImpact({ title: 'A pleasant afternoon in Mumbai', sectors: ['Banking'] })
check('unrecognised headline offers no read', unknown.unrecognised, true)
check('unrecognised headline is neutral, not guessed',
  unknown.sectorImpacts[0].direction, 'NEUTRAL')
checkThat('unrecognised headline lists no points',
  unknown.sectorImpacts[0].positives.length === 0 && unknown.sectorImpacts[0].negatives.length === 0)

const withCompanies = analyseImpact({
  title: 'RBI cuts repo rate by 50 bps to revive growth',
  sectors: ['Banking'],
  companies: [{ symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' }],
})
checkThat('company impacts are produced', withCompanies.companyImpacts.length === 1)
check('company impact carries the company name', withCompanies.companyImpacts[0].entity, 'HDFC Bank')
checkThat('company impact has both sides',
  withCompanies.companyImpacts[0].positives.length > 0 &&
    withCompanies.companyImpacts[0].negatives.length > 0)

section('evidence-gated recommendations')

const eventOnly = calculateCompositeFromAvailable({
  eventImpact: 20,
  historicalReaction: 40,
  fundamentalStrength: null,
  valuation: null,
  technicalCondition: null,
  riskScore: null,
})
check('a composite with no company factor is UNRATED, not AVOID',
  recommendationFromComposite(eventOnly), 'UNRATED')

const noData = calculateCompositeFromAvailable({
  eventImpact: null,
  historicalReaction: null,
  fundamentalStrength: null,
  valuation: null,
  technicalCondition: null,
  riskScore: null,
})
check('a composite with no data at all is UNRATED', recommendationFromComposite(noData), 'UNRATED')

const oneFactor = calculateCompositeFromAvailable({
  eventImpact: 20,
  historicalReaction: 40,
  fundamentalStrength: 90,
  valuation: null,
  technicalCondition: null,
  riskScore: null,
})
checkThat('one company factor is enough to rate',
  recommendationFromComposite(oneFactor) !== 'UNRATED')

const wellEvidenced = calculateCompositeFromAvailable({
  eventImpact: 90, historicalReaction: 85, fundamentalStrength: 88,
  valuation: 80, technicalCondition: 82, riskScore: 78,
})
check('a well-evidenced high score still reads BUY',
  recommendationFromComposite(wellEvidenced), 'BUY')

section('sector-to-company mapping')

check('an empty sector list maps to no companies', equitiesForSectors([], 6), [])
check('a sector with no constituent maps to no companies', equitiesForSectors(['Aviation'], 6), [])
checkThat('a real sector still maps to its constituents',
  equitiesForSectors(['Banking'], 6).every((e) => e.sector === 'Banking'))
checkThat('banks are not substituted for an energy event',
  equitiesForSectors(['Energy'], 6).every((e) => e.sector === 'Energy'))
check('sectors with no constituent are reported',
  sectorsWithoutConstituents(['Banking', 'Aviation', 'Realty']), ['Aviation', 'Realty'])

section('counter-argument wording when nothing was scored')

const blind = buildCounterArgumentFromRules({
  stockSymbol: 'HDFCBANK', compositeScore: 29,
  fundamentalScore: null, valuationScore: null, technicalScore: null, riskScore: null,
  eventDirection: 'NEGATIVE', eventMagnitude: 76,
})
checkThat('bear case does not claim components scored well',
  !blind.bearCase.includes('No component scores poorly'))
checkThat('bear case names the missing evidence',
  blind.bearCase.includes('no fundamental, valuation, technical or risk input'))
checkThat('bull case does not imply components were compared',
  !blind.bullCase.includes('No individual component scores strongly'))

section('upstream request management')

// The defect this guards: every symbol was fetched at once, so a 52-name
// index meant 52 simultaneous requests to one host, and Yahoo answered 429.
{
  let inFlight = 0
  let peak = 0
  const items = Array.from({ length: 30 }, (_, i) => i)
  const results = await mapWithConcurrency(items, 4, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    if (n === 7) throw new Error('boom')
    return n * 2
  })
  checkThat('concurrency never exceeds the limit', peak <= 4, `peak was ${peak}`)
  checkThat('every item is accounted for', results.length === 30)
  check('results keep input order', results[3].value, 6)
  check('one failure does not sink the batch', results[7].status, 'rejected')
  check('work continues past a failure', results[29].value, 58)
}

// A 429 must be retried, not surfaced immediately.
{
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (calls.length < 3) return { ok: false, status: 429, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  const response = await yahooRequest('/v8/finance/chart/TEST', { attempts: 3 })
  globalThis.fetch = realFetch
  check('a 429 is retried until it succeeds', response.status, 200)
  check('it took three attempts', calls.length, 3)
  checkThat('retries rotate to the other host',
    new Set(calls.map((u) => new URL(u).host)).size === 2,
    calls.join(' | '))
}

// A 404 is a real answer; retrying it just wastes the budget.
{
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return { ok: false, status: 404, json: async () => ({}) }
  }
  const response = await yahooRequest('/v8/finance/chart/NOPE', { attempts: 3 })
  globalThis.fetch = realFetch
  check('a 404 is returned without retrying', calls.length, 1)
  check('…and the status is passed through', response.status, 404)
}

section('headline de-duplication')

// Google News repeats the headline inside <description>, which produced
// analysis pages with the same sentence printed three times.
{
  const feed = (title, description) => `<?xml version="1.0"?><rss version="2.0"><channel>` +
    `<item><title>${title}</title><link>https://example.com/a</link>` +
    `<pubDate>Wed, 01 Oct 2026 09:30:00 GMT</pubDate>` +
    `<description>${description}</description></item></channel></rss>`

  const repeated = parseRssFeed(
    feed('RBI may hike repo rate by 25 bps in October meet: Economists',
         '&lt;a href="x"&gt;RBI may hike repo rate by 25 bps in October meet: Economists&lt;/a&gt;&amp;nbsp;Fortune India'),
    'Google News')
  check('a description that just repeats the headline is dropped',
    repeated[0].description, null)

  const real = parseRssFeed(
    feed('RBI holds repo rate at 6.50%',
         'The monetary policy committee voted five to one to keep the rate unchanged, citing food inflation.'),
    'Google News')
  checkThat('a description that adds information is kept',
    real[0].description !== null && real[0].description.includes('five to one'))

  const identical = parseRssFeed(feed('Nifty ends higher', 'Nifty ends higher'), 'Google News')
  check('an exactly identical description is dropped', identical[0].description, null)
}

section('spark batch — the crumbless path')

// The grid is 52 symbols. One request for all of them is the difference
// between working and being rate limited from a datacenter IP.
{
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    const syms = decodeURIComponent(new URL(u).searchParams.get('symbols') || '').split(',')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        spark: {
          result: syms.map((symbol) => ({
            symbol,
            response: [{
              meta: { symbol, regularMarketPrice: 103, currency: 'INR', regularMarketTime: 1700000000 },
              timestamp: [1, 2, 3],
              indicators: { quote: [{ close: [100, 101, 103] }] },
            }],
          })),
          error: null,
        },
      }),
    }
  }
  const symbols = Array.from({ length: 52 }, (_, i) => `SYM${i}.NS`)
  const found = await fetchSparkBatch(symbols)
  globalThis.fetch = realFetch

  check('every symbol comes back', found.size, 52)
  checkThat('52 symbols cost two requests, not 52', calls.length === 2, `took ${calls.length}`)
  checkThat('no crumb is involved', calls.every((u) => !u.includes('crumb')))
  checkThat('the payload is chart-shaped, so the same parser reads it',
    Boolean(found.get('SYM0.NS')?.chart?.result?.[0]?.meta))
}

// A spark outage must be reported as "this path is unavailable", not as every
// symbol being individually missing — the caller falls through on null.
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) })
  const found = await fetchSparkBatch(['A.NS', 'B.NS'])
  globalThis.fetch = realFetch
  check('a total spark failure returns null', found, null)
}

section('Stooq — the second price source')

check('an NSE ticker maps to Stooq\'s listing', toStooqSymbol('RELIANCE'), 'reliance.in')
check('punctuation is stripped', toStooqSymbol('M&M'), 'mm.in')
check('case does not matter', toStooqSymbol('tcs'), 'tcs.in')

{
  const csv = [
    'Symbol,Date,Time,Open,High,Low,Close,Volume',
    'reliance.in,2026-10-06,09:45:00,1402.00,1418.50,1398.10,1412.30,2451233',
    'tcs.in,2026-10-06,09:45:00,3180.00,3205.00,3176.40,3198.75,881240',
    'nosuch.in,N/D,N/D,N/D,N/D,N/D,N/D,N/D',
  ].join('\n')
  const rows = parseStooqCsv(csv)
  check('only the symbols it carries come back', rows.size, 2)
  check('close is the price', rows.get('reliance.in').price, 1412.3)
  check('session range is carried', rows.get('reliance.in').high, 1418.5)
  check('volume is parsed', rows.get('tcs.in').volume, 881240)
  checkThat('an unknown symbol is absent, not zero', !rows.has('nosuch.in'))
  checkThat('the timestamp is ISO', rows.get('tcs.in').asOf.startsWith('2026-10-06'))
}

check('an empty response yields no rows', parseStooqCsv('').size, 0)
check('a header with no rows yields no rows', parseStooqCsv('Symbol,Date,Close').size, 0)

{
  // N/D in the price column must never become a number.
  const rows = parseStooqCsv('Symbol,Date,Time,Open,High,Low,Close,Volume\nx.in,N/D,N/D,N/D,N/D,N/D,N/D,N/D')
  check('a quote with no close is dropped entirely', rows.size, 0)
}

section('FX from the ECB reference rates')

check('the pairs it covers', FRANKFURTER_SYMBOLS.size, 8)
checkThat('AED is not claimed — the ECB does not publish it',
  !FRANKFURTER_SYMBOLS.has('AEDINR=X'))
checkThat('the dollar index is not claimed — it is not a currency pair',
  !FRANKFURTER_SYMBOLS.has('DX-Y.NYB'))

{
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    calls.push(u.searchParams.get('from'))
    const quotes = (u.searchParams.get('to') || '').split(',')
    // Three ECB publication days, rising.
    const rates = {}
    ;['2026-10-01', '2026-10-02', '2026-10-03'].forEach((date, i) => {
      rates[date] = Object.fromEntries(quotes.map((q) => [q, 90 + i]))
    })
    return { ok: true, status: 200, json: async () => ({ base: u.searchParams.get('from'), rates }) }
  }

  const tracked = [
    { symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' },
    { symbol: 'EURINR=X', name: 'EUR/INR', category: 'currency' },
    { symbol: 'GBPINR=X', name: 'GBP/INR', category: 'currency' },
    { symbol: 'AEDINR=X', name: 'AED/INR', category: 'currency' },
  ]
  const fx = await fetchFxQuotes(tracked)
  globalThis.fetch = realFetch

  check('only the covered pairs come back', fx.length, 3)
  checkThat('an uncovered pair is left for another provider',
    !fx.some((q) => q.symbol === 'AEDINR=X'))
  check('price is the latest fixing', fx[0].price, 92)
  check('previous close is the fixing before it', fx[0].previousClose, 91)
  checkThat('the move is derived from those two',
    Math.abs(fx[0].changePct - ((92 - 91) / 91) * 100) < 1e-9)
  check('the tile gets a series to draw', fx[0].spark.length, 3)
  check('the source is labelled', fx[0].source, 'frankfurter')
  checkThat('one request per base currency, not per pair',
    calls.length === new Set(calls).size && calls.length <= 3,
    `bases requested: ${calls.join(',')}`)
}

{
  // A single data point gives a price but no move, and a move is most of what
  // a currency tile is for.
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ rates: { '2026-10-03': { INR: 90 } } }),
  })
  const fx = await fetchFxQuotes([{ symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' }])
  globalThis.fetch = realFetch
  check('a single fixing is not shown as a flat day', fx.length, 0)
}

{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  const fx = await fetchFxQuotes([{ symbol: 'USDINR=X', name: 'USD/INR', category: 'currency' }])
  globalThis.fetch = realFetch
  check('an outage yields nothing rather than throwing', fx.length, 0)
}

console.log(
  failures === 0
    ? `\n✓ ${checks} checks passed`
    : `\n✗ ${failures} of ${checks} checks failed`
)
process.exit(failures === 0 ? 0 : 1)
