#!/usr/bin/env bash
#
# Runs database/schema.sql against a throwaway PostgreSQL and exercises the
# queries the application actually issues.
#
#   bash scripts/test-schema.sh
#
# Why this exists: the schema is applied by hand in the Supabase SQL editor,
# so a mistake in it is discovered by the person pasting it, usually halfway
# through. This catches it here instead. It already found one: the file
# claimed to be safe to run twice and was not, because five CREATE INDEX
# statements had no IF NOT EXISTS.
#
# Needs PostgreSQL 16 locally. It never touches a real Supabase project.

set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=${ROOT:-/var/tmp/pulse-schema-test}
DB=pulse_schema_test
SCHEMA="$(cd "$(dirname "$0")/.." && pwd)/database/schema.sql"

command -v "$PGBIN/initdb" >/dev/null || { echo "PostgreSQL 16 not found at $PGBIN"; exit 1; }
[ -f "$SCHEMA" ] || { echo "missing $SCHEMA — run: node scripts/build-schema.mjs"; exit 1; }

cleanup() { su postgres -c "$PGBIN/pg_ctl -D $ROOT/data stop -m immediate" >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$ROOT"; mkdir -p "$ROOT/data" "$ROOT/sock"; chown -R postgres:postgres "$ROOT"
su postgres -c "$PGBIN/initdb -D $ROOT/data -A trust -U postgres" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $ROOT/data -o '-k $ROOT/sock -h \"\"' -l $ROOT/log start" >/dev/null
sleep 1

# The pieces Supabase provides that a bare PostgreSQL does not: the auth
# schema, the users table every user_id references, and the claim helpers the
# row-level security policies call.
cat > "$ROOT/shim.sql" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.email', true), '') $$;
-- Supabase's API roles, which grants in the schema name.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
SQL

cp "$SCHEMA" "$ROOT/schema.sql"
chown postgres:postgres "$ROOT/shim.sql" "$ROOT/schema.sql"
PSQL="psql -h $ROOT/sock -U postgres -d $DB -v ON_ERROR_STOP=1 -q"

su postgres -c "createdb -h $ROOT/sock -U postgres $DB"
su postgres -c "$PSQL -f $ROOT/shim.sql"

# Applied three times: once on an empty database, then twice more, because the
# file tells the reader it is safe to re-run and that has to be true.
for run in 1 2 3; do
  su postgres -c "$PSQL -f $ROOT/schema.sql" 2>&1 | grep -Ei '^ERROR|^FATAL' && {
    echo "✗ schema failed on run $run"; exit 1; }
  echo "  ✓ schema applied cleanly (run $run)"
done

cat > "$ROOT/app.sql" <<'SQL'
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user LOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT SELECT ON auth.users TO app_user;
-- Signed-in API requests run as `authenticated`; app_user stands in for one.
GRANT authenticated TO app_user;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','a@example.com'),
  ('22222222-2222-2222-2222-222222222222','b@example.com') ON CONFLICT (id) DO NOTHING;

-- app_user rather than postgres: a superuser bypasses RLS and would prove nothing.
SET ROLE app_user;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET request.jwt.claim.role = 'authenticated';

INSERT INTO events (id, user_id, title, description, event_type, economic_variable,
                    direction, magnitude, confidence, transmission_explanation)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'RBI hikes repo rate by 25 bps','full text','MONETARY_POLICY','INTEREST_RATE',
        'NEGATIVE',76,62,'Higher policy rate raises cost of funds.');

INSERT INTO event_analysis (id, user_id, event_id, affected_sectors, opportunity_score,
                            recommendation, bull_case, bear_case, contradictory_evidence)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', ARRAY['Banking','Auto'], 29,
        'UNRATED','bull','bear','contradictory');

-- Exactly the column set app/api/analyze/route.ts writes.
INSERT INTO stock_scores (event_analysis_id, stock_id, stock_symbol, event_impact_score,
                          event_impact_direction, fundamental_score, valuation_score,
                          technical_score, risk_score, risk_level, opportunity_score,
                          recommendation, confidence)
SELECT 'bbbbbbbb-0000-0000-0000-000000000001', id, symbol, 12, 'NEGATIVE',
       NULL, NULL, NULL, NULL, 'UNKNOWN', 29, 'UNRATED', 62
FROM stocks WHERE symbol IN ('HDFCBANK','ICICIBANK','MARUTI');

INSERT INTO watchlists (user_id, stock_id)
SELECT '11111111-1111-1111-1111-111111111111', id FROM stocks WHERE symbol='HDFCBANK';

