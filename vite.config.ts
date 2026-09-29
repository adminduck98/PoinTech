import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Optional dev-only proxy to Supabase.
 *
 * Set SUPABASE_PROXY_TARGET to the project URL and point VITE_SUPABASE_URL at
 * the dev server itself (http://localhost:5173). Every Supabase call then goes
 * browser → dev server → Supabase instead of browser → Supabase directly, which
 * removes two whole classes of local-only failure:
 *
 *   * CORS. The request becomes same-origin, so nothing depends on the page's
 *     address being listed in the function's ALLOWED_ORIGINS — a mismatch there
 *     shows up as "неверный пароль" on the login form, which sends you looking
 *     in entirely the wrong place.
 *   * Networks that mangle the browser's direct connection to supabase.co.
 *     Preflights get through, the POST that follows is dropped, and the app
 *     sees a failed fetch it cannot explain. Node's HTTP/1.1 request from the
 *     dev server goes through unaffected.
 *
 * Leave SUPABASE_PROXY_TARGET unset and everything behaves exactly as before.
 * `server.proxy` applies to `vite dev` only — production builds never see it,
 * so the deployed app still talks to Supabase directly.
 */
export default defineConfig(({ mode, command }) => {
  // Third argument '' loads every variable, not just the VITE_-prefixed ones:
  // the target must not be exposed to the bundle. envDir is '.' rather than
  // process.cwd() because tsconfig.node.json has no Node types.
  const env = loadEnv(mode, '.', '');
  const target = env.SUPABASE_PROXY_TARGET;

  // A production bundle carries VITE_SUPABASE_URL as a literal. With the dev
  // proxy configured that value is the dev server's own address, and a build
  // made from this .env would ship a shop that calls localhost from a
  // customer's phone — failing everywhere, for everyone, with no clue why.
  // Vercel supplies the real URL from its own environment, so this only fires
  // for a build run against the local file.
  if (command === 'build' && /localhost|127\.0\.0\.1/.test(env.VITE_SUPABASE_URL ?? '')) {
    throw new Error(
      `VITE_SUPABASE_URL=${env.VITE_SUPABASE_URL} — это адрес дев-сервера, он годится только для \`vite dev\`.\n` +
      'Для сборки подставьте настоящий адрес проекта, например:\n' +
      `  VITE_SUPABASE_URL=${env.SUPABASE_PROXY_TARGET ?? 'https://<ref>.supabase.co'} npm run build`,
    );
  }

  const supabasePaths = ['/rest/v1', '/functions/v1', '/storage/v1', '/auth/v1'];
  const proxy = target
    ? Object.fromEntries(
        supabasePaths.map((path) => [
          path,
          {
            target,
            changeOrigin: true,
            secure: true,
            // The browser's own Origin would otherwise arrive at the edge
            // function, which answers it with CORS headers meant for a
            // cross-origin caller. Same-origin requests need none of that.
            headers: { origin: target },
          },
        ]),
      )
    : undefined;

  return {
    plugins: [react()],
    server: proxy ? { proxy } : undefined,
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'supabase': ['@supabase/supabase-js'],
            'router': ['react-router-dom'],
            'query': ['@tanstack/react-query'],
            'zustand': ['zustand'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand'],
    },
  };
});
