import { useEffect, useRef } from 'react';

/** CSS variable the measured height is published to. */
const BAR_HEIGHT_VAR = '--fixed-bar-height';

/**
 * Measure a fixed bottom bar and publish its height so page content can reserve
 * exactly that much space.
 *
 * The pages that carry such a bar used to reserve room with a hand-picked
 * `pb-28` / `pb-36`, which is a guess about a height nobody measured. It held
 * only by luck: the bar's real height depends on its padding, the button size
 * at the current breakpoint, the user's font scale, and
 * `env(safe-area-inset-bottom)` on phones with a home indicator. Change any of
 * those — or the bar's contents — and the last row of content slides underneath
 * it. `--bottom-nav-height` exists for exactly this job but only covers the
 * navigation bar, not these page-level ones.
 *
 * The element is observed, so the value follows rotation, font-scale changes
 * and content that grows. The bar's own `pb-safe` padding is inside the
 * measured box, so callers must NOT add `env(safe-area-inset-bottom)` again.
 *
 * One variable is enough because these bars belong to whole routes and only one
 * is ever mounted at a time; it is removed on unmount so a route without a bar
 * cannot inherit a stale value.
 */
export function useFixedBarSpacing<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const root = document.documentElement;
    const apply = () => {
      const { height } = element.getBoundingClientRect();
      if (height > 0) root.style.setProperty(BAR_HEIGHT_VAR, `${Math.ceil(height)}px`);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);

    return () => {
      observer.disconnect();
      root.style.removeProperty(BAR_HEIGHT_VAR);
    };
  }, []);

  return ref;
}

/**
 * Padding that clears the bar. The fallback covers the first paint, before the
 * observer has reported a height.
 */
export const FIXED_BAR_SPACING = `var(${BAR_HEIGHT_VAR}, 7rem)`;
