-- Historical Event Engine: reference events + measured market reactions
-- Lets the platform say "in N similar past events, NIFTY/sector/stock moved X% on average"
-- instead of an LLM guessing at a return figure (see spec section 11 and 19).

CREATE TABLE IF NOT EXISTS historical_event_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  economic_variable VARCHAR(50) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  event_label TEXT NOT NULL,
  event_date DATE,
  sector VARCHAR(50),
  nifty_return_1d FLOAT,
  nifty_return_3d FLOAT,
  nifty_return_5d FLOAT,
  nifty_return_20d FLOAT,
  sector_return_1d FLOAT,
  sector_return_3d FLOAT,
  sector_return_5d FLOAT,
  sector_return_20d FLOAT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_historical_event_type ON historical_event_reactions(event_type, economic_variable, direction);

ALTER TABLE historical_event_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Historical reactions are readable by any authenticated user" ON historical_event_reactions
  FOR SELECT USING (auth.role() = 'authenticated');
