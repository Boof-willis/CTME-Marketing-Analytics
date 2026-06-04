import { config } from "./config";

// -----------------------------------------------------------------------------
// Persistent store for the GA4 OAuth refresh token, so the dashboard can be
// connected / reconnected from the UI without a redeploy and the connection
// survives restarts.
//
// Backends (in priority order):
//   1. In-memory — fast path within a warm process (and the only thing local
//      dev needs).
//   2. Upstash Redis (REST) — durable across restarts/redeploys/instances.
//      Configured via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
//   3. GA4_REFRESH_TOKEN env var — read-only seed used when nothing is stored.
//
// The refresh token is a secret. Upstash REST is access-controlled by its
// bearer token; keep the Upstash database private.
// -----------------------------------------------------------------------------

const KEY = "ga4_refresh_token";

let memoryToken: string | null = null;

function upstashConfigured(): boolean {
  return Boolean(config.kv.upstashUrl && config.kv.upstashToken);
}

/** Run a single Redis command via the Upstash REST API. */
async function upstash(command: (string | number)[]): Promise<{ result: unknown }> {
  const res = await fetch(config.kv.upstashUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kv.upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash ${command[0]} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { result: unknown };
}

export async function getRefreshToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;

  if (upstashConfigured()) {
    try {
      const { result } = await upstash(["GET", KEY]);
      if (typeof result === "string" && result) {
        memoryToken = result;
        return result;
      }
    } catch (err) {
      console.warn("[tokenStore] upstash GET failed:", (err as Error).message);
    }
  }

  return config.ga4.refreshTokenSeed || null;
}

export async function setRefreshToken(token: string): Promise<void> {
  memoryToken = token;
  if (upstashConfigured()) {
    try {
      await upstash(["SET", KEY, token]);
    } catch (err) {
      console.warn("[tokenStore] upstash SET failed:", (err as Error).message);
    }
  }
}

export async function clearRefreshToken(): Promise<void> {
  memoryToken = null;
  if (upstashConfigured()) {
    try {
      await upstash(["DEL", KEY]);
    } catch (err) {
      console.warn("[tokenStore] upstash DEL failed:", (err as Error).message);
    }
  }
}
