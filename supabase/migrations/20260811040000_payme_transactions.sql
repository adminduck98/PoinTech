


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean DEFAULT false, "p_notify_stock" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.favorites (telegram_user_id, product_id, notify_price, notify_stock)
  VALUES (p_telegram_user_id, p_product_id, p_notify_price, p_notify_stock)
  ON CONFLICT (telegram_user_id, product_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."add_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_stock"("p_product_id" "uuid", "p_delta" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_stock int;
BEGIN
  UPDATE products
  SET stock = GREATEST(0, stock + p_delta),
      updated_at = now()
  WHERE id = p_product_id
  RETURNING stock INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  RETURN jsonb_build_object('id', p_product_id, 'stock', v_new_stock);
END;
$$;


ALTER FUNCTION "public"."adjust_stock"("p_product_id" "uuid", "p_delta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_order_status"("p_order_id" "uuid", "p_status" "text", "p_changed_by" "text" DEFAULT 'Admin'::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order RECORD;
  v_should_archive boolean := false;
  v_new_status_history jsonb;
  v_item jsonb;
  v_items_array jsonb;
BEGIN
  SELECT id, status, status_history, visible_to_client, items
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Order not found');
  END IF;

  -- Build new status history entry
  v_new_status_history := COALESCE(v_order.status_history, '[]'::jsonb) ||
    jsonb_build_object(
      'status', p_status,
      'changed_at', to_char(now(), 'YYYY-MM-DD HH24:MI:SS.MS+00'),
      'changed_by', p_changed_by,
      'note', p_note
    );

  -- Archive ONLY cancelled/returned orders (NOT delivered)
  IF p_status IN ('cancelled', 'returned') THEN
    v_should_archive := true;
  END IF;

  -- Return stock on cancellation (if was not already cancelled)
  IF p_status = 'cancelled' AND v_order.status != 'cancelled' THEN
    IF jsonb_typeof(v_order.items) = 'string' THEN
      v_items_array := v_order.items::text::jsonb;
    ELSE
      v_items_array := v_order.items;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_array)
    LOOP
      UPDATE products
      SET stock = stock + COALESCE((v_item->>'quantity')::int, 1),
          updated_at = now()
      WHERE id = (v_item->>'productId')::uuid;
    END LOOP;
  END IF;

  UPDATE orders
  SET
    status = p_status,
    status_history = v_new_status_history,
    updated_at = now(),
    visible_to_client = CASE WHEN v_should_archive THEN false ELSE visible_to_client END,
    archived_at = CASE WHEN v_should_archive THEN now() ELSE archived_at END,
    cancellation_reason = CASE
      WHEN p_status = 'cancelled' AND p_note IS NOT NULL THEN p_note
      ELSE cancellation_reason
    END
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'id', p_order_id,
    'status', p_status,
    'status_history', v_new_status_history
  );
END;
$$;


ALTER FUNCTION "public"."append_order_status"("p_order_id" "uuid", "p_status" "text", "p_changed_by" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_notifications"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM notifications
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_read_notifications"("p_telegram_user_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM notifications
  WHERE telegram_user_id = p_telegram_user_id
    AND is_read = true;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."clear_read_notifications"("p_telegram_user_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_with_stock"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric, "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id uuid;
  v_item jsonb;
  v_product_id text;
  v_quantity int;
  v_new_stock int;
  v_result jsonb;
  v_items_array jsonb;
  v_product_name text;
BEGIN
  v_order_id := gen_random_uuid();

  IF jsonb_typeof(p_items) = 'string' THEN
    v_items_array := p_items::text::jsonb;
  ELSE
    v_items_array := p_items;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_array)
  LOOP
    v_product_id := v_item->>'productId';
    v_quantity := COALESCE((v_item->>'quantity')::int, 1);

    UPDATE products
    SET stock = stock - v_quantity,
        updated_at = now()
    WHERE id = v_product_id::uuid
      AND stock >= v_quantity
      AND is_active = true
    RETURNING stock INTO v_new_stock;

    IF v_new_stock IS NULL THEN
      SELECT name->'ru' INTO v_product_name FROM products WHERE id = v_product_id::uuid;
      IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'Товар не найден: %', v_product_id;
      ELSE
        RAISE EXCEPTION 'Недостаточно товара "%". Попробуйте уменьшить количество.', v_product_name;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO orders (
    id, telegram_user_id, items, total_amount, status, customer_info,
    delivery_type, delivery_cost, payment_method, notes, coupon_id,
    discount_amount, created_at, updated_at, status_history
  ) VALUES (
    v_order_id, p_telegram_user_id, v_items_array, p_total_amount, p_status,
    p_customer_info, p_delivery_type, p_delivery_cost, p_payment_method,
    p_notes, p_coupon_id, p_discount_amount, now(), now(),
    jsonb_build_array(jsonb_build_object('status', p_status, 'changed_at', now()::text, 'changed_by', 'System'))
  )
  RETURNING jsonb_build_object('id', id::text, 'status', status, 'total_amount', total_amount) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."create_order_with_stock"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_product_analytics"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO product_analytics (product_id)
  SELECT id FROM products WHERE is_active = true
  ON CONFLICT (product_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."ensure_product_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_conversations"() RETURNS TABLE("order_id" "uuid", "order_number" "text", "customer_name" "text", "last_message" "text", "last_message_at" timestamp with time zone, "unread_count" bigint, "customer_telegram_id" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT ON (m.order_id)
    m.order_id,
    LEFT(m.order_id::text, 8) as order_number,
    COALESCE(
      (SELECT customer_info->>'name' FROM orders WHERE id = m.order_id),
      'Пользователь'
    ) as customer_name,
    m.content as last_message,
    m.created_at as last_message_at,
    (SELECT COUNT(*) FROM messages m2
     WHERE m2.order_id = m.order_id
       AND m2.sender_type = 'customer'
       AND m2.is_read = false) as unread_count,
    (SELECT o.telegram_user_id FROM orders o WHERE o.id = m.order_id) as customer_telegram_id
  FROM messages m
  WHERE m.sender_type = 'customer'
  ORDER BY m.order_id, m.created_at DESC;
$$;


ALTER FUNCTION "public"."get_admin_conversations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_orders"("p_status_filter" "text" DEFAULT NULL::"text", "p_search_query" "text" DEFAULT NULL::"text", "p_include_archived" boolean DEFAULT true) RETURNS TABLE("id" "uuid", "telegram_user_id" bigint, "items" "jsonb", "total_amount" numeric, "status" "text", "customer_info" "jsonb", "delivery_type" "text", "delivery_cost" numeric, "payment_method" "text", "notes" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "status_history" "jsonb", "deleted_at" timestamp with time zone, "coupon_id" "uuid", "discount_amount" numeric, "transaction_id" "text", "paid_at" timestamp with time zone, "visible_to_client" boolean, "archived_at" timestamp with time zone, "cancellation_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.telegram_user_id, o.items, o.total_amount, o.status, o.customer_info,
    o.delivery_type, o.delivery_cost, o.payment_method, o.notes, o.created_at, o.updated_at,
    o.status_history, o.deleted_at, o.coupon_id, o.discount_amount, o.transaction_id,
    o.paid_at, o.visible_to_client, o.archived_at, o.cancellation_reason
  FROM orders o
  WHERE 
    (p_status_filter IS NULL OR o.status = p_status_filter)
    AND o.deleted_at IS NULL
    AND (
      p_search_query IS NULL 
      OR o.id::text ILIKE '%' || p_search_query || '%'
      OR o.telegram_user_id::text ILIKE '%' || p_search_query || '%'
      OR o.customer_info::text ILIKE '%' || p_search_query || '%'
    )
  ORDER BY o.created_at DESC
  LIMIT 200;
END;
$$;


ALTER FUNCTION "public"."get_admin_orders"("p_status_filter" "text", "p_search_query" "text", "p_include_archived" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_product_analytics"() RETURNS TABLE("product_id" "uuid", "name" "jsonb", "slug" "text", "price" numeric, "views" integer, "favorites" integer, "cart_adds" integer, "orders" integer, "purchases" integer, "returns" integer, "stock" integer)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    pa.product_id,
    p.name,
    p.slug,
    p.price,
    pa.views,
    pa.favorites,
    pa.cart_adds,
    pa.orders,
    pa.purchases,
    pa.returns,
    p.stock
  FROM product_analytics pa
  JOIN products p ON p.id = pa.product_id
  WHERE p.is_active = true
  ORDER BY pa.views DESC;
$$;


ALTER FUNCTION "public"."get_all_product_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_favorites"("p_telegram_user_id" bigint) RETURNS TABLE("product_id" "uuid", "notify_price" boolean, "notify_stock" boolean, "created_at" timestamp with time zone, "id" "uuid", "name" "jsonb", "slug" "text", "price" numeric, "images" "text"[], "is_active" boolean, "stock" integer, "sizes" "text"[], "colors" "jsonb"[])
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    f.product_id,
    f.notify_price,
    f.notify_stock,
    f.created_at,
    p.id,
    p.name,
    p.slug,
    p.price,
    p.images,
    p.is_active,
    p.stock,
    p.sizes,
    p.colors
  FROM favorites f
  INNER JOIN products p ON p.id = f.product_id
  WHERE f.telegram_user_id = p_telegram_user_id
  ORDER BY f.created_at DESC;
$$;


ALTER FUNCTION "public"."get_client_favorites"("p_telegram_user_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_orders"("p_telegram_user_id" bigint) RETURNS TABLE("id" "uuid", "telegram_user_id" bigint, "items" "jsonb", "total_amount" numeric, "status" "text", "customer_info" "jsonb", "delivery_type" "text", "delivery_cost" numeric, "payment_method" "text", "notes" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "status_history" "jsonb", "deleted_at" timestamp with time zone, "coupon_id" "uuid", "discount_amount" numeric, "transaction_id" "text", "paid_at" timestamp with time zone, "visible_to_client" boolean, "archived_at" timestamp with time zone, "cancellation_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.telegram_user_id,
    o.items,
    o.total_amount,
    o.status,
    o.customer_info,
    o.delivery_type,
    o.delivery_cost,
    o.payment_method,
    o.notes,
    o.created_at,
    o.updated_at,
    o.status_history,
    o.deleted_at,
    o.coupon_id,
    o.discount_amount,
    o.transaction_id,
    o.paid_at,
    o.visible_to_client,
    o.archived_at,
    o.cancellation_reason
  FROM orders o
  WHERE o.telegram_user_id = p_telegram_user_id
    AND o.visible_to_client = true
    AND o.deleted_at IS NULL
    AND (
      o.status != 'delivered'
      OR (
        o.status = 'delivered'
        AND (
          SELECT (elem->>'changed_at')::timestamptz
          FROM jsonb_array_elements(o.status_history) AS elem
          WHERE elem->>'status' = 'delivered'
          ORDER BY (elem->>'changed_at')::timestamptz DESC
          LIMIT 1
        ) > now() - interval '14 days'
      )
    )
  ORDER BY o.created_at DESC
  LIMIT 50;
END;
$$;


ALTER FUNCTION "public"."get_client_orders"("p_telegram_user_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_favorites_stats"() RETURNS TABLE("product_id" "uuid", "likes" bigint, "notify_price" bigint, "notify_stock" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    f.product_id,
    COUNT(*)::bigint AS likes,
    COUNT(*) FILTER (WHERE f.notify_price)::bigint AS notify_price,
    COUNT(*) FILTER (WHERE f.notify_stock)::bigint AS notify_stock
  FROM public.favorites f
  GROUP BY f.product_id;
$$;


ALTER FUNCTION "public"."get_favorites_stats"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid",
    "sender_type" "text" NOT NULL,
    "sender_id" "text" NOT NULL,
    "receiver_id" "text",
    "content" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['customer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_messages"("p_order_id" "uuid") RETURNS SETOF "public"."messages"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM messages
  WHERE order_id = p_order_id
  ORDER BY created_at ASC;
$$;


ALTER FUNCTION "public"."get_order_messages"("p_order_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "views" integer DEFAULT 0,
    "favorites" integer DEFAULT 0,
    "cart_adds" integer DEFAULT 0,
    "orders" integer DEFAULT 0,
    "purchases" integer DEFAULT 0,
    "returns" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_analytics" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_analytics"("p_product_id" "uuid") RETURNS SETOF "public"."product_analytics"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT * FROM product_analytics WHERE product_id = p_product_id;
$$;


ALTER FUNCTION "public"."get_product_analytics"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_favorites_stats"("p_product_id" "uuid") RETURNS TABLE("likes" bigint, "notify_price" bigint, "notify_stock" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT
    COUNT(*)::bigint AS likes,
    COUNT(*) FILTER (WHERE f.notify_price)::bigint AS notify_price,
    COUNT(*) FILTER (WHERE f.notify_stock)::bigint AS notify_stock
  FROM public.favorites f
  WHERE f.product_id = p_product_id;
$$;


ALTER FUNCTION "public"."get_product_favorites_stats"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_message_count"("p_sender_id" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COUNT(*)::integer FROM messages
  WHERE receiver_id = p_sender_id AND is_read = false;
$$;


ALTER FUNCTION "public"."get_unread_message_count"("p_sender_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hash_admin_password"("p_password" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 10 THEN
    RAISE EXCEPTION 'Password must be at least 10 characters';
  END IF;
  IF length(p_password) > 200 THEN
    RAISE EXCEPTION 'Password is too long';
  END IF;

  -- Cost 10 matches what the browser used, so existing hashes stay valid.
  RETURN extensions.crypt(p_password, extensions.gen_salt('bf', 10));
END;
$$;


ALTER FUNCTION "public"."hash_admin_password"("p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_views"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE products SET views = views + 1 WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."increment_views"("p_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_notification"("p_telegram_user_id" bigint, "p_type" "text", "p_title" "text", "p_body" "text", "p_data" "jsonb" DEFAULT '{}'::"jsonb") RETURNS SETOF "public"."notifications"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.notifications (telegram_user_id, type, title, body, data)
  VALUES (p_telegram_user_id, p_type, p_title, p_body, p_data)
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."insert_notification"("p_telegram_user_id" bigint, "p_type" "text", "p_title" "text", "p_body" "text", "p_data" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_amount" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'new'::"text",
    "customer_info" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "delivery_type" "text" DEFAULT 'standard'::"text",
    "delivery_cost" numeric DEFAULT 0,
    "payment_method" "text" DEFAULT 'cash'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "deleted_at" timestamp with time zone,
    "coupon_id" "uuid",
    "discount_amount" numeric DEFAULT 0,
    "transaction_id" "text",
    "paid_at" timestamp with time zone,
    "visible_to_client" boolean DEFAULT true,
    "archived_at" timestamp with time zone,
    "cancellation_reason" "text"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."visible_to_client" IS 'If false, order is hidden from customer (archived)';



COMMENT ON COLUMN "public"."orders"."archived_at" IS 'When order was archived (completed/cancelled)';



COMMENT ON COLUMN "public"."orders"."cancellation_reason" IS 'Reason for cancellation if applicable';



CREATE OR REPLACE FUNCTION "public"."insert_order"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text" DEFAULT NULL::"text", "p_coupon_id" "uuid" DEFAULT NULL::"uuid", "p_discount_amount" numeric DEFAULT 0) RETURNS SETOF "public"."orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.orders (
    telegram_user_id, items, total_amount, customer_info,
    delivery_type, delivery_cost, payment_method, notes,
    coupon_id, discount_amount, status, status_history
  )
  VALUES (
    p_telegram_user_id, p_items, p_total_amount, p_customer_info,
    p_delivery_type, p_delivery_cost, p_payment_method, p_notes,
    p_coupon_id, p_discount_amount, 'pending',
    jsonb_build_array(jsonb_build_object(
      'status', 'pending',
      'changed_at', now()::text,
      'changed_by', 'system'
    ))
  )
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."insert_order"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text" NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "refund_amount" numeric DEFAULT 0,
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "photos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "returns_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."returns" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_return"("p_telegram_user_id" bigint, "p_order_id" "text", "p_items" "jsonb", "p_reason" "text", "p_photos" "jsonb" DEFAULT '[]'::"jsonb") RETURNS SETOF "public"."returns"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.returns (telegram_user_id, order_id, items, reason, photos, status, refund_amount)
  VALUES (p_telegram_user_id, p_order_id, p_items, p_reason,
          array(SELECT jsonb_array_elements_text(p_photos)), 'pending', 0)
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."insert_return"("p_telegram_user_id" bigint, "p_order_id" "text", "p_items" "jsonb", "p_reason" "text", "p_photos" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "user_name" "text" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "images" "text"[] DEFAULT '{}'::"text"[],
    "is_verified_purchase" boolean DEFAULT false,
    "is_approved" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "photos" "text"[] DEFAULT '{}'::"text"[],
    "admin_reply" "text",
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_review"("p_product_id" "uuid", "p_telegram_user_id" bigint, "p_user_name" "text", "p_rating" integer, "p_comment" "text" DEFAULT NULL::"text", "p_images" "jsonb" DEFAULT '[]'::"jsonb", "p_photos" "jsonb" DEFAULT '[]'::"jsonb") RETURNS SETOF "public"."reviews"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.reviews (product_id, telegram_user_id, user_name, rating, comment, images, photos)
  VALUES (p_product_id, p_telegram_user_id, p_user_name, p_rating, p_comment, 
          array(SELECT jsonb_array_elements_text(p_images)),
          array(SELECT jsonb_array_elements_text(p_photos)))
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."insert_review"("p_product_id" "uuid", "p_telegram_user_id" bigint, "p_user_name" "text", "p_rating" integer, "p_comment" "text", "p_images" "jsonb", "p_photos" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_product_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  notify_type text;
BEGIN
  IF TG_OP != 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.stock = 0 AND NEW.stock > 0 THEN
    notify_type := 'stock_available';
  ELSIF NEW.price < OLD.price THEN
    notify_type := 'price_drop';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO audit_log (
    admin_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    'system',
    'auto_notify',
    'products',
    NEW.id,
    jsonb_build_object(
      'type', notify_type,
      'old_stock', OLD.stock,
      'new_stock', NEW.stock,
      'old_price', OLD.price,
      'new_price', NEW.price,
      'product_name', NEW.name
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_product_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"("p_telegram_user_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = true
  WHERE telegram_user_id = p_telegram_user_id AND is_read = false;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"("p_telegram_user_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_messages_read"("p_order_id" "uuid", "p_sender_id" "text") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE messages
  SET is_read = true, updated_at = now()
  WHERE order_id = p_order_id
    AND sender_id != p_sender_id
    AND is_read = false;
$$;


ALTER FUNCTION "public"."mark_messages_read"("p_order_id" "uuid", "p_sender_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_read"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.notifications SET is_read = true WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."mark_notification_read"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_order_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_item jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
  LOOP
    PERFORM track_product_event(
      (v_item->>'productId')::uuid,
      'orders',
      COALESCE((v_item->>'quantity')::int, 1)
    );
  END LOOP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_order_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_order_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_item jsonb;
  v_old_status text;
BEGIN
  v_old_status := OLD.status;

  IF NEW.status = 'delivered' AND v_old_status != 'delivered' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      PERFORM track_product_event(
        (v_item->>'productId')::uuid,
        'purchases',
        COALESCE((v_item->>'quantity')::int, 1)
      );
    END LOOP;
  END IF;

  IF NEW.status = 'returned' AND v_old_status != 'returned' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      PERFORM track_product_event(
        (v_item->>'productId')::uuid,
        'returns',
        COALESCE((v_item->>'quantity')::int, 1)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_order_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_return_stock"("p_return_id" "uuid", "p_status" "text", "p_admin_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_return RECORD;
  v_item jsonb;
  v_items_array jsonb;
  v_refund_amount numeric := 0;
BEGIN
  SELECT * INTO v_return FROM returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return not found: %', p_return_id;
  END IF;

  IF p_status NOT IN ('approved', 'refunded') THEN
    UPDATE returns
    SET status = p_status,
        admin_note = COALESCE(p_admin_note, admin_note),
        updated_at = now()
    WHERE id = p_return_id;
    RETURN jsonb_build_object('status', p_status);
  END IF;

  IF jsonb_typeof(v_return.items) = 'string' THEN
    v_items_array := v_return.items::text::jsonb;
  ELSE
    v_items_array := v_return.items;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_array)
  LOOP
    v_refund_amount := v_refund_amount + COALESCE((v_item->>'price')::numeric, 0) * COALESCE((v_item->>'quantity')::int, 1);
    IF p_status = 'refunded' THEN
      UPDATE products
      SET stock = stock + COALESCE((v_item->>'quantity')::int, 1),
          updated_at = now()
      WHERE id = (v_item->>'productId')::uuid;
    END IF;
  END LOOP;

  UPDATE returns
  SET status = p_status,
      admin_note = COALESCE(p_admin_note, admin_note),
      refund_amount = v_refund_amount,
      updated_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('id', p_return_id, 'status', p_status, 'refund_amount', v_refund_amount);
END;
$$;


ALTER FUNCTION "public"."process_return_stock"("p_return_id" "uuid", "p_status" "text", "p_admin_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_return_stock"("p_return_id" "uuid", "p_status" "text", "p_admin_note" "text") IS 'Processes return: approves/rejects, returns stock on refund';



CREATE OR REPLACE FUNCTION "public"."record_coupon_usage"("p_coupon_id" "uuid", "p_telegram_user_id" bigint, "p_order_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.coupon_usage (coupon_id, telegram_user_id, order_id)
  VALUES (p_coupon_id, p_telegram_user_id, p_order_id);
END;
$$;


ALTER FUNCTION "public"."record_coupon_usage"("p_coupon_id" "uuid", "p_telegram_user_id" bigint, "p_order_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  DELETE FROM public.favorites
  WHERE telegram_user_id = p_telegram_user_id AND product_id = p_product_id;
END;
$$;


ALTER FUNCTION "public"."remove_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "slug" "text" NOT NULL,
    "price" numeric DEFAULT 0 NOT NULL,
    "description" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb",
    "category_id" "uuid",
    "subcategory" "text",
    "images" "text"[] DEFAULT '{}'::"text"[],
    "sizes" "text"[] DEFAULT '{}'::"text"[],
    "colors" "jsonb"[] DEFAULT '{}'::"jsonb"[],
    "specs" "jsonb" DEFAULT '{}'::"jsonb",
    "stock" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "views" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_products"("p_query" "text") RETURNS SETOF "public"."products"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM products
  WHERE is_active = true
    AND (
      name->>'ru' ILIKE '%' || p_query || '%'
      OR name->>'uz' ILIKE '%' || p_query || '%'
      OR description->>'ru' ILIKE '%' || p_query || '%'
      OR description->>'uz' ILIKE '%' || p_query || '%'
    )
  ORDER BY created_at DESC
  LIMIT 20;
$$;


ALTER FUNCTION "public"."search_products"("p_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_message"("p_order_id" "uuid", "p_sender_type" "text", "p_sender_id" "text", "p_receiver_id" "text", "p_content" "text") RETURNS "public"."messages"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_message messages;
  v_telegram_user_id bigint;
BEGIN
  INSERT INTO messages (order_id, sender_type, sender_id, receiver_id, content)
  VALUES (p_order_id, p_sender_type, p_sender_id, p_receiver_id, p_content)
  RETURNING * INTO v_message;

  IF p_sender_type = 'admin' THEN
    SELECT o.telegram_user_id INTO v_telegram_user_id
    FROM orders o WHERE o.id = p_order_id;

    IF v_telegram_user_id IS NOT NULL THEN
      INSERT INTO notifications (telegram_user_id, type, title, body, data)
      VALUES (
        v_telegram_user_id,
        'new_message',
        '💬 Новое сообщение',
        LEFT(p_content, 200),
        jsonb_build_object('order_id', p_order_id::text, 'sender_type', 'admin')
      );
    END IF;
  END IF;

  RETURN v_message;
END;
$$;


ALTER FUNCTION "public"."send_message"("p_order_id" "uuid", "p_sender_type" "text", "p_sender_id" "text", "p_receiver_id" "text", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_product_event"("p_product_id" "uuid", "p_event_type" "text", "p_delta" integer DEFAULT 1) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO product_analytics (product_id, views, favorites, cart_adds, orders, purchases, returns)
  VALUES (
    p_product_id,
    CASE WHEN p_event_type = 'views' THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type = 'favorites' THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type = 'cart_adds' THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type = 'orders' THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type = 'purchases' THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type = 'returns' THEN p_delta ELSE 0 END
  )
  ON CONFLICT (product_id) DO UPDATE SET
    views = product_analytics.views + CASE WHEN p_event_type = 'views' THEN p_delta ELSE 0 END,
    favorites = product_analytics.favorites + CASE WHEN p_event_type = 'favorites' THEN p_delta ELSE 0 END,
    cart_adds = product_analytics.cart_adds + CASE WHEN p_event_type = 'cart_adds' THEN p_delta ELSE 0 END,
    orders = product_analytics.orders + CASE WHEN p_event_type = 'orders' THEN p_delta ELSE 0 END,
    purchases = product_analytics.purchases + CASE WHEN p_event_type = 'purchases' THEN p_delta ELSE 0 END,
    returns = product_analytics.returns + CASE WHEN p_event_type = 'returns' THEN p_delta ELSE 0 END,
    updated_at = now();
END;
$$;


ALTER FUNCTION "public"."track_product_event"("p_product_id" "uuid", "p_event_type" "text", "p_delta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean DEFAULT NULL::boolean, "p_notify_stock" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.favorites
  SET notify_price = COALESCE(p_notify_price, notify_price),
      notify_stock = COALESCE(p_notify_stock, notify_stock)
  WHERE telegram_user_id = p_telegram_user_id AND product_id = p_product_id;
END;
$$;


ALTER FUNCTION "public"."update_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_messages_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_messages_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_analytics_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_product_analytics_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telegram_id" bigint NOT NULL,
    "first_name" "text" NOT NULL,
    "username" "text",
    "language" "text" DEFAULT 'ru'::"text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "address" "text",
    "latitude" double precision,
    "longitude" double precision
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT 'ru'::"text", "p_phone" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."users"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.users (telegram_id, first_name, username, language, phone, address, updated_at)
  VALUES (p_telegram_id, p_first_name, p_username, p_language, p_phone, p_address, now())
  ON CONFLICT (telegram_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    username = EXCLUDED.username,
    language = EXCLUDED.language,
    phone = COALESCE(EXCLUDED.phone, public.users.phone),
    address = COALESCE(EXCLUDED.address, public.users.address),
    updated_at = now()
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text" DEFAULT NULL::"text", "p_language" "text" DEFAULT 'ru'::"text", "p_phone" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_latitude" double precision DEFAULT NULL::double precision, "p_longitude" double precision DEFAULT NULL::double precision) RETURNS SETOF "public"."users"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.users (telegram_id, first_name, username, language, phone, address, latitude, longitude, updated_at)
  VALUES (p_telegram_id, p_first_name, p_username, p_language, p_phone, p_address, p_latitude, p_longitude, now())
  ON CONFLICT (telegram_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    username = EXCLUDED.username,
    language = EXCLUDED.language,
    phone = COALESCE(EXCLUDED.phone, public.users.phone),
    address = COALESCE(EXCLUDED.address, public.users.address),
    latitude = COALESCE(EXCLUDED.latitude, public.users.latitude),
    longitude = COALESCE(EXCLUDED.longitude, public.users.longitude),
    updated_at = now()
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text", "p_latitude" double precision, "p_longitude" double precision) OWNER TO "postgres";


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
  WHERE email = lower(trim(p_email))
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


ALTER FUNCTION "public"."verify_admin_password"("p_email" "text", "p_password" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."abandoned_carts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_amount" numeric DEFAULT 0,
    "notified_at" timestamp with time zone,
    "recovered_order_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."abandoned_carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text" DEFAULT ''::"text" NOT NULL,
    "role" "text" DEFAULT 'seller'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_login_at" timestamp with time zone,
    "password_hash" "text",
    "session_token" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "session_expires_at" timestamp with time zone,
    CONSTRAINT "admin_accounts_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'seller'::"text"])))
);


ALTER TABLE "public"."admin_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."banners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "subtitle" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "image_url" "text" DEFAULT ''::"text" NOT NULL,
    "link_url" "text",
    "link_label" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb",
    "bg_color" "text" DEFAULT 'from-blue-500 to-blue-700'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."banners" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bot_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" bigint NOT NULL,
    "first_name" "text" DEFAULT ''::"text" NOT NULL,
    "username" "text",
    "is_blocked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bot_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcast_failures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "chat_id" bigint NOT NULL,
    "error" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."broadcast_failures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."broadcast_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message" "text" NOT NULL,
    "parse_mode" "text" DEFAULT 'HTML'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_recipients" integer DEFAULT 0 NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "blocked_count" integer DEFAULT 0 NOT NULL,
    "created_by" "text" DEFAULT 'admin'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."broadcast_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "slug" "text" NOT NULL,
    "icon" "text" DEFAULT 'tag'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coupon_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coupon_id" "uuid" NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "order_id" "text",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."coupon_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coupons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "type" "text" NOT NULL,
    "value" numeric NOT NULL,
    "min_order_amount" numeric DEFAULT 0,
    "max_uses_total" integer,
    "max_uses_per_user" integer DEFAULT 1,
    "valid_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_until" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "new_customers_only" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coupons_type_check" CHECK (("type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "coupons_value_check" CHECK (("value" > (0)::numeric))
);


ALTER TABLE "public"."coupons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city_ru" "text" NOT NULL,
    "city_uz" "text" NOT NULL,
    "region_ru" "text" DEFAULT ''::"text" NOT NULL,
    "region_uz" "text" DEFAULT ''::"text" NOT NULL,
    "standard_price" integer DEFAULT 20000 NOT NULL,
    "express_price" integer DEFAULT 50000 NOT NULL,
    "standard_days_min" integer DEFAULT 3 NOT NULL,
    "standard_days_max" integer DEFAULT 5 NOT NULL,
    "express_days_min" integer DEFAULT 1 NOT NULL,
    "express_days_max" integer DEFAULT 2 NOT NULL,
    "free_threshold" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."delivery_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "telegram_user_id" bigint NOT NULL,
    "product_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notify_price" boolean DEFAULT false,
    "notify_stock" boolean DEFAULT false
);


ALTER TABLE "public"."favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payme_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payme_id" "text" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "amount" bigint NOT NULL,
    "state" smallint DEFAULT 1 NOT NULL,
    "reason" smallint,
    "create_time" bigint NOT NULL,
    "perform_time" bigint DEFAULT 0 NOT NULL,
    "cancel_time" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payme_transactions_amount_check" CHECK (("amount" > 0)),
    CONSTRAINT "payme_transactions_state_check" CHECK (("state" = ANY (ARRAY[1, 2, '-1'::integer, '-2'::integer])))
);


ALTER TABLE "public"."payme_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_collections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "slug" "text" NOT NULL,
    "icon" "text" DEFAULT 'tag'::"text",
    "product_ids" "text"[] DEFAULT '{}'::"text"[],
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_collections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "related_product_id" "uuid" NOT NULL,
    "relation_type" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_relations_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['upsell'::"text", 'cross_sell'::"text", 'bundle'::"text"])))
);


ALTER TABLE "public"."product_relations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "description" "jsonb" DEFAULT '{"ru": "", "uz": ""}'::"jsonb" NOT NULL,
    "type" "text" NOT NULL,
    "product_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "discount_percentage" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "starts_at" timestamp with time zone DEFAULT "now"(),
    "ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "discount_percent" integer,
    CONSTRAINT "promotions_type_check" CHECK (("type" = ANY (ARRAY['new_arrival'::"text", 'sale'::"text", 'featured'::"text"])))
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_telegram_id" bigint NOT NULL,
    "referred_telegram_id" bigint,
    "referral_code" "text" NOT NULL,
    "discount_percentage" integer DEFAULT 10,
    "bonus_amount" integer DEFAULT 50000,
    "is_redeemed" boolean DEFAULT false,
    "redeemed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."abandoned_carts"
    ADD CONSTRAINT "abandoned_carts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_accounts"
    ADD CONSTRAINT "admin_accounts_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."admin_accounts"
    ADD CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banners"
    ADD CONSTRAINT "banners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_users"
    ADD CONSTRAINT "bot_users_chat_id_key" UNIQUE ("chat_id");



ALTER TABLE ONLY "public"."bot_users"
    ADD CONSTRAINT "bot_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_failures"
    ADD CONSTRAINT "broadcast_failures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_jobs"
    ADD CONSTRAINT "broadcast_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_telegram_user_id_product_id_key" UNIQUE ("telegram_user_id", "product_id");



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_user_product_unique" UNIQUE ("telegram_user_id", "product_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payme_transactions"
    ADD CONSTRAINT "payme_transactions_payme_id_key" UNIQUE ("payme_id");



ALTER TABLE ONLY "public"."payme_transactions"
    ADD CONSTRAINT "payme_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_analytics"
    ADD CONSTRAINT "product_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_analytics"
    ADD CONSTRAINT "product_analytics_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."product_collections"
    ADD CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_collections"
    ADD CONSTRAINT "product_collections_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."product_relations"
    ADD CONSTRAINT "product_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_relations"
    ADD CONSTRAINT "product_relations_product_id_related_product_id_relation_ty_key" UNIQUE ("product_id", "related_product_id", "relation_type");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."returns"
    ADD CONSTRAINT "returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_telegram_id_key" UNIQUE ("telegram_id");



CREATE INDEX "banners_sort_order_idx" ON "public"."banners" USING "btree" ("sort_order", "is_active");



CREATE INDEX "delivery_zones_sort_idx" ON "public"."delivery_zones" USING "btree" ("sort_order", "is_active");



CREATE INDEX "idx_abandoned_carts_pending" ON "public"."abandoned_carts" USING "btree" ("notified_at") WHERE ("notified_at" IS NULL);



CREATE INDEX "idx_abandoned_carts_user" ON "public"."abandoned_carts" USING "btree" ("telegram_user_id");



CREATE INDEX "idx_audit_log_action" ON "public"."audit_log" USING "btree" ("action");



CREATE INDEX "idx_audit_log_admin" ON "public"."audit_log" USING "btree" ("admin_id");



CREATE INDEX "idx_audit_log_created" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_entity" ON "public"."audit_log" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_banners_active" ON "public"."banners" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_banners_not_deleted" ON "public"."banners" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_bot_users_active" ON "public"."bot_users" USING "btree" ("is_blocked") WHERE ("is_blocked" = false);



CREATE INDEX "idx_broadcast_failures_job" ON "public"."broadcast_failures" USING "btree" ("job_id");



CREATE INDEX "idx_broadcast_jobs_created" ON "public"."broadcast_jobs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_broadcast_jobs_status" ON "public"."broadcast_jobs" USING "btree" ("status");



CREATE INDEX "idx_categories_not_deleted" ON "public"."categories" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_coupon_usage_coupon" ON "public"."coupon_usage" USING "btree" ("coupon_id");



CREATE INDEX "idx_coupon_usage_lookup" ON "public"."coupon_usage" USING "btree" ("coupon_id", "telegram_user_id");



CREATE INDEX "idx_coupon_usage_user" ON "public"."coupon_usage" USING "btree" ("telegram_user_id");



CREATE INDEX "idx_coupons_active" ON "public"."coupons" USING "btree" ("is_active", "valid_from", "valid_until");



CREATE INDEX "idx_coupons_code" ON "public"."coupons" USING "btree" ("code");



CREATE INDEX "idx_favorites_notify_price" ON "public"."favorites" USING "btree" ("product_id") WHERE ("notify_price" = true);



CREATE INDEX "idx_favorites_notify_stock" ON "public"."favorites" USING "btree" ("product_id") WHERE ("notify_stock" = true);



CREATE INDEX "idx_favorites_product" ON "public"."favorites" USING "btree" ("product_id");



CREATE INDEX "idx_favorites_user" ON "public"."favorites" USING "btree" ("telegram_user_id");



CREATE INDEX "idx_messages_created" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_messages_order_id" ON "public"."messages" USING "btree" ("order_id");



CREATE INDEX "idx_messages_receiver" ON "public"."messages" USING "btree" ("receiver_id", "is_read");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_type", "sender_id");



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("telegram_user_id", "is_read") WHERE ("is_read" = false);



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("telegram_user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_orders_archived_at" ON "public"."orders" USING "btree" ("archived_at");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_orders_not_deleted" ON "public"."orders" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_telegram_user_id" ON "public"."orders" USING "btree" ("telegram_user_id");



CREATE INDEX "idx_orders_telegram_visible" ON "public"."orders" USING "btree" ("telegram_user_id", "visible_to_client");



CREATE INDEX "idx_orders_user_date" ON "public"."orders" USING "btree" ("telegram_user_id", "created_at" DESC);



CREATE INDEX "idx_orders_user_history" ON "public"."orders" USING "btree" ("telegram_user_id", "created_at" DESC);



CREATE INDEX "idx_orders_visible_to_client" ON "public"."orders" USING "btree" ("visible_to_client");



CREATE INDEX "idx_product_analytics_product_id" ON "public"."product_analytics" USING "btree" ("product_id");



CREATE INDEX "idx_product_relations_product" ON "public"."product_relations" USING "btree" ("product_id", "relation_type");



CREATE INDEX "idx_product_relations_related" ON "public"."product_relations" USING "btree" ("related_product_id");



CREATE INDEX "idx_products_active" ON "public"."products" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_products_category" ON "public"."products" USING "btree" ("category_id");



CREATE INDEX "idx_products_category_id" ON "public"."products" USING "btree" ("category_id");



CREATE INDEX "idx_products_desc_ru_gin" ON "public"."products" USING "gin" ((("description" ->> 'ru'::"text")) "extensions"."gin_trgm_ops");



CREATE INDEX "idx_products_desc_uz_gin" ON "public"."products" USING "gin" ((("description" ->> 'uz'::"text")) "extensions"."gin_trgm_ops");



CREATE INDEX "idx_products_is_active" ON "public"."products" USING "btree" ("is_active");



CREATE INDEX "idx_products_name_ru_gin" ON "public"."products" USING "gin" ((("name" ->> 'ru'::"text")) "extensions"."gin_trgm_ops");



CREATE INDEX "idx_products_name_uz_gin" ON "public"."products" USING "gin" ((("name" ->> 'uz'::"text")) "extensions"."gin_trgm_ops");



CREATE INDEX "idx_products_not_deleted" ON "public"."products" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_products_price" ON "public"."products" USING "btree" ("price");



CREATE INDEX "idx_products_slug" ON "public"."products" USING "btree" ("slug");



CREATE INDEX "idx_products_stock" ON "public"."products" USING "btree" ("stock") WHERE ("stock" > 0);



CREATE INDEX "idx_promotions_active" ON "public"."promotions" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_returns_order" ON "public"."returns" USING "btree" ("order_id");



CREATE INDEX "idx_returns_status" ON "public"."returns" USING "btree" ("status");



CREATE INDEX "idx_returns_user" ON "public"."returns" USING "btree" ("telegram_user_id");



CREATE INDEX "idx_reviews_approved" ON "public"."reviews" USING "btree" ("product_id", "created_at" DESC) WHERE ("is_approved" = true);



CREATE INDEX "idx_reviews_product_id" ON "public"."reviews" USING "btree" ("product_id");



CREATE INDEX "idx_users_not_deleted" ON "public"."users" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_users_telegram_id" ON "public"."users" USING "btree" ("telegram_id");



CREATE UNIQUE INDEX "payme_transactions_active_order" ON "public"."payme_transactions" USING "btree" ("order_id") WHERE ("state" = ANY (ARRAY[1, 2]));



CREATE INDEX "payme_transactions_order_idx" ON "public"."payme_transactions" USING "btree" ("order_id");



CREATE INDEX "promotions_type_active_idx" ON "public"."promotions" USING "btree" ("type", "is_active");



CREATE INDEX "referrals_code_idx" ON "public"."referrals" USING "btree" ("referral_code");



CREATE INDEX "referrals_referrer_idx" ON "public"."referrals" USING "btree" ("referrer_telegram_id");



CREATE INDEX "reviews_product_id_idx" ON "public"."reviews" USING "btree" ("product_id");



CREATE INDEX "reviews_telegram_user_id_idx" ON "public"."reviews" USING "btree" ("telegram_user_id");



CREATE OR REPLACE TRIGGER "on_price_drop_log" AFTER UPDATE ON "public"."products" FOR EACH ROW WHEN (("new"."price" < "old"."price")) EXECUTE FUNCTION "public"."log_product_change"();



CREATE OR REPLACE TRIGGER "on_stock_available_log" AFTER UPDATE ON "public"."products" FOR EACH ROW WHEN ((("old"."stock" = 0) AND ("new"."stock" > 0))) EXECUTE FUNCTION "public"."log_product_change"();



CREATE OR REPLACE TRIGGER "trg_order_created" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."on_order_created"();



CREATE OR REPLACE TRIGGER "trg_order_status_change" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."on_order_status_change"();



CREATE OR REPLACE TRIGGER "update_admin_accounts_updated_at" BEFORE UPDATE ON "public"."admin_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_banners_updated_at" BEFORE UPDATE ON "public"."banners" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_coupons_updated_at" BEFORE UPDATE ON "public"."coupons" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_delivery_zones_updated_at" BEFORE UPDATE ON "public"."delivery_zones" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_messages_updated_at"();



CREATE OR REPLACE TRIGGER "update_orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_product_analytics_updated_at" BEFORE UPDATE ON "public"."product_analytics" FOR EACH ROW EXECUTE FUNCTION "public"."update_product_analytics_updated_at"();



CREATE OR REPLACE TRIGGER "update_product_collections_updated_at" BEFORE UPDATE ON "public"."product_collections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_promotions_updated_at" BEFORE UPDATE ON "public"."promotions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_returns_updated_at" BEFORE UPDATE ON "public"."returns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_reviews_updated_at" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."broadcast_failures"
    ADD CONSTRAINT "broadcast_failures_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."broadcast_jobs"("id");



ALTER TABLE ONLY "public"."coupon_usage"
    ADD CONSTRAINT "coupon_usage_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorites"
    ADD CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id");



ALTER TABLE ONLY "public"."payme_transactions"
    ADD CONSTRAINT "payme_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."product_analytics"
    ADD CONSTRAINT "product_analytics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_relations"
    ADD CONSTRAINT "product_relations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_relations"
    ADD CONSTRAINT "product_relations_related_product_id_fkey" FOREIGN KEY ("related_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



CREATE POLICY "Public read approved reviews" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (("is_approved" = true));



CREATE POLICY "Public read banners" ON "public"."banners" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read categories" ON "public"."categories" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read coupon_usage" ON "public"."coupon_usage" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read delivery_zones" ON "public"."delivery_zones" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read favorites" ON "public"."favorites" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read notifications" ON "public"."notifications" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read orders" ON "public"."orders" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read product_collections" ON "public"."product_collections" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read product_relations" ON "public"."product_relations" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read products" ON "public"."products" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read promotions" ON "public"."promotions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read referrals" ON "public"."referrals" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read returns" ON "public"."returns" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Public read users" ON "public"."users" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Service role full access to broadcast_failures" ON "public"."broadcast_failures" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage abandoned_carts" ON "public"."abandoned_carts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage admin_accounts" ON "public"."admin_accounts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage audit_log" ON "public"."audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage banners" ON "public"."banners" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage bot_users" ON "public"."bot_users" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage categories" ON "public"."categories" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage coupon_usage" ON "public"."coupon_usage" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage delivery_zones" ON "public"."delivery_zones" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage favorites" ON "public"."favorites" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage notifications" ON "public"."notifications" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage orders" ON "public"."orders" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage product_collections" ON "public"."product_collections" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage product_relations" ON "public"."product_relations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage products" ON "public"."products" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage promotions" ON "public"."promotions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage referrals" ON "public"."referrals" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage returns" ON "public"."returns" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage reviews" ON "public"."reviews" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role manage users" ON "public"."users" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users read own favorites" ON "public"."favorites" FOR SELECT USING (true);



ALTER TABLE "public"."abandoned_carts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon_select_approved_reviews" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (("is_approved" = true));



CREATE POLICY "anon_select_product_collections" ON "public"."product_collections" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "anon_select_product_relations" ON "public"."product_relations" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "anon_select_promotions" ON "public"."promotions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "audit_anon_denied" ON "public"."audit_log" FOR SELECT USING (false);



CREATE POLICY "audit_full_access" ON "public"."audit_log" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."banners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "banners_anon_select" ON "public"."banners" FOR SELECT USING (true);



CREATE POLICY "banners_full_access" ON "public"."banners" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."bot_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "broadcast_anon_denied" ON "public"."broadcast_jobs" FOR SELECT USING (false);



ALTER TABLE "public"."broadcast_failures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "broadcast_full_access" ON "public"."broadcast_jobs" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."broadcast_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_anon_select" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "categories_full_access" ON "public"."categories" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."coupon_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coupon_usage_anon_denied" ON "public"."coupon_usage" FOR SELECT USING (false);



CREATE POLICY "coupon_usage_full_access" ON "public"."coupon_usage" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "coupon_usage_insert" ON "public"."coupon_usage" FOR INSERT TO "authenticated", "anon" WITH CHECK (("coupon_id" IS NOT NULL));



CREATE POLICY "coupon_usage_select_own" ON "public"."coupon_usage" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coupons_anon_denied" ON "public"."coupons" FOR SELECT USING (false);



CREATE POLICY "coupons_full_access" ON "public"."coupons" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."delivery_zones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."favorites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "favorites_anon_denied" ON "public"."favorites" FOR SELECT USING (false);



CREATE POLICY "favorites_full_access" ON "public"."favorites" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "favorites_insert_own" ON "public"."favorites" FOR INSERT WITH CHECK (("telegram_user_id" IS NOT NULL));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_anon_denied" ON "public"."messages" FOR SELECT USING (false);



CREATE POLICY "messages_full_access" ON "public"."messages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "messages_insert_own" ON "public"."messages" FOR INSERT WITH CHECK ((("sender_type" IS NOT NULL) AND ("sender_id" IS NOT NULL)));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_anon_denied" ON "public"."notifications" FOR SELECT USING (false);



CREATE POLICY "notifications_full_access" ON "public"."notifications" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_anon_denied" ON "public"."orders" FOR SELECT USING (false);



CREATE POLICY "orders_full_access" ON "public"."orders" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."payme_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payme_transactions_anon_denied" ON "public"."payme_transactions" FOR SELECT USING (false);



CREATE POLICY "payme_transactions_full_access" ON "public"."payme_transactions" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."product_analytics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_analytics_insert" ON "public"."product_analytics" FOR INSERT WITH CHECK (("product_id" IS NOT NULL));



CREATE POLICY "product_analytics_select" ON "public"."product_analytics" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "product_analytics_update" ON "public"."product_analytics" FOR UPDATE USING (("product_id" IS NOT NULL)) WITH CHECK (("product_id" IS NOT NULL));



ALTER TABLE "public"."product_collections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_anon_select" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "products_full_access" ON "public"."products" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "referrals_anon_denied" ON "public"."referrals" FOR SELECT USING (false);



CREATE POLICY "referrals_full_access" ON "public"."referrals" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "referrals_select_own" ON "public"."referrals" FOR SELECT USING (true);



ALTER TABLE "public"."returns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "returns_anon_denied" ON "public"."returns" FOR SELECT USING (false);



CREATE POLICY "returns_full_access" ON "public"."returns" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "returns_insert_own" ON "public"."returns" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("order_id" IS NOT NULL) AND ("reason" IS NOT NULL)));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_anon_select" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "reviews_full_access" ON "public"."reviews" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "reviews_insert_own" ON "public"."reviews" FOR INSERT WITH CHECK ((("product_id" IS NOT NULL) AND ("rating" >= 1) AND ("rating" <= 5)));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_anon_denied" ON "public"."users" FOR SELECT USING (false);



CREATE POLICY "users_full_access" ON "public"."users" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "zones_anon_select" ON "public"."delivery_zones" FOR SELECT USING (true);



CREATE POLICY "zones_full_access" ON "public"."delivery_zones" USING (("auth"."role"() = 'service_role'::"text"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































































































































REVOKE ALL ON FUNCTION "public"."add_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."append_order_status"("p_order_id" "uuid", "p_status" "text", "p_changed_by" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."append_order_status"("p_order_id" "uuid", "p_status" "text", "p_changed_by" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."clear_read_notifications"("p_telegram_user_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_read_notifications"("p_telegram_user_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_order_with_stock"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_product_analytics"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_product_analytics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_product_analytics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_conversations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_conversations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_all_product_analytics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_all_product_analytics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_client_favorites"("p_telegram_user_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_client_favorites"("p_telegram_user_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_client_orders"("p_telegram_user_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_client_orders"("p_telegram_user_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_favorites_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_favorites_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_favorites_stats"() TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."messages" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."messages" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."messages" TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_messages"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_messages"("p_order_id" "uuid") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_analytics" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_analytics" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_analytics" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_product_favorites_stats"("p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_product_favorites_stats"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_favorites_stats"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_unread_message_count"("p_sender_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_unread_message_count"("p_sender_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hash_admin_password"("p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hash_admin_password"("p_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_views"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_views"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_views"("p_id" "uuid") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."notifications" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_notification"("p_telegram_user_id" bigint, "p_type" "text", "p_title" "text", "p_body" "text", "p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_notification"("p_telegram_user_id" bigint, "p_type" "text", "p_title" "text", "p_body" "text", "p_data" "jsonb") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_order"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_order"("p_telegram_user_id" bigint, "p_items" "jsonb", "p_total_amount" numeric, "p_customer_info" "jsonb", "p_delivery_type" "text", "p_delivery_cost" numeric, "p_payment_method" "text", "p_notes" "text", "p_coupon_id" "uuid", "p_discount_amount" numeric) TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."returns" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."returns" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."returns" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_return"("p_telegram_user_id" bigint, "p_order_id" "text", "p_items" "jsonb", "p_reason" "text", "p_photos" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_return"("p_telegram_user_id" bigint, "p_order_id" "text", "p_items" "jsonb", "p_reason" "text", "p_photos" "jsonb") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reviews" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reviews" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."reviews" TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_review"("p_product_id" "uuid", "p_telegram_user_id" bigint, "p_user_name" "text", "p_rating" integer, "p_comment" "text", "p_images" "jsonb", "p_photos" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_review"("p_product_id" "uuid", "p_telegram_user_id" bigint, "p_user_name" "text", "p_rating" integer, "p_comment" "text", "p_images" "jsonb", "p_photos" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_all_notifications_read"("p_telegram_user_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"("p_telegram_user_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_messages_read"("p_order_id" "uuid", "p_sender_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_messages_read"("p_order_id" "uuid", "p_sender_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_notification_read"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notification_read"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_coupon_usage"("p_coupon_id" "uuid", "p_telegram_user_id" bigint, "p_order_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_coupon_usage"("p_coupon_id" "uuid", "p_telegram_user_id" bigint, "p_order_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_message"("p_order_id" "uuid", "p_sender_type" "text", "p_sender_id" "text", "p_receiver_id" "text", "p_content" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_message"("p_order_id" "uuid", "p_sender_type" "text", "p_sender_id" "text", "p_receiver_id" "text", "p_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."track_product_event"("p_product_id" "uuid", "p_event_type" "text", "p_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."track_product_event"("p_product_id" "uuid", "p_event_type" "text", "p_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_product_event"("p_product_id" "uuid", "p_event_type" "text", "p_delta" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_favorite"("p_telegram_user_id" bigint, "p_product_id" "uuid", "p_notify_price" boolean, "p_notify_stock" boolean) TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text", "p_latitude" double precision, "p_longitude" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_user"("p_telegram_id" bigint, "p_first_name" "text", "p_username" "text", "p_language" "text", "p_phone" "text", "p_address" "text", "p_latitude" double precision, "p_longitude" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_admin_password"("p_email" "text", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_admin_password"("p_email" "text", "p_password" "text") TO "service_role";


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."abandoned_carts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."abandoned_carts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."abandoned_carts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_accounts" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_accounts" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."admin_accounts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."banners" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."banners" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."banners" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bot_users" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bot_users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."bot_users" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_failures" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_failures" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_failures" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_jobs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_jobs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."broadcast_jobs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupon_usage" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupon_usage" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupon_usage" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupons" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupons" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."coupons" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_zones" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_zones" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."delivery_zones" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."favorites" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."favorites" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."favorites" TO "service_role";



GRANT ALL ON TABLE "public"."payme_transactions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_collections" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_collections" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_collections" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_relations" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_relations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_relations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."promotions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."promotions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."promotions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."referrals" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."referrals" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."referrals" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE POLICY "Auth can delete product images" ON "storage"."objects" FOR DELETE USING (("bucket_id" = 'product-images'::"text"));



CREATE POLICY "Auth can update product images" ON "storage"."objects" FOR UPDATE USING (("bucket_id" = 'product-images'::"text")) WITH CHECK (("bucket_id" = 'product-images'::"text"));



CREATE POLICY "Auth can upload product images" ON "storage"."objects" FOR INSERT WITH CHECK (("bucket_id" = 'product-images'::"text"));



CREATE POLICY "Authenticated delete product images" ON "storage"."objects" FOR DELETE TO "authenticated" USING (("bucket_id" = 'product-images'::"text"));



CREATE POLICY "Authenticated upload product images" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK (("bucket_id" = 'product-images'::"text"));



CREATE POLICY "anon can delete banner images" ON "storage"."objects" FOR DELETE TO "anon" USING (("bucket_id" = 'banner-images'::"text"));



CREATE POLICY "anon can upload banner images" ON "storage"."objects" FOR INSERT TO "anon" WITH CHECK (("bucket_id" = 'banner-images'::"text"));



CREATE POLICY "anon can upload return photos" ON "storage"."objects" FOR INSERT TO "authenticated", "anon" WITH CHECK (("bucket_id" = 'return-photos'::"text"));



CREATE POLICY "anon can upload review photos" ON "storage"."objects" FOR INSERT TO "authenticated", "anon" WITH CHECK (("bucket_id" = 'review-photos'::"text"));



