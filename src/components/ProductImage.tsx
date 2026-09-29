import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  /** Rendered while the image is still loading. */
  showSkeleton?: boolean;
  loading?: 'lazy' | 'eager';
  /**
   * The image sits on the always-white product stage. Placeholder and skeleton
   * then use fixed light greys instead of theme surfaces, which in the dark
   * theme would punch a black hole into the white tile.
   */
  onLight?: boolean;
}

/**
 * Product image with the three outcomes handled explicitly.
 *
 * The previous inline markup revealed the image on `onLoad` and showed a
 * skeleton until then, which broke in two ways:
 *
 *   * `src={product.images?.[0]}` on a product with no images renders an <img>
 *     with no src attribute. The browser never loads anything, `onLoad` never
 *     fires, and the skeleton shimmered for ever.
 *   * A broken or expired image URL fired `onError`, which nothing listened
 *     for — same permanent skeleton.
 *
 * Both now fall through to a static placeholder.
 */
export const ProductImage = ({
  src,
  alt,
  className = '',
  showSkeleton = true,
  loading = 'lazy',
  onLight = false,
}: ProductImageProps) => {
  const hasSrc = typeof src === 'string' && src.trim().length > 0;
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(
    hasSrc ? 'loading' : 'failed',
  );
  const imgRef = useRef<HTMLImageElement | null>(null);

  // The same component instance is reused as the user scrolls a list, so reset
  // when the source changes.
  useEffect(() => {
    setStatus(hasSrc ? 'loading' : 'failed');
  }, [src, hasSrc]);

  /**
   * A cached image can already be decoded by the time React attaches onLoad,
   * in which case the event never fires and the element would stay at
   * opacity 0 behind the skeleton for ever. Read the element's own state on
   * mount instead of relying solely on the event.
   */
  const attachRef = useCallback((node: HTMLImageElement | null) => {
    imgRef.current = node;
    if (!node) return;
    if (node.complete) {
      setStatus(node.naturalWidth > 0 ? 'loaded' : 'failed');
    }
  }, []);

  if (status === 'failed') {
    return (
      <div
        className={`flex items-center justify-center rounded-xl ${onLight ? 'bg-[#F1F3F7]' : 'bg-surface-muted'} ${className}`}
        role="img"
        aria-label={alt}
      >
        <ImageOff className={`w-8 h-8 ${onLight ? 'text-[#B4BAC6]' : 'text-text-tertiary'}`} aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      {showSkeleton && status === 'loading' && (
        <div
          className={`absolute inset-0 skeleton ${onLight ? '!bg-[#EEF1F5]' : ''}`}
          aria-hidden="true"
        />
      )}
      <img
        ref={attachRef}
        src={src as string}
        alt={alt}
        loading={loading}
        decoding="async"
        className={`${className} transition-opacity duration-500 ${
          status === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
      />
    </>
  );
};
