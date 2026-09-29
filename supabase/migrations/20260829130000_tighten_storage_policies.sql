-- ============================================================
-- Storage policies: drop what nothing uses, scope what stays.
--
-- The baseline shipped policies that hand the browser far more than the app
-- ever asks for. Confirmed against the live project with the anon key that
-- ships in the bundle:
--
--   * "Auth can delete product images"  — role `public`, so anon included.
--     Anyone could delete the shop's product photos.
--   * "anon can delete banner images"   — the same for the homepage banners.
--   * "Auth can update product images"  — role `public`, overwrite anything.
--   * "Auth can upload product images"  — role `public` with NO condition at
--     all: not "product images", but *any object in any bucket*.
--
-- Nothing in src/ deletes or updates a storage object. The four call sites are
-- uploads and getPublicUrl:
--
--   products.ts  → product-images   (admin adds a product)
--   AdminBanners → banner-images    (admin adds a banner)
--   catalog.ts   → review-photos    (customer attaches a photo to a review)
--   activity.ts  → return-photos    (customer photographs a defect)
--
-- So the delete and update policies are removed outright, and each insert is
-- pinned to the one bucket it belongs to. service_role keeps full access — it
-- bypasses RLS — so the edge functions and the admin panel's server-side paths
-- are unaffected.
--
-- What this does NOT fix, and is left deliberate: uploads still come straight
-- from the browser under the anon key, so a stranger holding that key can put
-- images into these buckets. The MIME allowlist and the 5 MB cap on each bucket
-- are the only limits. Closing that properly means routing uploads through
-- admin-api/client-api, which is a code change rather than a policy one.
-- ============================================================

-- ── Удаление и перезапись: из браузера этого не делает никто ────────────────
DROP POLICY IF EXISTS "Auth can delete product images"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete product images"     ON storage.objects;
DROP POLICY IF EXISTS "anon can delete banner images"           ON storage.objects;
DROP POLICY IF EXISTS "Auth can update product images"          ON storage.objects;

-- ── Загрузка: каждая политика — в свой бакет ────────────────────────────────
DROP POLICY IF EXISTS "Auth can upload product images"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload product images"     ON storage.objects;
DROP POLICY IF EXISTS "anon can upload banner images"           ON storage.objects;
DROP POLICY IF EXISTS "anon can upload return photos"           ON storage.objects;
DROP POLICY IF EXISTS "anon can upload review photos"           ON storage.objects;

CREATE POLICY "upload product images" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "upload banner images" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'banner-images');

CREATE POLICY "upload review photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'review-photos');

CREATE POLICY "upload return photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'return-photos');

DO $$
DECLARE
  writable integer;
BEGIN
  SELECT count(*) INTO writable
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND cmd IN ('DELETE', 'UPDATE')
    AND roles::text ~ '(anon|public|authenticated)';

  RAISE NOTICE 'политик удаления/перезаписи для публичных ролей: % (ожидается 0)', writable;
END
$$;
