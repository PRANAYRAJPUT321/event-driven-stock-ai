# How to use this file

1. **Capture the screenshots first** — see the checklist at the very bottom of this file. Claude chat cannot open your app or take screenshots; it can only use images you upload.
2. **Start a new conversation on claude.ai** and attach: your screenshots, and (optionally) `PULSE_AI_in_Finance_Report.pdf` as a reference for what *not* to repeat.
3. **Copy everything between the two `═══` lines below** and paste it as your first message.
4. Fill in the `<< >>` placeholders (your names, roll numbers, guide, institute) before sending.

---

═══════════════════════ COPY FROM HERE ═══════════════════════

You are helping me write my final capstone project report. I need a polished, submission-ready **Microsoft Word (.docx)** document of **30–35 pages**. Please read this entire brief before writing anything.

## 1. Who this is for

- **Subject:** Artificial Intelligence in Finance
- **Authors:** << PRANAY — full name >>, Roll No. << >> and << PRANIL — full name >>, Roll No. << >>
- **Specialization:** << e.g. Finance / Data Science >>
- **Guide:** << Prof. Name, Designation >>
- **Institute:** << Full institute / university name >>
- **Academic year:** << 20__ – 20__ >>

Skip any certificate page and declaration page — my college does not require them. Begin with the title page, then Acknowledgement, then Table of Contents, then List of Figures, then Chapter 1.

## 2. Mandatory formatting

- Font: **Times New Roman**, body **12 pt**, headings **14 pt** bold
- Line spacing: **1.5** throughout
- Alignment: **justified** for all body text
- Margins: **1 inch** on all four sides
- Page size: A4
- Every figure gets a caption below it: *Figure N — description.* Captions italic, 10–11 pt, centred
- Every table gets a caption above it: *Table N — description.*
- Page numbers bottom-centre
- Chapter headings start on a new page

## 3. What was wrong with my previous attempt (please do better)

I already generated one version of this report and it was weak. Specifically:

- **Structure was flat** — it read as one long essay with headings, not as a report. I want clear chapter openings, short lead paragraphs, sub-sections that actually break up the text, and tables used wherever data is being presented.
- **Data was presented as prose** instead of as tables and comparisons. Numbers buried in sentences are hard to read and hard to mark.
- **Screenshots were dumped in without integration** — they appeared without enough explanation, and several showed the app in a degraded state with empty panels. This time, every figure must be referenced in the body text *before* it appears ("Figure 7 shows…"), and the text must explain what the reader is looking at and why it matters.
- It was not engaging. This is a report about AI, and it read like a manual.

**Make this version visually structured and genuinely interesting to read.** Use tables heavily. Use short paragraphs. Use concrete examples. The examiner should be able to flip through it and immediately see effort and substance.

## 4. The single most important instruction

This report is for an **AI in Finance** subject, so **the artificial intelligence must be the centre of gravity of the entire document** — not a chapter, the *spine*.

At every point, answer these questions explicitly:
- What exactly is the AI doing here?
- What does it do that ordinary code could not?
- Where does it get its data from, and how?
- What happens when it fails or is unavailable?
- How do we know its answer is trustworthy?

Chapters 7, 8, 9 and 10 (below) are the heart of the report. Give them the most space and the most care. Roughly 40% of the total page count should sit in those four chapters.

## 5. Required chapter structure

Follow this exactly. The sub-sections are suggestions you may refine, but keep all 15 chapters and the annexures.

**Front matter:** Title page · Acknowledgement · Table of Contents · List of Figures · List of Tables

