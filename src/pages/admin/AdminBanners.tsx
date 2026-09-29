import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff, GripVertical, Image, ShoppingBag, LogOut, Upload, X } from 'lucide-react';
import { useBanners, useCreateBanner, useUpdateBanner, useDeleteBanner } from '../../lib/supabase/hooks';
import { getCurrentAdmin, logoutAdmin, ROLE_LABELS } from '../../lib/auth';
import { auditLogQueries } from '../../lib/supabase/queries';
import { adminQueries } from '../../lib/adminApi';
import { toast } from '../../components/Toast';
import type { Banner } from '../../lib/supabase/queries';
import type { Database } from '../../lib/supabase';
import { encodeFileForUpload } from '../../lib/fileUpload';

/*
 * Размер баннера: 1920 × 768, то есть 2.5:1.
 *
 * Было 1920 × 566 (3.39:1). На телефоне шириной 390 px это давало полосу
 * высотой 115 px — мало, чтобы разместить поверх заголовок и подзаголовок,
 * которые рисует приложение, и слишком мало для мелкого текста внутри самого
 * макета: картинка всегда ужимается до 390 px, множитель 0.203, и подпись
 * в 30 px превращалась в 6 px на экране. 2.5:1 даёт 156 px — хватает и на
 * текст из полей, и на более крупный шрифт в макете, но баннер ещё не
 * съедает треть экрана до первого товара.
 *
 * Проверка осталась строгой, хотя слайдер теперь подстраивается под любое
 * соотношение от 1.6:1 до 3.6:1. Причина в том, что баннеров несколько и они
 * сменяют друг друга: при разных пропорциях блок прыгал бы по высоте на
 * каждом перелистывании.
 */
const BANNER_WIDTH = 1920;
const BANNER_HEIGHT = 768;

const GRADIENT_OPTIONS = [
  { label: 'Синий', value: 'from-blue-600 to-cyan-500' },
  { label: 'Зелёный', value: 'from-emerald-500 to-teal-600' },
  { label: 'Оранжевый', value: 'from-orange-500 to-red-500' },
  { label: 'Тёмный', value: 'from-gray-800 to-gray-600' },
  { label: 'Розовый', value: 'from-rose-500 to-pink-600' },
  { label: 'Жёлтый', value: 'from-yellow-400 to-orange-500' },
];

type FormData = {
  title_ru: string;
  title_uz: string;
  subtitle_ru: string;
  subtitle_uz: string;
  image_url: string;
  link_url: string;
  link_label_ru: string;
  link_label_uz: string;
  bg_color: string;
  is_active: boolean;
  sort_order: number;
};

const EMPTY_FORM: FormData = {
  title_ru: '',
  title_uz: '',
  subtitle_ru: '',
  subtitle_uz: '',
  image_url: '',
  link_url: '',
  link_label_ru: '',
  link_label_uz: '',
  bg_color: 'from-blue-600 to-cyan-500',
  is_active: true,
  sort_order: 0,
};

function bannerToForm(banner: Banner): FormData {
  return {
    title_ru: banner.title.ru,
    title_uz: banner.title.uz,
    subtitle_ru: banner.subtitle.ru,
    subtitle_uz: banner.subtitle.uz,
    image_url: banner.image_url,
    link_url: banner.link_url ?? '',
    link_label_ru: banner.link_label?.ru ?? '',
    link_label_uz: banner.link_label?.uz ?? '',
    bg_color: banner.bg_color,
    is_active: banner.is_active,
    sort_order: banner.sort_order,
  };
}

function formToBanner(form: FormData) {
  return {
    title: { ru: form.title_ru, uz: form.title_uz },
    subtitle: { ru: form.subtitle_ru, uz: form.subtitle_uz },
    image_url: form.image_url,
    link_url: form.link_url || null,
    link_label: form.link_label_ru ? { ru: form.link_label_ru, uz: form.link_label_uz } : null,
    bg_color: form.bg_color,
    is_active: form.is_active,
    sort_order: form.sort_order,
  };
}

