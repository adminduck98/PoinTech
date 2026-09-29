import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import type { Banner } from '../lib/supabase/queries';

interface Props {
  banners: Banner[];
  language: 'ru' | 'uz';
}

/** Есть ли у баннера собственные подписи, которые надо нарисовать поверх. */
const hasText = (b: Banner, language: 'ru' | 'uz') =>
  Boolean(b.title[language] || b.title.ru || b.subtitle[language] || b.subtitle.ru);

const AUTOPLAY_DELAY = 4500;

/**
 * Рамка подстраивается под саму картинку, но в этих пределах.
 *
 * Раньше здесь стояло жёсткое 2:1, и при `object-cover` любой баннер с другими
 * пропорциями обрезался. Готовый макет 1920×566 (3.39:1) увеличивался в 1,7
 * раза и терял по краям около 40% — вместе с половиной надписи на нём.
 *
 * Границы нужны, чтобы неудачная картинка не превратила блок в полоску в
 * пиксель высотой или в стену на весь экран.
 */
const MIN_ASPECT = 1.6;
const MAX_ASPECT = 3.6;
const DEFAULT_ASPECT = 2;

export const BannerSlider = ({ banners, language }: Props) => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  // Пропорции загруженных картинок, по id баннера.
  const [aspects, setAspects] = useState<Record<string, number>>({});

  const goTo = useCallback(
    (index: number) => {
      setCurrent(((index % banners.length) + banners.length) % banners.length);
    },
    [banners.length],
  );

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (banners.length <= 1) return;
    timerRef.current = setInterval(() => {
      setCurrent((c) => (c + 1) % banners.length);
    }, AUTOPLAY_DELAY);
  }, [banners.length]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startTimer]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      goTo(dx < 0 ? current + 1 : current - 1);
      startTimer();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (!banners.length) return null;

  const banner = banners[current];
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspects[banner.id] ?? DEFAULT_ASPECT));

  const openBanner = (b: Banner) => {
    if (!b.link_url) return;
    if (b.link_url.startsWith('/')) {
      navigate(b.link_url);
    } else {
      window.open(b.link_url, '_blank');
    }
  };

  return (
    <div
      ref={sliderRef}
      className="relative overflow-hidden select-none mx-4 mt-3 rounded-[1.5rem] ring-1 ring-border-subtle shadow-lit isolate"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative w-full transition-[aspect-ratio] duration-300" style={{ aspectRatio: String(aspect) }}>
        {banners.map((b, i) => {
          if (Math.abs(i - current) > 1) return null;
          return (
          <div
            key={b.id}
            /*
              Нажатие в любое место баннера ведёт по его ссылке.
              Раньше кликабельной была только кнопка внизу слева — а по картинке
              люди жмут в первую очередь, и баннер выглядел неотзывчивым. Кнопка
              осталась: она подсказывает, что тут есть куда нажать.

              role/tabIndex/onKeyDown — чтобы это работало и с клавиатуры: div с
              обработчиком клика сам по себе недоступен для Tab и Enter.
            */
            onClick={b.link_url ? () => openBanner(b) : undefined}
            role={b.link_url ? 'link' : undefined}
            tabIndex={b.link_url && i === current ? 0 : undefined}
            onKeyDown={b.link_url ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBanner(b); }
            } : undefined}
            className={`absolute inset-0 transition-opacity duration-500 ${
              i === current ? 'opacity-100 z-10' : 'opacity-0 z-0'
            } ${b.link_url ? 'cursor-pointer' : ''}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${b.bg_color}`} />

            {b.image_url && (
              <img
                src={b.image_url}
                alt={b.title[language] || b.title.ru || 'Баннер'}
                className="absolute inset-0 w-full h-full object-cover"
                loading={i === 0 ? 'eager' : 'lazy'}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (!img.naturalWidth || !img.naturalHeight) return;
                  const ratio = img.naturalWidth / img.naturalHeight;
                  setAspects((prev) => (prev[b.id] === ratio ? prev : { ...prev, [b.id]: ratio }));
                }}
              />
            )}

            {/*
              Затемнение и подписи — только когда есть что показывать.
              На готовом макете, где текст уже нарисован, эти два градиента
              просто гасили картинку, а заголовок печатался поверх такого же
              заголовка внутри неё.
            */}
            {hasText(b, language) && (
            <>
            <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
            </>
            )}

            <div className="absolute inset-0 flex flex-col justify-end px-4 sm:px-6 pb-5 sm:pb-6">
              {(b.subtitle[language] || b.subtitle.ru) && (
                <p className="text-text-inverse/75 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-1.5 sm:mb-2 drop-shadow-sm">
                  {b.subtitle[language] || b.subtitle.ru}
                </p>
              )}
              {(b.title[language] || b.title.ru) && (
                <p
                  className="font-display text-white font-semibold text-lg sm:text-2xl leading-tight drop-shadow-lg max-w-[80%] sm:max-w-[75%]"
                  style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
                >
                  {b.title[language] || b.title.ru}
                </p>
              )}
              {b.link_url && b.link_label && (
                <button
                  onClick={(e) => {
                    // Клик уже обработает сам баннер — без этого переход
                    // сработал бы дважды.
                    e.stopPropagation();
                    openBanner(b);
                  }}
                  /*
                    Подпись тёмная фиксированно, а не text-text.
                    Кнопка всегда белая — она лежит на картинке, и это верно в
                    обеих темах. А text-text в тёмной теме почти белый (#F0F0F0),
                    то есть надпись пропадала на белой кнопке: контраст 1.06:1.
                    С #1A1A1A он 16:1. Та же ошибка была у стрелки «Назад» на
                    карточке товара.
                  */
                  className="mt-3 sm:mt-4 self-start flex items-center gap-1.5 sm:gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-white text-[#1A1A1A] rounded-full text-[11px] sm:text-xs font-bold hover:bg-white/90 active:scale-95 transition-all shadow-float"
                >
                  {b.link_label[language] || b.link_label.ru}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      {banners.length > 1 && (
        <>
          {/* Стрелки — только для указателя, от sm и выше.
              На телефоне тот же переход делают свайп (onTouchStart/End выше) и
              точки под баннером, а два кружка поверх картинки закрывают её же
              содержимое. Здесь это заметнее всего: слайдер занимает всю ширину
              экрана, и стрелки ложатся прямо на заголовок баннера. */}
          <button
            onClick={() => { goTo(current - 1); startTimer(); }}
            aria-label="Предыдущий баннер"
            className="hidden sm:flex absolute sm:left-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm items-center justify-center transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-text-inverse" />
          </button>
          <button
            onClick={() => { goTo(current + 1); startTimer(); }}
            aria-label="Следующий баннер"
            className="hidden sm:flex absolute sm:right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm items-center justify-center transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-text-inverse" />
          </button>

          <div className="absolute bottom-4 right-5 z-20 flex gap-1.5">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={() => { goTo(i); startTimer(); }}
                className={`rounded-full transition-all duration-300 ${
                  i === current
                    ? 'w-6 h-2 bg-white'
                    : 'w-2 h-2 bg-white/45 hover:bg-white/65'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
