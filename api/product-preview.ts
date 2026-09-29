/**
 * Rich link previews for /product/<slug>.
 *
 * Telegram — and social crawlers generally — fetch a shared link to build its
 * preview card, and they do not run JavaScript. The SPA shell gives them no
 * title, price or image, so a shared product used to render as a bare site
 * name. This answers those requests with server-rendered Open Graph tags.
 *
 * This logic previously lived in server.cjs, which only runs on the Render
 * deployment. Since the bot points at Vercel, every real share came from the
 * host that had no preview renderer at all. Now that Vercel is the single
 * target, it lives here.
 *
 * Only crawlers reach this function: vercel.json rewrites /product/:slug here
 * when the User-Agent matches, and everyone else falls through to the SPA. See
 * the `has` rule in vercel.json.
 */

export const config = { runtime: 'edge' };

/** Crawlers cache aggressively; a product's name and price change rarely. */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/** Upstream is a third party — never hang a crawler request on it. */
const UPSTREAM_TIMEOUT_MS = 4000;

interface PreviewProduct {
  name?: { ru?: string; uz?: string } | string | null;
  description?: { ru?: string; uz?: string } | string | null;
  price?: number | null;
  images?: string[] | null;
}

/**
 * Escape text for interpolation into HTML.
 *
 * supabase/functions/client-api/index.ts carries its own, deliberately: that
 * one runs on Deno and this one on the Vercel edge runtime, with no module
 * either can import from the other. Keeping it inline is a smaller problem than
 * a build-time coupling between two deployment targets. (There was a third copy
 * in server.cjs until Vercel became the only target and that file was removed.)
 * Note this copy escapes the single quote as well: every delimiter covered is
 * easier to reason about than a rule about which attributes use which quote.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Pick the Russian text out of a localised field, tolerating a plain string. */
function localised(value: PreviewProduct['name']): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.ru || value.uz || '';
}

/**
 * Only images we are willing to hand a crawler.
 *
 * The value comes from the database, and og:image is fetched by third parties,
 * so restrict it to absolute https URLs: a `javascript:` or `data:` value has
 * no business in a meta tag, and a relative path would resolve against the
 * crawler's own base.
 */
function safeImage(images: PreviewProduct['images']): string {
  const first = Array.isArray(images) ? images[0] : undefined;
  if (typeof first !== 'string') return '';
  try {
    const url = new URL(first);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function buildPreviewHtml(options: {
  product: PreviewProduct | null;
  slug: string;
  botUsername: string;
  shopName: string;
}): string {
  const { product, slug, botUsername, shopName } = options;

  const siteName = `${shopName} — магазин в Telegram`;
  const name = localised(product?.name);
  const description = localised(product?.description);
  const image = safeImage(product?.images);
  const price =
    typeof product?.price === 'number' && Number.isFinite(product.price)
      ? `${product.price.toLocaleString('ru-RU')} so'm`
      : '';

  // An unknown or inactive slug gets the shop's own card. The previous version
  // printed the raw slug as the product name, which advertised a URL the
  // visitor cannot open as though it were a product.
  const title = name ? (price ? `${name} — ${price}` : name) : siteName;
  const summary = description ? description.slice(0, 200) : siteName;

  const miniAppUrl = `https://t.me/${botUsername}?startapp=product_${encodeURIComponent(slug)}`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(summary)}">
  <meta property="og:type" content="product">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(summary)}">
  <meta property="og:site_name" content="${escapeHtml(siteName)}">
  <meta property="og:url" content="${escapeHtml(miniAppUrl)}">
${image ? `  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${escapeHtml(image)}">
` : ''}  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(summary)}">
  <script>
    setTimeout(function () { window.location.replace(${JSON.stringify(miniAppUrl)}); }, 1500);
  </script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#f5f5f5; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#fff; border-radius:16px; padding:24px; max-width:360px; width:90%; text-align:center; box-shadow:0 2px 12px rgba(0,0,0,.08); }
    .card img { width:100%; border-radius:12px; margin-bottom:16px; object-fit:cover; max-height:300px; }
    .card h1 { font-size:18px; color:#111; margin-bottom:8px; }
    .card p { font-size:14px; color:#666; margin-bottom:4px; }
    .card .price { font-size:22px; font-weight:800; color:#111; margin:8px 0 16px; }
    .card .btn { display:inline-block; background:#2AABEE; color:#fff; padding:12px 32px; border-radius:12px; text-decoration:none; font-weight:600; font-size:15px; }
    .card .hint { font-size:12px; color:#999; margin-top:12px; }
  </style>
</head>
<body>
  <div class="card">
${image ? `    <img src="${escapeHtml(image)}" alt="${escapeHtml(name || shopName)}">\n` : ''}    <h1>${escapeHtml(name || siteName)}</h1>
${price ? `    <p class="price">${escapeHtml(price)}</p>\n` : ''}${description ? `    <p>${escapeHtml(summary)}</p>\n` : ''}    <a class="btn" href="${escapeHtml(miniAppUrl)}">Открыть в Telegram</a>
    <p class="hint">Откроется автоматически...</p>
  </div>
</body>
</html>`;
}

/**
 * Fetch one active product by slug.
 *
 * `is_active` is part of the filter on purpose: the old implementation looked
 * the slug up without it, so a product pulled from sale kept generating rich
 * previews with its old price.
 */
async function fetchProduct(
  supabaseUrl: string,
  anonKey: string,
  slug: string
): Promise<PreviewProduct | null> {
  const query =
    `${supabaseUrl}/rest/v1/products` +
    `?slug=eq.${encodeURIComponent(slug)}` +
    `&is_active=eq.true` +
    `&select=name,images,price,description&limit=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(query, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as PreviewProduct[];
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    // A failed lookup still gets a valid card — a preview without a price beats
    // a crawler timing out and showing nothing.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') ?? '';

  // Same shape the SPA route accepts. Validated rather than merely encoded so a
  // crafted slug cannot reach the PostgREST filter grammar at all.
  if (!/^[a-z0-9_-]{1,128}$/i.test(slug)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
  const botUsername = env.VITE_TELEGRAM_BOT_USERNAME ?? 'KuPi_ShoP_Store_Bot';
  const shopName = env.VITE_SHOP_NAME ?? 'Point Tech';

  const product =
    supabaseUrl && anonKey ? await fetchProduct(supabaseUrl, anonKey, slug) : null;

  const html = buildPreviewHtml({ product, slug, botUsername, shopName });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
