import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
// Self-hosted, subset by unicode-range: a device only downloads the Cyrillic
// or Latin files it actually renders, and nothing depends on Google Fonts
// being reachable from inside the Telegram webview.
import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import './index.css';
import { captureException, initSentry } from './lib/sentry';
import { getTelegramUser, refreshTg } from './lib/telegram';
import { initTheme, useAppStore } from './store/useAppStore';

// Before anything else that can throw, so the handlers below have somewhere to
// report to. src/lib/sentry.ts was written and then never called from
// anywhere: @sentry/react shipped in every bundle while no error ever left the
// browser. No-op when VITE_SENTRY_DSN is unset.
initSentry();

// Global error handlers
window.addEventListener('unhandledrejection', (event) => {
  captureException(event.reason, { source: 'unhandledrejection' });
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  captureException(event.error ?? event.message, { source: 'window.onerror' });
});

const MAX_INIT_ATTEMPTS = 8;

async function initializeUser(attempt = 1): Promise<void> {
  refreshTg();
  const tgUser = getTelegramUser();

  if (tgUser?.id) {
    useAppStore.getState().setTelegramUserId(tgUser.id);

    try {
      const { userQueries } = await import('./lib/supabase/hooks');
      await userQueries.upsert(tgUser.id, {
        first_name: tgUser.first_name || '',
        username: tgUser.username || null,
        language: tgUser.language_code || 'ru',
      });
    } catch (error) {
      if (attempt < MAX_INIT_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, Math.min(attempt * 1000, 5000)));
        return initializeUser(attempt + 1);
      }
      // Eight failed attempts is not a flaky network any more — the user row
      // was never written, and everything keyed on it (orders, favourites,
      // notifications) will misbehave for this customer. Report the last one
      // rather than exhausting the retries in silence.
      captureException(error, { source: 'initializeUser', attempts: attempt });
    }
  } else {
    if (attempt < MAX_INIT_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, Math.min(attempt * 500, 3000)));
      return initializeUser(attempt + 1);
    }
  }
}

initializeUser();

// telegram-web-app.js can in rare cases finish initializing after our
// retry loop above has already given up (very slow connection, app
// backgrounded during load, etc). Catch that case too: if the tab
// becomes visible again and we still don't have a Telegram user id,
// try once more.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (useAppStore.getState().telegramUserId) return;
  refreshTg();
  const tgUser = getTelegramUser();
  if (tgUser?.id) {
    initializeUser();
  }
});

// Resolve the colour scheme before the first paint, and keep following
// Telegram's theme while the user has not pinned one.
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
