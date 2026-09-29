-- ============================================================
-- Close the functions the way 20260814000000 closed the tables.
--
-- That migration revoked table privileges from `anon`/`authenticated` and
-- handed back read access on the eight storefront tables. It never touched
-- routines, and the hosted project grants EXECUTE on everything in `public` to
-- those roles by default. So the outer gate stayed shut on tables and wide open
-- on functions — and 32 of them are SECURITY DEFINER, which means they run as
-- the owner and RLS does not apply to them at all.
--
-- What that allowed, with nothing but the anon key that ships inside every
-- browser bundle (all confirmed against the live project, not inferred):
--
--   * get_admin_orders()        — every order, with customer name, phone and
--                                 address. Demonstrated: one seeded order came
--                                 back in full to an unauthenticated caller.
--   * get_admin_conversations() — every customer conversation.
--   * get_client_orders(id)     — any customer's orders, by passing their id.
--   * verify_admin_password()   — an unlimited password oracle. admin-login
--                                 allows five attempts per 15 minutes; calling
--                                 the function directly skips that entirely and
--                                 leaves no trace in the function logs.
--   * hash_admin_password()     — bcrypt cost 10 on demand, free CPU to burn.
--   * create_order_with_stock(), insert_order(), adjust_stock(),
--     insert_review(), send_message() — writes that bypass every check the
--     edge functions perform, including price validation at checkout.
--
-- The application never needed any of this from the browser: client-api and
-- admin-api verify the caller and then use the service_role key. Only four
-- routines are called straight from the page, and they are listed below.
--
-- Privileges are the coarse gate, RLS is the fine one — and for SECURITY
-- DEFINER routines the coarse gate is the only one there is.
-- ============================================================

-- ── service_role first, explicitly ──────────────────────────────────────────
--
-- Before revoking anything, make sure the edge functions' own role holds its
-- EXECUTE rights by direct grant rather than by way of PUBLIC. Revoking from
-- PUBLIC while service_role depended on it would take down checkout, the admin
-- panel and the bot in one statement.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── Then deny the browser-facing roles ──────────────────────────────────────
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- ── Hand back exactly what the storefront calls with the anon key ───────────
--
--   increment_views              ProductDetail, view counter
--   get_favorites_stats          wishlist counters on the catalogue
--   get_product_favorites_stats  the same for one product
--   track_product_event          favourite/view analytics
--
-- Granted by name so overloads are covered and a changed signature cannot
-- silently skip one.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'increment_views',
        'get_favorites_stats',
        'get_product_favorites_stats',
        'track_product_event'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', fn.sig);
  END LOOP;
END
$$;

-- ── Keep it closed for whatever is added next ───────────────────────────────
--
-- Without this the next `CREATE FUNCTION` on the hosted project is public
-- again, and the hole reopens quietly the next time someone adds a routine.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

DO $$
DECLARE
  still_open integer;
BEGIN
  SELECT count(*) INTO still_open
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  RAISE NOTICE 'функций доступно роли anon: % (ожидается 4)', still_open;
END
$$;
