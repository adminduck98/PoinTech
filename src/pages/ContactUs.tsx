import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { useTranslation } from '../hooks/useTranslation';
import { CONTACTS, CONTACT_PHONE_HREF } from '../lib/config';

export const ContactUs = () => {
  const { language } = useTranslation();

  // Rows whose VITE_CONTACT_* variable is unset are dropped rather than shown
  // with a placeholder — see the note in lib/config.ts. Telegram always
  // survives, so the page never ends up with no way to reach the shop.
  const contacts = [
    {
      icon: Phone,
      label: language === 'ru' ? 'Телефон' : 'Telefon',
      value: CONTACTS.phone,
      action: CONTACT_PHONE_HREF,
    },
    {
      icon: MessageCircle,
      label: 'Telegram',
      value: `@${CONTACTS.telegram}`,
      action: `https://t.me/${CONTACTS.telegram}`,
    },
    {
      icon: Mail,
      label: 'Email',
      value: CONTACTS.email,
      action: CONTACTS.email ? `mailto:${CONTACTS.email}` : undefined,
    },
    {
      icon: MapPin,
      label: language === 'ru' ? 'Адрес' : 'Manzil',
      value: language === 'ru' ? CONTACTS.addressRu : CONTACTS.addressUz,
    },
    {
      icon: Clock,
      label: language === 'ru' ? 'Режим работы' : 'Ish vaqti',
      value: language === 'ru' ? CONTACTS.hoursRu : CONTACTS.hoursUz,
    },
  ].filter((c) => c.value && c.value !== '@');

  return (
    <Layout showBottomNav={false}>
      <div className="min-h-screen bg-bg">
        <header className="sticky top-14 z-40 glass border-b border-[color:var(--glass-border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Link to="/" className="w-10 h-10 flex items-center justify-center rounded-full bg-surface border border-border-subtle shadow-sm text-text transition active:scale-90">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-display text-lg font-semibold text-text">
              {language === 'ru' ? 'Связаться с нами' : "Biz bilan bog'lanish"}
            </h1>
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-6 space-y-3">
          <p className="text-sm text-text-secondary mb-4">
            {language === 'ru'
              ? 'Мы всегда рады помочь вам с любыми вопросами'
              : "Biz har doim sizga yordam berishga tayyormiz"}
          </p>

          {contacts.map(({ icon: Icon, label, value, action }, i) => {
            // The whole card is the tap target. Wrapping only the value gave a
            // 20px-tall hit area — well under the ~44px a finger needs.
            const body = (
              <>
                <div className="w-11 h-11 rounded-xl bg-surface-muted flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-semibold text-text truncate">{value}</p>
                </div>
              </>
            );

            const cardClass = 'bg-surface rounded-2xl border border-border p-4 flex items-center gap-4 min-h-[76px]';

            return action ? (
              <a
                key={i}
                href={action}
                className={`${cardClass} active:scale-[0.99] transition-transform`}
              >
                {body}
              </a>
            ) : (
              <div key={i} className={cardClass}>{body}</div>
            );
          })}
        </main>
      </div>
    </Layout>
  );
};
