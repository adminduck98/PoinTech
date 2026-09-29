import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  productId: string;
  name: { ru: string; uz: string };
  price: number;
  image: string;
  quantity: number;
  size?: string;
  color?: { name: string; hex: string };
}

interface CartStore {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string, size?: string, color?: string) => void;
  updateQuantity: (productId: string, quantity: number, size?: string, color?: string) => void;
  syncPrices: (prices: Record<string, number>) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

/**
 * The identity of a cart line: one row per product / size / colour.
 *
 * Price is deliberately not part of it. The same shirt in the same size and
 * colour is one line whatever it cost when it was added, and `checkout`
 * re-reads every price from the database anyway (see supabase/functions/
 * checkout/index.ts) — the stored figure is for display only.
 *
 * This used to be written out by hand in `addItem`, `removeItem`,
 * `updateQuantity` and again as the React key in Cart.tsx. Four copies of one
 * rule is three chances for it to drift, and the React key was built with '-'
 * as a separator, so a product id ending in a digit and a size beginning with
 * one could in principle collide. A single definition with a separator that
 * cannot appear in an id, a size or a hex colour removes both problems.
 */
export const cartItemKey = (productId: string, size?: string, colorHex?: string) =>
  `${productId}\u001f${size ?? ''}\u001f${colorHex ?? ''}`;

const keyOf = (item: CartItem) => cartItemKey(item.productId, item.size, item.color?.hex);

/**
 * Collapse any rows that share an identity, summing their quantities.
 *
 * `addItem` is the only code path that appends, and it merges, so a cart this
 * app built is already unique. Persisted state is the gap: a cart written by an
 * older build — or hand-edited, or left in localStorage across a deploy that
 * changed how a line was keyed — is read back verbatim and trusted. Two rows
 * sharing an identity then break three things at once: React renders duplicate
 * keys, `removeItem` deletes both rows instead of the one tapped, and
 * `updateQuantity` retargets both.
 *
 * Later rows win on everything but quantity, so the surviving line carries the
 * most recent price snapshot rather than the staler one. Map preserves the
 * insertion position of a key that is set twice, so the cart keeps its order.
 */
