import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, ChevronDown, ChevronRight,
  Package, Pencil, X, Phone, MapPin, Clock,
  Languages, Info, HelpCircle, MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { useTranslation } from '../hooks/useTranslation';
import { getTelegramUser } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { useOrders, useUserProfile, useUpdateProfile, useUserReturns } from '../lib/supabase/hooks';
import { formatPrice } from '../lib/utils';
import { toast } from '../components/Toast';
import { getStatusLabel, getStatusColor } from '../lib/orderStatuses';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

export const Profile = () => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const user = getTelegramUser();
  const userId = useUserId();

  const { data: orders = [], isLoading: ordersLoading } = useOrders(userId);
  const { data: userProfile } = useUserProfile(userId);
  const { data: returns = [] } = useUserReturns(userId);
  const updateProfileMutation = useUpdateProfile();

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const [profileData, setProfileData] = useState({
    name: '',
    username: user?.username ?? '',
    phone: '',
    address: '',
  });

  useEffect(() => {
    setProfileData((prev) => ({
      ...prev,
      name: userProfile?.first_name || user?.first_name || prev.name,
      phone: userProfile?.phone || prev.phone,
      address: userProfile?.address || prev.address,
    }));
  }, [userProfile, user?.first_name]);

  const handleSaveProfile = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await updateProfileMutation.mutateAsync({
        telegramId: userId,
        updates: {
          first_name: profileData.name,
          phone: profileData.phone,
          address: profileData.address,
        },
      });
      setEditMode(false);
      toast.success(language === 'ru' ? 'Профиль сохранён' : 'Profil saqlandi');
    } catch {
      toast.error(language === 'ru' ? 'Ошибка сохранения' : 'Saqlashda xatolik');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="px-4 py-4 space-y-4 pb-24">
        <div className="card-premium overflow-hidden">
          <div className="relative gradient-stage px-5 pt-5 pb-12 overflow-hidden">
            <div className="pointer-events-none absolute -right-12 -top-12 w-44 h-44 rounded-full bg-accent/50 blur-3xl" />
            <div className="relative flex items-start justify-between">
              <div className="w-16 h-16 rounded-[1.25rem] gradient-brand ring-1 ring-white/25 shadow-accent flex items-center justify-center">
                <User className="w-8 h-8 text-white" />
              </div>
              <button
                onClick={() => setEditMode(!editMode)}
                aria-label={editMode ? t('cancel') : 'Edit'}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 ring-1 ring-white/15 backdrop-blur text-white transition active:scale-90"
              >
                {editMode ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative mt-4">
              <h2 className="font-display text-xl font-semibold text-white">
                {profileData.name || user?.first_name || (language === 'ru' ? 'Гость' : 'Mehmon')}
              </h2>
              {/*
                Ник белый, а не text-text-tertiary.

                Шапка залита брендовым синим, а text-tertiary — серый #6E6E6E:
                на левом крае градиента (#226CE0), где ник и стоит, это контраст
                1.04:1 — текст физически неразличим. Белый даёт 4.9:1, норму для
                мелкого текста. Иерархия остаётся за размером и насыщенностью:
                имя крупное и жирное, ник мелкий и обычный.
              */}
              {(profileData.username || user?.username) && (
                <p className="text-white/80 text-sm font-medium mt-1">@{profileData.username || user?.username}</p>
              )}
            </div>
          </div>

          <div className="-mt-7 mx-3 px-2 py-3 grid grid-cols-3 text-center divide-x divide-border-subtle relative z-10 rounded-[1.25rem] bg-surface-elevated border border-border-subtle shadow-lit">
            <div>
              <p className="text-xl font-extrabold text-text tabular">{orders.filter((o: { status?: string }) => o.status !== 'delivered').length}</p>
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mt-0.5">{language === 'ru' ? 'Заказов' : 'Buyurtma'}</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-text tabular">
                {orders.filter((o: { status?: string }) => o.status === 'delivered').length}
              </p>
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mt-0.5">{language === 'ru' ? 'Доставлено' : 'Yetkazildi'}</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-text tabular">
                {orders.filter((o: { status?: string }) => !['delivered', 'cancelled', 'returned'].includes(o.status ?? '')).length}
              </p>
              <p className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary mt-0.5">{language === 'ru' ? 'В пути' : 'Yo\'lda'}</p>
            </div>
          </div>

          {editMode && (
            <div className="px-4 pt-5 pb-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-text-secondary mb-1 block">
                  {language === 'ru' ? 'Имя' : 'Ism'}
                </label>
                <input
                  value={profileData.name}
                  onChange={(e) => setProfileData((p) => ({ ...p, name: e.target.value }))}
                  className="input-premium w-full px-3 py-2.5 text-sm"
                  placeholder={language === 'ru' ? 'Ваше имя' : 'Ismingiz'}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {language === 'ru' ? 'Телефон' : 'Telefon'}
                </label>
                <input
                  value={profileData.phone}
                  onChange={(e) => setProfileData((p) => ({ ...p, phone: e.target.value }))}
                  className="input-premium w-full px-3 py-2.5 text-sm"
                  placeholder="+998 __ ___ __ __"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {language === 'ru' ? 'Адрес' : 'Manzil'}
                </label>
                <input
                  value={profileData.address}
                  onChange={(e) => setProfileData((p) => ({ ...p, address: e.target.value }))}
                  className="input-premium w-full px-3 py-2.5 text-sm"
                  placeholder={language === 'ru' ? 'Город, улица' : "Shahar, ko'cha"}
                />
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="w-full btn-brand disabled:bg-accent-muted py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
              >
                {saving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {t('save_profile')}
              </button>
            </div>
          )}
        </div>

        <div className="card-premium overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
            <h3 className="font-extrabold text-text flex items-center gap-2">
              <Package className="w-4 h-4 text-text" />
              {t('my_orders')}
            </h3>
            <span className="text-xs bg-surface-muted text-text dark:text-text-secondary font-semibold px-2 py-0.5 rounded-full">
              {orders.length}
            </span>
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="w-6 h-6 border-[3px] border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.filter((o: { status?: string }) => o.status !== 'delivered').length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-10 h-10 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">{t('no_orders')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {orders.filter((o: { status?: string }) => o.status !== 'delivered').map((order: { id: string; status?: string; total_amount: number | string; delivery_cost: number | string; created_at: string; status_history: Array<{ status: string; changed_at: string }>; customer_info: unknown; items: unknown[] }) => {
                const expanded = expandedOrderId === order.id;
                const historyOpen = showHistory === order.id;
                const info = order.customer_info as { name?: string; phone?: string; city?: string };
                const history = Array.isArray(order.status_history) ? order.status_history : [];

                return (
                  <div key={order.id}>
                    <button
                      onClick={() => setExpandedOrderId(expanded ? null : order.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-muted/30 transition text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-text text-sm">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="font-bold text-text text-sm whitespace-nowrap">
                            {formatPrice(Number(order.total_amount))}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getStatusColor(order.status ?? 'new')}`}>
                            {getStatusLabel(order.status ?? 'new', language)}
                          </span>
                          <span className="text-xs text-text-tertiary flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(order.created_at)}
                          </span>
                        </div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-text-tertiary flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>

                    {expanded && (
                      <div className="bg-bg dark:bg-surface-muted/20 px-4 py-3 space-y-3 border-t border-border-subtle">
                        {info && (info.name || info.phone || info.city) && (
                          <div className="space-y-1.5">
                            {info.name && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">{language === 'ru' ? 'Получатель' : 'Qabul qiluvchi'}</span>
                                <span className="font-medium text-text">{info.name}</span>
                              </div>
                            )}
                            {info.phone && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">{language === 'ru' ? 'Телефон' : 'Telefon'}</span>
                                <span className="font-medium text-text">{info.phone}</span>
                              </div>
                            )}
                            {info.city && (
                              <div className="flex justify-between text-sm">
                                <span className="text-text-secondary">{language === 'ru' ? 'Город' : 'Shahar'}</span>
                                <span className="font-medium text-text">{info.city}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {Array.isArray(order.items) && order.items.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                              {language === 'ru' ? 'Товары' : 'Mahsulotlar'}
                            </p>
                            <div className="space-y-1">
                              {(order.items as Array<{ name: { ru: string; uz: string } | string; size?: string; quantity: number; price: number }>).map((item, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                  <span className="text-text truncate max-w-[65%]">
                                    {typeof item.name === 'object' ? (item.name[language] ?? item.name.ru) : item.name ?? '—'}
                                    {item.size && <span className="text-text-tertiary"> / {item.size}</span>}
                                    {' '}×{item.quantity}
                                  </span>
                                  <span className="font-semibold text-text ml-2 whitespace-nowrap">
                                    {formatPrice(Number(item.price) * Number(item.quantity))}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {Number(order.delivery_cost) > 0 && (
                          <div className="flex justify-between text-sm pt-2 border-t border-border">
                            <span className="text-text-secondary">{language === 'ru' ? 'Доставка' : 'Yetkazib berish'}</span>
                            <span className="font-medium text-text">{formatPrice(Number(order.delivery_cost))}</span>
                          </div>
                        )}

                        {history.length > 0 && (
                          <div>
                            <button
                              onClick={() => setShowHistory(historyOpen ? null : order.id)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-text dark:text-text-secondary hover:text-surface-800 dark:hover:text-text-tertiary transition"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              {language === 'ru' ? 'История статусов' : 'Status tarixi'} ({history.length})
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
                            </button>

                            {historyOpen && (
                              <div className="mt-2 space-y-2 pl-2">
                                {[...history].reverse().map((entry, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-accent" />
                                    <div>
                                      <p className="text-xs font-semibold text-surface-800 dark:text-gray-200">
                                        {getStatusLabel(entry.status, language)}
                                      </p>
                                      <p className="text-xs text-text-tertiary">
                                        {formatDate(entry.changed_at)}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Returns section */}
        {returns.filter((ret: { status: string }) => !['completed', 'refunded'].includes(ret.status)).length > 0 && (
          <div className="card-premium overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <h3 className="font-extrabold text-text flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-text" />
                {language === 'ru' ? 'Возвраты' : 'Qaytarishlar'}
              </h3>
              <span className="text-xs bg-surface-muted text-text dark:text-text-secondary font-semibold px-2 py-0.5 rounded-full">
                {returns.filter((ret: { status: string }) => !['completed', 'refunded'].includes(ret.status)).length}
              </span>
            </div>
            <div className="divide-y divide-border">
              {returns.filter((ret: { status: string }) => !['completed', 'refunded'].includes(ret.status)).map((ret: { id: string; order_id: string; status: string; reason: string; created_at: string; refund_amount: number }) => (
                <div key={ret.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text">
                        {language === 'ru' ? 'Заказ' : 'Buyurtma'} #{ret.order_id.slice(0, 8).toUpperCase()}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {ret.reason}
                      </p>
                      <p className="text-xs text-text-tertiary mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(ret.created_at)}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      ret.status === 'pending' ? 'bg-warning-light text-warning' :
                      ret.status === 'approved' ? 'bg-info-light text-info' :
                      ret.status === 'rejected' ? 'bg-danger-light text-danger' :
                      'bg-success-light text-success'
                    }`}>
                      {ret.status === 'pending' ? (language === 'ru' ? 'На рассмотрении' : "Ko'rib chiqilmoqda") :
                       ret.status === 'approved' ? (language === 'ru' ? 'Одобрен' : 'Tasdiqlandi') :
                       ret.status === 'rejected' ? (language === 'ru' ? 'Отклонён' : 'Rad etildi') :
                       (language === 'ru' ? 'Завершён' : 'Yakunlandi')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card-premium overflow-hidden">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-muted/60 active:bg-surface-muted transition border-b border-border-subtle last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                <Languages className="w-4 h-4 text-accent" />
              </div>
              <span className="text-sm font-semibold text-text">{t('change_language')}</span>
            </div>
            <span className="text-xs text-text-secondary font-medium">
              {language === 'ru' ? 'Русский' : "O'zbekcha"}
            </span>
          </button>

          <button
            onClick={() => navigate('/about')}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-muted/60 active:bg-surface-muted transition border-b border-border-subtle last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                <Info className="w-4 h-4 text-accent" />
              </div>
              <span className="text-sm font-semibold text-text">
                {language === 'ru' ? 'О нас' : 'Biz haqimizda'}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>

          <button
            onClick={() => navigate('/faq')}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-muted/60 active:bg-surface-muted transition border-b border-border-subtle last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                <HelpCircle className="w-4 h-4 text-accent" />
              </div>
              <span className="text-sm font-semibold text-text">
                {language === 'ru' ? 'Вопрос-ответ' : 'Savol-javob'}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>

          <button
            onClick={() => navigate('/contact')}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-muted/60 active:bg-surface-muted transition border-b border-border-subtle last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-accent" />
              </div>
              <span className="text-sm font-semibold text-text">
                {language === 'ru' ? 'Связаться с нами' : "Biz bilan bog'lanish"}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>


        </div>

        <p className="text-center text-2xs font-semibold tracking-widest text-text-tertiary">POINT TECH · v1.0</p>
      </div>
    </Layout>
  );
};
