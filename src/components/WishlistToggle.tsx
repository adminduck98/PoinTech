import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, BellOff, BellRing, Loader2, TrendingDown, ShoppingCart } from 'lucide-react';
import { useFavoritePrefs, useUpdateFavoritePrefs } from '../lib/supabase/hooks';
import { haptic } from '../lib/telegram';
import { useUserId } from '../hooks/useUserId';
import { toast } from './Toast';
import { Portal } from './Portal';
import { BottomSheet } from './BottomSheet';

interface WishlistToggleProps {
  productId: string;
  isFavorite: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onToggleFavorite: (e?: any) => void;
  language: 'ru' | 'uz';
  variant?: 'card' | 'detail';
  pulse?: boolean;
}

export const WishlistToggle = ({
  productId,
  isFavorite,
  onToggleFavorite,
  language,
  variant = 'card',
  pulse = false,
}: WishlistToggleProps) => {
  const userId = useUserId();
  const { data: prefs } = useFavoritePrefs(userId, productId);
  const updatePrefs = useUpdateFavoritePrefs(userId);
  const [showPrefs, setShowPrefs] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef<'notify_price' | 'notify_stock' | null>(null);

  /**
   * Below `sm` the preferences open in a BottomSheet, above it in a positioned
   * dropdown — two different components for the same state.
   *
   * This polled `window.innerWidth` on every resize event, which fires
   * continuously during a rotation and does work on each one. A media query
   * fires once, when the answer actually changes, and matches the `sm`
   * breakpoint the rest of the component is styled against instead of
   * restating 640 as a number that can drift from the Tailwind config.
   *
   * The popover is also closed on a mode change: it used to stay open, so
   * rotating across the boundary swapped the sheet for a dropdown positioned
   * from coordinates measured in the old layout.
   */
  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const apply = () => {
      setIsMobile(!query.matches);
      setShowPrefs(false);
    };
    setIsMobile(!query.matches);
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!showPrefs || isMobile) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setShowPrefs(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPrefs(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showPrefs, isMobile]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite();
    haptic.select();
    setShowPrefs(false);
  }, [onToggleFavorite]);

  const handlePrefToggle = useCallback(async (field: 'notify_price' | 'notify_stock', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isFavorite) return;
    const newValue = !(prefs?.[field] ?? false);
    savingRef.current = field;
    updatePrefs.mutate({ productId, prefs: { [field]: newValue } });
    haptic.select();

    if (field === 'notify_price') {
      toast.success(
        newValue
          ? language === 'ru' ? 'Напоминание о скидке включено' : 'Chegirma eslatmasi yoqildi'
          : language === 'ru' ? 'Напоминание о скидке отключено' : 'Chegirma eslatmasi o\'chirildi'
      );
    } else {
      toast.success(
        newValue
          ? language === 'ru' ? 'Напоминание о наличии включено' : 'Mavjudlik eslatmasi yoqildi'
          : language === 'ru' ? 'Напоминание о наличии отключено' : 'Mavjudlik eslatmasi o\'chirildi'
      );
    }

    // Auto-close after selection
    setTimeout(() => setShowPrefs(false), 300);
  }, [isFavorite, prefs, updatePrefs, productId, language]);

  const handleShowPrefs = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isFavorite) return;
    setShowPrefs((v) => !v);
    haptic.select();
  }, [isFavorite]);

  const isSaving = updatePrefs.isPending;
  const savingField = savingRef.current;

  // Compute dropdown position for desktop portal with boundary checks
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useEffect(() => {
    if (showPrefs && !isMobile && bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect();
      const dropdownWidth = variant === 'detail' ? 240 : 200;
      const padding = 8;

      if (variant === 'detail') {
        // Center dropdown on button with boundary checks
        let left = rect.left + rect.width / 2 - dropdownWidth / 2;
        if (left < padding) left = padding;
        if (left + dropdownWidth > window.innerWidth - padding) {
          left = window.innerWidth - dropdownWidth - padding;
        }
        setDropdownPos({ top: rect.bottom + 8, left });
      } else {
        // Card variant: align to right edge of button
        let left = rect.right - dropdownWidth;
        if (left < padding) left = padding;
        if (left + dropdownWidth > window.innerWidth - padding) {
          left = window.innerWidth - dropdownWidth - padding;
        }
        setDropdownPos({ top: rect.bottom + 4, left });
      }
    }
  }, [showPrefs, isMobile, variant]);

  const renderPrefButtons = (compact = false) => (
    <>
      <button
        onClick={(e) => handlePrefToggle('notify_price', e)}
        disabled={isSaving}
        className={`w-full flex items-center ${compact ? 'gap-2 px-2.5 py-2.5' : 'gap-2.5 px-2.5 py-3'} rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50 ${
          prefs?.notify_price
            ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
            : 'hover:bg-surface-muted'
        }`}
      >
        {isSaving && savingField === 'notify_price' ? (
          <Loader2 className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} animate-spin text-text-tertiary`} />
        ) : prefs?.notify_price ? (
          <div className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center`}>
            <TrendingDown className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-green-600 dark:text-green-400`} />
          </div>
        ) : (
          <div className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded-lg bg-surface-muted flex items-center justify-center`}>
            <TrendingDown className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-text-tertiary`} />
          </div>
        )}
        <div className="flex-1 text-left">
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-text`}>
            {language === 'ru' ? 'Напомнить при скидке' : 'Chegirmada eslatish'}
          </span>
        </div>
        {prefs?.notify_price && (
          <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400`}>
            {language === 'ru' ? 'ВКЛ' : 'YOQ'}
          </span>
        )}
      </button>
      <button
        onClick={(e) => handlePrefToggle('notify_stock', e)}
        disabled={isSaving}
        className={`w-full flex items-center ${compact ? 'gap-2 px-2.5 py-2.5' : 'gap-2.5 px-2.5 py-3'} rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-50 ${
          prefs?.notify_stock
            ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            : 'hover:bg-surface-muted'
        }`}
      >
        {isSaving && savingField === 'notify_stock' ? (
          <Loader2 className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} animate-spin text-text-tertiary`} />
        ) : prefs?.notify_stock ? (
          <div className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center`}>
            <ShoppingCart className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-blue-600 dark:text-blue-400`} />
          </div>
        ) : (
          <div className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded-lg bg-surface-muted flex items-center justify-center`}>
            <ShoppingCart className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-text-tertiary`} />
          </div>
        )}
        <div className="flex-1 text-left">
          <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-text`}>
            {language === 'ru' ? 'Напомнить при наличии' : 'Mavjud bo\'lganda eslatish'}
          </span>
        </div>
        {prefs?.notify_stock && (
          <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400`}>
            {language === 'ru' ? 'ВКЛ' : 'YOQ'}
          </span>
        )}
      </button>
    </>
  );

  // Detail variant
  if (variant === 'detail') {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggle}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border transition-all duration-150 active:scale-95 ${
            isFavorite
              ? 'bg-danger-light border-danger/30'
              : 'bg-surface border-border'
          }`}
        >
          <Heart
            className={`w-5 h-5 transition-all duration-150 ${
              isFavorite ? 'text-danger fill-danger' : 'text-text-secondary'
            }`}
          />
        </button>

        {isFavorite && (
          <>
            <button
              ref={bellRef}
              onClick={handleShowPrefs}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border transition-all duration-150 active:scale-95 bg-surface border-border ${
                (prefs?.notify_price || prefs?.notify_stock) ? 'ring-2 ring-success/50' : ''
              }`}
            >
              {(prefs?.notify_price || prefs?.notify_stock) ? (
                <BellRing className="w-5 h-5 text-success" />
              ) : (
                <BellOff className="w-5 h-5 text-text-tertiary" />
              )}
            </button>

            {/* Mobile: BottomSheet */}
            {isMobile && (
              <BottomSheet
                isOpen={showPrefs}
                onClose={() => setShowPrefs(false)}
                title={language === 'ru' ? 'Уведомления' : 'Bildirishnomalar'}
              >
                <div className="px-2 space-y-1">
                  {renderPrefButtons(true)}
                </div>
              </BottomSheet>
            )}

            {/* Desktop: Portal dropdown */}
            {!isMobile && showPrefs && (
              <Portal>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-[9998] pointer-events-auto"
                  onClick={() => setShowPrefs(false)}
                />
                <div
                  ref={dropdownRef}
                  className="fixed bg-surface rounded-xl shadow-float border border-border p-2 min-w-[240px] animate-fade-in-down"
                  style={{
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    zIndex: 9999,
                  }}
                >
                  <p className="text-xs font-semibold text-text-secondary px-2.5 mb-1.5">
                    {language === 'ru' ? 'Уведомления' : 'Bildirishnomalar'}
                  </p>
                  {renderPrefButtons()}
                </div>
              </Portal>
            )}
          </>
        )}
      </div>
    );
  }

  // Card variant — compact
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
      {isFavorite && (
        <>
          <button
            ref={bellRef}
            onClick={handleShowPrefs}
            className={`w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm transition-all duration-150 hover:scale-110 active:scale-90 ${
              (prefs?.notify_price || prefs?.notify_stock) ? 'ring-2 ring-success/50' : ''
            }`}
          >
            {(prefs?.notify_price || prefs?.notify_stock) ? (
              <BellRing className="w-3.5 h-3.5 text-success" />
            ) : (
              <BellOff className="w-3.5 h-3.5 text-[#5C6370]" />
            )}
          </button>

          {/* Mobile: BottomSheet */}
          {isMobile && (
            <BottomSheet
              isOpen={showPrefs}
              onClose={() => setShowPrefs(false)}
              title={language === 'ru' ? 'Уведомления' : 'Bildirishnomalar'}
            >
              <div className="px-2 space-y-1">
                {renderPrefButtons(true)}
              </div>
            </BottomSheet>
          )}

          {/* Desktop: Portal dropdown */}
          {!isMobile && showPrefs && (
            <Portal>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-[9998] pointer-events-auto"
                onClick={() => setShowPrefs(false)}
              />
              <div
                ref={dropdownRef}
                className="fixed bg-surface rounded-xl shadow-float border border-border p-2 min-w-[200px] animate-fade-in-down"
                style={{
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  zIndex: 9999,
                }}
              >
                {renderPrefButtons()}
              </div>
            </Portal>
          )}
        </>
      )}

      <button
        onClick={handleToggle}
        aria-label={language === 'ru' ? 'В избранное' : 'Tanlanganlarga'}
        className={`w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm ring-1 ring-black/5 flex items-center justify-center shadow-sm transition-all duration-150 hover:scale-110 active:scale-90 ${pulse ? 'animate-heart-pulse' : ''}`}
      >
        <Heart
          className={`w-4 h-4 transition-all duration-150 ${
            isFavorite ? 'text-danger fill-danger' : 'text-[#5C6370]'
          }`}
        />
      </button>
    </div>
  );
};
