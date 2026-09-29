-- ============================================================
-- Functional reference data.
--
-- Not sample content — the application does not work without these three sets,
-- so they belong in a migration that every environment receives, rather than in
-- seed.sql, which only ever runs on a local `supabase db reset`.
--
--   * storage.buckets — every upload targets a bucket by id: product images,
--     banner images, review photos, return photos. A missing bucket fails the
--     upload rather than the page, so the symptom is a form that silently
--     refuses to work.
--   * delivery_zones  — checkout prices delivery from this table. Empty means
--     the customer cannot complete an order at all.
--   * categories      — the catalogue's category filter renders from it.
--
-- The old migration chain inserted all of this inline; squashing to a schema
-- baseline dropped it, because squash captures schema only. This restores it.
--
-- Sample products and banners are deliberately NOT here — they stay in seed.sql
-- for local development. Every statement is idempotent, so re-running against a
-- populated project changes nothing.
-- ============================================================

-- ── Storage buckets ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('product-images', 'product-images', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('banner-images', 'banner-images', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('review-photos', 'review-photos', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('return-photos', 'return-photos', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']) ON CONFLICT (id) DO NOTHING;

-- ── Delivery zones ──────────────────────────────────────────────────────────
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('1acef023-d9c6-4b9e-865e-5e3b65949032', 'Ташкент', 'Toshkent', 'г. Ташкент', 'Toshkent shahri', 15000, 30000, 1, 2, 0, 1, 500000, true, 1, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('2faa9fdf-51a4-4391-8d6f-60925ffebdf0', 'Самарканд', 'Samarqand', 'Самаркандская область', 'Samarqand viloyati', 20000, 45000, 2, 4, 1, 2, 750000, true, 2, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('a14c8de8-8c66-4343-9234-778d91191d7d', 'Бухара', 'Buxoro', 'Бухарская область', 'Buxoro viloyati', 22000, 50000, 2, 4, 1, 2, 750000, true, 3, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('3e8452d3-b5b4-4ff0-ba5f-ce2cc47b98e1', 'Андижан', 'Andijon', 'Андижанская область', 'Andijon viloyati', 25000, 55000, 3, 5, 1, 2, 800000, true, 4, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('728e5ffb-94eb-44d4-a1c3-4cda722242da', 'Наманган', 'Namangan', 'Наманганская область', 'Namangan viloyati', 25000, 55000, 3, 5, 1, 2, 800000, true, 5, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('3fe6088a-796d-4ef7-b8b2-a7a8f47ae3a5', 'Фергана', 'Farg''ona', 'Ферганская область', 'Farg''ona viloyati', 25000, 55000, 3, 5, 1, 2, 800000, true, 6, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('16273b13-7887-4c95-b125-0c420ceec35a', 'Коканд', 'Qo''qon', 'Ферганская область', 'Farg''ona viloyati', 27000, 60000, 3, 5, 2, 3, 0, true, 7, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('44d9dc68-a8e6-43c9-ae89-0aae8343fb44', 'Нукус', 'Nukus', 'Республика Каракалпакстан', 'Qoraqalpog''iston Respublikasi', 35000, 75000, 4, 7, 2, 3, 0, true, 8, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('c66d1e8b-c471-4379-8fa7-e4b57f20ce83', 'Термез', 'Termiz', 'Сурхандарьинская область', 'Surxondaryo viloyati', 30000, 65000, 3, 6, 2, 3, 0, true, 9, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('c91eb241-facd-4f23-9f6e-84db68febc46', 'Карши', 'Qarshi', 'Кашкадарьинская область', 'Qashqadaryo viloyati', 28000, 60000, 3, 5, 2, 3, 0, true, 10, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('43a0aff4-eb07-423f-beab-a53bfe3f2330', 'Хива', 'Xiva', 'Хорезмская область', 'Xorazm viloyati', 32000, 70000, 4, 6, 2, 3, 0, true, 11, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('70660bcb-33cf-427c-81f8-785071344997', 'Гулистан', 'Guliston', 'Сырдарьинская область', 'Sirdaryo viloyati', 20000, 45000, 2, 4, 1, 2, 0, true, 12, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('057108e6-07c2-42f7-b4e6-785a1480040f', 'Джизак', 'Jizzax', 'Джизакская область', 'Jizzax viloyati', 20000, 45000, 2, 4, 1, 2, 0, true, 13, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('090ca097-ae13-497d-a64b-8a4053b464ed', 'Навои', 'Navoiy', 'Навоийская область', 'Navoiy viloyati', 25000, 55000, 3, 5, 2, 3, 0, true, 14, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery_zones (id, city_ru, city_uz, region_ru, region_uz, standard_price, express_price, standard_days_min, standard_days_max, express_days_min, express_days_max, free_threshold, is_active, sort_order, created_at, updated_at) VALUES ('dc95ce97-d915-479f-9ae3-10ed47dc3276', 'Ургенч', 'Urganch', 'Хорезмская область', 'Xorazm viloyati', 32000, 70000, 4, 6, 2, 3, 0, true, 15, '2026-08-13 21:23:44.481295+00', '2026-08-13 21:23:44.481295+00') ON CONFLICT DO NOTHING;

-- ── Categories ──────────────────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, icon, created_at, deleted_at) VALUES ('76a01c1c-bea9-4866-90e1-e9f47b3b60c2', '{"ru": "Одежда", "uz": "Kiyim"}', 'clothing', 'shirt', '2026-08-13 21:23:44.412309+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, name, slug, icon, created_at, deleted_at) VALUES ('f5b5a4bf-93d8-4b51-8b18-1cf82469bde0', '{"ru": "Аксессуары", "uz": "Aksessuarlar"}', 'accessories', 'watch', '2026-08-13 21:23:44.412309+00', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, name, slug, icon, created_at, deleted_at) VALUES ('eb4747c2-b986-4fff-91b0-92e99f43ec96', '{"ru": "Техника", "uz": "Texnika"}', 'tech', 'smartphone', '2026-08-13 21:23:44.412309+00', NULL) ON CONFLICT DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_buckets int; n_zones int; n_cats int;
BEGIN
  SELECT count(*) INTO n_buckets FROM storage.buckets
   WHERE id IN ('product-images','banner-images','review-photos','return-photos');
  SELECT count(*) INTO n_zones FROM delivery_zones;
  SELECT count(*) INTO n_cats  FROM categories;

  IF n_buckets < 4 THEN
    RAISE EXCEPTION 'expected 4 storage buckets, found %', n_buckets;
  END IF;
  IF n_zones = 0 THEN
    RAISE EXCEPTION 'delivery_zones is empty - checkout cannot price delivery';
  END IF;
  IF n_cats = 0 THEN
    RAISE EXCEPTION 'categories is empty - the catalogue filter has nothing to show';
  END IF;

  RAISE NOTICE 'reference data: % buckets, % delivery zones, % categories',
    n_buckets, n_zones, n_cats;
END $$;
