import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Tag, LogOut } from 'lucide-react';
import { CATEGORY_ICONS, ICON_OPTIONS } from '../../lib/categoryIcons';
import { useCategoriesWithCount, useCreateCategory, useUpdateCategory, useDeleteCategory } from '../../lib/supabase/hooks';
import { getCurrentAdmin, logoutAdmin, ROLE_LABELS } from '../../lib/auth';
import { auditLogQueries } from '../../lib/supabase/queries';
import type { Category } from '../../lib/supabase/queries';

const SLUGIFY = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type FormData = {
  name_ru: string;
  name_uz: string;
  slug: string;
  icon: string;
};

const EMPTY_FORM: FormData = { name_ru: '', name_uz: '', slug: '', icon: 'tag' };


function catToForm(cat: Category): FormData {
  return {
    name_ru: cat.name.ru,
    name_uz: cat.name.uz,
    slug: cat.slug,
    icon: cat.icon ?? 'tag',
  };
}

function formToCategory(form: FormData) {
  return {
    name: { ru: form.name_ru, uz: form.name_uz },
    slug: form.slug || SLUGIFY(form.name_ru),
    icon: form.icon,
  };
}

export const AdminCategories = () => {
  const navigate = useNavigate();
  const admin = getCurrentAdmin();
  const { data: categories = [], isLoading } = useCategoriesWithCount();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (!admin) return null;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (cat: Category) => {
    setForm(catToForm(cat));
    setEditingId(cat.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name_ru.trim()) return;
    setSaving(true);
    try {
      const payload = formToCategory(form);
      if (editingId) {
        await updateCategory.mutateAsync({ id: editingId, data: payload });
        auditLogQueries.log({
          admin_id: admin.id,
          action: 'update',
          entity_type: 'categories',
          entity_id: editingId,
          details: { name: form.name_ru },
        }).catch(() => {});
      } else {
        await createCategory.mutateAsync({
          ...payload,
          name: { ru: form.name_ru, uz: form.name_uz || form.name_ru },
        });
        auditLogQueries.log({
          admin_id: admin.id,
          action: 'create',
          entity_type: 'categories',
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
    const cat = categories.find((c) => c.id === deleteId);
    await deleteCategory.mutateAsync(deleteId);
    setDeleteId(null);
    auditLogQueries.log({
      admin_id: admin.id,
      action: 'delete',
      entity_type: 'categories',
      entity_id: deleteId,
      details: { name: cat?.name?.ru },
    }).catch(() => {});
  };

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
                <Tag className="w-4 h-4 text-text-inverse" />
              </div>
              <span className="font-bold text-text text-sm">Категории</span>
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
            <h1 className="text-2xl font-bold text-text">Категории</h1>
            <p className="text-sm text-text-secondary mt-1">
              Управление категориями товаров · {categories.length} шт.
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
        ) : categories.length === 0 ? (
          <div className="text-center py-24 bg-surface rounded-2xl border border-dashed border-border">
            <Tag className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
            <p className="text-text-secondary font-medium">Категорий пока нет</p>
            <p className="text-sm text-text-tertiary mt-1">Нажмите «Добавить» чтобы создать первую</p>
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="card-premium p-4 sm:p-5 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-surface-muted flex items-center justify-center flex-shrink-0">
                  <Tag className="w-5 h-5 text-text-secondary dark:text-text-tertiary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">{cat.name.ru}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    /{cat.slug} · {cat.product_count ?? 0} {cat.product_count === 1 ? 'товар' : (cat.product_count ?? 0) < 5 ? 'товара' : 'товаров'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEdit(cat)}
                    className="p-2 rounded-lg text-text-tertiary hover:text-text dark:hover:text-text-secondary hover:bg-surface-muted dark:hover:bg-surface-inset transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteId(cat.id)}
                    className="p-2 rounded-lg text-text-tertiary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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
                {editingId ? 'Редактировать категорию' : 'Новая категория'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-text-tertiary hover:text-surface-700 dark:hover:text-gray-200 transition-colors p-1"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Название (RU)</label>
                  <input
                    value={form.name_ru}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm({
                        ...form,
                        name_ru: v,
                        slug: editingId ? form.slug : SLUGIFY(v),
                      });
                    }}
                    placeholder="Одежда"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Название (UZ)</label>
                  <input
                    value={form.name_uz}
                    onChange={(e) => setForm({ ...form, name_uz: e.target.value })}
                    placeholder="Kiyimlar"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: SLUGIFY(e.target.value) })}
                  placeholder="odezhda"
                  className="input-premium w-full px-3 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Иконка</label>
                <div className="grid grid-cols-6 sm:grid-cols-9 gap-2">
                  {ICON_OPTIONS.map((icon) => (
                    <button
                      key={icon}
                      onClick={() => setForm({ ...form, icon })}
                      className={`h-10 rounded-xl text-sm flex items-center justify-center transition-all ${
                        form.icon === icon
                          ? 'bg-accent text-text-inverse ring-2 ring-offset-2 ring-accent'
                          : 'bg-surface-muted text-text-secondary hover:bg-surface-inset dark:hover:bg-surface-elevated'
                      }`}
                      title={icon}
                      aria-label={icon}
                    >
                      {(() => {
                        const Icon = CATEGORY_ICONS[icon];
                        return <Icon className="w-5 h-5" />;
                      })()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border-subtle flex gap-3 flex-shrink-0">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition-colors"
              >
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

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md" onClick={() => setDeleteId(null)} />
          <div className="relative bg-surface-elevated rounded-[1.5rem] shadow-float p-6 max-w-sm w-full border border-border-subtle">
            <h3 className="text-lg font-bold text-text mb-2">Удалить категорию?</h3>
            <p className="text-sm text-text-secondary mb-6">
              Товары в этой категории не будут удалены, но потеряют привязку. Это действие нельзя отменить.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-text text-sm font-medium hover:bg-surface-muted transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-text-inverse text-sm font-medium transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
