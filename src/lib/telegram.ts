declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          start_param?: string;
        };
        version: string;
        platform: string;
        colorScheme: 'light' | 'dark';
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        headerColor: string;
        backgroundColor: string;
        BackButton: {
          isVisible: boolean;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          show: () => void;
          hide: () => void;
        };
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          isProgressVisible: boolean;
          setText: (text: string) => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          showProgress: (leaveActive?: boolean) => void;
          hideProgress: () => void;
          setParams: (params: {
            text?: string;
            color?: string;
            text_color?: string;
            is_active?: boolean;
            is_visible?: boolean;
          }) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        expand: () => void;
        close: () => void;
        ready: () => void;
        sendData: (data: string) => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
        onEvent: (event: string, handler: () => void) => void;
        offEvent: (event: string, handler: () => void) => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        /** Bot API 7.10+: colour of the strip behind MainButton/SecondaryButton. */
        setBottomBarColor?: (color: string) => void;
      };
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tg: any = undefined;

export function refreshTg() {
  _tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  return _tg;
}

refreshTg();

export { _tg as tg };

export const getTelegramUser = () => {
  const app = _tg || (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
  const user = app?.initDataUnsafe?.user;
  return user;
};

export const getTelegramTheme = () => {
  return _tg?.themeParams || {};
};

// ─── Colour scheme ─────────────────────────────────────────────────────────

export type ColorScheme = 'light' | 'dark';

/**
 * The colour scheme the app should render in.
 *
 * Inside Telegram this follows the client's own theme, which is what a Mini App
 * is expected to do — otherwise a user with a dark Telegram gets a white sheet
 * dropped into it. Outside Telegram it falls back to the OS preference.
 */
export const getColorScheme = (): ColorScheme => {
  refreshTg();
  if (_tg?.colorScheme === 'dark' || _tg?.colorScheme === 'light') {
    return _tg.colorScheme;
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

/**
 * Subscribe to colour-scheme changes from whichever source is authoritative.
 * Returns an unsubscribe function.
 */
export const onColorSchemeChange = (handler: () => void): (() => void) => {
  const cleanups: Array<() => void> = [];

  refreshTg();
  if (_tg?.onEvent) {
    // Telegram fires themeChanged when the user switches theme in the client.
    _tg.onEvent('themeChanged', handler);
    cleanups.push(() => _tg?.offEvent?.('themeChanged', handler));
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', handler);
    cleanups.push(() => query.removeEventListener('change', handler));
  }

  return () => cleanups.forEach((fn) => fn());
};

/**
 * Keep Telegram's own chrome in step with the page.
 *
 * Without this the header and the pull-to-refresh backdrop stay the colour the
 * app was first opened with, which reads as a rendering glitch when the rest of
 * the screen flips.
 */
export const syncTelegramChrome = (background: string) => {
  refreshTg();
  try {
    _tg?.setHeaderColor?.(background);
    _tg?.setBackgroundColor?.(background);
    _tg?.setBottomBarColor?.(background);
  } catch { /* older clients reject unknown colours */ }
};

let _mainButtonCallback: (() => void) | null = null;
let _backButtonCallback: (() => void) | null = null;

export const showMainButton = (text: string, onClick: () => void) => {
  if (!_tg?.MainButton) return;

  if (_mainButtonCallback) {
    _tg.MainButton.offClick(_mainButtonCallback);
  }
  _mainButtonCallback = onClick;
  _tg.MainButton.setText(text);
  _tg.MainButton.onClick(onClick);
  _tg.MainButton.show();
};

export const hideMainButton = () => {
  if (!_tg?.MainButton) return;
  _tg.MainButton.hide();
};

export const showBackButton = (onClick: () => void) => {
  if (!_tg?.BackButton) return;

  if (_backButtonCallback) {
    _tg.BackButton.offClick(_backButtonCallback);
  }
  _backButtonCallback = onClick;
  _tg.BackButton.onClick(onClick);
  _tg.BackButton.show();
};

export const hideBackButton = () => {
  if (!_tg?.BackButton) return;
  if (_backButtonCallback) {
    _tg.BackButton.offClick(_backButtonCallback);
    _backButtonCallback = null;
  }
  _tg.BackButton.hide();
};

// ─── Low-level haptic wrappers ─────────────────────────────────────────────

const impact = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
  if (!_tg?.HapticFeedback) return;
  _tg.HapticFeedback.impactOccurred(style);
};

const notification = (type: 'error' | 'success' | 'warning') => {
  if (!_tg?.HapticFeedback) return;
  _tg.HapticFeedback.notificationOccurred(type);
};

const selectionChanged = () => {
  if (!_tg?.HapticFeedback) return;
  _tg.HapticFeedback.selectionChanged();
};

// ─── Semantic haptic API (use these in UI) ────────────────────────────────

export const haptic = {
  /** Добавление товара в корзину — мягкая вибрация */
  addToCart: () => impact('light'),

  /** Удаление товара из корзины/избранного — мягкая вибрация */
  remove: () => impact('light'),

  /** Выбор опции (размер, цвет) — тактильный отклик */
  select: () => selectionChanged(),

  /** Подтверждение действия — средняя вибрация */
  confirm: () => impact('medium'),

  /** Оплата — средняя вибрация */
  pay: () => impact('medium'),

  /** Успешное действие — уведомление об успехе */
  success: () => notification('success'),

  /** Предупреждение — уведомление-предупреждение */
  warning: () => notification('warning'),

  /** Ошибка — жёсткая вибрация + уведомление об ошибке */
  error: () => {
    impact('heavy');
    notification('error');
  },

  /** Навигация — лёгкая вибрация */
  navigate: () => impact('light'),
};

// ─── Legacy (deprecated — use haptic.* instead) ───────────────────────────

/** @deprecated Use haptic.addToCart() / haptic.confirm() / haptic.pay() instead */
export const hapticFeedback = (type: 'light' | 'medium' | 'heavy' = 'medium') => {
  impact(type);
};

/** @deprecated Use haptic.success() / haptic.error() / haptic.warning() instead */
export const hapticNotification = (type: 'error' | 'success' | 'warning') => {
  notification(type);
};

export const expandApp = () => {
  refreshTg();
  if (!_tg) return;
  _tg.expand();
};

export const closeApp = () => {
  refreshTg();
  if (!_tg) return;
  _tg.close();
};

export const readyApp = () => {
  refreshTg();
  if (!_tg) return;
  _tg.ready();
};

export const isTelegramWebApp = () => {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp;
};
