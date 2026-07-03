import { config, hasGhl } from "../config";
import type { Contact, DateRange } from "../types";
import { eachDay, toISO } from "../dates";
import { parseISO } from "date-fns";
import { cached, deleteCached } from "../cache";
import { kvGetJSON, kvSetJSON } from "../kv";

// -----------------------------------------------------------------------------
// GoHighLevel (LeadConnector) v2 API adapter.
//
// CTME runs leads, appointments and payments (invoices) through GHL, so this
// adapter is the primary live source until/unless Stripe is also connected:
//   • Contacts (tagged "cold traffic" / "warm traffic" / "website") -> leads
//   • Calendar events -> appointments booked / calls completed / no-shows
//   • Payments transactions -> revenue, purchases, unique purchasers, refunds
//
// Every call tolerates failure (returns null / partial) so the dashboard falls
// back to demo data rather than breaking inside the GHL iframe.
// -----------------------------------------------------------------------------

export interface GhlPayments {
  revenue: number;
  purchases: number;
  uniquePurchasers: number;
  refunds: number;
  refundAmount: number;
  revenueByDay: { date: string; value: number }[];
  purchasesByDay: { date: string; value: number }[];
  coldRevenue: number;
  coldPurchases: number;
  organicRevenue: number;
  organicPurchases: number;
  /** Cold purchases/revenue attributed to Meta ads (utm/medium). */
  metaPurchases: number;
  metaRevenue: number;
  /** Cold purchases/revenue attributed to Google ads (utm/medium). */
  googlePurchases: number;
  googleRevenue: number;
  /** Contact id for each successful payment, in order (one entry per purchase,
   *  so a repeat buyer appears multiple times). */
  purchaseContactIds: string[];
  /** # of successful payments per purchaser contact id (for repeat detection). */
  purchaseCountById: Map<string, number>;
  /** Contact id for each refund, in order (one entry per refund). */
  refundContactIds: string[];
  /** Minimal name/email/phone captured straight off the transaction, as a
   *  fallback when the full contact record can't be fetched. */
  contactSeed: Map<string, { name: string; email: string | null; phone: string | null }>;
}

export interface GhlMetrics {
  leads: { cold: number; warm: number; website: number; total: number };
  coldLeads: number;
  appointments: number;
  callsCompleted: number;
  noShows: number;
  coldAppointments: number;
  coldCallsCompleted: number;
  coldNoShows: number;
  payments: GhlPayments | null;
  /** Warm sales funnel scoped to warm-tagged contacts, one count per lead
   *  (distinct contacts), so reschedules don't inflate it. Null when the warm
   *  contact set is unavailable (falls back to calendar-based counts). */
  warmMeetings: { scheduled: number; held: number; noShows: number } | null;
  /** Average of the GHL "Lifetime Value" custom field over contacts with value>0. */
  ltv: { average: number; count: number } | null;
  /** Stripe/crypto money aggregates synced onto contacts as custom fields.
   *  GHL is the source of truth for money; this is summed across all contacts. */
  money: GhlMoneyFields | null;
  /** Organic (non-paid) leads in the window, from contact attribution. */
  organicLeads: number;
  /** Organic lead breakdown by attribution source, largest first. */
  organicSources: { label: string; value: number }[];
  /** Paid leads split by ad platform, from contact attribution (utm/medium). */
  paidLeadsByPlatform: { meta: number; google: number; other: number };
  /** Paid leads by country (ISO-2 code), largest first. */
  paidCountries: { code: string; value: number }[];
  /** Organic leads by country (ISO-2 code), largest first. */
  organicCountries: { code: string; value: number }[];
  /** Drill-down contacts behind the purchase/refund widgets. */
  contacts: {
    /** One row per purchase (repeat buyers appear multiple times). */
    purchases: Contact[];
    /** Unique purchasers. */
    purchasers: Contact[];
    repeatPurchasers: Contact[];
    /** One row per refund. */
    refunds: Contact[];
  };
  /** True when a core sub-fetch failed; such results are not cached. */
  degraded?: boolean;
}

const HEADERS = () => ({
  Authorization: `Bearer ${config.ghl.token}`,
  Version: "2021-07-28",
  Accept: "application/json",
  "Content-Type": "application/json",
});

