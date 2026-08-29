-- Session 6: Global markets/crypto heatmap + paper portfolio simulation.
--
-- market_snapshots mirrors news_feeds exactly: shared/system-populated data,
-- not user-owned, so any authenticated user can read it but only the
-- service-role client (bypassing RLS) can write it, via a manual "Refresh
-- Markets" action — same pattern as app/api/news/fetch/route.ts.
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type VARCHAR(10) NOT NULL CHECK (asset_type IN ('index', 'crypto')),
  symbol VARCHAR(20) NOT NULL,
  name TEXT NOT NULL,
  region TEXT,
  price FLOAT,
  change_pct FLOAT,
  market_cap BIGINT,
  fetched_at TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(asset_type, symbol)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_type ON market_snapshots(asset_type);

ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read market snapshots" ON market_snapshots
  FOR SELECT USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE policy for regular users on purpose — the refresh
-- endpoint writes via the service-role client, which bypasses RLS.

-- ── portfolio_positions: user-owned hypothetical "what if I bought" ──
-- positions, following the exact ownership + write-policy pattern watchlists
-- and saved_analyses already use (migration 001 for SELECT, 004 for writes).
CREATE TABLE IF NOT EXISTS portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  stock_scores_id UUID REFERENCES stock_scores(id),
  event_analysis_id UUID REFERENCES event_analysis(id),
  stock_id UUID REFERENCES stocks(id),
  symbol VARCHAR(10) NOT NULL,
  recommendation VARCHAR(20),
  entry_price FLOAT NOT NULL,
  entry_date TIMESTAMP DEFAULT now(),
  simulated_current_price FLOAT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_user ON portfolio_positions(user_id);

ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own portfolio positions" ON portfolio_positions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own portfolio positions" ON portfolio_positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own portfolio positions" ON portfolio_positions
  FOR DELETE USING (auth.uid() = user_id);
