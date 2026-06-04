import { config, hasGhl } from "../config";
import type { DateRange } from "../types";
import { eachDay, toISO } from "../dates";
import { parseISO } from "date-fns";
import { cached } from "../cache";

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
  /** Average of the GHL "Lifetime Value" custom field over contacts with value>0. */
  ltv: { average: number; count: number } | null;
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

// ---- Average Lifetime Value from the GHL custom field ----------------------
// Averages the "Lifetime Value" custom field across ALL contacts that have a
// real (> 0) value. This is an all-customers metric, independent of the selected
// date range, so it's cached separately on a longer TTL (it changes slowly).
async function fetchAvgLtv(): Promise<{ average: number; count: number } | null> {
  return cached("ghl:ltv", 30 * 60 * 1000, async () => {
    const pageLimit = 100;
    const maxPages = 80;
    const fieldId = config.ghl.ltvFieldId;

    const searchPage = (page: number) =>
      ghl<{ contacts?: any[]; total?: number }>("/contacts/search", {
        method: "POST",
        body: JSON.stringify({ locationId: config.ghl.locationId, page, pageLimit }),
      });

    let sum = 0;
    let count = 0;
    const tally = (contacts: any[]) => {
      for (const c of contacts) {
        const f = (c.customFields || []).find((x: any) => x.id === fieldId);
        if (!f) continue;
        const v = parseFloat(String(f.value).replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(v) && v > 0) {
          sum += v;
          count += 1;
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
    return { average: count ? sum / count : 0, count };
  });
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
    }
  }
  return { totals, cold };
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
            return { totals: { appointments: 0, callsCompleted: 0, noShows: 0 }, cold: { appointments: 0, callsCompleted: 0, noShows: 0 } };
          }),
        ]);
        const leads = leadsRes.counts;
        const [payments, ltv] = await Promise.all([
          fetchPayments(range, leadsRes.coldIds, leadsRes.organicIds, leadsRes.metaIds, leadsRes.googleIds).catch((e) => {
            console.warn("[ghl] payments failed:", (e as Error).message);
            degraded = true;
            return null;
          }),
          // LTV is independent of the funnel and cached separately — don't let
          // it mark the whole result degraded.
          fetchAvgLtv().catch((e) => {
            console.warn("[ghl] ltv failed:", (e as Error).message);
            return null;
          }),
        ]);

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
          ltv,
          organicLeads: leadsRes.organicLeads,
          organicSources: leadsRes.organicSources,
          paidLeadsByPlatform: leadsRes.paidByPlatform,
          paidCountries: leadsRes.paidCountries,
          organicCountries: leadsRes.organicCountries,
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
