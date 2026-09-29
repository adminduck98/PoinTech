import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { useToastStore } from './toast-api';
import type { Toast } from './toast-api';

// Re-export toast API for backward compatibility
// eslint-disable-next-line react-refresh/only-export-components
export { toast, useToastStore } from './toast-api';
export type { Toast } from './toast-api';

const toastConfig = {
  success: {
    icon: CheckCircle,
    bg: 'bg-success-light dark:bg-success/10',
    border: 'border-success/20 dark:border-success/30',
    text: 'text-success-dark dark:text-success',
    iconColor: 'text-success',
  },
  error: {
    icon: XCircle,
    bg: 'bg-danger-light dark:bg-danger/10',
    border: 'border-danger/20 dark:border-danger/30',
    text: 'text-danger-dark dark:text-danger',
    iconColor: 'text-danger',
  },
  warning: {
    icon: AlertCircle,
    bg: 'bg-warning-light dark:bg-warning/10',
    border: 'border-warning/20 dark:border-warning/30',
    text: 'text-warning-dark dark:text-warning',
    iconColor: 'text-warning',
  },
  info: {
    icon: Info,
    // Was bg-navy-50 / border-navy-200 / text-navy-800 / text-navy-500 — the
    // navy palette is not defined anywhere in the config, so info toasts
    // rendered with no background, no border and inherited text colour.
    bg: 'bg-info-light dark:bg-info/10',
    border: 'border-info/20 dark:border-info/30',
    text: 'text-info dark:text-info',
    iconColor: 'text-info',
  },
};

const ToastItem = ({ toast: t }: { toast: Toast }) => {
  const { removeToast } = useToastStore();
  const config = toastConfig[t.type];
  const Icon = config.icon;

  return (
    <div
      className="glass-card rounded-2xl p-3 sm:p-3.5 flex items-center gap-3 min-w-0 sm:min-w-[280px] max-w-[calc(100vw-2rem)] sm:max-w-sm animate-fade-in-down"
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${config.bg} ${config.iconColor}`}>
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <p className="flex-1 text-sm font-semibold text-text">{t.message}</p>
      <button
        onClick={() => removeToast(t.id)}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-text-tertiary"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastContainer = () => {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-sm"
      style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-sm">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
};