1. **Executive Summary** — the problem, what was built, the AI contribution, principal findings
2. **Introduction to the Study** — background on event-driven investing in India; why retail investors cannot connect news to portfolio action; the case for AI; why explainability is non-negotiable in finance
3. **Objectives of the Study** — primary objectives, secondary objectives, and 4 stated research questions
4. **Scope and Limitations** — what the system covers and, honestly, what it does not
5. **Research Methodology and Secondary Data Sources** — research design, every data source named with its endpoint, evaluation method
6. **System Architecture** — ⭐ **give this a full page for the architecture diagram** (see §8)
7. **The Artificial Intelligence Engine** — the hybrid design, what the LLM does, what the deterministic engine does, why the fallback exists, cost governance
8. **End-to-End Analysis Flow** — ⭐ **a full page for the flow diagram**, then a step-by-step walkthrough of one real event
9. **What the AI Actually Does — APIs and Data Fetching** — the 14 API routes, how market data is fetched, how news reaches the AI, caching
10. **Data Analysis and Interpretation** — the system in operation with real outputs, worked examples
11. **Technology Stack and Coding Elements** — every technology, and the specific programming concepts applied
12. **Findings and Discussion** — answer each research question from Chapter 3 directly
13. **Conclusion, Suggestions and Future Scope** — ⭐ keep future scope to **one short, punchy paragraph**
14. **Bibliography and References**
15. **Annexures** — A: Deployment and access · B: Interface, dark theme · C: Interface, light theme · D: Responsive layout · E: GitHub repository · F: The 15 transmission channels · G: Scoring factors and weights

## 6. The project — all facts you need (do not invent anything beyond this)

### Identity
- **Name:** PULSE — an event-driven stock market intelligence platform for Indian equities
- **Live application:** https://event-driven-stock-ai-wnj4.vercel.app
- **Health/diagnostics endpoint:** https://event-driven-stock-ai-wnj4.vercel.app/api/health
- **Source code:** https://github.com/PRANAYRAJPUT321/event-driven-stock-ai
- **Hosting:** Vercel (serverless functions, edge caching, automatic deploys from the `main` branch)
- **Scale:** 48 commits, ~9,700 lines of TypeScript/TSX, 13 pages, 14 API routes

### The problem it solves
A retail investor reads "RBI hikes repo rate by 25 bps". They cannot answer: which sectors does this hit, which companies inside those sectors, in which direction, how hard, and is it already priced in? PULSE takes a plain-English event sentence and returns a ranked, explained, evidence-scored answer.

### The hybrid AI architecture — the report's central idea
Two engines, deliberately:

1. **A large language model (Claude, via the Anthropic API)** performs *structured extraction from unstructured text*. It reads a free-form sentence and returns typed JSON: event type, economic variable, direction, magnitude 0–100, affected sectors, and a transmission explanation. It also writes the bull case, bear case and contradictory evidence. This is the task no amount of hand-written logic does well, because the input is natural language with unbounded phrasing.

2. **A deterministic rule engine** (`lib/ai/ruleClassifier.ts`, ~700 lines) encodes **15 transmission channels** as pattern tables: `policy_rate, inflation, crude, currency, growth, fiscal, earnings, global, geopolitical, regulatory, ratings, ma, capital_return, management, employment`. It produces the same typed output from keyword matching, direction detection (up/down vocabulary with position-based tie-breaking), and a sector mapping.

**Every model call is wrapped in a fallback.** If the API key is absent, out of credit, rate-limited, times out, or returns malformed JSON, the deterministic engine answers instead and the reason is logged. A partially valid model response is repaired field-by-field from the deterministic answer. **Consequence: the application runs correctly with no AI key configured at all.** The language model improves the output; it cannot break the product.

This is the architectural argument the report should make: *in finance, an AI feature that can go dark when a bill goes unpaid is not a feature — it is a liability. The correct design is AI as an enhancement layer over a deterministic floor.*

**Cost governance:** anonymous requests never consume model tokens — they are served by the rule engine. Only authenticated requests may call the model. This was introduced after a self-review found an open, unmetered endpoint making two model calls per anonymous request.

### Event taxonomy produced
14 event types: `MONETARY_POLICY, INFLATION, GDP, EMPLOYMENT, COMMODITY_SHOCK, CURRENCY, GOVERNMENT_POLICY, REGULATORY, EARNINGS, DIVIDEND, CREDIT_RATING, MANAGEMENT_CHANGE, GEOPOLITICAL, GLOBAL_MARKET_SHOCK` — plus `OTHER`, which is the engine declining to guess.

### Data sources — all keyless, zero paid APIs
This is a deliberate design decision worth a paragraph: the project originally used Twelve Data and NewsAPI, both of which required keys, and both of which broke the app when the keys were missing or exhausted. All of it was replaced with endpoints that answer anonymous callers.

