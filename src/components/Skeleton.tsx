interface SkeletonProps {
  className?: string;
  variant?: 'rect' | 'circle' | 'text' | 'card';
}

export const Skeleton = ({ className = '', variant = 'rect' }: SkeletonProps) => {
  const base = 'skeleton rounded-xl animate-pulse';
  const dark = '';

  if (variant === 'circle') {
    return <div className={`${base} ${dark} rounded-full ${className}`} />;
  }

  if (variant === 'text') {
    return <div className={`${base} ${dark} h-4 rounded-lg ${className}`} />;
  }

  if (variant === 'card') {
    return (
      <div className={`${base} ${dark} rounded-2xl ${className}`}>
        <div className="aspect-square w-full rounded-t-2xl skeleton " />
        <div className="p-3 space-y-2">
          <div className="skeleton  h-3.5 w-3/4 rounded-lg" />
          <div className="skeleton  h-3 w-1/2 rounded-lg" />
          <div className="skeleton  h-4 w-1/3 rounded-lg" />
        </div>
      </div>
    );
  }

  return <div className={`${base} ${dark} ${className}`} />;
};

export const ProductCardSkeleton = () => (
  <div className="card-premium p-1.5 overflow-hidden h-full">
    <div className="aspect-[4/5] skeleton rounded-[1rem]" />
    {/* Порядок блоков повторяет ProductCard: название, подзаголовок,
        цена на всю ширину и строка «статус + кнопка» под ней. */}
    <div className="px-2 pt-2.5 pb-1.5 space-y-2.5">
      <div className="skeleton  h-3.5 w-3/4 rounded-lg" />
      <div className="skeleton  h-3 w-1/2 rounded-lg" />
      <div className="skeleton  h-5 w-4/5 rounded-lg" />
      <div className="flex items-center justify-between">
        <div className="skeleton  h-3 w-16 rounded-lg" />
        <div className="skeleton  h-9 w-9 rounded-full" />
      </div>
    </div>
  </div>
);

export const OrderCardSkeleton = () => (
  <div className="card-premium p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="skeleton  h-4 w-24 rounded-lg" />
      <div className="skeleton  h-5 w-16 rounded-full" />
    </div>
    <div className="space-y-2">
      <div className="skeleton  h-3 w-full rounded-lg" />
      <div className="skeleton  h-3 w-2/3 rounded-lg" />
    </div>
    <div className="skeleton  h-4 w-32 rounded-lg" />
  </div>
);

export const BannerSkeleton = () => (
  <div className="aspect-[16/7] skeleton  rounded-2xl" />
);
