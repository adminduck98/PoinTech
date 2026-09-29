import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, ShoppingCart, Share2, Star, ChevronLeft, ChevronRight, Camera, X, Send, MessageSquare, ZoomIn, BellRing, Heart } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useTranslation } from '../hooks/useTranslation';
import { useCartStore } from '../store/useCartStore';
import { useProduct, useIncrementViews, useProductReviews, useProductRating, useFavoriteIds, useToggleFavorite, useCreateReview, useUploadReviewPhoto, useTrackProductEvent } from '../lib/supabase/hooks';
import { haptic } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { formatPrice, getLocalizedValue } from '../lib/utils';
import { WishlistToggle } from '../components/WishlistToggle';
import { ShareCard } from '../components/ShareCard';
import { toast } from '../components/Toast';
import { ProductImage } from '../components/ProductImage';
import { QueryError } from '../components/QueryError';
import { useFixedBarSpacing, FIXED_BAR_SPACING } from '../hooks/useFixedBarSpacing';
import { isQueryOffline } from '../lib/queryState';
import type { UploadedPhoto } from '../lib/fileUpload';

/** Сколько показывать до нажатия «Читать полностью» / «Все характеристики». */
const DESCRIPTION_PREVIEW = 420;
const SPECS_PREVIEW = 8;

