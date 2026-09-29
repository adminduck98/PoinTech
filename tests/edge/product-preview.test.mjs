/**
 * Open Graph preview renderer (api/product-preview.ts).
 *
 * Only the pure builder is exercised here — it takes a product and returns
 * markup, so it needs neither a network nor the edge runtime. What matters is
 * that hostile field values cannot break out of an attribute, that a missing or
 * inactive product still yields a usable card, and that the deep link points at
 * the Mini App rather than a chat with the bot.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PROJECT_ROOT, runEsbuild } from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
const out = path.join(tmp, 'product-preview.mjs');
runEsbuild(path.join(PROJECT_ROOT, 'api/product-preview.ts'), out);
const { buildPreviewHtml } = await import(`file://${out}`);

const BASE = { slug: 'futbolka-one', botUsername: 'KuPi_ShoP_Store_Bot', shopName: 'ONE' };

const render = (product, overrides = {}) =>
  buildPreviewHtml({ ...BASE, ...overrides, product });

// ── Happy path ──────────────────────────────────────────────────────────────

section('обычный товар');
{
  const html = render({
    name: { ru: 'Футболка ONE', uz: 'ONE Futbolka' },
    description: { ru: 'Хлопок премиум качества', uz: 'Premium paxta' },
    price: 199000,
    images: ['https://cdn.example.com/a.jpg'],
  });

  // toLocaleString('ru-RU') groups digits with U+00A0, so match on the parts
  // rather than pinning the exact separator.
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)">/)?.[1] ?? '';
  expect('заголовок содержит название и цену',
    ogTitle.startsWith('Футболка ONE — 199') && ogTitle.endsWith("000 so&#39;m"),
    ogTitle);
  expect('og:image проставлен', html.includes('<meta property="og:image" content="https://cdn.example.com/a.jpg">'));
  expect('twitter:card = summary_large_image', html.includes('name="twitter:card" content="summary_large_image"'));
  expect('описание попало в og:description', html.includes('Хлопок премиум качества'));
  expect('ссылка открывает Mini App через startapp',
    html.includes('https://t.me/KuPi_ShoP_Store_Bot?startapp=product_futbolka-one'));
}

// ── Escaping ────────────────────────────────────────────────────────────────

section('экранирование');
{
  const html = render({
    name: { ru: '"><script>alert(1)</script>' },
    description: { ru: "O'Brien & Co <b>bold</b>" },
    price: 1000,
    images: ['https://cdn.example.com/x.jpg'],
  });

  expect('тег script не попадает в разметку как тег',
    !html.includes('<script>alert(1)</script>'),
    'найден неэкранированный script');
  expect('кавычка не разрывает атрибут',
    !/content="[^"]*"><\/?script/i.test(html));
  expect('амперсанд экранирован', html.includes('O&#39;Brien &amp; Co'));
  // The redirect script is ours and must survive.
  expect('собственный redirect-скрипт на месте', html.includes('window.location.replace'));
}

// ── Image safety ────────────────────────────────────────────────────────────

section('og:image только https');
{
  const js = render({ name: { ru: 'X' }, images: ['javascript:alert(1)'] });
  expect('javascript: отброшен', !js.includes('og:image'));

  const rel = render({ name: { ru: 'X' }, images: ['/local/a.jpg'] });
  expect('относительный путь отброшен', !rel.includes('og:image'));

  const http = render({ name: { ru: 'X' }, images: ['http://cdn.example.com/a.jpg'] });
  expect('http:// отброшен', !http.includes('og:image'));

  const https = render({ name: { ru: 'X' }, images: ['https://cdn.example.com/a.jpg'] });
  expect('https:// принят', https.includes('og:image'));
}

// ── Missing product ─────────────────────────────────────────────────────────

section('товар не найден или снят с продажи');
{
  const html = render(null);
  expect('карточка всё равно валидна', html.startsWith('<!DOCTYPE html>'));
  expect('показывается магазин, а не сырой slug',
    html.includes('ONE — магазин в Telegram') && !html.includes('>futbolka-one<'),
    'slug просочился в видимый текст');
  expect('og:image отсутствует', !html.includes('og:image'));
  expect('ссылка на Mini App сохранена', html.includes('?startapp=product_futbolka-one'));
}

section('частично заполненный товар');
{
  const noPrice = render({ name: { ru: 'Кепка' }, price: null, images: [] });
  expect('без цены заголовок — только название',
    noPrice.includes('<meta property="og:title" content="Кепка">'));

  const onlyUz = render({ name: { uz: 'Futbolka' } });
  expect('падает на uz, если ru пуст', onlyUz.includes('content="Futbolka"'));
}

// ── Slug handling ───────────────────────────────────────────────────────────

section('slug в ссылке');
{
  const html = render({ name: { ru: 'X' } }, { slug: 'a_b-c1' });
  expect('slug закодирован в startapp', html.includes('?startapp=product_a_b-c1'));
}
