import { supabase, USE_MOCK_DATA, Database } from '../supabase';
import { adminQueries } from '../adminApi';
import { delay, mockProducts, mockCategories } from './mock';
import { encodeFileForUpload } from '../fileUpload';

export type Product = Database['public']['Tables']['products']['Row'];
export type Category = Database['public']['Tables']['categories']['Row'];

export interface ProductFilters {
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  colors?: string[];
  inStock?: boolean;
  search?: string;
}

export interface ProductSort {
  field: 'created_at' | 'price' | 'views';
  order: 'asc' | 'desc';
}

export const PAGE_SIZE = 20;

/** One page of products, plus everything the caller needs to ask for the next. */
export interface ProductPage {
  items: Product[];
  /** Rows matching the *server-side* filters. Exact unless `approximate`. */
  total: number;
  /** Offset to pass for the next page — counted in server rows, not shown rows. */
  nextOffset: number;
  hasMore: boolean;
  /**
   * True when a filter had to be applied in the browser, so `total` counts more
   * rows than will actually be displayed.
   */
  approximate: boolean;
}

/**
 * Escape a user's search term for a PostgREST `or=(…)` filter.
 *
 * Two layers, and they have to be applied in this order:
 *
 *  1. LIKE: `%` and `_` are wildcards and `\` is the escape character, so each
 *     is prefixed with a backslash to match literally.
 *  2. PostgREST: the result is wrapped in double quotes by the caller, which is
 *     what makes `,` `.` `(` `)` literal rather than filter syntax. Inside
 *     those quotes `"` and `\` need escaping in turn.
 *
 * The previous version escaped only `% _ ( )` and did not quote, so a comma —
 * the separator between conditions in `or=(…)` — split the term into extra
 * filter clauses. Searching "футболка, синяя" either returned 400 and an empty
 * catalogue or silently ran a different query than the one asked for.
 */
