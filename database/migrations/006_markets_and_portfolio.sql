-- Session 6 (revised): paper portfolio simulation.
--
-- This migration originally also created a `market_snapshots` table that a
-- manual "Refresh Markets" button wrote into. That's gone: indices,
-- commodities, FX and crypto are now fetched live from keyless public feeds
-- on every request (lib/market/yahooFinance.ts + lib/market/cryptoProvider.ts,
-- served by /api/market/live and /api/market/crypto and cached at the edge).
-- Nothing reads a cached market table any more, so it isn't created here.
--
-- If you ran an earlier copy of this file, the leftover table is harmless and
-- can be dropped at your convenience:
--   DROP TABLE IF EXISTS market_snapshots;

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

-- DROP-then-CREATE so this file can be re-run safely; CREATE POLICY has no
-- IF NOT EXISTS form, and a half-applied migration is the usual reason
-- someone runs it twice.
DROP POLICY IF EXISTS "Users can view their own portfolio positions" ON portfolio_positions;
CREATE POLICY "Users can view their own portfolio positions" ON portfolio_positions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own portfolio positions" ON portfolio_positions;
CREATE POLICY "Users can insert their own portfolio positions" ON portfolio_positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own portfolio positions" ON portfolio_positions;
CREATE POLICY "Users can delete their own portfolio positions" ON portfolio_positions
  FOR DELETE USING (auth.uid() = user_id);
