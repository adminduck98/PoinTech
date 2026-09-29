import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Heart, Eye, ShoppingCart, TrendingUp, Users, Package, BarChart3, RefreshCw, RotateCcw } from 'lucide-react';
import { getCurrentAdmin, ROLE_LABELS } from '../../lib/auth';
import { formatPrice, getLocalizedValue } from '../../lib/utils';
import { useAllProductAnalytics } from '../../lib/supabase/hooks';
import { adminQueries } from '../../lib/adminApi';

type SortKey = 'views' | 'favorites' | 'cart_adds' | 'orders' | 'purchases' | 'returns' | 'conversion';

type ProductRow = {
  product_id: string;
  name: { ru: string; uz: string };
  slug: string;
  price: number;
  views: number;
  favorites: number;
  cart_adds: number;
  orders: number;
  purchases: number;
  returns: number;
  stock: number;
  conversion: number;
};

interface UserStats {
  total_users: number;
  new_users_7d: number;
  returning_users: number;
  overall_conversion: number;
}

export const AdminEngagement = () => {
  const admin = getCurrentAdmin();
  const { data: analyticsData = [], isLoading: analyticsLoading, refetch } = useAllProductAnalytics();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [userStats, setUserStats] = useState<UserStats>({ total_users: 0, new_users_7d: 0, returning_users: 0, overall_conversion: 0 });
  const [sortBy, setSortBy] = useState<SortKey>('views');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const users = await adminQueries.getUsers() as Array<{ id: string; created_at: string }> | null;
      const allUsers = users ?? [];

      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const newUsers = allUsers.filter((u) => new Date(u.created_at) >= sevenDaysAgo).length;

      // Calculate overall conversion from analytics data
      const totalViews = analyticsData.reduce((sum: number, row: Record<string, unknown>) => sum + ((row.views as number) ?? 0), 0);
      const totalPurchases = analyticsData.reduce((sum: number, row: Record<string, unknown>) => sum + ((row.purchases as number) ?? 0), 0);

      setUserStats({
        total_users: allUsers.length,
        new_users_7d: newUsers,
        returning_users: Math.max(0, allUsers.length - newUsers),
        overall_conversion: totalViews > 0 ? Math.round((totalPurchases / totalViews) * 10000) / 100 : 0,
      });
    } catch {
      // non-critical
    }
  }, [analyticsData]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refetch();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  // Process analytics data into product rows
  useEffect(() => {
    const rows: ProductRow[] = (analyticsData as unknown as Array<{
      product_id: string;
      name: { ru: string; uz: string };
      slug: string;
      price: number;
      views: number;
      favorites: number;
      cart_adds: number;
      orders: number;
      purchases: number;
      returns: number;
      stock: number;
    }>).map((p) => ({
      product_id: p.product_id,
      name: p.name as { ru: string; uz: string },
      slug: p.slug,
      price: p.price as number,
      views: p.views ?? 0,
      favorites: p.favorites ?? 0,
      cart_adds: p.cart_adds ?? 0,
      orders: p.orders ?? 0,
      purchases: p.purchases ?? 0,
      returns: p.returns ?? 0,
      stock: p.stock ?? 0,
      conversion: (p.views ?? 0) > 0 ? Math.round(((p.purchases ?? 0) / (p.views ?? 0)) * 10000) / 100 : 0,
    }));

    rows.sort((a, b) => {
      if (sortBy === 'conversion') return b.conversion - a.conversion;
      return (b[sortBy] as number) - (a[sortBy] as number);
    });

    setProducts(rows);
  }, [analyticsData, sortBy]);

  if (!admin) return null;

  const totalViews = products.reduce((sum: number, p: ProductRow) => sum + p.views, 0);
  const totalFavorites = products.reduce((sum: number, p: ProductRow) => sum + p.favorites, 0);
  const totalCartAdds = products.reduce((sum: number, p: ProductRow) => sum + p.cart_adds, 0);
  const totalOrders = products.reduce((sum: number, p: ProductRow) => sum + p.orders, 0);
  const totalPurchases = products.reduce((sum: number, p: ProductRow) => sum + p.purchases, 0);
  const totalReturns = products.reduce((sum: number, p: ProductRow) => sum + p.returns, 0);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 glass border-b border-[color:var(--glass-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/nanyy/dashboard" className="w-9 h-9 rounded-xl bg-surface-muted flex items-center justify-center">
              <ArrowLeft className="w-4 h-4 text-text" />
            </Link>
            <div>
              <h1 className="text-sm font-bold text-text">Аналитика товаров</h1>
              <p className="text-xs text-text-secondary">Просмотры, избранное, корзина, заказы, продажи</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                autoRefresh
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-surface-muted text-text-secondary'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Авто' : 'Ручной'}
            </button>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg bg-surface-muted hover:bg-surface-inset dark:hover:bg-surface-elevated transition"
            >
              <RefreshCw className="w-4 h-4 text-text-secondary" />
            </button>
            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-muted text-text-secondary font-medium hidden sm:block">
              {ROLE_LABELS[admin.role]}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Overall Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2">
              <Users className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-text">{userStats.total_users}</p>
            <p className="text-[11px] text-text-secondary">Пользователей</p>
          </div>
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 flex items-center justify-center mb-2">
              <TrendingUp className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-text">{userStats.new_users_7d}</p>
            <p className="text-[11px] text-text-secondary">Новых за 7 дней</p>
          </div>
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-2">
              <Users className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-text">{userStats.returning_users}</p>
            <p className="text-[11px] text-text-secondary">Активные</p>
          </div>
          <div className="bg-surface rounded-xl p-4 border border-border">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2">
              <BarChart3 className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold text-text">{userStats.overall_conversion}%</p>
            <p className="text-[11px] text-text-secondary">Конверсия (просм.→пок.)</p>
          </div>
        </div>

        {/* Product Totals */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: <Eye className="w-3.5 h-3.5" />, label: 'Просмотры', value: totalViews, color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' },
            { icon: <Heart className="w-3.5 h-3.5" />, label: 'Избранное', value: totalFavorites, color: 'text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-900/20' },
            { icon: <ShoppingCart className="w-3.5 h-3.5" />, label: 'В корзину', value: totalCartAdds, color: 'text-warning bg-orange-50 dark:bg-orange-900/20' },
            { icon: <Package className="w-3.5 h-3.5" />, label: 'Заказы', value: totalOrders, color: 'text-text-secondary bg-surface-muted' },
            { icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'Покупки', value: totalPurchases, color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' },
            { icon: <RotateCcw className="w-3.5 h-3.5" />, label: 'Возвраты', value: totalReturns, color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface rounded-xl p-3 border border-border text-center">
              <div className={`w-7 h-7 rounded-lg ${stat.color} flex items-center justify-center mb-1.5 mx-auto`}>
                {stat.icon}
              </div>
              <p className="text-base font-bold text-text">{stat.value}</p>
              <p className="text-[10px] text-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Sort Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([
            { key: 'views' as SortKey, label: 'Просмотры', icon: <Eye className="w-3.5 h-3.5" /> },
            { key: 'favorites' as SortKey, label: 'Избранное', icon: <Heart className="w-3.5 h-3.5" /> },
            { key: 'cart_adds' as SortKey, label: 'В корзину', icon: <ShoppingCart className="w-3.5 h-3.5" /> },
            { key: 'orders' as SortKey, label: 'Заказы', icon: <Package className="w-3.5 h-3.5" /> },
            { key: 'purchases' as SortKey, label: 'Покупки', icon: <TrendingUp className="w-3.5 h-3.5" /> },
            { key: 'returns' as SortKey, label: 'Возвраты', icon: <RotateCcw className="w-3.5 h-3.5" /> },
            { key: 'conversion' as SortKey, label: 'Конверсия', icon: <BarChart3 className="w-3.5 h-3.5" /> },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                sortBy === key
                  ? 'bg-accent text-text-inverse'
                  : 'bg-surface text-text-secondary border border-border'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Products Table */}
        <div className="card-premium overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary">Товар</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><Eye className="w-3 h-3" /> Просм.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><Heart className="w-3 h-3" /> Избр.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><ShoppingCart className="w-3 h-3" /> Корз.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><Package className="w-3 h-3" /> Зак.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><TrendingUp className="w-3 h-3" /> Прод.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><RotateCcw className="w-3 h-3" /> Возвр.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><BarChart3 className="w-3 h-3" /> Конв.%</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">
                    <span className="flex items-center justify-end gap-1"><Package className="w-3 h-3" /> Скл.</span>
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-text-secondary">Цена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-border/50">
                {analyticsLoading ? (
                  <tr><td colSpan={10} className="text-center py-10 text-text-tertiary">
                    <span className="w-6 h-6 border-3 border-accent border-t-transparent rounded-full animate-spin inline-block" />
                  </td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-10 text-text-tertiary">Нет данных</td></tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.product_id} className="hover:bg-surface-muted/30 transition">
                      <td className="px-4 py-3">
                        <Link to={`/nanyy/products/${p.product_id}/edit`} className="font-medium text-text hover:underline text-xs">
                          {getLocalizedValue(p.name, 'ru')}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-text">{p.views}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-text">{p.favorites}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-text">{p.cart_adds}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-text">{p.orders}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-green-600 dark:text-green-400 font-semibold">{p.purchases}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-red-500 dark:text-red-400">{p.returns}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs">
                        <span className={`font-semibold ${p.conversion >= 5 ? 'text-green-600 dark:text-green-400' : p.conversion >= 2 ? 'text-amber-600 dark:text-amber-400' : 'text-text-secondary'}`}>
                          {p.conversion}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-mono text-xs ${p.stock <= 0 ? 'text-red-500' : p.stock < 10 ? 'text-amber-500' : 'text-text'}`}>
                          {p.stock}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-xs text-text">{formatPrice(p.price)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};
