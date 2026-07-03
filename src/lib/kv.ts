import { config } from "./config";

// -----------------------------------------------------------------------------
// Tiny durable KV over Upstash Redis (REST). Used to persist expensive, slow-to-
// compute aggregates (e.g. the all-contacts money scan) across restarts and
// redeploys, so a cold start doesn't re-run the full scan on the request path.
// Best-effort: every call degrades to a no-op / null when Upstash isn't set.
// -----------------------------------------------------------------------------

export function kvConfigured(): boolean {
  return Boolean(config.kv.upstashUrl && config.kv.upstashToken);
}

async function cmd(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(config.kv.upstashUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kv.upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${command[0]} -> ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result: unknown }).result;
}

export async function kvGetJSON<T>(key: string): Promise<T | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await cmd(["GET", key]);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.warn("[kv] get failed:", (err as Error).message);
    return null;
  }
}

export async function kvSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (!kvConfigured()) return;
  try {
    const payload = JSON.stringify(value);
    await cmd(ttlSeconds ? ["SET", key, payload, "EX", ttlSeconds] : ["SET", key, payload]);
  } catch (err) {
    console.warn("[kv] set failed:", (err as Error).message);
  }
}
