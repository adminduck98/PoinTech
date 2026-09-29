import { supabase, USE_MOCK_DATA, Database } from '../supabase';
import { adminQueries } from '../adminApi';
import { clientApiCall } from '../clientApi';
import { delay, mockBanners, mockDeliveryZones } from './mock';

export type Banner = {
  id: string;
  title: { ru: string; uz: string };
  subtitle: { ru: string; uz: string };
  image_url: string;
  link_url: string | null;
  link_label: { ru: string; uz: string } | null;
  bg_color: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DeliveryZone = {
  id: string;
  city_ru: string;
  city_uz: string;
  region_ru: string;
  region_uz: string;
  standard_price: number;
  express_price: number;
  standard_days_min: number;
  standard_days_max: number;
  express_days_min: number;
  express_days_max: number;
  free_threshold: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Coupon = Database['public']['Tables']['coupons']['Row'];
export type CouponUsage = Database['public']['Tables']['coupon_usage']['Row'];

export const bannerQueries = {
  getActive: async (): Promise<Banner[]> => {
    if (USE_MOCK_DATA) { await delay(); return mockBanners.filter((b) => b.is_active); }
    const { data, error } = await supabase.from('banners').select('*').eq('is_active', true).order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Banner[];
  },

  getAll: async (): Promise<Banner[]> => {
    if (USE_MOCK_DATA) { await delay(); return mockBanners; }
    const { data, error } = await supabase.from('banners').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Banner[];
  },

  create: async (banner: Omit<Banner, 'id' | 'created_at' | 'updated_at'>): Promise<Banner> => {
    if (USE_MOCK_DATA) { await delay(); return { ...banner, id: `banner-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
    return adminQueries.createBanner(banner as Record<string, unknown>) as Promise<Banner>;
  },

  update: async (id: string, banner: Partial<Omit<Banner, 'id' | 'created_at' | 'updated_at'>>): Promise<Banner> => {
    if (USE_MOCK_DATA) { await delay(); return mockBanners[0] as Banner; }
    return adminQueries.updateBanner(id, banner as Record<string, unknown>) as Promise<Banner>;
  },

  delete: async (id: string): Promise<void> => {
    if (USE_MOCK_DATA) { await delay(); return; }
    await adminQueries.deleteBanner(id);
  },
};

export const deliveryZoneQueries = {
  getActive: async (): Promise<DeliveryZone[]> => {
    if (USE_MOCK_DATA) { await delay(); return mockDeliveryZones.filter((z) => z.is_active); }
    const { data, error } = await supabase.from('delivery_zones').select('*').eq('is_active', true).order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DeliveryZone[];
  },

  getAll: async (): Promise<DeliveryZone[]> => {
    if (USE_MOCK_DATA) { await delay(); return mockDeliveryZones; }
    const { data, error } = await supabase.from('delivery_zones').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DeliveryZone[];
  },

  create: async (zone: Omit<DeliveryZone, 'id' | 'created_at' | 'updated_at'>): Promise<DeliveryZone> => {
    if (USE_MOCK_DATA) { await delay(); return { ...zone, id: `zone-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
    return adminQueries.createDeliveryZone(zone as Record<string, unknown>) as Promise<DeliveryZone>;
  },

  update: async (id: string, zone: Partial<Omit<DeliveryZone, 'id' | 'created_at' | 'updated_at'>>): Promise<DeliveryZone> => {
    if (USE_MOCK_DATA) { await delay(); const z = mockDeliveryZones.find((z) => z.id === id); if (z) Object.assign(z, zone); return z as DeliveryZone; }
    return adminQueries.updateDeliveryZone(id, zone as Record<string, unknown>) as Promise<DeliveryZone>;
  },

  delete: async (id: string): Promise<void> => {
    if (USE_MOCK_DATA) { await delay(); return; }
    await adminQueries.deleteDeliveryZone(id);
  },
};

export const couponQueries = {
  // Validated by client-api using the same module checkout uses. The old
  // client-side version queried coupon_usage and orders directly, where RLS
  // denies anon: every count came back 0, so max_uses_total, max_uses_per_user
  // and new_customers_only always passed and the cart promised a discount that
  // checkout would then refuse.
  validate: async (code: string, telegramUserId: number, orderAmount: number) => {
    if (USE_MOCK_DATA) return { valid: true, coupon: null, discount: 0, error: null };
    return clientApiCall<{ valid: boolean; coupon: Coupon | null; discount: number; error: string | null }>(
      'validate_coupon',
      { p_code: code, p_telegram_user_id: telegramUserId, p_subtotal: orderAmount },
    );
  },

  recordUsage: async (couponId: string, telegramUserId: number, orderId?: string) => {
    if (USE_MOCK_DATA) return;
    await clientApiCall('record_coupon_usage', {
      p_coupon_id: couponId,
      p_telegram_user_id: telegramUserId,
      p_order_id: orderId ?? null,
    });
  },

  // Admin-only listing. Coupon codes are secrets, so the table is no longer
  // readable with the anon key — see 20260811030000.
  getAll: async () => {
    if (USE_MOCK_DATA) return [];
    const data = await adminQueries.getCoupons();
    return (Array.isArray(data) ? data : []) as Coupon[];
  },

  create: async (coupon: Omit<Coupon, 'id' | 'created_at' | 'updated_at'>) => {
    if (USE_MOCK_DATA) return { ...coupon, id: `coupon-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as Coupon;
    return adminQueries.createCoupon(coupon as Record<string, unknown>) as Promise<Coupon>;
  },

  update: async (id: string, updates: Partial<Omit<Coupon, 'id' | 'created_at' | 'updated_at'>>) => {
    if (USE_MOCK_DATA) return {} as Coupon;
    return adminQueries.updateCoupon(id, updates as Record<string, unknown>) as Promise<Coupon>;
  },

  delete: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await adminQueries.deleteCoupon(id);
  },

};
