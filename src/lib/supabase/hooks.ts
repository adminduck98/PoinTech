import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  productQueries,
  categoryQueries,
  orderQueries,
  reviewQueries,
  promotionQueries,
  paymentQueries,
  bannerQueries,
  deliveryZoneQueries,
  inventoryQueries,
  userQueries,
  favoriteQueries,
  couponQueries,
  returnQueries,
  notificationQueries,
  auditLogQueries,
  productRelationQueries,
  productCollectionQueries,
  type ProductFilters,
  type ProductSort,
  type FavoritePrefs,
  type FavoritePrefsMap,
  PAGE_SIZE,
} from './queries';
import { supabase } from '../supabase';
import { clientApiCall } from '../clientApi';
import { adminQueries } from '../adminApi';
import type { Database } from '../supabase';

export { userQueries } from './queries';

// Products
export const useProducts = (filters?: ProductFilters, sort?: ProductSort) => {
  return useInfiniteQuery({
    queryKey: ['products', filters, sort],
    queryFn: ({ pageParam = 0 }) => productQueries.getAll(filters, sort, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    // The next offset comes from the page itself, counted in rows the server
    // returned. Deriving it from the number of *displayed* items — as this used
    // to — makes pages overlap as soon as any filter runs in the browser.
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
  });
};

export const useProduct = (slug: string) => {
  return useQuery({
    queryKey: ['product', slug],
    queryFn: () => productQueries.getBySlug(slug),
    enabled: !!slug,
  });
};

export const useActiveProductCount = () => {
  return useQuery({
    queryKey: ['products', 'active_count'],
    queryFn: () => productQueries.getActiveCount(),
    staleTime: 1000 * 60 * 15,
  });
};

export const useIncrementViews = () => {
  return useMutation({
    mutationFn: (productId: string) => productQueries.incrementViews(productId),
  });
};

export const useUploadProductImages = () => {
  return useMutation({
    mutationFn: (files: File[]) => productQueries.uploadImages(files),
  });
};

// Users
export const useUserProfile = (telegramId: number) => {
  return useQuery({
    queryKey: ['user_profile', telegramId],
    queryFn: () => userQueries.getByTelegramId(telegramId),
    enabled: telegramId > 0,
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ telegramId, updates }: { telegramId: number; updates: { phone?: string; address?: string; first_name?: string; latitude?: number | null; longitude?: number | null } }) =>
      userQueries.updateProfile(telegramId, updates),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user_profile', variables.telegramId] });
    },
  });
};

// Categories
export const useCategories = () => {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryQueries.getAll(),
    staleTime: 1000 * 60 * 15,
  });
};

export const useCategoriesWithCount = () => {
  return useQuery({
    queryKey: ['categories', 'with_count'],
    queryFn: () => categoryQueries.getAllWithProductCount(),
    staleTime: 1000 * 60 * 15,
  });
};

export const useCreateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: categoryQueries.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};

export const useUpdateCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Database['public']['Tables']['categories']['Update'] }) =>
      categoryQueries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};

export const useDeleteCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: categoryQueries.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
};

// Orders
// useCreateOrder was removed along with orderQueries.create — it called
// insert_order() directly with the anon key, bypassing the checkout Edge
// Function's stock/price/coupon validation. Checkout.tsx posts to
// /functions/v1/checkout instead.

export const useOrders = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['orders', telegramUserId],
    queryFn: () => orderQueries.getByTelegramUserId(telegramUserId),
    enabled: telegramUserId > 0,
  });
};


// useUpdateOrderStatus was removed together with orderQueries.updateStatus:
// it called append_order_status directly with the anon key. Admin screens use
// adminQueries.updateOrderStatus (admin-api Edge Function) instead.

// Inventory
export const useInventoryProducts = () => {
  return useQuery({
    queryKey: ['inventory_products'],
    queryFn: () => inventoryQueries.getAllWithStock(),
  });
};

export const useUpdateStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, newStock }: { productId: string; newStock: number }) =>
      inventoryQueries.updateStock(productId, newStock),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory_products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

