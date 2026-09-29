import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Sparkles, ArrowUp, LayoutGrid, ChevronDown, Send } from 'lucide-react';
import { categoryIcon } from '../lib/categoryIcons';
import { Layout } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { BannerSlider } from '../components/BannerSlider';
import { ProductCardSkeleton } from '../components/Skeleton';
import { CollectionSection } from '../components/CollectionSection';
import { QueryError } from '../components/QueryError';
import { isQueryOffline } from '../lib/queryState';
import { useTranslation } from '../hooks/useTranslation';
import { useDebounce } from '../hooks/useDebounce';
import { useProducts, useCategories, useBanners, useCollections, useFavoriteIds } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import { getLocalizedValue, cn } from '../lib/utils';
import { tg } from '../lib/telegram';
import { BOT_URL } from '../lib/config';

export const Catalog = () => {
  const { t, language } = useTranslation();
  const userId = useUserId();
  const { data: favoriteIds = [] } = useFavoriteIds(userId);
  /*
   * Категория живёт в адресе: /catalog?category=smartphones
   *
   * Так на неё можно вести откуда угодно — с баннера, из бота, из ссылки в
   * переписке, — и кнопка «назад» в Telegram возвращает к прежнему фильтру, а
   * не сбрасывает его. Раньше выбор существовал только в памяти компонента, и
   * попасть в конкретную категорию по ссылке было нельзя.
   *
   * В адресе стоит slug, а не id: он читаемый и не меняется при пересоздании
   * категории.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const categorySlug = searchParams.get('category') ?? undefined;
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 350);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'created_at' | 'price' | 'views'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minPrice, setMinPrice] = useState<number | undefined>();
  const [maxPrice, setMaxPrice] = useState<number | undefined>();
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const { data: categories = [] } = useCategories();

  // Из slug в адресе — в id для запроса. Пока категории не загрузились, фильтр
  // не применяется: иначе первый запрос ушёл бы без него и показал весь каталог.
  const selectedCategory = categorySlug
    ? categories.find((c) => c.slug === categorySlug)?.id
    : undefined;

  const selectCategory = (slug: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (slug) next.set('category', slug);
    else next.delete('category');
    // replace, а не push: перебор чипов не должен наполнять историю, иначе
    // «назад» будет отматывать фильтры по одному вместо выхода со страницы.
    setSearchParams(next, { replace: true });
  };
  const { data: banners = [] } = useBanners(true);
  const { data: collections = [] } = useCollections(true);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const filters = {
    categoryId: selectedCategory,
    minPrice,
    maxPrice,
    sizes: selectedSizes.length > 0 ? selectedSizes : undefined,
    colors: selectedColors.length > 0 ? selectedColors : undefined,
    inStock: inStockOnly,
    search: debouncedSearch || undefined,
  };

  const sort = { field: sortBy, order: sortOrder };

  const {
    data: productsData,
    isLoading,
    isError,
    error,
    refetch,
    fetchStatus,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useProducts(filters, sort);

  // Offline pauses the query instead of failing it, which otherwise renders as
  // an empty catalogue. See isQueryOffline.
  const offline = isQueryOffline(fetchStatus);

  const products = productsData?.pages.flatMap((p) => p.items) ?? [];
  // `total` counts rows matching the server-side filters. The colour filter
  // still runs in the browser, so when it is active the server's count is an
  // upper bound — show what is actually on screen instead of a number the user
  // can see is wrong.
  const approximate = productsData?.pages.some((p) => p.approximate) ?? false;
  const total = approximate
    ? products.length
    : productsData?.pages[0]?.total ?? 0;

  const allSizes = Array.from(new Set(products.flatMap((p) => p.sizes))).sort();
  const allColors = Array.from(
    new Map(products.flatMap((p) => p.colors).map((c: { name: string; hex: string }) => [c.hex, c])).values()
  );

  const toggleSize = (size: string) => {
    setSelectedSizes((prev) => prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]);
  };

  const toggleColor = (hex: string) => {
    setSelectedColors((prev) => prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex]);
  };

  const clearFilters = () => {
    selectCategory(undefined);
    setSearchQuery('');
    setMinPrice(undefined);
    setMaxPrice(undefined);
    setSelectedSizes([]);
    setSelectedColors([]);
    setInStockOnly(false);
  };

  const activeFiltersCount =
    (selectedCategory ? 1 : 0) + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) +
    selectedSizes.length + selectedColors.length + (inStockOnly ? 1 : 0);

  return (
    <Layout>
      {banners.length > 0 && (
        <div className="animate-fade-in">
          <BannerSlider banners={banners} language={language} />
        </div>
      )}

      <div className="px-4 pt-4 pb-2 space-y-3">
        {/* Headline — only on the bare catalogue, not once the user narrows it */}
        {!selectedCategory && !debouncedSearch && banners.length === 0 && (
          <div className="pt-1 pb-1 animate-fade-in-up">
            <p className="eyebrow mb-1.5">Point Tech Store</p>
            <h1 className="font-display text-[23px] leading-[1.15] font-semibold text-text">
              {language === 'ru' ? (
                <>Техника, <span className="text-gradient-brand">которая работает</span></>
              ) : (
                <>Ishonchli <span className="text-gradient-brand">texnika</span></>
              )}
            </h1>
          </div>
        )}

        {/* Search bar */}
        <div className="relative animate-fade-in-up">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-text-tertiary" />
          <input
            type="text"
            placeholder={t('search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-premium h-12 !pl-11 !pr-14 !rounded-2xl"
          />
          {searchQuery && searchQuery !== debouncedSearch && (
            <div className="absolute right-12 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-border border-t-transparent rounded-full animate-spin" />
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl transition-all",
              showFilters ? "bg-accent text-text-on-accent shadow-accent" : "bg-surface text-text-secondary shadow-sm"
            )}
            aria-label={t('filters')}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFiltersCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-text-inverse text-2xs rounded-full w-4 h-4 flex items-center justify-center font-bold animate-bounce-in">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Categories scroll */}
        <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
          <div className="flex gap-2 pb-1">
            <button
              onClick={() => selectCategory(undefined)}
              className={cn('chip', !selectedCategory && 'is-active')}
            >
              <LayoutGrid className="w-4 h-4 flex-shrink-0" />
              {t('all_products')}
            </button>
            {categories.map((category) => {
              // Значок из categories.icon. До этого поле только хранилось:
              // выбиралось в админке и нигде не показывалось.
              const Icon = categoryIcon(category.icon);
              return (
                <button
                  key={category.id}
                  onClick={() => selectCategory(category.slug)}
                  className={cn('chip', selectedCategory === category.id && 'is-active')}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {getLocalizedValue(category.name, language)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort row */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary font-semibold tabular">
            {isLoading ? '...' : `${total} ${language === 'ru' ? 'товаров' : 'mahsulot'}`}
          </span>
          <div className="relative">
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field as 'created_at' | 'price' | 'views');
              setSortOrder(order as 'asc' | 'desc');
            }}
            aria-label={language === 'ru' ? 'Сортировка' : 'Saralash'}
            className="appearance-none h-9 pl-3.5 pr-9 rounded-full border border-border-subtle bg-surface text-text font-semibold outline-none shadow-sm focus:border-accent focus:shadow-glow"
          >
            <option value="created_at-desc">{t('newest')}</option>
            <option value="price-asc">{t('price_low')}</option>
            <option value="price-desc">{t('price_high')}</option>
            <option value="views-desc">{t('popularity')}</option>
          </select>
          </div>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="mx-4 mb-3 card-premium p-4 animate-fade-in-down">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-text flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-text-secondary" />
              {t('filters')}
            </h3>
            <div className="flex items-center gap-3">
              {activeFiltersCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-accent font-bold">
                  {t('reset')}
                </button>
              )}
              <button onClick={() => setShowFilters(false)} className="p-1 rounded-lg hover:bg-surface-muted">
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-2">
                {t('price_from')} - {t('price_to')}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="0"
                  value={minPrice || ''}
                  onChange={(e) => setMinPrice(e.target.value ? Number(e.target.value) : undefined)}
                  className="flex-1 input-premium !py-2 !px-3 text-sm"
                />
                <span className="text-text-tertiary text-sm">—</span>
                <input
                  type="number"
                  placeholder="∞"
                  value={maxPrice || ''}
                  onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : undefined)}
                  className="flex-1 input-premium !py-2 !px-3 text-sm"
                />
              </div>
            </div>

            {allSizes.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">{t('size')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {allSizes.map((size) => (
                    <button
                      key={size}
                      onClick={() => toggleSize(size)}
                      className={cn(
                        "px-3.5 h-9 rounded-full border text-xs font-semibold transition-all duration-200",
                        selectedSizes.includes(size)
                          ? 'bg-text text-bg border-transparent'
                          : 'bg-surface text-text-secondary border-border-subtle'
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {allColors.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">{t('color')}</label>
                <div className="flex flex-wrap gap-2">
                  {allColors.map((color: { name: string; hex: string }) => (
                    <button
                      key={color.hex}
                      onClick={() => toggleColor(color.hex)}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all duration-200",
                        selectedColors.includes(color.hex)
                          ? 'border-surface scale-110 ring-2 ring-accent'
                          : 'border-border hover:scale-105'
                      )}
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-[rgb(var(--accent))]"
              />
              <span className="text-xs font-medium text-text-secondary dark:text-text-tertiary">{t('in_stock')}</span>
            </label>
          </div>
        </div>
      )}

      {/* Products */}
      <div className="pb-24">
        {/* Collection Sections — show only when no filters */}
        {collections.length > 0 && !debouncedSearch && !selectedCategory && activeFiltersCount === 0 && (
          <div className="mt-2">
            {collections.map((col) => (
              <CollectionSection key={col.id} collection={col} language={language} />
            ))}
          </div>
        )}

        <div className="px-4 pt-2">
        {isLoading && !offline ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : isError || offline ? (
          <QueryError error={error} offline={offline} onRetry={() => void refetch()} />
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-3xl bg-surface shadow-lit flex items-center justify-center mx-auto mb-4">
              <Search className="w-7 h-7 text-text-tertiary" />
            </div>
            <p className="text-sm font-medium text-text-tertiary">
              {debouncedSearch || activeFiltersCount > 0
                ? language === 'ru' ? 'Товары не найдены' : 'Mahsulotlar topilmadi'
                : language === 'ru' ? 'Нет товаров' : "Mahsulotlar yo'q"}
            </p>
            {(debouncedSearch || activeFiltersCount > 0) && (
              <button
                onClick={clearFilters}
                className="mt-3 btn-ghost px-4 h-10 rounded-full text-xs"
              >
                {language === 'ru' ? 'Сбросить фильтры' : 'Filtrlarni tozalash'}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {products.map((product, i) => (
                <div key={product.id} className="animate-fade-in-up h-full" style={{ animationDelay: `${Math.min(i, 5) * 0.05}s` }}>
                  <ProductCard product={product} language={language} favoriteIds={favoriteIds} />
                </div>
              ))}
            </div>

            {hasNextPage && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="btn-brand-outline flex items-center gap-2 px-6 h-12 rounded-2xl text-sm disabled:opacity-60"
                >
                  {isFetchingNextPage ? (
                    <>
                      <span className="w-4 h-4 border-2 border-border border-t-surface-900 rounded-full animate-spin" />
                      {language === 'ru' ? 'Загрузка...' : 'Yuklanmoqda...'}
                    </>
                  ) : (
                    approximate
                      ? (language === 'ru' ? 'Показать ещё' : "Yana ko'rsatish")
                      : language === 'ru'
                        ? `Показать ещё (${total - products.length})`
                        : `Yana ko'rsatish (${total - products.length})`
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/*
          Промокод и подписка на канал переехали сюда из Home.

          В Home они жили внутри витрины, которая показывалась ~225 мс между
          выбором языка и переходом на каталог, — то есть скидку на первый
          заказ не видел никто. Здесь блоки стоят вне ветки со списком
          товаров, поэтому показываются и когда поиск ничего не нашёл.
        */}
        <div className="mt-8 space-y-4">
          <div className="relative overflow-hidden rounded-[1.5rem] p-5 text-white gradient-stage ring-1 ring-white/10">
            <div className="pointer-events-none absolute -right-10 -top-10 w-40 h-40 rounded-full bg-accent/50 blur-3xl" />
            <div className="flex items-center gap-3 mb-2 relative">
              <Sparkles className="w-5 h-5 text-accent-2" />
              <h3 className="font-display font-semibold text-[17px]">
                {language === 'ru' ? 'Скидка 10% на первый заказ' : "Birinchi buyurtmaga 10% chegirma"}
              </h3>
            </div>
            <p className="text-white/70 text-xs relative">
              {language === 'ru'
                ? 'Используйте промокод POINTTECH при оформлении заказа'
                : "POINTTECH promo kodini kiriting buyurtma paytida"}
            </p>
          </div>

          <div className="card-premium p-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl gradient-brand shadow-accent flex items-center justify-center flex-shrink-0">
                <Send className="w-5 h-5 text-text-inverse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-text">
                  {language === 'ru' ? 'Наш канал' : 'Bizning kanal'}
                </p>
                <p className="text-xs text-text-secondary">
                  {language === 'ru' ? 'Акции, скидки и новинки' : 'Aksiyalar, chegirmalar va yangiliklar'}
                </p>
              </div>
              <button
                onClick={() => { tg?.openTelegramLink?.(BOT_URL); }}
                className="btn-brand px-4 h-9 rounded-full text-xs flex-shrink-0"
              >
                {language === 'ru' ? 'Подписаться' : "Obuna bo'lish"}
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label={language === 'ru' ? 'Наверх' : 'Yuqoriga'}
          className="fixed bottom-28 right-4 z-40 w-11 h-11 rounded-full glass-card text-text flex items-center justify-center transition-all duration-200 active:scale-90 animate-fade-in"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </Layout>
  );
};