export const ProductDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const addItem = useCartStore((state) => state.addItem);

  const userId = useUserId();
  const { data: favoriteIds = [] } = useFavoriteIds(userId);
  const toggleFavorite = useToggleFavorite(userId);

  const { data: product, isLoading, isError, error, refetch, fetchStatus } = useProduct(slug!);
  const offline = isQueryOffline(fetchStatus);
  const bottomBarRef = useFixedBarSpacing<HTMLDivElement>();
  const incrementViews = useIncrementViews();
  const trackEvent = useTrackProductEvent();
  const { data: reviews = [] } = useProductReviews(product?.id || '');
  const { data: rating } = useProductRating(product?.id || '');

  const isFavorite = product ? favoriteIds.includes(product.id) : false;

  // Same contract as ProductCard: refuse early without an identity, and say so
  // when the request fails instead of silently reverting the heart.
  const handleToggleFavorite = useCallback(() => {
    if (!product) return;
    if (!userId) {
      toast.info(
        language === 'ru'
          ? 'Откройте магазин в Telegram, чтобы добавлять в избранное'
          : "Tanlanganlarga qo'shish uchun do'konni Telegramda oching",
      );
      return;
    }
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
  }, [product, userId, language, isFavorite, toggleFavorite]);

  const createReview = useCreateReview();
  const uploadReviewPhoto = useUploadReviewPhoto();

  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string | undefined>();
  const [selectedColor, setSelectedColor] = useState<{ name: string; hex: string } | undefined>();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  // Описания у техники доходят до нескольких тысяч знаков, а характеристик
  // бывает больше сорока: показываем начало, остальное — по кнопке.
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [specsExpanded, setSpecsExpanded] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewName, setReviewName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  // Хранится пара «путь + ссылка»: путь уходит в базу, ссылка нужна только
  // для предпросмотра в форме — фото отзывов лежат в закрытом бакете, и
  // подписанная ссылка через час перестаёт открываться.
  const [reviewPhotos, setReviewPhotos] = useState<UploadedPhoto[]>([]);
  const [reviewUploading, setReviewUploading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const reviewPhotoInput = useRef<HTMLInputElement>(null);
  const viewsIncrementedRef = useRef<string | null>(null);

  useEffect(() => {
    if (product) {
      if (product.sizes && product.sizes.length > 0) setSelectedSize(product.sizes[0]);
      if (product.colors && product.colors.length > 0) setSelectedColor(product.colors[0] as { name: string; hex: string });
      if (viewsIncrementedRef.current !== product.id) {
        viewsIncrementedRef.current = product.id;
        incrementViews.mutate(product.id);
        trackEvent.mutate({ product_id: product.id, event_type: 'views' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const handleShare = () => {
    if (!product) return;
    haptic.confirm();
    setShowShareCard(true);
  };

  const handleAddToCart = () => {
    if (!product) return;
    if (product.sizes.length > 0 && !selectedSize) { toast.warning(t('select_size')); return; }
    if (product.colors.length > 0 && !selectedColor) { toast.warning(t('select_color')); return; }
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price as number,
      image: product.images[0] || '',
      quantity,
      size: selectedSize,
      color: selectedColor,
    });
    trackEvent.mutate({ product_id: product.id, event_type: 'cart_adds', delta: quantity });
    haptic.addToCart();
    toast.success(t('add_to_cart'));
    navigate('/cart');
  };

  const nextImage = () => {
    if (!product) return;
    setCurrentImageIndex((prev) => (prev + 1) % product.images.length);
  };

  const prevImage = () => {
    if (!product) return;
    setCurrentImageIndex((prev) => (prev - 1 + product.images.length) % product.images.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => setTouchStart(e.targetTouches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => setTouchEnd(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) nextImage();
    if (distance < -50) prevImage();
    setTouchStart(0);
    setTouchEnd(0);
  };

  const handleReviewPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setReviewUploading(true);
    try {
      const remaining = 5 - reviewPhotos.length;
      const filesToUpload = Array.from(files).slice(0, remaining);
      const uploadPromises = filesToUpload.map(async (file) => {
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(language === 'ru' ? 'Файл слишком большой (макс. 5 МБ)' : 'Fayl hajmi katta (maks. 5 MB)');
        }
        return uploadReviewPhoto.mutateAsync(file);
      });
      const urls = await Promise.all(uploadPromises);
      setReviewPhotos((prev) => [...prev, ...urls].slice(0, 5));
    } catch (err) {
      const msg = err instanceof Error ? err.message : (language === 'ru' ? 'Ошибка загрузки фото' : 'Fotosni yuklashda xatolik');
      toast.error(msg);
    } finally {
      setReviewUploading(false);
      if (reviewPhotoInput.current) reviewPhotoInput.current.value = '';
    }
  };

  const handleRemoveReviewPhoto = (index: number) => {
    setReviewPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReview = async () => {
    if (!product || !reviewName.trim()) return;
    setReviewSubmitting(true);
    try {
      await createReview.mutateAsync({
        product_id: product.id,
        telegram_user_id: userId,
        user_name: reviewName.trim(),
        rating: reviewRating,
        comment: reviewComment.trim() || null,
        photos: reviewPhotos.map((p) => p.path),
        images: reviewPhotos.map((p) => p.path),
        is_verified_purchase: false,
        admin_reply: null,
        is_approved: false,
      });
      setReviewSubmitted(true);
      setShowReviewForm(false);
      setReviewRating(5);
      setReviewName('');
      setReviewComment('');
      setReviewPhotos([]);
      toast.success(language === 'ru' ? 'Отзыв отправлен! После проверки он появится на странице' : 'Sharh yuborildi!');
    } catch {
      toast.error(language === 'ru' ? 'Ошибка отправки' : 'Yuborishda xatolik');
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (isLoading && !offline) {
    return (
      <Layout showBottomNav={false}>
        <div className="min-h-screen bg-bg flex flex-col">
          {/* skeleton gallery */}
          <div className="w-full bg-surface-muted h-[50dvh] sm:h-[62dvh]">
            <div className="w-full h-full skeleton" />
          </div>
          <div className="p-6 space-y-4">
            <div className="h-6 w-2/3 skeleton rounded-lg" />
            <div className="h-5 w-1/3 skeleton rounded-lg" />
            <div className="h-4 w-full skeleton rounded-lg" />
            <div className="h-4 w-4/5 skeleton rounded-lg" />
          </div>
        </div>
      </Layout>
    );
  }

  // A failed request and a slug that genuinely has no product both used to land
  // on "Товар не найден", which sends the customer away from a product that
  // exists. Only report "not found" when the server actually answered.
  if (isError || offline || !product) {
    return (
      <Layout showBottomNav={false}>
        <div className="min-h-screen bg-bg flex items-center justify-center">
          <div className="text-center px-8">
            <button
              onClick={() => navigate(-1)}
              className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center shadow-card mb-6 mx-auto transition-transform duration-150 active:scale-95"
            >
              <ArrowLeft className="w-5 h-5 text-surface-700" />
            </button>
            {isError || offline ? (
              <QueryError error={error} offline={offline} onRetry={() => void refetch()} variant="inline" />
            ) : (
              <p className="text-text-secondary text-sm">
                {language === 'ru' ? 'Товар не найден' : 'Mahsulot topilmadi'}
              </p>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  const images = product.images.length > 0 ? product.images : [''];
  const hasImages = product.images.length > 0;

  return (
    <>
    <Layout showBottomNav={false}>
      {/* Reserve exactly the bar's measured height — see useFixedBarSpacing. */}
      <div className="bg-bg min-h-screen" style={{ paddingBottom: FIXED_BAR_SPACING }}>

        {/*
          ─── GALLERY ───

          Без фотографий блок сжимается до полоски под кнопку «Назад».
          Раньше высота была 50dvh всегда, и товар без снимка открывался
          половиной экрана пустого серого поля с надписью «Нет фото» — первое,
          что видел покупатель. Пустое место ничего не сообщает, а карточку
          отодвигало за пределы экрана.
        */}
        <div
          className={`relative w-full ${
            hasImages ? 'bg-white h-[52dvh] sm:h-[62dvh]' : 'h-14 sm:h-16'
          }`}
        >

          {/* Back button — always visible, always clickable */}
          {/*
            Кружок всегда белый — он лежит поверх фотографии, и в тёмной теме
            это тоже верно. А стрелка внутри бралась из `text-text`, который в
            тёмной теме почти белый: белая стрелка на белом кружке пропадала.
            Цвет иконки задан явно и от темы не зависит, как и сам кружок.
          */}
          <button
            onClick={() => navigate(-1)}
            aria-label="Назад"
            className="absolute top-3 left-3 sm:top-4 sm:left-4 z-30 w-10 h-10 rounded-full bg-white/90 backdrop-blur-md ring-1 ring-black/5 flex items-center justify-center shadow-card transition-all duration-150 active:scale-90 hover:bg-white"
          >
            <ArrowLeft className="w-5 h-5 text-[#1A1A1A]" />
          </button>

          {/* Main image */}
          <div
            className="w-full h-full overflow-hidden select-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {hasImages && (
              <ProductImage
                key={currentImageIndex}
                src={images[currentImageIndex]}
                alt={getLocalizedValue(product.name, language)}
                /*
                  object-contain, а не cover: снимок товара показывается
                  целиком. При cover он растягивался до заполнения рамки, и у
                  вертикальных фотографий (2240×2560, 1792×2390 против почти
                  квадратной рамки) срезалось до 19% сверху и снизу — вместе с
                  верхом или низом самого товара.

                  Фон белый в обеих темах: студийные снимки почти всегда на
                  белом, поэтому поля от contain с ним сливаются.
                */
                className="w-full h-full object-contain p-6"
                loading="eager"
                onLight
              />
            )}
          </div>

          {/* Prev / Next arrows — только >1 изображения и только от sm.
              На телефоне галерея листается свайпом (обработчики на контейнере
              выше) и точками внизу, так что стрелки ничего не добавляли, зато
              левая вставала ровно под кнопку «Назад»: два одинаковых белых
              кружка в одной колонке у края, из которых один уводит со
              страницы, а другой листает фото.
              Иконки были разного размера — w-4 слева против w-5 справа. */}
          {images.length > 1 && (
            <>
              <button
                onClick={prevImage}
                aria-label="Предыдущее фото"
                className="hidden sm:flex absolute sm:left-4 top-1/2 -translate-y-1/2 z-20 sm:w-11 sm:h-11 rounded-full bg-white/85 backdrop-blur-sm items-center justify-center shadow-sm transition-all duration-150 active:scale-95 hover:bg-white"
              >
                <ChevronLeft className="w-5 h-5 text-[#1A1A1A]" />
              </button>
              <button
                onClick={nextImage}
                aria-label="Следующее фото"
                className="hidden sm:flex absolute sm:right-4 top-1/2 -translate-y-1/2 z-20 sm:w-11 sm:h-11 rounded-full bg-white/85 backdrop-blur-sm items-center justify-center shadow-sm transition-all duration-150 active:scale-95 hover:bg-white"
              >
                <ChevronRight className="w-5 h-5 text-[#1A1A1A]" />
              </button>
            </>
          )}

          {/* Dot indicators */}
          {images.length > 1 && (
            <div className={`absolute left-0 right-0 flex justify-center gap-1.5 z-20 ${images.length > 1 ? 'bottom-10' : 'bottom-4'}`}>
              {images.map((_: string, i: number) => (
                <button
                  key={i}
                  onClick={() => setCurrentImageIndex(i)}
                  className="transition-all duration-200"
                  style={{
                    width: i === currentImageIndex ? 20 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === currentImageIndex ? 'rgba(10,13,20,0.9)' : 'rgba(10,13,20,0.2)',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ─── THUMBNAIL STRIP ─── */}
        {images.length > 1 && (
          <div className="relative z-10 -mt-7 flex gap-2 px-4 pt-4 pb-1 overflow-x-auto scrollbar-hide bg-surface rounded-t-[1.75rem]">
            {images.map((img: string, i: number) => (
              <button
                key={i}
                onClick={() => setCurrentImageIndex(i)}
                className={`flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-white p-1 transition-all duration-200 ${
                  i === currentImageIndex
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                    : 'ring-1 ring-border opacity-70'
                }`}
              >
                <img src={img} alt="" className="w-full h-full object-contain" />
              </button>
            ))}
          </div>
        )}

        {/* ─── PRODUCT INFO ─── */}
        <div
          className={`relative bg-surface px-4 sm:px-5 pb-6 ${
            images.length > 1 ? 'pt-4' : hasImages ? '-mt-7 rounded-t-[1.75rem] pt-6' : 'pt-4'
          }`}
        >

          {/* Name */}
          <h1
            className="font-bold text-text leading-tight tracking-tight mb-2"
            style={{ fontSize: 21, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {getLocalizedValue(product.name, language)}
          </h1>

          {/* Rating */}
          {rating && rating.count > 0 && (
            <div className="flex items-center gap-1.5 mb-2">
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`w-3 h-3 ${i < Math.round(rating.average) ? 'text-accent fill-current' : 'text-text-tertiary'}`}
                  />
                ))}
              </div>
              <span className="text-xs text-text-secondary">
                {rating.average.toFixed(1)} · {rating.count} {language === 'ru' ? 'отзывов' : 'sharh'}
              </span>
            </div>
          )}

          {/* Price + stock row */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="font-extrabold text-text tabular tracking-tight leading-none" style={{ fontSize: 28 }}>
              {formatPrice(product.price as number)}
            </p>
            <div
              className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full ${
                product.stock > 0 ? 'bg-success-light' : 'bg-danger-light'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${product.stock > 0 ? 'bg-success' : 'bg-danger'}`} />
              <span className="text-xs font-bold text-text whitespace-nowrap">
                {product.stock > 0
                  ? (product.stock < 10
                    ? `${language === 'ru' ? 'Осталось' : 'Qoldi'}: ${product.stock}`
                    : t('in_stock'))
                  : t('out_of_stock')}
              </span>
            </div>
          </div>

          {/* Out of stock notification hint */}
          {product.stock === 0 && isFavorite && (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-info-light mb-5">
              <BellRing className="w-4 h-4 text-info flex-shrink-0" />
              <p className="text-xs font-medium text-text">
                {language === 'ru'
                  ? 'Вы будете уведомлены, когда товар появится в наличии'
                  : 'Mahsulot mavjud bo\'lganda xabar beriladi'}
              </p>
            </div>
          )}

          {/* Sale notification hint */}
          {product.stock > 0 && !isFavorite && (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-accent-subtle mb-5">
              <Heart className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-xs font-medium text-text">
                {language === 'ru'
                  ? 'Добавьте в избранное, чтобы получать уведомления о скидках'
                  : 'Chegirish haqida xabar olish uchun sevimlilarga qo\'shing'}
              </p>
            </div>
          )}

          {/* Sizes */}
          {product.sizes.length > 0 && (
            <div className="mb-5">
              <p className="eyebrow mb-2.5">
                {t('select_size')}
              </p>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size: string) => (
                  <button
                    key={size}
                    onClick={() => { setSelectedSize(size); haptic.select(); }}
                    className={`min-w-[44px] h-11 px-4 rounded-2xl text-sm font-bold border transition-all duration-150 active:scale-95 ${
                      selectedSize === size
                        ? 'bg-text text-bg border-transparent shadow-card'
                        : 'bg-surface-muted text-text border-transparent'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          {product.colors.length > 0 && (
            <div className="mb-5">
              <p className="eyebrow mb-2.5">
                {t('select_color')}
              </p>
              <div className="flex flex-wrap gap-2">
                {product.colors.map((color: { name: string; hex: string }) => (
                  <button
                    key={color.hex}
                    onClick={() => { setSelectedColor(color); haptic.select(); }}
                    className={`flex items-center gap-2 pl-2 pr-3.5 h-11 rounded-2xl text-sm font-semibold border-2 transition-all duration-150 active:scale-95 ${
                      selectedColor?.hex === color.hex
                        ? 'bg-surface text-text border-accent'
                        : 'bg-surface-muted text-text border-transparent'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color.hex, border: '1px solid rgba(28,28,28,0.12)' }}
                    />
                    {color.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="mb-6">
            <p className="eyebrow mb-2.5">
              {t('quantity')}
            </p>
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-muted">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                aria-label="−"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-surface shadow-sm transition-all duration-150 active:scale-90"
              >
                <Minus className="w-4 h-4 text-text" />
              </button>
              <span className="text-lg font-extrabold min-w-[2.5rem] text-center text-text tabular">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(product.stock || 99, quantity + 1))}
                aria-label="+"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-surface shadow-sm transition-all duration-150 active:scale-90"
              >
                <Plus className="w-4 h-4 text-text" />
              </button>
            </div>
          </div>

          {/* Description */}
          {(() => {
            const description = getLocalizedValue(product.description, language);
            const isLong = description.length > DESCRIPTION_PREVIEW;
            return (
              <div className="mb-6">
                <h2 className="eyebrow mb-2.5">
                  {t('description')}
                </h2>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                  {isLong && !descriptionExpanded
                    ? `${description.slice(0, DESCRIPTION_PREVIEW).trimEnd()}…`
                    : description}
                </p>
                {isLong && (
                  <button
                    onClick={() => setDescriptionExpanded((v) => !v)}
                    className="mt-2 text-sm font-bold text-accent"
                  >
                    {descriptionExpanded
                      ? (language === 'ru' ? 'Свернуть' : 'Yigish')
                      : (language === 'ru' ? 'Читать полностью' : "To'liq o'qish")}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Specs */}
          {product.specs && Object.keys(product.specs).length > 0 && (() => {
            const entries = Object.entries(product.specs);
            const visible = specsExpanded ? entries : entries.slice(0, SPECS_PREVIEW);
            return (
              <div className="mb-6">
                <h2 className="eyebrow mb-3">
                  {t('specifications')}
                </h2>
                <div className="rounded-2xl overflow-hidden bg-surface-muted/60 border border-border-subtle">
                  {visible.map(([key, value], i) => (
                    <div
                      key={key}
                      /*
                        Названия параметров бывают длинными («Дозирование воды по
                        степени загрузки и типу ткани»), поэтому строка тянется
                        вверх, а не сжимает значение в столбик из букв.
                      */
                      className={`flex items-start justify-between gap-4 py-3 px-4 text-sm ${
                        i > 0 ? 'border-t border-border-subtle' : ''
                      }`}
                    >
                      <span className="text-text-secondary min-w-0">{key}</span>
                      <span className="text-text font-semibold text-right shrink-0 max-w-[55%]">
                        {String(value)}
                      </span>
                    </div>
                  ))}
                </div>
                {entries.length > SPECS_PREVIEW && (
                  <button
                    onClick={() => setSpecsExpanded((v) => !v)}
                    className="mt-2 text-sm font-bold text-accent"
                  >
                    {specsExpanded
                      ? (language === 'ru' ? 'Свернуть' : 'Yigish')
                      : (language === 'ru'
                          ? `Все характеристики (${entries.length})`
                          : `Barcha xususiyatlar (${entries.length})`)}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Reviews */}
          <div className="mb-2">
            <h2 className="eyebrow mb-3">
              {language === 'ru' ? 'Отзывы' : 'Sharhlar'} ({reviews.length})
            </h2>
            {reviews.length > 0 ? (
              <div className="space-y-3">
                {reviews.slice(0, 5).map((review) => {
                  const photos = review.photos?.length ? review.photos : review.images ?? [];
                  return (
                    <div
                      key={review.id}
                      className="rounded-2xl p-4 bg-surface-muted/60 border border-border-subtle"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-text">{review.user_name}</span>
                          {review.is_verified_purchase && (
                            <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-success-light text-success">
                              {language === 'ru' ? 'Покупка ✓' : 'Sotib olgan ✓'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <Star
                              key={i}
                              className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${i <= review.rating ? 'text-yellow-500 fill-yellow-500' : 'text-text-tertiary'}`}
                            />
                          ))}
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-text-secondary leading-relaxed">{review.comment}</p>
                      )}
                      {photos.length > 0 && (
                        <div className="flex gap-2 mt-3 overflow-x-auto">
                          {photos.map((photo: string, i: number) => (
                            <button key={i} onClick={() => setLightboxUrl(photo)} className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden bg-surface-inset dark:bg-surface-elevated group relative">
                              <img src={photo} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <ZoomIn className="w-4 h-4 text-text-inverse" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {review.admin_reply && (
                        <div className="mt-3 p-3 rounded-xl bg-surface border-l-2 border-accent">
                          <p className="text-xs font-semibold text-text-tertiary mb-1">
                            {language === 'ru' ? 'Ответ магазина' : "Do'kon javobi"}
                          </p>
                          <p className="text-sm text-text">{review.admin_reply}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : !reviewSubmitted ? (
              <p className="text-sm text-text-tertiary mb-3">
                {language === 'ru' ? 'Пока нет отзывов. Будьте первым!' : "Hali sharhlar yo'q. Birinchi bo'ling!"}
              </p>
            ) : null}

            {/* Review Success */}
            {reviewSubmitted && (
              <div className="rounded-2xl p-4 bg-success-light mb-3">
                <p className="text-sm text-text font-medium">
                  {language === 'ru' ? 'Отзыв отправлен! После проверки модератором он появится на странице.' : "Sharh yuborildi! Moderator tekshirgandan keyin sahifada paydo bo'ladi."}
                </p>
              </div>
            )}

            {/* Write Review Button */}
            {!showReviewForm && !reviewSubmitted && (
              <button
                onClick={() => setShowReviewForm(true)}
                className="btn-ghost w-full flex items-center justify-center gap-2 h-12 rounded-2xl text-sm"
              >
                <MessageSquare className="w-4 h-4" />
                {language === 'ru' ? 'Оставить отзыв' : 'Sharh qoldirish'}
              </button>
            )}

            {/* Review Form */}
            {showReviewForm && (
              <div className="rounded-2xl p-4 bg-surface-muted/60 border border-border-subtle mt-3">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-text">
                    {language === 'ru' ? 'Ваш отзыв' : 'Sizning sharhingiz'}
                  </h3>
                  <button
                    onClick={() => setShowReviewForm(false)}
                    className="text-text-tertiary hover:text-surface-700 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Star Rating */}
                <div className="mb-4">
                  <p className="text-xs font-medium text-text-secondary mb-2">
                    {language === 'ru' ? 'Оценка' : 'Baho'}
                  </p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setReviewRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        className="p-0.5 transition-transform active:scale-110"
                      >
                        <Star
                          className={`w-6 h-6 sm:w-7 sm:h-7 ${
                            star <= (hoverRating || reviewRating)
                              ? 'text-yellow-500 fill-yellow-500'
                              : 'text-text-tertiary'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="text-xs text-text-tertiary ml-2">
                      {reviewRating}/5
                    </span>
                  </div>
                </div>

                {/* Name */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {language === 'ru' ? 'Ваше имя' : 'Ismingiz'}
                  </label>
                  <input
                    value={reviewName}
                    onChange={(e) => setReviewName(e.target.value)}
                    placeholder={language === 'ru' ? 'Как вас зовут?' : 'Ismingiz?'}
                    className="input-premium !bg-surface"
                  />
                </div>

                {/* Comment */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {language === 'ru' ? 'Комментарий' : 'Izoh'}
                  </label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder={language === 'ru' ? 'Расскажите о качестве, размере, материале...' : 'Sifat, o\'lcham, material haqida gapiring...'}
                    rows={3}
                    className="input-premium !bg-surface resize-none"
                  />
                </div>

                {/* Photo Upload */}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {language === 'ru' ? 'Фото (необязательно)' : 'Fotos (ixtiyoriy)'}
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {reviewPhotos.map((photo, i) => (
                      <div key={i} className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden bg-surface-muted flex-shrink-0">
                        <img src={photo.url} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemoveReviewPhoto(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center"
                        >
                          <X className="w-3 h-3 text-text-inverse" />
                        </button>
                      </div>
                    ))}
                    {reviewPhotos.length < 5 && (
                      <button
                        onClick={() => reviewPhotoInput.current?.click()}
                        disabled={reviewUploading}
                        className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-text-tertiary hover:border-border transition-colors"
                      >
                        {reviewUploading ? (
                          <span className="w-4 h-4 border-2 border-border border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <Camera className="w-4 h-4" />
                            <span className="text-[9px] mt-0.5">+</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <input
                    ref={reviewPhotoInput}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleReviewPhotoUpload}
                    className="hidden"
                  />
                  <p className="text-[10px] text-text-tertiary mt-1">
                    {language === 'ru' ? 'Максимум 5 фото' : 'Maksimum 5 ta rasm'}
                  </p>
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmitReview}
                  disabled={!reviewName.trim() || reviewSubmitting}
                  className="btn-brand w-full flex items-center justify-center gap-2 h-12 rounded-2xl text-sm"
                >
                  {reviewSubmitting ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {language === 'ru' ? 'Отправить отзыв' : 'Sharhni yuborish'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── FIXED BOTTOM BAR ─── */}
      <div
        ref={bottomBarRef}
        className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-[color:var(--glass-border)] pb-safe hide-when-keyboard"
        style={{ willChange: 'transform' }}
      >
        <div className="flex items-center gap-2 sm:gap-3 px-4 py-3">

          {/* Wishlist + Notifications */}
          <WishlistToggle
            productId={product.id}
            isFavorite={isFavorite}
            onToggleFavorite={handleToggleFavorite}
            language={language}
            variant="detail"
          />

          {/* Share */}
          <button
            onClick={handleShare}
            aria-label={language === 'ru' ? 'Поделиться' : 'Ulashish'}
            className="card-premium w-12 h-12 flex items-center justify-center flex-shrink-0 transition-all duration-150 active:scale-95"
          >
            <Share2 className="w-4 h-4 sm:w-5 sm:h-5 text-text-secondary" />
          </button>

          {/* Add to Cart — primary CTA */}
          <button
            onClick={handleAddToCart}
            disabled={product.stock === 0}
            className={`flex-1 h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed ${
              product.stock === 0
                // text-text-inverse here meant white on #F0F0F0 in the light
                // theme — 1.1:1, so the label was simply not there.
                ? 'bg-surface-muted text-text-secondary'
                : 'btn-brand'
            }`}
          >
            <ShoppingCart className="w-5 h-5" />
            <span>{product.stock === 0 ? t('out_of_stock') : t('add_to_cart')}</span>
          </button>
        </div>
      </div>
    </Layout>

      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-lg sm:rounded-xl object-contain" />
          <button onClick={() => setLightboxUrl(null)} className="absolute top-3 right-3 sm:top-4 sm:right-4 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/10 flex items-center justify-center text-text-inverse hover:bg-white/20 transition">
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      )}

      <ShareCard
        isOpen={showShareCard}
        onClose={() => setShowShareCard(false)}
        product={{
          slug: product?.slug || '',
          name: product?.name || '',
          price: product?.price || 0,
          description: product?.description,
          images: product?.images || [],
        }}
        language={language}
      />
    </>
  );
};
