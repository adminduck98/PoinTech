import { useNavigate } from 'react-router-dom';
import { Send, ShoppingBag, ArrowLeft } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { isTelegramWebApp } from '../lib/telegram';
import { BOT_URL } from '../lib/config';

/**
 * Shown when someone reaches the shop outside Telegram.
 *
 * This screen used to be a sign-up form that turned a self-declared phone
 * number into a user id (its last 9 digits). Nothing verified the number, so
 * anybody could type someone else's and take over their account; worse, those
 * 9-digit ids overlap the real Telegram id range, so a visitor could collide
 * with a genuine account. Identity now comes exclusively from Telegram
 * initData, which the server verifies on every user-scoped request.
 *
 * Browsing (catalog, product pages) still works without an identity — only
 * personal actions need one.
 */
export const Register = () => {
  const navigate = useNavigate();
  const language = useAppStore((s) => s.language);
  const insideTelegram = isTelegramWebApp();

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl gradient-brand shadow-accent flex items-center justify-center mx-auto mb-6">
          <ShoppingBag className="w-8 h-8 text-text-inverse" />
        </div>

        <h1 className="font-display text-xl font-semibold text-text mb-2">
          {language === 'ru' ? 'Откройте магазин в Telegram' : "Do'konni Telegramda oching"}
        </h1>

        <p className="text-sm text-text-secondary leading-relaxed mb-8">
          {language === 'ru'
            ? 'Заказы, избранное и чат с магазином работают только внутри Telegram — так мы подтверждаем, что аккаунт действительно ваш.'
            : "Buyurtmalar, tanlanganlar va chat faqat Telegram ichida ishlaydi — shunday qilib hisob haqiqatan sizniki ekanini tasdiqlaymiz."}
        </p>

        {insideTelegram ? (
          <p className="text-sm text-warning mb-6">
            {language === 'ru'
              ? 'Не удалось получить данные Telegram. Закройте и откройте приложение заново.'
              : "Telegram ma'lumotlarini olishning iloji bo'lmadi. Ilovani yopib, qayta oching."}
          </p>
        ) : (
          <a
            href={BOT_URL}
            className="w-full inline-flex items-center justify-center gap-2 btn-brand py-3.5 px-5 rounded-2xl font-semibold text-sm active:scale-[0.98] transition-all mb-3"
          >
            <Send className="w-4 h-4" />
            {language === 'ru' ? 'Открыть в Telegram' : 'Telegramda ochish'}
          </a>
        )}

        <button
          onClick={() => navigate('/catalog')}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-5 rounded-2xl border border-border text-text-secondary font-medium text-sm active:scale-[0.98] transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          {language === 'ru' ? 'Смотреть каталог' : "Katalogni ko'rish"}
        </button>
      </div>
    </div>
  );
};
