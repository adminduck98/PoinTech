import { supabase, USE_MOCK_DATA, Database } from '../supabase';
import { clientApiCall, NoTelegramSessionError } from '../clientApi';
import { tg, refreshTg } from '../telegram';
import type { Product } from './products';
import { delay } from './mock';

export type User = Database['public']['Tables']['users']['Row'];

export interface FavoritePrefs {
  notify_price: boolean;
  notify_stock: boolean;
}

/** Notification preferences keyed by product id. */
export type FavoritePrefsMap = Record<string, FavoritePrefs>;

export const userQueries = {
  getByTelegramId: async (telegramId: number) => {
    if (USE_MOCK_DATA) {
      await delay();
      return { id: `${telegramId}`, telegram_id: telegramId, first_name: 'Гость', username: null, language: 'ru', phone: null, address: null, latitude: null, longitude: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as User;
    }
    // Served by client-api: RLS denies anon SELECT on `users`, so the direct
    // query this used to make always resolved to null and the profile prefill
    // (name/phone/address in Profile and Checkout) never populated.
    return clientApiCall<User | null>('get_user_profile', { p_telegram_user_id: telegramId });
  },

  upsert: async (telegramId: number, userData: { first_name: string; username?: string | null; language?: string; phone?: string; latitude?: number | null; longitude?: number | null }) => {
    if (USE_MOCK_DATA) {
      await delay();
      return { id: `${telegramId}`, telegram_id: telegramId, ...userData, phone: null, address: null, latitude: null, longitude: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as User;
    }
    const rpcParams = {
      p_telegram_id: telegramId,
      p_first_name: userData.first_name,
      p_username: userData.username ?? null,
      p_language: userData.language ?? 'ru',
      p_phone: userData.phone ?? null,
      p_latitude: userData.latitude ?? null,
      p_longitude: userData.longitude ?? null,
    };
    return clientApiCall<User>('upsert_user', rpcParams);
  },

  updateProfile: async (telegramId: number, updates: { phone?: string; address?: string; first_name?: string; latitude?: number | null; longitude?: number | null }) => {
    if (USE_MOCK_DATA) {
      await delay();
      return { id: `${telegramId}`, telegram_id: telegramId, first_name: updates.first_name || 'Гость', username: null, language: 'ru', phone: updates.phone ?? null, address: updates.address ?? null, latitude: updates.latitude ?? null, longitude: updates.longitude ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as User;
    }
    const rpcParams = {
      p_telegram_id: telegramId,
      p_first_name: updates.first_name || 'Гость',
      p_phone: updates.phone ?? null,
      p_address: updates.address ?? null,
      p_latitude: updates.latitude ?? null,
      p_longitude: updates.longitude ?? null,
    };
    return clientApiCall<User>('upsert_user', rpcParams);
  },
};

export const favoriteQueries = {
  getByUser: async (telegramUserId: number) => {
    if (USE_MOCK_DATA || !telegramUserId) return [];
    const data = await clientApiCall<Record<string, unknown>[]>('get_client_favorites', { p_telegram_user_id: telegramUserId });
    return (data ?? [])
      .filter((row: Record<string, unknown>) => row.id !== null)
      .map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name,
        slug: row.slug as string,
        price: row.price as number,
        images: row.images as string[],
        is_active: row.is_active as boolean,
        stock: row.stock as number,
        sizes: row.sizes as string[],
        colors: row.colors as { name: string; hex: string }[],
        favoriteId: row.product_id as string,
        notify_price: row.notify_price as boolean,
        notify_stock: row.notify_stock as boolean,
      })) as (Product & { favoriteId: string; notify_price: boolean; notify_stock: boolean })[];
  },

  getProductIds: async (telegramUserId: number) => {
    if (USE_MOCK_DATA || !telegramUserId) return [] as string[];
    const data = await clientApiCall<Record<string, unknown>[]>('get_client_favorites', { p_telegram_user_id: telegramUserId });
    return (data ?? []).filter((row: Record<string, unknown>) => row.id !== null).map((row: Record<string, unknown>) => row.product_id as string);
  },

  add: async (telegramUserId: number, productId: string) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('add_favorite', { p_telegram_user_id: telegramUserId, p_product_id: productId });
  },

  remove: async (telegramUserId: number, productId: string) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('remove_favorite', { p_telegram_user_id: telegramUserId, p_product_id: productId });
  },

  updatePrefs: async (telegramUserId: number, productId: string, prefs: { notify_price?: boolean; notify_stock?: boolean }) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('update_favorite', {
      p_telegram_user_id: telegramUserId,
      p_product_id: productId,
      p_notify_price: prefs.notify_price ?? null,
      p_notify_stock: prefs.notify_stock ?? null,
    });
  },

  /**
   * Notification preferences for every favourited product, keyed by product id.
   *
   * This used to be a per-product `getPrefs(userId, productId)`, and each call
   * fetched the *whole* wishlist to read one row. WishlistToggle renders on
   * every product card, so a 20-item catalogue page issued 20 identical
   * round-trips to client-api — which rate-limits at 30 requests/minute per IP,
   * so scrolling to the second page returned 429 for everything the user did
   * next (profile, notifications, chat, checkout).
   *
   * One request per user now; callers pick their product out of the map.
   */
  getPrefsMap: async (telegramUserId: number) => {
    if (USE_MOCK_DATA || !telegramUserId) return {} as FavoritePrefsMap;
    const data = await clientApiCall<Record<string, unknown>[]>('get_client_favorites', { p_telegram_user_id: telegramUserId }).catch(() => null);
    if (!data) return {} as FavoritePrefsMap;
    const map: FavoritePrefsMap = {};
    for (const row of data) {
      const productId = row.product_id as string | undefined;
      if (!productId) continue;
      map[productId] = {
        notify_price: Boolean(row.notify_price),
        notify_stock: Boolean(row.notify_stock),
      };
    }
    return map;
  },

  getAllStats: async () => {
    if (USE_MOCK_DATA) return [];
    const { data, error } = await supabase.rpc('get_favorites_stats');
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => ({
      product_id: row.product_id as string,
      likes: Number(row.likes),
      notify_price: Number(row.notify_price),
      notify_stock: Number(row.notify_stock),
    }));
  },

  getStatsForProduct: async (productId: string) => {
    if (USE_MOCK_DATA) return { likes: 0, notify_price: 0, notify_stock: 0 };
    const { data, error } = await supabase.rpc('get_product_favorites_stats', { p_product_id: productId });
    if (error) throw error;
    const row = data?.[0];
    return { likes: Number(row?.likes ?? 0), notify_price: Number(row?.notify_price ?? 0), notify_stock: Number(row?.notify_stock ?? 0) };
  },

};

export const paymentQueries = {
  // create-payment now verifies Telegram initData and checks the order belongs
  // to the caller, so the request must carry it like every other user-scoped call.
  createPayment: async (orderId: string, amount: number, paymentMethod: 'payme' | 'click' | 'uzum') => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) { return { paymentUrl: null, orderId }; }

    refreshTg();
    const initData = tg?.initData;
    if (!initData) throw new NoTelegramSessionError();

    const response = await fetch(`${supabaseUrl}/functions/v1/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'Apikey': anonKey },
      body: JSON.stringify({ orderId, amount, paymentMethod, init_data: initData }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to create payment');
    }
    return response.json();
  },
};
