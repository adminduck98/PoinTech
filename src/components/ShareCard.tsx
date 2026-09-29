import { useState } from 'react';
import { Send, Copy, Check, ExternalLink } from 'lucide-react';
import { Portal } from './Portal';
import { formatPrice, getLocalizedValue } from '../lib/utils';
import { haptic, tg } from '../lib/telegram';
import { toast } from './Toast';
import { SHOP_NAME, productLink } from '../lib/config';

interface ShareCardProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    slug: string;
    name: { ru: string; uz: string } | string;
    price: number;
    description?: { ru: string; uz: string } | string;
    images: string[];
  };
  language: 'ru' | 'uz';
}

const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fallback below */ }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch { /* noop */ }
  document.body.removeChild(textarea);
  return ok;
};

const openTgLink = (url: string): boolean => {
  const telegramApp = tg || (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
  if (telegramApp && typeof telegramApp.openTelegramLink === 'function') {
    try {
      telegramApp.openTelegramLink(url);
      return true;
    } catch { /* fallback below */ }
  }
  return false;
};

export const ShareCard = ({ isOpen, onClose, product, language }: ShareCardProps) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !product) return null;

  const productName = getLocalizedValue(product.name, language);
  const productDesc = product.description
    ? getLocalizedValue(product.description, language).slice(0, 120)
    : '';
  const price = formatPrice(product.price);
  const imageUrl = product.images[0] || '';
  // `startapp` opens the Mini App; `start` only opens a chat with the bot.
  const deepLink = productLink(product.slug);
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/product/${product.slug}`;

  const shareText = [
    `🛍 ${productName}`,
    `💰 ${price}`,
    productDesc ? `\n${productDesc}` : '',
    `\n👉 ${deepLink}`,
    `\n🛒 ${SHOP_NAME} — магазин в Telegram`,
  ].filter(Boolean).join('\n');

  const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;

  const handleCopyLink = async () => {
    haptic.confirm();
    const ok = await copyToClipboard(deepLink);
    if (ok) {
      haptic.success();
      setCopied(true);
      toast.success(language === 'ru' ? 'Ссылка скопирована' : 'Havola nusxalandi');
      setTimeout(() => setCopied(false), 2000);
    } else {
      haptic.error();
      toast.error(language === 'ru' ? 'Не удалось скопировать ссылку' : 'Havolani nusxaolib bo\'lmadi');
    }
  };

  const handleCopyMessage = async () => {
    haptic.confirm();
    const ok = await copyToClipboard(shareText);
    if (ok) {
      haptic.success();
      toast.success(language === 'ru' ? 'Текст скопирован' : 'Matn nusxalandi');
    } else {
      haptic.error();
      toast.error(language === 'ru' ? 'Не удалось скопировать текст' : 'Matnni nusxaolib bo\'lmadi');
    }
  };

  const handleShareTelegram = () => {
    haptic.confirm();
    if (!openTgLink(tgShareUrl)) {
      window.open(tgShareUrl, '_blank');
    }
  };

  const handleShareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: productName,
          text: shareText,
          url: deepLink,
        });
        return;
      } catch (err) {
        // AbortError is a genuine user cancellation — nothing to do.
        // Any other error (common in Telegram's in-app WebView, where
        // navigator.share exists but isn't actually functional) needs a
        // fallback so the tap doesn't silently do nothing.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    const ok = await copyToClipboard(shareText);
    if (ok) {
      haptic.success();
      toast.success(language === 'ru' ? 'Текст скопирован' : 'Matn nusxalandi');
    } else {
      haptic.error();
      toast.error(language === 'ru' ? 'Не удалось скопировать' : 'Nusxaolib bo\'lmadi');
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-end sm:justify-center bg-[color:var(--overlay)] backdrop-blur-md pointer-events-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onClick={onClose}
      >
        <div
          className="bg-surface w-full sm:max-w-[400px] max-h-[85dvh] rounded-t-3xl sm:rounded-3xl overflow-y-auto animate-slide-up"
          onClick={(e) => e.stopPropagation()}
          style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        >
          {/* ─── Card Preview ─── */}
          <div className="bg-gray-50 p-4">
            <div className="card-premium overflow-hidden border-border-subtle">
              {/* Product image — square */}
              <div className="relative w-full aspect-square bg-gray-100">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={productName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm">
                    POINT TECH
                  </div>
                )}
                {/* Brand watermark */}
                <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/70 backdrop-blur-sm rounded-lg">
                  <span className="text-white text-[10px] font-bold tracking-wider">POINT TECH</span>
                </div>
              </div>

              {/* Info block */}
              <div className="p-4">
                <h3
                  className="font-semibold text-gray-900 text-sm leading-snug mb-1.5"
                  style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {productName}
                </h3>
                <p className="text-lg font-extrabold text-gray-900 mb-1">
                  {price}
                </p>
                {productDesc && (
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                    {productDesc}
                  </p>
                )}
              </div>

              {/* Divider */}
              <div className="mx-4 border-t border-gray-100" />

              {/* CTA */}
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span>🛒</span>
                  <span>POINT TECH Mini App</span>
                </div>
                <div className="px-3 py-1.5 bg-[#1668E0] rounded-lg">
                  <span className="text-white text-[11px] font-semibold">
                    {language === 'ru' ? 'Открыть в Point Tech' : 'Point Tech da ochish'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Actions ─── */}
          <div className="p-4 space-y-2.5">
            {/* Share via Telegram */}
            <button
              onClick={handleShareTelegram}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium text-sm transition-colors active:scale-[0.98]"
            >
              <Send className="w-4 h-4" />
              {language === 'ru' ? 'Поделиться в Telegram' : 'Telegramda ulashish'}
            </button>

            {/* Native share */}
            {typeof navigator !== 'undefined' && !!navigator.share && (
              <button
                onClick={handleShareNative}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium text-sm transition-colors active:scale-[0.98]"
              >
                <ExternalLink className="w-4 h-4" />
                {language === 'ru' ? 'Другие приложения' : 'Boshqa ilovalar'}
              </button>
            )}

            {/* Copy link */}
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium text-sm transition-colors active:scale-[0.98]"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              {copied
                ? (language === 'ru' ? 'Скопировано!' : 'Nusxalandi!')
                : (language === 'ru' ? 'Копировать ссылку' : 'Havolani nusxalash')}
            </button>

            {/* Copy formatted message */}
            <button
              onClick={handleCopyMessage}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium text-sm transition-colors active:scale-[0.98]"
            >
              <Copy className="w-4 h-4" />
              {language === 'ru' ? 'Копировать текст' : 'Matnni nusxalash'}
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="w-full py-2.5 text-gray-400 text-xs font-medium hover:text-gray-600 transition-colors"
            >
              {language === 'ru' ? 'Закрыть' : 'Yopish'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};
