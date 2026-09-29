import { supabase, USE_MOCK_DATA, Database } from '../supabase';
import { adminQueries } from '../adminApi';
import { clientApiCall } from '../clientApi';
import { delay } from './mock';
import { encodeFileForUpload, type UploadedPhoto } from '../fileUpload';

export type Review = Database['public']['Tables']['reviews']['Row'];
export type Promotion = Database['public']['Tables']['promotions']['Row'];
export type ProductCollection = Database['public']['Tables']['product_collections']['Row'];
export type ProductRelation = Database['public']['Tables']['product_relations']['Row'];

export const reviewQueries = {
  /**
   * Отзывы отдаёт client-api, а не PostgREST напрямую.
   *
   * Фото отзывов лежат в закрытом бакете: в базе хранится путь, и показать его
   * можно только по подписанной ссылке, которую функция выдаёт на час.
   */
  getByProductId: async (productId: string) => {
    if (USE_MOCK_DATA) { await delay(); return []; }
    return clientApiCall<Review[]>('get_product_reviews', { p_product_id: productId });
  },

  create: async (reviewData: Database['public']['Tables']['reviews']['Insert']) => {
    if (USE_MOCK_DATA) {
      await delay();
      return { ...reviewData, id: `rev-${Date.now()}`, created_at: new Date().toISOString(), is_approved: false, photos: [], images: [], is_verified_purchase: false, admin_reply: null, updated_at: new Date().toISOString(), user_name: reviewData.user_name ?? '' } as Review;
    }
    return clientApiCall<Review>('insert_review', {
      p_product_id: reviewData.product_id,
      p_telegram_user_id: reviewData.telegram_user_id,
      p_user_name: reviewData.user_name,
      p_rating: reviewData.rating,
      p_comment: reviewData.comment ?? null,
      p_images: reviewData.images ?? [],
      p_photos: reviewData.photos ?? [],
    });
  },

  getAverageRating: async (productId: string) => {
    if (USE_MOCK_DATA) return { average: 0, count: 0 };
    const { data, error, count } = await supabase.from('reviews').select('rating', { count: 'exact' }).eq('product_id', productId).eq('is_approved', true);
    if (error) throw error;
    if (!data?.length) return { average: 0, count: 0 };
    return { average: data.reduce((a, r) => a + r.rating, 0) / data.length, count: count ?? data.length };
  },

  /**
   * Фото к отзыву — через client-api, который проверяет подпись Telegram.
   * Прямая запись в хранилище шла под анон-ключом: залить файл мог любой.
   */
  uploadReviewPhoto: async (file: File): Promise<UploadedPhoto> => {
    if (USE_MOCK_DATA) { await delay(); const u = URL.createObjectURL(file); return { path: u, url: u }; }
    const encoded = await encodeFileForUpload(file);
    return clientApiCall<UploadedPhoto>('upload_review_photo', encoded as unknown as Record<string, unknown>);
  },

  getAllWithProductNames: async () => {
    if (USE_MOCK_DATA) return [];
    const reviews = await adminQueries.getReviews() as Review[];
    if (!reviews?.length) return [];
    const productIds = [...new Set(reviews.map((r) => r.product_id))];
    const { data: products } = await supabase.from('products').select('id, name').in('id', productIds);
    const productMap: Record<string, { ru: string; uz: string }> = {};
    (products ?? []).forEach((p: { id: string; name: { ru: string; uz: string } }) => { productMap[p.id] = p.name; });
    return reviews.map((r) => ({ ...r, product_name: productMap[r.product_id] ?? { ru: 'Удалён', uz: 'O\'chirilgan' } }));
  },

  update: async (id: string, updates: Partial<Review>) => {
    if (USE_MOCK_DATA) { await delay(); return; }
    await adminQueries.updateReview(id, { ...updates, updated_at: new Date().toISOString() });
  },

  approve: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await adminQueries.approveReview(id);
  },

  reject: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await adminQueries.rejectReview(id);
  },

  reply: async (id: string, reply: string) => {
    if (USE_MOCK_DATA) return;
    await adminQueries.replyToReview(id, reply);
  },
};

export const promotionQueries = {
  getActive: async (type?: 'new_arrival' | 'sale' | 'featured') => {
    if (USE_MOCK_DATA) { await delay(); return []; }
    let query = supabase.from('promotions').select('*').eq('is_active', true).lte('starts_at', new Date().toISOString()).or(`ends_at.is.null,ends_at.gte.${new Date().toISOString()}`);
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  getProductsByPromotion: async (promotionId: string) => {
    if (USE_MOCK_DATA) { await delay(); return []; }
    const { data: promo } = await supabase.from('promotions').select('product_ids').eq('id', promotionId).maybeSingle();
    if (!promo?.product_ids?.length) return [];
    const { data, error } = await supabase.from('products').select('*').in('id', promo.product_ids).eq('is_active', true);
    if (error) throw error;
    return data;
  },
};

export const productCollectionQueries = {
  getActive: async (): Promise<ProductCollection[]> => {
    if (USE_MOCK_DATA) { await delay(); return []; }
    const { data, error } = await supabase.from('product_collections').select('*').eq('is_active', true).order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ProductCollection[];
  },

  getAll: async (): Promise<ProductCollection[]> => {
    if (USE_MOCK_DATA) { await delay(); return []; }
    const { data, error } = await supabase.from('product_collections').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ProductCollection[];
  },

  getCollectionProducts: async (productIds: string[]) => {
    if (USE_MOCK_DATA || !productIds.length) return [];
    const { data, error } = await supabase.from('products').select('*').in('id', productIds).eq('is_active', true);
    if (error) throw error;
    const map = new Map((data ?? []).map(p => [p.id, p]));
    return productIds.map(id => map.get(id)).filter(Boolean) as import('./products').Product[];
  },

  create: async (data: Database['public']['Tables']['product_collections']['Insert']) => {
    if (USE_MOCK_DATA) { await delay(); return { ...data, id: `col-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as ProductCollection; }
    return adminQueries.createCollection(data as Record<string, unknown>);
  },

  update: async (id: string, data: Database['public']['Tables']['product_collections']['Update']) => {
    if (USE_MOCK_DATA) { await delay(); return { id, ...data } as ProductCollection; }
    return adminQueries.updateCollection(id, data as Record<string, unknown>);
  },

  delete: async (id: string) => {
    if (USE_MOCK_DATA) { await delay(); return; }
    await adminQueries.deleteCollection(id);
  },
};

export const productRelationQueries = {
  getRelated: async (productId: string, type?: ProductRelation['relation_type']) => {
    if (USE_MOCK_DATA) return [];
    let query = supabase.from('product_relations').select('*, products!product_relations_related_product_id_fkey(*)').eq('product_id', productId).order('sort_order');
    if (type) query = query.eq('relation_type', type);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  getUpsells: (productId: string) => productRelationQueries.getRelated(productId, 'upsell'),
  getCrossSells: (productId: string) => productRelationQueries.getRelated(productId, 'cross_sell'),

  create: async (relation: Omit<ProductRelation, 'id' | 'created_at'>) => {
    if (USE_MOCK_DATA) return { ...relation, id: `pr-${Date.now()}`, created_at: new Date().toISOString() } as ProductRelation;
    return adminQueries.createProductRelation(relation as Record<string, unknown>);
  },

  delete: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await adminQueries.deleteProductRelation(id);
  },
};
