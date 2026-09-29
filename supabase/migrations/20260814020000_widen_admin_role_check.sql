-- ============================================================
-- Let the database store the roles the application actually uses.
--
-- `admin_accounts_role_check` allowed three roles:
--
--     CHECK (role = ANY (ARRAY['admin', 'manager', 'seller']))
--
-- The application has six. `src/lib/auth.ts`, `admin-api`'s ROLE_PERMISSIONS
-- and the ROLES array behind the "add employee" form all list
-- super_admin / admin / manager / seller / support / content, and the admin-api
-- authorisation matrix gives super_admin powers no other role has — it is the
-- only role permitted to modify a peer of equal rank.
--
-- So three of the six roles the form offers could not be saved at all: the
-- insert failed on the check constraint, including for super_admin, the role
-- you would create first on a new deployment. Found by trying to create the
-- first administrator on a fresh database.
--
-- The drift test in tests/edge/role-matrix.test.mjs compares the frontend
-- matrix against the edge function's, and both agreed — neither is compared
-- against this constraint, which is why it went unnoticed. The check below
-- derives from the same list, so widening it here is the last place that had
-- to be taught the other three roles.
-- ============================================================

ALTER TABLE admin_accounts DROP CONSTRAINT IF EXISTS admin_accounts_role_check;

ALTER TABLE admin_accounts
  ADD CONSTRAINT admin_accounts_role_check
  CHECK (role = ANY (ARRAY[
    'super_admin'::text,
    'admin'::text,
    'manager'::text,
    'seller'::text,
    'support'::text,
    'content'::text
  ]));

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected CONSTANT text[] := ARRAY['super_admin','admin','manager','seller','support','content'];
  r text;
BEGIN
  -- Every role the application can assign must be storable. Probing the
  -- constraint directly is what the previous version of this table would have
  -- failed, so probe it rather than trusting the definition above.
  FOREACH r IN ARRAY expected LOOP
    BEGIN
      INSERT INTO admin_accounts (email, first_name, role, is_active, password_hash)
      VALUES ('__constraint_probe__@invalid', 'probe', r, false, 'x');
      DELETE FROM admin_accounts WHERE email = '__constraint_probe__@invalid';
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'admin_accounts rejects role "%" which the application can assign', r;
    END;
  END LOOP;

  RAISE NOTICE 'admin_accounts accepts all % application roles', array_length(expected, 1);
END $$;
