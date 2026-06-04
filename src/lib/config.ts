import type { DataMode } from "./types";

// Centralized, server-only access to environment configuration.
// Never import this from a client component.

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  mode: (process.env.DATA_MODE as DataMode) || "auto",

  ghl: {
    // Accept either name — Private Integration tokens are sometimes pasted as
    // GHL_API_KEY. Either works.
    token: process.env.GHL_API_TOKEN || process.env.GHL_API_KEY || "",
    locationId: process.env.GHL_LOCATION_ID || "",
    base: process.env.GHL_API_BASE || "https://services.leadconnectorhq.com",
    // Defaults reflect CTME's actual GHL tags ("cold traffic" / "warm traffic").
    tags: {
      cold: csv(process.env.GHL_TAG_COLD, ["cold traffic", "cold"]),
      warm: csv(process.env.GHL_TAG_WARM, ["warm traffic", "warm"]),
      website: csv(process.env.GHL_TAG_WEBSITE, ["website", "referral"]),
      refund: csv(process.env.GHL_TAG_REFUND, ["refund", "refunded"]),
    },
    refundFieldKey: process.env.GHL_REFUND_FIELD_KEY || "",
    // GHL "Lifetime Value" custom field. LTV is averaged from this field across
    // contacts that have a real (non-zero) value. Default is CTME's field id.
    ltvFieldId: process.env.GHL_LTV_FIELD_ID || "ss1nwCf5rNtQpkShzMIC",
    status: {
      completed: csv(process.env.GHL_STATUS_COMPLETED, ["showed", "completed"]),
      noShow: csv(process.env.GHL_STATUS_NOSHOW, ["noshow", "no-show"]),
    },
    // Calendar name fragments used to classify appointments by traffic temperature.
    warmCalendarHints: csv(process.env.GHL_WARM_CALENDAR_HINTS, ["warm"]),
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
  },

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN || "",
    adAccountId: process.env.META_AD_ACCOUNT_ID || "",
  },

  google: {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || "",
  },

  // Google Analytics 4 via the Data API (REST). Auth is OAuth so the dashboard
  // can be (re)connected from the UI: whoever clicks "Connect" owns the token,
  // which survives a change of agency. The refresh token is stored at runtime
  // (Upstash token store); GA4_REFRESH_TOKEN is only an optional seed for the
  // no-store case. Client id/secret default to the Google Ads OAuth app so one
  // OAuth client can cover both.
  ga4: {
    propertyId: process.env.GA4_PROPERTY_ID || "",
    oauthClientId: process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || "",
    oauthClientSecret: process.env.GA4_OAUTH_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    // Optional explicit redirect URI override (else derived from the request).
    redirectUri: process.env.GA4_OAUTH_REDIRECT_URI || "",
    // Optional seed used when no token has been stored via the connect flow yet.
    refreshTokenSeed: process.env.GA4_REFRESH_TOKEN || "",
  },

  // Upstash Redis (REST) — durable key/value store for the GA4 refresh token so
  // the connection survives redeploys/restarts. Free tier is plenty. Works over
  // plain fetch on any host (Render, Vercel, etc.). If unset, the token store
  // falls back to in-memory + the GA4_REFRESH_TOKEN seed.
  kv: {
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  },

  accessKey: process.env.DASHBOARD_ACCESS_KEY || "",
};

export function hasGhl(): boolean {
  return Boolean(config.ghl.token && config.ghl.locationId);
}
export function hasStripe(): boolean {
  return Boolean(config.stripe.secretKey);
}
export function hasMeta(): boolean {
  return Boolean(config.meta.accessToken && config.meta.adAccountId);
}
export function hasGoogle(): boolean {
  return Boolean(
    config.google.developerToken &&
      config.google.refreshToken &&
      config.google.customerId,
  );
}
/** True when GA4 has enough OAuth config to attempt a connection / show the
 *  connect button. The refresh token itself may still be missing (not yet
 *  connected) — that surfaces as a "disconnected" state, not "demo". */
export function gaConfigured(): boolean {
  return Boolean(config.ga4.propertyId && config.ga4.oauthClientId && config.ga4.oauthClientSecret);
}
