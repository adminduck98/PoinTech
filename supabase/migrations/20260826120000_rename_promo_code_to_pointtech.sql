-- The welcome banner on the home screen advertises the first-order coupon by
-- name, and the rebrand moved that name: src/pages/Home.tsx now prints
-- POINTTECH where it printed SILKROAD. The coupon is looked up by exact code —
-- supabase/functions/_shared/coupons.ts does
-- `.eq("code", String(code).trim().toUpperCase())` — so a row still called
-- SILKROAD means the banner advertises a code that validate_coupon answers
-- "Купон не найден" to.
--
-- Only the code changes. The row keeps its id, so coupon_usage.coupon_id and
-- orders.coupon_id still point at it and past orders keep their history;
-- max_uses_per_user keeps counting the same people it counted before.
--
-- Three ways this can be re-run or arrive out of order, all no-ops:
--   * no SILKROAD row — the coupon may never have existed in this environment;
--   * a POINTTECH row already exists — coupons_code_key is UNIQUE, so a blind
--     UPDATE would abort the migration and take the whole deploy with it;
--   * already renamed — the WHERE matches nothing the second time.
DO $$
DECLARE
  v_renamed integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.coupons WHERE upper(btrim(code)) = 'POINTTECH') THEN
    RAISE NOTICE 'coupons: POINTTECH already exists — codes left untouched';
    RETURN;
  END IF;

  UPDATE public.coupons
     SET code = 'POINTTECH',
         updated_at = now()
   WHERE upper(btrim(code)) = 'SILKROAD';

  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  IF v_renamed = 0 THEN
    RAISE NOTICE 'coupons: no SILKROAD row found — create POINTTECH in the admin panel if the banner should work';
  ELSE
    RAISE NOTICE 'coupons: renamed % row(s) SILKROAD -> POINTTECH', v_renamed;
  END IF;
END
$$;
