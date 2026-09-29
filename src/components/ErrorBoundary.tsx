import { Component, ReactNode } from 'react';
import { captureException } from '../lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // This is the last stop for a render crash: past here the customer sees
    // the fallback screen and nobody else finds out. It used to console.error
    // only, which on a phone inside Telegram reaches no one. captureException
    // still logs to the console when no DSN is configured.
    captureException(error, {
      source: 'ErrorBoundary',
      componentStack: errorInfo.componentStack,
    });
  }

  getLanguage(): 'ru' | 'uz' {
    try {
      const state = JSON.parse(localStorage.getItem('app-storage') || '{}');
      return state?.state?.language || 'ru';
    } catch { return 'ru'; }
  }

  render() {
    if (this.state.hasError) {
      const lang = this.getLanguage();
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center px-6">
          <div className="text-center">
            {/* Was bg-red-100 / text-red-500 from Tailwind's default palette,
                with no dark: variant — so the dark theme got a pale pink disc.
                The danger tokens are defined for both themes. */}
            <div className="w-16 h-16 bg-danger/10 dark:bg-danger/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text mb-1">
              {lang === 'ru' ? 'Что-то пошло не так' : "Nimadir noto'g'ri bo'ldi"}
            </h2>
            <p className="text-sm text-text-secondary mb-5">
              {lang === 'ru' ? 'Произошла непредвиденная ошибка' : "Kutilmagan xatolik yuz berdi"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.href = '/catalog';
              }}
              className="btn-brand px-5 py-2.5 rounded-xl text-sm font-semibold active:scale-95"
            >
              {lang === 'ru' ? 'Вернуться в каталог' : 'Katalogga qaytish'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
