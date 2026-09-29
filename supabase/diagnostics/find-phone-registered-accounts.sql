-- ============================================================
-- Diagnostic (READ-ONLY): find accounts created by the removed
-- phone-based registration flow.
--
-- That flow derived a user id from the last 9 digits of a self-declared,
-- unverified phone number:
--
--     telegram_id = parseInt(phone.replace(/\D/g,'').slice(-9))
--
-- Such rows are identifiable exactly, because the id is a pure function of the
-- phone stored on the same row. A genuine Telegram account whose real id
-- happens to equal the last 9 digits of its own phone number is possible in
-- principle but vanishingly unlikely.
--
-- Two things make these rows worth reviewing:
--
--   1. Nobody proved ownership of the phone number, so the row may have been
--      created by someone other than its owner.
--   2. 9-digit ids overlap the real Telegram id range (older accounts have
--      8-10 digit ids). A phone-derived row can therefore COLLIDE with a real
--      Telegram user, who would then see the other person's orders.
--
-- This script only reports. Decide what to do with the rows yourself —
-- deleting them also deletes the order history attached to that id.
-- ============================================================

\echo '--- 1. Suspected phone-registered accounts ---'

SELECT
  u.id,
  u.telegram_id,
  u.first_name,
  u.username,
  u.phone,
  u.created_at
FROM users u
WHERE u.phone IS NOT NULL
  AND length(regexp_replace(u.phone, '\D', '', 'g')) >= 9
  AND right(regexp_replace(u.phone, '\D', '', 'g'), 9)::bigint = u.telegram_id
ORDER BY u.created_at DESC;

\echo '--- 2. Summary ---'

WITH suspect AS (
  SELECT u.telegram_id
  FROM users u
  WHERE u.phone IS NOT NULL
    AND length(regexp_replace(u.phone, '\D', '', 'g')) >= 9
    AND right(regexp_replace(u.phone, '\D', '', 'g'), 9)::bigint = u.telegram_id
)
SELECT
  (SELECT count(*) FROM suspect)                                   AS suspect_accounts,
  (SELECT count(*) FROM orders o
     WHERE o.telegram_user_id IN (SELECT telegram_id FROM suspect)) AS orders_attached,
  (SELECT count(*) FROM users
     WHERE telegram_id BETWEEN 100000000 AND 999999999)             AS all_9_digit_accounts;

\echo '--- 3. Accounts that also have Telegram-native activity (do NOT delete) ---'
-- A suspect id that also has a username, or bot_users/messages activity, is
-- most likely a real Telegram account that collided with a phone-derived id.

WITH suspect AS (
  SELECT u.telegram_id
  FROM users u
  WHERE u.phone IS NOT NULL
    AND length(regexp_replace(u.phone, '\D', '', 'g')) >= 9
    AND right(regexp_replace(u.phone, '\D', '', 'g'), 9)::bigint = u.telegram_id
)
SELECT
  u.telegram_id,
  u.first_name,
  u.username,
  EXISTS (SELECT 1 FROM bot_users b WHERE b.chat_id = u.telegram_id) AS talked_to_bot
FROM users u
JOIN suspect s ON s.telegram_id = u.telegram_id
WHERE u.username IS NOT NULL
   OR EXISTS (SELECT 1 FROM bot_users b WHERE b.chat_id = u.telegram_id);
