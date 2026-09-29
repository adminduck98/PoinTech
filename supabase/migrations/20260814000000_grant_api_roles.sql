-- ============================================================
-- Give the API roles the table privileges they never had.
--
-- Across the 94 migrations that this schema was squashed from there was
-- exactly one table-level GRANT (payme_transactions to service_role). Every
-- other table carried only REFERENCES/TRIGGER/TRUNCATE — the defaults — so
-- neither `anon` nor `service_role` could SELECT, INSERT, UPDATE or DELETE
-- anything through PostgREST.
--
-- It worked in the original project only because Supabase used to auto-expose
-- new objects in `public` to the API roles. That behaviour is off by default
-- for projects created now (see the auto_expose_new_tables note in
-- config.toml, and the field disappears entirely on 2026-10-30), so a fresh
-- project built from this schema answers 403 to every request: an empty shop
-- with no error anywhere in the logs.
--
-- Privileges are the coarse gate; RLS is the fine one. Everything below is
-- still filtered by the policies already in the baseline — a GRANT does not
-- widen what a policy allows.
-- ============================================================

-- ── Start from deny for the public roles ────────────────────────────────────
--
-- Local and hosted Postgres arrive here from opposite directions, and the
-- migration has to produce the same end state on both.
--
--   * A local `supabase start` grants nothing, so anon reaches no table.
--   * A hosted project grants anon/authenticated on every table created in
--     `public` — so the moment the baseline ran on the cloud project, the
--     public anon key could query orders, users, admin_accounts, coupon_usage
--     and the rest, with RLS as the only thing in the way.
--
-- RLS did hold. But privileges are the outer gate, and an outer gate that is
-- open on one deployment and shut on the other is not a security posture — one
-- mis-scoped policy is then the whole distance between a bearer token that
-- ships in the browser bundle and the customer table. Revoke first, then hand
-- back exactly what the storefront needs.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- ── service_role: full access ───────────────────────────────────────────────
--
-- Every user-scoped read and write in this app goes through an Edge Function
-- holding the service-role key: checkout, client-api, admin-api, auto-notify.
-- Those functions are the application's real data layer.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── anon: read-only, storefront only ────────────────────────────────────────
--
-- These eight tables are exactly what the browser queries directly with the
-- anon key; everything else it touches goes through an Edge Function. Verified
-- against the source: all eight appear only as `supabase.from('…').select(…)`,
-- never with insert/update/delete, so SELECT is the whole requirement.
--
-- `authenticated` is included because the RLS policies already name it, even
-- though this app derives identity from Telegram initData rather than Supabase
-- Auth and never mints an authenticated session today.
GRANT SELECT ON
  products,
  categories,
  banners,
  product_collections,
  product_relations,
  promotions,
  delivery_zones,
  reviews
TO anon, authenticated;

-- ── Close a hole the grants above would otherwise open ──────────────────────
--
-- `reviews` carries three permissive SELECT policies. Two restrict rows to
-- `is_approved = true`; the third, `reviews_anon_select`, is `USING (true)`.
-- Permissive policies combine with OR, so the unrestricted one wins and the
-- moderation flag stops meaning anything — anon can read reviews that were
-- submitted but never approved.
--
-- That has been latent: with no SELECT privilege, nothing could read the table
-- at all. Granting SELECT above is precisely what would activate it, so it is
-- closed here rather than shipped as a regression.
DROP POLICY IF EXISTS "reviews_anon_select" ON reviews;

-- ── Keep this from happening again ──────────────────────────────────────────
--
-- Two failure modes to prevent on the next `CREATE TABLE`, one per platform:
-- locally it would land with no grants and 403 silently; on hosted Supabase it
-- would land readable by anon. Both are settled here rather than rediscovered.
-- Applies to objects created by the role that runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
  storefront CONSTANT text[] := ARRAY[
    'products','categories','banners','product_collections',
    'product_relations','promotions','delivery_zones','reviews'
  ];
  missing text;
  leaked  text;
BEGIN
  -- service_role must be able to read every table; the Edge Functions do.
  SELECT string_agg(c.relname, ', ')
    INTO missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT has_table_privilege('service_role', c.oid, 'SELECT');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role still cannot read: %', missing;
  END IF;

  -- anon must be able to read the storefront…
  SELECT string_agg(t, ', ') INTO missing
    FROM unnest(storefront) AS t
   WHERE NOT has_table_privilege('anon', ('public.' || t)::regclass, 'SELECT');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'anon cannot read storefront tables: %', missing;
  END IF;

  -- …and nothing else. This is the assertion that matters: it fails the
  -- migration if a future edit hands anon a table holding customer data.
  SELECT string_agg(c.relname, ', ')
    INTO leaked
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT (c.relname = ANY (storefront))
     AND has_table_privilege('anon', c.oid, 'SELECT');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon can read non-storefront tables: %', leaked;
  END IF;

  -- anon is read-only everywhere.
  SELECT string_agg(c.relname, ', ')
    INTO leaked
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (has_table_privilege('anon', c.oid, 'INSERT')
       OR has_table_privilege('anon', c.oid, 'UPDATE')
       OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon has write access to: %', leaked;
  END IF;

  RAISE NOTICE 'grants: service_role full, anon read-only on % storefront tables',
    array_length(storefront, 1);
END $$;
