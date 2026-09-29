import { ShoppingCart, Package, User, LayoutGrid, Heart } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';
import { useCartStore } from '../store/useCartStore';
import { useFavoriteIds } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import { cn } from '../lib/utils';

/**
 * Floating glass tab bar.
 *
 * It sits `--bottom-nav-gap` above the bottom edge (plus the home-indicator
 * inset) instead of spanning it, so content visibly scrolls behind it. Layout
 * reserves `--bottom-nav-height + --bottom-nav-gap + safe area` — keep the two
 * in step through the CSS variables rather than hard-coding either.
 */
export const BottomNav = () => {
  const { t, language } = useTranslation();
  const location = useLocation();
  const totalItems = useCartStore((state) => state.getTotalItems());
  const userId = useUserId();
  const { data: favoriteIds = [] } = useFavoriteIds(userId);

  const navItems = [
    { path: '/catalog', icon: LayoutGrid, label: t('catalog') },
    { path: '/favorites', icon: Heart, label: language === 'ru' ? 'Избранное' : 'Tanlangan', badge: favoriteIds.length },
    { path: '/cart', icon: ShoppingCart, label: t('cart'), badge: totalItems },
    { path: '/orders', icon: Package, label: t('orders') },
    { path: '/profile', icon: User, label: t('profile') },
  ];

  return (
    <nav
      className="fixed left-0 right-0 z-50 px-3 pointer-events-none bottom-nav-bar"
      style={{ bottom: 'calc(var(--bottom-nav-gap) + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="mx-auto max-w-md glass-card rounded-[1.75rem] flex items-stretch justify-around px-1.5 pointer-events-auto"
        style={{ height: 'var(--bottom-nav-height)' }}
      >
        {navItems.map(({ path, icon: Icon, label, badge }) => {
          const isActive = location.pathname === path ||
            (path === '/catalog' && location.pathname.startsWith('/product'));
          const isFavorites = path === '/favorites';
          return (
            <Link
              key={path}
              to={path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center flex-1 gap-0.5 relative transition-colors duration-200',
                isActive ? 'text-accent' : 'text-text-tertiary active:text-text-secondary'
              )}
            >
              <div className="relative">
                <div className={cn(
                  'w-11 h-7 flex items-center justify-center rounded-full transition-all duration-300',
                  isActive && 'bg-accent/15'
                )}>
                  <Icon
                    className="w-5 h-5 transition-all duration-200"
                    strokeWidth={isActive ? 2.4 : 1.8}
                    style={isActive && isFavorites ? { fill: 'currentColor' } : undefined}
                  />
                </div>
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1 right-0 min-w-[16px] h-4 flex items-center justify-center px-1 bg-accent text-text-on-accent text-2xs font-bold rounded-full ring-2 ring-surface animate-bounce-in tabular">
                    {badge}
                  </span>
                )}
              </div>
              <span className={cn(
                'text-2xs transition-all duration-200',
                isActive ? 'font-bold' : 'font-semibold'
              )}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
