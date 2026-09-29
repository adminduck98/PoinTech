export type AdminRole = 'super_admin' | 'admin' | 'manager' | 'seller' | 'support' | 'content';

export interface AdminUser {
  id: string;
  first_name: string;
  email: string;
  role: AdminRole;
  _token?: string;
}

const STORAGE_KEY = 'styletech_admin';
const SESSION_VERIFY_KEY = 'styletech_admin_session_verified';

/**
 * How long a successful server-side verification is trusted before asking
 * again.
 *
 * This was 5 minutes, and on a network error the check returned true for twice
 * that — so an account that had just been deactivated or logged out kept the
 * admin UI open for up to ten minutes. The server rejects its requests either
 * way (admin-api verifies every call), but the UI has no business pretending
 * the session is alive. 60 s costs one cheap request a minute and closes the
 * window.
 */
const SESSION_VERIFY_TTL = 60 * 1000;

/**
 * Sign an admin in.
 *
 * Returns null for exactly one thing: the server looked at the credentials and
 * rejected them. Everything else throws with a message worth reading.
 *
 * This used to return null for all of it — missing configuration, a request
 * that never left the machine, a rate-limit lockout, a 500 — and the form
 * rendered every one of them as "Неверный email или пароль". A correct password
 * against an unreachable server produced a message accusing the password, which
 * sends you looking in the one place where nothing is wrong.
 */
export async function loginAdmin(email: string, password: string): Promise<AdminUser | null> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'Приложение не настроено: не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
    );
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/admin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // Запрос не дошёл до сервера: обрыв соединения, блокировка, отсутствие сети.
    throw new Error(
      'Запрос не дошёл до сервера. Проверьте интернет, VPN, антивирус или расширения браузера.'
    );
  }

  // 401 — единственный ответ, который действительно означает «данные не подошли».
  if (response.status === 401) return null;

  if (response.status === 429) {
    throw new Error(
      'Слишком много попыток входа. Подождите 15 минут и попробуйте снова.'
    );
  }

  if (!response.ok) {
    throw new Error(`Сервер ответил ошибкой ${response.status}. Попробуйте позже.`);
  }

  try {
    const data = await response.json();
    if (!data.success || !data.admin) return null;

    const user: AdminUser = {
      id: data.admin.id,
      first_name: data.admin.first_name,
      email: data.admin.email,
      role: data.admin.role as AdminRole,
      _token: data.sessionToken,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(SESSION_VERIFY_KEY, Date.now().toString());
    return user;
  } catch {
    throw new Error('Сервер вернул неожиданный ответ. Попробуйте ещё раз.');
  }
}

export async function verifyAdminSession(): Promise<boolean> {
  const user = getCurrentAdmin();
  if (!user || !user._token) return false;

  // Check if we verified recently (client-side cache)
  const lastVerify = parseInt(localStorage.getItem(SESSION_VERIFY_KEY) || '0', 10);
  if (Date.now() - lastVerify < SESSION_VERIFY_TTL) {
    return true;
  }

  // Verify via edge function (server-side, uses service_role)
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/admin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify({ verify_session: true, admin_id: user.id, token: user._token }),
    });

    if (!response.ok) {
      logoutAdmin();
      return false;
    }

    const data = await response.json();
    if (data.valid) {
      localStorage.setItem(SESSION_VERIFY_KEY, Date.now().toString());
      return true;
    }

    logoutAdmin();
    return false;
  } catch {
    // Network error. Keep whatever the last successful verification bought us,
    // but do not extend it — a failure to reach the server is not evidence the
    // session is still valid.
    return Date.now() - lastVerify < SESSION_VERIFY_TTL;
  }
}

export function getCurrentAdmin(): AdminUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

export function logoutAdmin(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSION_VERIFY_KEY);
}

// ─── Permissions ─────────────────────────────────────────────────────────────
//
// This table exists ONLY to decide what the UI shows. Enforcement lives in the
// admin-api Edge Function, which repeats the same matrix server-side; hiding a
// button here does not protect anything on its own.
//
// Keep in sync with ROLE_PERMISSIONS in supabase/functions/admin-api/index.ts.

export type Capability =
  | 'products' | 'banners' | 'orders' | 'customers' | 'admins'
  | 'audit' | 'delivery' | 'coupons' | 'returns' | 'reviews'
  | 'messages' | 'analytics' | 'dashboard';

const ROLE_PERMISSIONS: Record<AdminRole, { read: Capability[]; write: Capability[] }> = {
  super_admin: {
    read: ['products', 'banners', 'orders', 'customers', 'admins', 'audit', 'delivery', 'coupons', 'returns', 'reviews', 'messages', 'analytics', 'dashboard'],
    write: ['products', 'banners', 'orders', 'customers', 'admins', 'audit', 'delivery', 'coupons', 'returns', 'reviews', 'messages', 'analytics'],
  },
  admin: {
    read: ['products', 'banners', 'orders', 'customers', 'admins', 'audit', 'delivery', 'coupons', 'returns', 'reviews', 'messages', 'analytics', 'dashboard'],
    write: ['products', 'banners', 'orders', 'customers', 'admins', 'delivery', 'coupons', 'returns', 'reviews', 'messages', 'analytics'],
  },
  manager: {
    read: ['products', 'banners', 'orders', 'customers', 'delivery', 'coupons', 'returns', 'reviews', 'messages', 'analytics', 'dashboard'],
    write: ['products', 'banners', 'orders', 'delivery', 'coupons', 'returns', 'reviews', 'messages'],
  },
  support: {
    read: ['products', 'orders', 'customers', 'returns', 'reviews', 'messages', 'dashboard'],
    write: ['orders', 'returns', 'messages'],
  },
  seller: {
    read: ['products', 'orders', 'dashboard'],
    write: ['products'],
  },
  content: {
    read: ['products', 'banners', 'dashboard'],
    write: ['products', 'banners'],
  },
};

export function can(
  user: AdminUser | null,
  capability: Capability,
  mode: 'read' | 'write' = 'write'
): boolean {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role];
  if (!perms) return false;
  return perms[mode].includes(capability);
}

export function canManageUsers(user: AdminUser | null): boolean {
  return can(user, 'admins');
}

export function canManageOrders(user: AdminUser | null): boolean {
  return can(user, 'orders');
}

export function canManageProducts(user: AdminUser | null): boolean {
  return can(user, 'products');
}

export function canManageBanners(user: AdminUser | null): boolean {
  return can(user, 'banners');
}

export function canManageDelivery(user: AdminUser | null): boolean {
  return can(user, 'delivery');
}

export function canViewAuditLog(user: AdminUser | null): boolean {
  return can(user, 'audit', 'read');
}

export function canManageCoupons(user: AdminUser | null): boolean {
  return can(user, 'coupons');
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Суперадмин',
  admin: 'Администратор',
  manager: 'Менеджер',
  seller: 'Продавец',
  support: 'Поддержка',
  content: 'Контент-менеджер',
};
