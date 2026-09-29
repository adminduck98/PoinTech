import { useEffect, useRef, useState } from 'react';
import { Package, Radio, RotateCcw, X, ShoppingBag, Search, Camera, MessageSquare } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Portal } from '../components/Portal';
import { ChatModal } from '../components/ChatModal';
import { QueryError } from '../components/QueryError';
import { isQueryOffline } from '../lib/queryState';
import { useTranslation } from '../hooks/useTranslation';
import { useCartStore } from '../store/useCartStore';
import { useOrders } from '../lib/supabase/hooks';
import { supabase } from '../lib/supabase';
import { formatPrice, getLocalizedValue, formatDateTime } from '../lib/utils';
import { haptic } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { getStatusColor, getStatusLabel } from '../lib/orderStatuses';
import { returnQueries } from '../lib/supabase/queries';
import { useUploadReturnPhoto } from '../lib/supabase/hooks';
import { useTrackProductEvent } from '../lib/supabase/hooks';
import { toast } from '../components/Toast';
import type { OrderItem } from '../lib/supabase';
import type { Order } from '../lib/supabase/queries';
import { ProductImage } from '../components/ProductImage';
import type { UploadedPhoto } from '../lib/fileUpload';

export const Orders = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const userId = useUserId();

  const { data: orders = [], isLoading, isError, error, refetch, fetchStatus } = useOrders(userId);
  const offline = isQueryOffline(fetchStatus);
  const [searchQuery, setSearchQuery] = useState('');

  const activeOrders = orders;

  const [chatOrderId, setChatOrderId] = useState<string | null>(null);
  const [returnModal, setReturnModal] = useState<{ order: Order; selectedItems: number[] } | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);
  // Путь для базы + временная ссылка для предпросмотра: фото возвратов лежат
  // в закрытом бакете (см. lib/fileUpload.ts).
  const [returnPhotos, setReturnPhotos] = useState<UploadedPhoto[]>([]);
  const [returnPhotoUploading, setReturnPhotoUploading] = useState(false);
  const returnPhotoInputRef = useRef<HTMLInputElement>(null);
  const uploadReturnPhoto = useUploadReturnPhoto();
  const trackEvent = useTrackProductEvent();

  const filteredOrders = searchQuery.trim()
    ? activeOrders.filter((order: Order) => {
        const q = searchQuery.toLowerCase();
        const idMatch = order.id.toLowerCase().includes(q);
        const itemMatch = Array.isArray(order.items)
          ? order.items.some((item: OrderItem) => {
              const name = typeof item.name === 'object' ? (item.name as { ru: string; uz: string }).ru : item.name;
              return name?.toLowerCase().includes(q);
            })
          : false;
        return idMatch || itemMatch;
      })
    : activeOrders;

  useEffect(() => {
    const orderIdParam = searchParams.get('orderId');
    const chatParam = searchParams.get('chat');
    if (orderIdParam && orders.length > 0) {
      const found = orders.find((o: Order) => o.id === orderIdParam);
      if (found) {
        if (chatParam === '1') {
          setChatOrderId(orderIdParam);
        }
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, orders]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user-orders-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `telegram_user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['orders', userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, { ru: string; uz: string }> = {
      cash: { ru: 'Наличные', uz: 'Naqd pul' },
      payme: { ru: 'Payme', uz: 'Payme' },
      click: { ru: 'Click', uz: 'Click' },
      uzum: { ru: 'Uzum Bank', uz: 'Uzum Bank' },
    };
    return labels[method]?.[language] || method;
  };

  const canRequestReturn = (order: Order) => {
    if (order.status !== 'delivered') return false;
    const history = Array.isArray(order.status_history) ? order.status_history : [];
    const deliveredEntry = history.find((h) => h.status === 'delivered');
    const deliveredDate = deliveredEntry
      ? new Date(deliveredEntry.changed_at)
      : new Date(order.created_at);
    const now = new Date();
    const daysDiff = (now.getTime() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff <= 14;
  };

  const handleReturnPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setReturnPhotoUploading(true);
    try {
      const toUpload = Array.from(files).slice(0, 5 - returnPhotos.length);
      const urls = await Promise.all(toUpload.map(f => uploadReturnPhoto.mutateAsync(f)));
      setReturnPhotos(prev => [...prev, ...urls].slice(0, 5));
    } catch {
      toast.error(language === 'ru' ? 'Ошибка загрузки фото' : 'Fotosni yuklashda xatolik');
    } finally {
      setReturnPhotoUploading(false);
      if (returnPhotoInputRef.current) returnPhotoInputRef.current.value = '';
    }
  };

  const handleReturnSubmit = async () => {
    if (!returnModal || !userId) return;
    if (!returnReason.trim()) {
      toast.error(language === 'ru' ? 'Укажите причину возврата' : "Qaytarish sababini kiriting");
      return;
    }
    if (returnModal.selectedItems.length === 0) {
      toast.error(language === 'ru' ? 'Выберите товары для возврата' : "Qaytarish uchun mahsulotlarni tanlang");
      return;
    }

    setReturnLoading(true);
    try {
      const order = returnModal.order;
      const items = (Array.isArray(order.items) ? order.items : []) as OrderItem[];
      const selected = returnModal.selectedItems.map(i => items[i]);

      await returnQueries.create({
        order_id: order.id,
        telegram_user_id: userId,
        items: selected.map(item => ({
          productId: item.productId,
          name: typeof item.name === 'object' ? (item.name as { ru: string; uz: string }).ru : item.name || '',
          quantity: item.quantity,
          price: item.price,
        })),
        reason: returnReason.trim(),
        photos: returnPhotos.map((p) => p.path),
      });

      // Track return analytics for each returned product
      for (const item of selected) {
        trackEvent.mutate({ product_id: item.productId, event_type: 'returns', delta: item.quantity });
      }

      toast.success(language === 'ru' ? 'Заявка на возврат отправлена' : "Qaytarish so'rovi yuborildi");
      setReturnModal(null);
      setReturnReason('');
      setReturnPhotos([]);
    } catch {
      toast.error(language === 'ru' ? 'Ошибка отправки заявки' : "So'rovni yuborishda xatolik");
    } finally {
      setReturnLoading(false);
    }
  };

  const toggleReturnItem = (index: number) => {
    if (!returnModal) return;
    const selected = returnModal.selectedItems.includes(index)
      ? returnModal.selectedItems.filter(i => i !== index)
      : [...returnModal.selectedItems, index];
    setReturnModal({ ...returnModal, selectedItems: selected });
  };

  if (isLoading && !offline) {
    return (
      <Layout>
        <div className="px-4 py-4">
          <h1 className="font-display text-xl font-semibold text-text mb-4">
            {t('order_history')}
          </h1>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-surface rounded-2xl overflow-hidden shadow-card">
                <div className="p-4 space-y-3">
                  <div className="flex justify-between">
                    <div className="h-4 w-24 bg-surface-muted rounded-lg animate-pulse" />
                    <div className="h-5 w-16 bg-surface-muted rounded-full animate-pulse" />
                  </div>
                  <div className="flex gap-3">
                    <div className="w-12 h-12 bg-surface-muted rounded-xl animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-3/4 bg-surface-muted rounded-lg animate-pulse" />
                      <div className="h-3 w-1/2 bg-surface-muted rounded-lg animate-pulse" />
                    </div>
                  </div>
                  <div className="border-t border-border-subtle pt-3">
                    <div className="h-3 w-1/3 bg-surface-muted rounded-lg animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (isError || offline) {
    return (
      <Layout>
        <div className="px-4 py-4">
          <h1 className="font-display text-xl font-semibold text-text mb-4">{t('order_history')}</h1>
          <QueryError error={error} offline={offline} onRetry={() => void refetch()} />
        </div>
      </Layout>
    );
  }

  if (activeOrders.length === 0) {
    return (
      <Layout>
        <div className="px-4 py-12 text-center">
          <Package className="w-16 h-16 sm:w-24 sm:h-24 text-text-tertiary mx-auto mb-4" />
          <h2 className="text-lg sm:text-2xl font-bold text-text mb-2">
            {t('no_orders')}
          </h2>
          <p className="text-text-secondary mb-6">
            {t('continue_shopping')}
          </p>
          <button
            onClick={() => navigate('/catalog')}
            className="btn-brand px-6 py-3 rounded-xl font-semibold"
          >
            {t('catalog')}
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl font-semibold text-text">
            {t('order_history')}
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Radio className="w-3 h-3 text-success animate-pulse-soft" />
            <span>{language === 'ru' ? 'Онлайн' : 'Onlayn'}</span>
          </div>
        </div>

        {activeOrders.length > 3 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={language === 'ru' ? 'Поиск по номеру или товару...' : "Raqam yoki mahsulot bo'yicha qidirish..."}
              className="input-premium w-full pl-9 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 text-xs sm:text-sm"
            />
          </div>
      )}

        <div className="space-y-3 pb-4">
          {filteredOrders.map((order: Order) => (
            <div
              key={order.id}
              className="bg-surface rounded-2xl overflow-hidden shadow-card"
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs font-mono font-semibold text-text">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {formatDateTime(order.created_at, language)}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}
                  >
                    {getStatusLabel(order.status, language)}
                  </span>
                </div>

                <div className="space-y-2 mb-3">
                  {(Array.isArray(order.items) ? (order.items as OrderItem[]) : [])
                    .slice(0, 2)
                    .map((item: OrderItem, index: number) => (
                      <div key={index} className="flex items-center gap-3">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-surface-muted rounded-xl overflow-hidden flex-shrink-0">
                          {item.image ? (
                            <ProductImage
                              src={item.image}
                              alt={getLocalizedValue(item.name, language)}
                              className="w-full h-full object-cover"
                              showSkeleton={false}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-text-tertiary text-xs">
                              {t('no_image')}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text truncate">
                            {getLocalizedValue(item.name, language)}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {item.quantity} × {formatPrice(item.price)}
                            {item.size && ` · ${t('size')}: ${item.size}`}
                          </p>
                        </div>
                      </div>
                    ))}
                  {(Array.isArray(order.items) ? (order.items as OrderItem[]) : []).length > 2 && (
                    <p className="text-xs text-text-tertiary">
                      {t('and_more')} {(order.items as OrderItem[]).length - 2} {t('items_count')}
                    </p>
                  )}
                </div>

                <div className="border-t border-border-subtle pt-3 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-secondary">
                      {t('payment_method')}
                    </span>
                    <span className="font-medium text-text">
                      {getPaymentMethodLabel(order.payment_method)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-secondary">
                      {t('delivery')}
                    </span>
                    <span className="font-medium text-text">
                      {order.delivery_type === 'express'
                        ? language === 'ru'
                          ? 'Экспресс'
                          : 'Ekspress'
                        : language === 'ru'
                        ? 'Стандарт'
                        : 'Standart'}{' '}
                      ({formatPrice(order.delivery_cost as number)})
                    </span>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-border-subtle">
                    <span className="font-semibold text-text text-sm">
                      {t('total')}
                    </span>
                    <span className="text-base sm:text-lg font-extrabold text-text">
                      {formatPrice(order.total_amount as number)}
                    </span>
                  </div>
                </div>

                {canRequestReturn(order) && (
                  <button
                    onClick={() => setReturnModal({ order, selectedItems: [] })}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium text-text hover:bg-surface-muted transition"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {language === 'ru' ? 'Запросить возврат' : "Qaytarish so'rovi"}
                  </button>
                )}

                {order.status === 'delivered' && (
                  <button
                    onClick={async () => {
                      const items = (Array.isArray(order.items) ? order.items : []) as OrderItem[];
                      const cartAdd = useCartStore.getState().addItem;
                      let addedCount = 0;
                      for (const item of items) {
                        const { data: product } = await supabase
                          .from('products').select('stock, is_active').eq('id', item.productId).maybeSingle();
                        if (product && product.is_active && product.stock > 0) {
                          const qty = Math.min(item.quantity, product.stock);
                          cartAdd({
                            productId: item.productId,
                            name: typeof item.name === 'object' ? item.name : { ru: String(item.name), uz: String(item.name) },
                            price: item.price,
                            quantity: qty,
                            image: item.image || '',
                            size: item.size,
                            color: item.color ? { name: item.color, hex: '' } : undefined,
                          });
                          trackEvent.mutate({ product_id: item.productId, event_type: 'cart_adds', delta: qty });
                          addedCount++;
                        }
                      }
                      if (addedCount > 0) {
                        haptic.addToCart();
                        toast.success(language === 'ru' ? `${addedCount} товар(ов) добавлено в корзину` : `${addedCount} mahsulot savatga qo'shildi`);
                        navigate('/cart');
                      } else {
                        haptic.error();
                        toast.error(language === 'ru' ? 'Товары больше не доступны' : 'Mahsulotlar mavjud emas');
                      }
                    }}
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl btn-brand text-sm font-semibold"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {language === 'ru' ? 'Заказать снова' : 'Qaytadan buyurtma berish'}
                  </button>
                )}

                {/* Chat button */}
                <button
                  onClick={() => setChatOrderId(order.id)}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition"
                >
                  <MessageSquare className="w-4 h-4" />
                  {language === 'ru' ? 'Написать в поддержку' : "Qo'llab-quvvatlashga xabar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {chatOrderId && (
        <ChatModal
          orderId={chatOrderId}
          isOpen={!!chatOrderId}
          onClose={() => setChatOrderId(null)}
        />
      )}

      {returnModal && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)] backdrop-blur-md pointer-events-auto">
          <div className="bg-surface rounded-2xl w-full flex flex-col mx-4"
            style={{
              maxWidth: '28rem',
              padding: '16px 24px',
              maxHeight: '80dvh',
              overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-text">
                {language === 'ru' ? 'Возврат товара' : "Mahsulotni qaytarish"}
              </h2>
              <button onClick={() => { setReturnModal(null); setReturnPhotos([]); setReturnReason(''); }} className="p-2 rounded-lg hover:bg-surface-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 mb-5">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                {language === 'ru' ? 'Выберите товары' : "Mahsulotlarni tanlang"}
              </p>
              {(returnModal.order.items as OrderItem[]).map((item, index) => (
                <label
                  key={index}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                    returnModal.selectedItems.includes(index)
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={returnModal.selectedItems.includes(index)}
                    onChange={() => toggleReturnItem(index)}
                    className="w-4 h-4 rounded text-text"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {getLocalizedValue(item.name, language)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {item.quantity} × {formatPrice(item.price)}
                      {item.size && ` · ${item.size}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-text">
                    {formatPrice(item.price * item.quantity)}
                  </span>
                </label>
              ))}
            </div>

            <div className="mb-5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 block">
                {language === 'ru' ? 'Причина возврата' : "Qaytarish sababi"}
              </label>
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={3}
                className="input-premium w-full px-4 py-3 text-sm resize-none"
                placeholder={language === 'ru' ? 'Опишите причину...' : 'Sababni yozing...'}
              />
            </div>

            <div className="mb-5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 block">
                {language === 'ru' ? 'Фото дефекта (необязательно)' : "Nuqson fotosi (ixtiyoriy)"}
              </label>
              {returnPhotos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {returnPhotos.map((photo, i) => (
                    <div key={i} className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-border">
                      <img src={photo.url} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setReturnPhotos(prev => prev.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                      >
                        <X className="w-3 h-3 text-text-inverse" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {returnPhotos.length < 5 && (
                <button
                  type="button"
                  onClick={() => returnPhotoInputRef.current?.click()}
                  disabled={returnPhotoUploading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border dark:border-border text-sm text-text-secondary hover:bg-surface-muted transition disabled:opacity-50"
                >
                  {returnPhotoUploading
                    ? <span className="w-4 h-4 border-2 border-border border-t-surface-800 rounded-full animate-spin" />
                    : <Camera className="w-4 h-4" />
                  }
                  {returnPhotoUploading
                    ? (language === 'ru' ? 'Загрузка...' : 'Yuklanmoqda...')
                    : (language === 'ru' ? 'Добавить фото' : "Foto qo'shish")
                  }
                </button>
              )}
              <input
                ref={returnPhotoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleReturnPhotoUpload}
              />
            </div>

            {returnModal.selectedItems.length > 0 && (
              <div className="bg-bg dark:bg-surface-muted rounded-xl p-3 mb-5">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">{language === 'ru' ? 'Сумма возврата' : "Qaytarish miqdori"}:</span>
                  <span className="font-bold text-text">
                    {formatPrice(
                      returnModal.selectedItems.reduce((sum, i) => {
                        const items = returnModal.order.items as OrderItem[];
                        return sum + (items[i].price || 0) * (items[i].quantity || 1);
                      }, 0)
                    )}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleReturnSubmit}
              disabled={returnLoading || returnModal.selectedItems.length === 0 || !returnReason.trim()}
              className="btn-brand w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {returnLoading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {language === 'ru' ? 'Отправить заявку' : "So'rovni yuborish"}
            </button>
          </div>
        </div>
      </Portal>
    )}
    </Layout>
  );
};
