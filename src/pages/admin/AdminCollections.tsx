import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff, GripVertical, ShoppingBag, LogOut, Check } from 'lucide-react';
import { useCollections, useCreateCollection, useUpdateCollection, useDeleteCollection, useCategories } from '../../lib/supabase/hooks';
import { getCurrentAdmin, logoutAdmin, ROLE_LABELS } from '../../lib/auth';
import { auditLogQueries, productQueries } from '../../lib/supabase/queries';
import type { ProductCollection } from '../../lib/supabase/queries';
import type { Database } from '../../lib/supabase';

const SLUGIFY = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type FormData = {
  name_ru: string;
  name_uz: string;
  slug: string;
  icon: string;
  is_active: boolean;
  sort_order: number;
};

const EMPTY_FORM: FormData = {
  name_ru: '',
  name_uz: '',
  slug: '',
  icon: 'tag',
  is_active: true,
  sort_order: 0,
};

function colToForm(col: ProductCollection): FormData {
  return {
    name_ru: col.name.ru,
    name_uz: col.name.uz,
    slug: col.slug,
    icon: col.icon ?? 'tag',
    is_active: col.is_active,
    sort_order: col.sort_order,
  };
}

export const AdminCollections = () => {
  const navigate = useNavigate();
  const admin = getCurrentAdmin();
  const { data: collections = [], isLoading } = useCollections(false);
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerCollectionId, setPickerCollectionId] = useState<string | null>(null);
  const [pickerProductIds, setPickerProductIds] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState<Array<{ id: string; name: { ru: string; uz: string }; price: number; images: string[]; stock: number; category_id: string | null }>>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [pickerCategoryFilter, setPickerCategoryFilter] = useState<string>('');
  const { data: categories = [] } = useCategories();

  if (!admin) return null;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (col: ProductCollection) => {
    setForm(colToForm(col));
    setEditingId(col.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name_ru.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: { ru: form.name_ru, uz: form.name_uz || form.name_ru },
        slug: form.slug || SLUGIFY(form.name_ru),
        icon: form.icon,
        is_active: form.is_active,
        sort_order: form.sort_order,
      };
      if (editingId) {
        await updateCollection.mutateAsync({ id: editingId, data: payload });
        auditLogQueries.log({
          admin_id: admin.id,
          action: 'update',
          entity_type: 'product_collections',
          entity_id: editingId,
          details: { name: form.name_ru },
        }).catch(() => {});
      } else {
        await createCollection.mutateAsync({
          ...payload,
          product_ids: [],
        } as Database['public']['Tables']['product_collections']['Insert']);
        auditLogQueries.log({
          admin_id: admin.id,
          action: 'create',
          entity_type: 'product_collections',
          details: { name: form.name_ru },
        }).catch(() => {});
      }
      setShowForm(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const col = collections.find((c) => c.id === deleteId);
    await deleteCollection.mutateAsync(deleteId);
    setDeleteId(null);
    auditLogQueries.log({
      admin_id: admin.id,
      action: 'delete',
      entity_type: 'product_collections',
      entity_id: deleteId,
      details: { name: col?.name?.ru },
    }).catch(() => {});
  };

  const handleToggleActive = async (col: ProductCollection) => {
    await updateCollection.mutateAsync({ id: col.id, data: { is_active: !col.is_active } });
  };

  const openProductPicker = async (col: ProductCollection) => {
    setPickerCollectionId(col.id);
    setPickerProductIds([...(col.product_ids ?? [])]);
    setProductSearch('');
    setPickerCategoryFilter('');
    setShowProductPicker(true);
    setProductsLoading(true);
    try {
      const products = await productQueries.getAll();
      setAllProducts(products.items);
    } catch {
      setAllProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const toggleProduct = (productId: string) => {
    setPickerProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  };

  const saveProductPicker = async () => {
    if (!pickerCollectionId) return;
    await updateCollection.mutateAsync({
      id: pickerCollectionId,
      data: { product_ids: pickerProductIds },
    });
    setShowProductPicker(false);
    setPickerCollectionId(null);
    auditLogQueries.log({
      admin_id: admin.id,
      action: 'update',
      entity_type: 'product_collections',
      entity_id: pickerCollectionId,
      details: { product_count: pickerProductIds.length },
    }).catch(() => {});
  };

  const filteredProducts = allProducts.filter((p) => {
    const matchesSearch = !productSearch || p.name.ru.toLowerCase().includes(productSearch.toLowerCase());
    const matchesCategory = !pickerCategoryFilter || p.category_id === pickerCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 glass border-b border-[color:var(--glass-border)] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/nanyy/dashboard"
              className="flex items-center gap-1.5 text-text-secondary hover:text-text dark:hover:text-text-inverse transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Назад</span>
            </Link>
            <span className="text-text-tertiary">|</span>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-brand shadow-accent flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-text-inverse" />
              </div>
              <span className="font-bold text-text text-sm">Подборки товаров</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-text leading-none">{admin.first_name}</p>
              <p className="text-xs text-text-secondary mt-0.5">{ROLE_LABELS[admin.role]}</p>
            </div>
            <button
              onClick={() => { logoutAdmin(); navigate('/nanyy'); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-muted hover:text-text dark:hover:text-text-inverse transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text">Подборки товаров</h1>
            <p className="text-sm text-text-secondary mt-1">
              Секции в каталоге: «Популярные», «Скидки», «Для девочек» и т.д. · {collections.length} шт.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 btn-brand rounded-xl font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : collections.length === 0 ? (
          <div className="text-center py-24 bg-surface rounded-2xl border border-dashed border-border">
            <ShoppingBag className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
            <p className="text-text-secondary font-medium">Подборок пока нет</p>
            <p className="text-sm text-text-tertiary mt-1">Создайте секции для каталога</p>
          </div>
        ) : (
          <div className="space-y-3">
            {collections.map((col) => (
              <div
                key={col.id}
                className="card-premium p-4 sm:p-5"
              >
                <div className="flex items-center gap-4">
                  <GripVertical className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-text truncate">{col.name.ru}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        col.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-surface-muted text-text-secondary'
                      }`}>
                        {col.is_active ? 'Активна' : 'Скрыта'}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary">
                      /{col.slug} · {col.product_ids?.length ?? 0} товаров
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleToggleActive(col)}
                      className="p-2 rounded-lg text-text-tertiary hover:text-surface-700 dark:hover:text-gray-200 hover:bg-surface-muted transition-colors"
                      title={col.is_active ? 'Скрыть' : 'Показать'}
                    >
                      {col.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => openProductPicker(col)}
                      className="px-3 py-1.5 rounded-lg bg-surface-muted text-text text-xs font-medium hover:bg-surface-inset dark:hover:bg-surface-elevated transition-colors"
                    >
                      Товары ({col.product_ids?.length ?? 0})
                    </button>
                    <button
                      onClick={() => openEdit(col)}
                      className="p-2 rounded-lg text-text-tertiary hover:text-text dark:hover:text-text-secondary hover:bg-surface-muted dark:hover:bg-surface-inset transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(col.id)}
                      className="p-2 rounded-lg text-text-tertiary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md" onClick={() => setShowForm(false)} />
          <div className="relative bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90dvh] flex flex-col">
            <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-bold text-text">
                {editingId ? 'Редактировать подборку' : 'Новая подборка'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-text-tertiary hover:text-surface-700 p-1">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Название (RU)</label>
                  <input
                    value={form.name_ru}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm({ ...form, name_ru: v, slug: editingId ? form.slug : SLUGIFY(v) });
                    }}
                    placeholder="Популярные товары"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Название (UZ)</label>
                  <input
                    value={form.name_uz}
                    onChange={(e) => setForm({ ...form, name_uz: e.target.value })}
                    placeholder="Mashhur mahsulotlar"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: SLUGIFY(e.target.value) })}
                  placeholder="populyarnye-tovary"
                  className="input-premium w-full px-3 py-2.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Порядок</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-text-secondary mb-2">Активна</label>
                  <button
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      form.is_active
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                        : 'bg-bg dark:bg-surface-muted text-text-secondary border border-border'
                    }`}
                  >
                    {form.is_active ? 'Показывать' : 'Скрыта'}
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border-subtle flex gap-3 flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition-colors">
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name_ru.trim()}
                className="flex-1 py-2.5 rounded-xl btn-brand disabled:opacity-50 text-sm font-semibold"
              >
                {saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Picker Modal */}
      {showProductPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md" onClick={() => setShowProductPicker(false)} />
          <div className="relative bg-surface w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85dvh] flex flex-col">
            <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-bold text-text">
                Выбрать товары · <span className="text-accent">{pickerProductIds.length}</span> выбрано
              </h2>
              <button onClick={() => setShowProductPicker(false)} className="text-text-tertiary hover:text-surface-700 p-1">✕</button>
            </div>
            <div className="px-6 py-3 border-b border-border-subtle flex gap-2 flex-shrink-0">
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Поиск товара..."
                className="input-premium flex-1 px-3 py-2 text-sm"
              />
              <select
                value={pickerCategoryFilter}
                onChange={(e) => setPickerCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-bg dark:bg-surface-muted border border-border rounded-xl text-sm text-text focus:outline-none"
              >
                <option value="">Все категории</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name.ru}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {productsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="w-6 h-6 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredProducts.length === 0 ? (
                <p className="text-center text-sm text-text-tertiary py-12">Нет товаров</p>
              ) : (
                <div className="space-y-2">
                  {filteredProducts.map((product) => {
                    const selected = pickerProductIds.includes(product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() => toggleProduct(product.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                          selected
                            ? 'bg-accent border-accent text-text-inverse'
                            : 'bg-surface border-border hover:border-border dark:hover:border-border'
                        }`}
                      >
                        {product.images[0] && (
                          <img src={product.images[0]} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className={`text-sm font-medium truncate ${selected ? 'text-text-inverse' : 'text-text'}`}>
                            {product.name.ru}
                          </p>
                          <p className={`text-xs ${selected ? 'text-text-inverse/60' : 'text-text-tertiary'}`}>
                            {product.price} сум · {product.stock} шт.
                          </p>
                        </div>
                        {selected && <Check className="w-5 h-5 text-text-inverse flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border-subtle flex gap-3 flex-shrink-0">
              <button onClick={() => setShowProductPicker(false)} className="flex-1 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition-colors">
                Отмена
              </button>
              <button
                onClick={saveProductPicker}
                className="flex-1 py-2.5 rounded-xl btn-brand text-sm font-semibold"
              >
                Сохранить ({pickerProductIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md" onClick={() => setDeleteId(null)} />
          <div className="relative bg-surface-elevated rounded-[1.5rem] shadow-float p-6 max-w-sm w-full border border-border-subtle">
            <h3 className="text-lg font-bold text-text mb-2">Удалить подборку?</h3>
            <p className="text-sm text-text-secondary mb-6">Это действие нельзя отменить.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition-colors">
                Отмена
              </button>
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-text-inverse text-sm font-medium transition-colors">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