export const useAdjustStock = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, delta }: { productId: string; delta: number }) =>
      inventoryQueries.adjustStock(productId, delta),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory_products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

// Reviews
export const useProductReviews = (productId: string) => {
  return useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => reviewQueries.getByProductId(productId),
    enabled: !!productId,
  });
};

export const useCreateReview = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reviewData: Database['public']['Tables']['reviews']['Insert']) =>
      reviewQueries.create(reviewData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', data.product_id] });
      queryClient.invalidateQueries({ queryKey: ['rating', data.product_id] });
    },
  });
};

export const useProductRating = (productId: string) => {
  return useQuery({
    queryKey: ['rating', productId],
    queryFn: () => reviewQueries.getAverageRating(productId),
    enabled: !!productId,
  });
};

export const useAllReviews = () => {
  return useQuery({
    queryKey: ['reviews', 'all'],
    queryFn: () => reviewQueries.getAllWithProductNames(),
  });
};

export const useApproveReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reviewQueries.approve,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });
};

export const useRejectReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reviewQueries.reject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });
};

export const useReplyToReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) => reviewQueries.reply(id, reply),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });
};

export const useUploadReviewPhoto = () => {
  return useMutation({
    mutationFn: (file: File) => reviewQueries.uploadReviewPhoto(file),
  });
};

// Promotions
export const usePromotions = (type?: 'new_arrival' | 'sale' | 'featured') => {
  return useQuery({
    queryKey: ['promotions', type],
    queryFn: () => promotionQueries.getActive(type),
  });
};

export const usePromotionProducts = (promotionId: string) => {
  return useQuery({
    queryKey: ['promotion-products', promotionId],
    queryFn: () => promotionQueries.getProductsByPromotion(promotionId),
    enabled: !!promotionId,
  });
};

// Referrals




// Delivery Zones
export const useDeliveryZones = (activeOnly = true) => {
  return useQuery({
    queryKey: ['delivery_zones', activeOnly],
    queryFn: () => activeOnly ? deliveryZoneQueries.getActive() : deliveryZoneQueries.getAll(),
    staleTime: 1000 * 60 * 30, // 30 minutes - delivery zones rarely change
  });
};

export const useCreateDeliveryZone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deliveryZoneQueries.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery_zones'] });
    },
  });
};

export const useUpdateDeliveryZone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Database['public']['Tables']['delivery_zones']['Update']> }) => deliveryZoneQueries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery_zones'] });
    },
  });
};

export const useDeleteDeliveryZone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deliveryZoneQueries.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery_zones'] });
    },
  });
};

// Banners
export const useBanners = (activeOnly = true) => {
  return useQuery({
    queryKey: ['banners', activeOnly],
    queryFn: () => activeOnly ? bannerQueries.getActive() : bannerQueries.getAll(),
    staleTime: 1000 * 60 * 15, // 15 minutes - banners rarely change
  });
};

export const useCreateBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bannerQueries.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

export const useUpdateBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Database['public']['Tables']['banners']['Update']> }) => bannerQueries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

export const useDeleteBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bannerQueries.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['banners'] });
    },
  });
};

// Payments
export const useCreatePayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, amount, paymentMethod }: {
      orderId: string;
      amount: number;
      paymentMethod: 'payme' | 'click' | 'uzum';
    }) => paymentQueries.createPayment(orderId, amount, paymentMethod),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

// Favorites
export const useFavorites = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['favorites', telegramUserId],
    queryFn: () => favoriteQueries.getByUser(telegramUserId),
    enabled: telegramUserId > 0,
  });
};

export const useFavoriteIds = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['favorite_ids', telegramUserId],
    queryFn: () => favoriteQueries.getProductIds(telegramUserId),
    enabled: telegramUserId > 0,
    staleTime: 1000 * 60,
  });
};

/**
 * Run a Supabase query without letting its outcome affect the caller.
 *
 * Supabase's query builder is a *thenable*, not a Promise: it implements
 * `then()` only. Calling `.catch()` on it therefore throws
 * "TypeError: ....catch is not a function" at the call site — the exact
 * opposite of the intended "ignore failures". `Promise.resolve()` adopts the
 * thenable and gives us real Promise semantics.
 */