const dedupeItems = (items: readonly CartItem[]): CartItem[] => {
  const byKey = new Map<string, CartItem>();

  for (const item of items) {
    // A row with no product id has no identity and cannot be acted on: it
    // could never be removed or re-quantified, only sit in the cart forever.
    if (!item || typeof item.productId !== 'string' || !item.productId) continue;

    // Quantities arrive from storage unvalidated, and one NaN would spread
    // through the sum below into getTotalPrice, rendering the whole cart total
    // as NaN. Clamped rather than dropped: a corrupt number is a reason to
    // distrust the quantity, not to silently delete something the customer
    // put in their cart. This is the same floor updateQuantity applies.
    const parsedQuantity = Math.floor(Number(item.quantity));
    const quantity = Number.isFinite(parsedQuantity) ? Math.max(1, parsedQuantity) : 1;

    // Price gets the same treatment, for the same reason: getTotalPrice
    // multiplies by it, so one bad value poisons the whole total. Negatives are
    // clamped too — a hand-edited localStorage entry of -1000000 would
    // otherwise render a cart that appears to owe the customer money.
    //
    // Falling back to 0 rather than dropping the row is safe because the price
    // held here is for display only: supabase/functions/checkout re-reads every
    // price from the products table and treats the client's total as advisory,
    // so a row that shows 0 here is still billed correctly. It looks wrong
    // rather than silently charging wrong, which is the right way round.
    const parsedPrice = Number(item.price);
    const price = Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 0;

    const key = keyOf(item);
    const existing = byKey.get(key);
    const normalized = { ...item, quantity, price };
    byKey.set(key, existing ? { ...normalized, quantity: existing.quantity + quantity } : normalized);
  }

  return [...byKey.values()];
};

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        set((state) => {
          const key = keyOf(item);
          const existingItemIndex = state.items.findIndex((i) => keyOf(i) === key);

          if (existingItemIndex > -1) {
            const newItems = [...state.items];
            newItems[existingItemIndex] = {
              ...newItems[existingItemIndex],
              quantity: newItems[existingItemIndex].quantity + item.quantity,
            };
            return { items: newItems };
          }

          if (state.items.length >= 100) return state;
          return { items: [...state.items, item] };
        });
      },

      removeItem: (productId, size, color) => {
        const key = cartItemKey(productId, size, color);
        set((state) => ({
          items: state.items.filter((item) => keyOf(item) !== key),
        }));
      },

      updateQuantity: (productId, quantity, size, color) => {
        const key = cartItemKey(productId, size, color);
        set((state) => ({
          items: state.items.map((item) =>
            keyOf(item) === key ? { ...item, quantity: Math.max(1, quantity) } : item
          ),
        }));
      },

      /**
       * Replace the stored price snapshots with prices just read from the
       * database, keyed by product id.
       *
       * A cart line records what the product cost when it was added. Left
       * alone that figure drifts: a price changed while the item sat in
       * someone's cart shows the old number until they check out, at which
       * point `supabase/functions/checkout` re-reads the real price and the
       * total moves under them. Refreshing here rather than in a component
       * keeps every reader — the cart, the checkout summary, getTotalPrice —
       * on one number instead of leaving each to correct the snapshot itself.
       *
       * Returning `state` unchanged when nothing moved is load-bearing, not an
       * optimisation: zustand skips the notify when set returns the identical
       * object, so the `items` reference survives, and the caller's effect —
       * which fetched these prices in the first place — is not retriggered
       * into a fetch/sync loop.
       */
      syncPrices: (prices) => {
        set((state) => {
          let changed = false;

          const next = state.items.map((item) => {
            const live = prices[item.productId];
            // An absent id (product deleted) or a nonsensical figure leaves the
            // snapshot in place — a stale price beats replacing it with junk.
            if (typeof live !== 'number' || !Number.isFinite(live) || live < 0) return item;
            if (item.price === live) return item;
            changed = true;
            return { ...item, price: live };
          });

          return changed ? { items: next } : state;
        });
      },

      clearCart: () => {
        set({ items: [] });
      },

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getTotalPrice: () => {
        return get().items.reduce((total, item) => total + item.price * item.quantity, 0);
      },
    }),
    {
      name: 'cart-storage',
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            return str ? JSON.parse(str) : null;
          } catch { return null; }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch {
            try {
              const parsed = JSON.parse(JSON.stringify(value));
              if (parsed?.state?.items?.length > 10) {
                parsed.state.items = parsed.state.items.slice(-10);
                localStorage.setItem(name, JSON.stringify(parsed));
              }
            } catch { /* storage unavailable */ }
          }
        },
        removeItem: (name) => {
          try { localStorage.removeItem(name); } catch { /* ignore */ }
        },
      },

      /**
       * Everything read back from localStorage passes through dedupeItems.
       *
       * This is the one place a cart can enter the app without having gone
       * through addItem, so it is the one place the per-line uniqueness the
       * rest of the store assumes can be violated. Repairing on the way in
       * means every reader downstream — the React keys, removeItem,
       * updateQuantity, the totals — can keep treating it as guaranteed.
       *
       * Doing this in `merge` rather than `migrate` is deliberate: migrate only
       * runs when the persisted version differs, which would repair today's
       * stale carts once and then stop watching. merge runs on every
       * rehydration, so a cart broken by any future route is still repaired.
       */
      merge: (persisted, current) => {
        const state = (persisted ?? {}) as Partial<CartStore>;
        return {
          ...current,
          ...state,
          items: dedupeItems(Array.isArray(state.items) ? state.items : []),
        };
      },
    }
  )
);