const TTL = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GHL fetch with retry/backoff on transient errors (rate limits, 5xx, network
// blips). Without this, a single 429 while paging a large window would zero out
// a metric (e.g. leads) and break the funnel.
async function ghl<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(config.ghl.base + path, { ...init, headers: HEADERS(), cache: "no-store" });
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(300 * 2 ** attempt + Math.random() * 200);
      return ghl<T>(path, init, attempt + 1);
    }
    throw err;
  }
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter ? retryAfter * 1000 : 300 * 2 ** attempt + Math.random() * 200);
      return ghl<T>(path, init, attempt + 1);
    }
    throw new Error(`GHL ${path} -> ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function hasAnyTag(tags: string[] | undefined, wanted: string[]): boolean {
  if (!tags) return false;
  const lower = tags.map((t) => t.toLowerCase().trim());
  return wanted.some((w) => lower.includes(w));
}

// ---- Contact attribution helpers -------------------------------------------
// GHL stores first- and last-touch attribution on every contact, including
// sessionSource, medium, utmSource and the referring URL. We use these to (a)
// split paid leads by ad platform and (b) bucket organic leads by real source.
function hostOf(u?: string): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Deep link to a GHL contact record (opens in the LeadConnector app). */
function contactUrl(id: string): string | null {
  if (!id || !config.ghl.locationId) return null;
  return `${config.ghl.appBase}/v2/location/${config.ghl.locationId}/contacts/detail/${id}`;
}

/** Build a normalized Contact from a raw GHL contact record and/or a seed. */
function toContact(
  id: string,
  raw: any | undefined,
  seed: { name: string; email: string | null; phone: string | null } | undefined,
): Contact {
  const fullName =
    (raw &&
      (raw.contactName ||
        [raw.firstName, raw.lastName].filter(Boolean).join(" ") ||
        raw.name ||
        raw.fullNameLowerCase)) ||
    seed?.name ||
    raw?.email ||
    seed?.email ||
    "Unknown contact";
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim())
    : [];
  return {
    id,
    name: String(fullName).trim(),
    email: (raw?.email ?? seed?.email) || null,
    phone: (raw?.phone ?? seed?.phone) || null,
    tags,
    url: contactUrl(id),
  };
}

/** Look up GHL contacts by email (for matching Stripe charges to CRM contacts).
 *  Returns a map keyed by lowercased email. Best-effort and bounded. */
export async function lookupContactsByEmails(emails: string[]): Promise<Map<string, Contact>> {
  const out = new Map<string, Contact>();
  if (!hasGhl()) return out;
  const uniq = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))].slice(0, 250);
  const tasks = uniq.map((email) => async () => {
    try {
      const r = await ghl<{ contact?: any }>(
        `/contacts/search/duplicate?locationId=${config.ghl.locationId}&email=${encodeURIComponent(email)}`,
      );
      if (r.contact && r.contact.id) {
        out.set(email, toContact(r.contact.id, r.contact, undefined));
      }
    } catch {
      // No match / unauthorized — caller falls back to the Stripe identity.
    }
  });
  await pooled(tasks, 6);
  return out;
}

/** Fetch full contact records for a bounded set of ids (name, phone, tags). */
async function fetchContactsByIds(ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const tasks = ids.map((id) => async () => {
    try {
      const r = await ghl<{ contact?: any }>(`/contacts/${id}`);
      if (r.contact) map.set(id, r.contact);
    } catch {
      // Best-effort: a missing/unauthorized contact just falls back to the seed.
    }
  });
  await pooled(tasks, 6);
  return map;
}

/** Returns the paid ad platform for a contact, or null if not paid. */
function paidPlatform(c: any): "meta" | "google" | null {
  const a = c.attributionSource || {};
  const b = c.lastAttributionSource || {};
  const utm = String(a.utmSource || b.utmSource || "").toLowerCase();
  const med = String(a.medium || b.medium || "").toLowerCase();
  if (/meta|facebook|instagram|fb|ig/.test(utm)) return "meta";
  if (/google|adwords|gclid|youtube/.test(utm)) return "google";
  if (med === "paid") return /google|youtube/.test(utm) ? "google" : "meta";
  return null;
}

/** Human-friendly organic source label for a (non-paid) contact. */
function organicSource(c: any): string {
  const a = c.attributionSource || {};
  const b = c.lastAttributionSource || {};
  const med = String(a.medium || b.medium || "").toLowerCase();
  const sess = String(a.sessionSource || b.sessionSource || "").toLowerCase();
  const host = hostOf(a.referrer || b.referrer);

  // Manually entered in the CRM or bulk-imported — not a real web source.
  if (med === "csv_import" || med === "manual" || sess === "crm ui") return "Manual / Imported";

  if (host) {
    if (/(^|\.)t\.co$|twitter\.com$|(^|\.)x\.com$/.test(host)) return "Twitter / X";
    if (/linkedin\.com$|lnkd\.in$/.test(host)) return "LinkedIn";
    if (/reddit/.test(host)) return "Reddit";
    if (/telegram\.org$|(^|\.)t\.me$/.test(host)) return "Telegram";
    if (/youtube\.com$|youtu\.be$/.test(host)) return "YouTube";
    if (/facebook\.com$|instagram\.com$|fb\.com$/.test(host)) return "Facebook / Instagram";
    if (/google\./.test(host)) return "Google";
    return host;
  }

  if (sess === "organic search") return "Organic Search";
  if (sess === "social media") return "Social media";
  if (sess === "direct traffic") return "Direct";
  if (med === "form") return "Website form";
  return "Other";
}

/** Normalize a raw GHL country value to an ISO 3166-1 alpha-2 code.
 *  Collapses common variants (e.g. "UK"/"United Kingdom" -> "GB") so the same
 *  country can't appear as two separate rows. Unrecognized values -> "??". */
const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  USA: "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  UAE: "AE",
  "UNITED ARAB EMIRATES": "AE",
};
function normalizeCountryCode(raw: unknown): string {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return "??";
  if (COUNTRY_ALIASES[v]) return COUNTRY_ALIASES[v];
  if (/^[A-Z]{2}$/.test(v)) return v;
  return "??";
}

/** Rank a count map largest-first, keeping the top N and lumping the rest.
 *  The "unknown" bucket ("??") is always merged into the trailing other bucket
 *  so "Other" and "Unknown" never show as two separate rows. */
function rankTop(
  map: Map<string, number>,
  top: number,
  otherKey: string,
): { code: string; value: number }[] {
  const unknown = map.get("??") || 0;
  const known = [...map.entries()].filter(([code]) => code !== "??").sort((a, b) => b[1] - a[1]);
  const head = known.slice(0, top).map(([code, value]) => ({ code, value }));
  const restTotal = known.slice(top).reduce((a, [, v]) => a + v, 0) + unknown;
  if (restTotal > 0) head.push({ code: otherKey, value: restTotal });
  return head;
}

/** Run async tasks with bounded concurrency (keeps us under GHL rate limits). */
async function pooled<T>(tasks: (() => Promise<T>)[], concurrency = 6): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (i < tasks.length) {
        const idx = i++;
        results[idx] = await tasks[idx]();
      }
    }),
  );
  return results;
}

// ---- Contacts -> leads by traffic source -----------------------------------
// Pages contacts created in the window, buckets them by tag, and returns the
// set of "cold" contact IDs so payments can be attributed without extra calls.
async function countLeads(range: DateRange) {
  const counts = { cold: 0, warm: 0, website: 0, total: 0 };
  const coldIds = new Set<string>();
  const organicIds = new Set<string>();
  // Contact IDs attributed to each paid ad platform, so payments can be split
  // by platform later without extra per-contact API calls.
  const metaIds = new Set<string>();
  const googleIds = new Set<string>();
  const organicMap = new Map<string, number>();
  const paidByPlatform = { meta: 0, google: 0, other: 0 };
  const paidCountryMap = new Map<string, number>();
  const organicCountryMap = new Map<string, number>();
  let organicLeads = 0;
  const pageLimit = 100;
  const maxPages = 80;

  const searchPage = (page: number) =>
    ghl<{ contacts?: any[]; total?: number }>("/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        locationId: config.ghl.locationId,
        page,
        pageLimit,
        filters: [
          { field: "dateAdded", operator: "range", value: { gte: range.start, lte: range.end } },
        ],
      }),
    });

  const seen = new Set<string>();
  const bucket = (contacts: any[]) => {
    for (const c of contacts) {
      if (c.id) {
        if (seen.has(c.id)) continue; // guard against any page overlap
        seen.add(c.id);
      }
      if (hasAnyTag(c.tags, config.ghl.tags.cold)) {
        counts.cold += 1;
        if (c.id) coldIds.add(c.id);
      } else if (hasAnyTag(c.tags, config.ghl.tags.warm)) counts.warm += 1;
      else if (hasAnyTag(c.tags, config.ghl.tags.website)) counts.website += 1;

      // Paid vs organic split via attribution (independent of the tag buckets).
      const plat = paidPlatform(c);
      const isPaid = plat !== null || hasAnyTag(c.tags, config.ghl.tags.cold);
      const code = normalizeCountryCode(c.country || (c.address && c.address.country));
      if (isPaid) {
        // Cold-tagged contacts without meta/google attribution still count as
        // paid — bucket them as "other" so paid channels sum to all paid leads.
        if (plat) {
          paidByPlatform[plat] += 1;
          if (c.id) (plat === "meta" ? metaIds : googleIds).add(c.id);
        } else paidByPlatform.other += 1;
        paidCountryMap.set(code, (paidCountryMap.get(code) || 0) + 1);
      } else {
        const s = organicSource(c);
        organicMap.set(s, (organicMap.get(s) || 0) + 1);
        organicLeads += 1;
        if (c.id) organicIds.add(c.id);
        organicCountryMap.set(code, (organicCountryMap.get(code) || 0) + 1);
      }
    }
  };

  // First page tells us the total; fetch the rest in parallel.
  const first = await searchPage(1);
  const total = typeof first.total === "number" ? first.total : (first.contacts || []).length;
  bucket(first.contacts || []);
  const pages = Math.min(Math.ceil(total / pageLimit), maxPages);
  if (pages > 1) {
    const rest = await pooled(
      Array.from({ length: pages - 1 }, (_, k) => () => searchPage(k + 2)),
    );
    rest.forEach((r) => bucket(r.contacts || []));
  }
  counts.total = total || counts.cold + counts.warm + counts.website;

  // Sort organic sources, keep the top 8, lump the rest into "Other".
  const sorted = [...organicMap.entries()].sort((a, b) => b[1] - a[1]);
  const TOP = 8;
  const organicSources = sorted.slice(0, TOP).map(([label, value]) => ({ label, value }));
  const restTotal = sorted.slice(TOP).reduce((a, [, v]) => a + v, 0);
  if (restTotal > 0) {
    const existing = organicSources.find((s) => s.label === "Other");
    if (existing) existing.value += restTotal;
    else organicSources.push({ label: "Other", value: restTotal });
  }

  // "OTHER" (overflow of small countries) is kept distinct from "??" (contacts
  // with no country on record) so they don't merge into one ambiguous row.
  const paidCountries = rankTop(paidCountryMap, 8, "OTHER");
  const organicCountries = rankTop(organicCountryMap, 8, "OTHER");

  return { counts, coldIds, organicIds, metaIds, googleIds, organicLeads, organicSources, paidByPlatform, paidCountries, organicCountries };
}

// ---- Money custom fields (GHL as the source of truth for money) ------------
// CTME's GHL is fed Stripe- (and crypto-) synced money aggregates on every
// contact: per-year + lifetime revenue / purchases / refunds, pending invoices,
// LTV and a sync timestamp. We resolve each configured field *key* to its
// internal id once, then page every contact and sum. These are lifetime/annual
// aggregates (range-independent), so the whole pass is cached on a long TTL.

export interface GhlMoneyFields {
  // Lifetime ("gross") totals.
  grossRevenue: number;
  grossCryptoRevenue: number;
  grossRefund: number;
  grossPurchases: number;
  grossCryptoPurchases: number;
  pendingInvoices: number;
  pendingInvoiceValue: number;
  // Per-year breakdowns, keyed by year.
  revenueByYear: Record<number, number>;
  cryptoRevenueByYear: Record<number, number>;
  refundByYear: Record<number, number>;
  purchasesByYear: Record<number, number>;
  cryptoPurchasesByYear: Record<number, number>;
  /** Crypto revenue by calendar day (yyyy-MM-dd), parsed from each contact's
   *  crypto_payment_history log — lets the Overview slice crypto by date range. */
  cryptoRevByDay: Record<string, number>;
  /** One entry per crypto payment (date + amount + who), parsed from the history
   *  logs — powers date-range crypto purchase counts + the Purchases drill-down. */
  cryptoTx: {
    date: string;
    amount: number;
    name: string;
    email: string | null;
    url: string | null;
    tags: string[];
  }[];
  // Derived head-counts.
  uniquePurchasers: number; // contacts with any revenue > 0
  cryptoClients: number; // contacts who paid via crypto (crypto revenue > 0, or tagged)
  // Average LTV across contacts with a real (> 0) LTV value.
  ltvAverage: number;
  ltvCount: number;
  // Most recent contact sync timestamp seen (ISO), for a freshness indicator.
  lastSyncedAt: string | null;
  contactsScanned: number;
  /** Contacts who paid via crypto (crypto-payment tag or crypto revenue > 0),
   *  for the purchases drill-down. Each carries their crypto value + count. */
  cryptoBuyers: Contact[];
  /** Count of contacts currently tagged "warm traffic" (the live warm pipeline). */
  warmPipeline: number;
  /** "Sent to sales" dates (yyyy-MM-dd) stamped on warm contacts by the workflow.
   *  Coverage = length / warmPipeline; drives the per-period warm-leads count once
   *  the field is populated for most of the pipeline. */
  warmTaggedDates: string[];
  /** Contact ids currently tagged warm traffic — used to scope the warm sales
   *  funnel (meetings/held) to one count per warm-tagged lead. */
  warmIds: string[];
  /** Revenue (gross_revenue + gross_crypto_revenue custom fields) summed across
   *  warm-tagged contacts — money from warm leads, source-of-truth, lifetime. */
  warmRevenue: number;
  /** Count of warm-tagged contacts with any revenue > 0 (warm leads who bought). */
  warmCustomers: number;
  /** Warm-tagged contacts (for the Warm Traffic drill-downs). Each carries their
   *  total revenue (card + crypto) + purchase count; buyers have purchaseValue > 0. */
  warmContacts: Contact[];
}

/** Strip the "contact." prefix and normalize a GHL field key for matching. */
export function normFieldKey(k: string): string {
  return k.replace(/^contact\./i, "").trim().toLowerCase();
}

/** Resolve GHL custom field *keys* (e.g. "gross_revenue") to their internal ids.
 *  Cached: the schema rarely changes. Returns an empty map on failure so callers
 *  degrade to zeros rather than throwing. */
export async function resolveCustomFieldIds(force = false): Promise<Map<string, string>> {
  // force=true bypasses the cache — used right after the app provisions a new
  // field so the write path can resolve it immediately (not after the TTL).
  if (force) deleteCached("ghl:customFieldIds");
  return cached("ghl:customFieldIds", 30 * 60 * 1000, async () => {
    const map = new Map<string, string>();
    try {
      const r = await ghl<{ customFields?: any[] }>(
        `/locations/${config.ghl.locationId}/customFields`,
      );
      for (const f of r.customFields || []) {
        const key = f.fieldKey || f.key || f.name;
        if (key && f.id) map.set(normFieldKey(String(key)), String(f.id));
      }
    } catch (e) {
      console.warn("[ghl] custom-field resolve failed:", (e as Error).message);
    }
    return map;
  });
}

/** Parse a possibly-formatted numeric custom-field value ("$1,200.50" -> 1200.5). */
function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// The heavy part: page every contact and sum the money custom fields. Cached by
// fetchMoneyFields() below so this only runs on a cold miss / background refresh.
async function scanMoneyFields(): Promise<GhlMoneyFields | null> {
    const ids = await resolveCustomFieldIds();
    const years = config.ghl.moneyYears;
    const tpl = config.ghl.moneyFieldTemplates;
    const mf = config.ghl.moneyFields;

    // Resolve each desired key to a field id (null when the field doesn't exist
    // in this location — its total just stays 0).
    const idOf = (key: string): string | null => ids.get(normFieldKey(key)) ?? null;
    const yearId = (template: string, year: number) =>
      idOf(template.replace("{year}", String(year)));

    // Pre-resolve all ids up front so the per-contact loop is cheap.
    const grossRevenueId = idOf(mf.grossRevenue);
    const grossCryptoRevenueId = idOf(mf.grossCryptoRevenue);
    const grossRefundId = idOf(mf.grossRefund);
    const grossPurchasesId = idOf(mf.grossPurchases);
    const grossCryptoPurchasesId = idOf(mf.grossCryptoPurchases);
    const pendingInvoicesId = idOf(mf.pendingInvoices);
    const pendingInvoiceValueId = idOf(mf.pendingInvoiceValue);
    const lifetimeValueId = idOf(mf.lifetimeValue) ?? config.ghl.ltvFieldId;
    const lastSyncedAtId = idOf(mf.lastSyncedAt);
    const cryptoHistId = idOf(mf.cryptoPaymentHistory);
    const yearIds = years.map((y) => ({
      year: y,
      revenue: yearId(tpl.revenue, y),
      cryptoRevenue: yearId(tpl.cryptoRevenue, y),
      refund: yearId(tpl.refund, y),
      purchases: yearId(tpl.purchases, y),
      cryptoPurchases: yearId(tpl.cryptoPurchases, y),
    }));

    const out: GhlMoneyFields = {
      grossRevenue: 0,
      grossCryptoRevenue: 0,
      grossRefund: 0,
      grossPurchases: 0,
      grossCryptoPurchases: 0,
      pendingInvoices: 0,
      pendingInvoiceValue: 0,
      revenueByYear: {},
      cryptoRevenueByYear: {},
      refundByYear: {},
      purchasesByYear: {},
      cryptoPurchasesByYear: {},
      cryptoRevByDay: {},
      cryptoTx: [],
      uniquePurchasers: 0,
      cryptoClients: 0,
      ltvAverage: 0,
      ltvCount: 0,
      lastSyncedAt: null,
      contactsScanned: 0,
      cryptoBuyers: [],
      warmPipeline: 0,
      warmTaggedDates: [],
      warmIds: [],
      warmRevenue: 0,
      warmCustomers: 0,
      warmContacts: [],
    };
    const warmTaggedAtId = idOf(config.ghl.warmTaggedAtField);
    years.forEach((y) => {
      out.revenueByYear[y] = 0;
      out.cryptoRevenueByYear[y] = 0;
      out.refundByYear[y] = 0;
      out.purchasesByYear[y] = 0;
      out.cryptoPurchasesByYear[y] = 0;
    });

    let ltvSum = 0;
    let lastSyncedMs = 0;

    const pageLimit = 100;
    const maxPages = 80;
    const searchPage = (page: number) =>
      ghl<{ contacts?: any[]; total?: number }>("/contacts/search", {
        method: "POST",
        body: JSON.stringify({ locationId: config.ghl.locationId, page, pageLimit }),
      });

    const tally = (contacts: any[]) => {
      for (const c of contacts) {
        out.contactsScanned += 1;
        const fields = new Map<string, unknown>();
        for (const f of c.customFields || c.customField || []) {
          if (f && f.id != null) fields.set(String(f.id), f.value);
        }
        const val = (id: string | null) => (id ? parseNum(fields.get(id)) : 0);

        const rev = val(grossRevenueId);
        const cryptoRev = val(grossCryptoRevenueId);
        out.grossRevenue += rev;
        out.grossCryptoRevenue += cryptoRev;
        out.grossRefund += val(grossRefundId);
        out.grossPurchases += val(grossPurchasesId);
        out.grossCryptoPurchases += val(grossCryptoPurchasesId);
        out.pendingInvoices += val(pendingInvoicesId);
        out.pendingInvoiceValue += val(pendingInvoiceValueId);
        if (rev > 0 || cryptoRev > 0) out.uniquePurchasers += 1;
        const cryptoTagged = hasAnyTag(c.tags, config.ghl.tags.crypto);
        // A crypto client = anyone who actually paid via crypto (crypto revenue > 0),
        // or is explicitly tagged. Don't rely on the tag alone — it isn't always set.
        if (cryptoRev > 0 || cryptoTagged) out.cryptoClients += 1;
        // Collect crypto payers (tagged or with crypto revenue) for the drill-down.
        if ((cryptoTagged || cryptoRev > 0) && c.id && out.cryptoBuyers.length < 500) {
          out.cryptoBuyers.push({
            ...toContact(c.id, c, undefined),
            purchaseValue: cryptoRev,
            purchaseCount: val(grossCryptoPurchasesId) || undefined,
            paidCrypto: true,
          });
        }

        // Warm pipeline + revenue/customers from the contact money fields, scoped
        // to the warm-traffic tag (the source-of-truth money for warm leads).
        if (hasAnyTag(c.tags, config.ghl.tags.warm)) {
          out.warmPipeline += 1;
          if (c.id) out.warmIds.push(String(c.id));
          const warmRev = rev + cryptoRev;
          out.warmRevenue += warmRev;
          if (warmRev > 0) out.warmCustomers += 1;
          if (c.id && out.warmContacts.length < 1500) {
            const cnt = val(grossPurchasesId) + val(grossCryptoPurchasesId);
            out.warmContacts.push({
              ...toContact(c.id, c, undefined),
              purchaseValue: warmRev > 0 ? warmRev : undefined,
              purchaseCount: cnt > 0 ? cnt : undefined,
              paidStripe: rev > 0,
              paidCrypto: cryptoRev > 0,
            });
          }
          if (warmTaggedAtId) {
            const raw = fields.get(warmTaggedAtId);
            if (raw) {
              const d = new Date(String(raw));
              if (Number.isFinite(d.getTime())) out.warmTaggedDates.push(toISO(d));
            }
          }
        }

        const ltv = val(lifetimeValueId);
        if (ltv > 0) {
          ltvSum += ltv;
          out.ltvCount += 1;
        }

        if (lastSyncedAtId) {
          const raw = fields.get(lastSyncedAtId);
          if (raw) {
            const ms = new Date(String(raw)).getTime();
            if (Number.isFinite(ms) && ms > lastSyncedMs) {
              lastSyncedMs = ms;
              out.lastSyncedAt = new Date(ms).toISOString();
            }
          }
        }

        // Parse the dated crypto payment log ("yyyy-MM-dd · $X,XXX.XX · crypto")
        // into a by-day map + a per-transaction list, so the Overview can slice
        // crypto by date range (revenue) and drill into crypto purchases.
        if (cryptoHistId) {
          const hist = fields.get(cryptoHistId);
          if (typeof hist === "string" && hist) {
            const cc = c.id ? toContact(c.id, c, undefined) : null;
            for (const line of hist.split("\n")) {
              const m = line.match(/(\d{4}-\d{2}-\d{2}).*?\$\s*([\d,]+(?:\.\d+)?)/);
              if (m) {
                const amt = parseFloat(m[2].replace(/,/g, ""));
                if (amt > 0) {
                  out.cryptoRevByDay[m[1]] = (out.cryptoRevByDay[m[1]] || 0) + amt;
                  if (out.cryptoTx.length < 5000) {
                    out.cryptoTx.push({
                      date: m[1],
                      amount: amt,
                      name: cc?.name || "Crypto payer",
                      email: cc?.email ?? null,
                      url: cc?.url ?? null,
                      tags: cc?.tags ?? [],
                    });
                  }
                }
              }
            }
          }
        }

        for (const y of yearIds) {
          out.revenueByYear[y.year] += val(y.revenue);
          out.cryptoRevenueByYear[y.year] += val(y.cryptoRevenue);
          out.refundByYear[y.year] += val(y.refund);
          out.purchasesByYear[y.year] += val(y.purchases);
          out.cryptoPurchasesByYear[y.year] += val(y.cryptoPurchases);
        }
      }
    };

    const first = await searchPage(1);
    const total = typeof first.total === "number" ? first.total : (first.contacts || []).length;
    tally(first.contacts || []);
    const pages = Math.min(Math.ceil(total / pageLimit), maxPages);
    if (pages > 1) {
      const rest = await pooled(Array.from({ length: pages - 1 }, (_, k) => () => searchPage(k + 2)));
      rest.forEach((r) => tally(r.contacts || []));
    }

    out.ltvAverage = out.ltvCount ? ltvSum / out.ltvCount : 0;
    return out;
}

// -----------------------------------------------------------------------------
// Durable, stale-while-revalidate cache for the money scan.
//
// The scan pages every contact (slow: ~seconds). It's range-independent and
// changes only when the sync writes new field values, so we cache it aggressively:
//   • in-memory  — instant on a warm process
//   • Upstash    — survives restarts / redeploys / cold starts, so a fresh
//                  instance serves the last good scan immediately instead of
//                  re-paging thousands of contacts on the request path
// Stale entries are served instantly and refreshed in the background (SWR), so a
// user never waits on the scan except the very first time the cache is empty.
// -----------------------------------------------------------------------------
const MONEY_KV_KEY = "ghl:money:v5"; // bump when GhlMoneyFields shape changes
const MONEY_SOFT_TTL_MS = 15 * 60 * 1000; // refresh in the background after 15m
const MONEY_KV_TTL_S = 6 * 60 * 60; // keep the durable copy up to 6h

interface MoneyCacheEntry {
  value: GhlMoneyFields;
  ts: number;
}
let memMoney: MoneyCacheEntry | null = null;
let moneyRefreshing = false;

/** Re-run the scan and write it to both caches. Never overwrites the last good
 *  value with a failure. Deduped so concurrent callers share one refresh. */
async function refreshMoney(): Promise<GhlMoneyFields | null> {
  if (moneyRefreshing) return memMoney?.value ?? null;
  moneyRefreshing = true;
  try {
    const value = await scanMoneyFields();
    if (value) {
      memMoney = { value, ts: Date.now() };
      await kvSetJSON(MONEY_KV_KEY, memMoney, MONEY_KV_TTL_S);
    }
    return value ?? memMoney?.value ?? null;
  } catch (err) {
    console.warn("[ghl] money refresh failed:", (err as Error).message);
    return memMoney?.value ?? null; // keep serving the last good scan
  } finally {
    moneyRefreshing = false;
  }
}

async function fetchMoneyFields(): Promise<GhlMoneyFields | null> {
  const now = Date.now();
  // 1. Warm in-memory — serve instantly; kick a background refresh if stale.
  if (memMoney) {
    if (now - memMoney.ts > MONEY_SOFT_TTL_MS && !moneyRefreshing) void refreshMoney();
    return memMoney.value;
  }
  // 2. Durable copy — survives cold starts / redeploys. Serve it instantly and
  //    refresh in the background if it's past the soft TTL.
  const durable = await kvGetJSON<MoneyCacheEntry>(MONEY_KV_KEY);
  if (durable && durable.value) {
    memMoney = durable;
    if (now - durable.ts > MONEY_SOFT_TTL_MS && !moneyRefreshing) void refreshMoney();
    return durable.value;
  }
  // 3. Nothing cached anywhere (truly first load) — do the scan synchronously.
  return refreshMoney();
}

// ---- Calendars -> appointments / completed / no-shows ----------------------
async function countAppointments(range: DateRange) {
  const startTime = parseISO(range.start + "T00:00:00").getTime();
  const endTime = parseISO(range.end + "T23:59:59").getTime();

  const calData = await ghl<{ calendars?: { id: string; name: string }[] }>(
    `/calendars/?locationId=${config.ghl.locationId}`,
  );
  const calendars = calData.calendars || [];

  const totals = { appointments: 0, callsCompleted: 0, noShows: 0 };
  const cold = { appointments: 0, callsCompleted: 0, noShows: 0 };
  // Distinct contact ids per stage (any calendar), so the warm funnel can count
  // one meeting per lead — reschedules/follow-ups collapse to a single contact.
  const apptContacts = {
    scheduled: new Set<string>(),
    held: new Set<string>(),
    noShow: new Set<string>(),
  };

  for (const cal of calendars) {
    const isWarm = config.ghl.warmCalendarHints.some((h) => cal.name.toLowerCase().includes(h));
    let events: any[] = [];
    try {
      const data = await ghl<{ events?: any[] }>(
        `/calendars/events?locationId=${config.ghl.locationId}&calendarId=${cal.id}&startTime=${startTime}&endTime=${endTime}`,
      );
      events = data.events || [];
    } catch {
      continue; // skip calendars we can't read
    }
    const now = Date.now();
    for (const e of events) {
      const status = String(e.appointmentStatus || e.status || "").toLowerCase();
      const noShow = config.ghl.status.noShow.includes(status);
      const explicitlyCompleted = config.ghl.status.completed.includes(status);
      // CTME's account uses "confirmed" as the booked status and doesn't mark
      // "showed" — so a confirmed appointment whose time has passed counts as a
      // completed call. Future-dated confirmed appts are booked-but-not-yet-held.
      const endMs = e.endTime
        ? new Date(e.endTime).getTime()
        : e.startTime
          ? new Date(e.startTime).getTime()
          : 0;
      const isPast = endMs > 0 && endMs < now;
      const confirmedPast = status === "confirmed" && isPast;

      // "Booked" excludes cancelled / invalid / new.
      const isBooked = noShow || explicitlyCompleted || status === "confirmed";
      if (!isBooked) continue;

      const completed = explicitlyCompleted || confirmedPast;
      totals.appointments += 1;
      if (completed) totals.callsCompleted += 1;
      if (noShow) totals.noShows += 1;
      // Cold = everything except calendars explicitly tagged as warm.
      if (!isWarm) {
        cold.appointments += 1;
        if (completed) cold.callsCompleted += 1;
        if (noShow) cold.noShows += 1;
      }
      // Track the contact behind each appointment (one entry per contact/stage).
      const cid = e.contactId || (e.contact && e.contact.id) || null;
      if (cid) {
        apptContacts.scheduled.add(String(cid));
        if (completed) apptContacts.held.add(String(cid));
        if (noShow) apptContacts.noShow.add(String(cid));
      }
    }
  }
  return { totals, cold, apptContacts };
}

// ---- Payments transactions -> revenue / purchases / refunds ----------------
async function fetchPayments(
  range: DateRange,
  coldIds: Set<string>,
  organicIds: Set<string>,
  metaIds: Set<string>,
  googleIds: Set<string>,
): Promise<GhlPayments> {
  const days = eachDay(range);
  const revByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const purByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const customers = new Set<string>();
  const purchaseContactIds: string[] = [];
  const purchaseCountById = new Map<string, number>();
  const refundContactIds: string[] = [];
  const contactSeed = new Map<string, { name: string; email: string | null; phone: string | null }>();

  const seedFrom = (t: any) => {
    const id: string = t.contactId;
    if (!id || contactSeed.has(id)) return;
    const name =
      t.contactName ||
      [t.contactFirstName, t.contactLastName].filter(Boolean).join(" ") ||
      t.contactEmail ||
      t.email ||
      "Unknown contact";
    contactSeed.set(id, {
      name: String(name).trim(),
      email: t.contactEmail || t.email || null,
      phone: t.contactPhone || t.phone || null,
    });
  };

  let revenue = 0;
  let purchases = 0;
  let refunds = 0;
  let refundAmount = 0;
  let coldRevenue = 0;
  let coldPurchases = 0;
  let organicRevenue = 0;
  let organicPurchases = 0;
  let metaRevenue = 0;
  let metaPurchases = 0;
  let googleRevenue = 0;
  let googlePurchases = 0;

  const limit = 100;
  const maxPages = 120;
  const txnPage = (offset: number) =>
    ghl<{ data?: any[]; totalCount?: number }>(
      `/payments/transactions?altId=${config.ghl.locationId}&altType=location&limit=${limit}&offset=${offset}&startAt=${range.start}&endAt=${range.end}`,
    );

  const firstTxn = await txnPage(0);
  const totalCount = typeof firstTxn.totalCount === "number" ? firstTxn.totalCount : (firstTxn.data || []).length;
  const pages = Math.min(Math.ceil(totalCount / limit), maxPages);
  const allTxns: any[] = [...(firstTxn.data || [])];
  if (pages > 1) {
    const rest = await pooled(
      Array.from({ length: pages - 1 }, (_, k) => () => txnPage((k + 1) * limit)),
    );
    rest.forEach((r) => allTxns.push(...(r.data || [])));
  }

  {
    const seenTxn = new Set<string>();
    const txns = allTxns;
    for (const t of txns) {
      if (t._id) {
        if (seenTxn.has(t._id)) continue; // guard against any page overlap
        seenTxn.add(t._id);
      }
      const status = String(t.status || "").toLowerCase();
      const gross = Number(t.amount || 0) / 100;
      const refunded = Number(t.amountRefunded || 0) / 100;
      const day = toISO(new Date(t.createdAt || t.updatedAt || Date.now()));
      if (status === "succeeded") {
        const net = gross - refunded;
        revenue += net;
        purchases += 1;
        if (revByDay.has(day)) revByDay.set(day, (revByDay.get(day) || 0) + net);
        if (purByDay.has(day)) purByDay.set(day, (purByDay.get(day) || 0) + 1);
        const cust = t.contactId || t.contactEmail;
        if (cust) customers.add(cust);
        if (t.contactId) {
          purchaseContactIds.push(t.contactId);
          purchaseCountById.set(t.contactId, (purchaseCountById.get(t.contactId) || 0) + 1);
          seedFrom(t);
        }
        // Cold attribution reuses the cold-lead IDs gathered while counting
        // leads — no extra per-contact API calls.
        if (t.contactId && coldIds.has(t.contactId)) {
          coldRevenue += net;
          coldPurchases += 1;
        } else if (t.contactId && organicIds.has(t.contactId)) {
          organicRevenue += net;
          organicPurchases += 1;
        }
        // Ad-platform attribution is independent of the cold/organic tag split
        // (a contact can be paid via attribution without the cold tag).
        if (t.contactId && metaIds.has(t.contactId)) {
          metaRevenue += net;
          metaPurchases += 1;
        } else if (t.contactId && googleIds.has(t.contactId)) {
          googleRevenue += net;
          googlePurchases += 1;
        }
      }
      if (refunded > 0 || status === "refunded") {
        refunds += 1;
        refundAmount += refunded || gross;
        if (t.contactId) {
          refundContactIds.push(t.contactId);
          seedFrom(t);
        }
      }
    }
  }

  return {
    revenue,
    purchases,
    uniquePurchasers: customers.size,
    refunds,
    refundAmount,
    revenueByDay: days.map((d) => ({ date: d, value: revByDay.get(d) || 0 })),
    purchasesByDay: days.map((d) => ({ date: d, value: purByDay.get(d) || 0 })),
    coldRevenue,
    coldPurchases,
    organicRevenue,
    organicPurchases,
    metaPurchases,
    metaRevenue,
    googlePurchases,
    googleRevenue,
    purchaseContactIds,
    purchaseCountById,
    refundContactIds,
    contactSeed,
  };
}

// Cap how many rows we expose per widget (paginated 25/page in the UI) and how
// many unique contact records we fetch for enrichment (bounds API calls).
const MAX_DRILLDOWN = 500;
const MAX_ENRICH = 200;

/** Enrich the purchaser/refund contact ids gathered while reading payments into
 *  full Contact records for the widget drill-downs. */
async function buildPaymentContacts(payments: GhlPayments | null): Promise<GhlMetrics["contacts"]> {
  const empty = { purchases: [], purchasers: [], repeatPurchasers: [], refunds: [] };
  if (!payments) return empty;
  const counts = payments.purchaseCountById;
  const purchaseIds = payments.purchaseContactIds; // one per purchase, ordered
  const refundIds = payments.refundContactIds; // one per refund, ordered
  // Unique purchasers, most-frequent first.
  const purchaserIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // Fetch each distinct contact record once, bounded.
  const union = [...new Set([...purchaseIds, ...refundIds])].slice(0, MAX_ENRICH);
  const enriched = union.length ? await fetchContactsByIds(union) : new Map<string, any>();
  const seed = payments.contactSeed;
  const make = (id: string) => toContact(id, enriched.get(id), seed.get(id));
  return {
    purchases: purchaseIds.slice(0, MAX_DRILLDOWN).map(make),
    purchasers: purchaserIds.slice(0, MAX_DRILLDOWN).map(make),
    repeatPurchasers: purchaserIds
      .filter((id) => (counts.get(id) || 0) >= 2)
      .slice(0, MAX_DRILLDOWN)
      .map(make),
    refunds: refundIds.slice(0, MAX_DRILLDOWN).map(make),
  };
}

export async function fetchGhl(range: DateRange): Promise<GhlMetrics | null> {
  if (!hasGhl()) return null;
  const key = `ghl:${range.start}:${range.end}:${range.lifetime}`;
  try {
    return await cached(
      key,
      TTL,
      async () => {
        // Track partial failures so we never cache a self-contradicting result
        // (e.g. leads=0 but appointments=70 because only the leads call failed).
        let degraded = false;
        const [leadsRes, appts] = await Promise.all([
          countLeads(range).catch((e) => {
            console.warn("[ghl] leads failed:", (e as Error).message);
            degraded = true;
            return {
              counts: { cold: 0, warm: 0, website: 0, total: 0 },
              coldIds: new Set<string>(),
              organicIds: new Set<string>(),
              metaIds: new Set<string>(),
              googleIds: new Set<string>(),
              organicLeads: 0,
              organicSources: [] as { label: string; value: number }[],
              paidByPlatform: { meta: 0, google: 0, other: 0 },
              paidCountries: [] as { code: string; value: number }[],
              organicCountries: [] as { code: string; value: number }[],
            };
          }),
          countAppointments(range).catch((e) => {
            console.warn("[ghl] appointments failed:", (e as Error).message);
            degraded = true;
            return {
              totals: { appointments: 0, callsCompleted: 0, noShows: 0 },
              cold: { appointments: 0, callsCompleted: 0, noShows: 0 },
              apptContacts: { scheduled: new Set<string>(), held: new Set<string>(), noShow: new Set<string>() },
            };
          }),
        ]);
        const leads = leadsRes.counts;
        const [payments, money] = await Promise.all([
          fetchPayments(range, leadsRes.coldIds, leadsRes.organicIds, leadsRes.metaIds, leadsRes.googleIds).catch((e) => {
            console.warn("[ghl] payments failed:", (e as Error).message);
            degraded = true;
            return null;
          }),
          // Money custom fields are the source of truth for revenue/refunds/LTV.
          // They're range-independent and cached separately — don't let a failure
          // here mark the whole funnel result degraded.
          fetchMoneyFields().catch((e) => {
            console.warn("[ghl] money fields failed:", (e as Error).message);
            return null;
          }),
        ]);
        // Keep the legacy LTV shape populated from the combined money pass.
        const ltv = money ? { average: money.ltvAverage, count: money.ltvCount } : null;

        // Warm sales funnel: count distinct warm-tagged contacts at each stage
        // (one per lead). Null when we have no warm contact set to scope against.
        let warmMeetings: GhlMetrics["warmMeetings"] = null;
        if (money && money.warmIds.length) {
          const warmSet = new Set(money.warmIds);
          const inWarm = (s: Set<string>) => {
            let n = 0;
            for (const id of s) if (warmSet.has(id)) n += 1;
            return n;
          };
          warmMeetings = {
            scheduled: inWarm(appts.apptContacts.scheduled),
            held: inWarm(appts.apptContacts.held),
            noShows: inWarm(appts.apptContacts.noShow),
          };
        }

        const contacts = await buildPaymentContacts(payments).catch((e) => {
          console.warn("[ghl] contact drill-down failed:", (e as Error).message);
          return { purchases: [], purchasers: [], repeatPurchasers: [], refunds: [] };
        });

        return {
          leads,
          coldLeads: leads.cold,
          appointments: appts.totals.appointments,
          callsCompleted: appts.totals.callsCompleted,
          noShows: appts.totals.noShows,
          coldAppointments: appts.cold.appointments,
          coldCallsCompleted: appts.cold.callsCompleted,
          coldNoShows: appts.cold.noShows,
          payments,
          warmMeetings,
          ltv,
          money,
          organicLeads: leadsRes.organicLeads,
          organicSources: leadsRes.organicSources,
          paidLeadsByPlatform: leadsRes.paidByPlatform,
          paidCountries: leadsRes.paidCountries,
          organicCountries: leadsRes.organicCountries,
          contacts,
          degraded,
        };
      },
      (v) => !v.degraded,
    );
  } catch (err) {
    console.error("[ghl] live fetch failed, falling back to demo:", err);
    return null;
  }
}
