import { tg, refreshTg } from './telegram';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Thrown when the app is running outside Telegram (or initData is unavailable). */
export class NoTelegramSessionError extends Error {
  constructor() {
    super('Telegram session is unavailable');
    this.name = 'NoTelegramSessionError';
  }
}

/**
 * Call the client-api Edge Function.
 *
 * Every user-scoped write goes through here so the server can derive the acting
 * user from cryptographically verified Telegram initData. There is deliberately
 * no direct-RPC fallback: without initData the request cannot be attributed to
 * anyone, so it must fail rather than run as an anonymous caller.
 */
export async function clientApiCall<T = unknown>(
  action: string,
  params: Record<string, unknown>
): Promise<T> {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase not configured');
  }

  refreshTg();
  const initData = tg?.initData;
  if (!initData) {
    throw new NoTelegramSessionError();
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/client-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'Apikey': anonKey,
    },
    body: JSON.stringify({
      action,
      init_data: initData,
      ...params,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[ClientApi] ${action} failed (${response.status}):`, error);
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}
