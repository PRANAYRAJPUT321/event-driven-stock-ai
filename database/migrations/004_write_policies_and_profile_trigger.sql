-- Session 3: fix a real gap from migration 001 — only SELECT policies existed,
-- meaning every INSERT/UPDATE/DELETE from the app (via the anon-key + user
-- session client, which respects RLS) was being silently rejected once RLS
-- actually started enforcing on a populated project. Adds the missing write
-- policies, tightens stock_scores (previously had no RLS at all), and
-- replaces the removed client-side "insert a profile row" step with the
-- standard Supabase trigger pattern so every signup reliably gets a profile.

-- ── profiles: allow the owner to update their own row, and auto-create ──
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── events: owner can insert their own events ──
CREATE POLICY "Users can insert their own events" ON events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── event_analysis: owner can insert/update their own analyses ──
CREATE POLICY "Users can insert their own analyses" ON event_analysis
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own analyses" ON event_analysis
  FOR UPDATE USING (auth.uid() = user_id);

-- ── watchlists: owner can insert/delete their own entries ──
CREATE POLICY "Users can insert their own watchlist entries" ON watchlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own watchlist entries" ON watchlists
  FOR DELETE USING (auth.uid() = user_id);

-- ── saved_analyses: owner can insert/update/delete their own saves ──
CREATE POLICY "Users can insert their own saved analyses" ON saved_analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own saved analyses" ON saved_analyses
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own saved analyses" ON saved_analyses
  FOR DELETE USING (auth.uid() = user_id);

-- ── stock_scores: previously had NO row level security at all. Scope it to
-- the parent event_analysis's owner via subquery, since stock_scores has no
-- user_id column of its own. ──
ALTER TABLE stock_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scores for their own analyses" ON stock_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM event_analysis
      WHERE event_analysis.id = stock_scores.event_analysis_id
      AND event_analysis.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert scores for their own analyses" ON stock_scores
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM event_analysis
      WHERE event_analysis.id = stock_scores.event_analysis_id
      AND event_analysis.user_id = auth.uid()
    )
  );

-- ── stocks: read-only reference data, open to any authenticated user ──
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read the stock universe" ON stocks
  FOR SELECT USING (auth.role() = 'authenticated');