| Need | Source | Endpoint | Key |
|---|---|---|---|
| Indices, commodities, FX, equities | Yahoo Finance | `v8/finance/chart` | None |
| Company fundamentals | Yahoo Finance | `v10/finance/quoteSummary` (cookie + crumb handshake, cached 10 min) | None |
| Cryptocurrency | CoinGecko | `/simple/price` in INR | None |
| Indian news | Google News RSS | `hl=en-IN&gl=IN&ceid=IN:en` | None |
| Company news | Yahoo Finance RSS | per-symbol headline feed | None |
| Auth + database | Supabase | Postgres with Row Level Security | Yes |
| Language model | Anthropic Claude | Messages API | Optional |

**Coverage:** 21 instruments in the always-on market bar; 66 in the full heatmap (Indian sector indices, 27 world indices across the Americas/Europe/Asia, the commodity complex, INR crosses); 52 NIFTY 50 constituents with correct NSE symbols and sector tags; top cryptocurrencies in INR.

### The 14 API routes
`/api/analyze` · `/api/news/analyze` · `/api/news/impact` · `/api/news/live` · `/api/news/fetch` · `/api/market/live` · `/api/market/equities` · `/api/market/crypto` · `/api/stocks` · `/api/stocks/quote` · `/api/stocks/prices` · `/api/stocks/history` · `/api/scores` · `/api/health`

Only `/api/stocks` and `/api/scores` require the database. Everything else works without it.

### The scoring engine
Six weighted factors:

| Factor | Weight | Source |
|---|---|---|
| Event impact | 0.25 | Classification direction × magnitude |
| Historical reaction | 0.20 | Past sector reaction to similar events |
| Fundamental strength | 0.20 | ROE, growth (Yahoo) |
| Valuation | 0.15 | P/E, P/B vs the peer median *measured in this analysis* |
| Technical condition | 0.10 | Price vs SMA 50/200, RSI |
| Risk | 0.10 | Volatility, leverage |

Technicals are computed from one year of daily closes: **Wilder's 14-period RSI**, **SMA 50 and SMA 200**, **annualised volatility from log returns**, and the **52-week range**. These were verified against an independently written reference implementation and match to four decimal places.

**The critical design decision:** a factor that cannot be sourced is **excluded**, and the remaining weights are **renormalised** — rather than substituting a neutral 50, which would silently drag every score toward the middle. The response reports its own `coverage` (the share of weight that had real data behind it) and names the excluded factors.

### Two-sided impact analysis
Every event names **who it helps and who it hurts through the same mechanism**, per sector and per company. Example the report should use: a repo-rate hike is **MIXED** for Banking — banks reprice floating-rate loans upward faster than deposits, so net interest margin widens for two to three quarters; then deposit costs catch up and loan growth slows. It is unambiguously **NEGATIVE** for Auto and Consumer, where EMI-driven demand is deferred. A single arrow would have lost all of that.

### Honest treatment of missing data — a strong talking point
The project explicitly refuses to state more than it has measured:
- An unclassifiable headline returns `OTHER` with low confidence and **no** sector claims.
- A stock with no company-level data is returned **UNRATED**, not AVOID. (A composite built only from event factors is identical for every company in a sector, so it ranks nothing — and because a bare event score usually falls below the HOLD threshold, it previously came out as a confident "AVOID" on companies the system had no data about.)
- An unsourced figure renders as "—", never as 0.
- Affected sectors with no constituent in the NIFTY 50 universe are reported as such, rather than being filled with unrelated companies.

### Testing and verification — use this for Chapter 12
A full smoke test was run against the live application. It covered all 14 API routes, all 13 pages in both themes at desktop (1280 px) and mobile (375 px) widths, the parsing layer against realistic upstream payloads, and the mathematics against an independent implementation.

- **101 automated checks** pass, with **no network and no API keys required** (`npm run test:rules`)
- TypeScript compiles clean; production build clean
- All 52 page loads returned HTTP 200 with no JavaScript errors, no blank pages, no layout overflow

**It found four real defects, all since fixed.** This belongs in the Findings chapter — a report that documents its own bug hunt is far stronger than one that claims perfection:

