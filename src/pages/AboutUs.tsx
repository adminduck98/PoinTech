import { ArrowLeft, Shield, Truck, Heart, Star, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useTranslation } from '../hooks/useTranslation';
import { useActiveProductCount, useCategories } from '../lib/supabase/hooks';
import { Logo } from '../components/Logo';

export const AboutUs = () => {
  const { language } = useTranslation();
  const { data: productCount, isLoading: countLoading } = useActiveProductCount();
  const { data: categories, isLoading: categoriesLoading } = useCategories();

  const values = [
    { icon: Shield, title: { ru: 'Оригинальная техника', uz: 'Original texnika' }, desc: { ru: 'Только официальные поставки и гарантия производителя', uz: "Faqat rasmiy yetkazib berish va ishlab chiqaruvchi kafolati" } },
    { icon: Truck, title: { ru: 'Быстрая доставка', uz: 'Tez yetkazish' }, desc: { ru: 'Доставим по всему Узбекистану за 1-3 дня', uz: "O'zbekiston bo'ylab 1-3 kunda yetkazamiz" } },
    { icon: Heart, title: { ru: 'Забота о клиентах', uz: 'Mijozlar g\'amxo\'rligi' }, desc: { ru: 'Поможем подобрать устройство и ответим на вопросы', uz: "Qurilma tanlashda yordam beramiz va savollarga javob beramiz" } },
    { icon: Star, title: { ru: 'Лучшие цены', uz: 'Eng yaxshi narxlar' }, desc: { ru: 'Прямые поставки без посредников', uz: "Vositachilarsiz to'g'ridan-to'g'ri yetkazib berish" } },
  ];

  /*
   * The first two tiles are counted in the database at render time. They used
   * to read "10 000+ довольных клиентов" and "5 000+ товаров в каталоге" —
   * figures nothing in this project could produce, sitting next to a catalogue
   * that holds a couple of dozen items. The other two state terms that the
   * values list below already promises, so there is no number here that the
   * shop cannot back.
   */
  const format = (n: number) => n.toLocaleString(language === 'ru' ? 'ru-RU' : 'uz-UZ');

  const stats = [
    {
      value: countLoading ? '—' : format(productCount ?? 0),
      label: { ru: 'Товаров в каталоге', uz: 'Katalogdagi mahsulotlar' },
    },
    {
      value: categoriesLoading ? '—' : format(categories?.length ?? 0),
      label: { ru: 'Категорий', uz: 'Kategoriyalar' },
    },
    {
      value: language === 'ru' ? '1–3 дня' : '1–3 kun',
      label: { ru: 'Доставка по Узбекистану', uz: "O'zbekiston bo'ylab yetkazish" },
    },
    {
      value: language === 'ru' ? 'Оригинал' : 'Original',
      label: { ru: 'Официальная гарантия', uz: 'Rasmiy kafolat' },
    },
  ];

  return (
    <Layout showBottomNav={false}>
      <div className="min-h-screen bg-bg">
        <header className="sticky top-14 z-40 glass border-b border-[color:var(--glass-border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Link to="/" className="w-10 h-10 flex items-center justify-center rounded-full bg-surface border border-border-subtle shadow-sm text-text transition active:scale-90">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-display text-lg font-semibold text-text">
              {language === 'ru' ? 'О нас' : 'Biz haqimizda'}
            </h1>
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
          {/* Hero */}
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center mb-4">
              <Logo size="lg" variant="full" className="!flex-col !items-center !gap-3" />
            </div>
            <p className="text-sm text-text-secondary leading-relaxed max-w-sm mx-auto">
              {language === 'ru'
                ? 'Point Tech — магазин техники и электроники с доставкой по всему Узбекистану. Оригинальные устройства от официальных поставщиков по честным ценам.'
                : "Point Tech — O'zbekiston bo'ylab yetkazib berish bilan texnika va elektronika do'koni. Rasmiy yetkazib beruvchilardan original qurilmalar, halol narxlarda."}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            {stats.map(({ value, label }, i) => (
              <div key={i} className="card-premium p-4 text-center">
                <p className="text-xl font-bold text-text">{value}</p>
                <p className="text-xs text-text-secondary mt-1">{label[language]}</p>
              </div>
            ))}
          </div>

          {/* Values */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-text uppercase tracking-wide">
              {language === 'ru' ? 'Наши ценности' : 'Bizning qadriyatlarimiz'}
            </h2>
            {values.map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="card-premium p-4 flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-surface-muted flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">{title[language]}</p>
                  <p className="text-xs text-text-secondary mt-0.5">{desc[language]}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Mission */}
          <div className="bg-accent rounded-2xl p-5 text-text-inverse">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-5 h-5" />
              <h3 className="font-bold text-sm">
                {language === 'ru' ? 'Наша миссия' : 'Bizning missiyamiz'}
              </h3>
            </div>
            <p className="text-text-inverse/80 text-sm leading-relaxed">
              {language === 'ru'
                ? 'Сделать современную технику доступной каждому жителю Узбекистана. Мы работаем напрямую с поставщиками, чтобы предложить оригинальные устройства по честным ценам.'
                : "O'zbekistonning har bir aholisiga zamonaviy texnikani mavjud qilish. Biz yetkazib beruvchilar bilan to'g'ridan-to'g'ri ishlaymiz — original qurilmalarni halol narxlarda taklif etish uchun."}
            </p>
          </div>
        </main>
      </div>
    </Layout>
  );
};
