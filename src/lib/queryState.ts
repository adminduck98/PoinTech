/**
 * True when a query is parked because the device has no connection.
 *
 * react-query's default `networkMode: 'online'` does not fail an offline query
 * — it *pauses* it: `status` stays `'pending'`, `fetchStatus` becomes
 * `'paused'`, and both `isLoading` and `isError` are false with `data`
 * undefined. A screen that branches only on those two flags therefore falls
 * straight through to its empty state, so a customer in a lift or on the metro
 * sees "Нет товаров" instead of "нет сети".
 *
 * That is the same failure the error states were added for, reached by a
 * different route — and on a phone it is the more likely of the two. Verified
 * in the browser: with the API unreachable the products query sat at
 * `{ status: 'pending', fetchStatus: 'paused' }` while the catalogue rendered
 * its empty state.
 *
 * Lives outside QueryError.tsx so that file only exports a component and
 * react-refresh keeps working.
 */
export function isQueryOffline(fetchStatus: 'fetching' | 'paused' | 'idle'): boolean {
  return fetchStatus === 'paused';
}