| # | Defect | Why it mattered | Fix |
|---|---|---|---|
| 1 | Stocks with no data were labelled **AVOID** | Absence of evidence was being rendered as a negative verdict on real listed companies | Added an `UNRATED` state gated on company-specific evidence |
| 2 | A crude-oil shock returned **six banks** as the affected companies | The sector-to-company lookup fell back to the first six names of the index when no sector matched | Strict matching; unmatched sectors now reported explicitly |
| 3 | The narrative described component scores that were never computed | It asserted a comparison that never happened | The no-data case now names the missing evidence as the risk |
| 4 | Unsourced factors were drawn as a red **0** | Reads as a company scoring zero out of a hundred | Renders an em dash |

Earlier self-review had also caught a percentage-change bug: the system derived the previous close from `chartPreviousClose`, which is the close *before the requested range*, so a five-day move was being displayed as "today's move". Now derived from the second-to-last point of the daily series.

### Technology stack
Next.js 14 (App Router) · TypeScript · Tailwind CSS driven by CSS custom properties · React 18 · Recharts · Supabase (`@supabase/ssr`, `@supabase/supabase-js`) · Anthropic SDK · `fast-xml-parser` · Vercel serverless.

### Coding elements to cover in Chapter 11
TypeScript discriminated unions and strict null types (`number | null` throughout the scoring layer, so "unknown" is a type the compiler enforces) · `Promise.allSettled` for partial-failure tolerance across ~66 parallel upstream requests · React hooks and client/server component separation · HTTP cache-control with `s-maxage` and `stale-while-revalidate` · Row Level Security policies in PostgreSQL · regular expressions with word-boundary matching · an inline pre-paint script to prevent theme flash · graceful degradation as an architectural pattern · a zero-dependency test harness compiled with the project's own `tsc`.

### Interface
Neon theme in **both dark and light**, defined once as CSS custom properties and redefined per theme — so both modes are one token set, not two sets of components. Dark: near-black `#05060a`, electric cyan accent `#00e5ff`, lime for buy. Light: the same hues deepened for contrast on near-white. Theme is applied before first paint and remembered per browser.

## 7. Tone, style and the examples I want

Write in clear, confident, readable English. Short paragraphs. Active voice. No filler.

**I want worked examples using our names.** Use **Pranay** and **Pranil** as the characters in illustrative scenarios — for instance, "Pranay reads that the RBI has raised the repo rate and wonders whether to hold his HDFC Bank position; Pranil wants to know whether the same news helps or hurts Maruti." Then show what PULSE returns for each. Make these examples do real explanatory work, not decoration.

Where a simple illustration would help a concept land (how an event propagates to a sector to a company; what a fallback is), describe a **simple, friendly diagram** in a clearly marked box that I can draw or generate, e.g.:

> **[ILLUSTRATION 3]** A friendly cartoon: Pranay at a laptop reading a news headline; an arrow to a "PULSE brain" icon split into two halves labelled "Language Model" and "Rule Engine"; arrows out to three company cards marked +, − and ~.

List every such illustration box in one place at the end so I can produce them.

## 8. Diagrams — two of these must each fill a full page

**Figure: System Architecture (full page, Chapter 6)** — four horizontal layers: (1) Data sources: Yahoo Finance, Google News RSS, CoinGecko, Supabase; (2) Server layer: the 14 API routes with caching; (3) Intelligence layer: the LLM and the rule engine side by side with the fallback arrow between them, then the scoring engine; (4) Presentation: the 13 pages. Show which arrows require a key and which do not.

**Figure: End-to-End Analysis Flow (full page, Chapter 8)** — the nine steps from typed sentence to ranked recommendation:
1. User types an event sentence → 2. Classification (LLM, or rule engine on any failure) → 3. Event type, variable, direction, magnitude, affected sectors → 4. Sectors mapped to NIFTY 50 constituents → 5. Live market data fetched per company in parallel → 6. Six factors scored, missing ones excluded and weights renormalised → 7. Composite score with coverage → 8. Counter-argument: bull case, bear case, contradictory evidence → 9. Ranked output; persisted only if signed in.

Annotate clearly which steps need **no database** (2–7) and which need **no AI key** (all of them).

Produce these as clean, labelled diagrams. If you can generate them as images, do so; otherwise give me precise, self-contained descriptions in bordered boxes that I can draw.

## 9. Figures from the screenshots I have attached

I am attaching screenshots. Place them as follows, **each introduced in the body text before it appears**:

