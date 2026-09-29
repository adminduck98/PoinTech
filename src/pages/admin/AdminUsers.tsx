import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, X, AlertCircle, Shield, Users, Send, MessageCircle, Package, ChevronDown, ChevronRight, ChevronLeft, Search } from 'lucide-react';
import type { Database } from '../../lib/supabase';
import { getCurrentAdmin, AdminRole, ROLE_LABELS } from '../../lib/auth';
import { formatPrice } from '../../lib/utils';
import { auditLogQueries } from '../../lib/supabase/queries';
import type { OrderItem, CustomerInfo } from '../../lib/supabase';
import type { Return } from '../../lib/supabase/queries';
import { adminQueries, getAdminSession } from '../../lib/adminApi';

interface AdminAccount {
  id: string;
  email: string;
  first_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface TelegramUser {
  id: string;
  telegram_id: number;
  first_name: string;
  username: string | null;
  language: string;
  created_at: string;
}

const ROLES: AdminRole[] = ['super_admin', 'admin', 'manager', 'seller', 'support', 'content'];

const roleCls: Record<string, string> = {
  admin: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  manager: 'bg-surface-muted text-text',
  seller: 'bg-surface-muted text-text',
  super_admin: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  support: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  content: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
};

const roleDescriptions: Record<AdminRole, string> = {
  super_admin: 'Полный доступ, управление пользователями и безопасность',
  admin: 'Полный доступ ко всем разделам панели управления',
  manager: 'Доступ к товарам, заказам, баннерам, доставке и аналитике',
  seller: 'Доступ только к управлению товарами и складом',
  support: 'Доступ к заказам и возвратам для поддержки клиентов',
  content: 'Доступ к товарам, баннерам и контенту',
};

// Mirrors MIN_PASSWORD_LENGTH in admin-api and hash_admin_password() in SQL.
const MIN_PASSWORD_LENGTH = 10;

export const AdminUsers = () => {
  const admin = getCurrentAdmin();
  const [tab, setTab] = useState<'admins' | 'telegram'>('admins');

  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [telegramUsers, setTelegramUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    role: 'seller' as AdminRole,
    is_active: true,
  });

  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Message to user
  const [messageModal, setMessageModal] = useState<{ telegramId: number; firstName: string } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  // Order history
  const [ordersModal, setOrdersModal] = useState<{ telegramId: number; firstName: string } | null>(null);
  const [userOrders, setUserOrders] = useState<(Database['public']['Tables']['orders']['Row'] & { visible_to_client?: boolean; archived_at?: string | null })[]>([]);
  const [userReturns, setUserReturns] = useState<Return[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const USERS_PER_PAGE = 10;
  const [usersPage, setUsersPage] = useState(1);

  const filteredUsers = telegramUsers.filter((u) => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      String(u.telegram_id).includes(q)
    );
  });

  const totalUsersPages = Math.ceil(filteredUsers.length / USERS_PER_PAGE);
  const paginatedUsers = filteredUsers.slice(
    (usersPage - 1) * USERS_PER_PAGE,
    usersPage * USERS_PER_PAGE
  );

  // Reset page when search changes
  useEffect(() => { setUsersPage(1); }, [userSearch]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'admins') {
        const data = await adminQueries.getAdminAccounts();
        setAdminAccounts((Array.isArray(data) ? data : []) as AdminAccount[]);
      } else {
        // Via admin-api: RLS denies anon SELECT on `users`, so reading the
        // table directly returned an empty customer list.
        const data = await adminQueries.getUsers();
        setTelegramUsers(data ?? []);
      }
    } catch {
      setError('Не удалось загрузить данные.');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    loadData();
  }, [tab, loadData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ email: '', password: '', first_name: '', role: 'seller', is_active: true });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (u: AdminAccount) => {
    setEditing(u);
    setForm({
      email: u.email,
      password: '',
      first_name: u.first_name,
      role: u.role,
      is_active: u.is_active,
    });
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.first_name.trim()) { setFormError('Введите имя'); return; }
    if (!form.email.trim()) { setFormError('Введите email'); return; }
    if (!editing && !form.password) { setFormError('Введите пароль'); return; }
    if (form.password && form.password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const updates: Record<string, unknown> = {
          first_name: form.first_name.trim(),
          role: form.role,
          is_active: form.is_active,
        };
        // Plaintext over TLS; the database hashes it (hash_admin_password).
        // Hashing in the browser made the hash itself a working credential.
        if (form.password) {
          updates.password = form.password;
        }
        await adminQueries.updateAdminAccount(editing.id, updates);
        setSuccess('Сотрудник обновлён');
      } else {
        await adminQueries.createAdminAccount({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          first_name: form.first_name.trim(),
          role: form.role,
          is_active: form.is_active,
        });
        setSuccess('Сотрудник добавлен');
      }
      closeForm();
      await loadData();
      setTimeout(() => setSuccess(''), 3000);

      auditLogQueries.log({
        admin_id: admin?.id ?? 'unknown',
        action: editing ? 'update' : 'create',
        entity_type: 'admin_accounts',
        entity_id: editing?.id ?? null,
        details: { email: form.email, role: form.role, name: form.first_name },
      }).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка при сохранении';
      setFormError(msg.includes('duplicate') ? 'Этот email уже используется' : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить сотрудника? Действие необратимо.')) return;
    const account = adminAccounts.find(a => a.id === id);
    try {
      await adminQueries.deleteAdminAccount(id);
      setAdminAccounts((prev) => prev.filter((u) => u.id !== id));
      setSuccess('Сотрудник удалён');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Ошибка при удалении.');
      return;
    }

    auditLogQueries.log({
      admin_id: admin?.id ?? 'unknown',
      action: 'delete',
      entity_type: 'admin_accounts',
      entity_id: id,
      details: { email: account?.email, name: account?.first_name },
    }).catch(() => {});
  };

  const toggleActive = async (account: AdminAccount) => {
    try {
      await adminQueries.updateAdminAccount(account.id, { is_active: !account.is_active });
      setAdminAccounts((prev) =>
        prev.map((u) => u.id === account.id ? { ...u, is_active: !u.is_active } : u)
      );
    } catch {
      setError('Ошибка обновления статуса');
      return;
    }

    auditLogQueries.log({
      admin_id: admin?.id ?? 'unknown',
      action: 'update',
      entity_type: 'admin_accounts',
      entity_id: account.id,
      details: { email: account.email, is_active: !account.is_active },
    }).catch(() => {});
  };

  const fetchUserOrders = async (telegramId: number) => {
    setOrdersLoading(true);
    try {
      // Both tables are anon-denied by RLS; go through admin-api.
      const [ordersRes, returnsRes] = await Promise.all([
        adminQueries.getOrdersFiltered({ telegram_user_id: telegramId }),
        adminQueries.getReturnsFiltered({ telegram_user_id: telegramId }),
      ]);
      setUserOrders(Array.isArray(ordersRes) ? ordersRes : []);
      setUserReturns(Array.isArray(returnsRes) ? returnsRes : []);
    } catch {
      setError('Не удалось загрузить заказы');
      setTimeout(() => setError(''), 3000);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageModal || !messageText.trim()) return;
    setSendingMessage(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const admin_session = getAdminSession();
      const response = await fetch(`${supabaseUrl}/functions/v1/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({
          telegram_user_id: messageModal.telegramId,
          message: messageText.trim(),
          admin_session,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSuccess(`Сообщение отправлено ${messageModal.firstName}`);
        setMessageModal(null);
        setMessageText('');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || 'Ошибка отправки сообщения');
        setTimeout(() => setError(''), 3000);
      }
    } catch {
      setError('Ошибка отправки сообщения');
      setTimeout(() => setError(''), 3000);
    } finally {
      setSendingMessage(false);
    }
  };

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
            <h1 className="text-lg font-bold text-text">Пользователи</h1>
          </div>
          {tab === 'admins' && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 btn-brand text-sm font-semibold px-4 py-2 rounded-xl"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить</span>
            </button>
          )}
        </div>
      </header>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface-elevated rounded-[1.5rem] w-full max-w-md shadow-float border border-border">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
              <h2 className="text-lg font-bold text-text">
                {editing ? 'Редактировать сотрудника' : 'Новый сотрудник'}
              </h2>
              <button
                onClick={closeForm}
                className="p-1.5 rounded-lg text-text-secondary hover:text-text dark:hover:text-text-inverse hover:bg-surface-muted transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text mb-1.5">
                  Имя
                </label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  className="input-premium w-full px-4 py-2.5 text-sm"
                  placeholder="Иван Петров"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input-premium w-full px-4 py-2.5 text-sm disabled:opacity-60"
                  placeholder="manager@shop.uz"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-1.5">
                  {editing ? 'Новый пароль (оставьте пустым чтобы не менять)' : 'Пароль'}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input-premium w-full px-4 py-2.5 text-sm"
                  placeholder="••••••••"
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-text-tertiary">
                  Минимум {MIN_PASSWORD_LENGTH} символов
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-1.5">
                  Роль
                </label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}
                  className="input-premium w-full px-4 py-2.5 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <p className="text-xs text-text-secondary mt-1.5">
                  {roleDescriptions[form.role]}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-accent' : 'bg-surface-muted dark:bg-gray-600'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm text-text">
                  {form.is_active ? 'Активен' : 'Заблокирован'}
                </span>
              </div>

              {formError && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 btn-brand font-semibold py-2.5 rounded-xl disabled:opacity-60 text-sm"
                >
                  {saving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Сохранить' : 'Создать'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 bg-surface-muted hover:bg-surface-inset dark:hover:bg-surface-elevated text-text font-semibold py-2.5 rounded-xl transition text-sm"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ordersModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface-elevated rounded-[1.5rem] w-full max-w-2xl max-h-[85dvh] shadow-float border border-border flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-brand shadow-accent flex items-center justify-center">
                  <Package className="w-5 h-5 text-text-inverse" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text">Карточка клиента</h2>
                  <p className="text-xs text-text-secondary">
                    {ordersModal.firstName} · Telegram ID: {ordersModal.telegramId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setOrdersModal(null); setUserOrders([]); setUserReturns([]); setExpandedOrderId(null); }}
                className="p-1.5 rounded-lg text-text-secondary hover:text-text dark:hover:text-text-inverse hover:bg-surface-muted transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stats summary */}
            <div className="px-6 py-4 border-b border-border-subtle bg-bg dark:bg-surface-muted/30 flex-shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-text-secondary">Всего заказов</p>
                  <p className="text-xl font-bold text-text">{userOrders.length}</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Общая сумма</p>
                  <p className="text-xl font-bold text-text">
                    {formatPrice(userOrders.reduce((sum, o) => sum + Number(o.total_amount), 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Возвратов</p>
                  <p className="text-xl font-bold text-text">{userReturns.length}</p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Отмен</p>
                  <p className="text-xl font-bold text-text">
                    {userOrders.filter(o => o.status === 'cancelled').length}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {ordersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : userOrders.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">У этого пользователя пока нет заказов</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Полная история заказов (включая скрытые)
                  </p>
                  {userOrders.map((order) => {
                    const isExpanded = expandedOrderId === order.id;
                    const items = Array.isArray(order.items) ? order.items : [];
                    const isHidden = order.visible_to_client === false;
                    return (
                      <div key={order.id} className={`bg-bg dark:bg-surface-muted/50 rounded-xl border ${isHidden ? 'border-orange-200 dark:border-orange-800' : 'border-border'} overflow-hidden`}>
                        <button
                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-muted transition"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-text font-mono">
                              #{order.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                              order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                              order.status === 'returned' ? 'bg-orange-100 text-orange-700' :
                              'bg-surface-inset text-surface-700'
                            }`}>
                              {order.status}
                            </span>
                            {isHidden && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-text">
                                Скрыт
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-text">
                              {formatPrice(Number(order.total_amount))}
                            </span>
                            <span className="text-xs text-text-secondary">
                              {new Date(order.created_at).toLocaleDateString('ru-RU')}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
                            {items.map((item: OrderItem, i: number) => (
                              <div key={i} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  {item.image && (
                                    <img src={item.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                                  )}
                                  <span className="text-text">
                                    {typeof item.name === 'object' ? (item.name as { ru: string }).ru : item.name}
                                    {item.size && <span className="text-text-tertiary"> · {item.size}</span>}
                                    {' '}× {item.quantity}
                                  </span>
                                </div>
                                <span className="font-semibold text-text">
                                  {formatPrice(item.price * item.quantity)}
                                </span>
                              </div>
                            ))}
                            <div className="flex justify-between pt-2 border-t border-border text-sm">
                              <span className="text-text-secondary">Доставка</span>
                              <span className="font-medium text-text">{formatPrice(Number(order.delivery_cost))}</span>
                            </div>
                            {order.customer_info && (
                              <div className="pt-2 border-t border-border text-xs text-text-secondary">
                                <p>{(order.customer_info as CustomerInfo)?.name} · {(order.customer_info as CustomerInfo)?.phone}</p>
                                <p>{(order.customer_info as CustomerInfo)?.city}, {(order.customer_info as CustomerInfo)?.address}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {userReturns.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide pt-4">
                        Заявки на возврат
                      </p>
                      {userReturns.map((ret) => (
                        <div key={ret.id} className="bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-800 p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-sm font-semibold text-text">
                                Заказ #{ret.order_id.slice(0, 8).toUpperCase()}
                              </p>
                              <p className="text-xs text-text-secondary mt-1">{ret.reason}</p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              ret.status === 'refunded' ? 'bg-green-100 text-green-700' :
                              ret.status === 'rejected' ? 'bg-red-100 text-red-700' :
                              ret.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                              'bg-surface-muted text-surface-700'
                            }`}>
                              {ret.status === 'pending' ? 'На рассмотрении' :
                               ret.status === 'approved' ? 'Одобрен' :
                               ret.status === 'rejected' ? 'Отклонён' :
                               ret.status === 'refunded' ? 'Возвращён' : ret.status}
                            </span>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2">
                            {new Date(ret.created_at).toLocaleDateString('ru-RU')}
                          </p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {messageModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface-elevated rounded-[1.5rem] w-full max-w-md shadow-float border border-border">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-brand shadow-accent flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-text-inverse" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-text">Написать клиенту</h2>
                  <p className="text-xs text-text-secondary">
                    {messageModal.firstName} · ID: {messageModal.telegramId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setMessageModal(null); setMessageText(''); }}
                className="p-1.5 rounded-lg text-text-secondary hover:text-text dark:hover:text-text-inverse hover:bg-surface-muted transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text mb-1.5">
                  Сообщение
                </label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Введите сообщение... (поддерживается HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;)"
                  rows={5}
                  className="input-premium w-full px-4 py-3 text-sm resize-none"
                />
                <p className="text-xs text-text-tertiary mt-1.5">
                  Сообщение будет отправлено через Telegram бот
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMessage || !messageText.trim()}
                  className="flex-1 flex items-center justify-center gap-2 btn-brand font-semibold py-2.5 rounded-xl disabled:opacity-60 text-sm"
                >
                  {sendingMessage ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {sendingMessage ? 'Отправка...' : 'Отправить'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMessageModal(null); setMessageText(''); }}
                  className="flex-1 bg-surface-muted hover:bg-surface-inset dark:hover:bg-surface-elevated text-text font-semibold py-2.5 rounded-xl transition text-sm"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {success && (
          <div className="mb-5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-xl px-4 py-3 text-sm">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab('admins')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${tab === 'admins' ? 'bg-accent text-text-inverse' : 'bg-surface text-text-secondary border border-border hover:bg-surface-muted'}`}
          >
            <Shield className="w-4 h-4" />
            Сотрудники панели
          </button>
          <button
            onClick={() => setTab('telegram')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${tab === 'telegram' ? 'bg-accent text-text-inverse' : 'bg-surface text-text-secondary border border-border hover:bg-surface-muted'}`}
          >
            <Users className="w-4 h-4" />
            Покупатели
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === 'admins' ? (
          adminAccounts.length === 0 ? (
            <div className="text-center py-20 text-text-tertiary text-sm">
              Нет сотрудников
            </div>
          ) : (
            <div className="card-premium overflow-hidden">
              {/* No min-width: a 640px floor guaranteed a horizontal scrollbar
                  on every phone. Below `sm` the low-priority columns fold into
                  the first cell instead of forcing the row wider than the
                  screen — the admin panel shares a router and a bundle with the
                  shop, so it does get opened on a phone. */}
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg dark:bg-surface-muted/50 border-b border-border">
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text">Имя</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden sm:table-cell">Email</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden sm:table-cell">Роль</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden md:table-cell">Последний вход</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden sm:table-cell">Статус</th>
                    <th className="text-right px-3 sm:px-6 py-3 font-semibold text-text">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {adminAccounts.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-muted/30 transition">
                      <td className="px-3 sm:px-6 py-4 font-semibold text-text">
                        {u.first_name}
                        {/* Columns hidden below their breakpoint reappear here,
                            so narrowing the screen drops no information. */}
                        <span className="sm:hidden block font-normal text-xs text-text-secondary mt-0.5 break-all">
                          {u.email}
                        </span>
                        <span className={`sm:hidden inline-block mt-1.5 mr-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full ${roleCls[u.role] ?? roleCls.seller}`}>
                          {ROLE_LABELS[u.role]}
                        </span>
                        <button
                          onClick={() => toggleActive(u)}
                          className={`sm:hidden mt-1.5 text-2xs font-semibold px-2 py-0.5 rounded-full transition ${u.is_active ? 'bg-success/10 dark:bg-success/20 text-success' : 'bg-surface-muted text-text-secondary'}`}
                        >
                          {u.is_active ? 'Активен' : 'Заблокирован'}
                        </button>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-text-secondary text-xs hidden sm:table-cell break-all">
                        {u.email}
                      </td>
                      <td className="px-3 sm:px-6 py-4 hidden sm:table-cell">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${roleCls[u.role] ?? roleCls.seller}`}>
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-text-secondary text-xs hidden md:table-cell">
                        {u.last_login_at
                          ? new Date(u.last_login_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-3 sm:px-6 py-4 hidden sm:table-cell">
                        <button
                          onClick={() => toggleActive(u)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full transition ${u.is_active ? 'bg-success/10 dark:bg-success/20 text-success' : 'bg-surface-muted text-text-secondary'}`}
                        >
                          {u.is_active ? 'Активен' : 'Заблокирован'}
                        </button>
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-2 text-text dark:text-text-secondary hover:bg-surface-muted dark:hover:bg-surface-inset rounded-lg transition"
                            title="Редактировать"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="p-2 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                            title="Удалить"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )
        ) : (
          telegramUsers.length === 0 ? (
            <div className="text-center py-20 text-text-tertiary text-sm">
              Нет покупателей
            </div>
          ) : (
            <div className="card-premium overflow-hidden">
              {telegramUsers.length > 5 && (
                <div className="px-4 py-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Поиск по имени, username или ID..."
                      className="input-premium w-full pl-10 pr-4 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
              {/* Same treatment as the admin table above: no 640px floor, and
                  the secondary columns fold into the name cell below `sm`. */}
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg dark:bg-surface-muted/50 border-b border-border">
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text">Имя</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden sm:table-cell">Username</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden md:table-cell">Telegram ID</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden lg:table-cell">Язык</th>
                    <th className="text-left px-3 sm:px-6 py-3 font-semibold text-text hidden md:table-cell">Добавлен</th>
                    <th className="text-right px-3 sm:px-6 py-3 font-semibold text-text">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-muted/30 transition">
                      <td className="px-3 sm:px-6 py-4 font-semibold text-text">
                        {u.first_name}
                        <span className="sm:hidden block font-normal text-xs text-text-secondary mt-0.5">
                          {u.username ? `@${u.username}` : '—'}
                        </span>
                        <span className="md:hidden block font-normal font-mono text-2xs text-text-tertiary mt-0.5">
                          {u.telegram_id} · {new Date(u.created_at).toLocaleDateString('ru-RU')}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-text-secondary hidden sm:table-cell">
                        {u.username ? `@${u.username}` : '—'}
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-text-secondary font-mono text-xs hidden md:table-cell">
                        {u.telegram_id}
                      </td>
                      <td className="px-3 sm:px-6 py-4 hidden lg:table-cell">
                        <span className="text-xs font-medium px-2 py-0.5 bg-surface-muted text-text-secondary dark:text-text-tertiary rounded-full uppercase">
                          {u.language}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-text-secondary text-xs hidden md:table-cell">
                        {new Date(u.created_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                          <button
                            onClick={() => {
                              setOrdersModal({ telegramId: u.telegram_id, firstName: u.first_name });
                              fetchUserOrders(u.telegram_id);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-brand text-xs font-semibold"
                          >
                            <Package className="w-3 h-3" />
                            История
                          </button>
                          <button
                            onClick={() => setMessageModal({ telegramId: u.telegram_id, firstName: u.first_name })}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-brand text-xs font-semibold"
                          >
                            <Send className="w-3 h-3" />
                            Написать
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {userSearch.trim() && filteredUsers.length === 0 && (
                <div className="text-center py-8 text-text-secondary text-sm">
                  Пользователи не найдены по запросу "{userSearch}"
                </div>
              )}
              {filteredUsers.length > USERS_PER_PAGE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-text-secondary">
                    {filteredUsers.length} пользователей · Страница {usersPage} из {totalUsersPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                      disabled={usersPage === 1}
                      className="p-1.5 rounded-lg border border-border hover:bg-surface-muted disabled:opacity-30 transition"
                    >
                      <ChevronLeft className="w-4 h-4 text-text-secondary" />
                    </button>
                    {Array.from({ length: Math.min(totalUsersPages, 5) }, (_, i) => {
                      let pageNum: number;
                      if (totalUsersPages <= 5) {
                        pageNum = i + 1;
                      } else if (usersPage <= 3) {
                        pageNum = i + 1;
                      } else if (usersPage >= totalUsersPages - 2) {
                        pageNum = totalUsersPages - 4 + i;
                      } else {
                        pageNum = usersPage - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setUsersPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-xs font-semibold transition ${
                            usersPage === pageNum
                              ? 'bg-accent text-text-inverse'
                              : 'text-text-secondary hover:bg-surface-muted'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setUsersPage((p) => Math.min(totalUsersPages, p + 1))}
                      disabled={usersPage === totalUsersPages}
                      className="p-1.5 rounded-lg border border-border hover:bg-surface-muted disabled:opacity-30 transition"
                    >
                      <ChevronRight className="w-4 h-4 text-text-secondary" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
};
