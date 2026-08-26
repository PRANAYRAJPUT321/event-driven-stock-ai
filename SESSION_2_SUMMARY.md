# SESSION 2: Stock Analysis Pipeline + Real Bug Fixes

## What changed since Session 1

Session 1 built pages and API skeletons but the code had never actually
been run. Session 2 did two things: wired the analysis pipeline end-to-end,
and — for the first time — actually installed, type-checked, built, and
booted the project to verify it works.

## Pipeline now fully wired

`POST /api/analyze` runs the complete chain in one request:

1. AI classifies the event (type, direction, magnitude, sectors, and now
   also a plain-English transmission explanation: event -> economic
   variable -> mechanism -> sector -> company)
2. Historical Event Engine looks up matching past events in
   `historical_event_reactions` and averages NIFTY/sector returns across
   1D/3D/5D/20D windows — this is real lookup+averaging, not an AI guess
3. Candidate stocks are pulled from the seeded `stocks` table by sector
4. Each stock gets deterministic fundamental/valuation/technical/risk
   scores from `lib/market/mockData.ts` (seeded per-symbol so numbers are
   stable, not random each run) fed through the existing scoring formulas
5. AI counter-argument engine explains and challenges the top-scoring
   stock's numbers (bull case / bear case / contradictory evidence / key
   risks) — it's given the scores as input, it does not invent them
6. Everything persists: `event_analysis` (parent record) + one
   `stock_scores` row per candidate stock

Results page now shows historical NIFTY/sector evidence, contradictory
evidence, risk-level badges per stock, and a disclaimer footer (the spec
explicitly requires no fabricated target prices / no guaranteed-return
framing — section 19).

## Real bugs found by actually building (not by review)

Session 1's code looked complete but had never been run. Running
`npm install`, `tsc --noEmit`, and `next build` for the first time
surfaced bugs that would have blocked everything:

- **`@supabase/ssr` was imported but never installed** — `package.json`
  listed `@supabase/auth-helpers-nextjs` instead. Auth would not have
  compiled at all.
- **`@anthropic-ai/sdk` was pinned to `0.9.x`**, an old completions-only
  version with no `.messages` API. Every AI call in the app would have
  thrown `Property 'messages' does not exist` at runtime. Upgraded to
  `0.120.x`.
- **Login page's `useSearchParams()` had no Suspense boundary** — fails
  Next.js's static export requirement. Split into an inner `LoginForm` +
  `Suspense` wrapper.
- A handful of TypeScript strictness errors (implicit `any`, a `User`
  type mismatch on the dashboard).

## Verified, not claimed

- `npm install` — succeeds
- `npx tsc --noEmit` — 0 errors
- `npm run build` — all 14 routes generate successfully
- `npm run start` + `curl` — `/` returns 307 (redirects to login as
  intended), `/auth/login` returns 200

## Still open

- GitHub push is blocked from this sandbox by a proxy-level repository
  allowlist — confirmed with two separate tokens, identical error both
  times. This is not fixable with more tokens; see the conversation for
  the two real paths forward (push from your machine, or check for a
  repo-connector setting in the Cowork app).
- Live market/fundamental data is still mock (seeded, deterministic) —
  by design for Stage 1 per the original spec (section 31).
- Watchlist/history pages are still UI-only skeletons — no CRUD wired yet.
- No automated tests yet.
