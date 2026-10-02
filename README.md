<div align="center">

# 📊 Event-Driven Stock Market Intelligence Platform

**Turn financial news into explainable investment insights for the Indian equity market.**

![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_AI-D97757?style=flat-square&logo=anthropic&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-64748b?style=flat-square)

[Overview](#-project-overview) · [Features](#-key-features) · [Getting Started](#-getting-started) · [Architecture](#-architecture-flow) · [API](#-api-endpoints) · [Roadmap](#-roadmap) · [Authors](#-authors)

</div>

---

## 🎯 Project Overview

This platform answers a critical investment question:
> **Given a financial event, which Indian stocks/sectors will be affected, how strong is the historical evidence, and should I invest?**

Unlike generic stock recommendation systems, this platform is **event-driven** - every recommendation is connected to a specific financial/economic event.

## ✨ Key Features

- **📰 Event Intelligence Engine** - AI classifies financial events (RBI policy, earnings, geopolitical shocks)
- **⚡ Financial Transmission Analysis** - Maps how events flow: Economic Variable → Sectors → Stocks
- **📈 Stock Analysis** - Multi-factor analysis: fundamentals, valuation, technicals, risk
- **🎯 Event Opportunity Scoring** - 0-100 score combining all signals with explainable reasoning
- **🔄 Counter-Argument Engine** - Provides bull/bear cases and key risks before recommendations
- **🔐 Secure User Accounts** - Save analyses, build watchlists with Row Level Security
- **📰 Live News Discovery** - Auto-categorizes breaking financial news by sector
- **📊 Live Market Bar** - Domestic and world indices, commodities and INR crosses on every page
- **📡 Live News Impact** - Per-event feed of what is being published about the affected sectors and companies
- **🌗 Neon light & dark themes** - Theme set before first paint, remembered per browser

## 🏗️ Tech Stack

- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS + Recharts
- **Backend:** Next.js API Routes + Server Actions
- **Database:** Supabase PostgreSQL with Row Level Security
- **Authentication:** Supabase Auth (Email/Password)
- **AI:** Claude (Anthropic API), optional — a deterministic rule engine takes over whenever it is unavailable
- **Deployment:** Vercel
- **Market data:** Yahoo Finance + CoinGecko (keyless public endpoints)
- **News:** Google News and Yahoo Finance RSS (keyless)

## 🏆 Highlights

- **Real data only** — every price, fundamental and headline comes from a live, keyless public source; values that can't be sourced are reported as missing, never simulated
- **AI optional, never required** — a deterministic rule engine produces the full analysis on its own; Claude adds narrative depth when available
- **Two-sided impact** — every event shows both the likely winners and the likely losers
- **Works without a database** — analysis, markets and news run with no setup; Supabase only adds accounts and saved data
- **Tested offline** — 101 checks that run with no network and no API keys

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account (free tier) — the only required service
- Anthropic API key (optional; without it the app uses its offline rule engine)

No other keys are needed: market, crypto and news data all come from keyless
public feeds.

### What works without a database

Supabase stores accounts and everything user-owned — saved analyses,
watchlists, portfolio positions. The rest of the app does not depend on it:

| Works with no database | Needs Supabase |
|---|---|
| Live market bar and `/markets` heatmap | Sign-in and accounts |
| `/stocks/[symbol]` price, chart, statistics, fundamentals | Saving an analysis to history |
| `/analyze` — classification, scoring and the bull/bear narrative | Watchlist and paper portfolio |
| Live news impact per sector and company | Storing a news feed that accumulates |
| `/discover` headlines, read live from RSS | — |

An analysis run without a database returns the full result and says it was
not saved. `/api/health` reports what this deployment can actually reach.

### Installation

```bash
# Clone repository
git clone https://github.com/PRANAYRAJPUT321/event-driven-stock-ai.git
cd event-driven-stock-ai

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

Visit http://localhost:3000

### Tests

```bash
npm run test:rules
```

Exercises the parts that must keep working with no API keys and no network:
the deterministic event classifier, the RSS parser, and the Yahoo Finance
response parser. No test framework or extra dependency required.

## 📊 Database Schema

Core tables:
- `users` & `profiles` - User management
- `events` - Financial events entered by users
- `event_analysis` - Full analysis results
- `stocks` - NIFTY 50 + top stocks
- `stock_market_data` - Price/volume data
- `fundamental_metrics` - Company fundamentals
- `stock_scores` - Analysis scores per stock
- `watchlists` - User's watched stocks
- `saved_analyses` - User's saved reports

All user-specific tables have RLS policies enforcing data isolation.

## 🔄 Architecture Flow

```
User Input (Event)
      ↓
AI Event Classification
      ↓
Financial Transmission Analysis
      ↓
Affected Sectors & Stocks
      ↓
Stock Analysis (Multi-factor)
      ↓
Event Opportunity Scoring
      ↓
Decision Engine (BUY/HOLD/AVOID)
      ↓
Counter-Argument & Explainability
      ↓
Save to User Account
```

## 📝 Usage Example

1. **Sign Up** → Create account
2. **Enter Event** → "RBI raises repo rate by 25 bps"
3. **AI Analyzes** → Event classified, sectors identified
4. **View Results** → Top affected stocks with scores
5. **Get Recommendation** → BUY/HOLD/AVOID with reasoning
6. **Save Analysis** → For future reference

## 🎨 Design System

Every colour is a CSS custom property defined in `app/globals.css`, so the
two themes are one token set redefined rather than two sets of components.
Tailwind reads those properties through `tailwind.config.ts`.

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#00e5ff` electric cyan | `#00718c` deepened for contrast |
| `--buy` | `#3dff9e` lime | darkened equivalent |
| `--hold` | amber | darkened equivalent |
| `--avoid` | hot red | darkened equivalent |
| `--bg` | `#05060a` near-black | near-white |

The theme is applied by a tiny inline script in `app/layout.tsx` before first
paint, so neither mode flashes the other on load. It defaults to the device
preference and is remembered per browser.

**Responsive:** mobile-first, verified at 375px and 1280px in both themes.

## 🔒 Security

- Row Level Security (RLS) on all user-specific tables
- No API keys exposed in frontend code
- Environment variables for secrets
- Secure password hashing (Supabase Auth)
- HTTPS enforced (Vercel)

## 📚 API Endpoints

| Route | Purpose | Key needed |
|---|---|---|
| `POST /api/analyze` | Classify an event, score the affected stocks, build the narrative | No |
| `POST /api/news/analyze` | Two-sided impact read for one headline | No |
| `POST /api/news/impact` | Headlines grouped per affected sector and company | No |
| `GET /api/news/live` | Live headlines from RSS | No |
| `POST /api/news/fetch` | Fetch and categorise news into the database | No |
| `GET /api/market/live` | Indices, commodities and FX (`?scope=full` for the heatmap set) | No |
| `GET /api/market/equities` | Live quotes for every NIFTY 50 constituent | No |
| `GET /api/market/crypto` | Top cryptocurrencies in INR | No |
| `GET /api/stocks/quote` | Single-symbol quote | No |
| `GET /api/stocks/prices` | Batch quotes for a symbol list | No |
| `GET /api/stocks/history` | Daily closes for a range | No |
| `GET /api/stocks` | Stock reference data | Supabase |
| `POST /api/scores` | Persist per-stock scores | Supabase |
| `GET /api/health` | What this deployment can actually reach | No |

## 🚧 Roadmap

**Delivered:** event input and classification, transmission analysis, live
market and news layers, multi-factor scoring over real market data, the
counter-argument engine, history, watchlist and paper portfolio.

**Next:** intraday rather than daily data; backtesting a classified event
against the sector's own historical reaction; a trained classifier to
replace the keyword tables where labelled data exists; alerting on events
that match a saved thesis.

## 📄 License

MIT

## 👤 Authors

Built by **[Pranay Dadghaye](https://github.com/PRANAYRAJPUT321)** and **Pranil** as an academic project for the subject *Artificial Intelligence in Finance*, PGDM Finance at **Imperial School of Banking and Management Studies**.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Pranay_Dadghaye-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/pranay-dadghaye-ba89a7278)
[![Email](https://img.shields.io/badge/Email-pranaydadghaye%40gmail.com-D14836?style=flat-square&logo=gmail&logoColor=white)](mailto:pranaydadghaye@gmail.com)

> **Disclaimer:** This project is for educational purposes only and is not investment advice. Always do your own research before investing.

## 📞 Support

For issues or questions, please [open a GitHub issue](https://github.com/PRANAYRAJPUT321/event-driven-stock-ai/issues). Development notes from each build session are in [`docs/dev-log/`](docs/dev-log/).

---

**Made with ❤️ using Claude AI**
