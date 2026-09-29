import { useState, useEffect, useCallback, useMemo } from 'react';
import { Trash2, Minus, Plus, ShoppingBag, Lock, ArrowLeft, AlertTriangle, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useTranslation } from '../hooks/useTranslation';
import { useCartStore, cartItemKey } from '../store/useCartStore';
import { supabase } from '../lib/supabase';
import { formatPrice, getLocalizedValue } from '../lib/utils';
import { haptic } from '../lib/telegram';
import { toast } from '../components/Toast';
import { ProductImage } from '../components/ProductImage';
import { useFixedBarSpacing, FIXED_BAR_SPACING } from '../hooks/useFixedBarSpacing';

interface ProductStock {
  id: string;
  stock: number;
  is_active: boolean;
  name: { ru: string; uz: string };
  price: number;
}

export const Cart = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const getTotalItems = useCartStore((state) => state.getTotalItems);
  const getTotalPrice = useCartStore((state) => state.getTotalPrice);
  const syncPrices = useCartStore((state) => state.syncPrices);
  const bottomBarRef = useFixedBarSpacing<HTMLDivElement>();

  const [stockData, setStockData] = useState<Record<string, ProductStock>>({});
  const [loading, setLoading] = useState(true);
  const [stockErrors, setStockErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<{ productId: string; size?: string; colorHex?: string } | null>(null);

  // Which products are in the cart, as a value that only changes when the set
  // of products does. The fetch below keys off this rather than off `items`
  // directly: `items` gets a new identity whenever a quantity changes — and
  // again when syncPrices writes a fresh price — so depending on it would
  // refetch on every +/- tap and turn the price sync into a fetch/sync loop.
  const productIdsKey = useMemo(
    () => [...new Set(items.map((item) => item.productId))].sort().join(','),
    [items],
  );

  // Load stock and current prices for everything in the cart
  useEffect(() => {
    const loadStock = async () => {
      const productIds = productIdsKey ? productIdsKey.split(',') : [];

      if (productIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('products')
        .select('id, stock, is_active, name, price')
        .in('id', productIds);

      if (!error && data) {
        const map: Record<string, ProductStock> = {};
        const prices: Record<string, number> = {};
        data.forEach((p) => {
          const product = p as ProductStock;
          map[product.id] = product;
          prices[product.id] = Number(product.price);
        });
        setStockData(map);
        // The database is the authority on price, so the cart adopts what it
        // just read. Any row still carrying a stale — or repaired-to-zero —
        // snapshot corrects itself here, and the total the customer sees now
        // matches the one checkout will calculate.
        syncPrices(prices);
      }
      setLoading(false);
    };

    loadStock();
  }, [productIdsKey, syncPrices]);

  // Validate stock when items or stock data changes
  useEffect(() => {
    const errors: Record<string, string> = {};
    items.forEach((item) => {
      const product = stockData[item.productId];
      if (product) {
        if (!product.is_active) {
          errors[item.productId] = language === 'ru' ? 'Товар недоступен' : "Mahsulot mavjud emas";
        } else if (product.stock < item.quantity) {
          if (product.stock <= 0) {
            errors[item.productId] = language === 'ru' ? 'Нет в наличии' : "Mavjud emas";
          } else {
            errors[item.productId] = language === 'ru'
              ? `Доступно: ${product.stock} шт.`
              : `Mavjud: ${product.stock} ta`;
          }
        }
      }
    });
    setStockErrors(errors);
  }, [items, stockData, language]);

  const handleUpdateQty = useCallback((productId: string, _currentQty: number, newQty: number, size?: string, color?: { name: string; hex: string }) => {
    if (newQty < 1) {
      setConfirmRemove({ productId, size, colorHex: color?.hex });
      return;
    }

    const product = stockData[productId];
    if (product && newQty > product.stock) {
      haptic.error();
      toast.error(language === 'ru' ? `Максимум: ${product.stock} шт.` : `Maksimal: ${product.stock} ta`);
      return;
    }

    updateQuantity(productId, newQty, size, color?.hex);
    haptic.select();
  }, [stockData, updateQuantity, language]);

  const confirmRemoveItem = () => {
    if (confirmRemove) {
      removeItem(confirmRemove.productId, confirmRemove.size, confirmRemove.colorHex);
      haptic.remove();
      setConfirmRemove(null);
    }
  };

  const totalItems = getTotalItems();
  const totalPrice = getTotalPrice();
  const hasErrors = Object.keys(stockErrors).length > 0;

  if (items.length === 0) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center px-4 py-24">
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full bg-accent/25 blur-2xl" />
            <div className="relative w-20 h-20 rounded-[1.75rem] card-premium flex items-center justify-center">
              <ShoppingBag className="w-9 h-9 text-accent" strokeWidth={1.8} />
            </div>
          </div>
          <h2 className="font-display text-lg font-semibold text-text mb-1.5">
            {language === 'ru' ? 'Корзина пуста' : "Savat bo'sh"}
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary mb-5 sm:mb-6 text-center max-w-[240px]">
            {language === 'ru' ? 'Добавьте товары из каталога, чтобы оформить заказ' : "Buyurtma berish uchun katalogdan mahsulotlar qo'shing"}
          </p>
          <button
            onClick={() => navigate('/catalog')}
            className="flex items-center gap-2 px-7 h-12 rounded-2xl btn-brand text-sm font-semibold"
          >
            {language === 'ru' ? 'Перейти в каталог' : "Katalogga o'tish"}
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showBottomNav={false}>
      {/* Reserve exactly the bar's measured height — see useFixedBarSpacing. */}
      <div className="bg-bg min-h-screen" style={{ paddingBottom: FIXED_BAR_SPACING }}>
        {/* Header */}
        <div className="sticky top-14 z-30 glass border-b border-[color:var(--glass-border)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => navigate(-1)}
              aria-label={language === 'ru' ? 'Назад' : 'Orqaga'}
              className="w-10 h-10 rounded-full bg-surface border border-border-subtle shadow-sm flex items-center justify-center active:scale-90 transition"
            >
              <ArrowLeft className="w-4.5 h-4.5 text-text" />
            </button>
            <div>
              <h1 className="font-display text-lg font-semibold text-text leading-tight">
                {t('cart')}
              </h1>
              <p className="text-xs font-medium text-text-tertiary tabular">
                {totalItems} {language === 'ru' ? (totalItems === 1 ? 'товар' : totalItems < 5 ? 'товара' : 'товаров') : 'mahsulot'}
              </p>
            </div>
          </div>
        </div>

        {/* Stock warning */}
        {hasErrors && (
          <div className="mx-4 mt-3 p-3.5 rounded-2xl bg-warning-light border border-warning/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <div className="text-xs text-text">
                <p className="font-semibold mb-0.5">
                  {language === 'ru' ? 'Недостаточно товаров' : "Mahsulotlar yetarli emas"}
                </p>
                <p>{language === 'ru' ? 'Уменьшите количество для оформления' : "Buyurtma berish uchun miqdorni kamaytiring"}</p>
              </div>
            </div>
          </div>
        )}

        {/* Items */}
        <div className="px-4 pt-4 space-y-3">
          {items.map((item) => {
            const itemTotal = item.price * item.quantity;
            const stockError = stockErrors[item.productId];
            const product = stockData[item.productId];
            const maxQty = product?.stock ?? 999;

            return (
              <div
                key={cartItemKey(item.productId, item.size, item.color?.hex)}
                className={`card-premium p-2.5 ${stockError ? '!border-warning/50' : ''}`}
              >
                <div className="flex gap-3">
                  {/* Image */}
                  <div
                    className="w-[84px] h-[84px] bg-white rounded-[1rem] overflow-hidden flex-shrink-0 cursor-pointer p-1.5"
                  >
                    {item.image ? (
                      <ProductImage
                        src={item.image}
                        alt={getLocalizedValue(item.name, language)}
                        className="w-full h-full object-contain"
                        showSkeleton={false}
                        onLight
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#B4BAC6]">
                        <Package className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 py-0.5 pr-0.5">
                    <h3 className="text-sm font-semibold text-text line-clamp-2 leading-snug">
                      {getLocalizedValue(item.name, language)}
                    </h3>

                    {/* Options */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {item.size && (
                        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-surface-muted text-text-secondary">
                          {t('size')}: {item.size}
                        </span>
                      )}
                      {item.color && (
                        <span className="flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-surface-muted text-text-secondary">
                          <span
                            className="w-3 h-3 rounded-full border border-border dark:border-border flex-shrink-0"
                            style={{ backgroundColor: item.color.hex }}
                          />
                          {item.color.name}
                        </span>
                      )}
                    </div>

                    {/* Stock error */}
                    {stockError && (
                      <p className="text-xs text-warning mt-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {stockError}
                      </p>
                    )}

                    {/* Available stock info */}
                    {product && product.stock > 0 && product.stock <= 5 && !stockError && (
                      <p className="text-xs text-text-tertiary mt-1">
                        {language === 'ru' ? `Осталось: ${product.stock} шт.` : `Qoldi: ${product.stock} ta`}
                      </p>
                    )}

                    {/* Price */}
                    <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                      <p className="text-[15px] font-extrabold text-text tabular whitespace-nowrap">
                        {formatPrice(itemTotal)}
                      </p>
                      {item.quantity > 1 && (
                        <p className="text-2xs font-medium text-text-tertiary tabular whitespace-nowrap">
                          {formatPrice(item.price)} × {item.quantity}
                        </p>
                      )}
                    </div>

                    {/* Quantity */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center p-0.5 rounded-full bg-surface-muted">
                          <button
                            onClick={() => handleUpdateQty(item.productId, item.quantity, item.quantity - 1, item.size, item.color)}
                            aria-label="−"
                            className="w-8 h-8 rounded-full bg-surface shadow-sm flex items-center justify-center active:scale-90 transition disabled:opacity-30 disabled:shadow-none disabled:bg-transparent"
                            disabled={item.quantity <= 1}
                          >
                            <Minus className="w-3.5 h-3.5 text-text" />
                          </button>
                          <span className="w-7 text-center text-sm font-extrabold text-text tabular">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => handleUpdateQty(item.productId, item.quantity, item.quantity + 1, item.size, item.color)}
                            aria-label="+"
                            className="w-8 h-8 rounded-full bg-surface shadow-sm flex items-center justify-center active:scale-90 transition disabled:opacity-30 disabled:shadow-none disabled:bg-transparent"
                            disabled={item.quantity >= maxQty}
                          >
                            <Plus className="w-3.5 h-3.5 text-text" />
                          </button>
                        </div>
                        <button
                          onClick={() => setConfirmRemove({ productId: item.productId, size: item.size, colorHex: item.color?.hex })}
                          aria-label={t('delete')}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-text-tertiary hover:text-danger hover:bg-danger-light active:scale-90 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed checkout bar */}
      <div ref={bottomBarRef} className="fixed bottom-0 left-0 right-0 z-40 pb-safe">
        <div className="glass border-t border-[color:var(--glass-border)] px-4 pt-3.5 pb-4">
          {/* Summary */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="eyebrow">
                {language === 'ru' ? 'Итого' : 'Jami'}
              </p>
              <p className="text-2xl font-extrabold text-text tabular tracking-tight">
                {formatPrice(totalPrice)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-tertiary">
                {totalItems} {language === 'ru' ? 'товар' : 'mahsulot'}
              </p>
            </div>
          </div>

          {/* Checkout button */}
          <button
            onClick={() => navigate('/checkout')}
            disabled={hasErrors || loading}
            className="w-full h-[52px] rounded-2xl btn-brand active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-[15px] font-bold transition-all flex items-center justify-center gap-2"
          >
            {hasErrors
              ? (language === 'ru' ? 'Исправьте ошибки' : "Xatolarni tuzating")
              : (language === 'ru' ? 'Оформить заказ' : 'Buyurtma berish')}
          </button>

          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Lock className="w-3 h-3 text-text-tertiary" />
            <span className="text-[10px] text-text-tertiary">
              {language === 'ru' ? 'Безопасная оплата' : "Xavfsiz to'lov"}
            </span>
          </div>
        </div>
      </div>

      {/* Remove confirmation modal */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)] backdrop-blur-md px-6">
          <div className="bg-surface-elevated rounded-[1.5rem] p-5 w-full max-w-xs shadow-float border border-border-subtle animate-scale-in">
            <p className="text-sm font-medium text-text text-center mb-1">
              {language === 'ru' ? 'Удалить из корзины?' : "Savatdan o'chirish?"}
            </p>
            <p className="text-xs text-text-tertiary text-center mb-5">
              {language === 'ru' ? 'Товар будет убран' : "Mahsulot o'chiriladi"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 h-11 rounded-2xl btn-ghost text-sm"
              >
                {t('cancel')}
              </button>
              <button
                onClick={confirmRemoveItem}
                className="flex-1 h-11 rounded-2xl bg-danger hover:opacity-90 text-white text-sm font-semibold active:scale-95 transition"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};
