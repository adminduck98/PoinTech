import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { loginAdmin, ROLE_LABELS } from '../../lib/auth';
import { toast } from '../../components/Toast';

export const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Введите email адрес');
      return;
    }
    if (!password) {
      setError('Введите пароль');
      return;
    }

    setLoading(true);

    try {
      const user = await loginAdmin(email, password);

      if (!user) {
        setError('Неверный email или пароль. Проверьте учётные данные и попробуйте снова.');
        toast.error('Неверный email или пароль');
        return;
      }

      toast.success(`Добро пожаловать, ${user.first_name}! (${ROLE_LABELS[user.role]})`);
      navigate('/nanyy/dashboard');
    } catch (err) {
      // loginAdmin бросает только с осмысленным текстом: сеть, лимит попыток,
      // код ответа сервера. Показываем его как есть — раньше здесь стояла общая
      // фраза про интернет, и настоящая причина не доходила до экрана.
      const message = err instanceof Error
        ? err.message
        : 'Ошибка подключения. Проверьте интернет и попробуйте снова.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-100 to-surface-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-surface-elevated rounded-[1.5rem] shadow-float border border-border overflow-hidden">
          <div className="px-8 pt-10 pb-6 text-center border-b border-border-subtle">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent mb-4 shadow-lg">
              <Shield className="w-8 h-8 text-text-inverse" />
            </div>
            <h1 className="text-2xl font-bold text-text">
              Вход в панель управления
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              POINT TECH — Административная панель
            </p>
          </div>

          <div className="px-8 py-8">
            <form onSubmit={handleLogin} className="space-y-5" noValidate>
              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  disabled={loading}
                  autoComplete="email"
                  className="input-premium w-full px-4 py-3 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="admin@shop.uz"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-text mb-2">
                  Пароль
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    disabled={loading}
                    autoComplete="current-password"
                    className="input-premium w-full px-4 py-3 pr-12 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={loading}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-secondary dark:hover:text-gray-200 disabled:cursor-not-allowed transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                  <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400 leading-snug">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 btn-brand active:bg-accent-hover font-semibold py-3 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && (
                  <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {loading ? 'Выполняется вход...' : 'Войти'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
