import { useState } from 'react';
import { ChevronRight, ChevronUp } from 'lucide-react';
import { ProductCard } from './ProductCard';
import { useCollectionProducts, useFavoriteIds } from '../lib/supabase/hooks';
import { useUserId } from '../hooks/useUserId';
import { getLocalizedValue } from '../lib/utils';
import { categoryIcon } from '../lib/categoryIcons';
import type { ProductCollection } from '../lib/supabase/queries';

interface CollectionSectionProps {
  collection: ProductCollection;
  language: 'ru' | 'uz';
}

export const CollectionSection = ({ collection, language }: CollectionSectionProps) => {
  const userId = useUserId();
  const { data: favoriteIds = [] } = useFavoriteIds(userId);
  const productIds = collection.product_ids ?? [];
  const { data: products = [], isLoading } = useCollectionProducts(productIds);
  /**
   * Кнопка «Все» раньше была нарисована, но ничего не делала: подборок в базе не
   * было, и нажать её было негде. Теперь она разворачивает ленту в сетку —
   * отдельной страницы у подборки нет, а горизонтальная прокрутка прячет
   * половину товаров.
   */
  const [expanded, setExpanded] = useState(false);

  if (productIds.length === 0) return null;

  const Icon = categoryIcon(collection.icon);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between px-4 mb-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-text">
          <Icon className="w-4 h-4 text-accent" />
          {getLocalizedValue(collection.name, language)}
        </h2>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-0.5 text-xs font-bold text-accent transition-colors"
        >
          {expanded
            ? (language === 'ru' ? 'Свернуть' : 'Yigish')
            : (language === 'ru' ? 'Все' : 'Hammasi')}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isLoading ? (
        <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-shrink-0 w-[160px]">
              <div className="rounded-2xl bg-surface-muted h-48 skeleton" />
            </div>
          ))}
        </div>
      ) : expanded ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} language={language} favoriteIds={favoriteIds} />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide pb-1">
          {/*
            Обёртки здесь намеренно без h-full — в отличие от сеток в
            Catalog/Home/Favorites.

            Контейнер flex имеет высоту auto, и height:100% на его элементе
            разрешать не от чего: значение схлопывается обратно в auto и заодно
            отменяет растягивание по align-items. Плитки тогда стоят каждая по
            своему контенту — замеры давали 312 px против 329 у соседа с
            трёхстрочным названием. Растягивание по умолчанию делает это само,
            а h-full на самой карточке уже считается от растянутой обёртки.
          */}
          {products.map((product) => (
            <div key={product.id} className="flex-shrink-0 w-[160px]">
              <ProductCard product={product} language={language} favoriteIds={favoriteIds} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
