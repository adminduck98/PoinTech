import { WifiOff, RotateCw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { NoTelegramSessionError } from '../lib/clientApi';

interface QueryErrorProps {
  /** The error react-query surfaced, used to tell "outside Telegram" apart. */
  error?: unknown;
  /** Refetch. Usually `() => void refetch()` from the query it belongs to. */
  onRetry?: () => void;
  /** `page` fills a screen, `inline` sits inside an existing section. */
  variant?: 'page' | 'inline';
  /** The query is paused because the device is offline — see isQueryOffline. */
  offline?: boolean;
}


/**
 * Shown when a query fails.
 *
 * Every list screen used to render only `isLoading` and `data ?? []`, so a
 * failed request was indistinguishable from a genuinely empty result: a network
 * drop, an RLS denial and an empty catalogue all rendered "Нет товаров", with
 * no way to retry. Failing loudly is the point — a customer who sees an empty
 * shop leaves, a customer who sees "не удалось загрузить" taps retry.
 */
export const QueryError = ({ error, onRetry, variant = 'page', offline = false }: QueryErrorProps) => {
  const language = useAppStore((s) => s.language);

  // Running outside Telegram is not a failure to retry — it is a missing
  // identity, and retrying will fail identically every time.
  const noSession =
    !offline &&
    (error instanceof NoTelegramSessionError ||
      (error instanceof Error && error.name === 'NoTelegramSessionError'));

  const title = noSession
    ? language === 'ru' ? 'Откройте магазин в Telegram' : "Do'konni Telegramda oching"
    : offline
      ? language === 'ru' ? 'Нет подключения' : 'Aloqa yo\'q'
      : language === 'ru' ? 'Не удалось загрузить' : 'Yuklab bo\'lmadi';

  const hint = noSession
    ? language === 'ru'
      ? 'Эти данные привязаны к вашему аккаунту Telegram.'
      : "Bu ma'lumotlar Telegram hisobingizga bog'langan."
    : offline
      ? language === 'ru'
        // react-query resumes a paused query by itself once the connection is
        // back, so promise that rather than demanding an action.
        ? 'Загрузка продолжится автоматически, как только появится сеть.'
        : "Aloqa paydo bo'lishi bilan yuklash o'zi davom etadi."
      : language === 'ru'
        ? 'Проверьте соединение и попробуйте ещё раз.'
        : "Aloqani tekshiring va qayta urinib ko'ring.";

  return (
    <div
      className={
        variant === 'page'
          ? 'flex flex-col items-center justify-center py-24 px-6 text-center'
          : 'flex flex-col items-center justify-center py-10 px-4 text-center'
      }
    >
      <div className="w-14 h-14 rounded-2xl bg-surface-muted border border-border flex items-center justify-center mb-4">
        <WifiOff className="w-6 h-6 text-text-tertiary" />
      </div>

      <p className="text-sm font-semibold text-text mb-1">{title}</p>
      <p className="text-xs text-text-secondary max-w-[260px] leading-relaxed">{hint}</p>

      {!noSession && onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 px-5 h-11 rounded-xl border border-border bg-surface text-sm font-semibold text-text active:scale-[0.98] transition-all"
        >
          <RotateCw className="w-4 h-4" />
          {language === 'ru' ? 'Повторить' : "Qayta urinish"}
        </button>
      )}
    </div>
  );
};
