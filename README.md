# 📊 Event-Driven Stock Market Intelligence Platform

An AI-powered investment analysis platform for the Indian equity market that transforms financial news and economic events into actionable, explainable investment recommendations.

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

## 📋 Session Progress

### Session 1: Foundation ✅
- [x] Next.js + TypeScript + Tailwind setup
- [x] Supabase project configured
- [x] Authentication (signup/login/logout)
- [x] Database schema with RLS policies
- [x] Dashboard UI
- [x] Analyze event page
- [x] Event classification API
- [x] Initial commit to GitHub

### Sessions 2-5: Core Features (In Progress)
- [ ] Stock analysis engines (fundamentals, valuation, technical, risk)
- [ ] Event opportunity scoring
- [ ] BUY/HOLD/AVOID decision logic
- [ ] Counter-argument generation
- [ ] Results display with visualizations
- [ ] Saved analyses & history
- [ ] Watchlist functionality
- [ ] News feed integration
- [ ] Testing & deployment

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

**Color Palette:**
- Primary: #2563EB (Blue)
- Success: #10B981 (Green)
- Warning: #F59E0B (Amber)
- Danger: #EF4444 (Red)
- Neutral: #6B7280 (Gray)

**Responsive:** Mobile-first design with Tailwind breakpoints (md, lg, xl)

## 🔒 Security

- Row Level Security (RLS) on all user-specific tables
- No API keys exposed in frontend code
- Environment variables for secrets
- Secure password hashing (Supabase Auth)
- HTTPS enforced (Vercel)

## 📚 API Endpoints

- `POST /api/analyze` - Classify event and create analysis
- `GET /api/stocks` - Get stock list (future)
- `POST /api/watchlist` - Add to watchlist (future)

## 🚧 Roadmap

**Phase 1 (Current):** MVP - Event input, classification, analysis
**Phase 2:** News feed, historical analysis, advanced scoring
**Phase 3:** Fundamental analysis, backtesting, portfolio features
**Phase 4:** Real-time data, ML models, advanced charting

## 📄 License

MIT

## 👤 Author

Built for capstone project at [Your University]

## 📞 Support

For issues or questions, please create a GitHub issue.

---

**Made with ❤️ using Claude AI**
