import { USE_MOCK_DATA, Database } from '../supabase';
import { clientApiCall } from '../clientApi';
import { delay, mockOrders } from './mock';

export type Order = Database['public']['Tables']['orders']['Row'];

/**
 * Shape returned by get_client_orders(): the orders row plus the archival
 * columns the client list needs.
 */
export type ClientOrder = Order & {
  deleted_at: string | null;
  visible_to_client: boolean;
  archived_at: string | null;
  cancellation_reason: string | null;
};

export const orderQueries = {
  // `create` was removed: it called insert_order() with the anon key, which
  // skipped every check the checkout Edge Function performs (stock, price
  // tampering, coupon validity). Orders are created only via /functions/v1/checkout.

  // Served by client-api: get_client_orders() takes a bare telegram id and
  // returns full customer PII, so it must never be reachable with the anon key.
  getByTelegramUserId: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) { await delay(); return mockOrders; }
    return clientApiCall<ClientOrder[]>('get_client_orders', { p_telegram_user_id: telegramUserId });
  },

  // getById and subscribeToOrders were removed: both queried `orders` directly
  // with the anon key, which RLS denies, and neither had any callers.

  // NOTE: order status transitions are admin-only and must go through the
  // admin-api Edge Function (`adminQueries.updateOrderStatus`), which validates
  // an admin session and calls append_order_status with service_role.
  // The former direct `supabase.rpc('append_order_status', ...)` path relied on
  // an anon EXECUTE grant that let anyone move any order to any status; that
  // grant is revoked in 20260811000000, so this path no longer exists.

};
