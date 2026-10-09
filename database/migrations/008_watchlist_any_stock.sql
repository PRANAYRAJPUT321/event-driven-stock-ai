-- Lets a signed-in user watchlist any NSE-listed company, not only the
-- NIFTY 50 rows seeded by 007.
--
-- The stocks table stays read-only to users — it is shared reference data —
-- and this function is the one narrow way in. SECURITY DEFINER runs it with
-- the owner's rights so it can insert, but it only ever inserts a well-formed
-- NSE symbol, never modifies an existing row, and returns the row's id
-- whether it created it or found it. The app checks the symbol against NSE's
-- equity list before calling it (app/api/stocks/ensure/route.ts).

CREATE OR REPLACE FUNCTION public.ensure_stock(p_symbol TEXT, p_name TEXT, p_sector TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_symbol TEXT := upper(trim(p_symbol));
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in to add stocks' USING ERRCODE = '42501';
  END IF;
  IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9&-]{1,10}$' THEN
    RAISE EXCEPTION 'not an NSE symbol: %', p_symbol USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM stocks WHERE symbol = v_symbol;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO stocks (symbol, name, sector)
  VALUES (
    v_symbol,
    left(coalesce(nullif(trim(p_name), ''), v_symbol), 200),
    left(nullif(trim(p_sector), ''), 50)
  )
  ON CONFLICT (symbol) DO NOTHING
  RETURNING id INTO v_id;

  -- Another session may have inserted the same symbol between the SELECT and
  -- the INSERT; the conflict then returns nothing, so read it back.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM stocks WHERE symbol = v_symbol;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_stock(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_stock(TEXT, TEXT, TEXT) TO authenticated;
