'use client'

import { NIFTY_50 } from '@/lib/market/indianEquities'

/**
 * A browser-local stand-in for the Supabase tables the pages read and write,
 * so the whole app works for a visitor with no account and with no database
 * reachable. It answers the same chained calls the pages already make —
 * from().select().eq().order().limit(), insert().select().single(), and so
 * on — over rows kept in localStorage, which means each page keeps one code
 * path and simply talks to this instead of Supabase in guest mode.
 *
 * Only the operations the app uses are implemented. Column lists in select()
 * are ignored (whole rows come back) and embedded selects such as
 * `stocks(symbol, name)` are satisfied by rows that carry the embedded object
 * themselves (watchlists store their stock).
 */

const KEY = 'pulse-guest-db-v1'
export const GUEST_DB_EVENT = 'pulse-guest-db'

type Row = Record<string, any>
type Tables = Record<string, Row[]>

let memory: Tables | null = null

function load(): Tables {
  if (memory) return memory
  try {
    memory = JSON.parse(localStorage.getItem(KEY) || '{}') as Tables
  } catch {
    memory = {}
  }
  return memory!
}

function save(tables: Tables) {
  memory = tables
  try {
    localStorage.setItem(KEY, JSON.stringify(tables))
  } catch {
    // Storage full or blocked: the session keeps working from memory.
  }
  try {
    window.dispatchEvent(new Event(GUEST_DB_EVENT))
  } catch {}
}

function uuid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

/** The stock universe: the NIFTY 50 plus any company added from search. */
function stockRows(tables: Tables): Row[] {
  const added = tables.stocks || []
  const seen = new Set(added.map((s) => s.symbol))
  return [
    ...added,
    ...NIFTY_50.filter((s) => !seen.has(s.symbol)).map((s) => ({ id: s.symbol, symbol: s.symbol, name: s.name, sector: s.sector })),
  ]
}

function rowsOf(table: string, tables: Tables): Row[] {
  if (table === 'stocks') return stockRows(tables)
  if (table === 'profiles') {
    const rows = tables.profiles || []
    return rows.length > 0 ? rows : [{ id: 'guest', full_name: '', risk_profile: null, investment_horizon: null, investment_experience: null }]
  }
  return tables[table] || []
}

/** Fills in what the database would have defaulted or joined. */
function complete(table: string, row: Row, tables: Tables): Row {
  const now = new Date().toISOString()
  const out: Row = { id: uuid(), created_at: now, ...row }
  if (table === 'portfolio_positions') out.entry_date ??= now
  if (table === 'watchlists' && !out.stocks) {
    const stock = stockRows(tables).find((s) => s.id === out.stock_id || s.symbol === out.stock_id)
    out.stocks = stock ? { symbol: stock.symbol, name: stock.name, sector: stock.sector ?? null } : null
  }
  return out
}

type Filter = (row: Row) => boolean

