import { USE_MOCK_DATA, Database } from '../supabase';
import { adminQueries } from '../adminApi';
import { clientApiCall } from '../clientApi';
import { delay } from './mock';
import { encodeFileForUpload, type UploadedPhoto } from '../fileUpload';

export type Return = Database['public']['Tables']['returns']['Row'];
export type Notification = Database['public']['Tables']['notifications']['Row'];
export type AuditLogEntry = Database['public']['Tables']['audit_log']['Row'];

export const returnQueries = {
  /** Фото к заявке на возврат — через client-api, с проверкой подписи Telegram. */
  uploadPhoto: async (file: File): Promise<UploadedPhoto> => {
    if (USE_MOCK_DATA) { await delay(); const u = URL.createObjectURL(file); return { path: u, url: u }; }
    const encoded = await encodeFileForUpload(file);
    return clientApiCall<UploadedPhoto>('upload_return_photo', encoded as unknown as Record<string, unknown>);
  },

  create: async (returnData: Omit<Return, 'id' | 'created_at' | 'updated_at' | 'status' | 'refund_amount' | 'admin_note'>) => {
    if (USE_MOCK_DATA) return { ...returnData, id: `ret-${Date.now()}`, status: 'pending' as const, refund_amount: 0, admin_note: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as Return;
    return clientApiCall<Return>('insert_return', {
      p_telegram_user_id: returnData.telegram_user_id,
      p_order_id: returnData.order_id,
      p_items: returnData.items,
      p_reason: returnData.reason,
      p_photos: returnData.photos ?? [],
    });
  },

  // `returns` is anon-denied by RLS, so both of these used to resolve to an
  // empty list instead of failing: customers saw no return requests and the
  // admin screen looked empty.
  getByUser: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) return [];
    return clientApiCall<Return[]>('get_user_returns', { p_telegram_user_id: telegramUserId });
  },

  getAll: async () => {
    if (USE_MOCK_DATA) return [];
    const data = await adminQueries.getReturns();
    return (Array.isArray(data) ? data : []) as Return[];
  },

  updateStatus: async (id: string, status: Return['status'], adminNote?: string) => {
    if (USE_MOCK_DATA) return {} as Return;
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (adminNote) updates.admin_note = adminNote;
    if (status === 'refunded') updates.refund_amount = 0;
    return adminQueries.updateReturnStatus(id, updates) as Promise<Return>;
  },
};

export const notificationQueries = {
  // `notifications` is anon-denied by RLS. Reading it directly returned an
  // empty list and a zero count, which is why the notification screen and the
  // header badge never showed anything.
  getByUser: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) return [];
    return clientApiCall<Notification[]>('get_notifications', { p_telegram_user_id: telegramUserId });
  },

  getUnreadCount: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) return 0;
    return clientApiCall<number>('get_unread_notification_count', { p_telegram_user_id: telegramUserId });
  },

  markAsRead: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('mark_notification_read', { p_id: id });
  },

  markAllAsRead: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('mark_all_notifications_read', { p_telegram_user_id: telegramUserId });
  },

  clearAllRead: async (telegramUserId: number) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('clear_read_notifications', { p_telegram_user_id: telegramUserId });
  },

  // `create` was removed: it called insert_notification with the anon key, which
  // let anyone push arbitrary notifications to any user. It had no callers.
  // Notifications are created server-side (admin-api / checkout / auto-notify).
};

export const auditLogQueries = {
  log: async (entry: Omit<AuditLogEntry, 'id' | 'created_at' | 'ip_address' | 'entity_id'> & { entity_id?: string | null; ip_address?: string | null }) => {
    if (USE_MOCK_DATA) return;
    try {
      await adminQueries.insertAuditLog({ ...entry, entity_id: entry.entity_id ?? null, ip_address: entry.ip_address ?? null });
    } catch { /* non-critical */ }
  },

  getAll: async (limit = 100) => {
    if (USE_MOCK_DATA) return [];
    try {
      const data = await adminQueries.getAuditLogFiltered({});
      return (Array.isArray(data) ? data : []).slice(0, limit);
    } catch { return []; }
  },

  getByEntity: async (entityType: string, entityId?: string) => {
    if (USE_MOCK_DATA) return [];
    try {
      const filters: Record<string, unknown> = { entity_type: entityType };
      if (entityId) filters.entity_id = entityId;
      const data = await adminQueries.getAuditLogFiltered(filters);
      return Array.isArray(data) ? data.slice(0, 50) : [];
    } catch { return []; }
  },

  getByAdmin: async (adminId: string) => {
    if (USE_MOCK_DATA) return [];
    try {
      const data = await adminQueries.getAuditLogFiltered({ admin_id: adminId });
      return Array.isArray(data) ? data.slice(0, 100) : [];
    } catch { return []; }
  },
};