function escapeSearchTerm(term: string): string {
  return term
    .replace(/[%_\\]/g, '\\$&')
    .replace(/["\\]/g, '\\$&');
}

export const productQueries = {
  getAll: async (filters?: ProductFilters, sort?: ProductSort, offset = 0, limit = PAGE_SIZE): Promise<ProductPage> => {
    if (USE_MOCK_DATA) {
      await delay();
      let items = [...mockProducts].filter((p) => p.is_active);
      if (filters?.categoryId) items = items.filter((p) => p.category_id === filters.categoryId);
      if (filters?.minPrice !== undefined) items = items.filter((p) => p.price >= filters.minPrice!);
      if (filters?.maxPrice !== undefined) items = items.filter((p) => p.price <= filters.maxPrice!);
      if (filters?.inStock) items = items.filter((p) => p.stock > 0);
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        items = items.filter((p) => p.name.ru.toLowerCase().includes(q) || p.name.uz.toLowerCase().includes(q));
      }
      if (filters?.sizes?.length) items = items.filter((p) => p.sizes.some((s) => filters.sizes!.includes(s)));
      if (filters?.colors?.length) items = items.filter((p) => p.colors.some((c) => filters.colors!.includes(c.hex)));
      if (sort) items.sort((a, b) => sort.order === 'asc' ? (a[sort.field] as number) - (b[sort.field] as number) : (b[sort.field] as number) - (a[sort.field] as number));
      const page = items.slice(offset, offset + limit);
      return {
        items: page as Product[],
        total: items.length,
        nextOffset: offset + page.length,
        hasMore: offset + page.length < items.length,
        approximate: false,
      };
    }

    let query = supabase.from('products').select('*', { count: 'exact' }).eq('is_active', true);

    if (filters?.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters?.minPrice !== undefined) query = query.gte('price', filters.minPrice);
    if (filters?.maxPrice !== undefined) query = query.lte('price', filters.maxPrice);
    if (filters?.search?.trim()) {
      const s = escapeSearchTerm(filters.search.trim());
      // `->>`, not `->`. The single arrow yields jsonb, and there is no
      // `jsonb ILIKE text` operator, so every search — not just ones with a
      // comma — failed with `42883 operator does not exist: jsonb ~~* unknown`
      // and the catalogue came back empty. Confirmed against a real database:
      // with `->` even a plain one-word query errors; with `->>` the same query
      // returns matches, and the quoting above keeps `,` `%` `_` literal.
      query = query.or(
        `name->>ru.ilike."%${s}%",name->>uz.ilike."%${s}%",description->>ru.ilike."%${s}%",description->>uz.ilike."%${s}%"`
      );
    }
    if (filters?.inStock) query = query.gt('stock', 0);
    // `sizes` is text[], so "has any of these" is a single server-side overlap.
    // It used to be filtered in the browser after paging, which is what broke
    // pagination (see below).
    if (filters?.sizes?.length) query = query.overlaps('sizes', filters.sizes);

    if (sort) {
      query = query.order(sort.field, { ascending: sort.order === 'asc' });
    } else {
      query = query.order('created_at', { ascending: false });
    }
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Product[];
    const total = count ?? 0;

    // `colors` is jsonb[] — a Postgres array of objects — and PostgREST has no
    // predicate for "any element has this hex", so this one filter still runs
    // here. That is fine as long as paging is counted in *server* rows:
    //
    // the offset for the next page must advance by however many rows the server
    // returned, never by how many survived this filter. The old code returned
    // the filtered array and let the caller sum its lengths, so a page of 20
    // rows that filtered down to 5 asked for the next page at offset 5 — which
    // re-fetched rows 5–19, duplicating them in the list (and duplicating React
    // keys) while the tail of the catalogue was never reached.
    const items = filters?.colors?.length
      ? rows.filter((p) => p.colors?.some((c: { hex: string }) => filters.colors!.includes(c.hex)))
      : rows;

    return {
      items,
      total,
      nextOffset: offset + rows.length,
      hasMore: offset + rows.length < total,
      approximate: items.length !== rows.length,
    };
  },

  /**
   * How many products are actually on sale. `head: true` asks PostgREST for the
   * count and no rows at all — the About page wants the figure, not the
   * catalogue, and paying for a 20-row page to read `total` off it would be
   * twenty products of payload for one number.
   */
  getActiveCount: async (): Promise<number> => {
    if (USE_MOCK_DATA) { await delay(); return mockProducts.filter((p) => p.is_active).length; }
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    if (error) throw error;
    return count ?? 0;
  },

  getBySlug: async (slug: string) => {
    if (USE_MOCK_DATA) { await delay(); return mockProducts.find((p) => p.slug === slug) ?? null; }
    const { data, error } = await supabase.from('products').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data;
  },

  incrementViews: async (id: string) => {
    if (USE_MOCK_DATA) return;
    await supabase.rpc('increment_views', { p_id: id });
  },

  /**
   * Загружает фото товаров через admin-api.
   *
   * Раньше запись шла прямо в хранилище анон-ключом, а имя файла (и его
   * расширение) приходило от загружающего. Теперь путь генерирует сервер, а
   * тип и размер проверяются до записи.
   */
  uploadImages: async (files: File[]) => {
    if (USE_MOCK_DATA) return files.map(() => 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80');
    return Promise.all(files.map(async (file) => {
      const encoded = await encodeFileForUpload(file);
      const { url } = await adminQueries.uploadProductImage(encoded);
      return url;
    }));
  },
};

export const inventoryQueries = {
  updateStock: async (productId: string, newStock: number) => {
    if (USE_MOCK_DATA) { await delay(); return { id: productId, stock: newStock }; }
    const data = await adminQueries.updateProduct(productId, { stock: newStock, updated_at: new Date().toISOString() });
    return { id: productId, stock: (data as { stock: number }).stock };
  },

  adjustStock: async (productId: string, delta: number) => {
    if (USE_MOCK_DATA) { await delay(); return { id: productId, stock: 0 }; }
    const products = await adminQueries.getProducts() as Array<{ id: string; stock: number }>;
    const p = products.find((p) => p.id === productId);
    const newStock = Math.max(0, (p?.stock ?? 0) + delta);
    const updated = await adminQueries.updateProduct(productId, { stock: newStock, updated_at: new Date().toISOString() });
    return { id: productId, stock: (updated as { stock: number }).stock };
  },

  getAllWithStock: async () => {
    if (USE_MOCK_DATA) { await delay(); return mockProducts; }
    const { data, error } = await supabase.from('products').select('id, name, slug, price, stock, images, is_active, category_id').order('stock', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
};

export type CategoryWithCount = Category & { product_count: number };

export const categoryQueries = {
  getAll: async () => {
    if (USE_MOCK_DATA) { await delay(); return mockCategories; }
    const { data, error } = await supabase.from('categories').select('*').order('name->ru');
    if (error) throw error;
    return data;
  },

  getAllWithProductCount: async (): Promise<CategoryWithCount[]> => {
    if (USE_MOCK_DATA) { await delay(); return mockCategories.map((c) => ({ ...c, product_count: 0 })); }
    const [{ data: categories, error: catError }, { data: products }] = await Promise.all([
      supabase.from('categories').select('*').order('name->ru'),
      supabase.from('products').select('category_id'),
    ]);
    if (catError) throw catError;
    const counts: Record<string, number> = {};
    (products ?? []).forEach((p) => { if (p.category_id) counts[p.category_id] = (counts[p.category_id] ?? 0) + 1; });
    return (categories ?? []).map((c) => ({ ...c, product_count: counts[c.id] ?? 0 }));
  },

  create: async (data: Database['public']['Tables']['categories']['Insert']) => {
    if (USE_MOCK_DATA) { await delay(); return { ...data, id: `cat-${Date.now()}`, created_at: new Date().toISOString() } as Category; }
    return adminQueries.createCategory(data as Record<string, unknown>);
  },

  update: async (id: string, data: Database['public']['Tables']['categories']['Update']) => {
    if (USE_MOCK_DATA) { await delay(); return data as Category; }
    return adminQueries.updateCategory(id, data as Record<string, unknown>);
  },

  delete: async (id: string) => {
    if (USE_MOCK_DATA) { await delay(); return; }
    await adminQueries.deleteCategory(id);
  },
};
