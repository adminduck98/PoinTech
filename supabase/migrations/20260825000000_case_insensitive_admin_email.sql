-- verify_admin_password() lowercased the email typed at login but not the
-- email stored in admin_accounts.email. Any account created with so much as
-- one uppercase letter in its address (nothing in the schema or the
-- DEPLOYMENT.md INSERT example enforces lowercase) could never log in: the
-- password was checked correctly, but the row was never found because
-- `email = lower(trim(p_email))` compared a mixed-case column against an
-- always-lowercase value.
CREATE OR REPLACE FUNCTION "public"."verify_admin_password"("p_email" "text", "p_password" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_admin RECORD;
BEGIN
  SELECT id, email, first_name, role, password_hash, is_active
  INTO v_admin
  FROM admin_accounts
  WHERE lower(email) = lower(trim(p_email))
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid credentials');
  END IF;

  -- bcrypt only. The former `password_hash = p_password` branch meant a row
  -- containing a plaintext password was a working credential.
  IF v_admin.password_hash IS NULL
     OR v_admin.password_hash NOT LIKE '$2%'
     OR extensions.crypt(p_password, v_admin.password_hash) <> v_admin.password_hash
  THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid credentials');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'id', v_admin.id,
    'email', v_admin.email,
    'first_name', v_admin.first_name,
    'role', v_admin.role
  );
END;
$_$;
