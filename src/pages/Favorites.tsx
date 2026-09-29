import { useNavigate } from 'react-router-dom';
import { Heart, BellRing, TrendingDown, ShoppingCart } from 'lucide-react';
import { Layout } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { ProductCardSkeleton } from '../components/Skeleton';
import { QueryError } from '../components/QueryError';
import { isQueryOffline } from '../lib/queryState';
import { useTranslation } from '../hooks/useTranslation';
import { useFavorites, useFavoriteIds } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import type { Database } from '../lib/supabase';

type Product = Database['public']['Tables']['products']['Row'];
type FavoriteProduct = Product & { favoriteId: string; notify_price: boolean; notify_stock: boolean };

export const Favorites = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const userId = useUserId();
  const { data: favorites = [], isLoading, isError, error, refetch, fetchStatus } = useFavorites(userId);
  const offline = isQueryOffline(fetchStatus);
  // Same query the rest of the app reads, so the optimistic update in
  // useToggleFavorite reaches this page too. Previously the ids were derived
  // from `favorites`, which only refreshes after the mutation settles — the
  // heart here had no rollback path at all when a request failed.
  const { data: favoriteIds = [] } = useFavoriteIds(userId);

  const hasNotifications = favorites.some((f: FavoriteProduct) => f.notify_price || f.notify_stock);

  return (
    <Layout>
      <div className="px-4 pt-5 pb-2">
        <h1 className="font-display text-xl font-semibold text-text">
          {language === 'ru' ? 'Избранное' : 'Tanlanganlar'}
        </h1>
        {!isLoading && favorites.length > 0 && (
          <p className="text-sm text-text-secondary mt-0.5">
            {favorites.length} {language === 'ru' ? 'товаров' : 'mahsulot'}
          </p>
        )}
      </div>

      {/* Notification legend */}
      {!isLoading && favorites.length > 0 && hasNotifications && (
        <div className="px-4 mb-3">
          <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
            <span className="flex items-center gap-1">
              <BellRing className="w-3 h-3 text-success" />
              {language === 'ru' ? 'Уведомления включены' : 'Bildirishnomalar yoqilgan'}
            </span>
          </div>
        </div>
      )}

      <div className="px-4 pb-24 pt-3">
        {isLoading && !offline ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : isError || offline ? (
          <QueryError error={error} offline={offline} onRetry={() => void refetch()} />
        ) : favorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl flex items-center justify-center mb-4 sm:mb-5 bg-surface-muted border border-border"
            >
              <Heart className="w-8 h-8 sm:w-9 sm:h-9 text-text-tertiary" />
            </div>
            <p className="text-sm sm:text-base font-semibold text-text mb-1">
              {language === 'ru' ? 'Здесь пусто' : 'Bu yerda hali hech narsa yo\'q'}
            </p>
            <p className="text-xs sm:text-sm text-text-secondary mb-5 sm:mb-6 max-w-[240px] leading-relaxed">
              {language === 'ru'
                ? 'Добавляйте товары в избранное — нажмите на сердечко'
                : 'Mahsulotlarni yoqtirganlaringizga qo\'shish uchun yurakcha tugmasini bosing'}
            </p>
            <button
              onClick={() => navigate('/catalog')}
              className="btn-brand px-6 h-12 rounded-xl text-sm"
            >
              {t('catalog')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {favorites.map((product: FavoriteProduct, i: number) => (
              <div
                key={product.id}
                className="animate-fade-in-up relative h-full"
                style={{ animationDelay: `${Math.min(i, 5) * 0.05}s` }}
              >
                {/* Stock badge + Notification badges */}
                <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
                  {product.stock > 0 && product.stock < 5 && (
                    <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/90 text-text-inverse text-[9px] font-bold backdrop-blur-sm">
                      <span>{language === 'ru' ? `Осталось ${product.stock}` : `${product.stock} qoldi`}</span>
                    </div>
                  )}
                  {product.notify_price && (
                    <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-green-500/90 text-text-inverse text-[9px] font-bold backdrop-blur-sm">
                      <TrendingDown className="w-2.5 h-2.5" />
                      <span>{language === 'ru' ? 'Скидка' : 'Chegirma'}</span>
                    </div>
                  )}
                  {product.notify_stock && (
                    <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-blue-500/90 text-text-inverse text-[9px] font-bold backdrop-blur-sm">
                      <ShoppingCart className="w-2.5 h-2.5" />
                      <span>{language === 'ru' ? 'Наличие' : 'Mavjudlik'}</span>
                    </div>
                  )}
                </div>
                <ProductCard product={product} language={language} favoriteIds={favoriteIds} hideStockBadge />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};
