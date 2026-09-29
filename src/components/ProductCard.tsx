import { memo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Check } from 'lucide-react';
import { WishlistToggle } from './WishlistToggle';
import { ProductImage } from './ProductImage';
import { getLocalizedValue, formatPrice } from '../lib/utils';
import { productHighlight } from '../lib/productHighlight';
import { useCartStore } from '../store/useCartStore';
import { useToggleFavorite, useTrackProductEvent } from '../lib/supabase/hooks';
import { haptic } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { toast } from './Toast';
import type { Database } from '../lib/supabase';

type Product = Database['public']['Tables']['products']['Row'];

interface ProductCardProps {
  product: Product;
  language: 'ru' | 'uz';
  favoriteIds?: string[];
  hideStockBadge?: boolean;
}

export const ProductCard = memo(({ product, language, favoriteIds: favoriteIdsProp, hideStockBadge }: ProductCardProps) => {
  const navigate = useNavigate();
  const addItem = useCartStore((state) => state.addItem);
  const trackEvent = useTrackProductEvent();
  const [justAdded, setJustAdded] = useState(false);

  const userId = useUserId();
  const toggleFavorite = useToggleFavorite(userId);

  // Single source of truth: the favourite ids the parent passes down, which
  // useToggleFavorite updates optimistically. A local copy used to be kept in
  // parallel and synced from this prop by an effect — two states describing one
  // fact, so a failed request could leave the heart filled with nothing saved.
  const isFavorite = (favoriteIdsProp ?? []).includes(product.id);
  const highlight = productHighlight(product.specs as Record<string, string | number | boolean> | null);
  const [pulsing, setPulsing] = useState(false);

  const handleToggleFavorite = useCallback(() => {
    if (!userId) {
      toast.info(
        language === 'ru'
          ? 'Откройте магазин в Telegram, чтобы добавлять в избранное'
          : "Tanlanganlarga qo'shish uchun do'konni Telegramda oching",
      );
      return;
    }
    setPulsing(true);
    haptic.select();
    toggleFavorite.mutate(
      { productId: product.id, isFavorite },
      {
        onError: () => {
          haptic.error();
          toast.error(
            language === 'ru' ? 'Не удалось изменить избранное' : "Tanlanganlarni o'zgartirib bo'lmadi",
          );
        },
      },
    );
    setTimeout(() => setPulsing(false), 300);
  }, [isFavorite, toggleFavorite, product.id, userId, language]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.stock === 0) return;
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price as number,
      image: product.images?.[0] || '',
      quantity: 1,
      size: product.sizes?.[0],
      color: product.colors?.[0],
    });
    trackEvent.mutate({ product_id: product.id, event_type: 'cart_adds' });
    haptic.addToCart();
    setJustAdded(true);
    toast.success(language === 'ru' ? 'Добавлено в корзину' : "Savatga qo'shildi");
    setTimeout(() => setJustAdded(false), 1500);
  };

  const priceText = formatPrice(product.price as number);

  /*
    Высота плитки фиксируется, а не следует за контентом.

    Элемент сетки — это обёртка (`animate-fade-in-up` в Catalog и Home,
    `w-[160px]` в карусели коллекций): она растягивается по высоте строки, а
    карточка внутри оставалась по высоте своего содержимого. Плюс три блока
    были необязательными — подзаголовок с размерами/характеристикой, строка
    «В наличии» и кнопка быстрого добавления. Замеры на каталоге давали
    315, 332 и 333 px в одной сетке.

    Ниже: h-full тянет карточку на всю ячейку, mt-auto прибивает цену к низу, а
    необязательным строкам резервируется место — так совпадают не только
    габариты плиток, но и базовые линии цен по всему ряду.
  */
  return (
    <div
      onClick={() => navigate(`/product/${product.slug}`)}
      className="card-premium p-1.5 overflow-hidden cursor-pointer group relative active:scale-[0.985] transition-transform h-full flex flex-col"
      style={{ isolation: 'isolate' }}
    >
      {/*
        Image

        Рамка плитки фиксированная (4:5), а снимок вписывается в неё целиком:
        при object-cover вертикальные фотографии товаров срезались сверху и
        снизу, и в сетке был виден кусок товара вместо товара.

        Фон белый в обеих темах: студийные снимки почти всегда на белом, и поля
        с ними сливаются. В тёмной теме белая «витрина» утоплена внутрь
        карточки с отступом — так она читается как подсвеченный стенд, а не
        как дыра в интерфейсе.
      */}
      <div className="relative aspect-[4/5] bg-white overflow-hidden rounded-[1rem]">
        <div className="absolute inset-0 p-3">
          <ProductImage
            src={product.images?.[0]}
            alt={getLocalizedValue(product.name, language)}
            className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
            onLight
          />
        </div>

        {!hideStockBadge && product.stock > 0 && product.stock < 5 && (
          <div className="absolute top-2 left-2 bg-[#0B0D12]/85 backdrop-blur text-white text-2xs font-bold px-2 py-1 rounded-full z-10 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            {language === 'ru' ? `Осталось ${product.stock}` : `${product.stock} qoldi`}
          </div>
        )}

        {/* Favorite + Notifications — Portal renders outside card boundaries */}
        <WishlistToggle
          productId={product.id}
          isFavorite={isFavorite}
          onToggleFavorite={handleToggleFavorite}
          language={language}
          variant="card"
          pulse={pulsing}
        />

        {product.stock === 0 && (
          <div className="absolute inset-x-2 bottom-2 z-10 text-center text-2xs font-bold uppercase tracking-wider text-white bg-[#0B0D12]/80 backdrop-blur rounded-full py-1">
            {language === 'ru' ? 'Нет в наличии' : "Mavjud emas"}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-2 pt-2.5 pb-1.5 flex-1 flex flex-col">
        {/*
          До трёх строк, а не одна: у техники модель стоит в конце названия и в
          узкой плитке переносится на третью строку. Минимальная высота в две
          строки держит сетку ровной там, где название короткое.
        */}
        <h3 className="text-[13px] leading-[1.3] font-semibold text-text line-clamp-3 min-h-[2.1rem]">
          {getLocalizedValue(product.name, language)}
        </h3>

        {/*
          Размеры остаются за одеждой; для техники их нет, и тогда на их месте
          показываем главные цифры из характеристик — иначе плитки
          «Холодильник Bosch KGN36XL30U» и «…KBN96ADD0» неразличимы.
        */}
        {/*
          Строка рендерится всегда, даже когда сказать нечего: у «Кухонных
          весов Accent EB9493S» нет ни размеров, ни характеристики, и вместе с
          этой строкой плитка теряла ровно 17 px против соседних.
        */}
        <p className="mt-1 text-2xs font-medium text-text-tertiary truncate">
          {product.sizes && product.sizes.length > 0
            ? product.sizes.slice(0, 3).join(' · ')
            : highlight || ' '}
        </p>

        {/* mt-auto: цена всегда у нижнего края, как бы ни было длинно название */}
        <div className="mt-auto pt-2">
          {/*
            Цена занимает всю ширину плитки, а кнопка ушла строкой ниже.

            Раньше они делили одну строку, и цене оставалось 86 px при ширине
            плитки 160. «15,087,000 сум» требует там 102 px даже уменьшенным
            кеглем 14 — текст вылезал из своей колонки на 16 px при зазоре 8 и
            уезжал под кнопку, которая его перекрывала. Переполнение было у 75
            карточек из 76.

            Подбором кегля это не лечится: замер дал 95 px при 13, 88 при 12 и
            только 80 при 11 — для главной цены такой размер нечитаем. На всю
            ширину доступно 132 px, и та же цена умещается при полном 17.

            Высота строки задана явно и одинаково для обоих кеглей: с
            leading-none блок цены был то 15, то 17 px, и строка ниже гуляла по
            вертикали от плитки к плитке.
          */}
          <div
            className={`font-extrabold text-text whitespace-nowrap tabular tracking-tight leading-[1.25rem] ${
              priceText.length > 13 ? 'text-[15px]' : 'text-[17px]'
            }`}
          >
            {priceText}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* Место под статус держится и у распроданного товара */}
            <div className="flex items-center gap-1 h-9 min-w-0">
              {product.stock > 0 && (
                <>
                  <span className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-success shadow-[0_0_8px_rgb(var(--success))]" />
                  <span className="text-2xs text-text-secondary font-semibold truncate">
                    {language === 'ru' ? 'В наличии' : 'Mavjud'}
                  </span>
                </>
              )}
            </div>

            {/* Quick add — бокс 36×36 остаётся и без кнопки, иначе ряд просядет */}
            <div className="flex-shrink-0 w-9 h-9">
              {product.stock > 0 && (
                <button
                  onClick={handleAddToCart}
                  aria-label={language === 'ru' ? 'В корзину' : "Savatga qo'shish"}
                  className={`w-full h-full rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 ${
                    justAdded ? 'bg-success text-white' : 'btn-brand'
                  }`}
                >
                  {justAdded ? <Check className="w-4 h-4" strokeWidth={3} /> : <ShoppingCart className="w-4 h-4" strokeWidth={2.2} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
