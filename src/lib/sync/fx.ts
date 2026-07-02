// Historical FX conversion for money that isn't in the reporting currency.
// Uses frankfurter.app (ECB data, free, no key). Cached in-memory by
// (from,to,date) — a backfill hits at most one rate per currency per day.

const cache = new Map<string, number>();

/** Rate to multiply a `from`-currency amount by to get `to`-currency, on the
 *  charge's date. Returns 1 for same-currency. Throws on lookup failure so the
 *  caller can decide whether to skip or fail the row (money must not silently
 *  convert at the wrong rate). */
export async function getFxRate(
  from: string,
  to: string,
  unixSeconds: number,
): Promise<number> {
  from = from.toUpperCase();
  to = to.toUpperCase();
  if (from === to) return 1;

  const date = new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  const key = `${from}_${to}_${date}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const url = `https://api.frankfurter.app/${date}?from=${from}&to=${to}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FX fetch failed (${from}->${to} on ${date}): ${res.status}`);
  }
  const data = (await res.json()) as { rates?: Record<string, number> };
  const rate = data?.rates?.[to];
  if (typeof rate !== "number") {
    throw new Error(`No FX rate for ${from}->${to} on ${date}: ${JSON.stringify(data)}`);
  }
  cache.set(key, rate);
  return rate;
}
