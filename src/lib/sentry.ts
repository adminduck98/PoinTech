import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/** Whether a DSN was configured — lets callers skip Sentry-only work entirely. */
export const sentryEnabled = !!dsn;

/**
 * No DSN means no project to report to (local dev, or a deploy that hasn't
 * been given one yet). Skipping init in that case, rather than calling
 * Sentry.init with an empty dsn, keeps Sentry fully inert instead of buffering
 * events it can never send.
 *
 * `import.meta.env.VITE_SENTRY_DSN` is substituted at build time, so an unset
 * DSN collapses this to an unconditional `return`, the `Sentry.init` call
 * becomes unreachable and the whole SDK is tree-shaken out: measured at 73 kB
 * of the index chunk (467 kB with a DSN, 394 kB without). Deploys that do not
 * use Sentry pay nothing for it.
 *
 * Called from src/main.tsx before the first render.
 */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

/** Reports to Sentry when configured, otherwise just logs — same call site either way. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (sentryEnabled) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } else {
    console.error(error, context);
  }
}
