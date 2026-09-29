import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Language } from '../lib/translations';
import { getColorScheme, onColorSchemeChange, syncTelegramChrome, type ColorScheme } from '../lib/telegram';

/**
 * 'system' follows Telegram's colour scheme (or the OS preference outside
 * Telegram); the explicit values pin it.
 *
 * This used to be `type Theme = 'light'` and applyTheme() only ever *removed*
 * the `dark` class, so the dark palette in index.css and ~400 `dark:`
 * modifiers across the components were unreachable: a user with a dark Telegram
 * got a white app dropped into a dark client.
 */
export type Theme = 'system' | 'light' | 'dark';

interface AppStore {
  language: Language;
  setLanguage: (language: Language) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The scheme actually rendered right now, after resolving 'system'. */
  resolvedTheme: ColorScheme;
  telegramUserId: number | null;
  setTelegramUserId: (id: number | null) => void;
  isRegistered: () => boolean;
  getUserId: () => number;
}

/** Matches --bg in index.css for each scheme. */
const PAGE_BACKGROUND: Record<ColorScheme, string> = {
  light: '#F2F4F8',
  dark: '#07090D',
};

function resolveTheme(theme: Theme): ColorScheme {
  return theme === 'system' ? getColorScheme() : theme;
}

function applyTheme(theme: Theme): ColorScheme {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  // Keep the browser/Telegram chrome in step with the page.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', PAGE_BACKGROUND[resolved]);
  syncTelegramChrome(PAGE_BACKGROUND[resolved]);

  return resolved;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      language: 'ru',
      setLanguage: (language) => set({ language }),
      theme: 'system' as Theme,
      resolvedTheme: 'light' as ColorScheme,
      setTheme: (theme) => {
        set({ theme, resolvedTheme: applyTheme(theme) });
      },
      telegramUserId: null,
      setTelegramUserId: (id) => set({ telegramUserId: id }),
      // "Registered" now means exactly one thing: we have a Telegram identity.
      // The former phone-based registration is gone — see useUserId().
      isRegistered: () => !!get().getUserId(),
      getUserId: () => {
        const state = get();
        if (state.telegramUserId) return state.telegramUserId;
        try {
          const liveUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
          if (liveUser?.id) return liveUser.id;
        } catch { /* noop */ }
        return 0;
      },
    }),
    {
      name: 'app-storage',
      version: 2,
      migrate: (persisted, version) => {
        const state = { ...(persisted as Record<string, unknown>) };
        // v0 persisted `registeredName`/`registeredPhone`, which acted as a
        // self-declared identity. Drop them so stale values cannot linger.
        delete state.registeredName;
        delete state.registeredPhone;
        // v0/v1 could only ever store 'light' — that was the sole option, not a
        // user's choice. Returning users should follow their Telegram theme
        // rather than stay pinned to light for ever.
        if (version < 2) delete state.theme;
        return state as unknown as AppStore;
      },
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        telegramUserId: state.telegramUserId,
      }) as unknown as AppStore,
      onRehydrateStorage: () => (state) => {
        const theme: Theme =
          state?.theme === 'light' || state?.theme === 'dark' ? state.theme : 'system';
        if (state) {
          state.theme = theme;
          state.resolvedTheme = applyTheme(theme);
        }
      },
    }
  )
);

/**
 * Apply the theme now and keep following the platform while `theme` is
 * 'system'. Returns an unsubscribe function.
 *
 * Called from main.tsx before render so the first paint is already in the right
 * scheme — applying it from an effect would flash light for a frame.
 */
export function initTheme(): () => void {
  const apply = () => {
    useAppStore.setState({ resolvedTheme: applyTheme(useAppStore.getState().theme) });
  };

  apply();

  return onColorSchemeChange(() => {
    if (useAppStore.getState().theme === 'system') apply();
  });
}