class GuestQuery implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private filters: Filter[] = []
  private sort: { col: string; asc: boolean } | null = null
  private max: number | null = null
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row[] | Row | null = null
  private one: 'single' | 'maybe' | null = null
  private countOnly = false

  constructor(private table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.countOnly = true
    return this
  }
  insert(rows: Row | Row[]) {
    this.mode = 'insert'
    this.payload = rows
    return this
  }
  update(values: Row) {
    this.mode = 'update'
    this.payload = values
    return this
  }
  delete() {
    this.mode = 'delete'
    return this
  }
  eq(col: string, value: any) {
    this.filters.push((r) => r[col] === value)
    return this
  }
  neq(col: string, value: any) {
    this.filters.push((r) => r[col] !== value)
    return this
  }
  in(col: string, values: any[]) {
    this.filters.push((r) => values.includes(r[col]))
    return this
  }
  gt(col: string, value: any) {
    this.filters.push((r) => r[col] > value)
    return this
  }
  gte(col: string, value: any) {
    this.filters.push((r) => r[col] >= value)
    return this
  }
  lt(col: string, value: any) {
    this.filters.push((r) => r[col] < value)
    return this
  }
  overlaps(col: string, values: any[]) {
    this.filters.push((r) => Array.isArray(r[col]) && r[col].some((v: any) => values.includes(v)))
    return this
  }
  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/%/g, '').toLowerCase()
    this.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle))
    return this
  }
  order(col: string, options?: { ascending?: boolean }) {
    this.sort = { col, asc: options?.ascending !== false }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  single() {
    this.one = 'single'
    return this
  }
  maybeSingle() {
    this.one = 'maybe'
    return this
  }

  private run(): { data: any; error: any; count?: number | null } {
    const tables = load()
    const matches = (r: Row) => this.filters.every((f) => f(r))

    if (this.mode === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const current = rowsOf(this.table, tables)
      const created: Row[] = []
      for (const row of incoming) {
        // The unique constraints the app relies on: one watch per stock, one
        // save per analysis, one stock row per symbol.
        const duplicate =
          (this.table === 'watchlists' && current.some((r) => r.stock_id === row.stock_id && r.user_id === row.user_id)) ||
          (this.table === 'saved_analyses' && current.some((r) => r.event_analysis_id === row.event_analysis_id)) ||
          (this.table === 'stocks' && (tables.stocks || []).some((r) => r.symbol === row.symbol))
        if (duplicate) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
        }
        created.push(complete(this.table, row, tables))
      }
      tables[this.table] = [...(tables[this.table] || []), ...created]
      save(tables)
      return this.shape(created)
    }

    if (this.mode === 'update') {
      const base = rowsOf(this.table, tables).map((r) => ({ ...r }))
      const changed: Row[] = []
      for (const r of base) if (matches(r)) { Object.assign(r, this.payload); changed.push(r) }
      tables[this.table] = base
      save(tables)
      return this.shape(changed)
    }

    if (this.mode === 'delete') {
      const base = tables[this.table] || []
      const removed = base.filter(matches)
      tables[this.table] = base.filter((r) => !matches(r))
      save(tables)
      return this.shape(removed)
    }

    let rows = rowsOf(this.table, tables).filter(matches)
    if (this.sort) {
      const { col, asc } = this.sort
      rows = [...rows].sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1)))
    }
    if (this.countOnly) return { data: null, error: null, count: rows.length }
    if (this.max !== null) rows = rows.slice(0, this.max)
    return this.shape(rows)
  }

  private shape(rows: Row[]) {
    if (this.one === 'single') {
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'Row not found' } }
    }
    if (this.one === 'maybe') return { data: rows[0] ?? null, error: null }
    return { data: rows, error: null }
  }

  then<A = any, B = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    let result
    try {
      result = this.run()
    } catch (e: any) {
      result = { data: null, error: { message: e?.message || String(e) } }
    }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }
}

export const guestDb = {
  from: (table: string) => new GuestQuery(table),
}

/** Whether this browser has any guest data yet (for first-visit hints). */
export function guestHasData(): boolean {
  const t = load()
  return Object.values(t).some((rows) => rows.length > 0)
}

/**
 * Stores an analysis the API returned unsaved (no account) as guest rows in
 * the same shape the database uses, and returns its id for /events/[id].
 */
/**
 * Bumped whenever the analysis engine changes what it would answer, so
 * analyses saved in this browser by an older engine are re-run when opened
 * instead of showing a read the app no longer stands behind.
 */
export const ENGINE_VERSION = 2

