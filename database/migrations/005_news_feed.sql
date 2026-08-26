-- Session 4: Live News Discovery
-- News is system-populated shared data, not user-owned, so regular users can
-- read it (RLS SELECT) but cannot write to it directly — only the server,
-- using the service-role client (which bypasses RLS entirely), populates it.

CREATE TABLE IF NOT EXISTS news_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  source TEXT,
  image_url TEXT,
  published_at TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT now(),
  content TEXT,
  event_type VARCHAR(50),
  detected_sectors TEXT[],
  relevance_score FLOAT,
  source_hash VARCHAR(64) UNIQUE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news_feeds(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_relevance ON news_feeds(relevance_score DESC);

ALTER TABLE news_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read news" ON news_feeds
  FOR SELECT USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE policy for regular users on purpose — the fetch
-- endpoint writes via the service-role client, which bypasses RLS.
