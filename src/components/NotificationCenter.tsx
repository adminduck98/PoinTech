import { useNavigate } from 'react-router-dom';
import { Bell, Package, Tag, AlertCircle, Trash2, TrendingDown, ShoppingCart, MessageSquare, RotateCcw } from 'lucide-react';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useClearReadNotifications } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import { useTranslation } from '../hooks/useTranslation';
import { QueryError } from './QueryError';
import { isQueryOffline } from '../lib/queryState';

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  order_accepted: Package,
  order_new: Package,
  order_processing: Package,
  order_assembling: Package,
  order_assembled: Package,
  order_shipping: Package,
  order_shipped: Package,
  order_delivered: Package,
  order_returned: Trash2,
  order_cancelled: AlertCircle,
  order_return_requested: AlertCircle,
  promo: Tag,
  promo_new: Tag,
  system: Bell,
  cancellation: AlertCircle,
  price_drop: TrendingDown,
  stock_available: ShoppingCart,
  new_message: MessageSquare,
  admin_new_message: MessageSquare,
  return_pending: RotateCcw,
  return_approved: RotateCcw,
  return_rejected: RotateCcw,
  return_refunded: RotateCcw,
};

function getNotificationRoute(type: string, data: Record<string, unknown> | null): string {
  if (!data) return '/notifications';

  switch (type) {
    case 'new_message':
    case 'admin_new_message': {
      const orderId = data.order_id as string | undefined;
      return orderId ? `/orders?orderId=${orderId}&chat=1` : '/orders';
    }

    case 'price_drop':
    case 'stock_available': {
      const slug = data.slug as string | undefined;
      return slug ? `/product/${slug}` : '/favorites';
    }

    case 'return_pending':
    case 'return_approved':
    case 'return_rejected':
    case 'return_refunded': {
      const orderId = data.order_id as string | undefined;
      return orderId ? `/orders?orderId=${orderId}` : '/orders';
    }

    default: {
      if (type.startsWith('order_')) {
        const orderId = data.order_id as string | undefined;
        return orderId ? `/orders?orderId=${orderId}` : '/orders';
      }
      return '/notifications';
    }
  }
}

export const NotificationCenter = () => {
  const userId = useUserId();
  const { data: notifications = [], isError, error, refetch, fetchStatus } = useNotifications(userId);
  const offline = isQueryOffline(fetchStatus);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead(userId);
  const clearRead = useClearReadNotifications(userId);
  const navigate = useNavigate();
  const { language } = useTranslation();

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const readCount = notifications.filter((n) => n.is_read).length;

  return (
    <div className="space-y-3">
      {isError || offline ? (
        <QueryError error={error} offline={offline} onRetry={() => void refetch()} variant="inline" />
      ) : notifications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
          <p className="text-sm text-text-secondary">
            {language === 'ru' ? 'Нет уведомлений' : "Bildirishnomalar yo'q"}
          </p>
        </div>
      ) : (
        <>
          {unreadCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {unreadCount} {language === 'ru' ? 'непрочитанных' : "o'qilmagan"}
              </span>
              <button onClick={() => markAllRead.mutate()} className="text-xs text-text font-medium hover:underline">
                {language === 'ru' ? 'Прочитать все' : "Barchasini o'qish"}
              </button>
            </div>
          )}
          {readCount > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => clearRead.mutate()}
                className="text-xs text-danger hover:opacity-80 font-medium"
              >
                {language === 'ru' ? 'Очистить прочитанные' : "O'qilganlarni tozalash"}
              </button>
            </div>
          )}
          <div className="space-y-2">
            {notifications.map((notification) => {
              const Icon = NOTIFICATION_ICONS[notification.type] || Bell;
              const data = notification.data && typeof notification.data === 'object'
                ? notification.data as Record<string, unknown>
                : null;
              const route = getNotificationRoute(notification.type, data);

              return (
                <button
                  key={notification.id}
                  onClick={() => {
                    markRead.mutate(notification.id);
                    navigate(route);
                  }}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition ${
                    notification.is_read
                      ? 'bg-surface'
                      : 'bg-bg dark:bg-surface-muted/50 border border-border'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    notification.is_read ? 'bg-surface-muted' : 'bg-accent text-text-inverse'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${notification.is_read ? 'text-text' : 'text-text'}`}>
                      {notification.title}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{notification.body}</p>
                    <p className="text-2xs text-text-tertiary mt-1">
                      {new Date(notification.created_at).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {!notification.is_read && (
                    <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-2" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
