import type { EncodedFile } from './fileUpload';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function getAdminSession(): { admin_id: string; token: string } | null {
  try {
    const raw = localStorage.getItem('styletech_admin');
    if (!raw) return null;
    const admin = JSON.parse(raw);
    if (!admin?.id || !admin?._token) return null;
    return { admin_id: admin.id, token: admin._token };
  } catch {
    return null;
  }
}

async function adminApiCall(action: string, table: string, params?: {
  data?: unknown;
  filters?: Record<string, unknown>;
  id?: string;
  retries?: number;
}) {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase not configured');
  }

  const maxRetries = params?.retries ?? 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Every admin-api action requires a session; there is no anonymous mode.
      const admin_session = getAdminSession();

      const body: Record<string, unknown> = { action, table };
      if (params?.data !== undefined) body.data = params.data;
      if (params?.filters !== undefined) body.filters = params.filters;
      if (params?.id !== undefined) body.id = params.id;
      if (admin_session) body.admin_session = admin_session;

      const response = await fetch(`${supabaseUrl}/functions/v1/admin-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Admin API error');
      }

      const result = await response.json();
      return result.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Call an admin-api action that operates on no particular table
 * (dashboardStats, order chat, analytics…). Always sends the admin session.
 */
async function adminActionCall(action: string, payload?: Record<string, unknown>) {
  if (!supabaseUrl || !anonKey) throw new Error('Supabase not configured');

  const admin_session = getAdminSession();
  if (!admin_session) throw new Error('Admin session required');

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'Apikey': anonKey,
    },
    body: JSON.stringify({ action, admin_session, ...payload }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Admin API error (${response.status})`);
  }

  const result = await response.json();
  return result.data;
}

export const adminQueries = {
  // ── Orders ──────────────────────────────────────────────────────────────
  getOrders: () => adminApiCall('select', 'orders'),

  updateOrderStatus: (orderId: string, status: string, changedBy: string) =>
    adminApiCall('updateOrderStatus', 'orders', {
      id: orderId,
      data: { status, changed_by: changedBy },
    }),

  getOrdersFiltered: (filters?: Record<string, unknown>) =>
    adminApiCall('select', 'orders', { filters }),

  // ── Products ─────────────────────────────────────────────────────────────
  getProducts: () => adminApiCall('select', 'products'),

  createProduct: (product: Record<string, unknown>) =>
    adminApiCall('insert', 'products', { data: product }),

  updateProduct: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'products', { id, data: updates }),

  deleteProduct: (id: string) =>
    adminApiCall('delete', 'products', { id }),


  createBanner: (banner: Record<string, unknown>) =>
    adminApiCall('insert', 'banners', { data: banner }),

  updateBanner: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'banners', { id, data: updates }),

  deleteBanner: (id: string) =>
    adminApiCall('delete', 'banners', { id }),


  createDeliveryZone: (zone: Record<string, unknown>) =>
    adminApiCall('insert', 'delivery_zones', { data: zone }),

  updateDeliveryZone: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'delivery_zones', { id, data: updates }),

  deleteDeliveryZone: (id: string) =>
    adminApiCall('delete', 'delivery_zones', { id }),

  // ── Coupons ──────────────────────────────────────────────────────────────
  getCoupons: () => adminApiCall('select', 'coupons'),

  createCoupon: (coupon: Record<string, unknown>) =>
    adminApiCall('insert', 'coupons', { data: coupon }),

  updateCoupon: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'coupons', { id, data: updates }),

  deleteCoupon: (id: string) =>
    adminApiCall('delete', 'coupons', { id }),



  // ── Returns ──────────────────────────────────────────────────────────────
  getReturns: () => adminApiCall('select', 'returns'),
  getReturnsFiltered: (filters?: Record<string, unknown>) =>
    adminApiCall('select', 'returns', { filters }),

  updateReturnStatus: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'returns', { id, data: updates }),


  // ── Users ────────────────────────────────────────────────────────────────
  getUsers: () => adminApiCall('select', 'users'),




  createCategory: (category: Record<string, unknown>) =>
    adminApiCall('insert', 'categories', { data: category }),

  updateCategory: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'categories', { id, data: updates }),

  deleteCategory: (id: string) =>
    adminApiCall('delete', 'categories', { id }),

  getAuditLogFiltered: (filters?: Record<string, unknown>) =>
    adminApiCall('select', 'audit_log', { filters }),

  insertAuditLog: (entry: Record<string, unknown>) =>
    adminApiCall('insert', 'audit_log', { data: entry }),

  // ── Admin Accounts ───────────────────────────────────────────────────────
  getAdminAccounts: () => adminApiCall('select', 'admin_accounts'),

  createAdminAccount: (account: Record<string, unknown>) =>
    adminApiCall('insert', 'admin_accounts', { data: account }),

  updateAdminAccount: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'admin_accounts', { id, data: updates }),

  deleteAdminAccount: (id: string) =>
    adminApiCall('delete', 'admin_accounts', { id }),


  createCollection: (collection: Record<string, unknown>) =>
    adminApiCall('insert', 'product_collections', { data: collection }),

  updateCollection: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'product_collections', { id, data: updates }),

  deleteCollection: (id: string) =>
    adminApiCall('delete', 'product_collections', { id }),

  // ── Reviews ──────────────────────────────────────────────────────────────
  getReviews: () => adminApiCall('select', 'reviews'),

  updateReview: (id: string, updates: Record<string, unknown>) =>
    adminApiCall('update', 'reviews', { id, data: updates }),

  approveReview: (id: string) =>
    adminApiCall('update', 'reviews', { id, data: { is_approved: true } }),

  rejectReview: (id: string) =>
    adminApiCall('update', 'reviews', { id, data: { is_approved: false } }),

  replyToReview: (id: string, reply: string) =>
    adminApiCall('update', 'reviews', { id, data: { admin_reply: reply } }),









  // ── Order chat (admin side) ──────────────────────────────────────────────
  // These replace direct anon RPC calls to get_admin_conversations /
  // get_order_messages / send_message / mark_messages_read.
  getConversations: () => adminActionCall('getConversations'),

  getOrderMessages: (orderId: string) =>
    adminActionCall('getOrderMessages', { data: { order_id: orderId } }),

  sendOrderMessage: (orderId: string, content: string) =>
    adminActionCall('sendMessage', { data: { order_id: orderId, content } }),

  markOrderMessagesRead: (orderId: string) =>
    adminActionCall('markMessagesRead', { data: { order_id: orderId } }),

  // ── Analytics ────────────────────────────────────────────────────────────
  getProductAnalytics: () => adminActionCall('productAnalytics'),

  // ── Загрузка картинок ────────────────────────────────────────────────────
  // Идёт через admin-api, а не напрямую в хранилище: запись делает
  // service_role после проверки сессии и прав, а не анон-ключ из бандла.
  uploadProductImage: (file: EncodedFile): Promise<{ url: string }> =>
    adminActionCall('uploadProductImage', { data: file }),

  uploadBannerImage: (file: EncodedFile): Promise<{ url: string }> =>
    adminActionCall('uploadBannerImage', { data: file }),

  /** Notify everyone watching a product's price or stock. */
  notifyProductWatchers: (productId: string, type: 'price_drop' | 'stock_available') =>
    adminActionCall('notifyProductWatchers', { data: { product_id: productId, type } }),

  // ── Product Relations ────────────────────────────────────────────────────
  createProductRelation: (data: Record<string, unknown>) =>
    adminApiCall('insert', 'product_relations', { data }),

  deleteProductRelation: (id: string) =>
    adminApiCall('delete', 'product_relations', { id }),




};