INSERT INTO portfolio_positions (user_id, symbol, recommendation, entry_price, event_analysis_id)
VALUES ('11111111-1111-1111-1111-111111111111','HDFCBANK','UNRATED',1680.50,
        'bbbbbbbb-0000-0000-0000-000000000001');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM stocks;
  IF n <> 50 THEN RAISE EXCEPTION 'stock universe not seeded: % rows', n; END IF;

  SELECT count(*) INTO n FROM event_analysis ea JOIN events e ON e.id = ea.event_id
    WHERE ea.user_id = auth.uid();
  IF n <> 1 THEN RAISE EXCEPTION 'history did not read back: % rows', n; END IF;

  SELECT count(*) INTO n FROM watchlists w JOIN stocks s ON s.id = w.stock_id
    WHERE w.user_id = auth.uid();
  IF n <> 1 THEN RAISE EXCEPTION 'watchlist did not read back: % rows', n; END IF;

  SELECT count(*) INTO n FROM portfolio_positions WHERE user_id = auth.uid();
  IF n <> 1 THEN RAISE EXCEPTION 'portfolio did not read back: % rows', n; END IF;

  SELECT count(*) INTO n FROM stock_scores
    WHERE event_analysis_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF n <> 3 THEN RAISE EXCEPTION 'scores did not read back: % rows', n; END IF;
END $$;

-- Another signed-in user must see none of it, while shared reference data stays readable.
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM events;              IF n <> 0 THEN RAISE EXCEPTION 'RLS leak: events'; END IF;
  SELECT count(*) INTO n FROM event_analysis;      IF n <> 0 THEN RAISE EXCEPTION 'RLS leak: event_analysis'; END IF;
  SELECT count(*) INTO n FROM watchlists;          IF n <> 0 THEN RAISE EXCEPTION 'RLS leak: watchlists'; END IF;
  SELECT count(*) INTO n FROM portfolio_positions; IF n <> 0 THEN RAISE EXCEPTION 'RLS leak: portfolio_positions'; END IF;
  SELECT count(*) INTO n FROM stock_scores;        IF n <> 0 THEN RAISE EXCEPTION 'RLS leak: stock_scores'; END IF;
  SELECT count(*) INTO n FROM stocks;              IF n < 50 THEN RAISE EXCEPTION 'reference data hidden: % rows', n; END IF;
END $$;

-- ensure_stock: any NSE company can be watchlisted, through one narrow door.
DO $$
DECLARE a uuid; b uuid; n int; failed boolean;
BEGIN
  a := ensure_stock('WIPRO', 'Wipro Limited', 'IT');
  IF a IS NULL THEN RAISE EXCEPTION 'ensure_stock returned no id'; END IF;
  b := ensure_stock('wipro', 'Something Else', NULL);
  IF a <> b THEN RAISE EXCEPTION 'ensure_stock created a duplicate'; END IF;
  SELECT count(*) INTO n FROM stocks WHERE symbol = 'WIPRO' AND name = 'Wipro Limited';
  IF n <> 1 THEN RAISE EXCEPTION 'ensure_stock overwrote an existing row'; END IF;
  -- An existing NIFTY row comes back as-is.
  IF ensure_stock('HDFCBANK', 'x', 'y') <> (SELECT id FROM stocks WHERE symbol = 'HDFCBANK') THEN
    RAISE EXCEPTION 'ensure_stock did not return the seeded row';
  END IF;
  INSERT INTO watchlists (user_id, stock_id) VALUES (auth.uid(), a);
  failed := false;
  BEGIN PERFORM ensure_stock('NOT A SYMBOL!', 'x', NULL); EXCEPTION WHEN others THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'ensure_stock accepted a malformed symbol'; END IF;
END $$;
-- Users still cannot write the reference table directly.
DO $$
DECLARE failed boolean := false;
BEGIN
  BEGIN UPDATE stocks SET name = 'hijacked' WHERE symbol = 'WIPRO'; EXCEPTION WHEN others THEN failed := true; END;
  IF EXISTS (SELECT 1 FROM stocks WHERE name = 'hijacked') THEN RAISE EXCEPTION 'stocks is writable by users'; END IF;
END $$;
-- Signed out, the function refuses.
RESET request.jwt.claim.sub;
DO $$
DECLARE failed boolean := false;
BEGIN
  BEGIN PERFORM ensure_stock('ITC', 'ITC', NULL); EXCEPTION WHEN others THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'ensure_stock ran without a signed-in user'; END IF;
END $$;
SQL
chown postgres:postgres "$ROOT/app.sql"
su postgres -c "$PSQL -f $ROOT/app.sql"
echo "  ✓ analysis, history, watchlist, portfolio and scores all write and read back"
echo "  ✓ row-level security isolates users and keeps the stock universe readable"
echo "  ✓ ensure_stock adds any NSE symbol once, refuses malformed or signed-out calls"
echo "✓ database/schema.sql verified end to end"