export const AdminBanners = () => {
  const navigate = useNavigate();
  const admin = getCurrentAdmin();
  const { data: banners = [], isLoading } = useBanners(false);
  const createBanner = useCreateBanner();
  const updateBanner = useUpdateBanner();
  const deleteBanner = useDeleteBanner();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageMode, setImageMode] = useState<'url' | 'file'>('url');
  const [imageSizeWarning, setImageSizeWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!admin) return null;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setImageMode('url');
    setShowForm(true);
  };

  const openEdit = (banner: Banner) => {
    setForm(bannerToForm(banner));
    setEditingId(banner.id);
    setImageMode(banner.image_url ? 'url' : 'url');
    setShowForm(true);
  };

  const handleSave = async () => {
    // Обязательна только картинка.
    //
    // Заголовок раньше требовался, и на готовом макете, где текст уже нарисован
    // внутри изображения, приходилось вводить его второй раз — витрина затем
    // печатала его поверх такого же текста на картинке. Пустой заголовок теперь
    // означает «на баннере ничего не подписывать».
    if (!form.image_url.trim() || imageSizeWarning) return;
    setSaving(true);
    try {
      const payload = formToBanner(form);
      if (editingId) {
        await updateBanner.mutateAsync({ id: editingId, data: payload });
        auditLogQueries.log({
          admin_id: admin?.id ?? 'unknown',
          action: 'update',
          entity_type: 'banners',
          entity_id: editingId,
          details: { title: form.title_ru },
        }).catch(() => {});
      } else {
        await createBanner.mutateAsync(payload as Omit<Database['public']['Tables']['banners']['Row'], 'id' | 'created_at' | 'updated_at'>);
        auditLogQueries.log({
          admin_id: admin?.id ?? 'unknown',
          action: 'create',
          entity_type: 'banners',
          details: { title: form.title_ru },
        }).catch(() => {});
      }
      setShowForm(false);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (banner: Banner) => {
    await updateBanner.mutateAsync({ id: banner.id, data: { is_active: !banner.is_active } });
    auditLogQueries.log({
      admin_id: admin?.id ?? 'unknown',
      action: 'update',
      entity_type: 'banners',
      entity_id: banner.id,
      details: { is_active: !banner.is_active },
    }).catch(() => {});
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const banner = banners.find(b => b.id === deleteId);
    await deleteBanner.mutateAsync(deleteId);
    setDeleteId(null);
    auditLogQueries.log({
      admin_id: admin?.id ?? 'unknown',
      action: 'delete',
      entity_type: 'banners',
      entity_id: deleteId,
      details: { title: banner?.title?.ru },
    }).catch(() => {});
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 5 МБ)');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }

    setUploading(true);
    try {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          if (img.width !== BANNER_WIDTH || img.height !== BANNER_HEIGHT) {
            setImageSizeWarning(
              `Изображение ${img.width}×${img.height} px. Требуется: ${BANNER_WIDTH}×${BANNER_HEIGHT} px.`
            );
          } else {
            setImageSizeWarning(null);
          }
          resolve();
        };
        img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      // Через admin-api: запись делает service_role после проверки сессии.
      const encoded = await encodeFileForUpload(file);
      const urlData = await adminQueries.uploadBannerImage(encoded);
      if (urlData?.url) {
        setForm({ ...form, image_url: urlData.url });
        setImageMode('url');
        toast.success('Изображение загружено');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
                <ShoppingBag className="w-4 h-4 text-text-inverse" />
              </div>
              <span className="font-bold text-text text-sm">Баннеры</span>
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
            <h1 className="text-2xl font-bold text-text">Рекламные баннеры</h1>
            <p className="text-sm text-text-secondary mt-1">Управление слайдером на главной странице</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 btn-brand rounded-xl font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Добавить баннер
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : banners.length === 0 ? (
          <div className="text-center py-24 bg-surface rounded-2xl border border-dashed border-border">
            <Image className="w-12 h-12 text-text-tertiary mx-auto mb-3" />
            <p className="text-text-secondary font-medium">Баннеров пока нет</p>
            <p className="text-sm text-text-tertiary mt-1">Нажмите «Добавить баннер» чтобы создать первый</p>
          </div>
        ) : (
          <div className="space-y-4">
            {banners.map((banner) => (
              <div
                key={banner.id}
                className="card-premium overflow-hidden"
              >
                <div className="flex items-stretch">
                  <div className={`w-2 bg-gradient-to-b ${banner.bg_color} flex-shrink-0`} />
                  <div className="flex-1 p-4 sm:p-5 flex items-center gap-4">
                    <GripVertical className="w-4 h-4 text-text-tertiary flex-shrink-0 cursor-grab" />
                    {banner.image_url && (
                      <div className="relative flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-surface-muted">
                        <img
                          src={banner.image_url}
                          alt={banner.title.ru}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-text truncate">{banner.title.ru}</p>
                        <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                          banner.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-surface-muted text-text-secondary'
                        }`}>
                          {banner.is_active ? 'Активен' : 'Скрыт'}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary truncate">{banner.subtitle.ru}</p>
                      {banner.link_url && (
                        <p className="text-xs text-text dark:text-text-secondary mt-1 truncate">{banner.link_url}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(banner)}
                        className="p-2 rounded-lg text-text-tertiary hover:text-surface-700 dark:hover:text-gray-200 hover:bg-surface-muted transition-colors"
                        title={banner.is_active ? 'Скрыть' : 'Показать'}
                      >
                        {banner.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => openEdit(banner)}
                        className="p-2 rounded-lg text-text-tertiary hover:text-text dark:hover:text-text-secondary hover:bg-surface-muted dark:hover:bg-surface-inset transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(banner.id)}
                        className="p-2 rounded-lg text-text-tertiary hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
          <div className="relative bg-surface w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90dvh] flex flex-col">
            <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-bold text-text">
                {editingId ? 'Редактировать баннер' : 'Новый баннер'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-text-tertiary hover:text-surface-700 dark:hover:text-gray-200 transition-colors p-1"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Preview */}
              {form.image_url && (
                <div className={`relative rounded-xl bg-gradient-to-r ${form.bg_color} overflow-hidden`} style={{ aspectRatio: `${BANNER_WIDTH} / ${BANNER_HEIGHT}` }}>
                  <img
                    src={form.image_url}
                    alt="preview"
                    className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-60"
                  />
                  <div className="absolute inset-0 flex flex-col justify-center px-5">
                    <p className="text-text-inverse font-bold text-lg leading-tight">{form.title_ru || 'Заголовок'}</p>
                    <p className="text-text-inverse/80 text-sm mt-1">{form.subtitle_ru || 'Подзаголовок'}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Заголовок (RU)</label>
                  <input
                    value={form.title_ru}
                    onChange={(e) => setForm({ ...form, title_ru: e.target.value })}
                    placeholder="Новая коллекция!"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                  <p className="text-2xs text-text-tertiary mt-1">
                    Необязательно. Оставьте пустым, если текст уже нарисован на картинке —
                    тогда витрина покажет её как есть, без надписей и затемнения.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Заголовок (UZ)</label>
                  <input
                    value={form.title_uz}
                    onChange={(e) => setForm({ ...form, title_uz: e.target.value })}
                    placeholder="Yangi kolleksiya!"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Подзаголовок (RU)</label>
                  <input
                    value={form.subtitle_ru}
                    onChange={(e) => setForm({ ...form, subtitle_ru: e.target.value })}
                    placeholder="Скидки до 30%"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Подзаголовок (UZ)</label>
                  <input
                    value={form.subtitle_uz}
                    onChange={(e) => setForm({ ...form, subtitle_uz: e.target.value })}
                    placeholder="30% chegirma"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Изображение</label>
                <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle">
                  <span className="text-xs font-bold text-text">Размер баннера: {BANNER_WIDTH}×{BANNER_HEIGHT} px</span>
                </div>
                {imageSizeWarning && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2 font-medium">
                    {imageSizeWarning}
                  </p>
                )}
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setImageMode('url')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      imageMode === 'url'
                        ? 'bg-accent text-text-inverse'
                        : 'bg-surface-muted text-text-secondary dark:text-text-tertiary'
                    }`}
                  >
                    По ссылке
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageMode('file')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      imageMode === 'file'
                        ? 'bg-accent text-text-inverse'
                        : 'bg-surface-muted text-text-secondary dark:text-text-tertiary'
                    }`}
                  >
                    Загрузить файл
                  </button>
                </div>

                {imageMode === 'url' ? (
                  <input
                    value={form.image_url}
                    onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                    placeholder="https://images.pexels.com/..."
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border dark:border-border text-sm text-text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
                    >
                      {uploading ? (
                        <span className="w-4 h-4 border-2 border-border border-t-surface-800 rounded-full animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      {uploading ? 'Загрузка...' : 'Выберите файл'}
                    </button>
                    {form.image_url && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, image_url: '' })}
                        className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {form.image_url && (
                  <p className="text-[10px] text-text-tertiary mt-1 truncate">{form.image_url}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Ссылка (URL)</label>
                  <input
                    value={form.link_url}
                    onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                    placeholder="/catalog"
                    className="input-premium w-full px-3 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Кнопка (RU / UZ)</label>
                  <div className="flex gap-2">
                    <input
                      value={form.link_label_ru}
                      onChange={(e) => setForm({ ...form, link_label_ru: e.target.value })}
                      placeholder="Смотреть"
                      className="input-premium w-full px-3 py-2.5 text-sm"
                    />
                    <input
                      value={form.link_label_uz}
                      onChange={(e) => setForm({ ...form, link_label_uz: e.target.value })}
                      placeholder="Ko'rish"
                      className="input-premium w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Цвет фона</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {GRADIENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setForm({ ...form, bg_color: opt.value })}
                      className={`h-10 rounded-xl bg-gradient-to-r ${opt.value} transition-all ${
                        form.bg_color === opt.value ? 'ring-2 ring-offset-2 ring-blue-500 scale-105' : 'opacity-70 hover:opacity-100'
                      }`}
                      title={opt.label}
                    />
                  ))}
                </div>
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
                  <label className="block text-xs font-medium text-text-secondary mb-2">Активен</label>
                  <button
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      form.is_active
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                        : 'bg-bg dark:bg-surface-muted text-text-secondary border border-border'
                    }`}
                  >
                    {form.is_active ? 'Да, показывать' : 'Нет, скрыть'}
                  </button>
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
                disabled={saving || !form.image_url.trim() || !!imageSizeWarning}
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
            <h3 className="text-lg font-bold text-text mb-2">Удалить баннер?</h3>
            <p className="text-sm text-text-secondary mb-6">Это действие нельзя отменить.</p>
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
