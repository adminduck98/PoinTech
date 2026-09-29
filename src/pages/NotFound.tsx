import { ArrowLeft, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';

export const NotFound = () => {
  const { language } = useTranslation();

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 rounded-2xl bg-surface-muted flex items-center justify-center mx-auto mb-5">
          <Search className="w-9 h-9 text-text-tertiary" />
        </div>
        <h1 className="font-display text-6xl font-bold text-gradient-brand mb-3">404</h1>
        <p className="text-lg font-semibold text-text mb-1.5">
          {language === 'ru' ? 'Страница не найдена' : 'Sahifa topilmadi'}
        </p>
        <p className="text-sm text-text-secondary mb-8 max-w-[260px]">
          {language === 'ru'
            ? 'Страница, которую вы ищете, не существует или была перемещена'
            : "Siz qidirgan sahifa mavjud emas yoki ko'chirilgan"}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl btn-brand text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          {language === 'ru' ? 'На главную' : 'Bosh sahifa'}
        </Link>
      </div>
    </div>
  );
};