function fireAndForget(
  query: PromiseLike<{ error: unknown }>,
  label: string,
): void {
  Promise.resolve(query).then(
    ({ error }) => { if (error) console.warn(`[${label}]`, error); },
    (err) => console.warn(`[${label}]`, err),
  );
}

export const useToggleFavorite = (telegramUserId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, isFavorite }: { productId: string; isFavorite: boolean }) => {
      if (isFavorite) {
        await favoriteQueries.remove(telegramUserId, productId);
        fireAndForget(
          supabase.rpc('track_product_event', { p_product_id: productId, p_event_type: 'favorites', p_delta: -1 }),
          'track_product_event',
        );
      } else {
        await favoriteQueries.add(telegramUserId, productId);
        fireAndForget(
          supabase.rpc('track_product_event', { p_product_id: productId, p_event_type: 'favorites', p_delta: 1 }),
          'track_product_event',
        );
      }
    },
    onMutate: async ({ productId, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ['favorite_ids', telegramUserId] });
      const prev = queryClient.getQueryData<string[]>(['favorite_ids', telegramUserId]) ?? [];
      queryClient.setQueryData<string[]>(
        ['favorite_ids', telegramUserId],
        isFavorite ? prev.filter((id) => id !== productId) : [...prev, productId]
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['favorite_ids', telegramUserId], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites', telegramUserId] });
      queryClient.invalidateQueries({ queryKey: ['favorite_ids', telegramUserId] });
      // Un/favouriting adds or drops the product's row in the prefs map, which
      // decides whether the bell renders and in which state.
      queryClient.invalidateQueries({ queryKey: ['favorite_prefs', telegramUserId] });
    },
  });
};

// Wishlist preferences
const DEFAULT_PREFS: FavoritePrefs = { notify_price: false, notify_stock: false };

export const useUpdateFavoritePrefs = (telegramUserId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, prefs }: { productId: string; prefs: Partial<FavoritePrefs> }) =>
      favoriteQueries.updatePrefs(telegramUserId, productId, prefs),
    onMutate: async ({ productId, prefs }) => {
      await queryClient.cancelQueries({ queryKey: ['favorite_prefs', telegramUserId] });
      const prev = queryClient.getQueryData<FavoritePrefsMap>(['favorite_prefs', telegramUserId]);
      queryClient.setQueryData<FavoritePrefsMap>(['favorite_prefs', telegramUserId], (old) => ({
        ...(old ?? {}),
        [productId]: { ...DEFAULT_PREFS, ...(old?.[productId] ?? {}), ...prefs },
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['favorite_prefs', telegramUserId], ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorite_prefs', telegramUserId] });
      queryClient.invalidateQueries({ queryKey: ['favorites', telegramUserId] });
    },
  });
};

/**
 * Notification preferences for one product.
 *
 * The query key deliberately carries only the user: every WishlistToggle on the
 * page shares one cache entry and therefore one request, and each component
 * narrows it to its own product through `select`. Keying by product instead —
 * as this did — turned one wishlist read into one read per visible card.
 */
export const useFavoritePrefs = (telegramUserId: number, productId: string) => {
  const select = useCallback(
    (map: FavoritePrefsMap) => (productId ? map[productId] ?? null : null),
    [productId]
  );

  return useQuery({
    queryKey: ['favorite_prefs', telegramUserId],
    queryFn: () => favoriteQueries.getPrefsMap(telegramUserId),
    enabled: telegramUserId > 0,
    staleTime: 1000 * 60,
    select,
  });
};

export const useWishlistStats = () => {
  return useQuery({
    queryKey: ['wishlist_stats'],
    queryFn: () => favoriteQueries.getAllStats(),
    staleTime: 1000 * 60 * 5,
  });
};

export const useProductWishlistStats = (productId: string) => {
  return useQuery({
    queryKey: ['wishlist_stats', productId],
    queryFn: () => favoriteQueries.getStatsForProduct(productId),
    enabled: !!productId,
  });
};

