import {
  Tag, ShoppingBag, Shirt, Watch, Smartphone, Laptop, WashingMachine, Headphones,
  Gift, Heart, Star, Home, Zap, Coffee, Sparkles, Gamepad2, BookOpen, Baby,
  Music, Camera, Gem,
  // Бытовая техника — под ассортимент магазина.
  Refrigerator, Microwave, AirVent, Wind, UtensilsCrossed, CookingPot, Plug, Wrench, Droplets,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Значки категорий: имя, как оно лежит в `categories.icon`, → компонент.
 *
 * Общий на админку и витрину. Раньше список жил только в форме категорий, а
 * кнопка выбора рисовала `icon.slice(0, 3)` — первые три буквы названия, из
 * которых нельзя понять, что будет выбрано. На витрине значок не показывался
 * вовсе: поле хранилось, но чипы каталога были просто текстом.
 *
 * Список вариантов выводится из этой же карты (ICON_OPTIONS), поэтому имя без
 * картинки в него не попадёт.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'tag': Tag,
  'shopping-bag': ShoppingBag,
  'shirt': Shirt,
  'watch': Watch,
  'smartphone': Smartphone,
  'laptop': Laptop,
  'washing-machine': WashingMachine,
  'refrigerator': Refrigerator,
  'microwave': Microwave,
  'air-vent': AirVent,
  'wind': Wind,
  'utensils-crossed': UtensilsCrossed,
  'cooking-pot': CookingPot,
  'plug': Plug,
  'wrench': Wrench,
  'droplets': Droplets,
  'headphones': Headphones,
  'gift': Gift,
  'heart': Heart,
  'star': Star,
  'home': Home,
  'zap': Zap,
  'coffee': Coffee,
  'sparkles': Sparkles,
  'gamepad-2': Gamepad2,
  'book-open': BookOpen,
  'baby': Baby,
  'music': Music,
  'camera': Camera,
  'gem': Gem,
};

/** Имена для выбора в админке — ровно те, что карта умеет нарисовать. */
export const ICON_OPTIONS = Object.keys(CATEGORY_ICONS);

/**
 * Значок категории с запасным вариантом.
 *
 * Категория могла быть заведена до появления какого-то значка, или её `icon`
 * пуст — тогда рисуется ярлык, а не пустое место, которое ломало бы выравнивание
 * текста в чипе.
 */
export const categoryIcon = (icon: string | null | undefined): LucideIcon =>
  (icon && CATEGORY_ICONS[icon]) || Tag;
