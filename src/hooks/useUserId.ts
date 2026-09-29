import { getTelegramUser } from '../lib/telegram';
import { useAppStore } from '../store/useAppStore';

/**
 * The current user's Telegram id, or 0 when the app is not running inside
 * Telegram.
 *
 * This is a display/query key only — it is never trusted as proof of identity.
 * Every user-scoped read and write goes through the client-api Edge Function,
 * which derives the acting user from verified initData and ignores whatever id
 * the client sends.
 *
 * There used to be a fallback that derived an id from a self-declared phone
 * number (its last 9 digits). That was removed: it authenticated nobody, and
 * 9-digit values collide with the real Telegram id range, so a phone-registered
 * visitor could be handed the same id as an existing Telegram account.
 */
export function useUserId(): number {
  // Subscribe directly to the reactive value, not to a stable getter function
  // reference — selecting `s.getUserId` never changes identity when
  // `telegramUserId` updates, so components subscribed to it don't re-render
  // once the Telegram ID becomes available (causing favorites/other
  // user-scoped data to look "reset" until an unrelated re-render occurs).
  const telegramUserId = useAppStore((s) => s.telegramUserId);

  const liveTelegramId = getTelegramUser()?.id;
  if (liveTelegramId) return liveTelegramId;
  if (telegramUserId) return telegramUserId;

  try {
    const liveUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (liveUser?.id) return liveUser.id;
  } catch { /* noop */ }

  return 0;
}
