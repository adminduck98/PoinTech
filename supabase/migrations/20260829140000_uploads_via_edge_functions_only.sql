-- ============================================================
-- Close the last hole in storage: nobody uploads with the anon key any more.
--
-- 20260829130000 removed the delete/update policies and pinned each insert to
-- its bucket, but the insert itself still ran under `anon` — the key that ships
-- inside the browser bundle. A stranger could fill the buckets with images, and
-- nothing checked who they were.
--
-- All four upload paths now go through an edge function, which verifies the
-- caller before writing with service_role:
--
--   product-images  → admin-api  uploadProductImage   (admin session, capability "products")
--   banner-images   → admin-api  uploadBannerImage    (admin session, capability "banners")
--   review-photos   → client-api upload_review_photo  (verified Telegram initData)
--   return-photos   → client-api upload_return_photo  (verified Telegram initData)
--
-- Each one checks the MIME type against an allowlist, enforces the 5 MB cap and
-- generates the stored path itself, so a caller cannot choose the extension or
-- climb out of its bucket (see supabase/functions/_shared/storage.ts).
--
-- service_role bypasses RLS, so removing every policy leaves the edge functions
-- untouched and the browser with no write path at all. Downloads are unaffected:
-- the buckets stay public and reads do not consult these policies.
-- ============================================================

DROP POLICY IF EXISTS "upload product images" ON storage.objects;
DROP POLICY IF EXISTS "upload banner images"  ON storage.objects;
DROP POLICY IF EXISTS "upload review photos"  ON storage.objects;
DROP POLICY IF EXISTS "upload return photos"  ON storage.objects;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND roles::text ~ '(anon|public|authenticated)';

  RAISE NOTICE 'политик хранилища для публичных ролей: % (ожидается 0)', remaining;
END
$$;
