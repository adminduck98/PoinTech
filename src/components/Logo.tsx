interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'icon' | 'full' | 'text';
  className?: string;
}

const sizes = {
  sm: { icon: 28, text: 'text-sm', sub: false },
  md: { icon: 36, text: 'text-base', sub: true },
  lg: { icon: 48, text: 'text-xl', sub: true },
  xl: { icon: 64, text: 'text-2xl', sub: true },
};

/**
 * Tight bounding box of the mark in its own coordinates: the ring spans
 * x -67.5…67.5, the dot pushes the left edge out to -68.1, and the stem runs
 * down to y 117.9 from the ring's top at -67.5. Hard-coded rather than measured
 * so the mark keeps its optical proportions at every size.
 */
const VIEW_BOX = '-68.1 -67.5 135.6 185.4';
const MARK_RATIO = 135.6 / 185.4;

/**
 * The brand mark — the lowercase `i` and the open `P` of Point Tech.
 *
 * Drawn inline in `currentColor` rather than as an image, because the tile
 * behind it inverts between themes and between placements: on the accent tile
 * it is white, on a plain surface it takes the text colour. A flat asset can
 * only ever be one of those.
 *
 * `size` is the *height* of the mark; the width follows from MARK_RATIO. The
 * previous mark was wider than it was tall and took `size` as its width, so the
 * two are not interchangeable — every caller passes a value tuned to the tile
 * it sits in.
 *
 * The two-colour lockup (dark wordmark, blue dot) lives in
 * src/assets/pointtech-logo.svg and is what to hand out for anything printed;
 * this component is the single-colour app version of the same geometry.
 */
export const BrandMark = ({ size, className = '' }: { size: number; className?: string }) => (
  <svg
    role="img"
    aria-label="Point Tech"
    className={className}
    viewBox={VIEW_BOX}
    width={size * MARK_RATIO}
    height={size}
    fill="currentColor"
    style={{ display: 'block' }}
  >
    <path d="M -66.14 -13.46 A 67.50 67.50 0 1 1 -26.37 62.13 L -16.59 47.91 A 50.70 50.70 0 1 0 -48.86 -13.55 Z" />
    <circle cx="-50.40" cy="16.80" r="17.70" />
    <rect x="-60.90" y="47.70" width="17.40" height="70.20" />
  </svg>
);

export const Logo = ({ size = 'md', variant = 'full', className = '' }: LogoProps) => {
  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className="gradient-brand rounded-xl flex items-center justify-center flex-shrink-0 shadow-accent"
        style={{
          width: s.icon,
          height: s.icon,
          color: 'rgb(var(--text-on-accent))',
          borderRadius: s.icon * 0.3,
        }}
      >
        <BrandMark size={s.icon * 0.62} />
      </div>
      {variant !== 'icon' && (
        <div className="flex flex-col leading-none">
          <span className={`font-display font-semibold tracking-[0.04em] text-text whitespace-nowrap ${s.text}`}>
            POINT <span className="text-accent">TECH</span>
          </span>
          {s.sub && (
            <span className="text-2xs font-medium text-text-tertiary tracking-[0.15em] uppercase mt-0.5">
              technology
            </span>
          )}
        </div>
      )}
    </div>
  );
};