// Coupons
export const useValidateCoupon = () => {
  return useMutation({
    mutationFn: ({ code, telegramUserId, orderAmount }: { code: string; telegramUserId: number; orderAmount: number }) =>
      couponQueries.validate(code, telegramUserId, orderAmount),
  });
};

export const useCoupons = () => {
  return useQuery({
    queryKey: ['coupons'],
    queryFn: () => couponQueries.getAll(),
  });
};

export const useCreateCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: couponQueries.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });
};

export const useUpdateCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => couponQueries.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });
};

export const useDeleteCoupon = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: couponQueries.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });
};

// Returns
export const useUploadReturnPhoto = () => {
  return useMutation({
    mutationFn: (file: File) => returnQueries.uploadPhoto(file),
  });
};

export const useCreateReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: returnQueries.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['returns'] }),
  });
};

export const useUserReturns = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['returns', telegramUserId],
    queryFn: () => returnQueries.getByUser(telegramUserId),
    enabled: telegramUserId > 0,
  });
};

export const useAllReturns = () => {
  return useQuery({
    queryKey: ['returns'],
    queryFn: () => returnQueries.getAll(),
  });
};

export const useUpdateReturnStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, adminNote }: { id: string; status: 'pending' | 'approved' | 'rejected' | 'refunded'; adminNote?: string }) =>
      returnQueries.updateStatus(id, status, adminNote),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['returns'] }),
  });
};

// Notifications
export const useNotifications = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['notifications', telegramUserId],
    queryFn: () => notificationQueries.getByUser(telegramUserId),
    enabled: telegramUserId > 0,
    refetchInterval: 60000,
    staleTime: 1000 * 60 * 2,
  });
};

export const useUnreadNotificationCount = (telegramUserId: number) => {
  return useQuery({
    queryKey: ['notification_count', telegramUserId],
    queryFn: () => notificationQueries.getUnreadCount(telegramUserId),
    enabled: telegramUserId > 0,
    refetchInterval: 60000,
    staleTime: 1000 * 60 * 2,
  });
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationQueries.markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notification_count'] });
    },
  });
};

export const useMarkAllNotificationsRead = (telegramUserId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationQueries.markAllAsRead(telegramUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notification_count'] });
    },
  });
};

export const useClearReadNotifications = (telegramUserId: number) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationQueries.clearAllRead(telegramUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notification_count'] });
    },
  });
};

// Audit Log
export const useAuditLog = (limit?: number) => {
  return useQuery({
    queryKey: ['audit_log'],
    queryFn: () => auditLogQueries.getAll(limit),
  });
};

// Product Relations
export const useProductRelations = (productId: string, type?: 'upsell' | 'cross_sell' | 'bundle') => {
  return useQuery({
    queryKey: ['product_relations', productId, type],
    queryFn: () => productRelationQueries.getRelated(productId, type),
    enabled: !!productId,
  });
};

export const useCreateProductRelation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: productRelationQueries.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product_relations'] }),
  });
};

// Product Collections
export const useCollections = (activeOnly = true) => {
  return useQuery({
    queryKey: ['collections', activeOnly],
    queryFn: () => activeOnly ? productCollectionQueries.getActive() : productCollectionQueries.getAll(),
    staleTime: 1000 * 60 * 10,
  });
};

export const useCollectionProducts = (productIds: string[]) => {
  return useQuery({
    queryKey: ['collection_products', productIds],
    queryFn: () => productCollectionQueries.getCollectionProducts(productIds),
    enabled: productIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: productCollectionQueries.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });
};

export const useUpdateCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Database['public']['Tables']['product_collections']['Update'] }) =>
      productCollectionQueries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });
};

export const useDeleteCollection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: productCollectionQueries.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });
};

// ─── Chat / Messages ─────────────────────────────────────────────────────

export interface OrderMessage {
  id: string;
  order_id: string;
  sender_type: string;
  sender_id: string;
  receiver_id: string | null;
  content: string;
  is_read: boolean;
  created_at: string;
}

