import { ShoppingBag, User, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCartStore } from '../store/useCartStore';
import { useUnreadNotificationCount } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import { Logo } from './Logo';

/** Round glass icon button used in the top bar. */
const iconButton =
  'relative w-10 h-10 flex items-center justify-center rounded-full bg-surface/70 border border-border-subtle text-text shadow-sm transition-all duration-200 active:scale-90 hover:border-border-strong';

const Badge = ({ value }: { value: number }) => (
  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 bg-accent text-text-on-accent text-2xs font-bold rounded-full ring-2 ring-bg animate-bounce-in tabular">
    {value > 99 ? '99+' : value}
  </span>
);

export const Header = () => {
  const totalItems = useCartStore((state) => state.getTotalItems());
  const userId = useUserId();
  const { data: unreadCount = 0 } = useUnreadNotificationCount(userId);

  return (
    <header className="sticky top-0 z-50 glass border-b border-[color:var(--glass-border)]">
      <div className="px-4 h-14 flex items-center justify-between">
        <Link to="/catalog" className="flex items-center gap-2.5" aria-label="Point Tech">
          <Logo size="sm" variant="icon" />
          <span className="font-display text-[13px] font-semibold tracking-[0.06em] text-text uppercase whitespace-nowrap">
            Point <span className="text-accent">Tech</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link to="/notifications" className={iconButton} aria-label="Notifications">
            <Bell className="w-[18px] h-[18px]" strokeWidth={2} />
            {unreadCount > 0 && <Badge value={unreadCount} />}
          </Link>

          <Link to="/cart" className={iconButton} aria-label="Cart">
            <ShoppingBag className="w-[18px] h-[18px]" strokeWidth={2} />
            {totalItems > 0 && <Badge value={totalItems} />}
          </Link>

          <Link to="/profile" className={iconButton} aria-label="Profile">
            <User className="w-[18px] h-[18px]" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </header>
  );
};
