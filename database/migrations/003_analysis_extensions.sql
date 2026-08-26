-- Session 2 extensions: transmission explanation, counter-argument fields,
-- and risk classification on stock scores.

ALTER TABLE events ADD COLUMN IF NOT EXISTS transmission_explanation TEXT;
ALTER TABLE event_analysis ADD COLUMN IF NOT EXISTS contradictory_evidence TEXT;
ALTER TABLE event_analysis ADD COLUMN IF NOT EXISTS historical_summary JSONB;
ALTER TABLE stock_scores ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);
ALTER TABLE stock_scores ADD COLUMN IF NOT EXISTS event_impact_direction VARCHAR(20);