- Chapter 10: the markets heatmap, the analysis result with the score gauge, the transmission mechanism panel, the two-sided sector impact panel, the stock profile page, the discover/news feed
- Annexure B: the full dark-theme interface set
- Annexure C: the same screens in light theme (to evidence the dual-theme system)
- Annexure D: the mobile-width captures
- Annexure E: the GitHub repository — repository home, commit history, and the file tree

If a screen I have given you does not match a figure slot, use your judgement and tell me at the end which slots are still empty.

## 10. Hard rules

- **Do not invent any number, result, metric or finding.** Everything factual must come from this brief or from the screenshots I attached. If you need a figure I have not given you, insert `<< NEED: description >>` and list all of them at the end.
- **Do not claim backtested returns, accuracy percentages, user studies or performance benchmarks.** None were conducted. The evaluation was a functional and correctness smoke test, and the report must say exactly that.
- Keep the honest limitations in Chapter 4: daily data not intraday; the universe is 52 NIFTY 50 names; the rule engine is keyword-based, not trained on labelled data; no backtest of recommendation quality; the system is an analytical aid and not investment advice.
- Include an educational-use disclaimer.

## 11. How to deliver

Build the report in order, chapter by chapter, so I can follow and correct as you go. When the text is complete and I confirm it, generate the final **.docx** with all the formatting in §2 applied, images embedded in place, captions, a working Table of Contents and page numbers.

If the document is too large to produce in one go, build it in parts and assemble at the end — but tell me the plan before you start.

Start by giving me a one-page outline showing the page budget per chapter, so I can approve the shape before you write the body.

═══════════════════════ COPY TO HERE ═══════════════════════

---

# Screenshot capture checklist — do this before pasting the prompt

Your app is live and public now, so your browser can see real market data that my sandbox could not reach. **This is why the previous screenshots looked empty — take these yourself and the report will be far stronger.**

Open **https://event-driven-stock-ai-wnj4.vercel.app** during Indian market hours (9:15 am – 3:30 pm IST, Mon–Fri) so the numbers are live and moving.

Use the theme toggle in the top-right to switch modes. On Windows, `Win + Shift + S` captures a region; full-page capture is better where noted (in Chrome: `F12` → `Ctrl+Shift+P` → type "capture full size screenshot").

### Dark theme — desktop, full browser width
1. `/markets` — NIFTY 50 stocks tab, tiles populated with live prices
2. `/markets` — World Indices tab
3. `/markets` — Commodities tab
4. `/markets` — Crypto tab
5. `/discover` — live news headlines
6. `/analyze` — the empty form before submitting
7. `/analyze` — **full-page** result for "RBI hikes repo rate by 25 bps to 6.75% citing sticky inflation"
8. Close-up: the score gauge and recommendation badge
9. Close-up: the Transmission Mechanism panel
10. Close-up: the Sector & Company Impact panel showing both positive and negative points
11. Close-up: the Bull Case / Bear Case / Contradictory Evidence block
12. `/stocks/RELIANCE` — **full-page**, price chart and statistics
13. `/dashboard`, `/history`, `/watchlist`, `/portfolio` — signed in
14. `/auth/login`
15. `/api/health` — the raw JSON, as evidence the diagnostics work

### Light theme — repeat at least these six
`/markets`, `/discover`, `/analyze` result, `/stocks/RELIANCE`, `/dashboard`, `/auth/login`

### Mobile width
Press `F12`, click the device-toolbar icon, choose iPhone or set width to 375 px. Capture `/markets`, `/analyze` result and `/stocks/RELIANCE` in **both** themes.

### GitHub — three shots
1. https://github.com/PRANAYRAJPUT321/event-driven-stock-ai — repository home with the README visible
2. https://github.com/PRANAYRAJPUT321/event-driven-stock-ai/commits/main — the commit history
3. The file tree, with `app/`, `lib/` and `components/` expanded

**Name the files descriptively** before uploading — `dark-markets-nifty.png`, `light-analyze-result.png`, `github-commits.png` — so Claude can place each one correctly without guessing.

### Also attach
`PULSE_AI_in_Finance_Report.pdf` (the earlier version) — tell Claude it is the weak draft being replaced, so it can see the structure and improve on it rather than repeat it.
