/**
 * Короткая подпись под ценой на плитке каталога.
 *
 * В каталоге у товара видно только название и цену, а названия отличаются одной
 * моделью: «Холодильник Bosch KGN36XL30U» и «Холодильник Bosch KBN96ADD0» — по
 * ним нельзя понять, какой шире и какой вместительнее. Достаём из характеристик
 * две главные цифры — ширину и объём (или загрузку, или мощность у мелкой
 * техники) — и показываем их там, где у одежды показывались размеры.
 *
 * Ничего не выдумываем: если в характеристиках такого параметра нет, подпись
 * просто не появляется.
 */

type Specs = Record<string, string | number | boolean> | null | undefined;

/** «186 × 60 × 66» → ширина, вторая цифра. Порядок задан ключом (В×Ш×Г). */
const DIMENSIONS_KEY = 'Размеры (В×Ш×Г), см';

const number = (value: unknown): string | null => {
  const match = String(value ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
};

const findKey = (specs: Record<string, unknown>, test: RegExp): string | undefined =>
  Object.keys(specs).find((key) => test.test(key.toLowerCase()));

function width(specs: Record<string, unknown>): string | null {
  const dims = specs[DIMENSIONS_KEY];
  if (typeof dims === 'string') {
    const parts = dims.split('×').map((p) => p.trim());
    if (parts.length === 3 && number(parts[1])) return `${number(parts[1])} см`;
  }
  const key = findKey(specs, /^ширина/);
  const value = key ? number(specs[key]) : null;
  return value ? `${value} см` : null;
}

function capacity(specs: Record<string, unknown>): string | null {
  const volume = findKey(specs, /об[ъь][её]м/);
  if (volume && number(specs[volume])) return `${number(specs[volume])} л`;

  const load = findKey(specs, /загрузк.*кг/);
  if (load && number(specs[load])) return `${number(specs[load])} кг`;

  const power = findKey(specs, /^мощность/);
  if (power && number(specs[power])) return `${number(specs[power])} Вт`;

  return null;
}

/** Например «60 см · 357 л». Пустая строка, если считать не из чего. */
export function productHighlight(specs: Specs): string {
  if (!specs || typeof specs !== 'object') return '';
  const record = specs as Record<string, unknown>;
  return [width(record), capacity(record)].filter(Boolean).join(' · ');
}
