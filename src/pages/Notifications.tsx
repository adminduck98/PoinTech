import { Layout } from '../components/Layout';
import { NotificationCenter } from '../components/NotificationCenter';
import { useUserId } from '../hooks/useUserId';
import { useTranslation } from '../hooks/useTranslation';

export const Notifications = () => {
  const userId = useUserId();
  const { language } = useTranslation();

  return (
    <Layout>
      <div className="px-4 pt-5 pb-2">
        <h1 className="font-display text-xl font-semibold text-text">
          {language === 'ru' ? 'Уведомления' : 'Bildirishnomalar'}
        </h1>
      </div>
      <div className="px-4 pb-24 pt-3">
        {userId > 0 ? (
          <NotificationCenter />
        ) : (
          <div className="text-center py-20 text-sm text-text-secondary">
            {language === 'ru' ? 'Войдите, чтобы видеть уведомления' : "Bildirishnomalarni ko'rish uchun kiring"}
          </div>
        )}
      </div>
    </Layout>
  );
};
