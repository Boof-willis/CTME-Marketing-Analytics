// Tiny in-memory TTL cache. Keeps live API calls (especially multi-page GHL
// queries) off the critical path for repeat loads of the same range. Per-server
// instance only — good enough for an embedded internal dashboard.

type Entry<T> = { value: T; expires: number };
const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  // Optional guard: return false to skip caching a result (e.g. a degraded /
  // partial-failure response) so the next load re-fetches instead of serving it.
  shouldCache?: (value: T) => boolean,
): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  if (!shouldCache || shouldCache(value)) {
    store.set(key, { value, expires: now + ttlMs });
  }
  return value;
}

export function clearCache() {
  store.clear();
}
