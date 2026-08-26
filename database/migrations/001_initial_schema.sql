-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  investment_experience VARCHAR(50),
  risk_profile VARCHAR(50),
  investment_horizon VARCHAR(50),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (id)
);

-- Create stocks table
CREATE TABLE IF NOT EXISTS stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(10) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sector VARCHAR(50),
  industry TEXT,
  market_cap BIGINT,
  pe_ratio FLOAT,
  pb_ratio FLOAT,
  dividend_yield FLOAT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Create stock_market_data table
CREATE TABLE IF NOT EXISTS stock_market_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID REFERENCES stocks(id),
  date DATE,
  open_price FLOAT,
  high_price FLOAT,
  low_price FLOAT,
  close_price FLOAT,
  volume BIGINT,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(stock_id, date)
);

-- Create fundamental_metrics table
CREATE TABLE IF NOT EXISTS fundamental_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID REFERENCES stocks(id),
  revenue_growth FLOAT,
  profit_growth FLOAT,
  roe FLOAT,
  roce FLOAT,
  debt_equity FLOAT,
  interest_coverage FLOAT,
  fcf BIGINT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(stock_id)
);

-- Create events table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  event_type VARCHAR(50),
  economic_variable VARCHAR(50),
  direction VARCHAR(20),
  magnitude FLOAT,
  confidence FLOAT,
  created_at TIMESTAMP DEFAULT now()
);

-- Create event_analysis table
CREATE TABLE IF NOT EXISTS event_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  event_id UUID REFERENCES events(id),
  event_title TEXT,
  affected_sectors TEXT[],
  opportunity_score FLOAT,
  composite_score FLOAT,
  recommendation VARCHAR(20),
  bull_case TEXT,
  bear_case TEXT,
  risks TEXT[],
  analysis_json JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Create stock_scores table
CREATE TABLE IF NOT EXISTS stock_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_analysis_id UUID REFERENCES event_analysis(id),
  stock_id UUID REFERENCES stocks(id),
  stock_symbol VARCHAR(10),
  event_impact_score FLOAT,
  fundamental_score FLOAT,
  valuation_score FLOAT,
  technical_score FLOAT,
  risk_score FLOAT,
  opportunity_score FLOAT,
  recommendation VARCHAR(20),
  confidence FLOAT,
  created_at TIMESTAMP DEFAULT now()
);

-- Create watchlists table
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  stock_id UUID REFERENCES stocks(id),
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id, stock_id)
);

-- Create saved_analyses table
CREATE TABLE IF NOT EXISTS saved_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  event_analysis_id UUID REFERENCES event_analysis(id),
  title TEXT,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_analyses ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
CREATE POLICY "Users can only view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can only view their own events" ON events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only view their own analyses" ON event_analysis
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only view their own watchlists" ON watchlists
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only view their own saved analyses" ON saved_analyses
  FOR SELECT USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX idx_events_user ON events(user_id);
CREATE INDEX idx_event_analysis_user ON event_analysis(user_id);
CREATE INDEX idx_stock_scores_analysis ON stock_scores(event_analysis_id);
CREATE INDEX idx_watchlists_user ON watchlists(user_id);
CREATE INDEX idx_saved_analyses_user ON saved_analyses(user_id);
