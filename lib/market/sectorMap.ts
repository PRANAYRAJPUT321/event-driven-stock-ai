/**
 * TradingView's sector and industry labels, mapped onto the analysis engine's
 * sector vocabulary (lib/ai/ruleClassifier.ts), so a company outside the
 * NIFTY 50 can be scored with the same channels and benchmarks as one inside.
 * Unmapped labels return null: the company is still scored, against the whole
 * index rather than a sector that is not really its own.
 */
export function sectorFromTradingView(
  sector: string | null | undefined,
  industry: string | null | undefined,
  name = ''
): string | null {
  const s = (sector || '').toLowerCase()
  const i = (industry || '').toLowerCase()
  const n = name.toLowerCase()

  if (/airline/.test(i)) return 'Aviation'
  if (/aerospace|defense/.test(i)) return 'Defence'
  if (/motor vehicle|auto parts|automotive/.test(i)) return 'Auto'
  if (/hospital|medical|health services/.test(i) || s === 'health services') return 'Healthcare'
  if (s === 'health technology') return 'Pharma'
  if (/bank/.test(i) || (s === 'finance' && /\bbank\b/.test(n))) return 'Banking'
  if (s === 'finance') return 'Financials'
  if (s === 'technology services') return 'IT'
  if (/telecom/.test(i) || s === 'communications') return 'Telecom'
  if (s === 'utilities') return 'Utilities'
  if (/construction materials|cement/.test(i)) return 'Cement'
  if (/steel|aluminum|metals|minerals|mining|precious/.test(i) || s === 'non-energy minerals') return 'Metals'
  if (/oil|gas|coal|refining/.test(i) || s === 'energy minerals') return 'Energy'
  if (/engineering|construction|machinery|electrical|industrial/.test(i) || s === 'producer manufacturing' || s === 'industrial services') return 'Engineering'
  if (/chemical|fertilizer|agricultural/.test(i) || s === 'process industries') return 'Chemicals'
  if (s === 'consumer non-durables') return 'FMCG'
  if (s === 'consumer durables') return 'Consumer'
  if (s === 'retail trade' || s === 'consumer services' || s === 'distribution services') return 'Retail'
  if (/marine|shipping|trucking|railroad|air freight|logistics/.test(i) || s === 'transportation') return 'Ports'
  return null
}
