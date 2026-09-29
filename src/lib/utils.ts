import { clsx, type ClassValue } from 'clsx';
import { useAppStore } from '../store/useAppStore';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Format a price with its currency suffix.
 *
 * `lang` was optional and defaulted to Russian, and of the 52 call sites in the
 * app exactly one passed it — so an Uzbek-speaking customer saw "сум" on every
 * price in the catalogue, cart, checkout and order history while the rest of
 * the interface was in Uzbek.
 *
 * The default now comes from the language the app is actually running in.
 * Reading the store here rather than threading a parameter through 52 call
 * sites is deliberate: the alternative is a mechanical edit of every one of
 * them, and any that got missed would silently keep the old bug. Components
 * that render prices already subscribe to `language` through useTranslation, so
 * they re-render when it changes.
 */
export function formatPrice(price: number, lang?: 'ru' | 'uz'): string {
  const language = lang ?? useAppStore.getState().language;
  const formatted = new Intl.NumberFormat('uz-UZ', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
  return `${formatted} ${language === 'uz' ? "so'm" : 'сум'}`;
}

export function getLocalizedValue(
  value: { ru: string; uz: string } | string | undefined | null,
  language: 'ru' | 'uz'
): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[language] || value.ru || '';
}

export function generateSlug(text: string): string {
  const translitMap: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'қ': 'q', 'ғ': 'g', 'ў': 'o\'', 'ҳ': 'h',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
    'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'Қ': 'Q', 'Ғ': 'G', 'Ў': 'O\'', 'Ҳ': 'H',
  };
  return text
    .toLowerCase()
    .split('')
    .map(char => translitMap[char] || char)
    .join('')
    .replace(/\s+/g, '-')
    // Was [^a-z0-9\\-]: inside a character class that escaped backslash is a
    // literal backslash, so the class read "keep letters, digits, BACKSLASH and
    // hyphen" and a stray \ survived into the slug — which then goes into a URL.
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validatePhone(phone: string): boolean {
  const phoneClean = phone.replace(/[\s\-()]/g, '');
  return /^\+?[0-9]{9,13}$/.test(phoneClean);
}

export function formatDate(iso: string, lang: 'ru' | 'uz' = 'ru'): string {
  return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string, lang: 'ru' | 'uz' = 'ru'): string {
  return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
