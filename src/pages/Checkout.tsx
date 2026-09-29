import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, CreditCard, Truck, Zap, Tag, MapPin, User, FileText, ShoppingBag, Lock, ChevronRight } from 'lucide-react';
import { Layout } from '../components/Layout';
import { MapPicker } from '../components/MapPicker';
import { CouponInput } from '../components/CouponInput';
import { useTranslation } from '../hooks/useTranslation';
import { useCartStore, cartItemKey } from '../store/useCartStore';
import { useAppStore } from '../store/useAppStore';
import { useCreatePayment, useDeliveryZones, useUserProfile, useUpdateProfile } from '../lib/supabase/hooks';
import { formatPrice, getLocalizedValue, validatePhone } from '../lib/utils';
import { haptic, tg, refreshTg } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { toast } from '../components/Toast';
import type { DeliveryZone } from '../lib/supabase/queries';
import { ProductImage } from '../components/ProductImage';

export const Checkout = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { items, getTotalPrice, clearCart } = useCartStore();
  const setTelegramUserId = useAppStore((state) => state.setTelegramUserId);

  const user = tg?.initDataUnsafe?.user;
  const userId = useUserId();

  useEffect(() => {
    if (user?.id) {
      setTelegramUserId(user.id);
    }
  }, [user?.id, setTelegramUserId]);

  const createPaymentMutation = useCreatePayment();
  const { data: deliveryZones = [], isLoading: zonesLoading } = useDeliveryZones(true);
  const { data: userProfile } = useUserProfile(userId);
  const updateProfileMutation = useUpdateProfile();

  const [step, setStep] = useState<'info' | 'delivery' | 'payment'>('info');
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    zoneId: '',
    address: '',
    deliveryType: 'standard' as 'standard' | 'express',
    paymentMethod: 'cash' as 'payme' | 'click' | 'uzum' | 'cash',
    notes: '',
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [orderPlaced, setOrderPlaced] = useState(false);
  const submittingRef = useRef(false);
  /*
   * Set synchronously right before the cart is cleared. clearCart() goes
   * through zustand's external store, which React re-renders synchronously —
   * ahead of the pending setOrderPlaced(true). The redirect effect below then
   * saw an empty cart with orderPlaced still false and sent the buyer back to
   * /cart, so the "order placed" screen never appeared. A ref has no such lag.
   */
  const orderPlacedRef = useRef(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ id: string; code: string; discount: number } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);

  useEffect(() => {
    if (items.length === 0 && !orderPlaced && !orderPlacedRef.current) {
      navigate('/cart');
    }
  }, [items.length, orderPlaced, navigate]);

  useEffect(() => {
    if (userProfile && !profileLoaded) {
      setProfileLoaded(true);
      setFormData((prev) => ({
        ...prev,
        fullName: prev.fullName || userProfile.first_name || '',
        phone: prev.phone || userProfile.phone || '',
        address: prev.address || userProfile.address || '',
        latitude: prev.latitude ?? userProfile.latitude ?? null,
        longitude: prev.longitude ?? userProfile.longitude ?? null,
      }));
    }
  }, [userProfile, profileLoaded]);

  const selectedZone: DeliveryZone | undefined = useMemo(() => {
    if (!formData.zoneId && deliveryZones.length > 0) return deliveryZones[0];
    return deliveryZones.find((z) => z.id === formData.zoneId) ?? deliveryZones[0];
  }, [formData.zoneId, deliveryZones]);

  const subtotal = getTotalPrice();

  const deliveryCost = useMemo(() => {
    if (!selectedZone) return 20000;
    const price = formData.deliveryType === 'express'
      ? selectedZone.express_price
      : selectedZone.standard_price;
    if (
      formData.deliveryType === 'standard' &&
      selectedZone.free_threshold &&
      selectedZone.free_threshold > 0 &&
      subtotal >= selectedZone.free_threshold
    ) {
      return 0;
    }
    return price;
  }, [selectedZone, formData.deliveryType, subtotal]);

  const totalAmount = Math.max(0, subtotal + deliveryCost - (appliedCoupon?.discount || 0));
  const isFree = deliveryCost === 0 && formData.deliveryType === 'standard';

  const cityLabel = (zone: DeliveryZone) =>
    language === 'uz' ? zone.city_uz : zone.city_ru;

  const daysLabel = (min: number, max: number) =>
    `${min}${min !== max ? `–${max}` : ''} ${language === 'ru' ? (max === 1 ? 'день' : 'дн.') : 'kun'}`;

  const validateForm = (): string | null => {
    if (formData.fullName.trim().length < 2) {
      return language === 'ru' ? 'Введите ваше имя' : 'Ismingizni kiriting';
    }
    if (!validatePhone(formData.phone)) {
      return language === 'ru' ? 'Введите корректный номер телефона' : "To'g'ri telefon raqam kiriting";
    }
    if (formData.address.trim().length < 5) {
      return language === 'ru' ? 'Введите адрес доставки' : "Manzilni kiriting";
    }
    return null;
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      submittingRef.current = false;
      return;
    }

    setLoading(true);
    haptic.pay();

    try {
      refreshTg();
      const freshUser = tg?.initDataUnsafe?.user;
      const finalUserId = freshUser?.id || userId;
      if (!finalUserId) {
        toast.error(language === 'ru' ? 'Пожалуйста, зарегистрируйтесь' : "Iltimos, ro'yxatdan o'ting");
        setLoading(false);
        submittingRef.current = false;
        return;
      }
      if (freshUser?.id) {
        setTelegramUserId(freshUser.id);
      }

      const city = selectedZone
        ? (language === 'uz' ? selectedZone.city_uz : selectedZone.city_ru)
        : '';

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({
          telegram_user_id: finalUserId,
          init_data: tg?.initData || undefined,
          items: items.map((item) => ({
            productId: item.productId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            size: item.size,
            color: item.color?.name,
            image: item.image,
          })),
          total_amount: totalAmount,
          customer_info: {
            name: formData.fullName,
            phone: formData.phone,
            city,
            address: formData.address,
            zone_id: selectedZone?.id,
            region: selectedZone
              ? (language === 'uz' ? selectedZone.region_uz : selectedZone.region_ru)
              : '',
            latitude: formData.latitude,
            longitude: formData.longitude,
          },
          delivery_type: formData.deliveryType,
          delivery_cost: deliveryCost,
          payment_method: formData.paymentMethod,
          notes: formData.notes,
          coupon_id: appliedCoupon?.id || undefined,
          discount_amount: appliedCoupon?.discount || 0,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create order');
      }

      const { order } = await response.json();
      setOrderId(order.id);

      if (formData.paymentMethod !== 'cash') {
        try {
          const paymentData = await createPaymentMutation.mutateAsync({
            orderId: order.id,
            amount: totalAmount,
            paymentMethod: formData.paymentMethod,
          });
          if (paymentData.paymentUrl) {
            localStorage.setItem('pending_order_id', order.id);
            orderPlacedRef.current = true;
            setOrderPlaced(true);
            clearCart();
            window.location.href = paymentData.paymentUrl;
            return;
          }
        } catch (paymentError) {
          console.error('Payment error:', paymentError);
          toast.error(language === 'ru' ? 'Ошибка создания платежа. Оплатите при получении.' : "To'lov yaratishda xatolik. Yetkazishda to'lang.");
        }
      }

      orderPlacedRef.current = true;
      setOrderPlaced(true);
      clearCart();
      haptic.success();
      toast.success(t('order_success'));

      if (finalUserId) {
        updateProfileMutation.mutate({
          telegramId: finalUserId,
          updates: {
            first_name: formData.fullName,
            phone: formData.phone,
            address: formData.address,
            latitude: formData.latitude,
            longitude: formData.longitude,
          },
        });
      }
    } catch (error) {
      console.error('Error placing order:', error);
      haptic.error();
      toast.error(error instanceof Error ? error.message : t('error'));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  if (items.length === 0 && !orderPlaced && !orderPlacedRef.current) return null;

  if (orderPlaced || orderPlacedRef.current) {
    return (
      <Layout showBottomNav={false}>
        <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 py-16">
          <div className="relative mb-7 animate-bounce-in">
            <div className="absolute inset-0 rounded-full bg-success/30 blur-2xl scale-125" />
            <div className="relative w-24 h-24 rounded-full bg-success-light ring-1 ring-success/30 flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-success" strokeWidth={2.2} />
            </div>
          </div>
          <h2 className="font-display text-2xl font-semibold text-text mb-3 text-center">
            {language === 'ru' ? 'Заказ оформлен!' : "Buyurtma berildi!"}
          </h2>
          <p className="text-sm text-text-secondary mb-1 text-center">
            {language === 'ru' ? 'Номер заказа' : 'Buyurtma raqami'}
          </p>
          <p className="text-lg font-bold text-text font-mono mb-3 px-4 py-1.5 rounded-full bg-surface border border-border-subtle">
            #{orderId.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-sm text-text-tertiary text-center mb-8 max-w-[260px]">
            {language === 'ru'
              ? 'Мы свяжемся с вами в ближайшее время для подтверждения'
              : "Tez orada tasdiqlash uchun siz bilan bog'lanamiz"}
          </p>
          <div className="w-full max-w-xs space-y-3">
            <button
              onClick={() => navigate('/orders')}
              className="w-full py-3.5 rounded-2xl btn-brand text-sm font-semibold flex items-center justify-center gap-2"
            >
              <ShoppingBag className="w-4 h-4" />
              {language === 'ru' ? 'Мои заказы' : 'Buyurtmalarim'}
            </button>
            <button
              onClick={() => navigate('/catalog')}
              className="w-full py-3.5 rounded-2xl btn-brand-outline text-sm"
            >
              {language === 'ru' ? 'Продолжить покупки' : "Xaridni davom ettirish"}
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showBottomNav={false}>
      <div className="min-h-screen bg-bg pb-28">
        {/* Header */}
        <div className="sticky top-14 z-30 glass border-b border-[color:var(--glass-border)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => {
                if (step === 'payment') setStep('delivery');
                else if (step === 'delivery') setStep('info');
                else navigate('/cart');
              }}
              aria-label={language === 'ru' ? 'Назад' : 'Orqaga'}
              className="w-10 h-10 rounded-full bg-surface border border-border-subtle shadow-sm flex items-center justify-center active:scale-90 transition"
            >
              <ArrowLeft className="w-4 h-4 text-text" />
            </button>
            <div className="flex-1">
              <h1 className="font-display text-base font-semibold text-text">
                {t('checkout')}
              </h1>
              <p className="text-xs text-text-tertiary">
                {step === 'info' ? (language === 'ru' ? 'Данные покупателя' : "Xaridor ma'lumotlari")
                  : step === 'delivery' ? (language === 'ru' ? 'Доставка' : 'Yetkazib berish')
                  : (language === 'ru' ? 'Оплата' : "To'lov")}
              </p>
            </div>
          </div>
          {/* Progress */}
          <div className="flex px-4 pb-3 gap-1.5">
            {['info', 'delivery', 'payment'].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  (s === 'info' && step === 'info') ||
                  (s === 'delivery' && (step === 'delivery' || step === 'payment')) ||
                  (s === 'payment' && step === 'payment')
                    ? 'bg-accent'
                    : 'bg-surface-inset dark:bg-surface-muted'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="px-4 pt-4">
          {/* Step 1: Customer Info */}
          {step === 'info' && (
            <div className="space-y-4 animate-fade-in">
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-4">
                  <User className="w-4 h-4 text-text-tertiary" />
                  {language === 'ru' ? 'Контакты' : "Aloqa"}
                </h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      {t('full_name')} *
                    </label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      placeholder={language === 'ru' ? 'Иван Иванов' : 'Ism Familiya'}
                      className="input-premium w-full px-3.5 py-3 text-sm transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      {t('phone')} *
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+998 90 123 45 67"
                      className="input-premium w-full px-3.5 py-3 text-sm transition"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
                    toast.error(language === 'ru' ? 'Введите ваше имя' : 'Ismingizni kiriting');
                    return;
                  }
                  const phoneClean = formData.phone.replace(/[\s\-()]/g, '');
                  if (!/^\+?[0-9]{9,13}$/.test(phoneClean)) {
                    toast.error(language === 'ru' ? 'Введите корректный номер телефона' : "To'g'ri telefon raqam kiriting");
                    return;
                  }
                  setStep('delivery');
                }}
                className="w-full py-3.5 rounded-2xl btn-brand active:scale-[0.98] text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                {language === 'ru' ? 'Далее' : 'Keyingi'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 2: Delivery */}
          {step === 'delivery' && (
            <div className="space-y-4 animate-fade-in">
              {/* Address */}
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-4">
                  <MapPin className="w-4 h-4 text-text-tertiary" />
                  {language === 'ru' ? 'Адрес доставки' : 'Yetkazish manzili'}
                </h2>

                {/* City */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {language === 'ru' ? 'Город' : 'Shahar'} *
                  </label>
                  {zonesLoading ? (
                    <div className="h-11 bg-surface-muted rounded-xl animate-pulse" />
                  ) : (
                    <select
                      value={formData.zoneId || (deliveryZones[0]?.id ?? '')}
                      onChange={(e) => setFormData({ ...formData, zoneId: e.target.value })}
                      className="input-premium w-full px-3.5 py-3 text-sm transition"
                    >
                      {deliveryZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {cityLabel(zone)} — {language === 'uz' ? zone.region_uz : zone.region_ru}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Address */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {t('address')} *
                  </label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={language === 'ru' ? 'Улица, дом, квартира, подъезд' : "Ko'cha, uy, xonadon, kirish"}
                    rows={2}
                    className="input-premium w-full px-3.5 py-3 text-sm transition resize-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMapPicker(true)}
                    className="mt-2 flex items-center gap-2 px-3.5 h-9 rounded-full bg-accent/10 text-accent text-xs font-bold transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    {language === 'ru' ? 'Выбрать адрес на карте' : "Xaritada manzilni tanlash"}
                  </button>
                  {formData.latitude && formData.longitude && (
                    <p className="text-[10px] text-text-tertiary mt-1">
                      📍 {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {language === 'ru' ? 'Комментарий к заказу' : "Buyurtma izohi"}
                  </label>
                  <input
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={language === 'ru' ? 'Пожелания по доставке (необязательно)' : "Yetkazish istaklari (ixtiyoriy)"}
                    className="input-premium w-full px-3.5 py-3 text-sm transition"
                  />
                </div>
              </div>

              {/* Free shipping notice */}
              {selectedZone?.free_threshold && selectedZone.free_threshold > 0 && (
                <div className={`flex items-center gap-2 text-xs rounded-xl px-3.5 py-2.5 ${
                  subtotal >= selectedZone.free_threshold
                    ? 'bg-success-light text-success font-semibold'
                    : 'bg-surface-muted text-text-secondary'
                }`}>
                  <Tag className="w-3.5 h-3.5 flex-shrink-0" />
                  {subtotal >= selectedZone.free_threshold
                    ? (language === 'ru' ? 'Бесплатная доставка!' : 'Bepul yetkazib berish!')
                    : (language === 'ru'
                      ? `Бесплатно от ${formatPrice(selectedZone.free_threshold)} (+${formatPrice(selectedZone.free_threshold - subtotal)})`
                      : `${formatPrice(selectedZone.free_threshold)} dan bepul (+${formatPrice(selectedZone.free_threshold - subtotal)})`)}
                </div>
              )}

              {/* Delivery Type */}
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-3">
                  <Truck className="w-4 h-4 text-text-tertiary" />
                  {language === 'ru' ? 'Способ доставки' : 'Yetkazish usuli'}
                </h2>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, deliveryType: 'standard' })}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                      formData.deliveryType === 'standard'
                        ? 'border-accent bg-accent/5 ring-1 ring-accent'
                        : 'border-border hover:bg-surface-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        formData.deliveryType === 'standard' ? 'bg-accent text-text-inverse' : 'bg-surface-muted text-text-secondary'
                      }`}>
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-text">{t('delivery_standard')}</p>
                        <p className="text-xs text-text-tertiary">
                          {selectedZone
                            ? daysLabel(selectedZone.standard_days_min, selectedZone.standard_days_max)
                            : '3–5 дн.'}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-text">
                      {isFree ? (language === 'ru' ? 'Бесплатно' : 'Bepul') : (selectedZone ? formatPrice(selectedZone.standard_price) : formatPrice(20000))}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, deliveryType: 'express' })}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                      formData.deliveryType === 'express'
                        ? 'border-accent bg-accent/5 ring-1 ring-accent'
                        : 'border-border hover:bg-surface-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        formData.deliveryType === 'express' ? 'bg-accent text-text-inverse' : 'bg-surface-muted text-text-secondary'
                      }`}>
                        <Zap className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-text">{t('delivery_express')}</p>
                        <p className="text-xs text-text-tertiary">
                          {selectedZone
                            ? daysLabel(selectedZone.express_days_min, selectedZone.express_days_max)
                            : '1–2 дн.'}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-text">
                      {selectedZone ? formatPrice(selectedZone.express_price) : formatPrice(50000)}
                    </span>
                  </button>
                </div>
              </div>

              {/* Coupon */}
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-3">
                  <Tag className="w-4 h-4 text-text-tertiary" />
                  {language === 'ru' ? 'Промокод' : 'Promo kod'}
                </h2>
                <CouponInput
                  telegramUserId={userId || 0}
                  orderAmount={subtotal + deliveryCost}
                  onApply={(couponId, discount, code) => {
                    setAppliedCoupon({ id: couponId, code, discount });
                    toast.success(language === 'ru' ? 'Купон применён' : "Kupon qo'llanildi");
                  }}
                  onRemove={() => {
                    setAppliedCoupon(null);
                    toast.success(language === 'ru' ? 'Купон убран' : "Kupon o'chirildi");
                  }}
                  appliedCoupon={appliedCoupon ? { code: appliedCoupon.code, discount: appliedCoupon.discount } : null}
                  language={language}
                />
              </div>

              <button
                onClick={() => {
                  if (formData.address.trim().length < 5) {
                    toast.error(language === 'ru' ? 'Введите адрес доставки' : "Manzilni kiriting");
                    return;
                  }
                  setStep('payment');
                }}
                className="w-full py-3.5 rounded-2xl btn-brand active:scale-[0.98] text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                {language === 'ru' ? 'Далее' : 'Keyingi'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 3: Payment */}
          {step === 'payment' && (
            <div className="space-y-4 animate-fade-in">
              {/* Payment Methods */}
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text mb-3">
                  <CreditCard className="w-4 h-4 text-text-tertiary" />
                  {t('payment_method')}
                </h2>
                <div className="space-y-2">
                  {[
                    { id: 'payme', label: 'Payme', desc: language === 'ru' ? 'Онлайн-оплата' : "Online to'lov", disabled: true },
                    { id: 'click', label: 'Click', desc: language === 'ru' ? 'Онлайн-оплата' : "Online to'lov", disabled: true },
                    { id: 'uzum', label: 'Uzum Bank', desc: language === 'ru' ? 'Онлайн-оплата' : "Online to'lov", disabled: true },
                    { id: 'cash', label: t('payment_cash'), desc: language === 'ru' ? 'При получении' : 'Yetkazishda', disabled: false },
                  ].map(({ id, label, desc, disabled }) => (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && setFormData({ ...formData, paymentMethod: id as typeof formData.paymentMethod })}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                        disabled
                          ? 'opacity-50 cursor-not-allowed border-border bg-surface-muted/30'
                          : formData.paymentMethod === id
                            ? 'border-accent bg-accent/5 ring-1 ring-accent'
                            : 'border-border hover:bg-surface-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          !disabled
                            ? formData.paymentMethod === id ? 'bg-accent text-text-inverse' : 'bg-surface-muted text-text-secondary'
                            : 'bg-surface-muted text-text-tertiary'
                        }`}>
                          {id === 'cash' ? <FileText className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-text">{label}</p>
                          <p className="text-xs text-text-tertiary">
                            {disabled
                              ? (language === 'ru' ? 'Скоро будет доступно' : "Tezda mavjud bo'ladi")
                              : desc}
                          </p>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        !disabled && formData.paymentMethod === id
                          ? 'border-accent bg-accent'
                          : 'border-border dark:border-border'
                      }`}>
                        {!disabled && formData.paymentMethod === id && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Order Summary */}
              <div className="card-premium p-4 border-border-subtle">
                <h2 className="text-sm font-semibold text-text mb-3">
                  {language === 'ru' ? 'Итого' : 'Jami'}
                </h2>
                <div className="space-y-2 mb-3">
                  {/* Items */}
                  {items.map((item) => (
                    <div key={cartItemKey(item.productId, item.size, item.color?.hex)} className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-lg bg-surface-muted overflow-hidden flex-shrink-0">
                        {item.image && (
                          <ProductImage
                            src={item.image}
                            alt={getLocalizedValue(item.name, language)}
                            className="w-full h-full object-cover"
                            showSkeleton={false}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text truncate">
                          {getLocalizedValue(item.name, language)}
                        </p>
                        <p className="text-[10px] text-text-tertiary">
                          {item.quantity} × {formatPrice(item.price)}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-text">
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border-subtle pt-3 space-y-2">
                  <div className="flex justify-between text-xs text-text-secondary">
                    <span>{language === 'ru' ? 'Товары' : 'Mahsulotlar'}</span>
                    <span className="font-medium text-text">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-text-secondary">
                    <span>{language === 'ru' ? 'Доставка' : 'Yetkazish'}</span>
                    <span className="font-medium text-text">
                      {isFree ? (language === 'ru' ? 'Бесплатно' : 'Bepul') : formatPrice(deliveryCost)}
                    </span>
                  </div>
                  {appliedCoupon && appliedCoupon.discount > 0 && (
                    <div className="flex justify-between text-xs text-green-600 dark:text-green-400">
                      <span>{language === 'ru' ? 'Скидка' : "Chegirma"} ({appliedCoupon.code})</span>
                      <span className="font-medium">-{formatPrice(appliedCoupon.discount)}</span>
                    </div>
                  )}
                  <div className="border-t border-border-subtle pt-2 flex justify-between">
                    <span className="text-sm font-bold text-text">{t('total')}</span>
                    <span className="text-lg font-extrabold text-text">{formatPrice(totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full py-3.5 sm:py-4 rounded-2xl btn-brand disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{t('loading')}</span>
                  </>
                ) : (
                  <>
                    {formData.paymentMethod === 'cash' ? (
                      <ShoppingBag className="w-4 h-4" />
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                    <span className="truncate">
                      {formData.paymentMethod === 'cash'
                        ? t('place_order')
                        : (language === 'ru' ? 'Оплатить' : "To'lash")}
                      {' '}— {formatPrice(totalAmount)}
                    </span>
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-1.5 pb-4 pb-safe">
                <Lock className="w-3 h-3 text-text-tertiary" />
                <span className="text-[10px] text-text-tertiary">
                  {language === 'ru' ? 'Безопасная оплата' : "Xavfsiz to'lov"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <MapPicker
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng, addr) => {
          setFormData((prev) => ({ ...prev, latitude: lat, longitude: lng, address: addr || prev.address }));
        }}
        initialLat={formData.latitude}
        initialLng={formData.longitude}
      />
    </Layout>
  );
};
