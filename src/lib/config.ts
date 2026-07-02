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
    // Write-capable Private Integration token (contacts.write + contacts.read +
    // customFields.read). Falls back to the read token so a single token with
    // all scopes also works. The sync layer uses this; the dashboard's read
    // paths keep using `token`.
    writeToken:
      process.env.GHL_WRITE_TOKEN ||
      process.env.GHL_PRIVATE_INTEGRATION_TOKEN ||
      process.env.GHL_API_TOKEN ||
      process.env.GHL_API_KEY ||
      "",
    locationId: process.env.GHL_LOCATION_ID || "",
    base: process.env.GHL_API_BASE || "https://services.leadconnectorhq.com",
    // App URL used to build clickable contact-record deep links.
    appBase: (process.env.GHL_APP_BASE || "https://app.gohighlevel.com").replace(/\/$/, ""),
    // Defaults reflect CTME's actual GHL tags ("cold traffic" / "warm traffic").
    tags: {
      cold: csv(process.env.GHL_TAG_COLD, ["cold traffic", "cold"]),
      warm: csv(process.env.GHL_TAG_WARM, ["warm traffic", "warm"]),
      website: csv(process.env.GHL_TAG_WEBSITE, ["website", "referral"]),
      refund: csv(process.env.GHL_TAG_REFUND, ["refund", "refunded"]),
      // Marks a contact who has paid via crypto (outside Stripe). Used as a
      // head-count of crypto clients; the crypto *amount* comes from the
      // dedicated crypto custom fields below, not from the tag.
      crypto: csv(process.env.GHL_TAG_CRYPTO, ["crypto-payment"]),
    },
    refundFieldKey: process.env.GHL_REFUND_FIELD_KEY || "",
    // GHL "Lifetime Value" custom field. LTV is averaged from this field across
    // contacts that have a real (non-zero) value. Default is CTME's field id.
    ltvFieldId: process.env.GHL_LTV_FIELD_ID || "ss1nwCf5rNtQpkShzMIC",

    // Money custom fields synced into GHL from Stripe (and crypto, manually or by
    // the same sync). GHL is the source of truth for money; these are summed
    // across all contacts. Each field is addressed by its GHL *field key* (the
    // part after "contact." in {{contact.gross_revenue}}) and resolved to an
    // internal id at runtime, so connecting a new location needs no id copying.
    // Keep each field single-source (Stripe-only OR crypto-only) so a customer
    // who paid via both is never double-counted or mislabeled.
    //
    // Years covered by the per-year breakdown fields (revenue/refund/purchases).
    moneyYears: (process.env.GHL_MONEY_YEARS || "2023,2024,2025,2026")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n)),
    // {year} is substituted with each entry in moneyYears.
    moneyFieldTemplates: {
      revenue: process.env.GHL_FIELD_REVENUE_TPL || "{year}_revenue",
      cryptoRevenue: process.env.GHL_FIELD_CRYPTO_REVENUE_TPL || "{year}_crypto_revenue",
      refund: process.env.GHL_FIELD_REFUND_TPL || "{year}_refund",
      purchases: process.env.GHL_FIELD_PURCHASES_TPL || "{year}_purchases",
      cryptoPurchases: process.env.GHL_FIELD_CRYPTO_PURCHASES_TPL || "{year}_crypto_purchases",
    },
    // Lifetime / non-yearly money fields, by field key.
    moneyFields: {
      grossRevenue: process.env.GHL_FIELD_GROSS_REVENUE || "gross_revenue",
      grossCryptoRevenue: process.env.GHL_FIELD_GROSS_CRYPTO_REVENUE || "gross_crypto_revenue",
      grossRefund: process.env.GHL_FIELD_GROSS_REFUND || "gross_refund",
      grossPurchases: process.env.GHL_FIELD_GROSS_PURCHASES || "gross_purchases",
      grossCryptoPurchases: process.env.GHL_FIELD_GROSS_CRYPTO_PURCHASES || "gross_crypto_purchases",
      // Combined transaction count across BOTH rails (card + crypto). Each rail
      // writes its own count to the field above, then reads the other rail's
      // stored count off the contact and sums them into this field.
      totalTransactions: process.env.GHL_FIELD_TOTAL_TRANSACTIONS || "total_transactions",
      // Combined GROSS revenue across both rails (gross_revenue + gross_crypto_revenue).
      totalRevenue: process.env.GHL_FIELD_TOTAL_REVENUE || "total_revenue",
      lifetimeValue: process.env.GHL_FIELD_LIFETIME_VALUE || "lifetime_value",
      pendingInvoices: process.env.GHL_FIELD_PENDING_INVOICES || "pending_invoices",
      pendingInvoiceValue: process.env.GHL_FIELD_PENDING_INVOICE_VALUE || "pending_invoice_value",
      lastSyncedAt: process.env.GHL_FIELD_LAST_SYNCED_AT || "last_synced_at",
      // Per-contact payment logs (dated line-items), one per rail. Written by the
      // sync from each source's own dated ledger (Stripe charges / crypto sheet).
      cardPaymentHistory: process.env.GHL_FIELD_CARD_HISTORY || "card_payment_history",
      cryptoPaymentHistory: process.env.GHL_FIELD_CRYPTO_HISTORY || "crypto_payment_history",
    },
    // GHL custom-field folder ids, so the app can provision new fields into the
    // right place. Defaults are CTME's live folders.
    fieldFolders: {
      revenue: process.env.GHL_FOLDER_REVENUE || "KnC2vrH8o5SM5v5ijGc8",
      refund: process.env.GHL_FOLDER_REFUND || "91y7pSuJZwAma2elPiSd",
    },
    // Date custom field stamped by a GHL workflow when the "warm traffic" tag is
    // added (GHL has no tag-applied timestamp natively). Once this field is
    // populated for most of the warm pipeline, the Warm Traffic tab switches from
    // the pipeline count to an accurate per-period "tagged this window" count.
    warmTaggedAtField: process.env.GHL_FIELD_WARM_TAGGED_AT || "sent_to_sales_at",
    status: {
      completed: csv(process.env.GHL_STATUS_COMPLETED, ["showed", "completed"]),
      noShow: csv(process.env.GHL_STATUS_NOSHOW, ["noshow", "no-show"]),
    },
    // Calendar name fragments used to classify appointments by traffic temperature.
    warmCalendarHints: csv(process.env.GHL_WARM_CALENDAR_HINTS, ["warm"]),
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    // Signing secret for the Stripe webhook endpoint (whsec_...).
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  },

  // Write-back sync (Stripe + crypto sheet -> GHL money fields). This is the
  // merged "writer" half of the app; the rest of the app only reads.
  sync: {
    // Shared secret required in the X-Sync-Secret header on the sync endpoints
    // (crypto sheet webhook + Stripe backfill trigger).
    secret: process.env.SYNC_SECRET || "",
    // When true, endpoints compute and report but never write to GHL.
    dryRunDefault: process.env.SYNC_DRY_RUN === "true",
    // Presentment amounts are converted to this currency for the money fields.
    reportingCurrency: (process.env.REPORTING_CURRENCY || "usd").toLowerCase(),
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
export function hasGhlWrite(): boolean {
  return Boolean(config.ghl.writeToken && config.ghl.locationId);
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
