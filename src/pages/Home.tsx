import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { getTelegramUser } from '../lib/telegram';
import { ChevronRight, Sparkles, Shield, Truck } from 'lucide-react';
import { SplashScreen } from '../components/SplashScreen';
import { BrandMark } from '../components/Logo';

/**
 * Заставка и выбор языка — и больше ничего.
 *
 * Здесь была ещё витрина: слайдер баннеров, полоса преимуществ, «Популярное»,
 * блок промокода и баннер канала. Достижима она не была.
 * `handleLanguageSelect` ставил `entered = true`, витрина начинала рисоваться,
 * и тот же обработчик через 300 мс уводил на /catalog — опрос каждые 50 мс
 * заставал её на экране с 91-й по 315-ю миллисекунду. Вернуться было некуда:
 * в нижней навигации главной нет, а при повторном заходе на «/» состояние
 * сбрасывалось, и снова показывался выбор языка.
 *
 * Поэтому витрина удалена, а то, что в ней было видно только вспышкой —
 * промокод POINTTECH и подписка на канал — переехало в Catalog, где его
 * действительно видно. Вместе с витриной ушли useProducts, useBanners и
 * useFavoriteIds: три запроса на каждом открытии приложения ради разметки,
 * которая жила треть секунды.
 */
export const Home = () => {
  const navigate = useNavigate();
  const { language, setLanguage, setTelegramUserId, isRegistered } = useAppStore();
  const [splashDone, setSplashDone] = useState(false);

  const user = getTelegramUser();

  useEffect(() => {
    if (user) {
      setTelegramUserId(user.id);
      const langCode = user.language_code;
      if (langCode === 'uz' || langCode === 'ru') {
        setLanguage(langCode);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setLanguage, setTelegramUserId]);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  const handleLanguageSelect = (lang: 'ru' | 'uz') => {
    setLanguage(lang);
    // Переход сразу, без setTimeout: задержка существовала только чтобы успела
    // мигнуть удалённая витрина.
    //
    // Browsing never requires an identity; only personal actions do. Send
    // visitors without a Telegram session to the "open in Telegram" screen.
    navigate(isRegistered() ? '/catalog' : '/register');
  };

  if (!splashDone) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  const languages = [
    { code: 'ru' as const, flag: '🇷🇺', title: 'Русский', sub: 'Russian' },
    { code: 'uz' as const, flag: '🇺🇿', title: "O'zbekcha", sub: 'Uzbek' },
  ];
  const perks = [
    { icon: Truck, label: language === 'ru' ? 'Доставка по РУз' : "O'zbekiston bo'ylab" },
    { icon: Shield, label: language === 'ru' ? 'Гарантия' : 'Kafolat' },
    { icon: Sparkles, label: language === 'ru' ? 'Оригинал' : 'Original' },
  ];

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-bg">
      {/* Ambient light: two soft brand-coloured sources and a faint grid */}
      <div className="pointer-events-none absolute -top-32 -right-24 w-[360px] h-[360px] rounded-full bg-accent/30 blur-[90px]" />
      <div className="pointer-events-none absolute top-40 -left-32 w-[300px] h-[300px] rounded-full bg-accent-2/20 blur-[90px]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--border)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border)) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 55% at 50% 30%, black 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 30%, black 20%, transparent 75%)',
        }}
      />

      <div className="flex-1 flex flex-col px-6 pt-16 pb-8 relative z-10">
        <div className="w-full max-w-sm mx-auto flex-1 flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in-up">
            <div className="relative mb-8">
              <div className="absolute inset-0 rounded-[1.75rem] gradient-brand blur-2xl opacity-60 scale-110" />
              <div className="relative w-[88px] h-[88px] rounded-[1.75rem] gradient-brand flex items-center justify-center shadow-accent ring-1 ring-white/20">
                <BrandMark size={46} className="text-white" />
              </div>
            </div>
            <p className="eyebrow mb-3">Tashkent · Uzbekistan</p>
            <h1 className="font-display text-[34px] leading-none font-semibold text-text tracking-[0.02em] mb-4">
              POINT <span className="text-gradient-brand">TECH</span>
            </h1>
            <p className="text-text-secondary text-[15px] text-balance max-w-[18rem] mx-auto leading-relaxed">
              {language === 'ru'
                ? 'Техника и электроника с доставкой по всему Узбекистану'
                : "O'zbekiston bo'ylab yetkazib berish bilan texnika va elektronika"}
            </p>
          </div>

          <div className="animate-fade-in-up stagger-2">
            <p className="eyebrow text-center mb-3">
              {language === 'ru' ? 'Выберите язык' : 'Tilni tanlang'}
            </p>
            <div className="space-y-2.5 mb-8">
              {languages.map(({ code, flag, title, sub }) => (
                <button
                  key={code}
                  onClick={() => handleLanguageSelect(code)}
                  className="w-full flex items-center gap-4 glass-card text-text h-[68px] px-4 rounded-[1.25rem] transition-all duration-200 active:scale-[0.98] group hover:border-accent/40"
                >
                  <span className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center text-[22px] leading-none">
                    {flag}
                  </span>
                  <div className="text-left flex-1">
                    <p className="font-bold text-[15px] leading-tight">{title}</p>
                    <p className="text-xs text-text-tertiary font-medium">{sub}</p>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-text-on-accent transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {perks.map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1.5 py-2.5 rounded-2xl bg-surface/50 border border-border-subtle">
                  <Icon className="w-4 h-4 text-accent" />
                  <span className="text-2xs font-semibold text-text-secondary text-center">{label}</span>
                </div>
              ))}
            </div>

            <p className="text-center text-text-tertiary text-2xs mt-6 tracking-widest">
              POINT TECH · v1.0
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