function analysisFields(result: any): Row {
  const top = result.stocks?.[0]
  return {
    event_title: result.eventTitle,
    affected_sectors: result.classification?.affected_sectors ?? [],
    opportunity_score: top?.opportunityScore ?? result.classification?.magnitude ?? 0,
    composite_score: top?.opportunityScore ?? null,
    recommendation: top?.recommendation ?? null,
    bull_case: result.counterArgument?.bullCase ?? null,
    bear_case: result.counterArgument?.bearCase ?? null,
    contradictory_evidence: result.counterArgument?.contradictoryEvidence ?? null,
    risks: result.counterArgument?.keyRisks ?? [],
    historical_summary: result.historical ?? null,
    analysis_json: result.classification,
    engine_version: ENGINE_VERSION,
    invalid_reason: null,
    // The companies the reader chose, so a re-run scores the same ones.
    requested_symbols:
      result.selectionMode === 'requested' ? (result.stocks || []).map((s: any) => s.symbol) : null,
  }
}

function scoreRows(id: string, result: any): Row[] {
  return (result.stocks || []).map((s: any) => ({
    event_analysis_id: id,
    stock_id: s.symbol,
    stock_symbol: s.symbol,
    event_impact_score: s.eventImpactScore ?? null,
    event_impact_direction: s.eventImpactDirection ?? result.classification?.direction ?? null,
    fundamental_score: s.fundamentalScore,
    valuation_score: s.valuationScore,
    technical_score: s.technicalScore,
    risk_score: s.riskScore,
    risk_level: s.riskLevel,
    opportunity_score: s.opportunityScore,
    recommendation: s.recommendation,
    confidence: result.classification?.confidence ?? null,
  }))
}

export async function saveGuestAnalysis(result: any): Promise<string> {
  const { data: analysis } = await guestDb
    .from('event_analysis')
    .insert({ user_id: 'guest', ...analysisFields(result) })
    .select()
    .single()
  const id = analysis.id as string
  const rows = scoreRows(id, result)
  if (rows.length > 0) await guestDb.from('stock_scores').insert(rows)
  return id
}

/**
 * Re-runs a saved analysis with the current engine and rewrites it in
 * place, keeping its id (and so its place in history and the portfolio).
 * Text the current engine refuses is kept but marked, with the reason, so
 * the page can say why instead of showing the old answer.
 */
export async function refreshGuestAnalysis(
  row: Row
): Promise<'updated' | 'invalid' | 'failed'> {
  let response: Response
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: row.event_title,
        ...(Array.isArray(row.requested_symbols) && row.requested_symbols.length > 0
          ? { symbols: row.requested_symbols }
          : {}),
      }),
    })
  } catch {
    return 'failed'
  }
  const data = await response.json().catch(() => ({}))
  if (response.status === 422) {
    await guestDb
      .from('event_analysis')
      .update({ engine_version: ENGINE_VERSION, invalid_reason: data.error || 'This text is not a market event.' })
      .eq('id', row.id)
    return 'invalid'
  }
  if (!response.ok || !data.result) return 'failed'
  await guestDb.from('event_analysis').update(analysisFields(data.result)).eq('id', row.id)
  await guestDb.from('stock_scores').delete().eq('event_analysis_id', row.id)
  const rows = scoreRows(row.id, data.result)
  if (rows.length > 0) {
    const { data: inserted } = await guestDb.from('stock_scores').insert(rows).select()
    // Paper positions opened from this analysis point at its score rows;
    // re-point them at the new rows so they still show as "In Portfolio".
    const bySymbol = new Map<string, string>(((inserted as Row[]) || []).map((r) => [r.stock_symbol, r.id]))
    const { data: positions } = await guestDb.from('portfolio_positions').select('*').eq('event_analysis_id', row.id)
    for (const position of (positions as Row[]) || []) {
      const scoreId = bySymbol.get(position.symbol)
      if (scoreId) await guestDb.from('portfolio_positions').update({ stock_scores_id: scoreId }).eq('id', position.id)
    }
  }
  return 'updated'
}

export function isStaleGuestAnalysis(row: Row | null | undefined): boolean {
  return !!row && (row.engine_version ?? 1) < ENGINE_VERSION
}
