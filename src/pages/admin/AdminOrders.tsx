import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Clock, User, MapPin, Package, History, Inbox, Hourglass, Archive, Search, EyeOff, ExternalLink, MessageSquare, Send } from 'lucide-react';
import { Database, type StatusHistoryEntry, type CustomerInfo, type OrderItem } from '../../lib/supabase';
import { getCurrentAdmin, ROLE_LABELS } from '../../lib/auth';
import { formatPrice } from '../../lib/utils';
import { toast } from '../../components/Toast';
import { ORDER_STATUSES, getStatusInfo } from '../../lib/orderStatuses';
import { adminQueries, getAdminSession } from '../../lib/adminApi';
import { auditLogQueries } from '../../lib/supabase/queries';
import { useAdminSendMessage } from '../../lib/supabase/hooks';

type Order = Database['public']['Tables']['orders']['Row'] & {
  visible_to_client?: boolean;
  archived_at?: string | null;
  cancellation_reason?: string | null;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const StatusBadge = ({ status, archived }: { status: string; archived?: boolean }) => {
  const info = getStatusInfo(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${info.color} ${archived ? 'opacity-70' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />
      {info.label_ru}
    </span>
  );
};

type TabType = 'new' | 'pending' | 'history' | 'archived';

export const AdminOrders = () => {
  const admin = getCurrentAdmin();
  const [orders, setOrders] = useState<Order[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('new');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);
  const sendMessage = useAdminSendMessage();
  const [userMap, setUserMap] = useState<Record<number, { first_name: string; username: string | null; phone: string | null }>>({});

  useEffect(() => {
    loadOrders();
  }, []);

  const handleSendMessage = async (orderId: string) => {
    if (!adminMessage.trim() || sendingMessage) return;
    setSendingMessage(orderId);
    try {
      await sendMessage.mutateAsync({
        order_id: orderId,
        content: adminMessage.trim(),
      });

      // Send Telegram notification to customer
      const order = allOrders.find(o => o.id === orderId);
      const customerInfo = order?.customer_info as CustomerInfo;
      if (customerInfo && order?.telegram_user_id) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const admin_session = getAdminSession();
        fetch(`${supabaseUrl}/functions/v1/send-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'Apikey': anonKey,
          },
          body: JSON.stringify({
            telegram_user_id: order.telegram_user_id,
            message: `💬 <b>Новое сообщение по заказу #${orderId.slice(0, 8).toUpperCase()}</b>\n\n${adminMessage.trim()}`,
            parse_mode: 'HTML',
            admin_session,
          }),
        }).catch(() => {});
      }

      setAdminMessage('');
      toast.success('Сообщение отправлено');
    } catch {
      toast.error('Ошибка отправки сообщения');
    } finally {
      setSendingMessage(null);
    }
  };

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await adminQueries.getOrders();
      const ordersData = (data ?? []) as Order[];
      setAllOrders(ordersData);
      setOrders(ordersData);

      const telegramIds = [...new Set(ordersData.map(o => o.telegram_user_id).filter(Boolean))];
      if (telegramIds.length > 0) {
        type UserRow = { telegram_id: number; first_name: string; username: string | null; phone: string | null };
        const usersData = await adminQueries.getUsers();
        const users: UserRow[] = Array.isArray(usersData) ? usersData : [];
        if (users.length > 0) {
          const map: Record<number, { first_name: string; username: string | null; phone: string | null }> = {};
          users.filter((u: UserRow) => telegramIds.includes(u.telegram_id)).forEach((u: UserRow) => { map[u.telegram_id] = { first_name: u.first_name, username: u.username, phone: u.phone }; });
          setUserMap(map);
        }
      }
    } catch {
      toast.error('Не удалось загрузить заказы.');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    if (updatingId) return;
    setUpdatingId(orderId);
    try {
      const updatedOrder = await adminQueries.updateOrderStatus(
        orderId,
        newStatus,
        admin?.first_name ?? 'Admin'
      );

      const updated = updatedOrder as Order;
      setAllOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, ...updated } : o
        )
      );
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, ...updated } : o
        )
      );
      const label = getStatusInfo(newStatus).label_ru;
      toast.success(`Статус изменён: ${label}`);

      auditLogQueries.log({
        admin_id: admin?.id ?? 'unknown',
        action: 'status_change',
        entity_type: 'orders',
        entity_id: orderId,
        details: { new_status: newStatus, admin_name: admin?.first_name },
      }).catch(() => {});
    } catch {
      toast.error('Ошибка при обновлении статуса.');
    } finally {
      setUpdatingId(null);
    }
  };

  const { newOrders, pendingOrders, historyOrders, archivedOrders, counts } = useMemo(() => {
    const filtered = clientSearch.trim()
      ? allOrders.filter((o) => {
          const q = clientSearch.toLowerCase();
          const idMatch = o.id.toLowerCase().includes(q);
          const telegramMatch = String(o.telegram_user_id).includes(q);
          const info = o.customer_info as CustomerInfo | null;
          const nameMatch = info?.name?.toLowerCase().includes(q) ?? false;
          const phoneMatch = info?.phone?.includes(q) ?? false;
          return idMatch || telegramMatch || nameMatch || phoneMatch;
        })
      : allOrders;

    const newOrders = filtered.filter(o => o.status === 'new');
    const pendingOrders = filtered.filter(o => ['processing', 'assembling', 'assembled', 'shipping', 'paid', 'shipped'].includes(o.status ?? ''));
    const historyOrders = filtered.filter(o => ['delivered', 'cancelled', 'returned', 'return_requested'].includes(o.status ?? '') && !o.archived_at);
    const archivedOrders = filtered.filter(o => o.archived_at != null || o.visible_to_client === false);
    return {
      newOrders,
      pendingOrders,
      historyOrders,
      archivedOrders,
      counts: {
        new: newOrders.length,
        pending: pendingOrders.length,
        history: historyOrders.length,
        archived: archivedOrders.length,
      },
    };
  }, [allOrders, clientSearch]);

  const displayedOrders = activeTab === 'new' ? newOrders : activeTab === 'pending' ? pendingOrders : activeTab === 'history' ? historyOrders : archivedOrders;

  if (!admin) return null;

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 glass border-b border-[color:var(--glass-border)] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/nanyy/dashboard"
              className="p-2 rounded-lg text-text-secondary hover:text-text dark:hover:text-text-inverse hover:bg-surface-muted transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-text">Заказы</h1>
              <p className="text-xs text-text-secondary">{orders.length} всего</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-text leading-none">{admin.first_name}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              admin.role === 'admin'
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : 'bg-surface-muted text-text'
            }`}>
              {ROLE_LABELS[admin.role]}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Search by client */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Поиск по номеру, Telegram ID, имени или телефону клиента..."
              className="input-premium w-full pl-10 pr-4 py-2.5 text-sm"
            />
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition ${
              activeTab === 'new'
                ? 'bg-accent text-text-inverse'
                : 'bg-surface border border-border text-text-secondary hover:bg-surface-muted'
            }`}
          >
            <Inbox className="w-4 h-4" />
            Новые {counts.new > 0 && <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">{counts.new}</span>}
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition ${
              activeTab === 'pending'
                ? 'bg-accent text-text-inverse'
                : 'bg-surface border border-border text-text-secondary hover:bg-surface-muted'
            }`}
          >
            <Hourglass className="w-4 h-4" />
            В обработке {counts.pending > 0 && <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">{counts.pending}</span>}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition ${
              activeTab === 'history'
                ? 'bg-accent text-text-inverse'
                : 'bg-surface border border-border text-text-secondary hover:bg-surface-muted'
            }`}
          >
            <Archive className="w-4 h-4" />
            Завершённые {counts.history > 0 && <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">{counts.history}</span>}
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition ${
              activeTab === 'archived'
                ? 'bg-accent text-text-inverse'
                : 'bg-surface border border-border text-text-secondary hover:bg-surface-muted'
            }`}
          >
            <EyeOff className="w-4 h-4" />
            Архив {counts.archived > 0 && <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">{counts.archived}</span>}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayedOrders.length === 0 ? (
          <div className="text-center py-20 text-text-tertiary text-sm">
            {activeTab === 'new' && 'Новых заказов нет'}
            {activeTab === 'pending' && 'Нет заказов в обработке'}
            {activeTab === 'history' && 'Нет завершённых заказов'}
            {activeTab === 'archived' && 'Архив пуст'}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {displayedOrders.map((order) => {
              const expanded = expandedId === order.id;
              const showHistory = historyId === order.id;
              const info = order.customer_info as CustomerInfo;
              const history: StatusHistoryEntry[] = Array.isArray(order.status_history)
                ? order.status_history
                : [];

              return (
                <div
                  key={order.id}
                  className="card-premium overflow-hidden"
                >
                  <div className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="font-bold text-text text-sm">
                              #{order.id.slice(0, 8).toUpperCase()}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(order.created_at)}
                            </p>
                          </div>
                          <p className="text-xl font-bold text-text whitespace-nowrap">
                            {formatPrice(Number(order.total_amount))}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={order.status ?? 'new'} archived={order.visible_to_client === false} />

                          <select
                            value={order.status ?? 'new'}
                            onChange={(e) => updateStatus(order.id, e.target.value)}
                            disabled={updatingId === order.id}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border bg-surface text-surface-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-accent cursor-pointer disabled:opacity-50"
                          >
                            {ORDER_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label_ru}</option>
                            ))}
                          </select>

                          {order.payment_method && (
                            <span className="text-xs px-2.5 py-1 rounded-full bg-surface-muted text-text-secondary font-medium">
                              {order.payment_method}
                            </span>
                          )}
                          {order.delivery_type && (
                            <span className="text-xs px-2.5 py-1 rounded-full bg-surface-muted text-text-secondary font-medium">
                              {order.delivery_type}
                            </span>
                          )}
                          {order.visible_to_client === false && (
                            <span className="text-xs px-2.5 py-1 rounded-full bg-surface-inset dark:bg-surface-elevated text-text-secondary font-medium flex items-center gap-1">
                              <EyeOff className="w-3 h-3" />
                              Скрыт от клиента
                            </span>
                          )}
                          <span className="text-xs px-2.5 py-1 rounded-full bg-surface-muted text-text-secondary font-mono">
                            TG: {order.telegram_user_id}
                          </span>
                          <button
                            onClick={() => {
                              setExpandedId(order.id);
                              setTimeout(() => {
                                const el = document.getElementById(`msg-input-${order.id}`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                (el?.querySelector('input') as HTMLInputElement)?.focus();
                              }, 100);
                            }}
                            className="text-xs px-2.5 py-1 rounded-full bg-accent-subtle dark:bg-accent/20 text-accent dark:text-accent hover:bg-accent-subtle dark:hover:bg-accent/40 font-medium flex items-center gap-1 transition"
                            title="Ответить клиенту через Telegram"
                          >
                            <Send className="w-3 h-3" />
                            Ответить
                          </button>

                          {history.length > 0 && (
                            <button
                              onClick={() => setHistoryId(showHistory ? null : order.id)}
                              className="text-xs px-2.5 py-1 rounded-full bg-surface-muted text-text-secondary hover:bg-surface-inset dark:hover:bg-surface-elevated font-medium flex items-center gap-1 transition"
                            >
                              <History className="w-3 h-3" />
                              История ({history.length})
                            </button>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => setExpandedId(expanded ? null : order.id)}
                        className="p-2 rounded-lg text-text-secondary hover:text-text dark:hover:text-text-inverse hover:bg-surface-muted transition flex-shrink-0 mt-1"
                      >
                        <ChevronDown className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {showHistory && history.length > 0 && (
                    <div className="border-t border-border-subtle px-5 py-4 bg-bg/40 dark:bg-surface-muted/10">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3 flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5" />
                        История изменений
                      </p>
                      <div className="space-y-2.5">
                        {[...history].reverse().map((entry: StatusHistoryEntry, i: number) => (
                          <div key={i} className="flex items-start gap-3">
                            <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${getStatusInfo(entry.status).dot}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-text">
                                  {getStatusInfo(entry.status).label_ru}
                                </span>
                                <span className="text-xs text-text-secondary">
                                  — {entry.changed_by}
                                </span>
                              </div>
                              <p className="text-xs text-text-tertiary mt-0.5">
                                {formatDate(entry.changed_at)}
                              </p>
                              {entry.note && (
                                <p className="text-xs text-text-secondary dark:text-text-tertiary mt-0.5 italic">{entry.note}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {expanded && (
                    <div className="border-t border-border-subtle px-5 py-4 bg-bg/50 dark:bg-surface-muted/20 space-y-4">
                      {info && (
                        <div>
                          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5" />
                            Покупатель
                          </p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            {info.name && (
                              <div>
                                <p className="text-xs text-text-secondary">Имя</p>
                                <p className="font-medium text-text">{info.name}</p>
                              </div>
                            )}
                            {info.phone && (
                              <div>
                                <p className="text-xs text-text-secondary">Телефон</p>
                                <p className="font-medium text-text">{info.phone}</p>
                              </div>
                            )}
                            {userMap[order.telegram_user_id]?.username && (
                              <div>
                                <p className="text-xs text-text-secondary">Telegram</p>
                                <p className="font-medium text-text">@{userMap[order.telegram_user_id].username}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {info && (info.city || info.address) && (
                        <div>
                          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" />
                            Адрес доставки
                          </p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            {info.city && (
                              <div>
                                <p className="text-xs text-text-secondary">Город</p>
                                <p className="font-medium text-text">{info.city}</p>
                              </div>
                            )}
                            {info.address && (
                              <div>
                                <p className="text-xs text-text-secondary">Адрес</p>
                                <p className="font-medium text-text">{info.address}</p>
                              </div>
                            )}
                          </div>
                          {info.latitude && info.longitude && (
                            <div className="mt-2">
                              <p className="text-xs text-text-secondary">
                                Координаты: {Number(info.latitude).toFixed(6)}, {Number(info.longitude).toFixed(6)}
                              </p>
                              <a
                                href={`https://www.google.com/maps?q=${info.latitude},${info.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 mt-1.5 text-xs font-medium text-accent hover:text-accent-hover transition"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Открыть на карте
                              </a>
                            </div>
                          )}
                        </div>
                      )}

                      {Array.isArray(order.items) && order.items.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5" />
                            Товары
                          </p>
                          <div className="space-y-1.5">
                            {(order.items as OrderItem[]).map((item: OrderItem, i: number) => (
                              <div key={i} className="flex justify-between text-sm">
                                <span className="text-text">
                                  {typeof item.name === 'object' ? (item.name as { ru: string; uz: string }).ru : item.name ?? '—'}
                                  {item.size && <span className="text-text-secondary"> / {item.size}</span>}
                                  {item.color && <span className="text-text-secondary"> / {item.color}</span>}
                                  {' '}× {item.quantity}
                                </span>
                                <span className="font-semibold text-text ml-3 whitespace-nowrap">
                                  {formatPrice(Number(item.price) * Number(item.quantity))}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {Number(order.delivery_cost) > 0 && (
                        <div className="flex justify-between text-sm pt-2 border-t border-border">
                          <span className="text-text-secondary">Доставка</span>
                          <span className="font-medium text-text">
                            {formatPrice(Number(order.delivery_cost))}
                          </span>
                        </div>
                      )}

                      {order.notes && (
                        <div>
                          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                            Примечание
                          </p>
                          <p className="text-sm text-text">{order.notes}</p>
                        </div>
                      )}

                      <div id={`msg-input-${order.id}`} className="pt-2 border-t border-border">
                        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5" />
                          Сообщение клиенту
                        </p>
                        <div className="flex gap-2">
                          <input
                            value={sendingMessage === order.id ? '' : adminMessage}
                            onChange={(e) => setAdminMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(order.id)}
                            placeholder="Введите сообщение..."
                            disabled={sendingMessage === order.id}
                            className="input-premium flex-1 px-3 py-2 text-sm disabled:opacity-50"
                          />
                          <button
                            onClick={() => handleSendMessage(order.id)}
                            disabled={!adminMessage.trim() || sendingMessage === order.id}
                            className="px-4 py-2 rounded-xl btn-brand text-sm font-semibold disabled:opacity-50"
                          >
                            {sendingMessage === order.id ? (
                              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                            ) : (
                              <MessageSquare className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};