// Customer side — every call goes through client-api, which verifies Telegram
// initData and refuses orders that do not belong to the caller.

/**
 * Polling interval for the customer's order chat.
 *
 * client-api rate-limits at 30 requests/minute per IP. At the previous 1500 ms
 * an open chat alone issued 40 requests a minute, so a customer who left the
 * thread open for a minute got 429 — and the 429 is per IP, so it took the rest
 * of the app (catalogue, notifications, checkout) down with it. 6 s keeps one
 * open chat at 10 req/min, which leaves room for everything else on the screen.
 *
 * Only polls while the tab is actually in front: refetchIntervalInBackground
 * defaults to false, so a backgrounded Mini App stops spending requests.
 */
const CHAT_POLL_MS = 6000;

export const useOrderMessages = (orderId: string | null) => {
  return useQuery({
    queryKey: ['messages', orderId],
    queryFn: () => clientApiCall<OrderMessage[]>('get_order_messages', { p_order_id: orderId }),
    enabled: !!orderId,
    refetchInterval: CHAT_POLL_MS,
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    // sender_type/sender_id are decided server-side from the verified identity,
    // so the caller only supplies the order and the text.
    mutationFn: (params: { order_id: string; content: string }) =>
      clientApiCall('send_message', {
        p_order_id: params.order_id,
        p_content: params.content,
      }),
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: ['messages', params.order_id] });
      const prev = (queryClient.getQueryData(['messages', params.order_id]) ?? []) as unknown[];
      const optimisticMessage = {
        id: `temp-${Date.now()}`,
        order_id: params.order_id,
        sender_type: 'customer',
        receiver_id: 'admin',
        content: params.content,
        created_at: new Date().toISOString(),
        is_read: false,
      };
      queryClient.setQueryData(['messages', params.order_id], [...prev, optimisticMessage]);
      return { prev };
    },
    onError: (_err, params, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['messages', params.order_id], ctx.prev);
      }
    },
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: ['messages', params.order_id] });
    },
  });
};

export const useMarkMessagesRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { order_id: string }) =>
      clientApiCall('mark_messages_read', { p_order_id: params.order_id }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.order_id] });
    },
  });
};

// useUnreadMessageCount was removed: exported, polling on an interval, and
// called from nowhere. The client-api `get_unread_message_count` action it
// wrapped is still there for whoever adds an unread badge — this hook was the
// dead half of that pair.

// Admin side — goes through admin-api, which requires a valid admin session.

export const useAdminConversations = () => {
  return useQuery({
    queryKey: ['admin-conversations'],
    queryFn: () => adminQueries.getConversations(),
    refetchInterval: 3000,
  });
};

export const useAdminOrderMessages = (orderId: string | null) => {
  return useQuery({
    queryKey: ['admin-messages', orderId],
    queryFn: () => adminQueries.getOrderMessages(orderId as string),
    enabled: !!orderId,
    refetchInterval: 1500,
  });
};

export const useAdminSendMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { order_id: string; content: string }) =>
      adminQueries.sendOrderMessage(params.order_id, params.content),
    onSettled: (_data, _err, params) => {
      queryClient.invalidateQueries({ queryKey: ['admin-messages', params.order_id] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });
};

export const useAdminMarkMessagesRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { order_id: string }) =>
      adminQueries.markOrderMessagesRead(params.order_id),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-messages', variables.order_id] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });
};

// ─── Product Analytics ──────────────────────────────────────────────────

export const useTrackProductEvent = () => {
  return useMutation({
    mutationFn: async (params: { product_id: string; event_type: string; delta?: number }) => {
      const { error } = await supabase.rpc('track_product_event', {
        p_product_id: params.product_id,
        p_event_type: params.event_type,
        p_delta: params.delta ?? 1,
      });
      if (error) throw error;
    },
  });
};

// Admin-only aggregate — served by admin-api under an admin session.
export const useAllProductAnalytics = () => {
  return useQuery({
    queryKey: ['product_analytics'],
    queryFn: () => adminQueries.getProductAnalytics(),
  });
};
